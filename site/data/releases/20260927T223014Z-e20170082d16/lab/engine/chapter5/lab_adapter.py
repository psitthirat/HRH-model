"""Workforce Lab adapter to the canonical Chapter 5 Python model.

No web framework, filesystem, pickle, raw personnel records or JS equations are
required at runtime. Inputs are a versioned province-level aggregate package.
The only optimiser is chapter5.allocation.solve; metrics and ledgers are shared
with the authored analysis. Cached plans are exposed only by cached_result(),
never substituted for a participant's run().
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
import time
import uuid
from types import SimpleNamespace
import numpy as np
import pandas as pd
from chapter4 import model_design as MD
from . import allocation as AL, evaluation as EV, responsibilities as R, simulation as SIM, supply as SU

SCHEMA = 'workforce-lab.run/1'
YEARS = list(range(2026, 2041))
FAMILIES = {'P':('P','D_P'),'S':('S','D_S'),'N-STD':('N-STD','D_N'),'N-FB':('N-FB','D_N'),'SQ-C':('status_quo','D_P')}

def clean(value):
    if isinstance(value, pd.DataFrame): return clean(value.to_dict('records'))
    if isinstance(value, np.ndarray): return clean(value.tolist())
    if isinstance(value, dict): return {str(k):clean(v) for k,v in value.items()}
    if isinstance(value, (list,tuple)): return [clean(v) for v in value]
    if isinstance(value, (np.integer,)): return int(value)
    if isinstance(value, (np.bool_,)): return bool(value)
    if isinstance(value, (float,np.floating)): return float(value) if math.isfinite(value) else None
    return value

def dumps(value): return json.dumps(clean(value), ensure_ascii=False, separators=(',',':'), allow_nan=False)
def digest(value): return hashlib.sha256(json.dumps(clean(value),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def _notify(progress, stage, **details):
    if progress: progress(stage, dumps(details))

def trajectory(value, years=YEARS):
    """Resolve only explicitly declared trajectories; no gaps or silent filling."""
    if isinstance(value,(int,float)) and not isinstance(value,bool): return np.full(len(years),float(value))
    if not isinstance(value,dict): raise ValueError('trajectory must be a number or a trajectory object')
    mode=value.get('mode'); allowed={'constant':{'mode','value'},'step':{'mode','start','end','year'},'ramp':{'mode','start','end'},'annual':{'mode','values'}}
    if mode not in allowed or set(value)!=allowed[mode]: raise ValueError('trajectory keys do not match the selected mode')
    if mode=='constant': return trajectory(value['value'],years)
    if mode=='annual':
        if not isinstance(value['values'],list) or len(value['values'])!=len(years): raise ValueError('annual trajectory needs exactly 15 values')
        vals=value['values']
    elif mode=='step':
        if value['year'] not in years: raise ValueError('step year must be 2026–2040 CE')
        vals=[value['start'] if y<value['year'] else value['end'] for y in years]
    else: vals=np.linspace(value['start'],value['end'],len(years)).tolist()
    if any(isinstance(x,bool) or not isinstance(x,(float,int)) for x in vals): raise ValueError('trajectory values must be numbers')
    return np.asarray(vals,float)

def defaults(inputs): return {r['id']:copy.deepcopy(r['default']) for r in inputs['registry']['parameters']}

def spatial_path(p,key,provs,regions):
    """Baseline/national → health-region → province, with explicit precedence."""
    out=np.repeat(trajectory(p[key])[:,None],len(provs),axis=1)
    for scope in ['health_region','province']:
        for rule in p.get('geography.overrides',[]):
            if rule['parameter']==key and rule['scope']==scope:
                mask=np.isin(regions if scope=='health_region' else provs,rule['ids'])
                out[:,mask]=trajectory(rule['value'])[:,None]
    return out

def validate(config, inputs, versions=None):
    errors=[];warnings=[]
    if not isinstance(config,dict): return {'valid':False,'errors':[{'parameter':'config','message':'configuration must be an object'}],'warnings':[]}
    extra=set(config)-{'schema_version','name','title','parameters','origin'}
    if extra: errors.append({'parameter':'config','message':'unknown top-level keys: '+', '.join(sorted(extra))})
    if config.get('schema_version','workforce-lab.scenario/1')!='workforce-lab.scenario/1': errors.append({'parameter':'schema_version','message':'unsupported scenario schema'})
    raw=config.get('parameters',{})
    if not isinstance(raw,dict): return {'valid':False,'errors':[{'parameter':'parameters','message':'parameters must be an object'}],'warnings':[]}
    reg={r['id']:r for r in inputs['registry']['parameters']}; p=defaults(inputs); p.update(raw)
    for key,value in raw.items():
        r=reg.get(key)
        if r is None: errors.append({'parameter':key,'message':'unknown parameter; it was not ignored'});continue
        if not r.get('enabled',True) and value!=r['default']:
            errors.append({'parameter':key,'message':r.get('unsupported_reason_en') or 'unsupported parameter'});continue
        typ=r['type']
        if typ=='boolean':
            if not isinstance(value,bool): errors.append({'parameter':key,'message':'must be true or false'})
        elif typ=='select':
            if value not in [o['value'] if isinstance(o,dict) else o for o in r['options']]: errors.append({'parameter':key,'message':'unsupported choice'})
        elif typ=='json':
            if not isinstance(value,list):errors.append({'parameter':key,'message':'must be an array of explicit geographic override rules'})
        else:
            try:
                if not r.get('trajectory') and (not isinstance(value,(int,float)) or isinstance(value,bool)):
                    raise ValueError('must be a numeric scalar, not text, an array or an object')
                vals=trajectory(value) if r.get('trajectory') else np.asarray([value],float)
                if (not np.isfinite(vals).all()) or isinstance(value,bool): raise ValueError('must be a finite number')
                if typ=='integer' and (vals!=np.floor(vals)).any(): raise ValueError('must be an integer')
                if r.get('min') is not None and (vals<r['min']).any(): raise ValueError(f"minimum is {r['min']}")
                if r.get('max') is not None and (vals>r['max']).any(): raise ValueError(f"maximum is {r['max']}")
            except (TypeError,ValueError) as exc: errors.append({'parameter':key,'message':str(exc)})
    if not errors:
        supported={k for k in reg if k.startswith(('morbidity.','resources.')) and reg[k]['type']!='select'} | {'departures.hazard_multiplier','departures.reentry_multiplier','retention.resignation_reduction','retention.coverage'}
        occupied=set();base=pd.DataFrame(inputs['base'])
        for rule in p.get('geography.overrides',[]):
            try:
                if not isinstance(rule,dict) or set(rule)!={'parameter','scope','ids','value'}:raise ValueError('each geographic rule requires parameter, scope, ids and value')
                key=rule['parameter'];scope=rule['scope'];ids=rule['ids']
                if key not in supported:raise ValueError('this parameter is not supported geographically; a national appointment pool cannot be repeated per province')
                if scope not in ['health_region','province']:raise ValueError('scope must be health_region or province')
                valid_ids=set(base.health_region if scope=='health_region' else base.prov_code)
                if not isinstance(ids,list) or not ids or any(not isinstance(i,int) or isinstance(i,bool) or i not in valid_ids for i in ids):raise ValueError('unknown, noninteger or empty geographic identifiers')
                if len(set(ids))!=len(ids):raise ValueError('duplicate geographic identifiers')
                for id_ in ids:
                    token=(key,scope,id_)
                    if token in occupied:raise ValueError('overlapping overrides at the same priority are ambiguous')
                    occupied.add(token)
                vals=trajectory(rule['value']);r=reg[key]
                if not np.isfinite(vals).all() or (vals<r['min']).any() or (vals>r['max']).any():raise ValueError('geographic override is outside this parameter’s hard bounds')
            except (ValueError,KeyError,TypeError) as exc:errors.append({'parameter':'geography.overrides','message':str(exc)})
        if not errors:
            for c in MD.DISEASE:
                rel=spatial_path(p,'morbidity.'+c[5:]+'_relative_change',base.prov_code,base.health_region)
                pp=spatial_path(p,'morbidity.'+c[5:]+'_percentage_point_change',base.prov_code,base.health_region)
                if ((rel!=0)&(pp!=0)).any():errors.append({'parameter':'morbidity.'+c[5:],'message':'relative and percentage-point changes cannot both be applied to the same province-year'})
        if p['uncertainty.enabled'] and p['planning.mode']=='annual_replanning':
            if p.get('allocation.population_reserved_share',0):
                errors.append({'parameter':'allocation.population_reserved_share','message':'Population protection is supported in deterministic planning and fixed-schedule uncertainty. Adaptive uncertainty requires a separately validated update of population quotas after observed demographic shocks; it cannot ignore the protected share.'})
            if p['allocation.family'] not in ['P','S','N-STD'] or p['mobility.enabled'] or p['allocation.objective']!='shortfall':
                errors.append({'parameter':'planning.mode','message':'Stochastic annual replanning supports recruitment-only P/S/N-STD with the canonical shortfall learning rule; N-FB, SQ-C, transfers and maximin require a separately validated adaptive rule.'})
            unchanged=(p['departures.rate_source']=='pooled' and
                       np.all(spatial_path(p,'departures.hazard_multiplier',base.prov_code,base.health_region)==1) and
                       np.all(spatial_path(p,'departures.reentry_multiplier',base.prov_code,base.health_region)==1) and
                       np.all(spatial_path(p,'retention.resignation_reduction',base.prov_code,base.health_region)*spatial_path(p,'retention.coverage',base.prov_code,base.health_region)==0))
            if not unchanged:errors.append({'parameter':'planning.mode','message':'The adaptive posterior learning rule currently requires pooled baseline departure and re-entry hazards without a retention intervention; these controls remain supported for fixed-schedule uncertainty.'})
            warnings.append({'code':'adaptive_compute_cost','message':f"Adaptive uncertainty may solve {15*p['uncertainty.draws']} annual integer programmes; actual completed paths and failed years will be reported."})
        if p['uncertainty.enabled'] and p['mobility.origin_protection']=='surplus_only' and p['mobility.enabled']:
            errors.append({'parameter':'mobility.origin_protection','message':'The canonical stochastic transfer-recourse routine supports limited_drawdown only; surplus_only uncertainty requires a separately validated recourse rule.'})
        if p['supply.input_mode']=='available_appointments' and (trajectory(p['supply.available_appointments'])<76*p['allocation.floor']).any():
            warnings.append({'code':'floor_exceeds_pool','message':'the annual pool is below the total provincial floor in at least one year; the optimizer may report infeasibility'})
        if p['supply.input_mode']!='available_appointments': warnings.append({'code':'illustrative_supply_conversion','message':'graduate, training and participation assumptions are illustrative participant settings, not verified production estimates'})
        if p['allocation.family']=='SQ-C' and p['allocation.objective']!='shortfall': errors.append({'parameter':'allocation.objective','message':'SQ-C uses its historical-share L1 objective; maximin is not applicable'})
        if p['allocation.family']!='N-FB' and any(p[k]!=0 for k in ['resources.beds_growth','resources.nurses_growth','resources.gpp_growth']):
            warnings.append({'code':'fixed_reference_resources','message':'actual capacity changes affect resource-responsive service evaluation, while the M5 reference used by N-STD allocation remains fixed'})
    return clean({'valid':not errors,'errors':errors,'warnings':warnings,'resolved_parameters':p,'parameter_diff':[{'id':k,'baseline':reg[k]['default'],'value':v} for k,v in p.items() if k in reg and v!=reg[k]['default']]})

def _pkg(value):
    p=copy.deepcopy(value)
    for k in ['beta','beta_pos','boot']: p[k]={o:np.asarray(x,float) for o,x in p.get(k,{}).items()}
    for k in ['health_mu','health_cov_inv']: p[k]=np.asarray(p[k],float)
    p['support']=pd.DataFrame(p['support'])
    return p

def context(parameters, inputs):
    """Resolve controls into the canonical settings/context, preserving fixed reference data."""
    p=parameters; cfg=copy.deepcopy(inputs['config']); a=cfg['allocation']; s=cfg['supply']
    mapping={'allocation.floor':'universal_new_appointment_floor','allocation.cap_mode':'cap_mode','allocation.cap_fraction':'cap_fraction_of_opening_stock','mobility.transfer_fraction':'main_transfer_fraction','mobility.national_budget_fraction':'national_transfer_budget_fraction','mobility.protected_fraction':'protected_survivor_fraction','mobility.origin_protection':'origin_protection_mode','mobility.network':'eligibility_network','solver.time_limit_seconds':'time_limit_s','solver.secondary_time_limit_seconds':'secondary_time_limit_s','solver.mip_gap':'mip_rel_gap'}
    mapping['allocation.full_placement']='require_full_placement'
    for k,dest in mapping.items():a[dest]=p[k]
    a['population_reserved_share']=p.get('allocation.population_reserved_share',0)
    a['reservation_population_column']='pop_entitlement_central' if p['allocation.population_register']=='entitlement' else 'population'
    s.update(input_mode=p['supply.input_mode'],annual_path=trajectory(p['supply.available_appointments']).tolist(),national_graduates=trajectory(p['supply.national_graduates']).tolist(),intake_2026_onwards=p['supply.student_intake'])
    for k in ['licensing','participation','managed_share','completion']: s[k]=p['supply.'+k]
    cfg['targets']['reference_per_1000']=p['targets.reference_per_1000'];cfg['services'].update(op_minutes=p['services.op_minutes'],adjrw_minutes=p['services.adjrw_minutes'],inpatient_measure=p['services.inpatient_measure']);cfg['m5']['morbidity_path']=p['morbidity.path']
    S=SimpleNamespace(cfg=cfg,base_year=2025,years=YEARS,seed=cfg['project']['random_seed'])
    base=pd.DataFrame(inputs['base']).sort_values('prov_code').reset_index(drop=True);provs=base.prov_code.to_numpy(int)
    key=base[['prov_code','province','province_en','health_region']].copy();panel=pd.DataFrame(inputs['panel'])
    pop=pd.DataFrame(inputs['population_projection']);pop=pop[(pop.scenario==p['demography.scenario'])&pop.prov_code.isin(provs)].copy()
    rates=pd.DataFrame(inputs['flow_rates']);deps=SU.Departures(rates,provs,national=p['departures.rate_source']=='national')
    hm=spatial_path(p,'departures.hazard_multiplier',provs,base.health_region);rm=spatial_path(p,'departures.reentry_multiplier',provs,base.health_region)
    h={c:hm*deps.h[c][None,:] for c in SU.EXIT};start=int(p['retention.start_year']+p['retention.lag_years']);ramp=int(p['retention.ramp_years'])
    effect=np.array([0 if y<start else (min(1,(y-start+1)/ramp) if ramp else 1) for y in YEARS])[:,None]
    h['resignation']=h['resignation']*(1-spatial_path(p,'retention.resignation_reduction',provs,base.health_region)*spatial_path(p,'retention.coverage',provs,base.health_region)*effect)
    he=sum(h.values());dep={'d':1-np.exp(-he),'r':rm*sum(deps.h[c] for c in SU.REENTRY)[None,:],'shares':{c:np.divide(h[c],he,out=np.zeros_like(he),where=he>0) for c in SU.EXIT},'h_exit':he}
    pkg=_pkg(inputs['m5']);w=R.weights(S)
    canonical_idx=pd.DataFrame(inputs['indices']).sort_values(['year','prov_code']).reset_index(drop=True)
    method=inputs['service_methods'] if p['services.projection']=='canonical' else {o:p['services.projection'] for o in R.SERVICE_COL}
    # The exported observed-service forecasts carry full precision and source choices.
    if p['demography.scenario']=='central' and p['services.projection']=='canonical':svc=pd.DataFrame(inputs['service_projection'])
    else:svc=R.service_projection(S,panel,pop,method)
    rat=canonical_idx[canonical_idx.year==2025].set_index('prov_code');rat=rat.pop_entitlement_central/rat.population
    ent=pop[['year','prov_code','population']].copy();ent['pop_entitlement_central']=ent.population*ent.prov_code.map(rat)
    idx,registry,support=R.build_indices(S,base,pop,ent,svc,pkg,w=w,panel=panel)
    cov=idx.attrs['cov'].copy()
    changed_morb=False
    for c in MD.DISEASE:
        values=spatial_path(p,'morbidity.'+c[5:]+'_relative_change',provs,base.health_region)
        pp=spatial_path(p,'morbidity.'+c[5:]+'_percentage_point_change',provs,base.health_region)
        if (values!=0).any() or (pp!=0).any():
            changed_morb=True
            rel=pd.Series(values.ravel(),index=pd.MultiIndex.from_product([YEARS,provs]));ppoints=pd.Series(pp.ravel(),index=rel.index)
            ix=pd.MultiIndex.from_frame(cov[['year','prov_code']]);cov[c]=cov[c]*(1+rel.reindex(ix).fillna(0).to_numpy())+ppoints.reindex(ix).fillna(0).to_numpy()
            if ((cov[c]<0)|(cov[c]>100)|~np.isfinite(cov[c])).any():raise ValueError(f'{c}: adjusted diagnosed prevalence is outside 0–100%; no values were clipped')
    if changed_morb:
        for o in R.SERVICE_COL:
            idx[f'rate_std_{o}']=R.m5_rate(pkg,o,cov,None,None,int(cfg['m5']['reference_year']),reference=True)
            idx[f'V_std_{o}']=idx[f'rate_std_{o}']*idx.population
        ip='V_std_ip_moph' if w['inpatient']=='ip_days' else 'V_std_adjrw'
        idx['B_N']=R.composite(idx.V_std_op_moph,idx[ip],w,float(idx.conv_N.iloc[0]));idx['D_N'],scale=R.normalize(idx,'B_N',2025,float(base.pop_civil.sum()));idx['scale_N']=scale
        idx['positive_N']=(idx[[f'rate_std_{o}' for o in R.SERVICE_COL]]>0).all(axis=1)
        support=R.support_flags(pkg,cov)
    # Reject undefined targets, including nonpositive M5 predictions, rather than clamp them.
    if not idx.positive_N.all():
        bad=idx.loc[~idx.positive_N,['year','prov_code']].head(5).to_dict('records')
        raise ValueError(f'nonpositive standardized M5 component prediction; no clipping or composite cancellation is allowed: {bad}')
    if (svc[[f'V_{o}' for o in R.SERVICE_COL]]<0).any().any():
        raise ValueError('a selected service forecast produces a negative service component; no values were clipped')
    if (idx[['D_P','D_S','D_N']]<=0).any().any() or not np.isfinite(idx[['D_P','D_S','D_N']]).all().all():raise ValueError('a projected responsibility index is nonpositive or unavailable; this scenario cannot define the selected targets')
    res=R.resource_paths(S,base,pop,panel=panel);dt=res.year-2025
    for k,cols in [('beds',['moph_beds','cmx_beds']),('nurses',['moph_professional_nurses']),('gpp',['gpp_lag1'])]:
        growth=spatial_path(p,'resources.'+k+'_growth',provs,base.health_region)
        factors=pd.Series(np.cumprod(1+growth,axis=0).ravel(),index=pd.MultiIndex.from_product([YEARS,provs]))
        fac=factors.reindex(pd.MultiIndex.from_frame(res[['year','prov_code']])).fillna(1).to_numpy()
        for col in cols:res[col]=res[col]*fac
    res['log_gpp_lag1']=np.log(res.gpp_lag1);res['log_beds_moph_per1000']=np.log(1000*res.moph_beds/res.population);res['log_beds_cmx_per1000']=np.log(1000*res.cmx_beds/res.population);res[MD.NURS]=np.log(1e5*res.moph_professional_nurses/res.population)
    fb=R.Feedback(S,pkg,idx,res,cov,w);pool_table=SU.pool_path(S)
    return SimpleNamespace(S=S,base=base,key=key,provs=provs,names=dict(zip(key.prov_code,key.province)),region=base.health_region.to_numpy(),H0=base.H0.to_numpy(float),rates=rates,departures=deps,dep=dep,pop=pop,ent=ent,svc=svc,svc_method=method,pkg=pkg,w=w,idx=idx,registry=registry,support=support,res=res,cov=cov,fb=fb,pool=pool_table.available.to_numpy(float),pool_table=pool_table,dist=np.asarray(inputs['distance_km'],float),k=p['targets.reference_per_1000']/1000)

def specification(p):
    family,col=FAMILIES[p['allocation.family']];mob='RT' if p['mobility.enabled'] else 'R'
    if family=='P' and p.get('allocation.population_register','civil')=='entitlement':family,col='P_ent','D_Pent'
    pid=('SQ-C' if family=='status_quo' else f"NFB{p['feedback.lambda']:g}-{mob}" if family=='N-FB' else f"{'N' if family=='N-STD' else 'Pent' if family=='P_ent' else family}-{mob}")
    return SIM.PlanSpec(pid,family,col,'recruitment_and_transfers' if p['mobility.enabled'] else 'recruitment_only',p['targets.experiment'],feedback=f"lagged_lambda_{p['feedback.lambda']:g}" if family=='N-FB' else 'none',lam=p['feedback.lambda'] if family=='N-FB' else 0.)

def target_matrices(ctx,experiment):
    return {f:SIM.targets_matrix(ctx.idx,c,experiment,ctx.k,2025,YEARS) for f,c in [('P','D_P'),('S','D_S'),('N','D_N'),('Pent','D_Pent')]}

def _status(sol):
    if sol.status=='solved':
        return 'feasible_incumbent' if any(s.get('status')==1 for s in sol.stages) else 'completed'
    if sol.diagnostics.get('initial_solver_status')==1 or any(s.get('status')==1 for s in sol.stages):return 'timeout_without_incumbent'
    return 'infeasible' if 'infeasible' in sol.status else 'failed'

def _package(config,p,versions,inputs,ctx,spec,pb,sol,elapsed,validation,source='computed'):
    check=AL.check(pb,sol);fl=AL.binding_flags(pb,sol);te=target_matrices(ctx,spec.experiment)
    extra=None
    if pb.population_reserved_share:
        total,lo,hi,exact=AL.reservation_quota(pb);q=AL.reserved_allocations(pb,sol.x)
        extra={'population_protected_appointments':q,'population_quota_floor':lo,'population_quota_ceiling':hi,
               'population_quota_exact':exact,'population_reserved_total':np.repeat(total[:,None],pb.P,axis=1)}
    led=SIM.ledger(ctx,spec,pb,sol.x,sol.zin,sol.zout,'exploratory_policy_scenario',te,fl,AL.explanation(pb,sol,fl),extra_cols=extra)
    bal=SIM.national_balance(led,pd.DataFrame({'plan_id':spec.plan_id,'year_ce':YEARS,'available':ctx.pool}))
    if extra is not None:bal['population_protected_appointments']=bal.year_ce.map(dict(zip(YEARS,total)))
    transfers=SIM.routes_table(ctx,spec,pb,sol.zin,sol.zout)
    pop=ctx.idx[ctx.idx.year.isin(YEARS)].sort_values(['year','prov_code']).population.to_numpy().reshape(15,76)
    metric=[];attain=[]
    for experiment in ['common_total','fixed_base_conversion']:
        for criterion,T in target_matrices(ctx,experiment).items():
            metric.append(EV.trajectory_metrics(spec.plan_id,criterion+'|'+experiment,sol.H,T,YEARS,ctx.region,pop))
            first,sustained=EV.attainment_years(sol.H,T,YEARS)
            for i,code in enumerate(ctx.provs):attain.append({'plan_id':spec.plan_id,'criterion':criterion+'|'+experiment,'prov_code':int(code),'province':ctx.names[code],'first_year_ce':first[i],'sustained_year_ce':sustained[i]})
    metric.append(EV.trajectory_metrics(spec.plan_id,'own',sol.H,pb.T,YEARS,ctx.region,pop))
    diff=validation['parameter_diff'];result={'schema_version':SCHEMA,'run_id':'lab-'+digest({'parameters':p,'versions':versions})[:24],'status':_status(sol),'title':config.get('name',config.get('title','ฉากทัศน์ของฉัน')),'config':copy.deepcopy(config),'resolved_config':{'schema_version':'workforce-lab.scenario/1','parameters':p},'versions':versions,'source':source,'plan_id':spec.plan_id,'parameter_diff':diff,'ledger':led,'national_balance':bal,'metrics':pd.concat(metric,ignore_index=True),'transfers':transfers,'attainment_years':attain,'diagnostics':{'hard_constraints':check,'solver_stages':sol.stages,'solver':sol.diagnostics,'elapsed_seconds':elapsed,'warnings':validation['warnings'],'support':ctx.support,'status':'exploratory_policy_scenario','global_optimum_claimed':False,'zero_equals_missing':False},'methods':{'scope':'MOPH headcount used provisionally for OPS, 76 provinces excluding Bangkok; stock and HROPS event scope differ','target':'physician stock at the end of each year; illustrative reference, not recruitment or a clinical sufficiency standard','gini':'weighted Gini of H/T with weight T; same criterion and target path for a valid comparison','bottom_quartile':'19 provinces re-ranked by H/T in each plan/year/criterion; sum(H) / sum(T) within the selected 19','stock_flow':'closing = opening − external departures + reentries + appointments + internal transfers in − internal transfers out','service':'OP visits and AdjRW weighted by illustrative minutes; recorded services are not normative need','feedback':'lagged positive-mean M5 relative resource response, anchored to N-STD; sequential policy is not the global optimum of a nonlinear programme'}}
    if not check['all_ok']:result['status']='validation_failed'
    if pb.population_reserved_share:
        result['methods']['population_reservation']={
            'share':pb.population_reserved_share,'population_register':p['allocation.population_register'],
            'national_total':'floor(available appointments × reserved share + 0.5): nearest integer with halves rounded up',
            'province_quota':'integer q between floor and ceiling of reserved national total × provincial population share; sum(q) equals the reserved total',
            'constraints':'accepted appointments x >= max(universal floor, q); protected appointments count within x and are not additional supply; original arrival, transfer and origin limits remain hard; an infeasible quota is not relaxed',
            'reported_subset':'the optimizer establishes existence of q; the exported protected subset uses eligible largest remainders and province-code tie breaks within the solved x, without changing x',
            'uncertainty':'fixed-schedule evaluation preserves the announced central-population quota; adaptive stochastic quota updating is unavailable'}
    result['computation_hash']=digest({'parameters':p,'versions':versions})
    result['run_id']=('cache-'+result['computation_hash'][:24]) if source=='presentation_cache' else 'lab-'+str(uuid.uuid4())
    result['context_tables']={'demography':ctx.pop,'health':ctx.cov,'resources':ctx.res,'services':ctx.svc,
                              'supply_pipeline':ctx.pool_table,'responsibility_indices':ctx.idx,
                              'context_units':{'diagnosed_prevalence':'percent; percentage-point changes added on this scale',
                                               'age_shares':'fraction','resources':'counts; log transforms retain canonical unit',
                                               'supply_available':'accepted starts per year; integer'}}
    result['service_outcomes']=service_outcomes(ctx,sol.H,p,spec.plan_id)
    # Compare decisions with the immutable P-R reference, keeping unequal pools explicit.
    base=inputs['cached_plans']['P-R'];xb=np.asarray(base['x']);Hb=np.asarray(base['H']);Ab=np.asarray(base['pool']);ub=np.asarray(base['u'])
    same=np.array_equal(Ab,pb.A);sw,pct=EV.switches(xb,sol.x,ub,sol.u,pb.A) if same else (np.full(15,np.nan),np.full(15,np.nan))
    comparison=[]
    for t,y in enumerate(YEARS):
        for i,code in enumerate(ctx.provs):comparison.append({'year_ce':y,'year_be':y+543,'prov_code':int(code),'province':ctx.names[code],'baseline_plan_id':'P-R','plan_id':spec.plan_id,'appointments_difference':int(sol.x[t,i]-xb[t,i]),'cumulative_appointments_difference':int((sol.x[:t+1,i]-xb[:t+1,i]).sum()),'closing_stock_difference':float(sol.H[t,i]-Hb[t,i])})
    result['comparison']={'reference':'published P-R','same_annual_pool':same,'switches_interpretation':'annual reassigned destinations; undefined for unequal annual pools','rows':comparison,'annual_switches':[{'year_ce':y,'switches':sw[t],'percent_of_pool':pct[t]} for t,y in enumerate(YEARS)],'cumulative_switches':float(sw.sum()) if same else None}
    return clean(result)

def run(config,inputs,versions=None,progress=None):
    start=time.perf_counter();versions=versions or {};_notify(progress,'validating')
    valid=validate(config,inputs,versions)
    if not valid['valid']:return {'schema_version':SCHEMA,'status':'invalid','validation':valid,'config':config,'versions':versions}
    p=valid['resolved_parameters'];_notify(progress,'resolving_inputs',parameters_changed=len(valid['parameter_diff']))
    try:ctx=context(p,inputs)
    except (ValueError,KeyError) as exc:return {'schema_version':SCHEMA,'status':'invalid','validation':{'valid':False,'errors':[{'parameter':'model_inputs','message':str(exc)}]},'config':config,'versions':versions}
    spec=specification(p);T=SIM.targets_matrix(ctx.idx,spec.index_col,spec.experiment,ctx.k,2025,YEARS)
    stages=('maximin','shortfall','distribution') if p['allocation.objective']=='maximin' else ('shortfall','distribution','operational')
    pb=SIM.make_problem(ctx,spec,T,stages=stages)
    if spec.family=='status_quo':pb.reference_x=np.asarray([AL.apportion(int(a),np.asarray(inputs['historical_recruitment_share'])) for a in ctx.pool])
    sequential=spec.family=='N-FB' or p['planning.mode']=='annual_replanning'
    _notify(progress,'solving',plan_id=spec.plan_id,years=len(YEARS),provinces=len(ctx.provs),method='rolling_horizon' if sequential else 'joint_horizon')
    if sequential:
        X=np.zeros((15,76),int);ZI=X.copy();ZO=X.copy();TU=np.zeros((15,76));Hp=ctx.H0.copy();logs=[];failed=None
        for t,y in enumerate(YEARS):
            _notify(progress,'solving_year',year_ce=y,completed_years=t,total_years=15)
            Trem=T[t:].copy()
            if spec.family=='N-FB':
                for j,yy in enumerate(YEARS[t:]):
                    D,eta=ctx.fb.nfb_D(yy,Hp,spec.lam)
                    if (D<=0).any() or not np.isfinite(D).all():return {'schema_version':SCHEMA,'status':'invalid','validation':{'errors':[{'parameter':'feedback.lambda','message':'nonpositive feedback responsibility'}]}}
                    Trem[j]=ctx.k*ctx.idx[ctx.idx.year==yy].population.sum()*D/D.sum() if spec.experiment=='common_total' else ctx.k*D
            dep={'d':ctx.dep['d'][t:],'r':ctx.dep['r'][t:]};part=SIM.make_problem(ctx,spec,Trem,dep=dep,H0=Hp,A=ctx.pool[t:],years=YEARS[t:],stages=stages)
            if spec.family=='status_quo':part.reference_x=pb.reference_x[t:]
            step=AL.solve(part,objective='closest_to_reference' if spec.family=='status_quo' else 'lexicographic')
            logs.extend([{**s,'decision_year_ce':y} for s in step.stages])
            if step.status!='solved':failed=step;break
            X[t],ZI[t],ZO[t],TU[t]=step.x[0],step.zin[0],step.zout[0],Trem[0];Hp=step.H[0]
        if failed is not None:sol=failed
        else:
            pb.T=TU;pb.w=TU/TU.sum(axis=1)[:,None]
            sol=AL.Solution('solved',X,ZI,ZO,AL.trajectory(pb,X,ZI,ZO),pb.A-X.sum(axis=1),logs,{'sequential':True,'global_nonlinear_optimum':False})
    else:
        incumbent=None
        if pb.transfers and spec.family!='status_quo':
            # Same feasible recruitment-only incumbent as pipeline.run_job;
            # this prevents a transfer policy from accepting a worse first-stage
            # solution merely because its integer optimisation is harder.
            _notify(progress,'solving_recruitment_reference',plan_id=spec.plan_id)
            pbr=copy.copy(pb);pbr.transfers=False
            reference=AL.solve(pbr)
            if reference.status=='solved':incumbent=(reference.x,reference.zin,reference.zout)
        sol=AL.solve(pb,objective='closest_to_reference' if spec.family=='status_quo' else 'lexicographic',incumbent=incumbent)
    if sol.status!='solved':return clean({'schema_version':SCHEMA,'run_id':'lab-'+str(uuid.uuid4()),'computation_hash':digest({'parameters':p,'versions':versions}),'status':_status(sol),'config':config,'resolved_config':{'parameters':p},'versions':versions,'source':'computed','diagnostics':{'solver_stages':sol.stages,'solver':sol.diagnostics,'elapsed_seconds':time.perf_counter()-start,'warnings':valid['warnings']}})
    _notify(progress,'evaluating',plan_id=spec.plan_id)
    result=_package(config,p,versions,inputs,ctx,spec,pb,sol,time.perf_counter()-start,valid)
    if p['uncertainty.enabled']:
        result['uncertainty']=stochastic_evaluation(ctx,p,pb,sol,inputs,progress)
        result['diagnostics']['elapsed_seconds']=time.perf_counter()-start
    _notify(progress,'completed',status=result['status'],elapsed_seconds=time.perf_counter()-start)
    return result

def cached_result(plan_id,inputs,versions=None):
    """Build a transparent presentation cache, never used inside run()."""
    p=defaults(inputs);c=inputs['cached_plans'][plan_id]
    if plan_id.startswith('NFB'):p.update({'allocation.family':'N-FB','feedback.lambda':float(plan_id.split('-')[0][3:])})
    elif plan_id=='SQ-C':p['allocation.family']='SQ-C'
    else:p['allocation.family']={'P':'P','S':'S','N':'N-STD'}[plan_id[0]]
    p['mobility.enabled']='-RT' in plan_id
    if '|net' in plan_id:p['allocation.cap_mode']='net_growth'
    if '|pool' in plan_id:p['supply.available_appointments']=int(plan_id.split('|pool')[1])
    config={'schema_version':'workforce-lab.scenario/1','title':plan_id,'parameters':p,'origin':{'preset_id':plan_id}}
    if c['T'] is None:
        return clean({'schema_version':SCHEMA,'run_id':'cache-'+plan_id,'status':'infeasible','title':plan_id,'config':config,'resolved_config':{'parameters':p},'versions':versions or {},'source':'presentation_cache','plan_id':plan_id,'diagnostics':{'solver_stages':c.get('stages',[]),'solver':c.get('diagnostics',{}),'elapsed_seconds':c.get('seconds')}})
    ctx=context(p,inputs);spec=specification(p);spec.plan_id=plan_id
    pb=SIM.make_problem(ctx,spec,np.asarray(c['T'],float));sol=AL.Solution('solved',np.asarray(c['x'],int),np.asarray(c['zin'],int),np.asarray(c['zout'],int),np.asarray(c['H'],float),np.asarray(c['u'],float),c.get('stages') or [],c.get('diagnostics') or {})
    return _package(config,p,versions or {},inputs,ctx,spec,pb,sol,c.get('seconds'),validate(config,inputs),source='presentation_cache')

def validate_json(config_json,inputs_json,versions_json='{}'):
    return dumps(validate(json.loads(config_json),json.loads(inputs_json),json.loads(versions_json)))

def service_outcomes(ctx,H,p,plan_id):
    """Canonical positive M5 resource response with two explicitly named anchors.

    The standardized anchor uses the same per-outcome formula as Feedback.nfb_B.
    Evaluation uses annual-average physicians; allocation feedback retains its
    previous-year physician timing. These are conditional predictions, not causal
    effects and not an additional allocation target.
    """
    lam=float(p.get('services.response_strength',1.0));rows=[]
    Hp=np.vstack([ctx.H0[None],H[:-1]])
    for t,y in enumerate(YEARS):
        avg=(Hp[t]+H[t])/2;ix=ctx.fb.idx.loc[y].reindex(ctx.provs)
        res=ctx.fb.res.loc[y].reindex(ctx.provs)
        r=pd.DataFrame({'plan_id':plan_id,'year_ce':y,'year_be':y+543,'prov_code':ctx.provs,
                        'province':[ctx.names[c] for c in ctx.provs],'population':ix.population.to_numpy(),
                        'physicians_annual_average':avg,'response_strength':lam,
                        'moph_beds':res.moph_beds.to_numpy(),'cmx_beds':res.cmx_beds.to_numpy(),
                        'moph_professional_nurses':res.moph_professional_nurses.to_numpy(),
                        'gpp_lag1':res.gpp_lag1.to_numpy()})
        for o in R.SERVICE_COL:
            r['standardized_anchor_'+o]=ix[f'V_std_{o}'].to_numpy()
            ratio=np.exp(lam*ctx.fb.log_ratio_pos(o,y,avg))
            r['resource_response_factor_'+o]=ratio
            r['standardized_resource_response_'+o]=r['standardized_anchor_'+o]*ratio
            r['observed_service_anchor_'+o]=ix[f'V_{o}'].to_numpy()
            r['observed_anchored_physician_response_'+o]=ctx.fb.anchored(o,y,avg,lam)[0]
        r['standardized_response_minutes']=ctx.fb.nfb_B(y,avg,lam)[0]
        r['observed_anchored_response_minutes']=ctx.fb.response_minutes(y,avg,lam)[0]
        r['standardized_response_op_per_physician']=np.divide(r.standardized_resource_response_op_moph,avg,out=np.full_like(avg,np.nan),where=avg>0)
        r['evidence_type']='conditional_positive_M5_response; not a causal effect or normative need'
        r['timing']='annual-average physicians; actual year-specific complementary resources'
        rows.append(r)
    return pd.concat(rows,ignore_index=True)

def run_json(config_json,inputs_json,versions_json='{}',progress=None):
    return dumps(run(json.loads(config_json),json.loads(inputs_json),json.loads(versions_json),progress))

def appointment_priority(aa,bb):
    """Rank received appointments, with a separately declared exact-19 group.

    These are allocation outcomes, not a clinical shortage classification.
    Annual counts and whole-horizon totals are ranked independently; closing
    stocks never enter the ranking. Tied ranks use the presentation's min rule.
    Group membership needs an additional deterministic tie-break to stay at 19.
    """
    key=['year_ce','prov_code'];column='new_appointments_accepted_starts'
    a=aa.sort_values(key).reset_index(drop=True);b=bb.sort_values(key).reset_index(drop=True)
    if not a[key].equals(b[key]) or a.duplicated(key).any():raise ValueError('priority comparisons require unique matching province-year keys')
    years=sorted(a.year_ce.unique());provinces=a[a.year_ce==years[0]][['prov_code','province']].copy()
    codes=provinces.prov_code.to_numpy();n=len(codes)
    if n!=76 or len(a)!=len(years)*n:raise ValueError('the exact-19 priority group requires the full 76-province domain')
    if not pd.MultiIndex.from_frame(a[key]).equals(pd.MultiIndex.from_product([years,codes])):raise ValueError('priority comparison has missing province-years')
    xa=a[column].to_numpy().reshape(len(years),n);xb=b[column].to_numpy().reshape(len(years),n)
    rows=[];overlap=[]
    for year,va,vb in [(int(y),xa[t],xb[t]) for t,y in enumerate(years)]+[('all',xa.sum(0),xb.sum(0))]:
        ra=pd.Series(va).rank(method='min',ascending=False).to_numpy(int);rb=pd.Series(vb).rank(method='min',ascending=False).to_numpy(int)
        ga=set(int(codes[i]) for i in np.lexsort((codes,-va))[:19]);gb=set(int(codes[i]) for i in np.lexsort((codes,-vb))[:19])
        for i,province in enumerate(provinces.itertuples(index=False)):
            rows.append({'year_ce':year,'prov_code':int(province.prov_code),'province':province.province,
                         'appointments_a':int(va[i]),'appointments_b':int(vb[i]),'rank_a':int(ra[i]),'rank_b':int(rb[i]),
                         'rank_change':int(ra[i]-rb[i]),'priority_a':int(codes[i]) in ga,'priority_b':int(codes[i]) in gb})
        overlap.append({'year_ce':year,'group_size':19,'members_a':sorted(ga),'members_b':sorted(gb),
                        'shared_codes':sorted(ga&gb),'entered_codes':sorted(gb-ga),'left_codes':sorted(ga-gb),
                        'shared_count':len(ga&gb),'union_count':len(ga|gb),'jaccard':len(ga&gb)/len(ga|gb),'retained_share':len(ga&gb)/19})
    definition={'quantity':'accepted new appointments, not closing stock or a shortage assessment',
                'period':'each year independently; all = total appointments over the complete shared horizon',
                'rank':'descending appointments; 1 = most appointments; equal values share the minimum rank',
                'rank_change':'rank_A minus rank_B; positive means a higher position in B',
                'priority_group':'exactly 19 of 76 provinces with the most appointments in that period; break boundary ties by ascending province code',
                'group_caveat':'a deterministic comparison group, not an additional allocation rule or a clinical priority classification; tied zero appointments may enter the exact-size group',
                'jaccard':'shared province count divided by union province count',
                'retained_share':'shared province count divided by 19'}
    return {'priority_rows':rows,'priority_overlap':overlap,'priority_definition':definition}

def compare_runs(runs):
    """Pairwise canonical comparisons; reject incompatible domains and definitions."""
    pairs=[]
    for ai,a in enumerate(runs):
        for b in runs[ai+1:]:
            for version in ['engine_version','inputs_version','metric_definition_version','metric_definition_hash']:
                if a.get('versions',{}).get(version)!=b.get('versions',{}).get(version):raise ValueError('cannot compare runs with different '+version)
            aa=pd.DataFrame(a['ledger']).sort_values(['year_ce','prov_code']).reset_index(drop=True);bb=pd.DataFrame(b['ledger']).sort_values(['year_ce','prov_code']).reset_index(drop=True)
            if not aa[['year_ce','prov_code']].equals(bb[['year_ce','prov_code']]):raise ValueError('run province-year domains differ')
            yr=sorted(aa.year_ce.unique());n=len(aa)//len(yr)
            xa=aa.new_appointments_accepted_starts.to_numpy().reshape(len(yr),n);xb=bb.new_appointments_accepted_starts.to_numpy().reshape(len(yr),n)
            na=pd.DataFrame(a['national_balance']).set_index('year_ce').loc[yr];nb=pd.DataFrame(b['national_balance']).set_index('year_ce').loc[yr]
            A=na.available.to_numpy();B=nb.available.to_numpy();same=np.array_equal(A,B)
            sw,pct=EV.switches(xa,xb,na.unplaced_balance.to_numpy(),nb.unplaced_balance.to_numpy(),A) if same else (np.full(len(yr),np.nan),np.full(len(yr),np.nan))
            rows=aa[['year_ce','year_be','prov_code','province']].copy();rows['appointments_difference']=xb.ravel()-xa.ravel();rows['cumulative_appointments_difference']=np.cumsum(xb-xa,axis=0).ravel();rows['closing_stock_difference']=bb.expected_closing_stock.to_numpy()-aa.expected_closing_stock.to_numpy()
            pairs.append({'run_a':a['run_id'],'run_b':b['run_id'],'difference_direction':'B minus A','same_annual_pool':same,'annual_switches':[{'year_ce':int(y),'switches':sw[t],'percent_of_pool':pct[t],'annual_supply_difference':B[t]-A[t]} for t,y in enumerate(yr)],'cumulative_switches':float(sw.sum()) if same else None,'rows':rows,'metric_comparison_note':'compare the same criterion; scenario changes may also change the common criterion target path',**appointment_priority(aa,bb)})
    common_metrics=[]
    if runs:
        reference=runs[0]
        ref=pd.DataFrame(reference['ledger']).sort_values(['year_ce','prov_code']).reset_index(drop=True)
        idx=ref.rename(columns={'year_ce':'year','population_civil':'population'})
        years=sorted(ref.year_ce.unique());n=len(ref)//len(years)
        k=reference['resolved_config']['parameters']['targets.reference_per_1000']/1000
        pop=ref.population_civil.to_numpy().reshape(len(years),n)
        region=ref[ref.year_ce==years[0]].health_region.to_numpy()
        for run_ in runs:
            rr=pd.DataFrame(run_['ledger']).sort_values(['year_ce','prov_code']).reset_index(drop=True)
            H=rr.expected_closing_stock.to_numpy().reshape(len(years),n)
            for crit in ['P','S','N']:
                T=R.targets(idx,'D_'+crit,'common_total',k,2025).to_numpy().reshape(len(years),n)
                mm=EV.trajectory_metrics(run_['plan_id'],crit+'|common_total',H,T,years,region,pop)
                mm['run_id']=run_['run_id'];mm['reference_run_id']=reference['run_id'];mm['common_reference']=True
                common_metrics.append(mm)
    return clean({'schema_version':'workforce-lab.comparison/1','pairs':pairs,
                  'reference_run_id':runs[0]['run_id'] if runs else None,
                  'metrics':pd.concat(common_metrics,ignore_index=True) if common_metrics else [],
                  'criteria_note':'All stocks are re-evaluated against the FIRST run’s population, service and M5 target paths and target weights, including its reference density.'})

def compare_json(runs_json): return dumps(compare_runs(json.loads(runs_json)))

def stochastic_evaluation(ctx,p,pb,sol,inputs,progress=None):
    """Paired fixed-schedule futures using the canonical empirical distributions.

    The announced integer decisions remain fixed. Realised caps/protection may
    fail and cancellations are reported. No stochastic bands are fabricated from
    the deterministic policy envelope.
    """
    from . import uncertainty as U
    n=int(p['uncertainty.draws']);seed=int(p['uncertainty.seed']);components=p['uncertainty.components']
    back=pd.DataFrame(inputs['population_backtest']).set_index('method').loc['hamilton_perry_national_control']
    sigp=float(back.mape_total_pct)/100*np.sqrt(np.pi/2)/np.sqrt(6);sign=abs(float(back.national_76_error_pct))/100/np.sqrt(6)
    mode='adaptive_replanning' if p['planning.mode']=='annual_replanning' else 'fixed_schedule'
    _notify(progress,'simulating',requested_draws=n,seed=seed,components=components,mode=mode)
    # Use an identical pooled draw stream for every scenario, then apply the
    # requested national-rate sensitivity. This preserves common random futures.
    pooled=copy.copy(ctx);pooled.departures=SU.Departures(ctx.rates,ctx.provs,national=False)
    draws=SIM.make_draws(pooled,n,seed,sigp,sign)
    he=-np.log1p(-draws.d)
    parts={c:he*draws.shares[c] for c in SU.EXIT}
    if p['departures.rate_source']=='national':parts={c:np.broadcast_to(ctx.departures.h[c],(n,76)) for c in SU.EXIT}
    hm=spatial_path(p,'departures.hazard_multiplier',ctx.provs,ctx.region)[None]
    h={c:parts[c][:,None,:]*hm for c in SU.EXIT}
    start=int(p['retention.start_year']+p['retention.lag_years']);ramp=int(p['retention.ramp_years'])
    effect=np.array([0 if y<start else min(1,(y-start+1)/ramp) if ramp else 1 for y in YEARS])[None,:,None]
    reduction=spatial_path(p,'retention.resignation_reduction',ctx.provs,ctx.region)[None]
    coverage=spatial_path(p,'retention.coverage',ctx.provs,ctx.region)[None]
    h['resignation']=h['resignation']*(1-reduction*coverage*effect)
    draws.d=1-np.exp(-sum(h.values()));draws.r=draws.r[:,None,:]*spatial_path(p,'departures.reentry_multiplier',ctx.provs,ctx.region)[None]
    if components=='flow':draws.pop_mult=np.ones_like(draws.pop_mult)
    routes=SIM.routes_table(ctx,specification(p),pb,sol.zin,sol.zout)
    if mode=='adaptive_replanning':
        from .lab_adaptive import adaptive_paths
        simulated=adaptive_paths(ctx,p,pb,draws,progress)
        complete=simulated['completed_mask']
    else:
        simulated=SIM.simulate_fixed(ctx,pb,sol.x,sol.zin,sol.zout,routes,draws)
        complete=np.ones(n,bool)
    completed=int(complete.sum())
    H=simulated['H'].astype(float);rows=[];summary=[];bands=[];province=[]
    for crit in ['P','S','N']:
        if crit=='N' and components!='flow_demography_m5':
            boot=ctx.pkg['boot'];ctx.pkg['boot']={o:np.repeat(ctx.pkg['beta'][o][None],len(boot[o]),axis=0) for o in boot}
            T,invalid=U.path_targets(ctx,draws,crit);ctx.pkg['boot']=boot
        else:T,invalid=U.path_targets(ctx,draws,crit)
        valid=(~invalid)&complete;nv=int(valid.sum())
        if nv:
            mm=U.path_metrics(H[valid],T[valid],ctx.region)
            for k,values in mm.items():
                summary.append({'criterion':crit+'|common_total','metric':k,'completed_draws':completed,'attempted_draws':n,'valid_draws':nv,'invalid_draws':n-nv,'invalid_target_draws':int((invalid&complete).sum()),'failed_simulation_draws':n-completed,'q025':float(np.quantile(values,.025)),'median':float(np.median(values)),'q975':float(np.quantile(values,.975))})
            for j,path in enumerate(np.flatnonzero(valid)):rows.append({'criterion':crit+'|common_total','draw':int(path),**{k:v[j] for k,v in mm.items()}})
            for t,y in enumerate(YEARS):
                for name,values in [('total_stock',H[valid,t].sum(1)),('national_attainment',H[valid,t].sum(1)/T[valid,t].sum(1))]:bands.append({'criterion':crit+'|common_total','year_ce':y,'metric':name,'q025':float(np.quantile(values,.025)),'median':float(np.median(values)),'q975':float(np.quantile(values,.975)),'valid_draws':nv})
            for i,code in enumerate(ctx.provs):
                meets=H[valid,:,i]>=T[valid,:,i]
                province.append({'criterion':crit+'|common_total','prov_code':int(code),'province':ctx.names[code],'valid_draws':nv,'probability_meeting_2040':float(meets[:,-1].mean()),'probability_meeting_at_least_once':float(meets.any(axis=1).mean()),'probability_sustained_from_2035':float(meets[:,YEARS.index(2035):].all(axis=1).mean())})
        else:summary.append({'criterion':crit+'|common_total','valid_draws':0,'invalid_draws':n,'completed_draws':completed,'failed_simulation_draws':n-completed,'reason':'no completed path has a valid target for this criterion; no interval reported'})
    return clean({'enabled':True,'mode':mode,'requested_draws':n,'attempted_draws':n,'completed_draws':completed,'failed_draws':n-completed,'draw_status':simulated.get('draw_status',[]),'seed':seed,'components':components,'paired_random_paths':True,'draw_stream_id':digest({'seed':seed,'n':n,'inputs':inputs['sources']}),'rows':rows,'summary':summary,'bands':bands,'province_probabilities':province,'diagnostics':{'cancelled_transfers_total':int(simulated['cancelled'].sum()),'paths_with_cancelled_transfers':int((simulated['cancelled'].sum(1)>0).sum()),'paths_with_cap_breaches':int(simulated['cap_breach'].any(axis=(1,2)).sum()),'province_year_cap_breaches':int(simulated['cap_breach'].sum()),'paths_with_origin_protection_breaches':int(simulated['protection_breach'].any(axis=(1,2)).sum()),**simulated.get('diagnostics',{})},'methods':'Paired Gamma-Poisson flow parameters, binomial exits, Poisson reentries, backtest-calibrated cumulative population errors, and optional paired province-cluster M5 coefficient draws. In adaptive mode, pooled estimates update only from previously observed events and population context; future realizations never enter the annual decision. Failed paths and nonpositive M5 targets are invalid, not zeros. Intervals are conditional simulation quantiles, not confidence intervals for a policy effect.'})
