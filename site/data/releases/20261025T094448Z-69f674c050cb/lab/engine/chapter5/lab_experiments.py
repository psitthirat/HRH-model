"""Transparent equal-weight scenario summaries using canonical common metrics.

Scenarios are not assigned forecast probabilities. Regret is calculated within
each future among the selected policies, separately for every named metric.
"""
from __future__ import annotations
import json
import math
from statistics import mean

METRICS={'gini':'lower','shortfall_sum':'lower','gap_spatial':'lower',
         'national_attainment':'higher','bottom_quartile_attainment':'higher'}

def summarize(items, limits=None):
    from .lab_adapter import compare_runs
    if not isinstance(items,list) or not items:raise ValueError('A completed experiment matrix is required')
    policies=list(dict.fromkeys(x['policy_id'] for x in items));futures=list(dict.fromkeys(x['future_id'] for x in items))
    keys=[(x['policy_id'],x['future_id']) for x in items]
    if len(set(keys))!=len(keys):raise ValueError('Duplicate policy/future combination')
    expected={(p,f) for p in policies for f in futures}
    if set(keys)!=expected:raise ValueError('Incomplete policy × future matrix; no average may hide missing scenarios')
    if any(x['result'].get('status') not in {'completed','feasible_incumbent'} or not x['result'].get('ledger') for x in items):
        raise ValueError('Every policy/future combination must have a completed feasible result')
    limits=limits or {}
    allowed={'minimum_worst_attainment','maximum_annual_transfers'}
    if set(limits)-allowed:raise ValueError('Unknown acceptance limit')
    for name,value in limits.items():
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
            raise ValueError('Acceptance limits must be finite nonnegative numbers')
    assessments=[]
    cells=[];reference_versions=items[0]['result'].get('versions',{})
    for item in items:
        for field in ('engine_version','inputs_version','metric_definition_version','metric_definition_hash'):
            if item['result'].get('versions',{}).get(field)!=reference_versions.get(field):raise ValueError('Experiment versions differ: '+field)
    for future in futures:
        group=[x for x in items if x['future_id']==future]
        analysis=compare_runs([x['result'] for x in group])
        names={x['result']['run_id']:x['policy_id'] for x in group}
        runs={x['result']['run_id']:x['result'] for x in group}
        year=max(row['year_ce'] for row in analysis['metrics'])
        for row in analysis['metrics']:
            if row['year_ce']!=year:continue
            if limits:
                run=runs[row['run_id']];transfers={}
                for entry in run['ledger']:
                    transfers[entry['year_ce']]=transfers.get(entry['year_ce'],0)+entry['transfers_in_planned']
                maximum=max(transfers.values())
                worst=row['worst_attainment']
                tests={}
                if 'minimum_worst_attainment' in limits:tests['minimum_worst_attainment']=worst>=limits['minimum_worst_attainment']
                if 'maximum_annual_transfers' in limits:tests['maximum_annual_transfers']=maximum<=limits['maximum_annual_transfers']
                assessments.append({'policy_id':names[row['run_id']],'future_id':future,'run_id':row['run_id'],
                    'criterion':row['criterion'],'year_ce':year,'worst_attainment':worst,
                    'maximum_annual_transfers':maximum,'passes':all(tests.values()),'checks':tests})
            for metric,direction in METRICS.items():
                value=row.get(metric)
                if not isinstance(value,(int,float)) or not math.isfinite(value):raise ValueError('Unavailable metric in completed matrix: '+metric)
                cells.append({'policy_id':names[row['run_id']],'future_id':future,'run_id':row['run_id'],
                    'reference_run_id':analysis['reference_run_id'],'year_ce':year,'criterion':row['criterion'],
                    'metric':metric,'direction':direction,'value':value})
    for row in cells:
        values=[r['value'] for r in cells if (r['future_id'],r['criterion'],r['metric'])==(row['future_id'],row['criterion'],row['metric'])]
        optimum=min(values) if row['direction']=='lower' else max(values)
        row['regret']=row['value']-optimum if row['direction']=='lower' else optimum-row['value']
    summary=[]
    for policy in policies:
        for criterion in dict.fromkeys(r['criterion'] for r in cells):
            for metric,direction in METRICS.items():
                selected=[r for r in cells if (r['policy_id'],r['criterion'],r['metric'])==(policy,criterion,metric)]
                if len(selected)!=len(futures):raise ValueError('Metrics are not aligned across all futures')
                worst=(max if direction=='lower' else min)(selected,key=lambda r:r['value'])
                summary.append({'policy_id':policy,'criterion':criterion,'metric':metric,'direction':direction,
                    'mean':mean(r['value'] for r in selected),'worst':worst['value'],'worst_future':worst['future_id'],
                    'mean_regret':mean(r['regret'] for r in selected),'maximum_regret':max(r['regret'] for r in selected),
                    'futures':len(futures),'year_ce':selected[0]['year_ce']})
    return {'schema_version':'workforce-lab.experiment-summary/1','weighting':'equal weight across selected futures; not forecast probabilities',
        'comparison':'Within each future, re-evaluate all policies against the first selected policy’s common P/S/N targets.',
        'regret':'Difference from the best selected policy in the same future and criterion; metric-specific, no composite policy score.',
        'policies':policies,'futures':futures,'cells':cells,'summary':summary,
        'acceptance_limits':limits,'acceptance_checks':assessments,
        'acceptance_by_policy':[{'policy_id':policy,'criterion':criterion,
            'passes_all_futures':all(r['passes'] for r in assessments if r['policy_id']==policy and r['criterion']==criterion)}
            for policy in policies for criterion in dict.fromkeys(r['criterion'] for r in assessments)],
        'acceptance_note':'Worst-province attainment at the final year; maximum national planned transfers in any decision year. Screening among selected candidates, not global optimality or verified affordability.'}

def summarize_json(items_json):
    payload=json.loads(items_json)
    result=summarize(payload) if isinstance(payload,list) else summarize(payload['items'],payload.get('limits'))
    return json.dumps(result,ensure_ascii=False,allow_nan=False,separators=(',',':'))
