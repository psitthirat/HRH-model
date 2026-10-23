// Planning scope: national (76 provinces) or one health region (design doc section 7).  The regional plan is
// computed by workspace.lab_data: national plan first, then the allocation re-solved inside the region with the
// region's allotment.  This module holds the selector and the regional summary of a completed run.
import { h } from '../util/dom.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const FAMILIES = [['', 'ตามเกณฑ์ของแผนประเทศ', 'Same criterion as the national plan'], ['P', 'P ประชากร', 'P population'],
  ['S', 'S บริการ', 'S services'], ['N-STD', 'N ความจำเป็น', 'N need'], ['B', 'B ภาระโรค', 'B burden of disease']];
export const NATIONAL = Object.freeze({ level: 'national' });

// Reasons the draft cannot be planned inside a region (mirrors lab_data.regional_support; Python decides).
export function regionalBlockers(params = {}, lang = 'th') {
  const why = [];
  if (!['P', 'S', 'N-STD', 'B'].includes(params['allocation.family'])) why.push(L(lang, 'เกณฑ์ N-FB และ SQ-C ใช้ได้เฉพาะระดับประเทศ', 'N-FB and SQ-C are national only'));
  if (params['planning.mode'] && params['planning.mode'] !== 'fixed_schedule') why.push(L(lang, 'การปรับแผนรายปีใช้ได้เฉพาะระดับประเทศ', 'annual replanning is national only'));
  if (params['mobility.enabled']) why.push(L(lang, 'การโอนย้ายใช้ได้เฉพาะระดับประเทศ', 'transfers are national only'));
  if (params['uncertainty.enabled']) why.push(L(lang, 'ความไม่แน่นอนใช้ได้เฉพาะระดับประเทศ', 'uncertainty is national only'));
  if (['F3', 'GDh', 'GDc'].includes(params['frame.rule'])) why.push(L(lang, 'กรอบตำแหน่ง F3, GDh และ GDc ใช้ได้เฉพาะระดับประเทศ', 'F3, GDh and GDc frames are national only'));
  if (params['allocation.objective'] === 'maximin') why.push(L(lang, 'เป้าหมาย maximin ใช้ได้เฉพาะระดับประเทศ', 'maximin is national only'));
  if (Number(params['allocation.population_reserved_share'] || 0) > 0) why.push(L(lang, 'โควตาตามประชากรใช้ได้เฉพาะระดับประเทศ', 'population quotas are national only'));
  return why;
}

export function regionProvinces(release, region) {
  return [...(release?.provinces?.values?.() || [])].filter(p => Number(p.health_region) === Number(region) && p.status_76 !== 'excluded_by_design')
    .map(p => p.name_th);
}

// Scope selector.  scope: {level, health_region, family, pool}; onChange receives the next scope object.
export function scopeSelector({ lang = 'th', scope = NATIONAL, release, params, onChange, compact = false }) {
  const box = h('fieldset', { class: `lab-scope-picker${compact ? ' lab-scope-picker--compact' : ''}`, 'data-scope-picker': '' },
    h('legend', { text: L(lang, 'ขอบเขตการวางแผน', 'Planning scope') }));
  const regional = scope.level === 'health_region';
  const emit = patch => onChange({ ...scope, ...patch });
  const radio = (value, text) => h('label', { class: 'lab-scope-picker__option' },
    h('input', { type: 'radio', name: 'lab-scope-level', value, checked: (value === 'health_region') === regional,
      onchange: () => onChange(value === 'national' ? NATIONAL : { level: 'health_region', health_region: scope.health_region || 1, family: scope.family || '', pool: scope.pool ?? null }) }),
    h('span', { text }));
  box.append(h('div', { class: 'lab-scope-picker__levels' }, radio('national', L(lang, 'ทั้งประเทศ (76 จังหวัด)', 'National (76 provinces)')),
    radio('health_region', L(lang, 'เขตสุขภาพ (จัดสรรภายในเขต)', 'Health region (allocate within the region)'))));
  if (regional) {
    const region = h('select', { 'aria-label': L(lang, 'เขตสุขภาพ', 'Health region'), 'data-scope-region': '', onchange: e => emit({ health_region: Number(e.target.value) }) },
      ...Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: Number(scope.health_region) === i + 1, text: L(lang, `เขตสุขภาพที่ ${i + 1}`, `Health region ${i + 1}`) })));
    const family = h('select', { 'aria-label': L(lang, 'เกณฑ์ของเขต', 'Regional criterion'), 'data-scope-family': '', onchange: e => emit({ family: e.target.value }) },
      ...FAMILIES.map(([v, th, en]) => h('option', { value: v, selected: (scope.family || '') === v, text: L(lang, th, en) })));
    const custom = scope.pool != null && scope.pool !== '';
    const pool = h('input', { type: 'number', min: 0, max: 20000, step: 1, value: custom ? scope.pool : '', disabled: !custom, 'data-scope-pool': '',
      'aria-label': L(lang, 'จำนวนแพทย์ใหม่ของเขตต่อปี', 'New physicians for the region per year'), onchange: e => emit({ pool: e.target.value === '' ? null : Number(e.target.value) }) });
    const poolMode = h('select', { 'aria-label': L(lang, 'จำนวนที่เขตได้รับ', 'Regional allotment'), 'data-scope-pool-mode': '',
      onchange: e => emit({ pool: e.target.value === 'national_plan' ? null : (Number(scope.pool) || 100) }) },
      h('option', { value: 'national_plan', selected: !custom, text: L(lang, 'ตามที่แผนประเทศวางในเขต', 'As placed by the national plan') }),
      h('option', { value: 'user', selected: custom, text: L(lang, 'กำหนดเอง (คนต่อปี)', 'Enter a number per year') }));
    box.append(h('div', { class: 'lab-scope-picker__grid' },
      h('label', {}, h('span', { text: L(lang, 'เขต', 'Region') }), region),
      h('label', {}, h('span', { text: L(lang, 'เกณฑ์จัดสรรภายในเขต', 'Criterion inside the region') }), family),
      h('label', {}, h('span', { text: L(lang, 'จำนวนแพทย์ใหม่ของเขต', 'New physicians for the region') }), poolMode),
      h('label', {}, h('span', { text: L(lang, 'คนต่อปี (ถ้ากำหนดเอง)', 'per year (if entered)') }), pool)));
    const names = regionProvinces(release, scope.health_region || 1);
    if (names.length) box.append(h('p', { class: 'lab-help', text: L(lang, `จังหวัดในเขต: ${names.join(' · ')}`, `Provinces: ${names.join(' · ')}`) }));
    const blockers = regionalBlockers(params, lang);
    if (blockers.length) box.append(h('p', { class: 'lab-scope-picker__blocked', 'data-scope-blocked': '', text: L(lang, 'สมมติฐานปัจจุบันใช้ระดับเขตไม่ได้: ', 'Not available for the current assumptions: ') + blockers.join('; ') }));
    box.append(h('p', { class: 'lab-help', text: L(lang,
      'วิธีคำนวณ: คำนวณแผนประเทศก่อน แล้วจัดสรรใหม่เฉพาะจังหวัดในเขตด้วยแบบจำลองเดียวกันและเป้าหมายมาตรฐานเดียวกับทั้งประเทศ จังหวัดนอกเขตใช้แผนประเทศเดิม (ทดลอง)',
      'Method: the national plan is computed first, then the allocation is re-solved for the region with the same model and national-standard targets; other provinces keep the national plan (experimental).') }));
  }
  return box;
}

export const scopeIsRegional = scope => scope?.level === 'health_region';
export function scopePayload(scope) {
  if (!scopeIsRegional(scope)) return NATIONAL;
  const out = { level: 'health_region', health_region: Number(scope.health_region) || 1 };
  if (scope.family) out.family = scope.family;
  if (scope.pool != null && scope.pool !== '') out.pool = Number(scope.pool);
  return out;
}

const fmt = (v, d = 0) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });

// The regional summary of a completed regional run (national plan vs regional re-plan).
export function regionalSummary(run, lang = 'th') {
  const rg = run?.regional;
  if (!rg) return null;
  const box = h('section', { class: 'lab-regional-summary', 'data-regional-summary': '' },
    h('h3', { text: L(lang, `สรุปเขตสุขภาพที่ ${rg.health_region}: แผนประเทศเทียบกับการจัดสรรภายในเขต`, `Health region ${rg.health_region}: national plan versus the regional re-plan`) }),
    h('p', { class: 'lab-help', text: rg.method_th }));
  const sc = run.scope || {};
  if (sc.family && sc.national_family && sc.family !== sc.national_family) box.append(h('p', { class: 'lab-regional-summary__note', 'data-regional-family': sc.family,
    text: L(lang, `เกณฑ์ภายในเขต: ${sc.family} (แผนประเทศใช้ ${sc.national_family}) จำนวนที่เขตได้รับยังมาจากแผนประเทศ`, `Criterion inside the region: ${sc.family} (the national plan uses ${sc.national_family}); the allotment still comes from the national plan`) }));
  if (rg.note_th) box.append(h('p', { class: 'lab-regional-summary__note', text: rg.note_th }));
  const rows = [...rg.provinces].sort((a, b) => a.attainment_2040_regional_plan - b.attainment_2040_regional_plan);
  const published = rows.some(r => r.appointments_published_plan != null) && run?.data_profile?.source === 'user';
  box.append(h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table' },
    h('thead', {}, h('tr', {}, ...[L(lang, 'จังหวัด', 'Province'), ...(published ? [L(lang, 'แพทย์ใหม่ 2569–2583: แผนที่เผยแพร่', 'New physicians 2026–2040: published plan')] : []),
      L(lang, published ? 'แผนประเทศ (ข้อมูลของผลนี้)' : 'แพทย์ใหม่ 2569–2583: แผนประเทศ', published ? 'national plan (this run’s data)' : 'New physicians 2026–2040: national plan'),
      L(lang, 'แผนเขต', 'regional plan'), L(lang, 'ผลต่าง', 'difference'), L(lang, 'แพทย์ปลายปี 2583 / เป้าหมาย: แผนประเทศ', '2040 stock / target: national'),
      L(lang, 'แผนเขต', 'regional')].map(t => h('th', { scope: 'col', text: t })))),
    h('tbody', {}, ...rows.map(r => h('tr', {}, h('th', { scope: 'row', text: r.province }),
      ...(published ? [h('td', { text: fmt(r.appointments_published_plan, 1) })] : []),
      h('td', { text: fmt(r.appointments_national_plan, 1) }), h('td', { text: fmt(r.appointments_regional_plan, 1) }),
      h('td', { text: (r.difference > 0 ? '+' : '') + fmt(r.difference, 1) }),
      h('td', { text: fmt(100 * r.attainment_2040_national_plan, 1) + '%' }), h('td', { text: fmt(100 * r.attainment_2040_regional_plan, 1) + '%' })))))));
  const first = rg.annual[0], last = rg.annual[rg.annual.length - 1];
  box.append(h('p', { class: 'lab-help', text: L(lang,
    `จำนวนที่เขตได้รับ ${fmt(first.allotment_used, 1)} คนในปี ${first.year_be} … ${fmt(last.allotment_used, 1)} คนในปี ${last.year_be}; ไม่มีตำแหน่งรองรับรวม ${fmt(rg.annual.reduce((s, a) => s + a.unplaced, 0), 1)} คน`,
    `Regional allotment ${fmt(first.allotment_used, 1)} in ${first.year_ce} … ${fmt(last.allotment_used, 1)} in ${last.year_ce}; unplaced in total ${fmt(rg.annual.reduce((s, a) => s + a.unplaced, 0), 1)}`) }));
  box.append(h('details', { class: 'lab-regional-summary__limits' }, h('summary', { text: L(lang, 'ข้อจำกัดของการจัดสรรภายในเขต', 'Limitations of the regional plan') }),
    h('ul', {}, ...(rg.limitations_th || []).map(t => h('li', { text: t })))));
  return box;
}
