// Data-ready service modules (older-person care, ESRD, cancer) inside the Workforce Lab.
// Files chosen by the user are read with FileReader and handed, as text, to the canonical
// Python in the browser worker. Nothing is uploaded to a server and nothing is stored.
import { h, s, clear } from '../util/dom.js';
import { download } from '../ui/table.js';

const MAX_BYTES = 25e6;
// Test hook (?labdebug): the last run's config and result stay readable for the native/browser
// agreement test.  Off on the public page; nothing is sent anywhere in either case.
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('labdebug');
const T = {
  th: {
    title: 'โมดูลบริการที่พร้อมรับข้อมูล (ทดลอง)',
    lead: 'โครงสร้างแบบจำลองพร้อมแล้ว แต่ต้องใช้ข้อมูลของผู้ใช้จึงจะคำนวณได้: อัปโหลดไฟล์ตามแม่แบบ ระบบจะตรวจข้อมูล ปรับฐานพารามิเตอร์ที่ประมาณได้จากข้อมูล ให้คุณทบทวน แล้วจึงรัน',
    privacy: 'ไฟล์ถูกประมวลผลในเบราว์เซอร์ของคุณเท่านั้น ไม่ถูกส่งไปยังเซิร์ฟเวอร์ และไม่ถูกบันทึกเมื่อปิดหน้า',
    reviewWarning: 'คำเตือน: โครงสร้างของโมดูลไตวายเรื้อรังระยะสุดท้าย (ESRD) และมะเร็ง ยังไม่ผ่านการทบทวนโดยผู้เชี่ยวชาญ โมดูลทั้งหมดในหน้านี้เป็นโครงสร้างฉบับร่าง',
    dataWarning: 'ยังต้องการข้อมูลจริงสำหรับการรันให้ได้ผลจริง ผลจากข้อมูลสังเคราะห์สาธิตใช้ทดลองการทำงานของโมดูลเท่านั้น ไม่ใช่ค่าประมาณของประเทศไทย และไม่ควรนำไปใช้ตัดสินใจ',
    draft: 'โครงสร้างฉบับร่าง — รอผู้เชี่ยวชาญทบทวน', back: 'กลับไป Lab การจัดสรร', datasets: 'ชุดข้อมูล',
    required: 'จำเป็น', optional: 'ไม่บังคับ', template: 'แม่แบบ CSV', upload: 'เลือกไฟล์ CSV', clear: 'ล้าง',
    notLoaded: 'ยังไม่มีข้อมูล', synthetic: 'ใช้ข้อมูลสังเคราะห์สาธิตทั้งหมด', validate: 'ตรวจข้อมูลและปรับฐาน',
    run: 'รันแบบจำลอง', params: 'พารามิเตอร์หลังปรับฐาน', results: 'ผลลัพธ์', national: 'ระดับประเทศรายปี',
    province: 'รายจังหวัด ปีสุดท้าย', metric: 'ตัวชี้วัด', loading: 'กำลังคำนวณในเบราว์เซอร์…',
    edit: 'แก้ค่า (JSON) — เฉพาะสมมติฐานและนโยบาย', downloadJSON: 'ดาวน์โหลดผล (JSON)', downloadCSV: 'ดาวน์โหลดตาราง (CSV)',
    errors: 'ข้อผิดพลาด', warnings: 'คำเตือน', calibration: 'การปรับฐาน', columns: 'คอลัมน์', source: 'ที่มา',
    kind: { estimated: 'ประมาณจากข้อมูล', assumption: 'สมมติฐาน', policy: 'นโยบาย' }, ok: 'ผ่าน', rows: 'แถว',
    needValidate: 'ตรวจข้อมูลก่อนรัน', stale: 'ข้อมูลหรือค่าพารามิเตอร์เปลี่ยน — ตรวจใหม่ก่อนรัน', question: 'คำถาม',
    residence: 'ตามจังหวัดที่ผู้ป่วยอาศัย (ความจำเป็น)', provider: 'ตามจังหวัดที่ให้บริการ (ภาระงาน)', basis: 'มุมมอง',
    providerDefault: 'ไม่มีข้อมูลการส่งต่อ: ถือว่ารับบริการในจังหวัดที่อาศัย ทั้งสองมุมมองจึงเท่ากัน',
    providerFlows: 'ย้ายภาระงานไปยังจังหวัดที่ให้บริการตามข้อมูลการส่งต่อ ยอดรวมประเทศเท่าเดิม',
    tables: { informal_care_national: 'การดูแลโดยผู้ดูแลในครอบครัว — แสดงแยก ไม่ใช่ FTE ของบุคลากรสุขภาพ',
      screening_national_by_site_year: 'การคัดกรองมะเร็ง (เส้นทางแยก) รายตำแหน่ง — ไม่เปลี่ยนระยะโรคเอง',
      screening_national_by_year: 'FTE ของการคัดกรองและการตรวจวินิจฉัยต่อ (แยกจากการรักษา)',
      activity_national: 'กิจกรรมตามสถานที่', deliverable_national: 'บริการที่ให้ได้จริงเทียบกับที่ต้องการ',
      hospital_avoided_national: 'ครั้งบริการในโรงพยาบาลที่ลดลง' },
    staged: 'เปรียบเทียบแบบเป็นขั้น', setBase: 'ใช้ชุดข้อมูลปัจจุบันเป็นฐานเปรียบเทียบ', runStaged: 'เปรียบเทียบกับฐาน',
    stagedHelp: 'แยกผลของข้อมูลใหม่ (ตรึงค่าที่ปรับฐานไว้) การปรับฐานใหม่/สมมติฐาน และการเปลี่ยนนโยบาย ออกจากกัน',
    baseSet: 'ตั้งฐานแล้ว: อัปโหลดหรือแก้ข้อมูลชุดใหม่ แล้วกดเปรียบเทียบ', sameAsBase: 'ข้อมูลยังเหมือนฐาน',
    steps: { base: 'ฐาน', new_data_fixed_calibration: 'ข้อมูลใหม่', recalibrated: 'ปรับฐานใหม่', policy: 'นโยบาย' },
  },
  en: {
    title: 'Data-ready service modules (experimental)',
    lead: 'The model structure is ready but needs your data: upload files following the templates; the system validates them, calibrates the parameters that data can estimate, lets you review, then runs.',
    privacy: 'Files are processed only in your browser. They are not sent to any server and are not kept after you close the page.',
    reviewWarning: 'Warning: the end-stage renal disease (ESRD) and cancer module structures have not yet been reviewed by clinical experts. Every module on this page is a draft structure.',
    dataWarning: 'Real data are still required before these modules can produce usable results. Synthetic demonstration data only show how a module works; they are not estimates for Thailand and should not inform decisions.',
    draft: 'Draft structure — pending expert review', back: 'Back to the allocation Lab', datasets: 'Datasets',
    required: 'required', optional: 'optional', template: 'CSV template', upload: 'Choose CSV', clear: 'Clear',
    notLoaded: 'No data', synthetic: 'Use synthetic demonstration data', validate: 'Validate and calibrate',
    run: 'Run model', params: 'Parameters after calibration', results: 'Results', national: 'National, by year',
    province: 'By province, final year', metric: 'Metric', loading: 'Computing in your browser…',
    edit: 'Edit (JSON) — assumptions and policy only', downloadJSON: 'Download result (JSON)', downloadCSV: 'Download table (CSV)',
    errors: 'Errors', warnings: 'Warnings', calibration: 'Calibration', columns: 'Columns', source: 'Source',
    kind: { estimated: 'estimated from data', assumption: 'assumption', policy: 'policy' }, ok: 'valid', rows: 'rows',
    needValidate: 'Validate before running', stale: 'Data or parameters changed — validate again before running', question: 'Question',
    residence: 'By province of residence (need)', provider: 'By providing province (workload)', basis: 'View',
    providerDefault: 'No referral data: care is assumed to be delivered in the province of residence, so both views are equal',
    providerFlows: 'Workload moved to the providing province using the referral flows; national totals unchanged',
    tables: { informal_care_national: 'Informal caregiver care — shown separately, not health-workforce FTE',
      screening_national_by_site_year: 'Cancer screening (separate pathway) by site — does not change stage by itself',
      screening_national_by_year: 'Screening and diagnostic follow-up FTE (separate from treatment)',
      activity_national: 'Activities by setting', deliverable_national: 'Deliverable versus required care',
      hospital_avoided_national: 'Hospital visits avoided' },
    staged: 'Staged comparison', setBase: 'Use current datasets as the comparison base', runStaged: 'Compare with base',
    stagedHelp: 'Separates the effect of new data (calibration frozen), refitting/assumption changes, and policy changes',
    baseSet: 'Base set: upload or edit the new datasets, then compare', sameAsBase: 'Data still equal to the base',
    steps: { base: 'base', new_data_fixed_calibration: 'new data', recalibrated: 'refit', policy: 'policy' },
  },
};

const fmt = v => typeof v === 'number' ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 3 }))
  : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) + (JSON.stringify(v).length > 80 ? '…' : '') : String(v);
const RAW = new Set(['year', 'prov_code', 'year_since_dx']);           // identifiers: never thousands-separated
const cell = (key, v) => RAW.has(key) ? String(v ?? '') : fmt(v);
const csv = rows => {
  if (!rows?.length) return '';
  const cols = Object.keys(rows[0]);
  const q = v => { const t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n') + '\n';
};

function table(rows, { limit = 100 } = {}) {
  if (!rows?.length) return h('p', { class: 'lab-help', text: '—' });
  const cols = Object.keys(rows[0]);
  return h('div', { class: 'svc-table-wrap' }, h('table', { class: 'svc-table' },
    h('thead', {}, h('tr', {}, cols.map(c => h('th', { scope: 'col', text: c })))),
    h('tbody', {}, rows.slice(0, limit).map(r => h('tr', {}, cols.map(c => h('td', { text: cell(c, r[c]) })))))));
}

// One series at a time: the metric is chosen by the user, so no categorical palette is needed.
function lineChart(rows, key, label) {
  const pts = rows.filter(r => typeof r[key] === 'number').map(r => [r.year, r[key]]);
  const W = 640, H = 240, m = { l: 64, r: 16, t: 16, b: 34 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svc-chart', role: 'img', 'aria-label': `${label}: ${key}` });
  if (pts.length < 2) return svg;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys) * 1.08 || 1;
  const X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = v => H - m.b - v / y1 * (H - m.t - m.b);
  for (let i = 0; i <= 4; i++) {
    const v = y1 * i / 4;
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'svc-grid' }),
      s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'svc-axis', text: fmt(v) }));
  }
  for (const yr of xs.filter((_, i) => i % 3 === 0 || i === xs.length - 1))
    svg.append(s('text', { x: X(yr), y: H - 10, 'text-anchor': 'middle', class: 'svc-axis', text: String(yr + 543) }));
  svg.append(s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0])},${Y(p[1])}`).join(''), class: 'svc-line' }));
  const last = pts[pts.length - 1];
  svg.append(s('circle', { cx: X(last[0]), cy: Y(last[1]), r: 4, class: 'svc-dot' }),
    s('text', { x: X(last[0]) - 6, y: Y(last[1]) - 10, 'text-anchor': 'end', class: 'svc-label', text: fmt(last[1]) }));
  return svg;
}

export function renderServiceModules(host, { client, lang = 'th', onBack }) {
  const t = T[lang] || T.th;
  const state = { spec: null, module: null, datasets: {}, overrides: {}, validation: null, result: null, busy: false, stale: true,
    view: 'residence', base: null, staged: null };
  const root = h('section', { class: 'svc', 'aria-labelledby': 'svc-title' });
  host.append(root);
  const status = h('p', { class: 'lab-status', role: 'status', 'aria-live': 'polite' });
  const say = (text, error = false) => { status.textContent = text || ''; status.classList.toggle('lab-status--error', !!error); };

  async function call(op, payload) {
    state.busy = true; say(t.loading); paint();
    try { return await client.service(op, payload); }
    catch (e) { say(e.message || String(e), true); throw e; }
    finally { state.busy = false; }
  }
  const markStale = () => { state.stale = true; state.validation = state.validation && { ...state.validation, ok: false }; };

  function datasetRow(ds) {
    const loaded = state.datasets[ds.id];
    const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > MAX_BYTES) { say(`${f.name}: > ${MAX_BYTES / 1e6} MB`, true); return; }
      state.datasets[ds.id] = { text: await f.text(), name: f.name, synthetic: false }; markStale(); paint();
    } });
    return h('li', { class: 'svc-dataset', 'data-dataset': ds.id },
      h('div', { class: 'svc-dataset__head' },
        h('strong', { text: lang === 'en' ? ds.label_en : ds.label_th }),
        h('span', { class: 'lab-evidence', text: ds.required_for_run ? t.required : t.optional }),
        h('span', { class: 'svc-chip' + (loaded ? ' svc-chip--on' : ''), text: loaded ? `${loaded.name}${loaded.synthetic ? ' · SYNTHETIC' : ''}` : t.notLoaded })),
      h('p', { class: 'lab-help', text: ds.description }),
      h('p', { class: 'lab-help', text: `${t.columns}: ${ds.columns.map(c => c.name + (c.unit ? ` (${c.unit})` : '') + (c.required ? '' : '?')).join(', ')}` }),
      h('div', { class: 'lab-actions' },
        h('button', { type: 'button', class: 'btn', text: t.template, onclick: () => download(`template_${ds.id}.csv`, ds.template_csv) }),
        h('button', { type: 'button', class: 'btn', text: t.upload, 'data-action': `upload-${ds.id}`, onclick: () => file.click() }), file,
        loaded && h('button', { type: 'button', class: 'btn', text: t.clear, onclick: () => { delete state.datasets[ds.id]; markStale(); paint(); } })));
  }

  function paramTable(params) {
    return h('div', { class: 'svc-table-wrap' }, h('table', { class: 'svc-table svc-params' },
      h('thead', {}, h('tr', {}, ['id', '', 'kind', 'value', t.source].map(c => h('th', { scope: 'col', text: c })))),
      h('tbody', {}, params.map(p => {
        const editable = p.kind !== 'estimated' || p.source === 'user';
        const cell = editable ? h('input', { type: 'text', value: JSON.stringify(p.value), 'aria-label': `${p.id} JSON`, title: t.edit,
          onchange: e => { try { state.overrides[p.id] = JSON.parse(e.target.value); markStale(); paint(); } catch { say(`${p.id}: JSON`, true); } } })
          : h('span', { text: fmt(p.value) });
        return h('tr', {}, h('td', { text: p.id }), h('td', { text: p.label_th }), h('td', { text: t.kind[p.kind] || p.kind }), h('td', {}, cell),
          h('td', { text: `${p.source}${p.note ? ' — ' + p.note : ''}` }));
      }))));
  }

  function reports(v) {
    const box = h('div', { class: 'svc-reports' });
    if (v.errors?.length) box.append(h('div', { class: 'svc-alert svc-alert--error' }, h('strong', { text: t.errors }), h('ul', {}, v.errors.map(e => h('li', { text: e })))));
    for (const [id, r] of Object.entries(v.datasets || {})) {
      box.append(h('div', { class: 'svc-alert' + (r.ok ? '' : ' svc-alert--error'), 'data-report': id },
        h('strong', { text: `${id}: ${r.ok ? t.ok : t.errors} (${r.rows ?? 0} ${t.rows})` }),
        (r.errors?.length || r.warnings?.length) && h('ul', {}, [...(r.errors || []), ...(r.warnings || [])].map(e => h('li', { text: e })))));
    }
    return box;
  }

  function results(r) {
    const box = h('div', { class: 'svc-results', 'data-module-result': r.module });
    box.append(h('h3', { text: t.results }));
    box.append(h('p', { class: `svc-evidence svc-evidence--${r.evidence_label}`, text: r.evidence_text }));
    if (r.warnings?.length) box.append(h('div', { class: 'svc-alert' }, h('strong', { text: t.warnings }), h('ul', {}, r.warnings.map(w => h('li', { text: w })))));
    const nat = r.tables.national_by_year || [];
    const keys = nat.length ? Object.keys(nat[0]).filter(k => k !== 'year' && typeof nat[0][k] === 'number') : [];
    const chartHost = h('div', {});
    const pick = h('select', { 'aria-label': t.metric, onchange: e => { clear(chartHost); chartHost.append(lineChart(nat, e.target.value, t.national)); } },
      keys.map(k => h('option', { value: k, text: k })));
    if (keys.length) { chartHost.append(lineChart(nat, keys[0], t.national)); box.append(h('label', { class: 'svc-metric' }, h('span', { text: t.metric }), pick), chartHost); }
    box.append(h('h4', { text: t.national }), table(nat));
    if (r.tables.national_by_site_year) box.append(h('h4', { text: 'site × year' }), table(r.tables.national_by_site_year, { limit: 30 }));
    const provider = r.tables.province_last_year_provider;
    const view = provider && state.view === 'provider' ? 'provider' : 'residence';
    const provRows = view === 'provider' ? provider : r.tables.province_last_year;
    box.append(h('h4', { text: t.province }));
    if (provider) {
      box.append(h('div', { class: 'svc-basis', role: 'radiogroup', 'aria-label': t.basis },
        ['residence', 'provider'].map(v => h('button', { type: 'button', class: 'btn svc-basis__btn', role: 'radio', 'aria-checked': String(view === v),
          'data-basis': v, text: t[v], onclick: () => { state.view = v; paint(); } }))),
        h('p', { class: 'lab-help', 'data-provider-basis': r.checks?.provider_basis || '',
          text: r.checks?.provider_basis === 'referral_flows' ? t.providerFlows : t.providerDefault }));
    }
    box.append(h('div', { 'data-province-view': view }, table(provRows, { limit: 80 })));
    const shown = new Set(['national_by_year', 'national_by_site_year', 'province_last_year', 'province_last_year_provider', 'province_year']);
    for (const [key, rows] of Object.entries(r.tables)) {
      if (shown.has(key) || !Array.isArray(rows)) continue;
      box.append(h('h4', { text: t.tables[key] || key }), h('div', { 'data-table': key }, table(rows, { limit: 60 })));
    }
    box.append(h('div', { class: 'lab-actions' },
      h('button', { type: 'button', class: 'btn', text: t.downloadJSON, onclick: () => download(`${r.module}_result.json`, JSON.stringify(r, null, 1), 'application/json') }),
      h('button', { type: 'button', class: 'btn', text: t.downloadCSV, onclick: () => download(`${r.module}_national.csv`, csv(nat)) }),
      h('button', { type: 'button', class: 'btn', text: `${t.downloadCSV} — ${t.province}`, onclick: () => download(`${r.module}_province_${view}.csv`, csv(provRows)) })));
    box.append(stagedPanel());
    return box;
  }

  const sameData = (a, b) => JSON.stringify(Object.keys(a || {}).sort().map(k => [k, a[k].text])) === JSON.stringify(Object.keys(b || {}).sort().map(k => [k, b[k].text]));

  function stagedPanel() {
    const box = h('section', { class: 'svc-staged', 'data-staged': state.staged?.status || (state.base ? 'base' : 'none') },
      h('h4', { text: t.staged }), h('p', { class: 'lab-help', text: t.stagedHelp }));
    const differs = state.base && !sameData(state.base, state.datasets);
    box.append(h('div', { class: 'lab-actions' },
      h('button', { type: 'button', class: 'btn', text: t.setBase, 'data-action': 'svc-set-base', disabled: state.busy,
        onclick: () => { state.base = JSON.parse(JSON.stringify(state.datasets)); state.staged = null; paint(); } }),
      h('button', { type: 'button', class: 'btn', text: t.runStaged, 'data-action': 'svc-staged', disabled: state.busy || !differs,
        title: state.base && !differs ? t.sameAsBase : '',
        onclick: async () => { state.staged = await call('staged', { module: state.module, base: { datasets: state.base }, new: { datasets: state.datasets }, overrides: state.overrides });
          say(state.staged.status === 'completed' ? '' : (state.staged.errors || []).join('; '), state.staged.status !== 'completed'); paint(); } })));
    if (state.base && !state.staged) box.append(h('p', { class: 'lab-help', text: differs ? t.baseSet : t.sameAsBase }));
    const g = state.staged;
    if (g?.status === 'completed') {
      box.append(h('ol', { class: 'svc-steps' }, g.steps.map(st => h('li', { 'data-verdict': st.verdict },
        h('strong', { text: `${t.steps[st.from_stage]} → ${t.steps[st.to_stage]}: ${st.verdict_th}` }),
        h('span', { class: 'lab-help', text: ' ' + Object.entries(st.changes).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') }),
        ...(st.blocking || []).concat(st.caveats || []).map(x => h('p', { class: 'lab-help', text: x }))))));
      box.append(table(g.headline), h('p', { class: 'lab-help', text: g.note_th }));
    }
    return box;
  }

  function paint() {
    clear(root);
    root.append(h('header', { class: 'svc-head' },
      h('h2', { id: 'svc-title', text: t.title }),
      h('div', { class: 'svc-warning', role: 'note', 'data-warning': 'expert-review' },
        h('p', { text: t.reviewWarning }), h('p', { class: 'svc-warning__data', text: t.dataWarning })),
      h('p', { text: t.lead }), h('p', { class: 'svc-privacy', text: t.privacy }),
      h('button', { type: 'button', class: 'btn', text: t.back, onclick: onBack })));
    if (!state.spec) { root.append(status); return; }
    const cards = h('div', { class: 'svc-cards', role: 'list' });
    for (const [id, m] of Object.entries(state.spec.modules)) {
      cards.append(h('button', { type: 'button', class: 'svc-card', role: 'listitem', 'aria-pressed': String(state.module === id), 'data-module': id,
        onclick: () => { if (state.module !== id) { state.module = id; state.datasets = {}; state.overrides = {}; state.validation = null; state.result = null; state.stale = true;
          state.base = null; state.staged = null; state.view = 'residence'; say(''); paint(); } } },
        h('strong', { text: lang === 'en' ? m.label_en : m.label_th }), h('span', { class: 'lab-help', text: m.question_th }),
        h('span', { class: 'lab-evidence', text: t.draft })));
    }
    root.append(cards);
    if (!state.module) { root.append(status); return; }
    const m = state.spec.modules[state.module];
    root.append(h('h3', { text: t.datasets }), h('ul', { class: 'svc-datasets' }, m.datasets.map(datasetRow)));
    const validateBtn = h('button', { type: 'button', class: 'btn', text: t.validate, 'data-action': 'svc-validate', disabled: state.busy || !Object.keys(state.datasets).length,
      onclick: async () => { state.validation = await call('validate', { module: state.module, datasets: state.datasets, overrides: state.overrides }); state.stale = false; state.result = null;
        say(state.validation.ok ? '' : t.errors, !state.validation.ok); paint(); } });
    const runBtn = h('button', { type: 'button', class: 'btn btn--primary', text: t.run, 'data-action': 'svc-run', disabled: state.busy || state.stale || !state.validation?.ok,
      title: state.stale ? t.needValidate : '',
      onclick: async () => { state.result = await call('run', { module: state.module, datasets: state.datasets, overrides: state.overrides });
        if (DEBUG) window.__serviceRun = { config: { module: state.module, datasets: state.datasets, overrides: state.overrides }, result: state.result };
        say(state.result.status === 'completed' ? '' : (state.result.errors || []).join('; '), state.result.status !== 'completed'); paint(); } });
    root.append(h('div', { class: 'lab-actions' },
      h('button', { type: 'button', class: 'btn', text: t.synthetic, 'data-action': 'svc-synthetic', disabled: state.busy,
        onclick: async () => { state.datasets = await call('synthetic', { module: state.module }); markStale(); say(''); paint(); } }),
      validateBtn, runBtn), status);
    if (state.stale && state.validation) root.append(h('p', { class: 'lab-help', text: t.stale }));
    if (state.validation) {
      root.append(h('p', { class: `svc-evidence svc-evidence--${state.validation.evidence_label}`, text: state.validation.evidence_text }), reports(state.validation));
      if (state.validation.parameters) root.append(h('details', { class: 'svc-param-box', open: true }, h('summary', { text: t.params }), paramTable(state.validation.parameters)));
    }
    if (state.result?.status === 'completed') root.append(results(state.result));
  }

  paint();
  call('describe', {}).then(spec => { state.spec = spec; say(''); paint(); }).catch(() => paint());
  return { destroy() { root.remove(); } };
}
