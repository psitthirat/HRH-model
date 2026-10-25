// Lazy mode controller: the existing application owns navigation and releases.
// This module owns participant drafts; canonical Python owns all model quantities.
import { h, clear } from '../util/dom.js';
import { initText } from '../util/i18n.js';
import { download } from '../ui/table.js';
import { LabRuntimeClient } from './runtime-client.js';
import { renderLabResults, isCompleted, resultTitle, runSummary, runLedger } from './results.js';
import { registryEntries, enabled, parameterField, displayValue, same, stable } from './fields.js';
import { scenarioClass, scenarioLabel, scenarioHelp } from './scenario-class.js';
import { readWorkspace, writeWorkspace, participantKey } from './storage.js';
import { copy, localized } from './copy.js';
import { renderPolicyLibrary } from './policies.js';
import { renderServiceModules } from './modules.js';
import { policyOptions, policyCatalogueVersion } from './policy-data.js';
// Lab system (design doc docs/workforce_lab_system_design_th.md): home, rooms, accounts, regional scope, submissions.
import { getAccount, accountChip, requireSignIn, isActive, isReviewer, requiredFor, openAuthDialog } from './account.js';
import { renderHub } from './hub.js';
import { renderMyData, summaryOf } from './mydata.js';
import { renderWorkspaceRoom } from './workspace-room.js';
import { renderReview } from './review.js';
import { renderConnect } from './connect.js';
import { openSubmitDialog } from './submit.js';
import { scopeSelector, scopePayload, scopeIsRegional, regionalBlockers, NATIONAL } from './scope.js';

const clone=structuredClone;
// Views that are rooms of their own; choosing a policy never moves the user out of them.
const ROOMS=['modules','hub','data','workspace','connect','review'];
// Items per account (design doc 8.1): a physician result is about 2 MB compressed.
const WORKSPACE_LIMIT=30;
const configOf=run=>run?.config || run?.resolved_config;
const frozen=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const v of Object.values(value))frozen(v);}return value;};
function stylesheet(name) {
  const href=new URL(`../../css/${name}`,import.meta.url).href;
  if(!document.querySelector(`link[href="${href}"]`))document.head.append(h('link',{rel:'stylesheet',href}));
}
async function json(url,hash) {
  const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw new Error(`${url}: ${response.status}`);
  const bytes=await response.arrayBuffer();
  if(hash){const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(actual!==hash)throw new Error('Lab asset checksum mismatch; reload the complete release.');}
  return JSON.parse(new TextDecoder().decode(bytes));
}
// Plain-language names for the Chapter 5 plans offered under "load a presentation plan" (their labels are codes).
const PRESET_TH={'P-R':'แผนหลัก: จัดสรรตามประชากร','S-R':'จัดสรรตามบริการที่เกิดขึ้น','N-R':'จัดสรรตามบริการมาตรฐาน (M5)','B-R':'จัดสรรตามภาระโรค (DALY)',
  'SQ-C':'คงสัดส่วนรับใหม่เดิม','NFB0.5-R':'ปรับตามทรัพยากรปีก่อน ครึ่งหนึ่ง','NFB1-R':'ปรับตามทรัพยากรปีก่อน เต็มที่',
  'P-RT':'แผนหลัก และเปิดให้โอนย้าย','S-RT':'ตามบริการ และเปิดให้โอนย้าย','N-RT':'ตามบริการมาตรฐาน และเปิดให้โอนย้าย','B-RT':'ตามภาระโรค และเปิดให้โอนย้าย',
  'P-R|g10':'เพิ่มตำแหน่งร้อยละ 10 ต่อรอบ','P-R|F0':'กรอบตำแหน่งคงที่','P-R|F1':'เพิ่มตำแหน่งตามสัดส่วนเดิม','P-R|need':'ไม่จำกัดงบตำแหน่ง',
  'P-R|GDh5':'ลดข้าราชการ เพิ่มลูกจ้างที่โรงพยาบาลจ้าง','P-R|GDc5':'ลดข้าราชการ เพิ่มลูกจ้างจากงบส่วนกลาง','P-R|resp_all':'เป้าหมายคิดจากประชากรทั้งหมด',
  'P-R|pool1500':'แพทย์ใหม่ 1,500 คนต่อปี','P-R|pool2150':'แพทย์ใหม่ 2,150 คนต่อปี','P-R|noframe':'ไม่มีกรอบตำแหน่ง (เพดานผู้มาใหม่)','P-RT|noframe':'ไม่มีกรอบตำแหน่ง และเปิดให้โอนย้าย'};
// Thai for the hindcast consequences written by src/chapter5/hindcast.py (English in the release data).
const CONSEQUENCE_TH={
  'describe the engine as a forecaster':'ทำนายได้ดีกว่าวิธีง่าย ใช้คาดการณ์ระยะสั้นได้',
  'describe the engine as a scenario engine; forecast with the better baseline':'ใช้เป็นแบบจำลองฉากทัศน์ ถ้าต้องการพยากรณ์ให้ใช้วิธีง่ายที่แม่นกว่า',
  'intervals usable as predictive':'ใช้ช่วงคาดการณ์เป็นช่วงพยากรณ์ได้',
  'intervals mis-calibrated; present as scenario ranges only':'ช่วงคาดการณ์ยังไม่ตรง ใช้เป็นช่วงของฉากทัศน์เท่านั้น ไม่ใช่ช่วงความเชื่อมั่น',
  'priority group predictable at this horizon':'คาดการณ์กลุ่มจังหวัดที่ขาดมากที่สุดล่วงหน้าได้',
  'priority group not stable; re-identify it every year':'กลุ่มจังหวัดที่ขาดมากที่สุดยังเปลี่ยนบ่อย ควรทบทวนรายชื่อทุกปี',
};
export async function initLab(app,{isCurrent=()=>true}={}) {
  stylesheet('lab.css');stylesheet('lab-results.css');stylesheet('lab-policies.css');stylesheet('lab-fields.css');stylesheet('lab-modules.css');stylesheet('lab-system.css');
  const release=app.R;
  if(!release.bundle.lab)throw new Error('ชุดเผยแพร่นี้ยังไม่มี Workforce Lab กรุณาเปิดชุดเผยแพร่ปัจจุบัน');
  const releaseURL=new URL(`../../data/releases/${encodeURIComponent(release.id)}/`,import.meta.url);
  const labUrl=new URL(release.bundle.lab.manifest || 'lab/manifest.json',releaseURL);
  const lab=await json(labUrl,release.bundle.lab.sha256);
  const fetchAsset=async asset=>typeof asset==='string'?json(new URL(asset,labUrl)):asset?.url?json(new URL(asset.url,labUrl),asset.sha256):asset;
  lab.parameter_registry=await fetchAsset(lab.parameter_registry);
  lab.outcome_registry=await fetchAsset(lab.outcome_registry);
  const baseline=frozen(await fetchAsset(lab.baseline_result));
  const defaultConfig=clone(lab.default_config || configOf(baseline));
  lab.baseline_config=defaultConfig;
  const entries=registryEntries(lab.parameter_registry),entryById=new Map(entries.map(p=>[p.id,p]));
  const presets=Array.isArray(lab.presets)?lab.presets:Object.entries(lab.presets || {}).map(([id,p])=>({id,...p}));
  const references=new Map((lab.parameter_registry?.references||[]).map(r=>[r.id,r]));
  const key=participantKey(release.id),persisted=await readWorkspace(key);
  let draft=clone(defaultConfig),selected=baseline,pins=[],archivedRuns=[],batch=[],lastRuntime=null,savedStatus=true,failedRun=null,comparisonAnalysis=null,experimentSummary=null;
  let alive=true,busy=false,cancelBatch=false,status='ready',statusDetail='',progressDetail={},resultController=null,policyController=null,serviceController=null,saveTimer,newReleaseTimer;
  let controlTab='overview',controlGroup={future:'services',analysis:'planning'},extraOpen=false,advancedOpen=false,selectedPolicyId=null;
  // Study Lab (Tier 1) modes: reproduce the study baseline, or explore policies.
  let labMode='explore',reproduction=null,check=null,classNote=null;
  // Lab system state: planning scope of Explore, the My data room's datasets, and the room controller.
  let labScope=NATIONAL,myData={},roomController=null;
  const account=getAccount();
  await account.init().catch(()=>{});
  const workspaceOps=!!lab.capabilities?.workspace_ops;
  let lang=app.state.lang || 'th',T=copy(lang),root,form,results,feedback,actions,changeList,pinsBox,storageNote,batchBox;
  const entryContext=app.labEntryContext;
  app.labEntryContext=null;
  const comparableVersions=value=>same(value?.versions || {},lab.versions || {});
  if(persisted && same(persisted.versions,lab.versions)){
    draft=persisted.draft || draft;
    selected=persisted.selected?frozen(persisted.selected):selected;
    pins=(persisted.pins||[]).map(frozen);archivedRuns=(persisted.archivedRuns||[]).map(frozen);batch=persisted.batch||[];lastRuntime=persisted.lastRuntime;comparisonAnalysis=persisted.comparisonAnalysis||null;experimentSummary=persisted.experimentSummary||null;
    labMode=persisted.labMode==='reproduce'?'reproduce':'explore';
    labScope=persisted.labScope||NATIONAL;myData=persisted.myData||{};
  }
  if(entryContext?.kind==='main_menu'){archiveRuns([selected]);draft=clone(defaultConfig);selected=baseline;comparisonAnalysis=null;}
  if(app.state.labPreset&&entryContext)labMode='explore';
  const client=new LabRuntimeClient({labUrl:labUrl.href,manifest:lab,onStatus:event=>{
    status=event.status;statusDetail=event.stage || '';progressDetail=event.detail||{};if(event.runtime)lastRuntime=event.runtime;
    showStatus();
  }});
  if(app.state.labPreset && (!persisted || entryContext))await loadEntry(app.state.labPreset,false);
  selectedPolicyId=app.state.labView==='policies'?(app.state.labPolicy||'P07'):draft.origin?.policy_option_id||null;
  // A link that opens a policy applies its defaults once; a restored draft of the same policy keeps its own values.
  {const linked=policyOptions.find(p=>p.id===selectedPolicyId);setPolicyContext(linked,!!linked&&draft.origin?.policy_option_id!==linked.id);}
  if(!isCurrent())return {destroy(){alive=false;client.dispose();}};
  render();app.persist();

  function options(){
    const ids=[...new Set([selected,...pins].map(r=>r.run_id))].sort(),analysed=[...new Set((comparisonAnalysis?.metrics||[]).map(r=>r.run_id))].sort();
    return {release,lab,lang,initialProvince:app.state.ov?.prov,comparisonRuns:pins,comparisonAnalysis:same(ids,analysed)?comparisonAnalysis:null,
      experimentRuns:batch,experimentSummary,onPresent:()=>present(true)};
  }
  function dirty(){return !same(draft.parameters,configOf(selected)?.parameters);}
  function edited(id){status='dirty';saveSoon();showStatus();showChanges();if(id==='mobility.enabled'){const hint=form?.querySelector('[data-transfer-hint]');if(hint)hint.hidden=!!draft.parameters[id];}}
  function saveSoon(){clearTimeout(saveTimer);if(storageNote?.isConnected)storageNote.textContent=lang==='en'?'Saving this tab’s draft…':'กำลังบันทึกฉบับร่างของแท็บนี้…';saveTimer=setTimeout(save,350);}
  async function save(){
    savedStatus=await writeWorkspace(key,{versions:lab.versions,draft,selected,pins,archivedRuns,batch,lastRuntime,comparisonAnalysis,experimentSummary,labMode,labScope,myData});
    if(storageNote?.isConnected)storageNote.textContent=T(savedStatus?'saved':'notSaved');
  }
  async function loadEntry(presetId,redraw=true){
    const sceneId=presetId.startsWith('scene:')?presetId.slice(6):null;
    const mapping=(lab.scene_map || release.bundle.lab.scene_map || {})[sceneId];
    const stepMapping=Array.isArray(mapping?.steps)?mapping.steps[(entryContext?.step || app.state.step || 1)-1]:mapping?.steps?.[String(entryContext?.step || app.state.step)];
    const preset=presets.find(p=>p.id===(stepMapping?.preset_id || mapping?.preset_id || presetId));
    if(!preset)throw new Error(`Lab preset not found: ${presetId}`);
    const nextSelected=preset.result?frozen(await fetchAsset(preset.result)):selected;
    const contextPins=[];
    // Contextual comparisons replace the active comparison set. Previously
    // completed participant results remain retrievable in the local archive.
    const comparisons=stepMapping?.comparison_ids || mapping?.comparison_ids || [];
    for(const id of comparisons.slice(0,4)){
      const comparison=presets.find(p=>p.id===id);if(!comparison?.result)continue;
      const run=frozen(await fetchAsset(comparison.result));
      if(run.run_id!==nextSelected.run_id&&!contextPins.some(p=>p.run_id===run.run_id))contextPins.push(run);
    }
    archiveRuns([selected,...(sceneId?pins:[])]);
    selected=nextSelected;
    if(sceneId){pins=contextPins;comparisonAnalysis=null;}
    constrainComparisons();
    draft=clone(preset.config);draft.origin={...(draft.origin||{}),preset_id:preset.id,...(sceneId?{source_scene_id:sceneId,source_step:entryContext?.step||app.state.step}:{})};
    if(redraw){syncPolicyContext();controlTab='overview';render();}saveSoon();
  }
  function archiveRuns(runs){
    const known=new Set(archivedRuns.map(run=>run.run_id));
    for(const run of runs)if(isCompleted(run)&&!known.has(run.run_id)){archivedRuns.push(frozen(run));known.add(run.run_id);}
  }
  function constrainComparisons(){
    const active=[...new Map([selected,...pins].filter(isCompleted).map(run=>[run.run_id,run])).values()];
    const keep=new Set(active.slice(0,4).map(run=>run.run_id));
    const displaced=pins.filter(run=>!keep.has(run.run_id));
    if(!displaced.length)return false;
    archiveRuns(displaced);pins=pins.filter(run=>keep.has(run.run_id));comparisonAnalysis=null;return true;
  }
  function button(text,onclick,attrs={}){return h('button',{type:'button',class:'btn',text,onclick,...attrs});}
  function render(){
    resultController?.destroy?.();resultController=null;
    policyController?.destroy?.();policyController=null;
    serviceController?.destroy?.();serviceController=null;
    T=copy(lang);initText(release.bundle,{overrides:lang==='en'?lab.ui_en||{}:{}});
    document.documentElement.lang=lang;
    document.body.classList.toggle('lab-presenting',app.state.labView==='present');
    clear(app.main);root=h('div',{class:'lab','data-lang':lang});app.main.append(root);
    const language=h('select',{'aria-label':'Language / ภาษา',onchange:async e=>{if(!validateForm()){e.target.value=lang;return;}lang=e.target.value;app.state.lang=lang;app.persist();clearTimeout(saveTimer);await save();if(alive)render();}},h('option',{value:'th',selected:lang==='th',text:'ไทย'}),h('option',{value:'en',selected:lang==='en',text:'English'}));
    root.append(h('header',{class:'lab-header'},h('div',{},h('p',{class:'lab-eyebrow',text:'WORKFORCE LAB'}),
      h('h1',{text:T('title')}),
      h('p',{text:roomLead()})),
      h('div',{class:'lab-header__actions'},language,
        app.state.labView!=='present'&&accountChip(account,{lang,onWorkspace:()=>openRoom('workspace'),onChange:()=>render()}),
        button(T('back'),app.returnFromLab))));
    if(app.state.labView!=='present')root.append(roomNav());
    if(!['hub','workspace','connect','review'].includes(app.state.labView))root.append(h('div',{class:'lab-scope-row'},h('p',{class:'lab-scope',text:T('scope'),title:T('provisional')}),h('details',{class:'lab-scope-note'},h('summary',{text:lang==='en'?'Provisional MOPH / OPS scope':'ขอบเขตชั่วคราว: ใช้แพทย์สังกัดกระทรวงสาธารณสุข (สธ.) แทนแพทย์สำนักงานปลัดกระทรวง (สป.สธ.)'}),h('p',{class:'lab-scope--detail',text:T('provisional')}))));
    const origin=draft.origin?.source_scene_id;if(origin)root.append(h('p',{class:'lab-origin',text:`${T('source')} ${origin} · ${release.scene(origin)?.title || ''}`}));
    const update=h('div',{class:'lab-release-update',hidden:true});root.append(update);
    checkNewRelease(update);
    roomController?.destroy?.();roomController=null;
    const room=app.state.labView;
    if(['hub','data','workspace','connect','review'].includes(room)){
      const host=h('div',{class:'lab-room-host','data-room':room});root.append(host);
      if(room==='hub')roomController=renderHub(host,{lang,account,release,lab,onOpen:openRoom});
      else if(room==='data')roomController=workspaceOps?renderMyData(host,{lang,client,account,release,lab,store:myData,draftConfig:()=>clone(draft),
        onResult:showUserResult,onSave:saveToWorkspace,onSubmit:submitRun,onChange:()=>saveSoon()}):host.append(h('p',{class:'lab-help',text:lang==='en'?'This release predates the My data room; open the latest release.':'ชุดเผยแพร่นี้ยังไม่มีห้องข้อมูลของฉัน เปิดชุดเผยแพร่ล่าสุด'}));
      else if(room==='workspace')roomController=renderWorkspaceRoom(host,{lang,account,lab,onOpenRun:openSavedRun,onUseDataset:useSavedDataset,onSubmitRun:submitRun,onChange:()=>render()});
      else if(room==='connect')roomController=renderConnect(host,{lang,lab});
      else roomController=renderReview(host,{lang,account});
      return;
    }
    if(app.state.labView==='modules'){
      const host=h('div',{class:'lab-service-host'});root.append(host);
      serviceController=renderServiceModules(host,{client,lang,onBack:()=>openRoom('hub'),
        canUpload:()=>isActive(account)||!requiredFor('service_upload'),
        onNeedSignIn:()=>requireSignIn(account,lang,lang==='en'?'Uploading your own data to a module needs an account; synthetic demonstration data stay open.':'การอัปโหลดข้อมูลของคุณเข้าโมดูลต้องเข้าสู่ระบบ ข้อมูลสังเคราะห์สาธิตใช้ได้โดยไม่ต้องเข้าสู่ระบบ').then(()=>render())});
      return;
    }
    if(app.state.labView==='present'){
      root.append(h('div',{class:'lab-present-actions'},h('span',{class:'badge',text:T('experimentLabel')}),button(T('backControls'),()=>present(false)),button(T('back'),app.returnFromLab),button(lang==='en'?'Fullscreen':'เต็มหน้าจอ',app.toggleFullscreen)));
      results=h('div',{class:'lab-output'});root.append(results);showResults();return;
    }
    root.append(modeSwitch());
    if(labMode==='explore'&&workspaceOps)root.append(scopeSelector({lang,scope:labScope,release,params:draft.parameters,compact:true,onChange:next=>{labScope=next;status='dirty';saveSoon();render();}}));
    if(labMode==='reproduce'){
      form=null;changeList=null;storageNote=null;classNote=null;root.append(reproducePanel());
      const output=h('section',{class:'lab-output'});root.append(output);
      results=h('div',{class:'lab-result-host'});output.append(results);
      const downloads=h('div',{class:'lab-downloads'});
      for(const [label,method] of [['exportPlan','downloadPlan'],['exportResults','downloadResults'],['exportPackage','downloadPackage']])downloads.append(button(T(label),()=>exportRun(method),{'data-export':method}));
      downloads.append(button(T('pin'),pinSelected,{'data-action':'pin'}),...systemButtons());
      pinsBox=h('section',{class:'lab-pins'});batchBox=null;output.append(downloads,pinsBox,methodsPanel(),validationPanel());
      showStatus();showPins();showResults();return;
    }
    form=h('form',{class:'lab-form lab-control-board',onsubmit:e=>{e.preventDefault();runDraft();}});root.append(form);
    const picker=h('div',{class:'lab-policy-picker-host'});form.append(picker);
    policyController=renderPolicyLibrary(picker,{lang,selectedId:selectedPolicyId,onSelect:selectPolicy,describe:policySettings});
    const metadata=h('div',{class:'lab-scenario-meta'});
    metadata.append(h('label',{},h('span',{text:T('name')}),h('input',{type:'text',value:draft.name||draft.title||'',maxLength:120,oninput:e=>{draft.name=e.target.value;saveSoon();}})));
    const select=h('select',{'aria-label':T('preset'),onchange:e=>{
      if(!validateForm()){e.target.value='';return;}if(e.target.value)loadEntry(e.target.value).catch(showError);
    }},h('option',{value:'',text:T('preset')}));
    for(const p of presets)select.append(h('option',{value:p.id,text:presetText(p)}));
    metadata.append(h('label',{},h('span',{text:T('preset')}),select));
    form.append(controlPanel());
    const reading=h('div',{class:'lab-control-reading'});
    if(policyController.details)reading.append(policyController.details);
    reading.append(h('details',{class:'lab-scenario-settings'},h('summary',{text:lang==='en'?'Starting plan and experiment name':'แผนตั้งต้นและชื่อการทดลอง'}),metadata));
    changeList=h('details',{class:'lab-changes'},h('summary',{text:T('modified')}),h('div'));reading.append(changeList);form.append(reading);
    const reset=button(T('reset'),()=>{draft=clone(defaultConfig);syncPolicyContext();controlTab='overview';status='dirty';render();saveSoon();},{title:T('resetHelp'),'data-action':'reset'});
    const importer=h('input',{type:'file',accept:'.json,application/json',hidden:true,onchange:async e=>{
      try{const file=e.target.files[0];if(!file)return;if(file.size>5e6)throw new Error(T('unknown'));const raw=JSON.parse(await file.text()),cfg=raw.config||raw.scenario||raw;
        if(!cfg.parameters||Object.keys(cfg.parameters).some(k=>!entryById.has(k))||cfg.schema_version&&cfg.schema_version!=='workforce-lab.scenario/1')throw new Error(T('unknown'));
        if(raw.versions&&Object.keys(lab.versions).some(k=>!same(raw.versions[k],lab.versions[k])))throw new Error(T('unknown'));
        draft=clone(cfg);syncPolicyContext();status='dirty';render();saveSoon();
      }catch(error){showError(error);}
    }});
    storageNote=h('span',{class:'lab-help lab-storage-note',text:T(savedStatus?'saved':'notSaved')});
    form.append(h('div',{class:'lab-actions lab-draft-actions'},reset,button(T('exportConfig'),()=>downloadJSON('scenario-draft',{schema_version:'workforce-lab.scenario/1',config:draft,versions:lab.versions})),button(T('import'),()=>importer.click()),importer,storageNote));
    feedback=h('div',{class:'lab-status',role:'status','aria-live':'polite'});
    actions=h('div',{class:'lab-actions lab-run-actions'});
    actions.append(button(T('run'),runDraft,{class:'btn btn--primary','data-action':'run'}),button(T('cancel'),()=>{cancelBatch=true;if(!client.cancel())client.dispose();},{'data-action':'cancel',hidden:!busy}));
    classNote=h('p',{class:'lab-draft-class','data-draft-class':''});
    root.append(h('div',{class:'lab-run-bar',title:T('runtime')},feedback,actions),classNote,h('p',{class:'lab-help lab-run-workload',hidden:true}));
    const output=h('section',{class:'lab-output'});root.append(output);
    const downloads=h('div',{class:'lab-downloads'});
    for(const [label,method] of [['exportPlan','downloadPlan'],['exportResults','downloadResults'],['exportPackage','downloadPackage']])downloads.append(button(T(label),()=>exportRun(method),{'data-export':method}));
    downloads.append(button(T('pin'),pinSelected,{'data-action':'pin'}),...systemButtons());
    pinsBox=h('section',{class:'lab-pins'});
    results=h('div',{class:'lab-result-host'});output.append(results);
    output.append(downloads,pinsBox);
    batchBox=h('section',{class:'lab-batch-results'});output.append(batchBox);
    output.append(h('div',{class:'lab-experiment-tools'},experimentPanel(),robustPanel()),methodsPanel(),validationPanel());
    showChanges();showStatus();showPins();showResults();showBatch();
  }
  function modeSwitch(){
    const nav=h('div',{class:'lab-mode-switch',role:'group','aria-label':T('modeLabel')});
    for(const [id,label] of [['reproduce',T('modeReproduce')],['explore',T('modeExplore')]])
      nav.append(button(label,()=>{if(busy||labMode===id||(labMode==='explore'&&!validateForm()))return;labMode=id;render();saveSoon();},{'data-lab-mode':id,'aria-pressed':String(labMode===id)}));
    return h('div',{class:'lab-mode'},nav,labMode==='explore'?h('p',{class:'lab-help',text:T('exploreLead')}):'');
  }
  function reproducePanel(){
    const box=h('section',{class:'lab-reproduce','data-mode-panel':'reproduce'},h('h2',{text:T('modeReproduce')}),h('p',{class:'lab-help',text:T('reproduceLead')}));
    const list=h('dl',{class:'lab-reproduce__settings'});
    for(const id of ['allocation.family','frame.rule','frame.growth','targets.responsibility_population','supply.available_appointments','targets.reference_per_1000','mobility.enabled','services.op_minutes','services.adjrw_minutes','demography.scenario']){
      const p=entryById.get(id);if(!p)continue;const unit=localized(p,'unit',lang);
      list.append(h('div',{},h('dt',{text:localized(p,'label',lang)}),h('dd',{text:`${displayValue(p,defaultConfig.parameters[id]??p.default,lang)}${unit?` ${unit}`:''}`})));
    }
    feedback=h('div',{class:'lab-status',role:'status','aria-live':'polite'});
    actions=h('div',{class:'lab-actions lab-run-actions'},button(T('reproduceRun'),reproduce,{class:'btn btn--primary','data-action':'run'}),
      button(T('cancel'),()=>{if(!client.cancel())client.dispose();},{'data-action':'cancel',hidden:!busy}),
      button(T('reproduceOpen'),()=>{if(busy)return;archiveRuns([selected]);selected=baseline;comparisonAnalysis=null;showResults();showPins();showStatus();saveSoon();},{'data-action':'open-baseline'}));
    check=h('p',{class:'lab-reproduce__check','data-reproduction':''});
    box.append(h('h3',{text:T('reproduceSettings')}),list,actions,feedback,check);paintCheck();
    return box;
  }
  async function reproduce(){
    if(busy)return;
    archiveRuns([selected]);draft=clone(defaultConfig);draft.name=lang==='en'?'Reproduced study baseline (P-R)':'ทำซ้ำชุดตั้งต้นของการศึกษา (P-R)';
    busy=true;status='validating';statusDetail='';reproduction=null;paintCheck();showStatus();
    try{const result=await execute(draft);if(result&&isCompleted(result))reproduction=reproductionCheck(result);}
    catch(error){if(error.name==='AbortError'){status='cancelled';statusDetail='';}else showError(error);}
    finally{busy=false;showStatus();paintCheck();saveSoon();}
  }
  // Compare with the published P-R: the same decisions per province-year (within 1e-6: plans under the positions
  // frame are linear programmes with continuous decisions), and each solver stage objective against the accepted
  // relative gap. Near-optimal plans are not unique, so a plan with different destinations but objectives within the
  // gap is reported as equivalent, not exact.
  function reproductionCheck(run){
    const key=r=>`${r.year_ce}|${r.prov_code}`,ref=new Map(runLedger(baseline).map(r=>[key(r),r]));
    let matched=0,total=0,maxStock=0;
    for(const r of runLedger(run)){const b=ref.get(key(r));if(!b)continue;total++;
      if(['new_appointments_accepted_starts','transfers_in_planned','transfers_out_planned'].every(k=>Math.abs(Number(r[k]??0)-Number(b[k]??0))<=1e-6))matched++;
      maxStock=Math.max(maxStock,Math.abs(Number(r.expected_closing_stock)-Number(b.expected_closing_stock)));}
    const published=baseline.diagnostics?.solver_stages||[],mine=run.diagnostics?.solver_stages||[];
    // a stage without a published objective (not solved when the study ran) cannot be compared: skip it
    const objective=published.filter(s=>Number.isFinite(s.objective)).map(s=>{const m=mine.find(x=>x.stage===s.stage);return m&&Number.isFinite(m.objective)?Math.abs(m.objective-s.objective)/Math.max(Math.abs(s.objective),1e-12):Infinity;});
    const gap=Number(defaultConfig.parameters['solver.mip_gap']??0),maxObjective=objective.length?Math.max(...objective):Infinity;
    const match=total>0&&matched===total?'exact':maxObjective<=gap?'equivalent':'different';
    return {run_id:run.run_id,matched,total,maxStock,maxObjective,gap,match};
  }
  function paintCheck(){
    if(!check)return;const r=reproduction;check.hidden=!r;if(!r)return;
    const n=x=>x.toLocaleString(lang==='en'?'en-US':'th-TH'),stock=r.maxStock.toPrecision(3),pct=x=>`${(100*x).toPrecision(2)}%`;
    check.dataset.match=r.match;
    const counts=lang==='en'?`New starts and transfers equal the published plan in ${n(r.matched)} of ${n(r.total)} province-years; largest closing-stock difference ${stock} persons.`:`แพทย์ใหม่และการโอนย้ายตรงกับแผนที่เผยแพร่ ${n(r.matched)} จาก ${n(r.total)} จังหวัด-ปี ส่วนต่างแพทย์ปลายปีสูงสุด ${stock} คน`;
    const verdict={exact:lang==='en'?'Exact reproduction.':'ทำซ้ำได้ตรงทุกจังหวัด-ปี',
      equivalent:lang==='en'?`Equivalent within solver tolerance: every solver-stage objective is within ${pct(r.maxObjective)} of the published value (accepted gap ${pct(r.gap)}). Several plans reach practically the same objective, so some destinations differ; the browser solver build differs from the one used for the report (see Chapter 5 on non-unique solutions).`:`เทียบเท่าภายในความคลาดเคลื่อนที่ solver ยอมรับ: ค่าเป้าหมายทุกขั้นต่างจากที่เผยแพร่ไม่เกิน ${pct(r.maxObjective)} (ช่องว่างที่ยอมรับ ${pct(r.gap)}) แผนที่ได้ค่าเป้าหมายเกือบเท่ากันมีได้หลายชุด และ solver ในเบราว์เซอร์เป็นคนละรุ่นกับที่ใช้ทำรายงาน ปลายทางบางส่วนจึงต่างกัน (ดูบทที่ 5 เรื่องคำตอบที่ไม่ unique)`,
      different:lang==='en'?`Not reproduced: a solver-stage objective differs from the published value by ${pct(r.maxObjective)}, more than the accepted gap ${pct(r.gap)}. Download the diagnostics and report it.`:`ทำซ้ำไม่ได้: ค่าเป้าหมายของ solver ต่างจากที่เผยแพร่ ${pct(r.maxObjective)} มากกว่าช่องว่างที่ยอมรับ ${pct(r.gap)} กรุณาดาวน์โหลดข้อมูลวินิจฉัยและแจ้งผู้วิจัย`}[r.match];
    check.textContent=`${verdict} ${counts}`;
  }
  function presetText(p){const code=p.id,name=lang==='en'?'':PRESET_TH[code];return name?`${code} · ${name}`:(localized(p,'label',lang)||code);}
  // "label: value" lines for the values a policy sets, in the participant's language.
  function policySettings(policy){
    return Object.entries(policy?.defaults||{}).filter(([id])=>!/start_year|lag_years|ramp_years/.test(id)||policy.defaults[id]!==(defaultConfig.parameters?.[id]??entryById.get(id)?.default))
      .map(([id,value])=>{const p=entryById.get(id);return p?`${localized(p,'label',lang)}: ${displayValue(p,value,lang)}`:`${id}: ${value}`;});
  }
  // A result needs a name people can tell apart. Without one, name it after what changed from the study baseline.
  function autoName(config){
    const base=defaultConfig.parameters||{},params=config.parameters||{};
    const changed=Object.keys({...base,...params}).filter(k=>!same(params[k]??base[k],base[k])).filter(k=>entryById.has(k));
    if(!changed.length)return lang==='en'?'Study baseline (report values)':'แผนหลัก (ค่าตามรายงาน)';
    const parts=changed.slice(0,2).map(k=>{const p=entryById.get(k);return `${localized(p,'label',lang)} ${displayValue(p,params[k],lang)}`;});
    const more=changed.length>2?(lang==='en'?` and ${changed.length-2} more`:` และอีก ${changed.length-2} ค่า`):'';
    return (lang==='en'?'Changed: ':'เปลี่ยน ')+parts.join(lang==='en'?'; ':' และ ')+more;
  }
  function syncPolicyContext(){
    selectedPolicyId=draft.origin?.policy_option_id||null;
    controlTab=selectedPolicyId?'policy':'overview';
    app.state.labPolicy=selectedPolicyId;if(!ROOMS.includes(app.state.labView))app.state.labView=selectedPolicyId?'policies':null;app.persist();
  }
  function setPolicyContext(policy,apply=false){
    // Catalogue v4 (Percy, 25 Oct 2026): choosing a policy starts from the study baseline and applies the
    // policy's evidence-derived defaults (policy-data.js), named after the policy. Restoring a saved draft only
    // records the context. Nothing is calculated until the participant presses Calculate.
    selectedPolicyId=policy?.id||null;
    if(apply&&policy?.defaults){
      const origin={...(draft.origin||{})};
      draft=clone(defaultConfig);draft.origin=origin;
      Object.assign(draft.parameters,clone(policy.defaults));
      draft.name=`${policy.id} · ${localized(policy,'title',lang)}`;
    }
    draft.origin={...(draft.origin||{})};
    delete draft.origin.policy_option_id;delete draft.origin.policy_catalog_version;
    if(policy?.route){draft.origin.policy_option_id=policy.id;draft.origin.policy_catalog_version=policyCatalogueVersion;}
    controlTab=policy?.route?'policy':'overview';extraOpen=false;
    app.state.labPolicy=selectedPolicyId;
    if(!['present',...ROOMS].includes(app.state.labView))app.state.labView=policy?'policies':null;
  }
  function selectPolicy(policy){
    if(busy||!validateForm()){policyController?.update?.({selectedId:selectedPolicyId});return;}
    setPolicyContext(policy,true);app.persist();render();saveSoon();
    form.querySelector('[data-policy-select]')?.focus({preventScroll:true});
  }
  function controlPanel(){
    const policy=policyOptions.find(p=>p.id===selectedPolicyId);
    const tabs=[...(policy?.route?[['policy',lang==='en'?'This policy':'นโยบายนี้']]:[]),
      ['overview',lang==='en'?'Allocation':'การจัดสรร'],['supply',lang==='en'?'Entrants':'กำลังคนเข้า'],
      ['retention',lang==='en'?'Leaving / returning':'การออก–กลับเข้า'],['mobility',lang==='en'?'Transfers':'การย้าย'],
      ['future',lang==='en'?'Future inputs':'ข้อมูลอนาคต'],['analysis',lang==='en'?'Analysis':'การวิเคราะห์']];
    if(!tabs.some(([id])=>id===controlTab))controlTab='overview';
    const panel=h('section',{class:'lab-controls'}),nav=h('div',{class:'lab-control-tabs',role:'tablist','aria-label':T('controls')});
    for(const [id,label] of tabs)nav.append(button(label,()=>{
      if(busy||!validateForm())return;controlTab=id;extraOpen=false;render();form.querySelector(`[data-control-tab="${id}"]`)?.focus({preventScroll:true});
    },{id:`lab-tab-${id}`,role:'tab','data-control-tab':id,'aria-selected':String(controlTab===id),'aria-controls':'lab-control-panel',tabindex:controlTab===id?0:-1,
      onkeydown:e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...nav.querySelectorAll('[role="tab"]')],i=buttons.indexOf(e.currentTarget);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].click();}}));
    panel.append(nav);
    const content=h('div',{id:'lab-control-panel',class:'lab-control-panel',role:'tabpanel','aria-labelledby':`lab-tab-${controlTab}`});panel.append(content);
    const byIds=ids=>ids.map(id=>entryById.get(id)).filter(Boolean),byGroups=groups=>entries.filter(p=>groups.includes(p.group));
    let controls=[];
    if(controlTab==='policy'){
      const routes={
        retention:['retention.resignation_reduction','retention.coverage','retention.start_year','retention.lag_years','retention.ramp_years'],
        supply:['supply.input_mode','supply.available_appointments','supply.national_graduates','supply.licensing','supply.participation','supply.managed_share'],
        training:['supply.input_mode','supply.student_intake','supply.completion','supply.licensing','supply.participation','supply.managed_share','supply.education_lag_years'],
        mobility:byGroups(['mobility']).map(p=>p.id),reentry:['departures.reentry_multiplier','departures.rate_source'],
        frame:['frame.rule','frame.growth'],allocation:['allocation.family']};
      controls=byIds(routes[policy.route]||[]);
      content.append(h('p',{class:'lab-policy-assumption-note',text:lang==='en'
        ?'These are assumed model responses, not estimated policy effects. Editing leaves the last completed results unchanged until you calculate.'
        :'ค่าที่ปรับคือสมมติฐานผลต่อแบบจำลอง ไม่ใช่ขนาดผลของนโยบายที่ยืนยันแล้ว กราฟจะเปลี่ยนเมื่อกดคำนวณ'}));
      if(['supply','training'].includes(policy.route))content.append(h('p',{class:'lab-help',text:lang==='en'?'The supply input mode determines which inputs enter the calculation. Choose the intended mode before editing graduate or student numbers.':'วิธีระบุจำนวนผู้เข้าเป็นตัวกำหนดว่าค่าใดถูกนำไปคำนวณ เลือกวิธีที่ต้องการก่อนปรับจำนวนผู้สำเร็จการศึกษาหรือนักศึกษา'}));
      if(policy.route==='mobility')content.append(h('p',{class:'lab-help','data-transfer-hint':'',hidden:!!draft.parameters['mobility.enabled'],text:lang==='en'?'Enable transfers to include these transfer assumptions in the calculation.':'เปิดการโอนย้ายเพื่อนำสมมติฐานการย้ายไปคำนวณ'}));
    }else if(controlTab==='overview'){
      // the positions frame is the principal constraint set (Chapter 5); the onboarding cap and the floor apply only
      // when the frame is switched off (appendix plans), so they follow in the additional settings
      const primary=['supply.available_appointments','allocation.family','frame.rule','frame.growth','targets.responsibility_population','targets.reference_per_1000'];
      controls=[...byIds(primary),...entries.filter(p=>!primary.includes(p.id)&&(['frame','allocation','targets'].includes(p.group)||['mobility.enabled','supply.input_mode'].includes(p.id)))];
    }else if(controlTab==='supply')controls=byGroups(['supply']);
    else if(controlTab==='retention')controls=[...byGroups(['retention']),...byGroups(['departures'])];
    else if(controlTab==='mobility')controls=byGroups(['mobility']);
    else{
      const groups=controlTab==='future'?[['services','บริการ','Services'],['demography','ประชากร','Population'],['morbidity','โรค','Morbidity'],['resources','ทรัพยากร','Resources']]
        :[['planning','การปรับแผน','Replanning'],['feedback','การตอบสนองต่อทรัพยากร','Resource response'],['uncertainty','ความไม่แน่นอน','Uncertainty'],['solver','ตัวแก้ปัญหา','Solver'],['geography','รายจังหวัด','Province overrides'],['retirement','เกษียณ','Retirement'],['costs','ต้นทุน','Costs']];
      const choose=h('select',{'data-control-group':'','aria-label':lang==='en'?'Parameter group':'กลุ่มตัวแปร',onchange:e=>{
        if(!validateForm()){e.target.value=controlGroup[controlTab];return;}controlGroup[controlTab]=e.target.value;extraOpen=false;render();form.querySelector('[data-control-group]')?.focus({preventScroll:true});
      }},...groups.map(([id,th,en])=>h('option',{value:id,selected:controlGroup[controlTab]===id,text:lang==='en'?en:th})));
      content.append(h('label',{class:'lab-control-group-select'},h('span',{text:lang==='en'?'Parameter group':'กลุ่มตัวแปร'}),choose));
      controls=byGroups([controlGroup[controlTab]]);
    }
    const free=controls.filter(p=>p.tier1==='advanced');controls=controls.filter(p=>p.tier1!=='advanced');
    const grid=h('div',{class:'lab-control-grid','data-control-route':controlTab==='policy'?policy.route:null,'data-control-count':Math.min(6,controls.length)});content.append(grid);
    const field=p=>parameterField(p,draft,{lang,onChange:edited,baseline:defaultConfig,compact:true,references});
    controls.slice(0,6).forEach(p=>grid.append(field(p)));
    if(controls.length>6){
      const details=h('details',{class:'lab-control-extra',open:extraOpen,ontoggle:e=>{extraOpen=e.target.open;}},
        h('summary',{text:lang==='en'?`Additional settings (${controls.length-6})`:`ตัวแปรเพิ่มเติม (${controls.length-6})`}));
      const more=h('div',{class:'lab-control-grid'});controls.slice(6).forEach(p=>more.append(field(p)));details.append(more);content.append(details);
    }
    if(free.length){
      // Free prevalence edits stay available until Tier 2 exists, behind an explicit advanced section.
      const departed=free.some(p=>!same(draft.parameters[p.id]??p.default,defaultConfig.parameters[p.id]??p.default));
      const adv=h('details',{class:'lab-control-advanced','data-tier1':'advanced',open:departed||advancedOpen,ontoggle:e=>{advancedOpen=e.target.open;}},
        h('summary',{text:`${T('advancedFree')} (${free.length})`}),h('p',{class:'lab-advanced-note',text:T('advancedFreeNote')}));
      const more=h('div',{class:'lab-control-grid'});free.forEach(p=>more.append(field(p)));adv.append(more);content.append(adv);
    }
    return panel;
  }
  function showChanges(){
    if(classNote?.isConnected){const cls=scenarioClass(draft,lab);clear(classNote).append(`${T('draftClass')}: `,h('span',{class:`badge badge--class badge--class-${cls}`,'data-scenario-class':cls,title:scenarioHelp(cls,lang),text:scenarioLabel(cls,lang)}));}
    if(!changeList)return;const box=changeList.lastElementChild;clear(box);const changes=entries.filter(p=>!same(draft.parameters[p.id],defaultConfig.parameters[p.id]));
    if(!changes.length)box.append(h('p',{text:T('unchanged')}));else box.append(h('ul',{},...changes.map(p=>h('li',{},h('b',{text:localized(p,'label',lang)+': '}),`${JSON.stringify(defaultConfig.parameters[p.id])} → ${JSON.stringify(draft.parameters[p.id])}`))));
  }
  function showStatus(){if(!alive||!feedback?.isConnected)return;
    const current=busy||['failed','infeasible','cancelled'].includes(status)?status:dirty()?'dirty':status==='ready'?'ready':status;
    feedback.dataset.status=current;clear(feedback).append(h('strong',{text:T(current)}));
    if(busy&&statusDetail)feedback.append(h('span',{text:stageLabel(statusDetail)}));
    if(busy&&Object.keys(progressDetail).length){const t=progressText(progressDetail);if(t)feedback.append(h('small',{text:t}));}
    if(!busy&&statusDetail&&['failed','infeasible'].includes(status))feedback.append(h('p',{text:statusDetail}));
    if(!busy&&failedRun&&['failed','infeasible'].includes(status))feedback.append(button(lang==='en'?'Download configuration and diagnostics':'ดาวน์โหลดสมมติฐานและข้อจำกัด',()=>downloadJSON('diagnostics',failedRun)));
    const run=actions?.querySelector('[data-action="run"]'),cancel=actions?.querySelector('[data-action="cancel"]');
    if(run)run.disabled=busy;if(cancel)cancel.hidden=!busy;
    for(const field of root.querySelectorAll('.lab-experiment-tools input,.lab-experiment-tools select,.lab-experiment-tools button'))field.disabled=busy;
    for(const field of form?.querySelectorAll('input,select,textarea,button')||[])field.disabled=busy;
    for(const exportButton of root.querySelectorAll('[data-export]')){exportButton.disabled=!isCompleted(selected);exportButton.title=dirty()?T('lastCompleted'):'';}
    const workload=root.querySelector('.lab-run-workload');
    if(workload){const p=draft.parameters,stochastic=p['uncertainty.enabled'],adaptive=p['planning.mode']==='annual_replanning',n=p['uncertainty.draws'];workload.hidden=!stochastic&&!adaptive;
      workload.textContent=adaptive?(lang==='en'?`Annual replanning solves a new allocation problem at each decision year${stochastic?` in ${n} random futures (${n*15} decision-years)`:''}. This can take several minutes or longer. Cancel stops the worker; previous results remain available.`:`ปรับแผนใหม่ด้วยตัวแก้ปัญหาทุกปี${stochastic?` ในอนาคตจำลอง ${n} รอบ (รวม ${n*15} ปี–รอบ)`:''} อาจใช้เวลาหลายนาทีหรือนานกว่านั้น ปุ่มยกเลิกหยุดการคำนวณได้ โดยผลเดิมยังเปิดดูได้`):(lang==='en'?`Evaluate the fixed announced plan in ${n} random futures. Results report completed and valid draws separately.`:`ประเมินแผนคงที่ในอนาคตจำลอง ${n} รอบ ผลจะระบุจำนวนรอบที่สำเร็จและรอบที่นำไปคำนวณแต่ละตัวชี้วัดได้แยกกัน`);
    }
    root.querySelector('[data-action="pin"]')?.toggleAttribute('disabled',!isCompleted(selected));
  }
  // Solver progress in words, not raw keys ("years: 15" read as a bug to first-time users).
  function progressText(d){
    const en=lang==='en',out=[];
    if(Number.isFinite(+d.years))out.push(en?`${d.years}-year plan`:`แผน ${d.years} ปี`);
    if(Number.isFinite(+d.year))out.push(en?`year ${d.year}`:`ปี พ.ศ. ${+d.year+543}`);
    const done=d.draw??d.completed_draws,total=d.requested_draws;
    if(Number.isFinite(+done)&&Number.isFinite(+total))out.push(en?`${done} of ${total} simulations`:`จำลองแล้ว ${done} จาก ${total} ครั้ง`);
    return out.join(' · ');
  }
  function stageLabel(stage){const labels={loading_runtime:['กำลังดาวน์โหลด Python','Downloading Python runtime'],loading_packages:['กำลังโหลดแพ็กเกจวิเคราะห์','Loading analysis packages'],loading_model:['กำลังตรวจไฟล์แบบจำลอง','Verifying model files'],validating:[T('validating'),T('validating')],preparing:['กำลังเตรียมข้อมูลและเป้าหมาย','Preparing inputs and targets'],solving:['กำลังจัดสรรตามข้อกำหนด','Solving the allocation problem'],evaluating:['กำลังคำนวณผลลัพธ์','Evaluating outcomes'],simulating_adaptive:['กำลังจำลองอนาคตหลายชุด','Simulating futures']};return labels[stage]?.[lang==='en'?1:0]||stage;}
  function showError(error){status='failed';statusDetail=String(error.message||error);showStatus();}
  function validateForm(extra){
    const invalid=[...(form?.isConnected?form.querySelectorAll('input,select,textarea'):[]),...(extra?.querySelectorAll('input,select,textarea')||[])].find(el=>!el.checkValidity());
    if(!invalid)return true;
    for(let parent=invalid.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    invalid.reportValidity();return false;
  }
  async function execute(config){
    const regional=labMode==='explore'&&workspaceOps&&scopeIsRegional(labScope);
    if(regional){const blockers=regionalBlockers(config.parameters,lang);if(blockers.length)throw new Error((lang==='en'?'Not available for a regional plan: ':'วางแผนระดับเขตไม่ได้: ')+blockers.join('; '));}
    const named=clone(config);if(!String(named.name||'').trim())named.name=autoName(named);
    const result=await client.run(named,regional?{workspace:{scope:scopePayload(labScope)}}:{});
    if(!alive)return null;
    status=/infeasible/.test(result.status)?'infeasible':isCompleted(result)?'completed':'failed';
    if(isCompleted(result)){selected=frozen(result);failedRun=null;comparisonAnalysis=null;}
    else{failedRun=result;statusDetail=(result.validation?.errors||[]).map(e=>`${localized(entryById.get(e.parameter),'label',lang)||e.parameter}: ${e.message}`).join('\n') || (lang==='en'?'Review the exported diagnostics for the constraints and solver status.':'ดูรายละเอียดข้อจำกัดและสถานะตัวแก้ปัญหาในไฟล์วินิจฉัย');}
    showResults();saveSoon();return result;
  }
  async function runDraft(){
    if(busy||!validateForm())return;
    busy=true;status='validating';statusDetail='';showStatus();
    try{await execute(draft);}catch(error){if(error.name==='AbortError'){status='cancelled';statusDetail='';}else showError(error);}
    finally{busy=false;showStatus();saveSoon();}
  }
  function showResults(){
    if(!results?.isConnected)return;resultController?.destroy?.();
    if(constrainComparisons())showPins();
    resultController=renderLabResults(results,selected,options());
    const policy=policyOptions.find(p=>p.id===configOf(selected)?.origin?.policy_option_id);
    if(policy)results.prepend(h('p',{class:'lab-policy-result-context','data-result-policy':policy.id,text:lang==='en'
      ?`${policy.id} · ${localized(policy,'title',lang)} — defaults from ${{survey:'the project survey',cohort:'Thai studies',study:'the Chapter 5 scenarios'}[policy.readiness]||'the stated assumptions'} (see “Where the default comes from”); a conditional result, not an established policy effect.`
      :`${policy.id} · ${localized(policy,'title',lang)} — ค่าตั้งต้นจาก${{survey:'ผลสำรวจของโครงการ',cohort:'งานวิจัยในไทย',study:'ฉากทัศน์ในรายงานบทที่ 5'}[policy.readiness]||'สมมติฐานที่กำหนด'} (ดู "ค่าตั้งต้นมาจากไหน") ผลภายใต้สมมติฐาน ยังไม่ยืนยันประสิทธิผลของนโยบาย`}));
  }
  function pinSelected(){if(!isCompleted(selected))return;if(pins.some(p=>p.run_id===selected.run_id))return;constrainComparisons();pins.push(selected);comparisonAnalysis=null;showPins();showResults();saveSoon();}
  function showPins(){if(!pinsBox)return;
    constrainComparisons();
    const active=[...new Map([selected,...pins].filter(isCompleted).map(run=>[run.run_id,run])).values()];
    clear(pinsBox).append(h('h3',{text:T('pinned')}),h('p',{class:'lab-help',text:lang==='en'?`Compare up to four plans including the displayed result (${active.length}/4 active). Results removed from the active set remain in the saved list below.`:`เปรียบเทียบได้รวมไม่เกิน 4 แผน โดยนับผลที่กำลังแสดงด้วย (ขณะนี้ ${active.length}/4 แผน) ผลที่นำออกจากชุดเปรียบเทียบยังเปิดดูได้จากรายการที่เก็บไว้ด้านล่าง`}));
    const show=run=>{archiveRuns([selected]);selected=run;comparisonAnalysis=null;showResults();showPins();showStatus();saveSoon();};
    const classBadge=run=>{const cls=scenarioClass(configOf(run),lab);return h('span',{class:`badge badge--class badge--class-${cls}`,'data-scenario-class':cls,title:scenarioHelp(cls,lang),text:scenarioLabel(cls,lang)});};
    for(const run of pins)pinsBox.append(h('article',{class:'lab-pin','data-run-id':run.run_id},h('b',{text:configOf(run)?.name||resultTitle(run,lang)}),classBadge(run),h('small',{text:run.run_id}),h('div',{class:'lab-actions'},button(T('show'),()=>show(run)),button(T('edit'),()=>{draft=clone(configOf(run));syncPolicyContext();render();saveSoon();}),button(T('remove'),()=>{archiveRuns([run]);pins=pins.filter(p=>p.run_id!==run.run_id);comparisonAnalysis=null;showPins();showResults();saveSoon();}))));
    pinsBox.append(button(T('baseline'),()=>show(baseline)));
    if(active.length>1)pinsBox.append(button(lang==='en'?'Compare selected results on common criteria':'คำนวณเปรียบเทียบแผนด้วยเกณฑ์ร่วม',compareSelected,{'data-action':'compare'}));
    const activeIds=new Set(active.map(run=>run.run_id)),archived=archivedRuns.filter(run=>!activeIds.has(run.run_id));
    if(archived.length){
      const box=h('details',{class:'lab-archived'},h('summary',{text:lang==='en'?`Saved results outside this comparison (${archived.length})`:`ผลที่เก็บไว้และยังไม่ได้เปรียบเทียบในชุดนี้ (${archived.length})`}));
      for(const run of archived)box.append(h('article',{class:'lab-pin lab-archived-run','data-run-id':run.run_id},h('b',{text:resultTitle(run,lang)}),h('small',{text:run.run_id}),h('div',{class:'lab-actions'},button(T('show'),()=>show(run)),button(lang==='en'?'Restore to comparison':'นำกลับมาเปรียบเทียบ',()=>{archiveRuns([selected]);selected=run;pins=[run,...pins.filter(p=>p.run_id!==run.run_id)];comparisonAnalysis=null;constrainComparisons();showResults();showPins();showStatus();saveSoon();}),button(T('edit'),()=>{draft=clone(configOf(run));syncPolicyContext();render();saveSoon();}))));
      pinsBox.append(box);
    }
  }
  async function compareSelected(){
    if(busy)return;const runs=[...new Map([selected,...pins].filter(isCompleted).map(r=>[r.run_id,r])).values()];if(runs.length<2)return;
    busy=true;status='running';statusDetail=lang==='en'?'Evaluating common-reference comparisons':'กำลังเทียบผลภายใต้เกณฑ์อ้างอิงร่วม';showStatus();
    try{comparisonAnalysis=await client.compare_runs(runs);status='completed';showResults();saveSoon();}
    catch(error){if(error.name==='AbortError')status='cancelled';else showError(error);}finally{busy=false;showStatus();}
  }
  function present(yes){app.state.labView=yes?'present':selectedPolicyId?'policies':null;app.persist();render();}
  function downloadJSON(name,data){download(`${name}.json`,JSON.stringify(data,null,2),'application/json');}
  async function exportRun(method){
    if(!isCompleted(selected))return;
    // Pinned plans: run the common-criterion comparison first, so the workbook's comparison sheets are not empty.
    if(['downloadPlan','downloadPackage','downloadResults'].includes(method)&&!options().comparisonAnalysis&&pins.some(p=>isCompleted(p)&&p.run_id!==selected.run_id)){
      try{await compareSelected();}catch{}
    }
    const run=selected,ctx=options();
    const btn=root.querySelector(`[data-export="${method}"]`);if(btn)btn.disabled=true;
    try{const exports=await import('./exports.js');await exports[method](run,ctx);}catch(error){showError(error);}finally{showStatus();}
  }
  function methodsPanel(){
    const details=h('details',{class:'lab-methods'},h('summary',{text:T('methods')}));
    details.append(h('p',{text:T('provisional')}),h('p',{text:T('experimentLabel')}),h('p',{text:T('network')}));
    const table=h('table',{},h('thead',{},h('tr',{},...['parameter','value','units'].map(k=>h('th',{text:T(k)}))))),body=h('tbody');table.append(body);
    for(const p of entries)body.append(h('tr',{},h('td',{text:localized(p,'label',lang)}),h('td',{text:localized(p,'help',lang)}),h('td',{text:localized(p,'unit',lang)||p.unit||''})));
    const reg=lab.parameter_registry||{};
    if(reg.tier1_note_th)details.append(h('p',{class:'lab-help','data-tier1-note':'',text:lang==='en'?'Study Lab (Tier 1): computation settings (solver, seed, uncertainty components) stay at the published values; free prevalence edits sit in an advanced section and are marked when they depart from the study. Full free editing belongs to the Research Workspace (Tier 2), not yet available.':reg.tier1_note_th}));
    if(references.size)details.append(h('h4',{text:T('references')}),h('ul',{class:'lab-references'},...[...references.values()].map(r=>h('li',{'data-reference':r.id,text:localized(r,'text',lang)}))));
    details.append(h('div',{class:'lab-table-scroll'},table),h('pre',{text:JSON.stringify(lab.versions,null,2)}));return details;
  }
  // Compact validation view (plan §8.2): what was held out, against which baseline, where it is weak.
  // Read from the release manifest; values come from the canonical Chapter 5 validation inventory.
  function validationPanel(){
    const v=lab.validation;if(!v)return document.createDocumentFragment();
    const en=lang==='en',num=x=>typeof x==='number'?(Math.abs(x)>=10?x.toFixed(1):x.toFixed(2)):(x??'');
    const details=h('details',{class:'lab-validation','data-validation':'compact'},h('summary',{text:en?'How well does the engine predict? (hindcast and validation)':'แบบจำลองทำนายได้ดีแค่ไหน (การทดสอบย้อนหลังและการตรวจสอบ)'}));
    details.append(h('p',{class:'lab-help',text:(en?'Held out: MOPH physicians by province after forecast origins 2020–2023, using only information available at each origin; targets up to 2025. ':'ข้อมูลที่ซ่อนไว้: ')+(en?'':v.held_out_th)}));
    const crit=h('table',{},h('thead',{},h('tr',{},...(en?['criterion','comparator','engine','benchmark','result','consequence']:['คำถาม','ตัวเทียบ','แบบจำลอง','เกณฑ์','ผล','ความหมาย']).map(k=>h('th',{text:k})))),
      h('tbody',{},...v.criteria.map(c=>h('tr',{'data-passed':String(c.passed)},h('td',{text:en?c.criterion:c.question_th}),h('td',{text:en?c.benchmark:c.comparator_th}),
        h('td',{text:num(c.value)}),h('td',{text:c.benchmark}),h('td',{text:c.passed?(en?'passed':'ผ่าน'):(en?'not passed':'ไม่ผ่าน')}),h('td',{text:en?c.consequence:(CONSEQUENCE_TH[c.consequence]||c.consequence)})))));
    const names={persistence:en?'persistence':'คงจำนวนเดิม',trend:en?'trend':'แนวโน้ม',population_only:en?'population only':'ตามประชากร',
      stock_flow_unconditional:en?'stock-flow engine':'แบบจำลองเข้า-ออก',stock_flow_conditional:en?'stock-flow, actual recruitment (not a forecast)':'แบบจำลองเข้า-ออก ใช้การรับเข้าจริง (ไม่ใช่การพยากรณ์)'};
    const mod=h('table',{},h('thead',{},h('tr',{},...(en?['model (horizon 3 years)','MAE (persons)','national error %','lowest-19 Jaccard','90% interval coverage']:['แบบจำลอง (ล่วงหน้า 3 ปี)','MAE (คน)','คลาดรวมประเทศ %','Jaccard 19 จังหวัด','ช่วง 90% ครอบค่าจริง']).map(k=>h('th',{text:k})))),
      h('tbody',{},...v.hindcast_h3.map(m=>h('tr',{},h('td',{text:names[m.model]||m.model}),h('td',{text:num(m.mae)}),h('td',{text:num(m.national_error_pct)}),h('td',{text:num(m.jaccard_lowest19)}),h('td',{text:m.interval_coverage==null?'—':num(m.interval_coverage)})))));
    const weak=v.inventory.filter(r=>r.verdict==='does_not_beat_comparator');
    details.append(h('div',{class:'lab-table-scroll'},crit),h('div',{class:'lab-table-scroll'},mod),
      h('p',{text:en?`Where performance is weak (${weak.length} of ${v.inventory.length} checks do not beat their simple comparator):`:`จุดที่ยังอ่อน (${weak.length} จาก ${v.inventory.length} รายการไม่ดีกว่าตัวเทียบอย่างง่าย):`}),
      h('ul',{},...weak.map(r=>h('li',{'data-check':r.check_id,text:`${r.component} — ${r.metric}: ${num(r.value_model)} vs ${num(r.value_comparator)} (${r.comparator}). ${r.limitation}`}))),
      h('p',{class:'lab-help',text:`criteria file SHA-256 ${String(v.criteria_file_sha256).slice(0,12)}`}));
    return details;
  }
  function experimentPanel(){
    const details=h('details',{class:'lab-experiments'},h('summary',{text:T('sensitivity')}),h('p',{class:'lab-help',text:T('sensitivityHelp')}));
    const candidates=entries.filter(p=>enabled(p)&&p.tier1!=='fixed'&&['number','integer'].includes(p.type));
    const choose=(optional=false)=>h('select',{'aria-label':T(optional?'second':'parameter')},...(optional?[h('option',{value:'',text:T('none')})]:[]),...candidates.map(p=>h('option',{value:p.id,text:localized(p,'label',lang)})));
    const first=choose(),second=choose(true),values1=h('input',{type:'text',value:'1800, 2000, 2200','aria-label':T('values')}),values2=h('input',{type:'text',value:'','aria-label':T('values')}),preview=h('p',{class:'lab-help'});
    first.value='supply.available_appointments';
    const parse=el=>el.value.split(',').map(v=>v.trim()).filter(Boolean).map(Number);
    const estimate=()=>{const n=parse(values1).length*(second.value?parse(values2).length:1),seconds=Number(lastRuntime?.total_ms??0)/1000;preview.textContent=`${T('batchCount')}: ${n} · ${seconds?`${Math.round(n*seconds)} s (${lang==='en'?'estimate from the last run':'ประเมินจากรอบล่าสุด'})`:T('runtimeUnknown')}`;};
    for(const el of [first,second,values1,values2])el.addEventListener('input',estimate);estimate();
    details.append(h('label',{},h('span',{text:T('parameter')}),first),h('label',{},h('span',{text:T('values')}),values1),h('label',{},h('span',{text:T('second')}),second),values2,preview,h('p',{class:'lab-help',text:T('batchLimit')}),button(T('batchRun'),async()=>{
      if(busy||!validateForm(details))return;const a=parse(values1),b=second.value?parse(values2):[null];
      if(!a.length||!b.length||a.length*b.length>12||[...a,...b.filter(v=>v!==null)].some(v=>!Number.isFinite(v))||first.value===second.value){showError(new Error(T('invalidNumber')));return;}
      const template=clone(draft);batch=[];experimentSummary=null;busy=true;cancelBatch=false;showStatus();
      try{for(const va of a){for(const vb of b){if(cancelBatch)break;const config=clone(template);config.parameters[first.value]=va;if(second.value)config.parameters[second.value]=vb;config.name=`${template.name||'Experiment'} · ${first.value}=${va}${second.value?`, ${second.value}=${vb}`:''}`;
        const result=await execute(config);if(result)batch.push({config,result});showBatch();saveSoon();}if(cancelBatch)break;}}
      catch(error){if(error.name==='AbortError')status='cancelled';else showError(error);}finally{busy=false;showStatus();saveSoon();}
    }));return details;
  }
  function robustPanel(){
    const details=h('details',{class:'lab-experiments'},h('summary',{text:lang==='en'?'Compare policies across futures':'เปรียบเทียบเกณฑ์จัดสรรในหลายฉากทัศน์'}));
    details.append(h('p',{class:'lab-help',text:lang==='en'?'Execute every selected policy × population scenario with the other draft settings fixed. Use deterministic expected plans; within-scenario random draws are disabled for this matrix. Scenarios have equal weight for comparison, not forecast probabilities.':'คำนวณทุกคู่ของเกณฑ์จัดสรรและฉากทัศน์ประชากร โดยคงค่าอื่นตามแบบฟอร์ม ใช้แผนค่าคาดหมายและปิดการสุ่มภายในฉากทัศน์สำหรับชุดนี้ ให้น้ำหนักแต่ละฉากทัศน์เท่ากันเพื่อเปรียบเทียบ ไม่ใช่โอกาสที่จะเกิดขึ้นจริง'}));
    const policyBox=h('fieldset',{},h('legend',{text:lang==='en'?'Allocation principles':'เกณฑ์จัดสรร'})),futureBox=h('fieldset',{},h('legend',{text:lang==='en'?'Population futures':'ฉากทัศน์ประชากร'}));
    const choices=(box,parameter,defaults)=>{for(const o of entryById.get(parameter)?.options||[])box.append(h('label',{class:'lab-toggle'},h('input',{type:'checkbox',value:o.value,checked:defaults.includes(o.value),onchange:estimate}),h('span',{text:localized(o,'label',lang)})));};
    const preview=h('p',{class:'lab-help'});
    const values=box=>[...box.querySelectorAll('input:checked')].map(x=>x.value);
    function estimate(){const n=values(policyBox).length*values(futureBox).length,seconds=Number(lastRuntime?.total_ms||0)/1000;preview.textContent=`${T('batchCount')}: ${n} · ${seconds?`${Math.round(n*seconds)} s (${lang==='en'?'last-run estimate':'ประเมินจากรอบล่าสุด'})`:T('runtimeUnknown')}`;}
    choices(policyBox,'allocation.family',['P','S','N-STD']);choices(futureBox,'demography.scenario',['central']);estimate();
    const minAdequacy=h('input',{type:'number',min:0,step:'any',placeholder:lang==='en'?'No limit':'ไม่กำหนด','data-acceptance':'minimum_worst_attainment'}),maxTransfers=h('input',{type:'number',min:0,step:1,placeholder:lang==='en'?'No limit':'ไม่กำหนด','data-acceptance':'maximum_annual_transfers'});
    const limits=()=>Object.fromEntries([[minAdequacy,'minimum_worst_attainment'],[maxTransfers,'maximum_annual_transfers']].filter(([el])=>el.value!=='').map(([el,key])=>[key,el.valueAsNumber]));
    details.append(policyBox,futureBox,h('label',{},h('span',{text:lang==='en'?'Minimum worst-province attainment in 2040 (stock / target)':'อัตราส่วนแพทย์ต่อเป้าหมายขั้นต่ำของจังหวัดที่มีค่าต่ำสุดในปี 2583'}),minAdequacy),h('label',{},h('span',{text:lang==='en'?'Maximum national planned transfers in any year (people)':'จำนวนโอนย้ายตามแผนทั้งประเทศสูงสุดในแต่ละปี (คน)'}),maxTransfers),h('p',{class:'lab-help',text:lang==='en'?'Optional acceptance limits screen these candidates only; they do not prove global optimality. Affordability is unverified without costs.':'กรอกได้ตามเกณฑ์ที่ที่ประชุมยอมรับ ใช้คัดกรองแผนที่เลือกมาเปรียบเทียบ ไม่ได้ยืนยันว่าเป็นแผนที่ดีที่สุดจากทุกทางเลือก และยังไม่ได้ประเมินความสามารถในการจ่าย'}),preview,h('p',{class:'lab-help',text:T('batchLimit')}),button(T('batchRun'),async()=>{
      const policies=values(policyBox),futures=values(futureBox);if(busy||!validateForm(details)||!policies.length||!futures.length||policies.length*futures.length>12)return;
      const acceptedLimits=limits();
      const template=clone(draft);batch=[];experimentSummary=null;busy=true;cancelBatch=false;showStatus();
      try{for(const future of futures){for(const policy of policies){if(cancelBatch)break;
        const config=clone(template);config.parameters['allocation.family']=policy;config.parameters['demography.scenario']=future;config.parameters['uncertainty.enabled']=false;config.name=`${policy} · ${future}`;
        const result=await execute(config);if(result)batch.push({policy_id:policy,future_id:future,config,result});showBatch();saveSoon();
      }if(cancelBatch)break;}
        if(!cancelBatch&&batch.length===policies.length*futures.length){statusDetail=lang==='en'?'Summarizing common-criterion results':'กำลังสรุปผลด้วยเกณฑ์ร่วม';showStatus();experimentSummary=await client.summarize_experiments(batch,acceptedLimits);showBatch();}
      }catch(error){if(error.name==='AbortError')status='cancelled';else showError(error);}finally{busy=false;showStatus();saveSoon();}
    }));return details;
  }
  function showBatch(){
    if(!batchBox)return;clear(batchBox);if(!batch.length)return;
    batchBox.append(h('h3',{text:T('batchResult')}),button(T('downloadBatch'),()=>downloadJSON('experiment-batch',{versions:lab.versions,kind:'scenario_range_not_probability_forecast',summary:experimentSummary,runs:batch})));
    if(experimentSummary?.summary?.length){
      const rows=experimentSummary.summary,criterion=h('select',{'aria-label':lang==='en'?'Common criterion':'เกณฑ์ประเมินร่วม'}),metric=h('select',{'aria-label':lang==='en'?'Outcome metric':'ตัวชี้วัดผล'}),tableBox=h('div',{class:'lab-table-scroll'});
      for(const value of [...new Set(rows.map(r=>r.criterion))])criterion.append(h('option',{value,text:value}));
      const labels={gini:['Gini (ต่ำกว่า = กระจายเท่าเทียมกว่า)','Gini (lower = more equal)'],shortfall_sum:['ส่วนขาดรวม','Total shortfall'],gap_spatial:['ส่วนขาดจากการกระจาย','Spatial mismatch'],national_attainment:['อัตราส่วนต่อเป้าหมายรวม','National attainment'],bottom_quartile_attainment:['อัตราส่วนต่อเป้าหมายใน 19 จังหวัดค่าต่ำ','Bottom-19 attainment']};
      for(const value of [...new Set(rows.map(r=>r.metric))])metric.append(h('option',{value,text:labels[value]?.[lang==='en'?1:0]||value}));
      function draw(){clear(tableBox);const cols=['policy_id','mean','worst','worst_future','maximum_regret'],names=lang==='en'?['Policy','Mean','Worst','Worst future','Maximum regret']:['เกณฑ์จัดสรร','ค่าเฉลี่ย','กรณีแย่ที่สุด','ฉากทัศน์ที่แย่ที่สุด','ผลต่างสูงสุดจากแผนที่ดีที่สุด'];tableBox.append(h('table',{class:'lab-data-table'},h('thead',{},h('tr',{},...names.map(text=>h('th',{text})))),h('tbody',{},...rows.filter(r=>r.criterion===criterion.value&&r.metric===metric.value).map(r=>h('tr',{},...cols.map(k=>h('td',{text:typeof r[k]==='number'?r[k].toLocaleString(lang==='en'?'en-US':'th-TH',{maximumFractionDigits:4}):r[k]})))))));}
      criterion.onchange=draw;metric.onchange=draw;
      batchBox.append(h('p',{class:'lab-help',text:lang==='en'?'Equal scenario weights, not forecast probabilities. Regret is the difference from the best selected policy in that same future and metric; no composite score is used.':'ให้น้ำหนักฉากทัศน์เท่ากัน ไม่ใช่ความน่าจะเป็น ผลต่างคำนวณจากแผนที่ดีที่สุดในฉากทัศน์และตัวชี้วัดเดียวกัน ไม่มีคะแนนนโยบายรวม'}),h('div',{class:'lab-actions'},criterion,metric),tableBox);draw();
      if(experimentSummary.acceptance_by_policy?.length){
        const checks=experimentSummary.acceptance_by_policy;
        batchBox.append(h('h3',{text:lang==='en'?'Candidate acceptance under all selected futures':'แผนที่ผ่านเกณฑ์ในทุกฉากทัศน์ที่เลือก'}),h('p',{class:'lab-help',text:Object.entries(experimentSummary.acceptance_limits).map(([key,value])=>`${key==='minimum_worst_attainment'?(lang==='en'?'Worst-province stock/target ≥':'อัตราส่วนแพทย์ต่อเป้าหมายของจังหวัดค่าต่ำสุด ≥'):(lang==='en'?'Annual transfers ≤':'โอนย้ายต่อปี ≤')} ${value}`).join(' · ')}),h('ul',{},...checks.map(row=>h('li',{text:`${row.policy_id} · ${row.criterion}: ${row.passes_all_futures?(lang==='en'?'Meets the selected limits':'ผ่านเกณฑ์ที่กำหนด'):(lang==='en'?'Does not meet every limit':'ไม่ผ่านเกณฑ์ครบทุกข้อ')}`}))));
      }
    }
    const list=h('details',{},h('summary',{text:`${T('show')} · ${batch.length} ${lang==='en'?'completed attempts':'รอบที่ทำแล้ว'}`}));
    for(const row of batch)list.append(h('article',{class:'lab-pin'},h('b',{text:row.config.name}),h('p',{text:runSummary(row.result,lang)}),button(T('show'),()=>{if(isCompleted(row.result)){selected=frozen(row.result);showResults();showStatus();saveSoon();}else{failedRun=row.result;showError(new Error(JSON.stringify(row.result.diagnostics||row.result.validation)));}})));
    batchBox.append(list);
  }
  // ------------------------------------------------------------------ Lab system: rooms, workspace, submissions
  function roomNav(){
    const current=['hub','data','workspace','connect','review','modules'].includes(app.state.labView)?app.state.labView:'explore';
    const rooms=[['hub','หน้าแรก Lab','Lab home'],['explore','สำรวจนโยบาย','Explore policy'],['modules','โมดูลบริการ','Service modules'],
      ['data','ข้อมูลของฉัน','My data'],['workspace','พื้นที่ส่วนตัว','My workspace'],['connect','เชื่อมต่อข้อมูล','Data connections'],
      ...(isReviewer(account)?[['review','ทีมวิจัย','Team review']]:[])];
    const nav=h('nav',{class:'lab-rooms','aria-label':lang==='en'?'Lab rooms':'ห้องใน Lab'});
    for(const [id,th,en] of rooms)nav.append(h('button',{type:'button',class:'btn lab-rooms__item','data-room-nav':id,...(id==='modules'?{'data-action':'service-modules'}:{}),
      'aria-current':current===id?'page':null,text:lang==='en'?en:th,onclick:()=>{if(busy||(current==='explore'&&labMode==='explore'&&!validateForm()))return;openRoom(id);}}));
    return nav;
  }
  function roomLead(){
    const leads={hub:['ห้องทดลองวางแผนกำลังคน: เลือกทางเข้าตามสิ่งที่คุณมี','A workforce planning laboratory: choose a way in by what you have'],
      data:['แทนข้อมูลของโครงการด้วยข้อมูลของคุณ แล้วคำนวณใหม่','Replace project data with yours and recompute'],
      workspace:['ผลและชุดข้อมูลที่บันทึกในบัญชีของคุณ','Results and datasets saved in your account'],
      connect:['แผนเชื่อมต่อข้อมูลอัตโนมัติจากหน่วยงาน','The plan for automatic data feeds from agencies'],
      review:['ทบทวนงานที่ผู้ใช้ส่งมา','Review work submitted by users'],
      modules:['โมดูลบริการและโรคที่พร้อมรับข้อมูล','Data-ready service and disease modules']};
    const pair=leads[app.state.labView]||['ปรับสมมติฐาน กดคำนวณ แล้วเปรียบเทียบผลด้านล่าง','Adjust assumptions, calculate, then compare the results below.'];
    return lang==='en'?pair[1]:pair[0];
  }
  function openRoom(id,opts={}){
    if(opts.scope){labScope=opts.scope;labMode='explore';}
    app.state.labView=id==='explore'?(selectedPolicyId?'policies':null):id;
    if(id==='explore')labMode=labMode||'explore';
    app.persist();saveSoon();render();window.scrollTo?.({top:0});
  }
  function systemButtons(){
    return [button(lang==='en'?'Save to my workspace':'บันทึกในพื้นที่ส่วนตัว',()=>{if(isCompleted(selected))saveToWorkspace({kind:'run',title:resultTitle(selected,lang),summary:summaryOf(selected)},selected);},{'data-action':'save-run','data-export':'save-run'}),
      button(lang==='en'?'Submit to the research team':'ส่งให้ทีมวิจัย',()=>{if(isCompleted(selected))submitRun(selected);},{'data-action':'submit-run','data-export':'submit-run'})];
  }
  async function saveToWorkspace(meta,payload){
    if(!(await requireSignIn(account,lang,lang==='en'?'Saving to your private workspace needs an account.':'การบันทึกในพื้นที่ส่วนตัวต้องเข้าสู่ระบบ')))return null;
    try{if((await account.listItems()).length>=WORKSPACE_LIMIT)throw new Error(lang==='en'?`Your workspace holds up to ${WORKSPACE_LIMIT} items; delete older ones first.`:`พื้นที่ส่วนตัวเก็บได้สูงสุด ${WORKSPACE_LIMIT} รายการ กรุณาลบรายการเก่าก่อน`);
      const item=await account.saveItem({...meta,versions:payload.versions||lab.versions,release_id:release.id},payload);
      status='completed';statusDetail='';flash(lang==='en'?`Saved to your workspace: ${item.title}`:`บันทึกในพื้นที่ส่วนตัวแล้ว: ${item.title}`);return item;}
    catch(error){showError(error);flash(String(error.message||error),true);return null;}
  }
  function flash(text,error=false){
    const box=root?.querySelector('[data-lab-flash]')||h('p',{class:'lab-flash','data-lab-flash':'',role:'status','aria-live':'polite'});
    box.textContent=text;box.classList.toggle('lab-flash--error',!!error);if(!box.isConnected)root?.prepend(box);
    clearTimeout(flash.timer);flash.timer=setTimeout(()=>box.remove(),6000);
  }
  function submitRun(run){return openSubmitDialog({lang,account,run,lab,release,onDone:sub=>{if(sub)flash(lang==='en'?'Submitted. Follow it in your workspace.':'ส่งแล้ว ติดตามสถานะได้ในพื้นที่ส่วนตัว');}});}
  function showUserResult(result){
    archiveRuns([selected]);selected=frozen(result);comparisonAnalysis=null;labMode='explore';
    if(result.scope?.level==='health_region')labScope={level:'health_region',health_region:result.scope.health_region,family:result.scope.family===result.scope.national_family?'':result.scope.family,pool:null};
    status='completed';statusDetail='';app.state.labView=selectedPolicyId?'policies':null;app.persist();render();saveSoon();
    root.querySelector('.lab-output')?.scrollIntoView?.({behavior:'smooth',block:'start'});
  }
  function openSavedRun(run){
    if(run.cadre){myData.tab='cadre';myData.cadreResult=run;openRoom('data');return;}
    if(!isCompleted(run)){flash(lang==='en'?'This saved item has no completed plan.':'รายการนี้ไม่มีแผนที่คำนวณเสร็จ',true);return;}
    showUserResult(run);
  }
  function useSavedDataset(payload){
    if(!payload?.contract)return;myData.tab='physicians';myData.datasets||={};
    myData.datasets[payload.contract]={name:payload.name,text:payload.text,report:payload.report};openRoom('data');
  }
  async function checkNewRelease(box){
    clearTimeout(newReleaseTimer);
    try{const index=await json(new URL('../../data/releases.json',import.meta.url));if(!alive||!box.isConnected)return;const id=index.current||index.latest;if(id&&id.localeCompare(release.id)>0){box.hidden=false;clear(box).append(h('span',{text:T('newer')}),button(T('reload'),async()=>{await save();const url=new URL(location.href);url.searchParams.delete('release');location.assign(url);}));}}
    catch{/* keep the coherent loaded release available offline */}
    if(alive)newReleaseTimer=setTimeout(()=>checkNewRelease(box),60000);
  }
  return {get draft(){return clone(draft);},get result(){return clone(selected);},get lab(){return lab;},get client(){return client;},
    destroy(){alive=false;clearTimeout(saveTimer);clearTimeout(newReleaseTimer);save();client.dispose();resultController?.destroy?.();policyController?.destroy?.();serviceController?.destroy?.();roomController?.destroy?.();document.body.classList.remove('lab-presenting');}};
}
