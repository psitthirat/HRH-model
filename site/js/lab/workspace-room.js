// Room "พื้นที่ส่วนตัว" (labview=workspace): the signed-in user's saved results and datasets, their submissions to
// the research team, and their profile.  Items live in the account (Supabase bucket lab-private; only the owner
// can read them).  Design doc sections 5 and 8.
import { h, clear } from '../util/dom.js';
import { LAB_SYSTEM } from './system-config.js';
import { signInGate, isActive } from './account.js';
import { saveBlob } from './exports.js';
import { cadreName } from './labels.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const STATUS = { submitted: ['ได้รับแล้ว', 'Received'], in_review: ['กำลังทบทวน', 'In review'], accepted: ['รับแล้ว', 'Accepted'],
  declined: ['ไม่รับ', 'Declined'], withdrawn: ['ถอนแล้ว', 'Withdrawn'] };
const date = (v, lang) => v ? new Date(v).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const size = n => n == null ? '—' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
export const statusText = (status, lang) => (STATUS[status] || [status, status])[lang === 'en' ? 1 : 0];

export function labelText(summary = {}, lang = 'th') {
  const lb = summary.labels || {}, out = [];
  out.push(lb.data === 'user' ? L(lang, 'ข้อมูลของผู้ใช้', 'user data') : L(lang, 'ข้อมูลโครงการ', 'project data'));
  out.push(lb.scope === 'health_region' ? L(lang, `เขต ${summary.health_region ?? lb.health_region}`, `region ${summary.health_region ?? lb.health_region}`) : L(lang, 'ทั้งประเทศ', 'national'));
  if (lb.cadre && lb.cadre !== 'physicians') out.push(cadreName(lb.cadre, lang));
  return out.join(' · ');
}

export function renderWorkspaceRoom(host, { lang = 'th', account, lab, onOpenRun, onUseDataset, onSubmitRun, onChange }) {
  const root = h('section', { class: 'lab-workspace', 'data-lab-workspace': '' });
  host.append(root);
  let alive = true;
  const status = h('p', { class: 'lab-status', role: 'status', 'aria-live': 'polite' });
  const say = (text, error = false) => { status.textContent = text || ''; status.classList.toggle('lab-status--error', !!error); };
  async function render() {
    clear(root);
    root.append(h('h2', { text: L(lang, 'พื้นที่ส่วนตัว', 'My workspace') }),
      h('p', { class: 'lab-help', text: L(lang, 'ผลและชุดข้อมูลที่คุณบันทึกเก็บในบัญชีของคุณ เห็นได้เฉพาะคุณ ทีมวิจัยเห็นเฉพาะสิ่งที่คุณกดส่ง', 'Results and datasets you save are kept in your account and visible only to you; the team sees only what you submit.') }));
    if (!isActive(account)) { root.append(signInGate(account, { lang, reason: L(lang, 'พื้นที่ส่วนตัวต้องเข้าสู่ระบบ', 'The workspace needs an account'), onSignedIn: () => { onChange?.(); render(); } })); return; }
    const me = account.current();
    root.append(profileCard(me), status);
    const items = h('section', { class: 'lab-workspace__items', 'data-workspace-items': '' }, h('h3', { text: L(lang, 'ผลและชุดข้อมูลที่บันทึก', 'Saved results and datasets') }));
    const subs = h('section', { class: 'lab-workspace__subs', 'data-workspace-submissions': '' }, h('h3', { text: L(lang, 'งานที่ส่งให้ทีมวิจัย', 'Submissions to the research team') }));
    root.append(items, subs);
    try { paintItems(items, await account.listItems()); } catch (error) { items.append(h('p', { class: 'lab-status--error', text: error.message })); }
    try { paintSubs(subs, await account.listSubmissions()); } catch (error) { subs.append(h('p', { class: 'lab-status--error', text: error.message })); }
  }
  function profileCard(me) {
    const p = me.profile || {};
    const form = h('form', { class: 'lab-workspace__profile', 'data-profile-form': '' },
      ...[['full_name', L(lang, 'ชื่อ–นามสกุล', 'Full name')], ['organization', L(lang, 'หน่วยงาน', 'Organisation')], ['position', L(lang, 'ตำแหน่ง', 'Position')], ['province', L(lang, 'จังหวัด/เขต', 'Province or region')]]
        .map(([k, label]) => h('label', {}, h('span', { text: label }), h('input', { name: k, value: p[k] || '', maxlength: 160 }))),
      h('div', { class: 'lab-actions' }, h('button', { type: 'submit', class: 'btn', text: L(lang, 'บันทึกโปรไฟล์', 'Save profile') })));
    form.onsubmit = async e => { e.preventDefault(); try { await account.updateProfile(Object.fromEntries(new FormData(form))); say(L(lang, 'บันทึกโปรไฟล์แล้ว', 'Profile saved')); } catch (error) { say(error.message, true); } };
    const erase = `mailto:${encodeURIComponent(LAB_SYSTEM.submission?.recipient || '')}?subject=${encodeURIComponent('[HRH Lab] ขอลบบัญชีและข้อมูล / account deletion request')}&body=${encodeURIComponent(`${L(lang, 'ขอให้ลบบัญชีและข้อมูลทั้งหมดของ', 'Please delete the account and all data of')} ${me.user.email}`)}`;
    return h('details', { class: 'lab-workspace__account' }, h('summary', { text: `${p.full_name || me.user.email} · ${me.user.email} · ${L(lang, 'บทบาท', 'role')} ${p.role || 'user'}` }),
      form, h('p', { class: 'lab-help' }, L(lang, 'ขอดู แก้ไข หรือลบข้อมูลบัญชีตาม PDPA: ', 'To see, correct or delete your account data (PDPA): '), h('a', { href: erase, text: L(lang, 'ส่งคำขอลบบัญชี', 'request deletion') })));
  }
  function paintItems(box, rows) {
    if (!rows.length) { box.append(h('p', { class: 'lab-help', text: L(lang, 'ยังไม่มีรายการ: กด "บันทึกในพื้นที่ส่วนตัว" ที่ผลหรือชุดข้อมูลที่ต้องการเก็บ', 'Nothing saved yet: use “Save to my workspace” on a result or dataset.') })); return; }
    const engine = lab?.versions?.engine_version;
    box.append(h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table' },
      h('thead', {}, h('tr', {}, ...[L(lang, 'ชื่อ', 'Title'), L(lang, 'ชนิด', 'Kind'), L(lang, 'ป้าย', 'Labels'), L(lang, 'บันทึกเมื่อ', 'Saved'), L(lang, 'ขนาด', 'Size'), ''].map(t => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, ...rows.map(item => {
        const stale = item.kind === 'run' && engine && item.versions?.engine_version && item.versions.engine_version !== engine;
        const act = (text, fn, attrs = {}) => h('button', { type: 'button', class: 'btn btn--small', text, onclick: async () => { try { await fn(); } catch (error) { say(error.message, true); } }, ...attrs });
        return h('tr', { 'data-workspace-item': item.id },
          h('th', { scope: 'row', text: item.title }), h('td', { text: item.kind === 'run' ? L(lang, 'ผล', 'result') : L(lang, 'ชุดข้อมูล', 'dataset') }),
          h('td', { text: item.kind === 'run' ? labelText(item.summary, lang) + (stale ? L(lang, ' · คนละรุ่นตัวคำนวณ', ' · other engine version') : '') : (item.summary?.contract || '') }),
          h('td', { text: date(item.created_at, lang) }), h('td', { text: size(item.size_bytes) }),
          h('td', { class: 'lab-workspace__actions' },
            item.kind === 'run' ? act(L(lang, 'เปิด', 'Open'), async () => { say(L(lang, 'กำลังโหลด…', 'Loading…')); onOpenRun(await account.loadItem(item), item); }, { 'data-action': 'open-item' })
              : act(L(lang, 'ใช้ชุดข้อมูลนี้', 'Use dataset'), async () => onUseDataset(await account.loadItem(item)), { 'data-action': 'use-dataset' }),
            item.kind === 'run' && onSubmitRun ? act(L(lang, 'ส่งให้ทีม', 'Submit'), async () => onSubmitRun(await account.loadItem(item))) : '',
            act(L(lang, 'ดาวน์โหลด', 'Download'), async () => { const data = await account.loadItem(item); saveBlob(`${item.title.replace(/[^\w.-]+/g, '-').slice(0, 80) || 'item'}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); }),
            act(L(lang, 'ลบ', 'Delete'), async () => { if (!confirm(L(lang, `ลบ "${item.title}" ถาวร?`, `Delete “${item.title}” permanently?`))) return; await account.deleteItem(item); say(L(lang, 'ลบแล้ว', 'Deleted')); render(); }, { 'data-action': 'delete-item' })));
      })))));
  }
  function paintSubs(box, rows) {
    if (!rows.length) { box.append(h('p', { class: 'lab-help', text: L(lang, 'ยังไม่มีงานที่ส่ง', 'No submissions yet') })); return; }
    box.append(h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table' },
      h('thead', {}, h('tr', {}, ...[L(lang, 'ส่งเมื่อ', 'Sent'), L(lang, 'ชื่อ', 'Title'), L(lang, 'วัตถุประสงค์', 'Purposes'), L(lang, 'สถานะ', 'Status'), L(lang, 'ความเห็นทีม', 'Team note'), ''].map(t => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, ...rows.map(s => h('tr', { 'data-submission': s.id },
        h('td', { text: date(s.created_at, lang) }), h('th', { scope: 'row', text: s.title }), h('td', { text: (s.purposes || []).join(', ') }),
        h('td', { 'data-submission-status': s.status, text: statusText(s.status, lang) }), h('td', { text: s.reviewer_note || '—' }),
        h('td', {}, ['submitted', 'in_review'].includes(s.status) ? h('button', { type: 'button', class: 'btn btn--small', text: L(lang, 'ถอน', 'Withdraw'),
          onclick: async () => { if (!confirm(L(lang, 'ถอนงานนี้?', 'Withdraw this submission?'))) return; try { await account.updateSubmission(s.id, { status: 'withdrawn' }); render(); } catch (error) { say(error.message, true); } } }) : '')))))));
  }
  render();
  return { destroy() { alive = false; clear(host); }, refresh: render, get alive() { return alive; } };
}
