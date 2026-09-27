// Shared-chart adapter. All research measures arrive from the canonical Python
// result; this module only selects, renames, pivots and sums additive ledger rows.
import { h, clear } from '../util/dom.js';
import { mountView } from '../engine.js';
import { num, be } from '../util/format.js';
import { toCSV, download } from '../ui/table.js';
import { allocationFigureRows } from '../charts/alloc.js';

export const RUN_SCHEMA = 'workforce-lab.run/1';
const CORE_VIEWS=new Set(['stock_flow','allocations','stock_trajectory','adequacy_trajectory','common_gini','bottom_group','supply_gap','province_trajectory','cross_evaluation','constraint_diagnostics','province_comparison']);
const L = (lang, th, en) => lang === 'en' ? en : th;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => structuredClone(value);
const pick = (row, ...keys) => keys.map(key => row?.[key]).find(value => value !== undefined && value !== null) ?? null;
export const runLedger = run => run.ledger || [];
export const runMetrics = run => run.metrics || [];
export const runBalance = run => run.national_balance || [];
export const plansOf = run => [...new Set(runLedger(run).map(row => row.plan_id))];
export const yearsOf = run => [...new Set(runLedger(run).map(row => Number(row.year_ce)))].sort((a,b) => a-b);
const provinceName=(R,code,lang)=>lang==='en'?(R.provinces.get(String(code))?.name_en||R.provinceName(code)):R.provinceName(code);
export const resultTitle = (run, lang='th') => run.config?.name || run.config?.title || run.title || run.resolved_config?.title || L(lang,'ผลการทดลองแผนจัดสรร','Allocation experiment');
export const isCompleted = run => ['completed','optimal','feasible','feasible_incumbent','presentation_cache','cached'].includes(run.status) && runLedger(run).length > 0;

export function outcomeRegistry(lab) {
  const value = lab?.outcome_registry || lab?.registry?.outcomes || lab?.manifest?.outcome_registry;
  if (!value?.views || !value?.metrics) throw new Error('Missing versioned outcome registry for this release');
  return value;
}
export function assertResult(run, lab) {
  if (run.schema_version !== RUN_SCHEMA) throw new Error(`Unsupported Lab result schema: ${run.schema_version}`);
  const registry = outcomeRegistry(lab);
  const metricVersion = run.versions?.metric_definition_version || run.versions?.metric_version;
  if (metricVersion && metricVersion !== registry.metric_definition_version) throw new Error('Metric definitions changed. Reload compatible definitions or calculate this scenario again.');
  for (const key of ['metric_definition_hash','view_definition_hash']) {
    const expected=registry[key] || lab.versions?.[key] || lab.manifest?.versions?.[key];
    if(expected && run.versions?.[key] && expected!==run.versions[key]) throw new Error(`${key} changed. Reload compatible definitions or calculate this scenario again.`);
  }
  return registry;
}
function pack(rows, meta={}) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return { columns, rows: rows.map(row => columns.map(key => row[key] ?? null)), meta: { central_variant:{}, ...meta }, sources:[] };
}
function planLabel(R, key, lang) {
  for (const scene of R.scenes) for (const step of scene.steps || []) {
    const plan = step.view?.plans?.find?.(p => p.key === key);
    if (plan && lang !== 'en') return plan.label || plan.title || key;
  }
  const en={'P-R':'P-R · Population','S-R':'S-R · Services','N-R':'N-R · Reference need','P-RT':'P-RT · Population + transfers','S-RT':'S-RT · Services + transfers','N-RT':'N-RT · Reference need + transfers','SQ-C':'SQ-C · Historical recruitment shares','NFB0.5-R':'N-FB · Half response','NFB1-R':'N-FB · Full response'};
  return en[key] || key;
}
export function runSummary(run, lang='th') {
  const years=yearsOf(run), plans=plansOf(run), plan=plans[0];
  const populationCriterion=commonCriteria(runMetrics(run)).find(c=>c.startsWith('P|'));
  const metrics=runMetrics(run).filter(r=>r.plan_id===plan && r.criterion===populationCriterion).sort((a,b)=>a.year_ce-b.year_ce);
  const first=metrics[0], last=metrics.at(-1);
  if (!first || !last) return L(lang,'ผลขึ้นกับสมมติฐานและขอบเขตของแผนนี้','Results are conditional on this scenario and its scope.');
  const direction=last.gini-first.gini;
  const gini = !finite(direction) ? '' : L(lang, ` Gini ตามประชากร${Math.abs(direction)<1e-10?'คงเดิม':direction<0?'ลดลง':'เพิ่มขึ้น'}จาก ${num(first.gini,3)} เป็น ${num(last.gini,3)}`, ` Population-based Gini ${Math.abs(direction)<1e-10?'is unchanged':direction<0?'decreases':'increases'} from ${num(first.gini,3)} to ${num(last.gini,3)}.`);
  return L(lang, `${plan} มีแพทย์คงอยู่ปลาย พ.ศ. ${be(years.at(-1))} ประมาณ ${num(last.total_stock,0)} คน อัตราส่วนต่อเป้าหมายประชากร ${num(last.national_attainment,3)}.${gini}`, `${plan} has approximately ${num(last.total_stock,0)} physicians at the end of ${years.at(-1)}, with population-target attainment ${num(last.national_attainment,3)}.${gini}`);
}
function liveSpec(R, datasets, component) {
  for (const scene of R.scenes) for (const step of scene.steps || []) if (datasets.includes(step.view?.dataset) && (!component || step.view.component===component)) return clone(step.view);
  return {};
}
export function selectedRuns(run,options={}) {
  return [...new Map([run,...(options.comparisonRuns||[])].filter(isCompleted).map(r=>[r.run_id,r])).values()];
}
export function parameterDifferences(run,options={}) {
  const runs=selectedRuns(run,options),keys=[...new Set(runs.flatMap(r=>Object.keys(r.resolved_config?.parameters||r.config?.parameters||{})))];
  return keys.filter(key=>new Set(runs.map(r=>JSON.stringify((r.resolved_config?.parameters||r.config?.parameters||{})[key]))).size>1).flatMap(parameter_id=>runs.map(r=>({run_id:r.run_id,scenario:resultTitle(r,options.lang),parameter_id,value:JSON.stringify((r.resolved_config?.parameters||r.config?.parameters||{})[parameter_id]??null)})));
}
export function resultTables(run, lab, options={}) {
  const registry=outcomeRegistry(lab);
  const pair=options.comparisonAnalysis, pairRows=field=>(pair?.pairs||[]).flatMap(p=>(p[field]||[]).map(r=>({reference_run_id:p.run_a,comparison_run_id:p.run_b,same_annual_pool:p.same_annual_pool,...r})));
  const contexts=Object.fromEntries(Object.entries(run.context_tables||{}).filter(([,rows])=>Array.isArray(rows)).map(([kind,rows])=>['Context_'+kind,rows]));
  return { Annual_Plan:runLedger(run), Transfers:run.transfers || [], National_Balance:runBalance(run), National_Outcomes:runMetrics(run), Province_Outcomes:run.province_outcomes || runLedger(run), Attainment_Years:run.attainment_years||[], Comparison:run.comparison?.rows || (Array.isArray(run.comparison)?run.comparison:[]), Destination_Changes:run.comparison?.annual_switches||[], Pinned_Outcomes:pair?.metrics||[], Pinned_Differences:pairRows('rows'), Pinned_Destinations:pairRows('annual_switches'), Pinned_Priorities:pairRows('priority_rows'), Pinned_Overlap:pairRows('priority_overlap'), Parameter_Differences:parameterDifferences(run,options), Uncertainty_Summary:run.uncertainty?.summary||[], Uncertainty_Bands:run.uncertainty?.bands||[], Province_Probabilities:run.uncertainty?.province_probabilities||[], ...contexts, Definitions:registry.metrics, Diagnostics:Array.isArray(run.diagnostics)?run.diagnostics:Object.entries(run.diagnostics || {}).map(([item,value])=>({item,value:typeof value==='object'?JSON.stringify(value):value})) };
}
export function createRunRelease(run, release, lab, lang='th') {
  const registry=assertResult(run,lab), years=yearsOf(run), plans=plansOf(run);
  const allocation=runLedger(run).map(r=>({ plan:r.plan_id,year:Number(r.year_ce),prov_code:String(r.prov_code),province:r.province,
    x:r.new_appointments_accepted_starts,opening:r.opening_headcount,departures:r.expected_departures_total,reentries:r.expected_reentries,
    closing:r.expected_closing_stock,attainment_pop:r.attainment_P,cap_binding:r.cap_binding,floor_only:r.floor_binding===true && r.cap_binding===false }));
  const national=runBalance(run).map(r=>({ ...r,plan:r.plan_id,year:Number(r.year_ce),stock:pick(r,'closing_stock','expected_closing_stock'),target:pick(r,'target_own','total_target') }));
  for(const plan of plans){const first=national.filter(r=>r.plan===plan).sort((a,b)=>a.year-b.year)[0];if(first)national.push({plan,plan_id:plan,year:first.year-1,stock:first.opening_stock,target:null,data_kind:'baseline_opening'});}
  national.sort((a,b)=>a.year-b.year);
  const metrics=runMetrics(run).map(r=>({...r,plan:r.plan_id,year:Number(r.year_ce)}));
  const wide=new Map();
  for(const r of metrics){const key=`${r.year}|${r.criterion}`;if(!wide.has(key))wide.set(key,{year:r.year,criterion:r.criterion});const row=wide.get(key);for(const field of ['gini','bottom_quartile_attainment','national_attainment','shortfall_sum','gap_national','gap_spatial','worst_attainment'])row[`${field}__${r.plan}`]=r[field];}
  const provincial=runLedger(run).map(r=>({...r,plan:r.plan_id,year:Number(r.year_ce),prov_code:String(r.prov_code),stock:r.expected_closing_stock,target:r.target_own}));
  const meta={scope:run.methods?.scope || registry.metrics[0].workforce_scope,evidence:'scenario',years:[years[0],years.at(-1)],run_id:run.run_id,metric_definition_version:registry.metric_definition_version,notes:[L(lang,'ผลการทดลองภายใต้สมมติฐาน ไม่ใช่คำสั่งจัดสรร','Conditional planning experiment, not an approved allocation')]};
  const R=Object.create(release);
  R.id=run.run_id;R._rows=new Map();R.bundle={...release.bundle,facts:{},datasets:{provinces:release.ds('provinces'),lab_alloc:pack(allocation,meta),lab_national:pack(national,meta),lab_metrics:pack(metrics,meta),lab_wide:pack([...wide.values()],meta),lab_province:pack(provincial,meta)}};
  R.run=run;R.labRegistry=registry;R.labPlans=plans.map((key,i)=>({key,label:planLabel(release,key,lang),short:key,color:`series:${i%3+1}`}));
  R.addDataset=(id,rows)=>{R.bundle.datasets[id]=pack(rows,meta);R._rows.delete(id);};
  return R;
}
function scopeText(run,registry,lang) { return lang==='en' ? (run.methods?.scope || registry.metrics[0].workforce_scope+'; study provinces exclude Bangkok')+' · chart years: B.E.; table year_ce: C.E.' : 'แพทย์สังกัด สธ. ใช้แทนขอบเขต สป.สธ. ชั่วคราว · 76 จังหวัด ไม่รวมกรุงเทพมหานคร'; }
function unitLabel(registry,id,lang){const m=registry.metrics.find(m=>m.metric_id===id);return m?.[lang==='en'?'display_unit_en':'display_unit_th']||L(lang,'คน','Persons');}
function definition(registry,id,lang){const m=registry.metrics.find(m=>m.metric_id===id);return m?.[lang==='en'?'label_en':'label_th'] || id;}
function commonCriteria(rows){const all=[...new Set(rows.map(r=>r.criterion).filter(c=>/^[PSN]\|/.test(String(c))))];const common=all.filter(c=>c.endsWith('|common_total'));return common.length?common:all;}
function flowRows(row,{province=false,lang='th',name=''}){
  const list=province?[
    ['start',pick(row,'opening_headcount'),'แพทย์ต้นปี','Opening'],['minus',pick(row,'expected_departures_total'),'ผู้ที่ออก','External exits'],['plus',pick(row,'expected_reentries'),'กลับเข้า','Other entries'],['plus',pick(row,'new_appointments_accepted_starts'),'รับใหม่','Appointments'],['plus',pick(row,'transfers_in_planned'),'โอนเข้า','Transfers in'],['minus',pick(row,'transfers_out_planned'),'โอนออก','Transfers out'],['end',pick(row,'expected_closing_stock'),'แพทย์ปลายปี','Closing']
  ]:[['start',pick(row,'opening_stock'),'แพทย์ต้นปี','Opening'],['minus',pick(row,'expected_departures'),'ผู้ที่ออก','External exits'],['plus',pick(row,'expected_reentries'),'กลับเข้า','Other entries'],['plus',pick(row,'new_appointments'),'รับใหม่','Appointments'],['end',pick(row,'closing_stock'),'แพทย์ปลายปี','Closing']];
  return list.map(([kind,value,th,en],order)=>({kind,order,item_label:L(lang,th,en),value:finite(value)?(kind==='minus'?-value:value):null,example_label:name}));
}
function simulationDiagnostics(run,lang){const u=run.uncertainty,d=u?.diagnostics;if(!d)return '';return L(lang,`ข้อจำกัดของแผนตั้งต้นกับผลจำลองเป็นคนละการตรวจ: ${num(d.paths_with_cap_breaches,0)} รอบมีจังหวัดเกินเพดาน (${num(d.province_year_cap_breaches,0)} จังหวัด–ปี) การโอนที่ยกเลิก ${num(d.cancelled_transfers_total,0)} เหตุการณ์; รอบที่ต่ำกว่าเงื่อนไขคุ้มครองต้นทาง ${num(d.paths_with_origin_protection_breaches,0)}`,`Deterministic plan checks and simulated-path checks are distinct: ${num(d.paths_with_cap_breaches,0)} paths breach a provincial cap (${num(d.province_year_cap_breaches,0)} province-years); ${num(d.cancelled_transfers_total,0)} transfer events are cancelled; ${num(d.paths_with_origin_protection_breaches,0)} paths breach origin protection.`);}
export function buildOutcomeViews(run,options,state={}) {
  const {release,lab,lang='th'}=options;
  const registry=assertResult(run,lab), R=createRunRelease(run,release,lab,lang), years=yearsOf(run), plans=plansOf(run);
  const plan=plans.includes(state.plan)?state.plan:plans[0], year=Number(state.year)||years[0];
  const candidate=String(state.province || (Array.isArray(options.initialProvince)?options.initialProvince[0]:options.initialProvince) || '');
  const province=runLedger(run).some(r=>String(r.prov_code)===candidate)?candidate:String(runLedger(run)[0]?.prov_code||'');
  const criteria=commonCriteria(runMetrics(run));
  const criterion=criteria.includes(state.criterion)?state.criterion:criteria.find(x=>x.startsWith('P|'))||criteria[0];
  const viewList=[], sharedLabels=Object.fromEntries(registry.views.map(v=>[v.view_id,v]));
  const add=(id,spec,rows,caption,options={})=>{const contract=sharedLabels[id];if(!contract){if(CORE_VIEWS.has(id))throw new Error(`Outcome view missing from registry: ${id}`);return;}const meanings=contract.metric_ids.map(id=>registry.metrics.find(m=>m.metric_id===id)).filter(Boolean);const period=['cross_evaluation','feedback_evaluation','pinned_comparison','pinned_gini'].includes(id)?String(lang==='en'?years.at(-1):be(years.at(-1))):id==='stock_flow'||id==='allocations'?String(lang==='en'?year:be(year)):`${lang==='en'?years[0]:be(years[0])}–${lang==='en'?years.at(-1):be(years.at(-1))}`;viewList.push({id,title:contract[lang==='en'?'label_en':'label_th'],spec,rows,caption,contract,interpretation:meanings,period,unit:[...new Set(meanings.map(m=>m.unit))].join(' / '),scope:scopeText(run,registry,lang),...options});};
  const national=R.rows('lab_national').filter(r=>r.plan===plan), selected=national.find(r=>r.year===year);
  const balanceRows=selected?flowRows(selected,{lang,name:`${plan} · ${lang==='en'?year:be(year)}`}):[];
  R.addDataset('lab_flow',balanceRows);
  add('stock_flow',{component:'waterfall',dataset:'lab_flow',value:'value'},balanceRows,L(lang,'การออก การกลับเข้า และจำนวนคงอยู่เป็นค่าคาดหมาย การรับใหม่และโยกย้ายเป็นจำนวนเต็ม การโยกย้ายภายในระบบหักล้างกันในระดับรวม','Departures, other entries and stocks are expectations; appointments and moves are integers. Internal transfers cancel nationally.'));
  const provinceLedger=runLedger(run).filter(r=>r.plan_id===plan&&String(r.prov_code)===province),provinceSelected=provinceLedger.find(r=>Number(r.year_ce)===year);
  const provincialFlow=provinceSelected?flowRows(provinceSelected,{province:true,lang,name:`${provinceName(release,province,lang)} · ${lang==='en'?year:be(year)}`}):[];R.addDataset('lab_province_flow',provincialFlow);
  add('province_flow',{component:'waterfall',dataset:'lab_province_flow',value:'value'},provincialFlow,`${provinceName(release,province,lang)} · ${L(lang,'แยกโอนเข้าและโอนออกจากการรับใหม่และการออกนอกระบบ','Transfers are separate from new appointments and external departures.')}`,{period:String(lang==='en'?year:be(year))});
  add('national_balance',null,runBalance(run).filter(r=>r.plan_id===plan),L(lang,'จำนวนรับใหม่ที่จัดสรรแล้วและจำนวนที่ยังไม่จัดสรรรวมกันเท่ากับจำนวนที่มีให้จัดสรร การโอนระหว่างจังหวัดนับหนึ่งครั้งต่อการย้ายหนึ่งเหตุการณ์','Allocated plus unplaced appointments reconcile to available supply. National transfers are counted once per movement event.'),{columns:['year_ce','opening_stock','available','new_appointments','unplaced_balance',...(runBalance(run).some(r=>r.population_protected_appointments!=null)?['population_protected_appointments']:[]),'expected_departures','expected_reentries','transfers_counted_once','closing_stock','reconciliation_difference']});
  const allocationSpec=liveSpec(release,['c5_alloc'],'alloc');
  add('allocations',{...allocationSpec,component:'alloc',dataset:'lab_alloc',plan,year:state.cumulative?'all':year,plans:R.labPlans,banner:null},allocationFigureRows(R.rows('lab_alloc'),R.labPlans,plan,state.cumulative?'all':year),L(lang,'เลือกปีเพื่อดูจำนวนรับใหม่ หรือรวมทุกปีเพื่อดูยอดสะสม จำนวนคงอยู่ใน tooltip ใช้ปลายช่วง','Select a year or cumulative appointments. Closing stock in cumulative tooltips refers to the final year.'),{selection:{plan,year:state.cumulative?'all':year},period:state.cumulative?`${lang==='en'?years[0]:be(years[0])}–${lang==='en'?years.at(-1):be(years.at(-1))}`:String(lang==='en'?year:be(year))});
  const nationalTemplate=liveSpec(release,['c5_national'],'lines');
  const line=(ys,extra={})=>({...nationalTemplate,component:'lines',dataset:'lab_national',x:'year',ys,filter:{plan},reveal:null,banner:null,marks:[],ref:[],...extra});
  add('stock_trajectory',line([{col:'stock',label:definition(registry,'closing_stock',lang),color:'series:1'},{col:'target',label:definition(registry,'target',lang),color:'neutral'}],{y_label:unitLabel(registry,'closing_stock',lang),y_zero:true}),national,L(lang,'เส้นเป้าหมายใช้กติกาของแผนที่เลือก ไม่ใช่มาตรฐานความเพียงพอที่ได้รับการรับรอง','The selected plan’s declared target is illustrative, not an officially validated staffing standard.'),{period:`${lang==='en'?years[0]-1:be(years[0]-1)}–${lang==='en'?years.at(-1):be(years.at(-1))}`});
  const wide=R.rows('lab_wide');
  const ysFor=field=>R.labPlans.map(p=>({col:`${field}__${p.key}`,label:p.label,color:p.color}));
  const metricSpec=(field,label,facet=true)=>({component:'lines',dataset:'lab_wide',x:'year',ys:ysFor(field),y_label:label,y_zero:true,...(facet?{facet:'criterion',facet_labels:Object.fromEntries(criteria.map(c=>{const k=c.split('|')[0];return [c,registry.criteria?.[k]?.[lang==='en'?'label_en':'label_th']||c];})),filter:{criterion:criteria},y_shared:true}:{filter:{criterion}})});
  const caption=L(lang,'ทุกเส้นในแต่ละกราฟใช้เกณฑ์และน้ำหนักชุดเดียวกัน ค่าต่ำของ Gini ไม่ได้ยืนยันว่าจำนวนแพทย์ถึงเป้าหมาย','All plans in each panel share its criterion and target weights. Low Gini does not imply target attainment.');
  add('adequacy_trajectory',metricSpec('national_attainment',definition(registry,'attainment',lang),false),wide.filter(r=>r.criterion===criterion),L(lang,'อัตราส่วนของผลรวมแพทย์ต่อผลรวมเป้าหมาย ไม่ใช่ค่าเฉลี่ยจังหวัดแบบไม่ถ่วงน้ำหนัก','Ratio of national stock to national target, not an unweighted mean of provincial ratios.'));
  add('common_gini',metricSpec('gini',definition(registry,'gini',lang)),wide.filter(r=>criteria.includes(r.criterion)),caption);
  add('bottom_group',metricSpec('bottom_quartile_attainment',definition(registry,'bottom19',lang)),wide.filter(r=>criteria.includes(r.criterion)),L(lang,'เลือกจังหวัดหนึ่งในสี่ที่อัตราส่วนต่ำสุดใหม่ในแต่ละปี แผน และเกณฑ์ แล้วหารผลรวมแพทย์ด้วยผลรวมเป้าหมายของกลุ่ม','The lowest quarter is reselected per year, plan and criterion; group attainment is a ratio of sums.'));
  const gapRows=R.rows('lab_metrics').filter(r=>r.plan===plan && r.criterion===criterion);
  add('supply_gap',{component:'lines',dataset:'lab_metrics',x:'year',filter:{plan,criterion},ys:[{col:'gap_national',label:definition(registry,'gap_national',lang),color:'series:1'},{col:'gap_spatial',label:definition(registry,'gap_spatial',lang),color:'series:2'}],y_label:unitLabel(registry,'closing_stock',lang),y_zero:true},gapRows,L(lang,'แยกส่วนขาดรวมของระบบออกจากส่วนขาดเพิ่มที่เกิดจากการกระจาย ใช้นิยามเดียวกับบทวิเคราะห์','National supply gap and additional spatial mismatch use the canonical Chapter 5 decomposition.'));
  const provinceRows=R.rows('lab_province').filter(r=>r.plan===plan&&r.prov_code===province);
  add('province_trajectory',{component:'lines',dataset:'lab_province',x:'year',filter:{plan,prov_code:province},ys:[{col:'stock',label:definition(registry,'closing_stock',lang),color:'series:1'},{col:'target',label:definition(registry,'target',lang),color:'neutral'}],y_label:unitLabel(registry,'closing_stock',lang),y_zero:true},provinceRows,`${provinceName(release,province,lang)} · ${L(lang,'ใช้แพทย์ปลายปีและเป้าหมายของแผนเดียวกัน ตรวจข้อจำกัดจริงในตารางบัญชีจังหวัด','Closing stock and the selected plan’s target; actual binding constraints are in the province ledger.')}`);
  add('province_ledger',null,provinceLedger,`${provinceName(release,province,lang)} · ${L(lang,'บัญชีรายปีของจังหวัดที่เลือก ค่าจำนวนคงอยู่และการออกเป็นค่าคาดหมาย','Annual ledger for the selected province; stocks and departures are expectations.')}`,{columns:['year_ce','opening_headcount','new_appointments_accepted_starts',...(provinceLedger.some(r=>r.population_protected_appointments!=null)?['population_protected_appointments','population_quota_exact']:[]),'expected_departures_total','expected_reentries','transfers_in_planned','transfers_out_planned','expected_closing_stock','density_per_100k_civil','target_own','attainment_own','shortfall_own','cap_binding','floor_binding']});
  add('transfer_routes',null,(run.transfers||[]).filter(r=>!r.plan_id||r.plan_id===plan),L(lang,'เป็นการย้ายที่แบบจำลองเสนอ ไม่ใช่การอนุมัติหรือการย้ายที่เกิดขึ้นจริง หากไม่มีรายการ แผนนี้ไม่มีเส้นทางการโอนที่เสนอ','These are proposed modelled transfers, not approved or realized moves. No records means no proposed routes in this plan.'),{columns:(run.transfers||[]).length?Object.keys(run.transfers[0]):['plan_id','year_ce','origin','destination','planned_transfers']});
  const final=runMetrics(run).filter(r=>Number(r.year_ce)===years.at(-1)&&criteria.includes(r.criterion));
  add('cross_evaluation',null,final,L(lang,'เปรียบเทียบแผนภายในเกณฑ์เดียวกัน ไม่มีคะแนนรวมที่จัดอันดับคนละตัวหาร','Compare plans within each criterion; no composite score mixes incompatible denominators.'),{columns:['plan_id','criterion','year_ce','total_stock','national_attainment','gini','bottom_quartile_attainment','shortfall_sum','gap_national','gap_spatial']});
  add('constraint_diagnostics',null,runLedger(run).filter(r=>r.plan_id===plan),L(lang,'ข้อจำกัดและเหตุผลมาจากผลคำนวณจริง ค้นหาจังหวัดหรือปีได้ การไม่มีข้อมูลไม่ถูกแทนด้วยศูนย์','Constraints and reasons come from this executed result. Search by province or year; missing values are not zero.'),{columns:['province','year_ce','new_appointments_accepted_starts','expected_closing_stock','target_own','cap_binding','floor_binding','transfers_in_planned','transfers_out_planned','allocation_reason']});
  add('attainment_years',null,(run.attainment_years||[]).filter(r=>r.plan_id===plan&&r.criterion===criterion),L(lang,'ปีแรกคือปีที่ถึงเป้าหมายครั้งแรก ปีต่อเนื่องคือปีแรกที่ถึงและไม่ต่ำกว่าเป้าหมายอีกจนสิ้นแผน ช่องว่างหมายถึงยังไม่ถึงภายในช่วงที่คำนวณ','First attainment is the first year at or above target. Sustained attainment remains at or above it through the final year. Blank means no such year within the planning horizon.'),{columns:['province','criterion','first_year_ce','sustained_year_ce']});
  add('feedback_evaluation',null,runMetrics(run).filter(r=>r.plan_id===plan&&Number(r.year_ce)===years.at(-1)&&(r.criterion==='own'||criteria.includes(r.criterion))),L(lang,'own ใช้เป้าหมายของแผนนั้น ซึ่งอาจตอบสนองต่อทรัพยากรใน N-FB ส่วน P/S/N ใช้ทรัพยากรอ้างอิงสำหรับประเมิน ควรเปรียบเทียบค่าภายในเกณฑ์เดียวกัน','own uses the plan’s own target, which may respond to resources in N-FB. P/S/N retain the declared fixed-reference evaluation. Compare values within a criterion.'),{columns:['plan_id','criterion','year_ce','total_stock','total_target','national_attainment','gini','bottom_quartile_attainment']});
  const comparisons=Array.isArray(run.comparison)?run.comparison:run.comparison?.rows||[];
  const comparisonCaption=run.comparison?.same_annual_pool===false?L(lang,'เปรียบเทียบกับ P-R ที่เผยแพร่ จำนวนแพทย์รับใหม่รวมต่างกัน จึงไม่เรียกผลต่างนี้ว่าการเปลี่ยนจังหวัดปลายทางเพียงอย่างเดียว','Compared with published P-R. Appointment pools differ, so these differences include extra supply and must not be interpreted solely as reassigned destinations.'):L(lang,'เปรียบเทียบกับ P-R ที่เผยแพร่ ผลต่างบวกหมายถึงแผนนี้มากกว่า จำนวนรับใหม่สะสมรวมข้ามปี แต่จำนวนคงอยู่ใช้ปลายปีนั้น','Compared with published P-R. Positive means this run is higher. Appointments accumulate across years; closing stock refers to that year-end.');
  add('province_comparison',null,comparisons,comparisonCaption,{columns:comparisons.length?Object.keys(comparisons[0]):['plan_id']});
  add('destination_changes',null,run.comparison?.annual_switches||[],L(lang,'เปรียบเทียบกับ P-R ที่เผยแพร่ รวมผลต่างจังหวัดปลายทางรายปีโดยไม่หักล้างกันข้ามปี หากจำนวนรับใหม่รวมต่างกันจะไม่คำนวณจำนวนเปลี่ยนปลายทาง','Compared with published P-R. Annual destination changes add without cancellation across years. Reassignment is undefined when appointment pools differ.'),{columns:['year_ce','switches','percent_of_pool']});
  const runs=selectedRuns(run,options),analysis=options.comparisonAnalysis;
  if(runs.length>1){
    for(const other of runs)assertResult(other,lab);
    const runMap=new Map(runs.map(r=>[r.run_id,r]));
    add('parameter_differences',null,parameterDifferences(run,options),L(lang,'แสดงเฉพาะค่าที่ต่างกันของผลที่ตรึงไว้ ไม่มีการนำค่าในแบบฟอร์มที่ยังไม่คำนวณมาแทนผลเดิม','Differences among pinned, completed runs only. Unexecuted draft edits never replace these results.'),{columns:['scenario','parameter_id','value','run_id']});
    const aligned=analysis?.metrics||[];
    const comparisonMetrics=aligned.map(r=>({...r,scenario:resultTitle(runMap.get(r.run_id)||{title:r.run_id},lang)}));
    const comparisonNotice=L(lang,'ทุกผลประเมินซ้ำด้วยเป้าหมายของผลอ้างอิงเดียวกัน ความต่างของสมมติฐานอยู่ในตารางค่าตั้งต้น','All results are re-evaluated against the same reference run’s targets. Assumption differences are listed separately.');
    add('pinned_comparison',null,comparisonMetrics.filter(r=>Number(r.year_ce)===years.at(-1)),aligned.length?comparisonNotice:L(lang,'กำลังรอการคำนวณเปรียบเทียบด้วยเกณฑ์ร่วม ยังไม่แสดงค่า Gini ของคนละตัวหารร่วมกัน','Waiting for canonical common-reference comparison. Gini values with different target paths are not combined.'),{columns:['scenario','criterion','year_ce','national_attainment','gini','bottom_quartile_attainment','shortfall_sum','gap_national','gap_spatial','reference_run_id']});
    if(aligned.length){
      const table=resultTables(run,lab,options), byRun=new Map();
      for(const row of comparisonMetrics.filter(r=>Number(r.year_ce)===years.at(-1))){const key=`${row.run_id}|${row.plan_id}`;if(!byRun.has(key))byRun.set(key,{plan:key,run_id:row.run_id,year:Number(row.year_ce),label:`${byRun.size+1} · ${row.scenario}`,short_label:`${byRun.size+1}`,color:['var(--n-1)','var(--n-2)','var(--n-3)','var(--accent-violet)','var(--accent)'][byRun.size%5]});if(row.criterion.startsWith('P|'))byRun.get(key).gini_p=row.gini;if(row.criterion.startsWith('S|'))byRun.get(key).gini_s=row.gini;}
      const scatter=[...byRun.values()].filter(r=>finite(r.gini_p)&&finite(r.gini_s));R.addDataset('lab_pinned_gini',scatter);
      add('pinned_gini',{component:'plancompare',dataset:'lab_alloc',kind:'scatter',metric:'gini',metrics:['gini'],gini_dataset:'lab_pinned_gini'},scatter,comparisonNotice);
      add('pinned_destinations',null,table.Pinned_Destinations,L(lang,'ผลต่างคือแผน B ลบ A เมื่อจำนวนรับใหม่รวมเท่ากันจะแยกจำนวนเปลี่ยนปลายทางได้ หากไม่เท่ากันให้พิจารณาผลต่างจำนวนรับใหม่รวมแยกต่างหาก','Differences are B minus A. Equal pools permit a reassignment count; unequal pools show the change in total available appointments separately.'),{columns:['reference_run_id','comparison_run_id','year_ce','same_annual_pool','switches','percent_of_pool','annual_supply_difference']});
      if(table.Pinned_Priorities.length){
        const rankRows=table.Pinned_Priorities.filter(r=>r.year_ce==='all');
        add('pinned_priority',null,rankRows,L(lang,'เรียงตามจำนวนรับใหม่สะสมตลอดแผน มากที่สุดคืออันดับ 1 ไม่ใช่อันดับความขาดแคลน อันดับเท่ากันใช้ลำดับต่ำสุดร่วมกัน ผลต่างอันดับบวกหมายถึงจังหวัดเลื่อนสูงขึ้นในแผน B','Ranked by cumulative appointments, with largest count ranked first; this is not a shortage ranking. Equal values share the minimum rank. Positive rank change means a higher appointment rank under B.'),{columns:['province','appointments_a','appointments_b','rank_a','rank_b','rank_change','reference_run_id','comparison_run_id']});
        const overlaps=table.Pinned_Overlap.map(r=>({...r,shared_provinces:(r.shared_codes||[]).map(code=>provinceName(release,code,lang)).join(', '),entered_provinces:(r.entered_codes||[]).map(code=>provinceName(release,code,lang)).join(', '),left_provinces:(r.left_codes||[]).map(code=>provinceName(release,code,lang)).join(', ')}));
        add('pinned_overlap',null,overlaps,L(lang,'เทียบกลุ่ม 19 จังหวัดที่ได้รับแพทย์ใหม่มากที่สุดในแต่ละปีหรือสะสม (all) ตัดกลุ่มให้ครบ 19 โดยเรียงรหัสจังหวัดเมื่อจำนวนเท่ากัน retained_share คือสัดส่วนสมาชิกเดิมที่ยังอยู่; Jaccard หารจำนวนสมาชิกร่วมด้วยจำนวนสมาชิกทั้งหมดที่ไม่ซ้ำ','Compares the 19 provinces receiving most appointments annually or cumulatively (all). Exact group size uses province-code tie-breaking. retained_share is overlap / 19; Jaccard is overlap / union. These are appointment groups, not adequacy groups.'),{columns:['year_ce','group_size','shared_count','retained_share','jaccard','entered_provinces','left_provinces','shared_provinces','reference_run_id','comparison_run_id']});
      }
    }
  }
  if(run.uncertainty?.enabled&&run.uncertainty.completed_draws>0){
    const u=run.uncertainty, uCaption=L(lang,`จำลองสำเร็จ ${u.completed_draws} จาก ${u.requested_draws} รอบ แสดงมัธยฐานและเปอร์เซ็นไทล์ 2.5–97.5 ภายใต้แบบจำลองความไม่แน่นอนที่เลือก ไม่ใช่ช่วงเชื่อมั่นของผลนโยบายเชิงเหตุและผล`,`${u.completed_draws} of ${u.requested_draws} draws completed. Median and 2.5–97.5 percentiles are conditional on the selected uncertainty model, not a confidence interval for a causal policy effect.`)+` · ${u.mode} · seed ${u.seed} · ${JSON.stringify(u.components)} · ${simulationDiagnostics(run,lang)}`;
    const bandRows=(u.bands||[]).map(r=>({...r,year:Number(r.year_ce)}));R.addDataset('lab_uncertainty',bandRows);
    add('uncertainty_trajectory',{component:'lines',dataset:'lab_uncertainty',x:'year',interval_label:L(lang,'เปอร์เซ็นไทล์ 2.5–97.5 จากรอบจำลอง','Simulation 2.5–97.5 percentiles'),filter:{criterion,metric:'total_stock'},ys:[{col:'median',lo:'q025',hi:'q975',label:L(lang,'แพทย์คงอยู่: มัธยฐานและช่วงจำลอง','Closing stock: median and simulation interval'),color:'series:1'}],y_label:unitLabel(registry,'closing_stock',lang),y_zero:true},bandRows.filter(r=>r.criterion===criterion&&r.metric==='total_stock'),uCaption);
    add('uncertainty_summary',null,u.summary||[],uCaption,{columns:['criterion','metric','completed_draws','valid_draws','invalid_draws','q025','median','q975']});
    add('province_probabilities',null,u.province_probabilities||[],L(lang,'ความน่าจะเป็นจากรอบจำลองที่มีข้อมูลครบ ดูจำนวนรอบ valid_draws ประกอบ ค่าว่างไม่ได้หมายถึงโอกาสเป็นศูนย์','Probabilities are computed from valid simulated paths; inspect valid_draws. Missing values do not mean zero probability.'),{columns:['province','criterion','valid_draws','probability_meeting_2040','probability_meeting_at_least_once','probability_sustained_from_2035']});
  }
  if(run.context_tables){
    const contextRows=Object.entries(run.context_tables).filter(([key,rows])=>key!=='supply_pipeline'&&Array.isArray(rows)).flatMap(([context_kind,rows])=>rows.filter(r=>r.prov_code==null||String(r.prov_code)===province).map(r=>({context_kind,...r})));
    add('context_inputs',null,contextRows,`${provinceName(release,province,lang)} · ${L(lang,'ค่าบริบทที่ใช้ในการคำนวณจริง หน่วยและขอบเขตอ้างอิงจากแบบจำลอง รายการที่ไม่ได้ปรับยังใช้ค่าจากชุดตั้งต้น','Actual context inputs used for this province. Units and scope follow the fitted model; unchanged inputs retain their baseline values.')}`,{columns:[...new Set(contextRows.flatMap(r=>Object.keys(r)))]});
    const supply=run.context_tables.supply_pipeline||[];
    add('supply_pipeline',null,supply,L(lang,'ค่าการแปลงใช้เฉพาะโหมดที่เลือก จำนวนรับเข้าปฏิบัติงานโดยตรงไม่ถูกหักสัดส่วนสำเร็จการศึกษา การเข้าสังกัด หรือการตอบรับซ้ำ','Conversion factors apply only to the selected supply mode. Direct accepted appointments are not reduced again by graduation, managed-entry or acceptance factors.'),{columns:[...new Set(supply.flatMap(r=>Object.keys(r)))]});
  }
  if(run.service_outcomes?.length){
    const serviceRows=run.service_outcomes.filter(r=>(!r.plan_id||r.plan_id===plan)&&String(r.prov_code)===province);
    add('responsive_services',null,serviceRows,`${provinceName(release,province,lang)} · ${L(lang,'ปริมาณบริการประมาณจาก M5 ภายใต้ทรัพยากรจริง แยกค่าจากทรัพยากรอ้างอิงกับค่าที่ปรับจากบริการที่เกิดขึ้นจริง ความสัมพันธ์ในแบบจำลองไม่ยืนยันผลเชิงเหตุและผลของการเพิ่มแพทย์','M5 service projections under actual resources; standardized-reference and observed-service anchors remain separate. Model associations do not establish a causal effect of adding physicians.')}`,{columns:['year_ce','response_strength','physicians_annual_average','moph_beds','moph_professional_nurses','standardized_anchor_op_moph','standardized_resource_response_op_moph','standardized_anchor_adjrw','standardized_resource_response_adjrw','observed_anchored_physician_response_op_moph','observed_anchored_physician_response_adjrw']});
  }
  return {R,views:viewList,state:{plan,year,province,criterion},registry};
}
function labelFor(registry,col,lang){return registry.column_definitions?.[col]?.[lang==='en'?'label_en':'label_th'] || col;}
export function dataTable(rows,columns,registry,lang='th',{limit=150}={}) {
  const table=h('table',{class:'lab-data-table'}),head=h('thead',{},h('tr',{},...columns.map(k=>h('th',{scope:'col',text:labelFor(registry,k,lang)})))),body=h('tbody');
  for(const row of rows.slice(0,limit))body.append(h('tr',{},...columns.map(k=>h('td',{text:row[k]==null?'—':typeof row[k]==='number'?num(row[k],Number.isInteger(row[k])?0:3):String(row[k])}))));
  table.append(head,body);return table;
}
export function renderLabResults(el,run,options={}) {
  const {release,lab,lang='th',onPresent}=options;const registry=assertResult(run,lab);clear(el);
  const wrapper=h('section',{class:'lab-results','aria-label':L(lang,'ผลที่คำนวณแล้ว','Completed results')});el.append(wrapper);
  const header=h('header',{class:'lab-results__header'},h('div',{class:'lab-results__heading'},h('h2',{text:resultTitle(run,lang)}),h('span',{class:'badge badge--scenario',text:run.source==='presentation_cache'?L(lang,'ผลอ้างอิงจากงานวิจัย','Published reference result'):L(lang,'ผลทดลองของผู้เข้าร่วม','Participant experiment')})),h('p',{text:runSummary(run,lang)}),h('details',{class:'lab-results__provenance'},h('summary',{text:L(lang,'ขอบเขตและรุ่นที่ใช้คำนวณ','Scope and computation versions')}),h('p',{text:run.methods?.scope||scopeText(run,registry,lang)}),h('pre',{text:JSON.stringify({run_id:run.run_id,...run.versions},null,2)})));wrapper.append(header);
  if(run.uncertainty?.diagnostics)header.append(h('p',{class:'lab-results__diagnostic',text:simulationDiagnostics(run,lang)}));
  if(!isCompleted(run)){wrapper.append(h('p',{class:'lab-results__diagnostic',text:L(lang,'ไม่มีแผนที่ผ่านเงื่อนไขสำหรับแสดงผล ดูรายละเอียดข้อจำกัดด้านล่าง','No valid allocation plan is available. Review the diagnostics below.')}),h('pre',{text:JSON.stringify(run.diagnostics,null,2)}));return {destroy(){clear(el);},run};}
  const initial=buildOutcomeViews(run,options).state;
  const state={...initial,view:'stock_trajectory'};
  const controls=h('div',{class:'lab-results__controls'}),host=h('div',{class:'lab-results__outcome'});wrapper.append(controls,host);
  const select=(label,key,items)=>h('label',{},h('span',{text:label}),h('select',{'aria-label':label,'data-lab-result-control':key,onchange:e=>{state[key]=e.target.value;draw();}},...items.map(([value,text])=>h('option',{value,text,selected:String(state[key])===String(value)}))));
  function makeControls(){clear(controls);const built=buildOutcomeViews(run,options,state);state.criterion=built.state.criterion;controls.append(select(L(lang,'มุมมองผล','Outcome view'),'view',built.views.map(v=>[v.id,v.title])),select(L(lang,'แผน','Plan'),'plan',plansOf(run).map(p=>[p,planLabel(release,p,lang)])),select(L(lang,'ปีที่แสดง','Displayed year'),'year',yearsOf(run).map(y=>[y,lang==='en'?String(y):be(y)])),select(L(lang,'เกณฑ์ประเมิน','Evaluation criterion'),'criterion',commonCriteria(runMetrics(run)).map(c=>[c,registry.criteria[c.split('|')[0]][lang==='en'?'label_en':'label_th']])),select(L(lang,'จังหวัด','Province'),'province',[...new Map(runLedger(run).map(r=>[String(r.prov_code),provinceName(release,r.prov_code,lang)])).entries()]));if(onPresent)controls.append(h('button',{class:'btn',type:'button',text:L(lang,'ดูผลแบบนำเสนอ','Present these results'),onclick:()=>onPresent(run)}));}
  let mounted=null;function draw(){mounted?.destroy?.();clear(host);const built=buildOutcomeViews(run,options,state), view=built.views.find(v=>v.id===state.view)||built.views[0];host.append(h('h3',{text:view.title}),h('p',{class:'lab-results__scope',text:view.scope}));const stage=h('div',{class:'lab-results__stage'});host.append(stage);if(view.spec){mounted=mountView(stage,view.spec,{release:built.R,mode:'lab',selected:[state.province],step:1});}else{stage.classList.add('lab-results__stage--table');const input=h('input',{type:'search',placeholder:L(lang,'ค้นหาจังหวัด ปี หรือแผน','Search province, year or plan'),'aria-label':L(lang,'ค้นหาในผลลัพธ์','Search results')});const box=h('div',{class:'lab-results__table-scroll'});stage.append(input,box);const rows=view.rows;const drawRows=()=>{clear(box);const q=input.value.trim().toLowerCase(),selected=q?rows.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(q))):rows;box.append(dataTable(selected,view.columns,built.registry,lang));box.append(h('p',{text:L(lang,`แสดง ${Math.min(150,selected.length)} จาก ${selected.length} แถว · ดาวน์โหลดข้อมูลได้ครบ`,`Showing ${Math.min(150,selected.length)} of ${selected.length} rows; downloads include all rows.`)}));};input.addEventListener('input',drawRows);drawRows();}host.append(h('p',{class:'lab-results__caption',text:view.caption}),h('button',{type:'button',class:'btn btn--ghost',text:L(lang,'ดาวน์โหลดข้อมูลกราฟ CSV','Download figure data CSV'),onclick:()=>{const current=mounted?.figureData?.();const data=current?{...view,...current,period:current.selection.year==='all'?`${yearsOf(run)[0]}–${yearsOf(run).at(-1)} (CE)`:String(current.selection.year)+' (CE)'}:view;download(`${run.run_id}-${view.id}.csv`,csvForRows(data.rows,figureMetadata(data,run)));}}));}
  makeControls();draw();const observer=new ResizeObserver(()=>{if(host.isConnected)draw();});observer.observe(host);
  return {run,destroy(){observer.disconnect();mounted?.destroy?.();clear(el);},setView(id){state.view=id;makeControls();draw();},snapshot(){return buildOutcomeViews(run,options,state);}};
}
export function csvForRows(rows,metadata=[]) {const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];return toCSV({columns:columns.map(key=>({key,label:key})),rows},metadata);}
export function figureMetadata(view,run){return [view.caption,view.scope,`period=${view.period}; unit=${view.unit}`,JSON.stringify({run_id:run.run_id,view_id:view.id,selection:view.selection||view.spec?.filter||{},versions:run.versions})];}
