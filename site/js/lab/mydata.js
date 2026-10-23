// Room "ข้อมูลของฉัน" (labview=data): replace project datasets with the user's, or plan another cadre in the
// generic mode.  Contracts and checks live in Python (workspace.lab_data); files are read here as text, converted
// from Excel when needed, and handed to the worker.  Design doc section 6.  Sign-in is required to upload and
// compute (owner decision 23 Oct 2569); the prefilled templates are public data and stay downloadable.
import { h, clear } from '../util/dom.js';
import { saveBlob } from './exports.js';
import { requireSignIn, signInGate, isActive, requiredFor } from './account.js';
import { scopeSelector, scopePayload, NATIONAL } from './scope.js';
import { cadreName } from './labels.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const MAX_BYTES = 5e6;
const PHYSICIAN_SETS = [
  { contract: 'lab.physician_stock/1', file: 'physician_stock', values: ['physicians'],
    title: ['จำนวนแพทย์ต้นแผน (สิ้นปี 2568) รายจังหวัด', 'Physicians at the start of the plan (end of 2025)'],
    affects: ['กระทบ: จำนวนต้นแผนของทุกแผน ขีดรับของตำแหน่งในจังหวัดคงเดิม แพทย์ที่น้อยกว่าข้อมูลของโครงการจึงหมายถึงที่ว่างรองรับแพทย์ใหม่มากขึ้น', 'Affects: the opening stock of every plan; the on-site capacity of the province’s positions is kept, so fewer physicians than the project data leave more room for new ones'],
    keeps: ['ไม่กระทบ: เป้าหมาย ดัชนีความจำเป็น M5 อัตราออก', 'Unchanged: targets, need indices, M5, exit rates'] },
  { contract: 'lab.positions_j18/1', file: 'positions_j18', values: ['positions', 'occupied'],
    title: ['ตำแหน่ง จ.18 รายจังหวัด (ตำแหน่งทั้งหมด และคนครอง)', 'J.18 positions by province (all positions and occupied)'],
    affects: ['กระทบ: ตำแหน่งว่างและขีดรับในกรอบตำแหน่ง (phi = แพทย์ ÷ ผู้ครองตำแหน่ง คำนวณใหม่ตามวิธีของงานวิจัย)', 'Affects: vacancies and frame capacity (phi = physicians ÷ occupied, recomputed as in the study)'],
    keeps: ['ไม่กระทบ: แผนที่ปิดกรอบตำแหน่ง', 'Unchanged: plans without the positions frame'] },
];
const CADRES = ['dentists', 'pharmacists', 'professional_nurses'];
const fmt = (v, d = 0) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });

export function csvText(rows, cols) {
  const q = v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n') + '\n';
}
async function sheetjs() {
  return import('../../vendor/sheetjs/xlsx.mjs').catch(() => import(new URL('../../vendor/sheetjs/xlsx.mjs', import.meta.url).href));
}
export async function xlsxBytes(sheets) {
  const XLSX = await sheetjs(), wb = XLSX.utils.book_new();
  for (const [name, rows, cols] of sheets) {
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows, { header: cols || Object.keys(rows[0]) }) : XLSX.utils.aoa_to_sheet([['—']]);
    ws['!cols'] = (cols || Object.keys(rows[0] || {})).map(c => ({ wch: Math.min(40, Math.max(12, String(c).length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }));
}
// A chosen file as CSV text: .csv/.txt are read as UTF-8; .xlsx/.xls take the sheet named "data", else the first.
export async function fileText(file) {
  if (file.size > MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 5 MB / file larger than 5 MB');
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await sheetjs(), wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const name = wb.SheetNames.includes('data') ? 'data' : wb.SheetNames[0];
    return XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
  }
  return (await file.text()).replace(/^﻿/, '');
}
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Prefilled template rows: project value columns (*_project) for reference, and the editable columns.
function templateRows(set, rows) {
  return rows.map(r => {
    const out = { prov_code: r.prov_code, province: r.province, health_region: r.health_region };
    for (const v of set.values) out[`${v}_project`] = r[v];
    for (const v of set.values) out[v] = r[v];
    return out;
  });
}
const templateCols = set => ['prov_code', 'province', 'health_region', ...set.values.map(v => `${v}_project`), ...set.values];

// Defaults of the generic mode from Chapter 4 (release datasets): MOPH headcount of the latest year by province,
// national recruitment, exit and transfer-in rates per 100 staff.
export function cadreDefaults(release, cadre) {
  const density = release.rows('province_density').filter(r => r.cadre === cadre && r.scope === 'moph');
  const year = Math.max(...density.map(r => Number(r.year)));
  const rows = density.filter(r => Number(r.year) === year).map(r => ({ prov_code: Number(r.prov_code), headcount: Math.round(Number(r.headcount)) }))
    .sort((a, b) => a.prov_code - b.prov_code);
  const flow = (release.rows('flow_intensity').find(r => r.cadre === cadre)) || {};
  const total = rows.reduce((s, r) => s + r.headcount, 0), pop = density.filter(r => Number(r.year) === year).reduce((s, r) => s + Number(r.population || 0), 0);
  const recruitment = Number(flow.recruitment_per100 ?? flow.entries_per100 ?? 0) / 100;
  return { cadre, year, rows, total, population: pop,
    entrants: Math.round(recruitment * total), exit_rate: Number(flow.exits_per100 ?? 5) / 100, reentry_rate: Number(flow.transfer_in_per100 ?? 0) / 100,
    target_per_1000: pop ? Math.round(1e4 * 1000 * total / pop) / 1e4 : 0.2, floor: 0, cap_fraction: 0.3, full_placement: false,
    scope_note: 'สังกัดกระทรวงสาธารณสุข (บทที่ 4)', source_note: '' };
}

export function renderMyData(host, opts) {
  const { lang = 'th', client, account, release, lab, store, draftConfig, onResult, onSave, onSubmit, onChange } = opts;
  const root = h('section', { class: 'lab-mydata', 'data-lab-mydata': '' });
  host.append(root);
  const project = lab.data_templates?.rows || null;
  let busy = false, alive = true;
  const st = store;                                    // persisted by main.js: {tab, datasets, cadre, cadreResult, scope, configSource}
  st.tab ||= 'physicians'; st.datasets ||= {}; st.scope ||= NATIONAL; st.configSource ||= 'study';
  const status = h('p', { class: 'lab-status', role: 'status', 'aria-live': 'polite', 'data-mydata-status': '' });
  const say = (text, error = false) => { status.textContent = text || ''; status.classList.toggle('lab-status--error', !!error); };
  const allowed = () => isActive(account) || !requiredFor('my_data');

  function render() {
    clear(root);
    root.append(h('div', { class: 'lab-mydata__intro' },
      h('h2', { text: L(lang, 'ข้อมูลของฉัน', 'My data') }),
      h('p', { text: L(lang, 'แทนข้อมูลของโครงการด้วยข้อมูลที่คุณเชื่อว่าแม่นกว่า แล้วคำนวณใหม่ด้วยตัวคำนวณชุดเดียวกับงานวิจัย ผลติดป้าย "ข้อมูลของผู้ใช้" และเทียบกับแผนที่เผยแพร่',
        'Replace project data with data you trust more and recompute with the same engine as the study. Results are labelled “user data” and compared with the published plan.') })));
    if (!allowed()) root.append(signInGate(account, { lang, reason: L(lang, 'การอัปโหลดและคำนวณด้วยข้อมูลของคุณต้องเข้าสู่ระบบ ผลที่บันทึกเห็นเฉพาะคุณ ดาวน์โหลดแม่แบบได้โดยไม่ต้องเข้าสู่ระบบ', 'Uploading and computing with your data needs an account; saved items are visible only to you. Templates download without signing in.'), onSignedIn: () => { onChange?.(); } }));
    const tabs = h('div', { class: 'lab-mydata__tabs', role: 'tablist' });
    for (const [id, th, en] of [['physicians', 'แพทย์ · แบบจำลองเต็ม', 'Physicians · full model'], ['cadre', 'วิชาชีพอื่น · โหมดทั่วไป', 'Other cadres · generic mode']])
      tabs.append(h('button', { type: 'button', role: 'tab', class: 'btn', 'data-mydata-tab': id, 'aria-selected': String(st.tab === id), text: L(lang, th, en), onclick: () => { st.tab = id; render(); onChange?.(); } }));
    root.append(tabs);
    if (st.tab === 'physicians') physicians(); else cadre();
    root.append(status);
  }

  // --------------------------------------------------------------- physicians: replace project datasets
  function physicians() {
    if (!project) { root.append(h('p', { class: 'lab-help', text: L(lang, 'ชุดเผยแพร่นี้ยังไม่มีแม่แบบข้อมูล เปิดชุดเผยแพร่ล่าสุด', 'This release has no data templates; open the latest release.') })); return; }
    for (const set of PHYSICIAN_SETS) root.append(datasetCard(set));
    const settings = h('section', { class: 'lab-mydata__settings' }, h('h3', { text: L(lang, 'สมมติฐานและขอบเขตที่ใช้คำนวณ', 'Assumptions and scope') }));
    const source = h('div', { class: 'lab-mydata__source', role: 'radiogroup' });
    for (const [id, th, en] of [['study', 'แผนหลักของการศึกษา (P-R ภายใต้กรอบตำแหน่ง)', 'The study’s principal plan (P-R within the positions frame)'], ['draft', `ฉบับร่างในห้องสำรวจนโยบาย: ${draftConfig()?.name || L(lang, 'ไม่มีชื่อ', 'untitled')}`, `The draft in Explore policy: ${draftConfig()?.name || 'untitled'}`]])
      source.append(h('label', {}, h('input', { type: 'radio', name: 'mydata-config', value: id, checked: st.configSource === id, onchange: () => { st.configSource = id; onChange?.(); render(); } }), h('span', { text: L(lang, th, en) })));
    settings.append(source, scopeSelector({ lang, scope: st.scope, release, params: config().parameters, onChange: s => { st.scope = s; onChange?.(); render(); } }));
    const ready = Object.values(st.datasets).some(d => d.report?.valid);
    const run = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'run-my-data', disabled: busy || !ready || !allowed(),
      text: L(lang, 'คำนวณด้วยข้อมูลของฉัน', 'Calculate with my data'), onclick: runPhysicians });
    settings.append(h('div', { class: 'lab-actions' }, run,
      h('span', { class: 'lab-help', text: ready ? L(lang, 'ใช้ชุดข้อมูลที่ผ่านการตรวจทุกชุดด้านบน', 'Uses every validated dataset above') : L(lang, 'อัปโหลดและตรวจอย่างน้อยหนึ่งชุดก่อน', 'Upload and validate at least one dataset first') })));
    root.append(settings);
  }
  const config = () => st.configSource === 'draft' && draftConfig() ? draftConfig() : lab.default_config;
  // The file chooser must open inside the click (browsers require a user gesture); without an account the
  // click opens the sign-in dialog instead and the user chooses the file afterwards.
  const upload = input => { if (allowed()) input.click(); else requireSignIn(account, lang, L(lang, 'เข้าสู่ระบบเพื่อใช้ข้อมูลของคุณ', 'Sign in to use your data')).then(() => { onChange?.(); render(); }); };

  function datasetCard(set) {
    const d = st.datasets[set.contract];
    const card = h('article', { class: 'lab-dataset', 'data-dataset': set.contract });
    card.append(h('h3', { text: L(lang, ...set.title) }), h('p', { class: 'lab-help', text: L(lang, ...set.affects) }), h('p', { class: 'lab-help', text: L(lang, ...set.keeps) }));
    const rows = templateRows(set, project), cols = templateCols(set);
    const input = h('input', { type: 'file', accept: '.csv,.txt,.xlsx,.xls,text/csv', hidden: true, 'data-dataset-input': set.contract, onchange: async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file || !allowed()) return;
      try { const text = await fileText(file); st.datasets[set.contract] = { name: file.name, text, report: null }; await validate(set.contract); }
      catch (error) { say(error.message, true); }
    } });
    card.append(h('div', { class: 'lab-actions' },
      h('button', { type: 'button', class: 'btn', 'data-template': `${set.file}.xlsx`, text: L(lang, 'แม่แบบ Excel (ค่าของโครงการ)', 'Excel template (project values)'),
        onclick: async () => saveBlob(`hrh-lab-${set.file}-template.xlsx`, new Blob([await xlsxBytes([['data', rows, cols], ['README', readmeRows(set), ['item', 'value']]])], { type: xlsxType })) }),
      h('button', { type: 'button', class: 'btn', 'data-template': `${set.file}.csv`, text: L(lang, 'แม่แบบ CSV', 'CSV template'),
        onclick: () => saveBlob(`hrh-lab-${set.file}-template.csv`, new Blob([csvText(rows, cols)], { type: 'text/csv;charset=utf-8' })) }),
      h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'upload-dataset', disabled: busy, text: L(lang, 'อัปโหลดไฟล์ของฉัน (.xlsx / .csv)', 'Upload my file (.xlsx / .csv)'),
        onclick: () => upload(input) }),
      input,
      d ? h('button', { type: 'button', class: 'btn', text: L(lang, 'ล้าง', 'Clear'), onclick: () => { delete st.datasets[set.contract]; onChange?.(); render(); } }) : ''));
    if (d) card.append(reportView(set, d));
    return card;
  }
  const readmeRows = set => [
    { item: 'วิธีใช้ / How to use', value: L(lang, `แก้เฉพาะคอลัมน์ ${set.values.join(', ')} ของจังหวัดที่คุณมีข้อมูลดีกว่า แล้วอัปโหลดไฟล์นี้ในห้อง "ข้อมูลของฉัน"`, `Edit only the ${set.values.join(', ')} columns for provinces you know better, then upload this file in “My data”.`) },
    { item: 'คอลัมน์ *_project', value: L(lang, 'ค่าของโครงการ ใช้อ้างอิง ระบบไม่อ่านค่าในคอลัมน์นี้', 'Project values for reference; ignored on upload') },
    { item: 'จังหวัดที่ลบออกหรือเว้นว่าง', value: L(lang, 'ใช้ค่าของโครงการ (ไม่เติมศูนย์)', 'Keep the project value (never filled with zero)') },
    { item: 'ห้ามใส่', value: L(lang, 'ข้อมูลรายบุคคล ชื่อ หรือเลขประจำตัว: ระบบรับเฉพาะคอลัมน์ในแม่แบบ', 'Individual records, names or ID numbers: only template columns are accepted') },
    { item: 'Contract', value: set.contract },
  ];
  function reportView(set, d) {
    const r = d.report, box = h('div', { class: 'lab-dataset__report', 'data-dataset-report': set.contract });
    box.append(h('p', { class: 'lab-dataset__file', text: `${L(lang, 'ไฟล์', 'File')}: ${d.name}` }));
    if (!r) { box.append(h('p', { class: 'lab-help', text: L(lang, 'ยังไม่ได้ตรวจ', 'Not validated yet') })); return box; }
    box.append(h('p', { class: `lab-dataset__verdict lab-dataset__verdict--${r.valid ? 'ok' : 'error'}`, 'data-dataset-valid': String(r.valid),
      text: r.valid ? L(lang, `ผ่านการตรวจ: เปลี่ยน ${r.provinces_changed} จังหวัด จาก ${r.provinces_supplied} จังหวัดในไฟล์`, `Valid: ${r.provinces_changed} provinces changed of ${r.provinces_supplied} in the file`)
        : L(lang, 'ไม่ผ่านการตรวจ', 'Not valid') }));
    if (r.errors?.length) box.append(h('ul', { class: 'lab-dataset__errors' }, ...r.errors.slice(0, 12).map(e => h('li', { text: e }))));
    if (r.warnings?.length) box.append(h('ul', { class: 'lab-dataset__warnings' }, ...r.warnings.slice(0, 12).map(e => h('li', { text: e }))));
    if (r.changed?.length) box.append(h('details', { open: r.changed.length <= 8 }, h('summary', { text: L(lang, `จังหวัดที่ต่างจากค่าของโครงการ (${r.changed.length})`, `Values that differ from the project (${r.changed.length})`) }),
      h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table' },
        h('thead', {}, h('tr', {}, ...[L(lang, 'จังหวัด', 'Province'), L(lang, 'ตัวแปร', 'Column'), L(lang, 'ค่าของโครงการ', 'Project'), L(lang, 'ค่าของคุณ', 'Yours'), L(lang, 'ผลต่าง', 'Difference')].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...r.changed.map(c => h('tr', {}, h('th', { scope: 'row', text: c.province }), h('td', { text: c.column }), h('td', { text: fmt(c.project) }), h('td', { text: fmt(c.user) }),
          h('td', { text: `${c.difference > 0 ? '+' : ''}${fmt(c.difference)} (${c.relative > 0 ? '+' : ''}${fmt(100 * c.relative, 1)}%)` }))))))));
    if (r.valid && onSave) box.append(h('div', { class: 'lab-actions' }, h('button', { type: 'button', class: 'btn', 'data-action': 'save-dataset', text: L(lang, 'บันทึกชุดข้อมูลในพื้นที่ส่วนตัว', 'Save dataset to my workspace'),
      onclick: () => onSave({ kind: 'dataset', title: `${L(lang, ...set.title)} · ${d.name}`, summary: { contract: set.contract, provinces_changed: r.provinces_changed, sha256: r.sha256, warnings: r.warnings.length } },
        { contract: set.contract, name: d.name, text: d.text, report: r }) })));
    return box;
  }
  async function validate(contract) {
    busy = true; say(L(lang, 'กำลังตรวจข้อมูลในเบราว์เซอร์ (ครั้งแรกต้องโหลดตัวคำนวณราว 30 วินาที)…', 'Validating in your browser (the first time loads the engine, about 30 s)…')); render();
    try {
      const out = await client.workspace('validate', { datasets: { [contract]: st.datasets[contract].text } });
      st.datasets[contract].report = out.datasets[contract];
      say(out.datasets[contract].valid ? L(lang, 'ตรวจเสร็จ', 'Validated') : L(lang, 'ไฟล์ไม่ผ่านการตรวจ ดูรายการด้านบน', 'The file did not pass; see above'), !out.datasets[contract].valid);
    } catch (error) { say(error.message, true); }
    finally { busy = false; onChange?.(); if (alive) render(); }
  }
  async function runPhysicians() {
    if (busy || !(await requireSignIn(account, lang, L(lang, 'เข้าสู่ระบบเพื่อคำนวณด้วยข้อมูลของคุณ', 'Sign in to compute with your data')))) return;
    const datasets = Object.fromEntries(Object.entries(st.datasets).filter(([, d]) => d.report?.valid).map(([k, d]) => [k, d.text]));
    const cfg = structuredClone(config());
    cfg.name = `${cfg.name || L(lang, 'แผนหลัก', 'Principal plan')} · ${L(lang, 'ข้อมูลของฉัน', 'my data')}`;
    busy = true; say(L(lang, 'กำลังคำนวณด้วยข้อมูลของคุณในเบราว์เซอร์…', 'Computing with your data in your browser…')); render();
    try {
      const result = await client.run(cfg, { workspace: { datasets, scope: scopePayload(st.scope) }, onProgress: e => say(progressText(e)) });
      if (!alive) return;
      if (result.status === 'invalid') { say((result.validation?.errors || []).map(e => e.message).join(' · ') || L(lang, 'คำนวณไม่ได้', 'Could not compute'), true); return; }
      result.user_inputs = { datasets };                 // the run carries its data for saving and submission
      say(L(lang, 'คำนวณเสร็จ: เปิดผลในห้องสำรวจนโยบาย', 'Done: opening the result')); onResult?.(result);
    } catch (error) { say(error.name === 'AbortError' ? L(lang, 'ยกเลิกแล้ว', 'Cancelled') : error.message, error.name !== 'AbortError'); }
    finally { busy = false; if (alive) render(); }
  }
  const progressText = e => {
    const s = e.stage || e.status;
    if (s === 'solving_region') return L(lang, `กำลังจัดสรรภายในเขตสุขภาพที่ ${e.detail?.health_region}…`, `Allocating inside health region ${e.detail?.health_region}…`);
    if (s === 'solving') return L(lang, 'กำลังแก้ปัญหาจัดสรร 15 ปี…', 'Solving the 15-year allocation…');
    if (/loading/.test(s || '')) return L(lang, 'กำลังโหลดตัวคำนวณในเบราว์เซอร์…', 'Loading the engine in your browser…');
    return L(lang, 'กำลังคำนวณ…', 'Computing…');
  };

  // --------------------------------------------------------------- other cadres: generic mode
  function cadre() {
    const c = st.cadre ||= cadreDefaults(release, 'dentists');
    const box = h('section', { class: 'lab-cadre', 'data-lab-cadre': '' });
    box.append(h('p', { class: 'lab-cadre__warning', text: L(lang,
      'โหมดทั่วไป (ทดลอง): ใช้บัญชีกำลังคนและเป้าหมายตามประชากร (เกณฑ์ P) กับตัวจัดสรรเดียวกับแพทย์ ไม่มีกรอบตำแหน่ง การชดใช้ทุน หรือความจำเป็นตามบริการของวิชาชีพนั้น อัตราออกเป็นค่าเดียวทั้งประเทศ',
      'Generic mode (experimental): a stock-flow ledger and population-based targets (family P) with the same allocation model as physicians; no positions frame, bonding or service-based need for this cadre; one national exit rate.') }));
    const pick = h('select', { 'data-cadre-select': '', 'aria-label': L(lang, 'วิชาชีพ', 'Cadre'), onchange: e => { st.cadre = cadreDefaults(release, e.target.value); st.cadreResult = null; onChange?.(); render(); } },
      ...CADRES.map(k => h('option', { value: k, selected: c.cadre === k, text: cadreName(k, lang) })));
    // Shown rounded to the input's step; the stored value keeps full precision until the user edits it.
    const shown = (v, step) => { const d = String(step).includes('.') ? String(step).split('.')[1].length : 0; return v == null ? '' : Number(v).toFixed(d); };
    const num = (key, label, attrs, scale = 1) => h('label', {}, h('span', { text: label }), h('input', { type: 'number', 'data-cadre-field': key, value: shown(c[key] * scale, attrs.step ?? 1), ...attrs,
      onchange: e => { c[key] = e.target.value === '' ? null : Number(e.target.value) / scale; onChange?.(); } }));
    const rowsInput = h('input', { type: 'file', accept: '.csv,.txt,.xlsx,.xls', hidden: true, onchange: async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      try { c.rows_text = await fileText(file); c.rows_name = file.name; c.rows_report = null; say(L(lang, `ใช้จำนวนรายจังหวัดจาก ${file.name} (ตรวจตอนคำนวณ)`, `Using headcounts from ${file.name} (checked when computing)`)); onChange?.(); render(); }
      catch (error) { say(error.message, true); }
    } });
    const tRows = c.rows.map(r => ({ prov_code: r.prov_code, province: release.provinces.get(String(r.prov_code))?.name_th || '', headcount_project: r.headcount, headcount: r.headcount }));
    box.append(h('div', { class: 'lab-cadre__grid' },
      h('label', {}, h('span', { text: L(lang, 'วิชาชีพ', 'Cadre') }), pick),
      num('entrants', L(lang, 'ผู้เข้าใหม่ต่อปี (คน)', 'Entrants per year'), { min: 0, max: 20000, step: 1 }),
      num('exit_rate', L(lang, 'อัตราออกต่อปี (%)', 'Annual exit rate (%)'), { min: 0.1, max: 50, step: 0.01 }, 100),
      num('reentry_rate', L(lang, 'อัตรากลับเข้าต่อปี (%)', 'Annual re-entry rate (%)'), { min: 0, max: 20, step: 0.01 }, 100),
      num('target_per_1000', L(lang, 'เป้าหมายต่อประชากร 1,000 คน', 'Target per 1,000 population'), { min: 0.05, max: 5, step: 0.0001 })),
      h('p', { class: 'lab-help', text: L(lang,
        `ค่าตั้งต้นจากบทที่ 4: ${cadreName(c.cadre, lang)} สังกัด สธ. ปี ${c.year + 543} รวม ${fmt(c.total)} คน ความหนาแน่นปัจจุบัน ${fmt(c.target_per_1000, 3)} ต่อ 1,000 คน อัตรารับเข้า ออก และโอนเข้าเป็นค่าเฉลี่ยของประเทศ (ขอบเขต สป.สธ.) ผู้เข้าใหม่เป็นสมมติฐาน ควรแทนด้วยจำนวนจริงของคุณ`,
        `Defaults from Chapter 4: MOPH ${cadreName(c.cadre, lang)} in ${c.year}, ${fmt(c.total)} in total, current density ${fmt(c.target_per_1000, 3)} per 1,000; recruitment, exit and transfer-in rates are national averages. Entrants are an assumption: replace them with your numbers.`) }),
      h('details', { class: 'lab-cadre__advanced' }, h('summary', { text: L(lang, 'ตัวแปรเพิ่มเติม', 'More settings') }),
        h('div', { class: 'lab-cadre__grid' },
          num('floor', L(lang, 'ขั้นต่ำต่อจังหวัดต่อปี (คน)', 'Provincial minimum per year'), { min: 0, max: 100, step: 1 }),
          num('cap_fraction', L(lang, 'เพดานผู้มาใหม่ (% ของจำนวนต้นปี)', 'Onboarding cap (% of opening stock)'), { min: 0, max: 100, step: 1 }, 100),
          h('label', {}, h('span', { text: L(lang, 'ขอบเขตบุคลากร', 'Workforce scope') }), h('input', { type: 'text', value: c.scope_note, maxlength: 200, onchange: e => { c.scope_note = e.target.value; onChange?.(); } })),
          h('label', {}, h('span', { text: L(lang, 'ที่มาของข้อมูลของคุณ', 'Source of your data') }), h('input', { type: 'text', value: c.source_note, maxlength: 500, onchange: e => { c.source_note = e.target.value; onChange?.(); } })))),
      h('div', { class: 'lab-actions' },
        h('button', { type: 'button', class: 'btn', text: L(lang, 'แม่แบบจำนวนรายจังหวัด (Excel)', 'Headcount template (Excel)'),
          onclick: async () => saveBlob(`hrh-lab-${c.cadre}-headcount-template.xlsx`, new Blob([await xlsxBytes([['data', tRows, ['prov_code', 'province', 'headcount_project', 'headcount']]])], { type: xlsxType })) }),
        h('button', { type: 'button', class: 'btn', 'data-action': 'upload-cadre', text: L(lang, 'อัปโหลดจำนวนรายจังหวัดของฉัน', 'Upload my headcounts'),
          onclick: () => upload(rowsInput) }), rowsInput,
        c.rows_name ? h('span', { class: 'lab-help', 'data-cadre-file': '', text: `${L(lang, 'ไฟล์', 'File')}: ${c.rows_name}` }) : ''));
    box.append(scopeSelector({ lang, scope: st.scope, release, params: { 'allocation.family': 'P', 'frame.rule': 'none' }, onChange: s => { st.scope = s; onChange?.(); render(); }, compact: true }));
    box.append(h('div', { class: 'lab-actions' }, h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'run-cadre', disabled: busy || !allowed(),
      text: L(lang, `คำนวณแผนจัดสรร${cadreName(c.cadre, lang)}`, `Calculate the ${cadreName(c.cadre, lang)} plan`), onclick: runCadre })));
    root.append(box);
    if (st.cadreResult) root.append(cadreResultView(st.cadreResult));
  }
  async function runCadre() {
    if (busy || !(await requireSignIn(account, lang, L(lang, 'เข้าสู่ระบบเพื่อคำนวณด้วยข้อมูลของคุณ', 'Sign in to compute with your data')))) return;
    const c = st.cadre, pkg = { cadre: c.cadre, rows: c.rows_text || c.rows, entrants: c.entrants, exit_rate: c.exit_rate, reentry_rate: c.reentry_rate,
      target_per_1000: c.target_per_1000, floor: c.floor, cap_fraction: c.cap_fraction, full_placement: c.full_placement, scope_note: c.scope_note, source_note: c.source_note };
    busy = true; say(L(lang, `กำลังคำนวณแผน${cadreName(c.cadre, lang)}ในเบราว์เซอร์…`, 'Computing in your browser…')); render();
    try {
      const result = await client.run({ schema_version: 'workforce-lab.scenario/1', name: `${cadreName(c.cadre, lang)} · ${L(lang, 'โหมดทั่วไป', 'generic mode')}`, parameters: {} },
        { workspace: { cadre: pkg, scope: scopePayload(st.scope) }, onProgress: e => say(progressText(e)) });
      if (result.status === 'invalid') { say((result.validation?.errors || []).map(e => e.message).join(' · '), true); return; }
      result.user_inputs = { cadre: pkg };
      st.cadreResult = result; say(L(lang, 'คำนวณเสร็จ', 'Done')); onChange?.();
    } catch (error) { say(error.name === 'AbortError' ? L(lang, 'ยกเลิกแล้ว', 'Cancelled') : error.message, error.name !== 'AbortError'); }
    finally { busy = false; if (alive) render(); }
  }
  function cadreResultView(run) {
    const box = h('section', { class: 'lab-cadre-result', 'data-cadre-result': '' });
    const name = cadreName(run.cadre?.cadre, lang), last = Math.max(...(run.ledger || []).map(r => r.year_ce));
    const provs = cadreProvinces(run), bal = run.national_balance || [];
    const b0 = bal[0] || {}, b1 = bal.at(-1) || {};
    box.append(h('h3', { text: L(lang, `ผลแผนจัดสรร${name} (โหมดทั่วไป)`, `${name} allocation plan (generic mode)`) }),
      h('div', { class: 'lab-cadre-result__cards' },
        card(L(lang, `${name}ต้นแผน`, 'Opening stock'), fmt(b0.opening_stock)), card(L(lang, `${name}ปลายปี ${last + 543}`, `Stock at end of ${last}`), fmt(b1.closing_stock)),
        card(L(lang, `เป้าหมายรวม ปี ${last + 543}`, `National target ${last}`), fmt(b1.target_own)), card(L(lang, 'ผู้เข้าใหม่ที่จัดสรรได้', 'Entrants placed'), fmt(bal.reduce((s, r) => s + Number(r.new_appointments || 0), 0))),
        card(L(lang, 'ไม่มีที่รองรับ', 'Unplaced'), fmt(bal.reduce((s, r) => s + Number(r.unplaced_balance || 0), 0), 1))),
      h('p', { class: 'lab-help', text: L(lang, 'วิธีคำนวณ: บัญชีกำลังคน (ต้นปี − ออก + กลับเข้า + เข้าใหม่) และตัวจัดสรรเดียวกับแพทย์ เป้าหมายตามประชากรที่กำหนด ไม่มีกรอบตำแหน่ง การชดใช้ทุน หรือความจำเป็นตามบริการของวิชาชีพนี้ อัตราออกเป็นค่าเดียวทั้งประเทศ ผลอยู่ในหน้านี้และไม่นำไปเทียบกับแผนของแพทย์',
        run.methods?.generic_mode || '') }),
      h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table' },
        h('thead', {}, h('tr', {}, ...[L(lang, 'จังหวัด', 'Province'), L(lang, 'เขต', 'Region'), L(lang, 'ต้นแผน', 'Start'), L(lang, 'ผู้เข้าใหม่สะสม', 'Entrants'), L(lang, `ปลายปี ${last + 543}`, `End ${last}`), L(lang, 'เป้าหมาย', 'Target'), L(lang, 'ต่อเป้าหมาย', 'Attainment')].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...provs.map(p => h('tr', {}, h('th', { scope: 'row', text: p.province }), h('td', { text: p.health_region }), h('td', { text: fmt(p.start) }), h('td', { text: fmt(p.appointments, 1) }),
          h('td', { text: fmt(p.end, 1) }), h('td', { text: fmt(p.target, 1) }), h('td', { text: `${fmt(100 * p.attainment, 1)}%` })))))));
    box.append(h('div', { class: 'lab-actions' },
      h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'cadre-excel', text: L(lang, 'ดาวน์โหลดแผนจัดสรร (Excel)', 'Download the allocation plan (Excel)'),
        onclick: async () => saveBlob(`hrh-lab-${run.cadre?.cadre}-plan.xlsx`, new Blob([await cadreWorkbookBytes(run)], { type: xlsxType })) }),
      onSave ? h('button', { type: 'button', class: 'btn', 'data-action': 'cadre-save', text: L(lang, 'บันทึกในพื้นที่ส่วนตัว', 'Save to my workspace'), onclick: () => onSave({ kind: 'run', title: run.title || name, summary: summaryOf(run) }, run) }) : '',
      onSubmit ? h('button', { type: 'button', class: 'btn', 'data-action': 'cadre-submit', text: L(lang, 'ส่งให้ทีมวิจัย', 'Submit to the team'), onclick: () => onSubmit(run) }) : ''));
    return box;
  }
  const card = (label, value) => h('div', { class: 'lab-cadre-result__card' }, h('p', { text: label }), h('strong', { text: value }));
  render();
  return { destroy() { alive = false; clear(host); }, refresh: render };
}

// Per-province summary of a generic-mode run: opening stock, entrants, final stock, target and attainment.
export function cadreProvinces(run) {
  const led = run.ledger || [], years = [...new Set(led.map(r => r.year_ce))].sort(), last = years.at(-1), byProv = new Map();
  for (const r of led) {
    const p = byProv.get(r.prov_code) || { prov_code: r.prov_code, province: r.province, health_region: r.health_region, start: null, appointments: 0, end: null, target: null, attainment: null };
    if (r.year_ce === years[0]) p.start = r.opening_headcount;
    p.appointments += Number(r.new_appointments_accepted_starts || 0);
    if (r.year_ce === last) { p.end = r.expected_closing_stock; p.target = r.target_own; p.attainment = r.attainment_own; }
    byProv.set(r.prov_code, p);
  }
  return [...byProv.values()].sort((a, b) => a.attainment - b.attainment);
}

export async function cadreWorkbookBytes(run) {
const provs = cadreProvinces(run);
  const c = run.cadre || {}, cols = ['year_ce', 'year_be', 'prov_code', 'province', 'health_region', 'opening_headcount', 'new_appointments_accepted_starts', 'expected_departures_total', 'expected_reentries', 'expected_closing_stock', 'target_own', 'attainment_own', 'shortfall_own', 'cap_binding', 'floor_binding', 'allocation_reason'];
  const plan = (run.ledger || []).map(r => Object.fromEntries(cols.map(k => [k, r[k]])));
  const readme = [{ item: 'Title / ชื่อ', value: run.title }, { item: 'Cadre / วิชาชีพ', value: `${c.label_th} (${c.label_en}) · generic mode` },
    { item: 'Meaning / การตีความ', value: 'Conditional planning experiment with user data; not a forecast or an approved allocation / แผนภายใต้สมมติฐานด้วยข้อมูลของผู้ใช้ ไม่ใช่การพยากรณ์หรือคำสั่งจัดสรร' },
    { item: 'Method', value: run.methods?.generic_mode }, { item: 'Scope', value: run.methods?.scope }, { item: 'Target', value: run.methods?.target },
    { item: 'Run ID', value: run.run_id }, { item: 'Data profile SHA-256', value: run.data_profile?.sha256 }, ...Object.entries(run.versions || {}).map(([item, value]) => ({ item, value: String(value) }))];
  const inputs = [{ item: 'entrants per year', value: JSON.stringify(c.entrants) }, { item: 'exit rate per year', value: c.exit_rate }, { item: 're-entry rate per year', value: c.reentry_rate },
    { item: 'target per 1,000 population', value: c.target_per_1000 }, { item: 'provincial floor', value: c.floor }, { item: 'onboarding cap (share of opening stock)', value: c.cap_fraction },
    { item: 'workforce scope', value: c.scope_note }, { item: 'source of user data', value: c.source_note }];
  return xlsxBytes([['Readme', readme, ['item', 'value']], ['Inputs', inputs, ['item', 'value']], ['Province_Summary', provs], ['Annual_Plan', plan, cols],
    ['National_Balance', run.national_balance || []], ...(run.regional ? [['Region_Summary', run.regional.provinces], ['Region_Annual', run.regional.annual]] : [])]);
}

// A compact description of a run for workspace lists and submissions.
export function summaryOf(run) {
  const bal = run.national_balance || [], last = bal.at(-1) || {};
  return { plan_id: run.plan_id, status: run.status, labels: run.labels || { data: 'project', scope: 'national', cadre: 'physicians' },
    health_region: run.scope?.health_region ?? null, appointments_total: bal.reduce((s, r) => s + Number(r.new_appointments || 0), 0),
    closing_stock_final: last.closing_stock ?? null, year_final: last.year_ce ?? null, run_id: run.run_id, computation_hash: run.computation_hash };
}
