// Room "เชื่อมต่อข้อมูล" (labview=connect): the plan for automatic data feeds from agencies (design doc section 9).
// Information only: the local API prototype lives in the research tree (integrations/workforce_api).
import { h, clear } from '../util/dom.js';
import { LAB_SYSTEM } from './system-config.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const WAYS = [
  ['ส่งไฟล์ตามสัญญา', 'File drop under the contract', 'หน่วยงานส่ง Excel/CSV ตามรอบผ่านโฟลเดอร์ร่วม ระบบตรวจอัตโนมัติ เหมาะเป็นจุดเริ่ม', 'The agency drops Excel/CSV files on a schedule; checks run automatically. The starting point.'],
  ['API แบบ push', 'Push API', 'ระบบของหน่วยงานส่งชุดข้อมูลมาที่ POST /v1/datasets ด้วยกุญแจเฉพาะหน่วยงาน', 'The agency system posts snapshots to POST /v1/datasets with its own key.'],
  ['ดึงข้อมูลเปิด', 'Pull open data', 'ระบบของโครงการดึงข้อมูลเปิดตามรอบ เช่น ประชากรและข้อมูลเปิดของกระทรวง', 'The project pulls open data on a schedule, such as population and ministry open data.'],
];
const STAGES = [
  ['รับ', 'Receive', 'บันทึกไฟล์และ manifest แบบเปลี่ยนไม่ได้ ใช้รหัสใหม่ทุกครั้ง', 'Immutable file and manifest with a new identifier'],
  ['ตรวจโครงสร้าง', 'Structure', 'คอลัมน์ หน่วย จังหวัด–ปี ค่าว่าง checksum', 'Columns, units, province-years, blanks, checksum'],
  ['ตรวจความสมเหตุสมผล', 'Plausibility', 'เทียบรุ่นก่อน เตือนเมื่อเปลี่ยนเกินเกณฑ์', 'Compared with the last version; large changes flagged'],
  ['กักไว้', 'Quarantine', 'ชุดที่มีคำเตือนรอผู้ทบทวน', 'Flagged datasets wait for a reviewer'],
  ['วิเคราะห์ผลกระทบ', 'Impact', 'ระบุส่วนที่ต้องคำนวณใหม่หรือประมาณใหม่', 'What must be recomputed or re-estimated'],
  ['คำนวณใหม่ (ฉบับร่าง)', 'Draft re-run', 'แผนที่ไม่ต้องประมาณใหม่คำนวณอัตโนมัติ', 'Plans needing no re-estimation re-run automatically'],
  ['เปรียบเทียบเป็นขั้น', 'Staged comparison', 'แยกผลของข้อมูลใหม่ออกจากผลของการประมาณใหม่', 'New-data effect separated from re-estimation'],
  ['ทบทวนและเผยแพร่', 'Review and publish', 'ผู้ทบทวนอนุมัติ ออกรุ่นใหม่พร้อมวันที่ของข้อมูล', 'Reviewer approval; new release with data dates'],
];

export function renderConnect(host, { lang = 'th', lab }) {
  const root = h('section', { class: 'lab-connect', 'data-lab-connect': '' });
  host.append(root);
  const pilot = LAB_SYSTEM.api_pilot || {};
  const contracts = Object.entries(lab?.data_templates?.contracts || {});
  const mail = `mailto:${encodeURIComponent(LAB_SYSTEM.submission?.recipient || '')}?subject=${encodeURIComponent('[HRH Lab] แจ้งความสนใจเชื่อมต่อข้อมูล / data connection')}&body=${encodeURIComponent(L(lang, 'หน่วยงาน:\nชุดข้อมูลที่ส่งได้:\nความถี่:\nผู้ประสานงาน:\n', 'Agency:\nDatasets:\nFrequency:\nContact person:\n'))}`;
  root.append(h('h2', { text: L(lang, 'เชื่อมต่อข้อมูลอัตโนมัติ (กำลังพัฒนา)', 'Automatic data connections (planned)') }),
    h('p', { text: L(lang, 'หน่วยงานเจ้าของข้อมูลส่งข้อมูลตาม "สัญญาข้อมูล" ชุดเดียวกับที่ผู้ใช้อัปโหลดใน Lab ระบบตรวจ คำนวณแผนใหม่เป็นฉบับร่าง และเผยแพร่หลังทีมทบทวน แบบจำลองจึงทันข้อมูลโดยไม่ข้ามการตรวจทางวิชาการ',
      'Data-owning agencies send data under the same contracts users upload in the Lab. The system checks them, re-runs the plans as a draft and publishes after team review, so the model keeps up with the data without skipping scientific review.') }),
    h('section', { class: 'lab-connect__pilot' }, h('h3', { text: L(lang, `หน่วยงานนำร่อง: ${pilot.agency_th || ''}`, `Pilot agency: ${pilot.agency_en || ''}`) }),
      h('ul', {}, ...(lang === 'en' ? pilot.datasets_en || [] : pilot.datasets_th || []).map(t => h('li', { text: t })))),
    h('h3', { text: L(lang, 'สามทางรับข้อมูล', 'Three ways in') }),
    h('div', { class: 'lab-connect__ways' }, ...WAYS.map(([th, en, dth, den]) => h('article', {}, h('h4', { text: L(lang, th, en) }), h('p', { text: L(lang, dth, den) })))),
    h('h3', { text: L(lang, 'สายการประมวลผล 8 ขั้น', 'Eight-stage pipeline') }),
    h('ol', { class: 'lab-connect__stages' }, ...STAGES.map(([th, en, dth, den]) => h('li', {}, h('strong', { text: L(lang, th, en) }), ' — ', L(lang, dth, den)))),
    h('h3', { text: L(lang, 'อะไรคำนวณใหม่อัตโนมัติได้', 'What may re-run automatically') }),
    h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table' },
      h('thead', {}, h('tr', {}, ...[L(lang, 'ชั้น', 'Class'), L(lang, 'ตัวอย่าง', 'Examples'), L(lang, 'อัตโนมัติ', 'Automatic')].map(t => h('th', { scope: 'col', text: t })))),
      h('tbody', {},
        h('tr', {}, h('th', { scope: 'row', text: 'recompute' }), h('td', { text: L(lang, 'จำนวนบุคลากรต้นปี ตำแหน่ง จ.18 ประชากรตามสิทธิ ภาระโรค', 'Opening headcounts, J.18 positions, entitlement population, burden') }), h('td', { text: L(lang, 'ได้ (ฉบับร่าง)', 'Yes (draft)') })),
        h('tr', {}, h('th', { scope: 'row', text: 'refit' }), h('td', { text: L(lang, 'อัตราออก แบบจำลองบริการ M5 การคาดการณ์บริการ', 'Exit rates, the M5 service model, service projections') }), h('td', { text: L(lang, 'ไม่ได้: นักวิจัยประมาณใหม่และทบทวน', 'No: researchers re-estimate and review') })),
        h('tr', {}, h('th', { scope: 'row', text: 'evaluation only' }), h('td', { text: L(lang, 'ภาระโรคที่ลดได้ในการประเมินผลสุขภาพ', 'Avoidable burden in the health-gain evaluation') }), h('td', { text: L(lang, 'ได้', 'Yes') }))))),
    contracts.length ? h('h3', { text: L(lang, 'สัญญาข้อมูลที่ใช้ได้แล้ว', 'Data contracts available now') }) : '',
    contracts.length ? h('ul', {}, ...contracts.map(([id, c]) => h('li', {}, h('code', { text: id }), ` — ${L(lang, c.title_th, c.title_en)}`))) : '',
    h('div', { class: 'lab-actions' }, h('a', { class: 'btn btn--primary', href: mail, text: L(lang, 'แจ้งความสนใจเป็นหน่วยงานเชื่อมต่อข้อมูล', 'Register interest as a data partner') })));
  return { destroy() { clear(host); } };
}
