// Exports always receive a pinned, completed run. They never read draft controls.
import { h } from '../util/dom.js';
import { mountView } from '../engine.js';
import { num } from '../util/format.js';
import { buildOutcomeViews, assertResult, isCompleted, resultTables, resultTitle, runSummary, selectedRuns, outcomeRegistry, yearsOf, csvForRows, figureMetadata } from './results.js';
import { allocationFigureRows } from '../charts/alloc.js';
import { provenanceRows } from './labels.js';

const encoder=new TextEncoder();
const L=(lang,th,en)=>lang==='en'?en:th;
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const filename=value=>String(value||'workforce-lab').replace(/[^\w.-]+/g,'-').slice(0,150);
const asJson=value=>JSON.stringify(value,null,2);
const scalar=value=>value==null?null:typeof value==='object'?JSON.stringify(value):value;
const rowsOf=value=>Array.isArray(value)?value:Object.entries(value||{}).map(([key,value])=>({key,value:scalar(value)}));

export function saveBlob(name,blob) {
  const url=URL.createObjectURL(blob), a=h('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function flatten(object,prefix='') {const out=[];for(const[key,value]of Object.entries(object||{})){const id=prefix?`${prefix}.${key}`:key;if(value&&typeof value==='object'&&!Array.isArray(value))out.push(...flatten(value,id));else out.push({parameter_id:id,value:scalar(value)});}return out;}
function resolvedScenario(run) {return {schema_version:run.schema_version,run_id:run.run_id,computation_hash:run.computation_hash,status:run.status,source:run.source,versions:run.versions,config:run.config,resolved_config:run.resolved_config,seed:run.seed??run.resolved_config?.parameters?.['uncertainty.seed']??run.config?.parameters?.['uncertainty.seed']??run.resolved_config?.seed??run.config?.evaluation?.seed,diagnostics:run.diagnostics};}
function changesFromBaseline(run,lab) {const baseline=lab.baseline_config||lab.baseline?.config||lab.manifest?.baseline_config;if(!baseline)return run.config?.overrides||run.overrides||run.config?.changes||{status:'Baseline configuration not provided; all effective inputs are listed above.'};const base=new Map(flatten(baseline).map(r=>[r.parameter_id,r.value]));return flatten(run.config).filter(r=>JSON.stringify(r.value)!==JSON.stringify(base.get(r.parameter_id))).map(r=>({...r,baseline:base.get(r.parameter_id)??null}));}
function inputRows(run,lab) {
  const parameters=lab.parameter_registry?.parameters || lab.parameter_registry?.entries || lab.registry?.parameters || [];
  const entries=Array.isArray(parameters)?parameters:Object.values(parameters);
    return flatten(run.resolved_config||run.config).map(row=>{const key=row.parameter_id.replace(/^parameters\./,'');const p=entries.find(p=>p.id===key);return {...row,parameter_id:key,label_th:p?.label_th||'',label_en:p?.label_en||'',unit:p?.unit||'',evidence_status:p?.evidence_status||p?.provenance||'scenario_setting',source:scalar(p?.default_provenance||p?.source||null)};});
}
function readmeRows(run,options) {const registry=assertResult(run,options.lab);return [
 {item:'Title / ชื่อ',value:resultTitle(run,options.lang)},
 {item:'Run ID',value:run.run_id},{item:'Run status',value:run.status},{item:'Result source',value:run.source},
 {item:'Meaning / การตีความ',value:'Conditional planning experiment; not a forecast or approved allocation / แผนภายใต้สมมติฐาน ไม่ใช่การพยากรณ์หรือคำสั่งจัดสรร'},
 {item:'Workforce scope / ขอบเขต',value:run.methods?.scope||registry.metrics[0].workforce_scope},
 {item:'Years CE / ปี ค.ศ.',value:yearsOf(run).join(', ')},
 {item:'Province-year keys',value:'run_id + plan_id + prov_code + year_ce; one row per province and year'},
 {item:'Quantities',value:'Plans within the positions frame are linear programmes: appointments may be fractional and are rounded when used. Plans without the frame use whole appointments and transfers. Departures and closing stocks are expected quantities. / แผนภายใต้กรอบตำแหน่งแก้ด้วย LP จำนวนแพทย์ใหม่จึงมีทศนิยมได้และต้องปัดเมื่อนำไปใช้ ส่วนการออกและจำนวนปลายปีเป็นค่าคาดหมาย'},
 {item:'Missing values',value:'Blank means unavailable, not zero.'},
 {item:'Summary TH',value:runSummary(run,'th')},{item:'Summary EN',value:runSummary(run,'en')},
 ...provenanceRows(run),
 ...Object.entries(run.versions||{}).map(([item,value])=>({item,value:scalar(value)})),
 ];}
// User datasets (workspace.lab_data) and regional plans carry their own sheets: what was replaced, and the region's
// national-versus-regional comparison.
function profileSheets(run){
  const out={};const profile=run.data_profile;
  if(profile?.source==='user'){
    out.Data_Profile=(profile.datasets||[]).map(d=>({contract:d.contract,title_th:d.title_th,sha256:d.sha256,provinces_supplied:d.provinces_supplied,provinces_changed:d.provinces_changed,warnings:(d.warnings||[]).join(' | ')}));
    const changed=(profile.datasets||[]).flatMap(d=>(d.changed||[]).map(c=>({contract:d.contract,...c})));
    if(changed.length)out.Data_Changes=changed;
  }
  if(run.regional){
    out.Region_Summary=run.regional.provinces;out.Region_Annual=run.regional.annual;
    out.Region_Method=[{item:'health_region',value:run.regional.health_region},{item:'allotment',value:run.scope?.pool_source},{item:'criterion inside the region',value:run.scope?.family},{item:'method',value:run.regional.method_th},...(run.regional.limitations_th||[]).map((value,i)=>({item:`limitation ${i+1}`,value})),...(run.regional.note_th?[{item:'note',value:run.regional.note_th}]:[])];
  }
  return out;
}
// ---------------------------------------------------------------- reading aids (v4.0, Lab manual feedback)
// Thai names for columns that the metric registry does not define; header cells carry them as notes.
const EXTRA_TH={year_be:'ปี พ.ศ.',province_en:'จังหวัด (อังกฤษ)',health_region:'เขตสุขภาพ',population_civil:'ประชากรทะเบียนราษฎร์',population_entitlement:'ประชากรทะเบียนสิทธิ',
  expected_resignations:'ลาออกคาดหมาย',expected_retirements:'เกษียณคาดหมาย',expected_other_departures:'ออกด้วยเหตุอื่นคาดหมาย',transfers_in:'รับโอนเข้า',
  national_attainment_own:'อัตราส่วนแพทย์ต่อเป้าหมายของแผน ทั้งระบบ (1 = ถึงเป้า)',plan_status:'สถานะของแผน',
  unplaced_national:'แพทย์ใหม่ที่ยังไม่จัดสรรทั้งประเทศ (ค่าระดับประเทศซ้ำทุกแถว ห้ามรวมข้ามจังหวัด)',appointments:'แพทย์ใหม่สะสม',departures:'ออกสะสม',
  attainment_population:'อัตราส่วนต่อเป้าหมายประชากร ปีสุดท้าย',last_year_ce:'ปีสุดท้าย (ค.ศ.)',period:'ช่วงเวลา',plan:'รหัสแผน',
  provinces_meeting:'จำนวนจังหวัดที่ถึงเป้าหมาย',worst_attainment:'อัตราส่วนต่ำสุด',median_attainment:'อัตราส่วนมัธยฐาน',p10_attainment:'อัตราส่วนเปอร์เซ็นไทล์ที่ 10',
  theil:'ดัชนี Theil',cumulative_shortfall:'ส่วนขาดสะสม',baseline_plan_id:'แผนอ้างอิง',eligible_existing_stock_expected:'แพทย์เดิมที่คาดว่ายังอยู่',
  model_family:'เกณฑ์จัดสรร',min_appointments:'จำนวนรับใหม่ขั้นต่ำ',share_age_60plus:'สัดส่วนประชากรอายุ 60 ปีขึ้นไป',share_age_0_14:'สัดส่วนประชากรอายุ 0–14 ปี',
  allocation_reason_th:'เหตุผลจากข้อจำกัด (ภาษาไทย)',label_th:'ชื่อไทย',label_en:'ชื่ออังกฤษ',unit:'หน่วย',evidence_status:'ประเภทของค่า',source:'ที่มา',item:'รายการ',value:'ค่า'};
// Thai for the reasons written by the allocation engine (chapter5/allocation.py explanation()).
const REASON_TH=[[/^positions frame binds/,'ตำแหน่งเต็ม ไม่มีตำแหน่งว่างที่มีงบสำหรับแพทย์ใหม่เพิ่ม'],[/^onboarding cap binds/,'ติดเพดานผู้มาใหม่หรือเพดานเพิ่มสุทธิ'],
  [/^universal floor only/,'ได้เพียงจำนวนขั้นต่ำ เพราะจังหวัดอื่นขาดมากกว่า'],[/^no new appointment/,'ไม่ได้แพทย์ใหม่ เพราะจังหวัดอื่นขาดมากกว่า'],
  [/^includes ([\d.]+) population-protected appointments/,'มีแพทย์ใหม่ $1 คนจากโควตาตามประชากร'],[/^remaining appointments follow/,'ส่วนที่เหลือจัดสรรตามเป้าหมายที่เลือก'],
  [/^shortfall priority/,'จัดสรรตามลำดับความขาด (ได้มากกว่าขั้นต่ำเพื่อลดส่วนขาด)'],[/^donor of controlled transfers at the transfer cap/,'เป็นจังหวัดต้นทางของการโอนย้าย ถึงเพดานโอนออก'],
  [/^donor of controlled transfers/,'เป็นจังหวัดต้นทางของการโอนย้าย'],[/^origin protection binds/,'ติดเกณฑ์คุ้มครองจังหวัดต้นทาง'],[/^receives controlled transfers/,'รับแพทย์โอนย้ายเข้า']];
function reasonTh(text){return String(text).split('; ').map(part=>{for(const [re,th] of REASON_TH){const m=part.match(re);if(m)return th.replace('$1',m[1]??'');}return part;}).join('; ');}
// Keep year_be next to year_ce and the Thai reason next to the English one.
function orderColumns(header){const out=header.filter(k=>k!=='year_be'&&k!=='allocation_reason_th');
  const at=(k,after)=>{if(!header.includes(k))return;const i=out.indexOf(after);i<0?out.push(k):out.splice(i+1,0,k);};
  at('year_be','year_ce');at('allocation_reason_th','allocation_reason');return out;}
function withThaiReason(rows){return rows.map(row=>row&&typeof row.allocation_reason==='string'?{...row,allocation_reason_th:reasonTh(row.allocation_reason)}:row);}
const RATIO=/attainment|ratio|share|gini|theil|jaccard|probab|fraction|^D_|^scale_|j_short|p90_p10|percent/;
const SHEET_TH={'Readme':'ข้อมูลของผลนี้ รุ่นข้อมูล และประโยคสรุป','Inputs':'สมมติฐานทุกค่าที่ใช้คำนวณจริง','Annual_Plan':'แผนรายจังหวัดรายปี (หนึ่งแถว = หนึ่งจังหวัดหนึ่งปี)',
  'Transfers':'การโอนย้ายที่แผนเสนอ (ว่างถ้าไม่เปิดการโอนย้าย)','National_Balance':'ยอดรวมประเทศรายปี','National_Outcomes':'ตัวชี้วัดประเทศรายปี แยกตามเกณฑ์ประเมิน',
  'Province_Outcomes':'ผลรายจังหวัดรายปี','Attainment_Years':'ปีแรกที่แต่ละจังหวัดถึงเป้าหมาย (ช่องว่าง = ยังไม่ถึง)','Comparison':'ความต่างจากแผนหลักที่เผยแพร่ รายจังหวัด–ปี',
  'Destination_Changes':'จำนวนแพทย์ใหม่ที่เปลี่ยนจังหวัดปลายทางจากแผนหลัก','Constraints':'ข้อจำกัดและสถานะของตัวแก้ปัญหา','Figure_Data':'ตัวเลขเบื้องหลังทุกกราฟ',
  'Definitions':'พจนานุกรมรหัสคอลัมน์','Methods':'นิยามตัวชี้วัด','Views':'นิยามมุมมองผล','Cumulative_Allocations':'สรุป 15 ปีรายจังหวัด','Service_Outcomes':'บริการที่ประมาณได้ภายใต้ทรัพยากรจริง',
  'Pinned_Outcomes':'ตัวชี้วัดของทุกแผนที่เก็บไว้ ด้วยเป้าหมายเดียวกัน','Pinned_Differences':'ความต่างรายจังหวัดระหว่างแผนที่เก็บไว้','Pinned_Destinations':'จังหวัดปลายทางที่เปลี่ยนระหว่างแผน',
  'Pinned_Priorities':'อันดับจังหวัดตามแพทย์ใหม่สะสมในแต่ละแผน','Pinned_Overlap':'กลุ่มจังหวัดที่ได้แพทย์ใหม่มากที่สุดซ้ำกันเพียงใด','Parameter_Differences':'แต่ละแผนเปลี่ยนค่าอะไร',
  'Pinned_Plans':'แผนรายปีของทุกแผนที่เก็บไว้','Pinned_Inputs':'สมมติฐานของทุกแผนที่เก็บไว้','Experiment_Manifest':'รายการผลในไฟล์นี้','Context_Units':'หน่วยของข้อมูลบริบท','Long_Text':'ข้อความยาวที่ตัดออกจากแท็บอื่น'};
function guideRows(run,options,tables,sheetNames){
  const balance=tables.National_Balance||[],last=balance.at(-1)||{},years=yearsOf(run);
  const unplaced=balance.reduce((a,r)=>a+(Number(r.unplaced_balance)||0),0),fmt=v=>Number.isFinite(v)?Math.round(v).toLocaleString('en-US'):'—';
  const be=y=>Number(y)+543,first=years[0],end=years.at(-1);
  return [
    {หัวข้อ:'ชื่อผล',รายละเอียด:resultTitle(run,'th')},
    {หัวข้อ:'สรุป',รายละเอียด:runSummary(run,'th')},
    {หัวข้อ:'ไฟล์นี้คืออะไร',รายละเอียด:`แผนจัดสรรแพทย์ใหม่รายจังหวัดรายปี พ.ศ. ${be(first)}–${be(end)} จาก Workforce Lab เป็นผลภายใต้สมมติฐาน ไม่ใช่การพยากรณ์หรือคำสั่งจัดสรร`},
    {หัวข้อ:'วิธีอ่าน',รายละเอียด:'หนึ่งแท็บคือหนึ่งตาราง หัวคอลัมน์เป็นรหัสภาษาอังกฤษ ชี้เมาส์ที่หัวคอลัมน์ (มุมสีแดง) เพื่อดูชื่อไทย หรือดูแท็บ Definitions ใช้ตัวกรองที่แถวแรกเพื่อเลือกจังหวัดหรือปี'},
    {หัวข้อ:'',รายละเอียด:''},
    {หัวข้อ:'อ่านห้าแท็บนี้ก่อน',รายละเอียด:''},
    {หัวข้อ:'National_Balance',รายละเอียด:'ยอดรวมประเทศรายปี: แพทย์ต้นปี (opening_stock) แพทย์ใหม่ที่ลงจังหวัดได้ (new_appointments) ไม่มีตำแหน่งรองรับ (unplaced_balance) ออก (expected_departures) กลับเข้า (expected_reentries) และแพทย์ปลายปี (closing_stock)'},
    {หัวข้อ:'Cumulative_Allocations',รายละเอียด:'สรุป 15 ปีรายจังหวัด: แพทย์ใหม่สะสม (appointments) ออกสะสม (departures) แพทย์ปลายแผน (closing_stock) และอัตราส่วนต่อเป้าหมาย'},
    {หัวข้อ:'Annual_Plan',รายละเอียด:'แผนรายจังหวัดรายปี หนึ่งแถวคือหนึ่งจังหวัดหนึ่งปี เหตุผลของการจัดสรรภาษาไทยอยู่ในคอลัมน์ allocation_reason_th'},
    {หัวข้อ:'Definitions',รายละเอียด:'ชื่อไทย ชื่ออังกฤษ และหน่วยของรหัสคอลัมน์'},
    {หัวข้อ:'Inputs',รายละเอียด:'สมมติฐานทุกค่าที่ใช้คำนวณผลนี้ พร้อมชื่อไทย'},
    {หัวข้อ:'',รายละเอียด:''},
    {หัวข้อ:'คำตอบที่ใช้บ่อย',รายละเอียด:''},
    {หัวข้อ:`แพทย์ปลายปี ${be(end)}`,รายละเอียด:`${fmt(Number(last.closing_stock))} คน (National_Balance คอลัมน์ closing_stock แถวปี ${be(end)})`},
    {หัวข้อ:'แพทย์ใหม่ไม่มีตำแหน่งรองรับ',รายละเอียด:`รวม ${fmt(unplaced)} คนใน ${years.length} ปี (ผลรวมคอลัมน์ unplaced_balance ใน National_Balance)`},
    {หัวข้อ:'จังหวัดหนึ่งได้แพทย์ใหม่กี่คน',รายละเอียด:'Cumulative_Allocations แถวของจังหวัดนั้น คอลัมน์ appointments'},
    {หัวข้อ:'จังหวัดไหนถึงเป้าหมายปีไหน',รายละเอียด:'Attainment_Years เลือก criterion = P|common_total แล้วดู first_year_ce (ปี ค.ศ.) ช่องว่าง = ยังไม่ถึงภายในแผน'},
    {หัวข้อ:'',รายละเอียด:''},
    {หัวข้อ:'ข้อควรรู้',รายละเอียด:''},
    {หัวข้อ:'ปี',รายละเอียด:'year_ce คือปี ค.ศ. และ year_be คือปี พ.ศ. (ค.ศ. + 543)'},
    {หัวข้อ:'ทศนิยม',รายละเอียด:'จำนวนคนเป็นค่าคาดหมาย และแผนภายใต้กรอบตำแหน่งคำนวณด้วย linear programming จึงมีทศนิยมได้ ไฟล์เก็บค่าเต็มไว้ ปัดเมื่อนำไปรายงาน'},
    {หัวข้อ:'ช่องว่าง',รายละเอียด:'แปลว่าไม่มีข้อมูล ไม่ใช่ศูนย์'},
    {หัวข้อ:'อย่ารวมข้ามจังหวัด',รายละเอียด:'คอลัมน์ระดับประเทศที่ซ้ำในทุกแถว เช่น unplaced_national ให้ใช้ National_Balance แทน'},
    {หัวข้อ:'หลายเกณฑ์ในตารางเดียว',รายละเอียด:'National_Outcomes และ Attainment_Years มีหลายแถวต่อปี แยกด้วยคอลัมน์ criterion (P ประชากร, S บริการ, N บริการมาตรฐาน, B ภาระโรค)'},
    {หัวข้อ:'',รายละเอียด:''},
    {หัวข้อ:'แท็บทั้งหมดในไฟล์นี้',รายละเอียด:''},
    ...sheetNames.map(name=>({หัวข้อ:name,รายละเอียด:SHEET_TH[name]||(name.startsWith('Context_')?'ข้อมูลนำเข้ารายจังหวัด–ปีที่ใช้คำนวณ':'')})),
  ];
}
function definitionsRows(registry){return Object.entries(registry.column_definitions||{}).map(([column,d])=>({column,...d}));}
function addRun(rows,run){return rows.map(row=>({run_id:run.run_id,...Object.fromEntries(Object.entries(row).map(([k,v])=>[k,scalar(v)]))}));}
function displayColumns(rows) {return [...new Set(rows.flatMap(row=>Object.keys(row)))];}

export async function workbookBytes(run,options) {
  assertResult(run,options.lab);
  if(!isCompleted(run))throw new Error(L(options.lang,'ยังไม่มีแผนที่ผ่านเงื่อนไข ส่งออกได้เฉพาะข้อมูลตั้งค่าและข้อจำกัด','No valid allocation plan. Export configuration and diagnostics instead.'));
  const XLSX=await import('../../vendor/sheetjs/xlsx.mjs').catch(()=>import(new URL('../../vendor/sheetjs/xlsx.mjs',import.meta.url).href));
  const registry=assertResult(run,options.lab),tables=resultTables(run,options.lab,options),wb=XLSX.utils.book_new();
  const built=buildOutcomeViews(run,options),allViews=built.views;
  const cumulative=built.R.labPlans.flatMap(p=>allocationFigureRows(built.R.rows('lab_alloc'),built.R.labPlans,p.key,'all'));
  const figureRows=[...allViews.flatMap(view=>view.rows.map(row=>({view_id:view.id,...row}))),...cumulative.map(row=>({view_id:'allocations_cumulative',...row}))];
  const sources=Object.fromEntries(allViews.map(view=>[view.id,{scope:view.scope,caption:view.caption,contract:view.contract}]));
  const sheetTables={Readme:readmeRows(run,options),Inputs:inputRows(run,options.lab),Annual_Plan:addRun(withThaiReason(tables.Annual_Plan),run),Transfers:addRun(tables.Transfers,run),National_Balance:addRun(tables.National_Balance,run),National_Outcomes:addRun(tables.National_Outcomes,run),Province_Outcomes:addRun(withThaiReason(tables.Province_Outcomes),run),Attainment_Years:addRun(tables.Attainment_Years,run),Comparison:addRun(rowsOf(tables.Comparison),run),Destination_Changes:addRun(tables.Destination_Changes,run),Constraints:addRun(tables.Diagnostics,run),Figure_Data:addRun(figureRows,run),Definitions:definitionsRows(registry),Methods:registry.metrics.map(m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,scalar(v)]))),Views:Object.entries(sources).map(([view_id,x])=>({view_id,scope:x.scope,caption:x.caption,contract:JSON.stringify(x.contract)}))};
  if(selectedRuns(run,options).length>1){for(const key of ['Pinned_Outcomes','Pinned_Differences','Pinned_Destinations','Pinned_Priorities','Pinned_Overlap','Parameter_Differences'])sheetTables[key]=tables[key];sheetTables.Pinned_Plans=selectedRuns(run,options).flatMap(r=>addRun(r.ledger,r));sheetTables.Pinned_Inputs=selectedRuns(run,options).flatMap(r=>addRun(inputRows(r,options.lab),r));sheetTables.Experiment_Manifest=selectedRuns(run,options).map(r=>({run_id:r.run_id,title:resultTitle(r,options.lang),source:r.source,status:r.status,versions:JSON.stringify(r.versions)}));}
  if(run.uncertainty?.enabled)for(const key of ['Uncertainty_Summary','Uncertainty_Bands','Province_Probabilities'])sheetTables[key]=addRun(tables[key],run);
  if(run.uncertainty?.enabled)sheetTables.Uncertainty_Diagnostics=rowsOf(run.uncertainty.diagnostics);
  for(const [key,rows]of Object.entries(tables))if(key.startsWith('Context_'))sheetTables[key.slice(0,31)]=addRun(rows,run);
  if(run.context_tables?.context_units)sheetTables.Context_Units=rowsOf(run.context_tables.context_units);
  if(run.service_outcomes?.length)sheetTables.Service_Outcomes=addRun(run.service_outcomes,run);
  sheetTables.Cumulative_Allocations=addRun(cumulative,run);
  for(const [key,rows]of Object.entries(profileSheets(run)))sheetTables[key]=addRun(rows,run);
  if(options.experimentRuns?.length){
    sheetTables.Experiment_Manifest=[...(sheetTables.Experiment_Manifest||[]),...options.experimentRuns.map((item,index)=>({kind:'experiment_cell',cell:index+1,policy_id:item.policy_id,future_id:item.future_id,run_id:item.result?.run_id,status:item.result?.status||item.status||'not_executed',config:JSON.stringify(item.config||item.result?.config),versions:JSON.stringify(item.result?.versions||{})}))];
    sheetTables.Experiment_Summary=options.experimentSummary?.summary||[];
    sheetTables.Experiment_Cells=options.experimentSummary?.cells||[];
    sheetTables.Acceptance_Limits=rowsOf(options.experimentSummary?.acceptance_limits);
    sheetTables.Acceptance_Checks=options.experimentSummary?.acceptance_checks||[];
    sheetTables.Acceptance_By_Policy=options.experimentSummary?.acceptance_by_policy||[];
  }
  // Excel's per-cell limit is 32,767 characters. Preserve long solver/support
  // diagnostics in numbered rows rather than truncating them or failing export.
  // Nested memberships/checks stay readable JSON, not unsupported object cells.
  // Copy before splitting long text so completed runs remain immutable.
  for(const [sheet,rows]of Object.entries(sheetTables))sheetTables[sheet]=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,scalar(value)])));
  const longText=[];
  for(const [sheet,rows]of Object.entries(sheetTables))for(const [index,row]of rows.entries())for(const [column,value]of Object.entries(row))if(typeof value==='string'&&value.length>30000){
    const parts=Math.ceil(value.length/30000);for(let part=0;part<parts;part++)longText.push({sheet,row_number:index+2,column,part_index:part+1,parts,text:value.slice(part*30000,(part+1)*30000)});
    row[column]=`Full text in Long_Text: ${sheet} row ${index+2}, column ${column} (${parts} parts)`;
  }
  if(longText.length)sheetTables.Long_Text=longText;
  const ordered={'อ่านก่อน':guideRows(run,options,tables,['อ่านก่อน',...Object.keys(sheetTables)]),...sheetTables};
  const thai=col=>registry.column_definitions?.[col]?.label_th||EXTRA_TH[col]||'';
  for(const[name,rows]of Object.entries(ordered)){
    const header=orderColumns(displayColumns(rows));const ws=rows.length?XLSX.utils.json_to_sheet(rows,{header}):XLSX.utils.aoa_to_sheet([[L(options.lang,'ไม่มีรายการสำหรับผลนี้','No records for this result')]]);
    ws['!cols']=header.map(key=>({wch:Math.min(45,Math.max(15,key.length+2))}));
    if(rows.length)ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:header.length-1}})};
    if(name==='อ่านก่อน')ws['!cols']=[{wch:30},{wch:120}];
    // Thai column names as header notes; whole-number display formats without rounding the stored values.
    header.forEach((col,c)=>{const label=thai(col),cell=ws[XLSX.utils.encode_cell({r:0,c})];if(label&&cell&&rows.length){cell.c=[{a:'Workforce Lab',t:label}];cell.c.hidden=true;}});
    if(rows.length)for(let r=1;r<=rows.length;r++)header.forEach((col,c)=>{const cell=ws[XLSX.utils.encode_cell({r,c})];
      if(!cell||cell.t!=='n')return;if(Math.abs(cell.v)<1e-9&&cell.v!==0)cell.v=0;
      if(!Number.isInteger(cell.v))cell.z=RATIO.test(col)?'0.000':'#,##0.00';});
    // Text is stored as an explicit string cell; no formula is evaluated from user titles or labels.
    XLSX.utils.book_append_sheet(wb,ws,name);
  }
  wb.Props={Title:resultTitle(run,options.lang),Subject:'Workforce Lab: immutable allocation run',Author:'HRH Workforce Lab',Comments:`Run ${run.run_id}; metric ${registry.metric_definition_version}`};
  return new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true}));
}

const SVG_STYLE=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','font-family','font-size','font-weight','letter-spacing','text-anchor','dominant-baseline','paint-order','visibility'];
function svgSnapshot(svg) {
  const copy=svg.cloneNode(true),old=[svg,...svg.querySelectorAll('*')],nodes=[copy,...copy.querySelectorAll('*')];
  old.forEach((node,i)=>{const style=getComputedStyle(node);for(const key of SVG_STYLE){const value=style.getPropertyValue(key);if(value)nodes[i].style.setProperty(key,value);}nodes[i].removeAttribute('tabindex');nodes[i].removeAttribute('data-loc');});
  copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const box=svg.viewBox.baseVal;copy.setAttribute('width',box.width||svg.getBoundingClientRect().width);copy.setAttribute('height',box.height||svg.getBoundingClientRect().height);
  const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('width','100%');rect.setAttribute('height','100%');rect.setAttribute('fill','#0d1420');copy.prepend(rect);
  return new XMLSerializer().serializeToString(copy);
}
function tableHTML(rows,columns,max=120){return `<div class="table-scroll"><table><thead><tr>${columns.map(k=>`<th>${safe(k)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,max).map(row=>`<tr>${columns.map(k=>`<td>${safe(row[k]==null?'—':typeof row[k]==='number'?num(row[k],Number.isInteger(row[k])?0:3):scalar(row[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length>max?`<p>แสดง ${max}/${rows.length} แถว / Showing ${max}/${rows.length} rows; the CSV contains every row.</p>`:''}`;}
export async function captureFigures(run,options) {
  const built=buildOutcomeViews(run,options), host=h('div',{class:'lab-report-capture','aria-hidden':'true'});document.body.append(host);
  const figures=[];
  try{
    for(const view of built.views){
      const stage=h('div',{class:'lab-results__stage'});host.append(stage);let instance;
      if(view.spec){instance=mountView(stage,view.spec,{release:built.R,mode:'print',selected:[],step:1});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await new Promise(resolve=>setTimeout(resolve,30));}
      const svgs=[...stage.querySelectorAll('svg')].map(svgSnapshot);
      const legend=[...stage.querySelectorAll('.legend__item')].map(node=>({label:node.textContent,color:getComputedStyle(node.querySelector('.legend__swatch')||node).borderTopColor}));
      const axes=[...stage.querySelectorAll('.compare__axis')].map(node=>node.textContent);
      const mapKey=[...stage.querySelectorAll('.alloc__legend,.compare__legend')].map(node=>node.textContent);
      const mapRamp=[...stage.querySelectorAll('.alloc__ramp>span')].map(node=>({label:node.title,color:getComputedStyle(node).backgroundColor}));
      const data=instance?.figureData?.();
      figures.push({...view,...(data||{}),svgs,legend,axes,mapKey,mapRamp,columns:view.columns||displayColumns(data?.rows||view.rows)});
      instance?.destroy?.();stage.remove();
    }
    // Allocation grammar reused a second time to show the complete cumulative map.
    const allocations=built.views.find(v=>v.id==='allocations');
    if(allocations){const stage=h('div',{class:'lab-results__stage'});host.append(stage);const spec={...allocations.spec,year:'all'};const instance=mountView(stage,spec,{release:built.R,mode:'print',selected:[],step:1});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));figures.splice(2,0,{...allocations,id:'allocations_cumulative',title:L(options.lang,'แพทย์รับใหม่สะสมตลอดแผน','Cumulative appointments across the plan'),caption:L(options.lang,'รวมจำนวนแพทย์รับใหม่ตลอดช่วงแผน สีใช้สเกลเดียวกันระหว่างแผนที่อยู่ในผลนี้ ไม่ใช่ผลรวมจำนวนแพทย์คงอยู่','Appointments summed across the planning horizon. The colour scale is shared by plans in this result; closing stocks are not summed.'),spec,...instance.figureData(),svgs:[...stage.querySelectorAll('svg')].map(svgSnapshot),legend:[],mapKey:[...stage.querySelectorAll('.alloc__legend')].map(node=>node.textContent),mapRamp:[...stage.querySelectorAll('.alloc__ramp>span')].map(node=>({label:node.title,color:getComputedStyle(node).backgroundColor})),period:yearsOf(run).filter((y,i,a)=>i===0||i===a.length-1).map(y=>options.lang==='en'?y:y+543).join('–'),columns:displayColumns(instance.figureData().rows)});instance?.destroy?.();stage.remove();}
  }finally{host.remove();}
  return figures;
}
async function base64Bytes(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
async function promptFont(){try{const response=await fetch(new URL('../../fonts/Prompt-Regular.ttf',import.meta.url));if(!response.ok)return '';return await base64Bytes(new Uint8Array(await response.arrayBuffer()));}catch{return '';}}
function dataURI(text,type='text/plain'){return `data:${type};charset=utf-8,${encodeURIComponent(text)}`;}
const REPORT_CSS=`*{box-sizing:border-box}body{margin:0;background:#0d1420;color:#e8edf5;font:17px/1.65 Prompt,Helvetica,Arial,sans-serif}main{max-width:1400px;margin:auto;padding:38px}h1{font-size:32px}h2{font-size:25px;margin-top:0}p{max-width:110ch}header,.figure,.assumptions{padding:25px;border:1px solid #354052;border-radius:13px;margin:0 0 28px;background:#151e2b}.meta{color:#b0bed0;font-size:14px;overflow-wrap:anywhere}.svgrow{display:flex;flex-wrap:wrap;gap:12px}.svgrow svg{max-width:100%;height:auto;flex:1;min-width:280px}a,button{display:inline-block;color:#acd6ff;background:#1c3049;border:1px solid #527190;border-radius:7px;padding:8px 13px;margin:7px 10px 4px 0;text-decoration:none;font:inherit;cursor:pointer}.table-scroll{max-height:500px;overflow:auto}table{border-collapse:collapse;font-size:12px;width:100%}th,td{padding:8px;border-bottom:1px solid #394555;text-align:left;white-space:nowrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.conditional{font-weight:bold;color:#acd6ff}.caption{font-size:15px}.print-note{display:none}.screen-actions{position:sticky;top:0;background:#0d1420;padding:12px;z-index:5}@media(max-width:700px){main{padding:12px}header,.figure,.assumptions{padding:15px}h1{font-size:25px}.svgrow{display:block}}@media print{@page{size:A4 landscape;margin:12mm}body{background:white;color:#111;font-size:11pt}main{max-width:none;padding:0}.screen-actions,a,button{display:none!important}header,.figure,.assumptions{background:white;border:0;border-radius:0;padding:0;break-inside:avoid;break-after:page}.figure h2{font-size:17pt}.figure .svgrow{max-height:145mm}.figure svg{max-height:142mm}.meta{color:#444}.table-scroll{max-height:none;overflow:visible}table{font-size:8pt}td,th{white-space:normal}.conditional{color:#134e85}.technical-details{display:none!important}.figure table tbody tr:nth-child(n+16){display:none}.print-note{display:block;font-size:9pt}.figure details{display:none}.assumptions pre{max-width:100%}.figure .figure-preview{display:none}}`;
const REPORT_SCRIPT=`document.querySelectorAll('[data-png]').forEach(button=>button.addEventListener('click',()=>{const svg=document.getElementById(button.dataset.png);const source=new XMLSerializer().serializeToString(svg);const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'}));const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=svg.viewBox.baseVal.width||1200;c.height=svg.viewBox.baseVal.height||650;c.getContext('2d').drawImage(img,0,0,c.width,c.height);c.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=button.dataset.png+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});URL.revokeObjectURL(url)};img.src=url}));`;
export async function reportHTML(run,options,{figures=null}={}) {
  assertResult(run,options.lab);const lang=options.lang||'th';figures=figures||await captureFigures(run,options);const registry=outcomeRegistry(options.lab),font=await promptFont();
  const scenario=resolvedScenario(run),inputs=inputRows(run,options.lab),tables=resultTables(run,options.lab,options);
  const figureHTML=figures.map((f,idx)=>{const svg=f.svgs.map((raw,j)=>raw.replace('<svg ',`<svg id="figure-${idx}-${j}" `));return `<section class="figure" id="${safe(f.id)}"><h2>${safe(f.title)}</h2><p class="meta">${safe(f.scope)} · ${safe(f.period)} · ${safe(f.unit)} · ${safe(registry.metric_definition_version)}</p><p class="caption">${safe(f.caption)}</p>${f.axes?.length?`<p class="meta">${f.axes.map(safe).join(' · ')}</p>`:''}<div class="svgrow">${svg.join('')}</div>${f.mapKey?.length?`<p class="meta">${f.mapKey.map(safe).join(' · ')}</p>`:''}${f.mapRamp?.length?`<p>${f.mapRamp.map(it=>`<span style="display:inline-block;margin-right:12px;font-size:13px"><span style="display:inline-block;width:18px;height:12px;background:${safe(it.color)};margin-right:4px"></span>${safe(it.label)}</span>`).join('')}</p>`:''}${f.legend?.length?`<p>${f.legend.map(it=>`<span style="display:inline-block;margin-right:18px"><span style="display:inline-block;width:22px;border-top:3px solid ${safe(it.color)};margin-right:7px"></span>${safe(it.label)}</span>`).join('')}</p>`:''}${!svg.length?tableHTML(f.rows,f.columns):f.id==='pinned_gini'?tableHTML(f.rows,['label','gini_p','gini_s']):''}${!svg.length&&f.rows.length>15?`<p class="print-note">${L(lang,'ฉบับพิมพ์แสดง 15 แถวแรก เปิดไฟล์ HTML หรือ CSV เพื่อดูข้อมูลครบ','Print preview: first 15 rows. Open the HTML report or CSV for all records.')}</p>`:''}<details><summary>${L(lang,'นิยาม ตัวหาร และการถ่วงน้ำหนัก','Definitions, denominators and weights')}</summary><pre>${safe(asJson(f.interpretation))}</pre></details><a download="${safe(f.id)}.csv" href="${dataURI(csvForRows(f.rows,figureMetadata(f,run)),'text/csv')}">${L(lang,'ข้อมูลกราฟ CSV','Figure data CSV')}</a>${f.svgs.map((raw,j)=>`<a download="${safe(f.id)}-${j+1}.svg" href="${dataURI(raw,'image/svg+xml')}">SVG ${j+1}</a><button data-png="figure-${idx}-${j}">PNG ${j+1}</button>`).join('')}</section>`;}).join('');
  const acceptance=options.experimentSummary?.acceptance_by_policy?.length?`<section class="assumptions"><h2>${L(lang,'เกณฑ์ยอมรับที่เลือกสำหรับชุดแผนนี้','Selected acceptance limits for this candidate set')}</h2><p>${L(lang,'เกณฑ์อัตราส่วนขั้นต่ำใช้จังหวัดที่มีแพทย์ต่อเป้าหมายต่ำที่สุดในปี 2583 ส่วนเกณฑ์การโอนใช้จำนวนโอนตามแผนสูงสุดในปีใดปีหนึ่งตลอด 2569–2583 เป็นการคัดกรองแผนที่เลือก ไม่ใช่ข้อยืนยันว่าเหมาะที่สุดหรือมีงบเพียงพอ','The attainment limit uses the worst province in 2040; the transfer limit uses the maximum national planned transfers in any year of 2026–2040. This screens selected candidates, not global optimality or affordability.')}</p><pre>${safe(asJson(options.experimentSummary.acceptance_limits))}</pre>${tableHTML(options.experimentSummary.acceptance_by_policy,displayColumns(options.experimentSummary.acceptance_by_policy))}</section>`:'';
  const tablesHTML=Object.entries(tables).filter(([name,rows])=>Array.isArray(rows)&&rows.length).map(([name,rows])=>`<a download="${safe(name)}.csv" href="${dataURI(csvForRows(rows,[`run_id=${run.run_id}`]),'text/csv')}">${safe(name)} CSV (${rows.length})</a>`).join('');
  return `<!doctype html><html lang="${lang==='en'?'en':'th'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(resultTitle(run,lang))}</title><style>${font?`@font-face{font-family:Prompt;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:100 900}`:''}${REPORT_CSS}</style></head><body><main><div class="screen-actions"><button onclick="window.print()">${L(lang,'พิมพ์ / บันทึกเป็น PDF','Print / Save as PDF')}</button><a download="scenario.json" href="${dataURI(asJson(scenario),'application/json')}">${L(lang,'ข้อมูลตั้งค่า JSON','Scenario JSON')}</a></div><header><h1>${safe(resultTitle(run,lang))}</h1><p class="conditional">${L(lang,'ผลการทดลองแผนภายใต้สมมติฐาน ไม่ใช่การพยากรณ์หรือคำสั่งจัดสรร','Conditional planning experiment, not a forecast or approved allocation')}</p><p>${safe(runSummary(run,'th'))}</p><p>${safe(runSummary(run,'en'))}</p><p class="meta">Run ${safe(run.run_id)} · ${safe(run.status)} · ${safe(run.source)}</p><pre>${safe(asJson(run.versions))}</pre>${tablesHTML}</header><section class="assumptions"><h2>${L(lang,'สมมติฐานของผลที่คำนวณนี้','Assumptions of this completed run')}</h2>${tableHTML(inputs,displayColumns(inputs),500)}<h3>${L(lang,'ความต่างจากแผนอ้างอิง','Changes from the presentation baseline')}</h3><pre>${safe(asJson(changesFromBaseline(run,options.lab)))}</pre></section>${acceptance}${figureHTML}<section class="assumptions"><h2>${L(lang,'นิยาม วิธีคำนวณ และสถานะ','Definitions, methods and status')}</h2><ul>${Object.entries(run.methods||{}).map(([key,value])=>`<li><b>${safe(key)}</b>: ${safe(typeof value==='string'?value:JSON.stringify(value))}</li>`).join('')}</ul><details class="technical-details"><summary>${L(lang,'รายละเอียดการคำนวณครบถ้วน','Complete computation diagnostics')}</summary><pre>${safe(asJson({methods:run.methods,diagnostics:run.diagnostics,metrics:registry.metrics}))}</pre></details><a download="diagnostics.json" href="${dataURI(asJson(run.diagnostics),'application/json')}">Diagnostics JSON</a><a download="definitions.json" href="${dataURI(asJson(registry),'application/json')}">Definitions JSON</a></section></main><script>${REPORT_SCRIPT}</script></body></html>`;
}
export async function downloadPlan(run,options) {const bytes=await workbookBytes(run,options);saveBlob(`${filename(run.run_id)}-allocation.xlsx`,new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return bytes;}
export async function downloadResults(run,options) {if(!isCompleted(run))throw new Error('A completed allocation result is required for the outcome report.');const html=await reportHTML(run,options);saveBlob(`${filename(run.run_id)}-results.html`,new Blob([html],{type:'text/html;charset=utf-8'}));return html;}
export async function packageBytes(run,options) {
  const {zipSync,strToU8}=await import('../../vendor/fflate/browser.js');
  const registry=assertResult(run,options.lab),files={'scenario.json':strToU8(asJson(resolvedScenario(run))),'definitions.json':strToU8(asJson(registry)),'diagnostics.json':strToU8(asJson(run.diagnostics)), 'versions.json':strToU8(asJson(run.versions))};
  if(isCompleted(run)){
    const figures=await captureFigures(run,options);files['allocation.xlsx']=await workbookBytes(run,options);files['results.html']=strToU8(await reportHTML(run,options,{figures}));
    for(const[name,rows]of Object.entries(resultTables(run,options.lab,options)))if(Array.isArray(rows))files[`tables/${name}.csv`]=strToU8(csvForRows(rows,[`run_id=${run.run_id}`]));
    for(const f of figures){files[`figures/${f.id}.csv`]=strToU8(csvForRows(f.rows,figureMetadata(f,run)));f.svgs.forEach((svg,i)=>files[`figures/${f.id}-${i+1}.svg`]=strToU8(svg));}
  }
  if(selectedRuns(run,options).length>1){files['comparison/analysis.json']=strToU8(asJson(options.comparisonAnalysis||{status:'Common-reference comparison not yet calculated'}));for(const r of selectedRuns(run,options))files[`comparison/${filename(r.run_id)}.json`]=strToU8(asJson(r));}
  if(run.uncertainty?.enabled){files['uncertainty/methods.json']=strToU8(asJson({mode:run.uncertainty.mode,requested_draws:run.uncertainty.requested_draws,attempted_draws:run.uncertainty.attempted_draws,completed_draws:run.uncertainty.completed_draws,failed_draws:run.uncertainty.failed_draws,seed:run.uncertainty.seed,components:run.uncertainty.components,paired_random_paths:run.uncertainty.paired_random_paths,draw_stream_id:run.uncertainty.draw_stream_id,diagnostics:run.uncertainty.diagnostics,methods:run.uncertainty.methods}));files['uncertainty/completed_draws.csv']=strToU8(csvForRows(run.uncertainty.rows||[],[`run_id=${run.run_id}`]));files['uncertainty/draw_status.csv']=strToU8(csvForRows(run.uncertainty.draw_status||[],[`run_id=${run.run_id}`]));}
  if(run.service_outcomes?.length)files['tables/Service_Outcomes.csv']=strToU8(csvForRows(run.service_outcomes,[`run_id=${run.run_id}`]));
  if(options.experimentRuns?.length){
    files['experiment/manifest.json']=strToU8(asJson({schema_version:'workforce-lab.experiment-export/1',selected_run_id:run.run_id,summary_status:options.experimentSummary?'calculated':'not_calculated',weighting:options.experimentSummary?.weighting||'No probability weights assigned',cells:options.experimentRuns.map((item,index)=>({cell:index+1,policy_id:item.policy_id,future_id:item.future_id,run_id:item.result?.run_id,status:item.result?.status||item.status||'not_executed',config:item.config||item.result?.config}))}));
    files['experiment/summary.csv']=strToU8(csvForRows(options.experimentSummary?.summary||[],[options.experimentSummary?.weighting||'Summary unavailable; inspect cell status']));
    files['experiment/cells.csv']=strToU8(csvForRows(options.experimentSummary?.cells||[],[options.experimentSummary?.comparison||'Common-reference evaluation not yet completed']));
    files['experiment/summary.json']=strToU8(asJson(options.experimentSummary||{status:'not_calculated'}));
    for(const key of ['acceptance_checks','acceptance_by_policy'])files[`experiment/${key}.csv`]=strToU8(csvForRows(options.experimentSummary?.[key]||[],['Thresholds chosen for this candidate set; not a global optimality or affordability claim']));
    options.experimentRuns.forEach((item,index)=>{files[`experiment/run-${index+1}-${filename(item.result?.run_id||'not-executed')}.json`]=strToU8(asJson(item));});
  }
  const hashes={};for(const[name,bytes]of Object.entries(files)){const hash=await crypto.subtle.digest('SHA-256',bytes);hashes[name]=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  files['manifest.json']=strToU8(asJson({schema_version:'workforce-lab.export/1',run_id:run.run_id,status:run.status,versions:run.versions,files:hashes,contents:isCompleted(run)?'Executed allocation plan and results':'Configuration and diagnostics only; no valid plan'}));
  return zipSync(files,{level:6});
}
export async function downloadPackage(run,options){const bytes=await packageBytes(run,options);saveBlob(`${filename(run.run_id)}-experiment.zip`,new Blob([bytes],{type:'application/zip'}));return bytes;}
