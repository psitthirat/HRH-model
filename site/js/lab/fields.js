import { h, clear } from '../util/dom.js';
import { copy, localized } from './copy.js';

export const registryEntries = registry => Array.isArray(registry) ? registry : registry?.parameters || registry?.entries || [];
export const enabled = p => p.enabled !== false && !['unavailable','unsupported'].includes(p.evidence_status || p.readiness || p.status);
export const same = (a,b) => stable(a) === stable(b);
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')}}`;
  return JSON.stringify(value);
}
export function parameterField(p, config, { lang='th', onChange, baseline, compact=false } = {}) {
  const T=copy(lang), label=localized(p,'label',lang), help=localized(p,'help',lang);
  const id=`lab-${p.id.replace(/[^a-zA-Z0-9_-]/g,'-')}`;
  const wrapper=h('div',{class:`lab-field${compact?' lab-field--compact':''}`,'data-parameter':p.id});
  const status=p.evidence_status || p.readiness || p.provenance || p.status;
  const stateLabel=!enabled(p)?T('unavailable'):/assumption|illustrative/.test(status)?T('assumption'):status==='method_setting'?T('methodSetting'):status==='solver_setting'?T('solverSetting'):T('dataSupported');
  const headingLabel=h('label',{for:id,text:label});
  wrapper.append(h('div',{class:'lab-field__heading'},headingLabel,h('span',{class:'lab-evidence',text:stateLabel})));
  const helpText=help?h('p',{id:`${id}-help`,class:'lab-help',text:help}):null;
  const helpDetails=compact&&helpText?h('details',{class:'lab-field__details'},h('summary',{text:lang==='en'?'Details and interpretation':'รายละเอียดและการตีความ'}),helpText):null;
  if(helpText&&!compact)wrapper.append(helpText);
  if(!enabled(p)) {
    wrapper.append(h('p',{class:'lab-unavailable',text:localized(p,'unsupported_reason',lang)||localized(p,'reason',lang)||p.unsupported_reason||p.status_reason||''}));
    if(helpDetails)wrapper.append(helpDetails);
    return wrapper;
  }
  const current=()=>config.parameters[p.id] ?? p.default;
  const change=value=>{config.parameters[p.id]=value; onChange?.(p.id,value);};
  const type=p.type || p.value_type, options=p.options || p.enum || p.choices;
  const editor=h('div',{class:'lab-field__editor'});
  const minimum=p.hard_domain?.min ?? p.min, maximum=p.hard_domain?.max ?? p.max;
  const fraction=minimum===0&&maximum===1&&type!=='integer';
  const registryUnit=localized(p,'unit',lang)||p.unit||'';
  const unit=fraction?`${registryUnit||(lang==='en'?'fraction':'สัดส่วน')} · 0–1`:registryUnit;
  const describedBy=[help?`${id}-help`:null,unit?`${id}-unit`:null].filter(Boolean).join(' ');
  const common={id,'aria-describedby':describedBy||null};
  // Slider bounds and step guide quick edits only. The exact number input
  // keeps the registry's domain and precision, including values off this grid.
  function sliderSpec() {
    if(!compact || /year|seed/.test(p.id) || /solver_setting/.test(status))return null;
    const ui=p.ui_range, low=Array.isArray(ui)?ui[0]:ui?.min, high=Array.isArray(ui)?ui[1]:ui?.max;
    const min=low??minimum, max=high??maximum;
    if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min||max-min>100000)return null;
    if(Number.isFinite(minimum)&&min<minimum || Number.isFinite(maximum)&&max>maximum)return null;
    const span=max-min;
    const proposedStep=ui?.step??p.step;
    const step=Number.isFinite(proposedStep)&&proposedStep>0?proposedStep:type==='integer'?Math.max(1,Math.ceil(span/200)):span>=1000?100:span>=100?1:span>=10?0.1:span>=1?0.01:0.001;
    return {min,max,step};
  }
  function numberInput(value,onchange,attrs={}) {
    return h('input',{type:'number',value:Number.isFinite(Number(value))?value:'',step:p.step ?? (type==='integer'?1:'any'),min:minimum,max:maximum,...attrs,
      onchange:e=>{const v=e.target.valueAsNumber;e.target.setCustomValidity('');if(!Number.isFinite(v)||!e.target.checkValidity()){e.target.setCustomValidity(T('invalidNumber'));e.target.reportValidity();return;}onchange(v);},
      oninput:e=>e.target.setCustomValidity('')});
  }
  function scalarEditor(value) {
    const spec=sliderSpec();
    if(!spec)return numberInput(value,change,common);
    const exact=numberInput(value,n=>{syncSlider(n);change(n);},common);
    const hint=h('span',{id:`${id}-range-hint`,class:'lab-field__range-hint'});
    const slider=h('input',{id:`${id}-range`,class:'lab-field__range',type:'range',...spec,
      'aria-label':`${label}: ${lang==='en'?'quick adjustment':'ปรับด้วยตัวเลื่อน'}`,
      'aria-describedby':[describedBy,`${id}-range-hint`].filter(Boolean).join(' '),
      oninput:e=>{
        const n=e.target.valueAsNumber;
        if(!Number.isFinite(n)||!e.target.checkValidity())return;
        exact.value=String(n);exact.setCustomValidity('');syncSlider(n);change(n);
      }});
    const track=h('div',{class:'lab-field__range-wrap'},slider,h('div',{class:'lab-field__range-bounds','aria-hidden':'true'},h('span',{text:spec.min}),h('span',{text:spec.max})));
    function syncSlider(n) {
      if(!Number.isFinite(n))return;
      slider.value=String(n); // Native range snapping is display-only.
      const display=slider.valueAsNumber, approximate=Math.abs(display-n)>Number.EPSILON*Math.max(1,Math.abs(n))*4;
      hint.hidden=!approximate;
      slider.style.setProperty('--lab-range-progress',`${100*(display-spec.min)/(spec.max-spec.min)}%`);
      hint.textContent=approximate?(lang==='en'?'The slider shows the nearest position; the number box keeps your exact value.':'ตัวเลื่อนแสดงตำแหน่งใกล้ที่สุด ช่องตัวเลขยังเก็บค่าที่ระบุครบ'):(lang==='en'?'Drag to adjust, or type an exact value.':'เลื่อนเพื่อปรับ หรือพิมพ์ค่าที่ต้องการได้โดยตรง');
    }
    exact.addEventListener('input',()=>{if(exact.value!==''&&Number.isFinite(exact.valueAsNumber)&&exact.checkValidity())syncSlider(exact.valueAsNumber);});
    syncSlider(Number(value));
    return h('div',{class:'lab-field__scalar'},exact,track,hint);
  }
  if(type==='boolean'||type==='bool') {
    const input=h('input',{...common,type:'checkbox',checked:!!current(),onchange:e=>change(e.target.checked)});
    editor.append(h('label',{class:'lab-toggle'},input,h('span',{text:help?label:label})));
  } else if(options?.length) {
    const select=h('select',{...common,onchange:e=>{const opt=options.find(o=>String(typeof o==='object'?o.value??o.id:o)===e.target.value);change(typeof opt==='object'?opt.value??opt.id:opt);}});
    for(const option of options){const value=typeof option==='object'?option.value??option.id:option;select.append(h('option',{value,selected:String(value)===String(current()),text:typeof option==='object'?localized(option,'label',lang)||String(value):String(value)}));}
    editor.append(select);
  } else if(type==='object'||type==='json'||type==='array') {
    // Region/province overrides use explicit IDs and trajectory JSON, never
    // an ambiguous text-to-number coercion. The canonical validator resolves it.
    editor.append(h('textarea',{...common,rows:4,'aria-label':label,onchange:e=>{try{const v=JSON.parse(e.target.value);change(v);e.target.setCustomValidity('');}catch{e.target.setCustomValidity(T('unknown'));e.target.reportValidity();}}},JSON.stringify(current()??{},null,2)));
  } else if(['number','integer','float','trajectory'].includes(type)||typeof current()==='number'||p.trajectory_modes?.length) {
    const modes=p.trajectory_modes || p.supported_trajectory_modes || (p.trajectory?['constant','step','ramp','annual']:[]);
    if(modes.length>1){
      const mode=h('select',{id:`${id}-trajectory`,'aria-label':`${label}: ${T('trajectory')}`,onchange:e=>{
        const v=current(),scalar=typeof v==='number'?v:v?.value??v?.start??v?.values?.[0]??p.default;
        change(e.target.value==='constant'?scalar:e.target.value==='annual'?{mode:'annual',values:Array(15).fill(scalar)}:{mode:e.target.value,start:scalar,end:scalar,...(e.target.value==='step'?{year:2030}:{})});renderTrajectory();
      }});
      for(const m of modes)mode.append(h('option',{value:m,selected:(current()?.mode||'constant')===m,text:T(m)}));
      editor.append(mode);
    }
    const trajectory=h('div',{class:'lab-trajectory'});editor.append(trajectory);
    function renderTrajectory(){
      clear(trajectory);const v=current(),mode=typeof v==='object'?v?.mode:'constant';
      headingLabel.htmlFor=!mode||mode==='constant'?id:`${id}-trajectory`;
      if(!mode||mode==='constant'){trajectory.append(scalarEditor(typeof v==='object'?v.value:v));return;}
      if(mode==='annual'){
        const values=Array.isArray(v.values)?v.values:Array.from({length:15},(_,i)=>v.values?.[2026+i]);
        const grid=h('div',{class:'lab-annual'});
        values.forEach((value,i)=>grid.append(h('label',{},h('span',{text:lang==='en'?2026+i:2569+i}),numberInput(value,n=>{const latest=current();const next=Array.isArray(latest.values)?[...latest.values]:Array.from({length:15},(_,j)=>latest.values?.[2026+j]);next[i]=n;change({...latest,values:next});},{'aria-label':`${label} ${2026+i}`}))));trajectory.append(grid);
      }else{
        for(const key of ['start','end'])trajectory.append(h('label',{},h('span',{text:T(mode==='step'?(key==='start'?'before':'after'):key)}),numberInput(v[key],n=>change({...current(),[key]:n}),{'aria-label':`${label}: ${T(key)}`})));
        if(mode==='step')trajectory.append(h('label',{},h('span',{text:T('year')}),numberInput(v.year,n=>change({...current(),year:n}),{min:2026,max:2040,step:1,'aria-label':`${label}: ${T('year')}`})));
      }
    }renderTrajectory();
  }else editor.append(h('input',{...common,type:'text',value:typeof current()==='string'?current():'',onchange:e=>change(e.target.value)}));
  const reset=h('button',{type:'button',class:'btn btn--ghost lab-field__reset',text:T('resetOne'),onclick:()=>{change(structuredClone(baseline?.parameters?.[p.id]??p.default));wrapper.replaceWith(parameterField(p,config,{lang,onChange,baseline,compact}));}});
  wrapper.append(editor,h('div',{class:'lab-field__foot'},h('span',{id:`${id}-unit`,class:'lab-field__unit',text:unit}),reset));
  if(helpDetails)wrapper.append(helpDetails);
  return wrapper;
}
