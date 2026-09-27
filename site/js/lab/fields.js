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
export function parameterField(p, config, { lang='th', onChange, baseline } = {}) {
  const T=copy(lang), label=localized(p,'label',lang), help=localized(p,'help',lang);
  const id=`lab-${p.id.replace(/[^a-zA-Z0-9_-]/g,'-')}`;
  const wrapper=h('div',{class:'lab-field','data-parameter':p.id});
  const status=p.evidence_status || p.readiness || p.provenance || p.status;
  const stateLabel=!enabled(p)?T('unavailable'):/assumption|illustrative/.test(status)?T('assumption'):status==='method_setting'?T('methodSetting'):status==='solver_setting'?T('solverSetting'):T('dataSupported');
  wrapper.append(h('div',{class:'lab-field__heading'},h('label',{for:id,text:label}),h('span',{class:'lab-evidence',text:stateLabel})));
  if(help)wrapper.append(h('p',{id:`${id}-help`,class:'lab-help',text:help}));
  if(!enabled(p)) {
    wrapper.append(h('p',{class:'lab-unavailable',text:localized(p,'unsupported_reason',lang)||localized(p,'reason',lang)||p.unsupported_reason||p.status_reason||''}));
    return wrapper;
  }
  const current=()=>config.parameters[p.id] ?? p.default;
  const change=value=>{config.parameters[p.id]=value; onChange?.(p.id,value);};
  const type=p.type || p.value_type, options=p.options || p.enum || p.choices;
  const editor=h('div',{class:'lab-field__editor'});
  const common={id,'aria-describedby':`${id}-help`};
  const minimum=p.hard_domain?.min ?? p.min, maximum=p.hard_domain?.max ?? p.max;
  function numberInput(value,onchange,attrs={}) {
    return h('input',{type:'number',value:Number.isFinite(Number(value))?value:'',step:p.step ?? (type==='integer'?1:'any'),min:minimum,max:maximum,...attrs,
      onchange:e=>{const v=e.target.valueAsNumber; if(!Number.isFinite(v)||!e.target.checkValidity()){e.target.setCustomValidity(T('invalidNumber'));e.target.reportValidity();return;}e.target.setCustomValidity('');onchange(v);},
      oninput:e=>e.target.setCustomValidity('')});
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
      const mode=h('select',{'aria-label':`${label}: ${T('trajectory')}`,onchange:e=>{
        const v=current(),scalar=typeof v==='number'?v:v?.value??v?.start??v?.values?.[0]??p.default;
        change(e.target.value==='constant'?scalar:e.target.value==='annual'?{mode:'annual',values:Array(15).fill(scalar)}:{mode:e.target.value,start:scalar,end:scalar,...(e.target.value==='step'?{year:2030}:{})});renderTrajectory();
      }});
      for(const m of modes)mode.append(h('option',{value:m,selected:(current()?.mode||'constant')===m,text:T(m)}));
      editor.append(mode);
    }
    const trajectory=h('div',{class:'lab-trajectory'});editor.append(trajectory);
    function renderTrajectory(){
      clear(trajectory);const v=current(),mode=typeof v==='object'?v?.mode:'constant';
      if(!mode||mode==='constant'){trajectory.append(numberInput(typeof v==='object'?v.value:v,change,common));return;}
      if(mode==='annual'){
        const values=Array.isArray(v.values)?v.values:Array.from({length:15},(_,i)=>v.values?.[2026+i]);
        const grid=h('div',{class:'lab-annual'});
        values.forEach((value,i)=>grid.append(h('label',{},h('span',{text:lang==='en'?2026+i:2569+i}),numberInput(value,n=>{const latest=current();const next=Array.isArray(latest.values)?[...latest.values]:Array.from({length:15},(_,j)=>latest.values?.[2026+j]);next[i]=n;change({...latest,values:next});},{'aria-label':`${label} ${2026+i}`}))));trajectory.append(grid);
      }else{
        for(const key of ['start','end'])trajectory.append(h('label',{},h('span',{text:T(mode==='step'?(key==='start'?'before':'after'):key)}),numberInput(v[key],n=>change({...current(),[key]:n}),{'aria-label':`${label}: ${T(key)}`})));
        if(mode==='step')trajectory.append(h('label',{},h('span',{text:T('year')}),h('input',{type:'number',min:2026,max:2040,step:1,value:v.year,'aria-label':`${label}: ${T('year')}`,onchange:e=>{if(e.target.checkValidity())change({...current(),year:e.target.valueAsNumber});}})));
      }
    }renderTrajectory();
  }else editor.append(h('input',{...common,type:'text',value:typeof current()==='string'?current():'',onchange:e=>change(e.target.value)}));
  const reset=h('button',{type:'button',class:'btn btn--ghost lab-field__reset',text:T('resetOne'),onclick:()=>{change(structuredClone(baseline?.parameters?.[p.id]??p.default));wrapper.replaceWith(parameterField(p,config,{lang,onChange,baseline}));}});
  wrapper.append(editor,h('div',{class:'lab-field__foot'},h('span',{text:localized(p,'unit',lang)||p.unit||''}),reset));
  return wrapper;
}
