// Provenance labels of a result beyond the Tier 1 assumption class (design doc section 10): whose data, which
// planning scope and which cadre.  Read only from the completed run, never from the draft controls.
import { h } from '../util/dom.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const CADRE = { physicians: ['แพทย์', 'Physicians'], dentists: ['ทันตแพทย์', 'Dentists'], professional_nurses: ['พยาบาลวิชาชีพ', 'Professional nurses'],
  pharmacists: ['เภสัชกร', 'Pharmacists'], other: ['วิชาชีพอื่น', 'Other cadre'] };

export const dataSource = run => run?.labels?.data || run?.data_profile?.source || 'project';
export const scopeOf = run => run?.scope?.level === 'health_region' ? run.scope : { level: 'national' };
export const cadreOf = run => run?.labels?.cadre || run?.cadre?.cadre || 'physicians';
export const cadreName = (cadre, lang = 'th') => (CADRE[cadre] || CADRE.other)[lang === 'en' ? 1 : 0];
export const scopeName = (run, lang = 'th') => {
  const s = scopeOf(run);
  if (s.level !== 'health_region') return L(lang, 'ทั้งประเทศ', 'National');
  const own = s.family && s.national_family && s.family !== s.national_family ? L(lang, ` · เกณฑ์ ${s.family} ในเขต`, ` · criterion ${s.family} in the region`) : '';
  return L(lang, `เขตสุขภาพที่ ${s.health_region}`, `Health region ${s.health_region}`) + own;
};

export function provenanceBadges(run, lang = 'th') {
  const out = [];
  if (dataSource(run) === 'user') {
    const names = (run.data_profile?.datasets || []).map(d => d.title_th).join(' · ');
    out.push(h('span', { class: 'badge badge--userdata', 'data-label': 'user-data', title: names,
      text: L(lang, 'ข้อมูลของผู้ใช้', 'User data') }));
  }
  if (scopeOf(run).level === 'health_region') out.push(h('span', { class: 'badge badge--scope', 'data-label': 'region', text: scopeName(run, lang) }));
  if (cadreOf(run) !== 'physicians') out.push(h('span', { class: 'badge badge--cadre', 'data-label': 'cadre',
    text: `${cadreName(cadreOf(run), lang)} · ${L(lang, 'โหมดทั่วไป', 'generic mode')}` }));
  if (scopeOf(run).level === 'health_region' || cadreOf(run) !== 'physicians') out.push(h('span', { class: 'badge badge--trial', text: L(lang, 'ทดลอง', 'Experimental') }));
  return out;
}

// Rows for the Readme sheet of every workbook.
export function provenanceRows(run) {
  const s = scopeOf(run), datasets = run.data_profile?.datasets || [];
  return [
    { item: 'Data source / แหล่งข้อมูล', value: dataSource(run) === 'user' ? `user datasets: ${datasets.map(d => d.contract).join(', ')}` : 'project release data' },
    { item: 'Data profile SHA-256', value: run.data_profile?.sha256 || '' },
    { item: 'Planning scope / ขอบเขต', value: s.level === 'health_region' ? `health region ${s.health_region} (allocation re-solved inside the region; allotment: ${s.pool_source}; criterion: ${s.family})` : 'national (76 provinces)' },
    { item: 'Cadre / วิชาชีพ', value: cadreOf(run) === 'physicians' ? 'physicians (full Chapter 5 model)' : `${cadreName(cadreOf(run), 'en')} (generic mode)` },
  ];
}
