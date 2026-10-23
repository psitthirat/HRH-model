// Lab home (labview=hub): the four ways in, how the Lab works (interactive structure diagram), where data live,
// national versus regional planning, and what the downloaded plan contains.  Design doc sections 3, 4 and 8.
import { h, clear } from '../util/dom.js';
import { LAB_SYSTEM } from './system-config.js';
import { modeNote } from './account.js';
import { maybeShowTrailer, trailerButton } from './trailer.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const DOORS = [
  { route: 'explore', room: 'explore', tag: ['ไม่ต้องเข้าสู่ระบบ', 'No sign-in'], title: ['สำรวจนโยบาย', 'Explore policy'],
    who: ['มีคำถามเชิงนโยบาย ไม่ต้องมีข้อมูล', 'You have a policy question and no data'],
    does: [['ปรับสมมติฐาน 20 นโยบาย หรือทำซ้ำผลการศึกษา', 'Adjust 20 policy options or reproduce the study'], ['วางแผนทั้งประเทศหรือภายในเขตสุขภาพ', 'Plan nationally or within a health region'], ['ดาวน์โหลดแผนจัดสรรเป็น Excel', 'Download the allocation plan as Excel']],
    cta: ['เริ่มสำรวจ', 'Start exploring'] },
  { route: 'modules', room: 'modules', tag: ['ต้องเข้าสู่ระบบเพื่ออัปโหลด', 'Sign-in to upload'], title: ['โมดูลบริการและโรค', 'Service and disease modules'],
    who: ['มีข้อมูลโรคหรือบริการเฉพาะ', 'You hold disease or service data'],
    does: [['ผู้สูงอายุ ไตวายเรื้อรังระยะสุดท้าย มะเร็ง 5 ตำแหน่ง', 'Older-person care, end-stage kidney disease, five cancers'], ['อัปโหลดตามแม่แบบ ตรวจและปรับฐาน', 'Upload to templates, validate and calibrate'], ['เปรียบเทียบผลเป็นขั้น', 'Staged comparison of results']],
    cta: ['เปิดโมดูล', 'Open modules'] },
  { route: 'mydata', room: 'data', tag: ['ต้องเข้าสู่ระบบ', 'Sign-in required'], title: ['ข้อมูลของฉัน', 'My data'],
    who: ['มีข้อมูลที่เชื่อว่าแม่นกว่าของโครงการ', 'You hold data you trust more than ours'],
    does: [['แทนจำนวนแพทย์หรือตำแหน่ง จ.18 รายจังหวัด', 'Replace physicians or J.18 positions by province'], ['ทันตแพทย์ พยาบาล เภสัชกร (โหมดทั่วไป)', 'Dentists, nurses, pharmacists (generic mode)'], ['เทียบผลกับแผนที่เผยแพร่', 'Compare with the published plan']],
    cta: ['ใช้ข้อมูลของฉัน', 'Use my data'] },
  { route: 'connect', room: 'connect', tag: ['หน่วยงาน · กำลังพัฒนา', 'Agencies · planned'], title: ['เชื่อมต่อข้อมูล (API)', 'Data connections (API)'],
    who: ['เป็นหน่วยงานเจ้าของข้อมูล', 'You are a data-owning agency'],
    does: [['ส่งข้อมูลตามสัญญาข้อมูลเดียวกัน', 'Send data under the same contracts'], ['ระบบตรวจและคำนวณใหม่เป็นฉบับร่าง', 'Automatic checks and draft re-runs'], ['เผยแพร่หลังทีมทบทวน', 'Published after team review']],
    cta: ['ดูแผนการเชื่อมต่อ', 'See the connection plan'] },
];
const STEPS = {
  explore: { stages: ['enter', 'compute', 'result', 'keep'], th: ['เลือกขอบเขต: ทั้งประเทศ หรือเขตสุขภาพ', 'เลือกนโยบายหรือแผนตั้งต้น แล้วปรับสมมติฐาน', 'กดคำนวณแผน: เบราว์เซอร์ของคุณคำนวณเองราว 30–40 วินาทีในครั้งแรก', 'อ่านผล: แผนที่จัดสรร บัญชีแพทย์ กรอบตำแหน่ง ความเป็นธรรม และเก็บไว้เปรียบเทียบได้ 4 แผน', 'ดาวน์โหลดแผนจัดสรร (Excel) หรือเข้าสู่ระบบเพื่อบันทึกในพื้นที่ส่วนตัว'],
    en: ['Choose the scope: national or a health region', 'Choose a policy or a starting plan and adjust assumptions', 'Calculate: your browser computes the plan (30–40 s the first time)', 'Read the results and keep up to four plans for comparison', 'Download the allocation plan (Excel), or sign in to save it in your workspace'] },
  modules: { stages: ['enter', 'compute', 'result', 'keep', 'send', 'review', 'publish'], th: ['เข้าสู่ระบบ', 'เลือกโมดูลและดาวน์โหลดแม่แบบ CSV', 'อัปโหลดข้อมูลโรคหรือบริการ ระบบตรวจและปรับฐานพารามิเตอร์', 'รันและเปรียบเทียบเป็นขั้นกับฐาน', 'บันทึกในพื้นที่ส่วนตัว และกดส่งให้ทีมวิจัยถ้าต้องการให้รวมกับงานของโครงการ'],
    en: ['Sign in', 'Choose a module and download its CSV template', 'Upload your disease or service data; it is validated and calibrated', 'Run and compare with the base step by step', 'Save to your workspace and submit to the team if it should join the project'] },
  mydata: { stages: ['enter', 'compute', 'result', 'keep', 'send', 'review', 'publish'], th: ['เข้าสู่ระบบ', 'ดาวน์โหลดแม่แบบที่กรอกค่าของโครงการไว้แล้ว', 'แก้เฉพาะจังหวัดที่คุณมีข้อมูลดีกว่า แล้วอัปโหลด (.csv หรือ .xlsx)', 'ระบบตรวจตามสัญญาข้อมูล และแสดงผลต่างจากค่าของโครงการ', 'คำนวณ: ผลติดป้าย "ข้อมูลของผู้ใช้" และเทียบกับแผนที่เผยแพร่', 'บันทึก ดาวน์โหลด หรือส่งให้ทีม: ทีมตรวจซ้ำด้วยตัวคำนวณเดียวกันก่อนรวมเป็นข้อมูลรุ่นใหม่'],
    en: ['Sign in', 'Download a template prefilled with the project values', 'Change only the provinces you know better and upload (.csv or .xlsx)', 'The file is checked against its data contract; differences are listed', 'Calculate: the result is labelled “user data” and compared with the published plan', 'Save, download or submit: the team re-checks with the same engine before accepting a new data version'] },
  connect: { stages: ['enter', 'review', 'publish', 'compute'], th: ['หน่วยงานและทีมตกลงชุดข้อมูล ความถี่ และสิทธิ์เผยแพร่', 'หน่วยงานส่งไฟล์หรือเรียก API ตามสัญญาข้อมูล', 'ระบบตรวจอัตโนมัติและเทียบกับรุ่นก่อน', 'คำนวณแผนใหม่ในฉบับร่าง (เฉพาะส่วนที่ไม่ต้องประมาณแบบจำลองใหม่)', 'ทีมทบทวน แล้วเผยแพร่เป็นข้อมูลรุ่นใหม่พร้อมวันที่ของข้อมูล'],
    en: ['Agency and team agree datasets, frequency and publication rights', 'The agency sends files or calls the API under the data contract', 'Automatic checks and comparison with the previous version', 'Draft re-run of the plans (only parts that need no re-estimation)', 'Team review, then publication as a new data version with its date'] },
};
const WORKBOOK = [
  ['Annual_Plan', 'แผนรายจังหวัด–ปี: แพทย์ใหม่ที่รับ ออก กลับเข้า โอน แพทย์ปลายปี เป้าหมาย และเหตุผลของการจัดสรร', 'Province-year plan: appointments, exits, re-entries, transfers, closing stock, target and the reason for each allocation'],
  ['Province_Outcomes', 'ผลรายจังหวัด: อัตราส่วนต่อเป้าหมาย ปีที่ถึงเป้าหมาย สำหรับจัดลำดับความสำคัญ', 'Province outcomes: attainment and the year targets are reached, for prioritising'],
  ['National_Balance', 'ดุลระดับประเทศรายปี: ผู้เข้า–ออก ตำแหน่ง และผู้ที่ไม่มีตำแหน่งรองรับ', 'National balance by year: inflows, outflows, positions and graduates without a vacancy'],
  ['Comparison', 'ความต่างจากแผนหลักที่เผยแพร่ รายจังหวัด–ปี', 'Differences from the published principal plan by province and year'],
  ['Region_Summary', 'เมื่อวางแผนระดับเขต: แผนประเทศเทียบกับแผนเขต รายจังหวัดในเขต', 'Regional plans: national plan versus the regional re-plan for each province'],
  ['Data_Profile', 'เมื่อใช้ข้อมูลของคุณ: ชุดข้อมูลที่แทน จังหวัดที่เปลี่ยน และ checksum', 'With your data: the datasets replaced, provinces changed and checksums'],
  ['Inputs · Readme', 'สมมติฐานทุกค่าที่ใช้จริง รุ่นตัวคำนวณ และวิธีอ่าน', 'Every assumption used, engine versions and how to read the file'],
];

export function renderHub(host, { lang = 'th', account, release, onOpen }) {
  const root = h('section', { class: 'lab-hub', 'data-lab-hub': '' });
  host.append(root);
  root.append(h('div', { class: 'lab-hub__intro' },
    h('h2', { text: L(lang, 'ห้องทดลองวางแผนกำลังคนด้านสุขภาพ', 'A laboratory for health workforce planning') }),
    h('p', { class: 'lab-hub__lead', text: L(lang,
      'เลือกทางเข้าตามสิ่งที่คุณมี ทุกทางใช้ตัวคำนวณชุดเดียวกับงานวิจัย และคำนวณในเบราว์เซอร์ของคุณ ผลทุกชิ้นบอกว่าใช้ข้อมูลของใคร ขอบเขตใด และสมมติฐานแบบไหน',
      'Choose a way in by what you have. Every way uses the same engine as the study and computes in your browser; every result says whose data, which scope and which assumptions it uses.') }),
    trailerButton(lang),
    modeNote(account, lang) || ''));
  maybeShowTrailer(lang);
  const doors = h('div', { class: 'lab-hub__doors', role: 'list' });
  DOORS.forEach((d, i) => doors.append(h('article', { class: `lab-door lab-door--${d.route}`, role: 'listitem', 'data-door': d.route },
    h('p', { class: 'lab-door__number', text: String(i + 1) }),
    h('p', { class: `lab-door__tag${d.route === 'explore' ? ' lab-door__tag--open' : ''}`, text: L(lang, ...d.tag) }),
    h('h3', { text: L(lang, ...d.title) }), h('p', { class: 'lab-door__who', text: L(lang, ...d.who) }),
    h('ul', {}, ...d.does.map(x => h('li', { text: L(lang, ...x) }))),
    h('button', { type: 'button', class: `btn${d.route === 'explore' ? ' btn--primary' : ''}`, 'data-open-room': d.room, text: L(lang, ...d.cta), onclick: () => onOpen(d.room) }))));
  root.append(h('h2', { class: 'lab-hub__heading', text: L(lang, 'เลือกทางเข้าตามสิ่งที่คุณมี', 'Choose a way in') }), doors);

  // How the Lab works: the structure diagram (story/assets/diagrams) driven by route buttons and a step-through.
  const figure = h('figure', { class: 'lab-hub__diagram', 'data-lab-structure': '' });
  const routeBar = h('div', { class: 'lab-hub__routes', role: 'group', 'aria-label': L(lang, 'เส้นทาง', 'Routes') });
  const steps = h('ol', { class: 'lab-hub__steps', 'aria-live': 'polite' });
  const stepTitle = h('h3', { class: 'lab-hub__steps-title' });
  const openRoom = h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'open-route' });
  let svg = null, route = '', stage = '', timer = null;
  const paint = () => {
    if (svg) { svg.dataset.route = route; svg.dataset.stage = stage; }
    routeBar.querySelectorAll('[data-route-button]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.routeButton === route)));
    clear(steps);
    const door = DOORS.find(d => d.route === route);
    stepTitle.textContent = door ? L(lang, `ขั้นตอน: ${door.title[0]}`, `Steps: ${door.title[1]}`) : L(lang, 'เลือกเส้นทางเพื่อดูขั้นตอน', 'Choose a route to see its steps');
    openRoom.hidden = !door;
    if (door) {
      openRoom.textContent = L(lang, ...door.cta); openRoom.onclick = () => onOpen(door.room);
      STEPS[route][lang === 'en' ? 'en' : 'th'].forEach(t => steps.append(h('li', { text: t })));
    }
  };
  const choose = r => { stop(); route = route === r ? '' : r; stage = ''; paint(); };
  const stop = () => { clearInterval(timer); timer = null; play.setAttribute('aria-pressed', 'false'); };
  const play = h('button', { type: 'button', class: 'btn', 'data-action': 'step-through', 'aria-pressed': 'false', text: L(lang, 'ดูทีละขั้น', 'Step through'),
    onclick: () => {
      if (timer) { stop(); stage = ''; paint(); return; }
      if (!route) route = 'mydata';
      const seq = STEPS[route].stages; let i = 0; stage = seq[0]; paint(); play.setAttribute('aria-pressed', 'true');
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      timer = setInterval(() => { i += 1; if (i >= seq.length) { stop(); stage = reduce ? '' : stage; paint(); return; } stage = seq[i]; paint(); }, reduce ? 1 : 1400);
    } });
  DOORS.forEach(d => routeBar.append(h('button', { type: 'button', class: 'btn', 'data-route-button': d.route, 'aria-pressed': 'false', text: L(lang, ...d.title), onclick: () => choose(d.route) })));
  routeBar.append(play);
  const scroll = h('div', { class: 'lab-hub__diagram-scroll' });
  figure.append(scroll, h('figcaption', { class: 'lab-help', text: L(lang,
    'คลิกทางเข้าในแผนภาพหรือปุ่มด้านบนเพื่อดูเส้นทางและขั้นตอน เส้นที่ออกจากพื้นที่ส่วนตัวไปยังทีมวิจัยเกิดขึ้นเฉพาะเมื่อคุณกดส่ง',
    'Click a way in, in the diagram or above, to see its route and steps. Work reaches the research team only when you submit it.') }));
  root.append(h('h2', { class: 'lab-hub__heading', text: L(lang, 'Lab ทำงานอย่างไร', 'How the Lab works') }), routeBar,
    h('div', { class: 'lab-hub__how' }, figure, h('div', { class: 'lab-hub__steps-box' }, stepTitle, steps, openRoom)));
  paint();
  const url = new URL(`../../assets/diagrams/lab_structure_${lang === 'en' ? 'en' : 'th'}.svg`, import.meta.url);
  fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error(String(r.status)))).then(text => {
    if (!root.isConnected) return;
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), node = doc.documentElement;
    if (node.nodeName !== 'svg') throw new Error('not an svg');
    node.querySelectorAll('script, foreignObject').forEach(n => n.remove());          // static asset: never executable
    svg = document.importNode(node, true); scroll.append(svg);
    svg.querySelectorAll('[data-room]').forEach(n => {
      const key = n.dataset.node || n.dataset.room, act = () => choose(key === 'data' ? 'mydata' : key);
      n.addEventListener('click', act); n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    });
    paint();
  }).catch(() => scroll.append(h('ol', { class: 'lab-hub__diagram-fallback' }, ...DOORS.map(d => h('li', { text: `${L(lang, ...d.title)} → ${L(lang, 'ตรวจข้อมูลและคำนวณ → ผลพร้อมป้ายที่มา → พื้นที่ส่วนตัว → ส่งให้ทีมวิจัย', 'validate and compute → labelled results → workspace → submit to the team')}` })))));

  root.append(h('h2', { class: 'lab-hub__heading', text: L(lang, 'ข้อมูลของคุณอยู่ที่ไหน', 'Where your data live') }),
    h('div', { class: 'lab-hub__privacy' },
      h('article', {}, h('h3', { text: L(lang, 'คำนวณในเบราว์เซอร์ของคุณ', 'Computed in your browser') }), h('p', { text: L(lang, 'ตัวคำนวณ Python ทำงานในแท็บนี้ ไฟล์ที่คุณเลือกไม่ถูกส่งไปคำนวณที่ใด', 'The Python engine runs in this tab; files you choose are not sent anywhere for computation.') })),
      h('article', {}, h('h3', { text: L(lang, 'บันทึกในบัญชีของคุณ', 'Saved in your account') }), h('p', { text: L(lang, 'เมื่อกดบันทึก ผลและชุดข้อมูลเก็บในพื้นที่ส่วนตัวที่เห็นได้เฉพาะคุณ (ต้องเข้าสู่ระบบ)', 'When you save, results and datasets go to a private workspace only you can see (sign-in required).') })),
      h('article', {}, h('h3', { text: L(lang, 'ส่งให้ทีมเมื่อคุณกดส่ง', 'Shared when you submit') }), h('p', { text: L(lang, `ทีมวิจัยเห็นเฉพาะแพ็กเกจที่คุณกดส่ง พร้อมอีเมลแจ้ง ${LAB_SYSTEM.submission?.recipient || ''}`, `The team sees only packages you submit, with an email to ${LAB_SYSTEM.submission?.recipient || ''}.`) }))));

  root.append(h('h2', { class: 'lab-hub__heading', text: L(lang, 'วางแผนระดับประเทศหรือระดับเขต', 'National or regional planning') }),
    h('div', { class: 'lab-hub__scope' },
      h('p', { text: L(lang, 'ระดับประเทศจัดสรรแพทย์ใหม่ให้ 76 จังหวัด ระดับเขตตอบคำถาม "เมื่อเขตได้รับแพทย์ใหม่และตำแหน่งจำนวนหนึ่ง ควรกระจายให้จังหวัดในเขตอย่างไร" ด้วยเกณฑ์และข้อมูลของเขต โดยใช้เป้าหมายมาตรฐานเดียวกับทั้งประเทศ',
        'National planning allocates new physicians to 76 provinces. Regional planning asks how a region should distribute the physicians and positions it receives among its provinces, with its own criterion and data, against the same national-standard targets.') }),
      h('button', { type: 'button', class: 'btn', 'data-action': 'try-region', text: L(lang, 'ลองจัดสรรภายในเขต', 'Try a regional plan'), onclick: () => onOpen('explore', { scope: { level: 'health_region', health_region: 1 } }) })));

  root.append(h('h2', { class: 'lab-hub__heading', text: L(lang, 'ในไฟล์ Excel แผนจัดสรรมีอะไร', 'What the Excel allocation plan contains') }),
    h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table lab-hub__workbook' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: L(lang, 'ชีต', 'Sheet') }), h('th', { scope: 'col', text: L(lang, 'ใช้ทำอะไร', 'Use it for') }))),
      h('tbody', {}, ...WORKBOOK.map(([sheet, th, en]) => h('tr', {}, h('th', { scope: 'row', text: sheet }), h('td', { text: L(lang, th, en) })))))),
    h('p', { class: 'lab-help', text: L(lang, 'แผนทุกฉบับเป็นการทดลองภายใต้สมมติฐาน ไม่ใช่การพยากรณ์หรือคำสั่งจัดสรร', 'Every plan is a conditional experiment, not a forecast or an approved allocation.') }));
  return { destroy() { stop(); clear(host); } };
}
