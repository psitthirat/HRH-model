// Room "ทีมวิจัย" (labview=review; reviewers and admins only): incoming submissions, user approval and roles,
// and the approval setting.  Row Level Security decides what each role may read or change; this view only
// offers the actions.  Design doc section 8.4.
import { h, clear } from '../util/dom.js';
import { isReviewer, roleOf } from './account.js';
import { saveBlob } from './exports.js';
import { statusText } from './workspace-room.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const date = (v, lang) => v ? new Date(v).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const CHECK = 'PYTHONPATH=src .venv/bin/python -m workspace.lab_submission check <package.zip> --inputs <release>/lab/inputs.json --lab <release>/lab/lab.json --rerun';

export function renderReview(host, { lang = 'th', account }) {
  const root = h('section', { class: 'lab-review', 'data-lab-review': '' });
  host.append(root);
  let tab = 'submissions';
  const status = h('p', { class: 'lab-status', role: 'status', 'aria-live': 'polite' });
  const say = (text, error = false) => { status.textContent = text || ''; status.classList.toggle('lab-status--error', !!error); };
  async function render() {
    clear(root);
    root.append(h('h2', { text: L(lang, 'ทีมวิจัย: ทบทวนงานที่ส่งมา', 'Research team: review') }));
    if (!isReviewer(account)) { root.append(h('p', { class: 'lab-help', text: L(lang, 'ส่วนนี้สำหรับผู้ทบทวนและผู้ดูแลระบบ', 'For reviewers and administrators only') })); return; }
    const admin = roleOf(account) === 'admin';
    const tabs = h('div', { class: 'lab-mydata__tabs', role: 'tablist' });
    for (const [id, th, en] of [['submissions', 'งานที่ส่งมา', 'Submissions'], ...(admin ? [['users', 'ผู้ใช้', 'Users'], ['settings', 'ตั้งค่า', 'Settings']] : [])])
      tabs.append(h('button', { type: 'button', role: 'tab', class: 'btn', 'aria-selected': String(tab === id), 'data-review-tab': id, text: L(lang, th, en), onclick: () => { tab = id; render(); } }));
    root.append(tabs, status);
    try {
      if (tab === 'submissions') await submissions();
      else if (tab === 'users') await users();
      else await settings();
    } catch (error) { say(error.message, true); }
  }
  async function submissions() {
    const rows = await account.listSubmissions({ all: true });
    root.append(h('p', { class: 'lab-help' }, L(lang, 'ตรวจแพ็กเกจซ้ำด้วยตัวคำนวณเดียวกันใน research tree: ', 'Re-check a package with the same engine in the research tree: '), h('code', { text: CHECK })));
    if (!rows.length) { root.append(h('p', { class: 'lab-help', text: L(lang, 'ยังไม่มีงานที่ส่งมา', 'No submissions yet') })); return; }
    const list = h('div', { class: 'lab-review__list' });
    for (const s of rows) {
      const note = h('textarea', { rows: 2, maxlength: 2000, value: s.reviewer_note || '' }); note.value = s.reviewer_note || '';
      const pick = h('select', { 'aria-label': L(lang, 'สถานะ', 'Status') }, ...['submitted', 'in_review', 'accepted', 'declined'].map(v => h('option', { value: v, selected: s.status === v, text: statusText(v, lang) })));
      const events = h('ol', { class: 'lab-review__events' });
      list.append(h('article', { class: 'lab-review__item', 'data-review-submission': s.id },
        h('h3', { text: s.title }),
        h('p', { class: 'lab-help', text: `${date(s.created_at, lang)} · ${s.submitter?.full_name || ''} · ${s.organization || s.submitter?.organization || ''} · ${s.submitter?.email || ''}` }),
        h('p', { text: `${L(lang, 'วัตถุประสงค์', 'Purposes')}: ${(s.purposes || []).join(', ')} · ${L(lang, 'สถานะ', 'Status')}: ${statusText(s.status, lang)}` }),
        s.data_source ? h('p', { text: `${L(lang, 'ที่มาของข้อมูล', 'Data source')}: ${s.data_source}` }) : '',
        s.message ? h('blockquote', { text: s.message }) : '',
        h('p', { class: 'lab-help', text: `SHA-256 ${s.package_sha256 || '—'}` }),
        h('div', { class: 'lab-review__controls' }, h('label', {}, h('span', { text: L(lang, 'สถานะ', 'Status') }), pick), h('label', {}, h('span', { text: L(lang, 'ความเห็นถึงผู้ส่ง', 'Note to the submitter') }), note)),
        h('div', { class: 'lab-actions' },
          h('button', { type: 'button', class: 'btn', 'data-action': 'download-package', text: L(lang, 'ดาวน์โหลดแพ็กเกจ', 'Download package'),
            onclick: async () => { try { saveBlob(`hrh-lab-submission-${s.id.slice(0, 8)}.zip`, await account.submissionPackage(s)); } catch (error) { say(error.message, true); } } }),
          h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'save-review', text: L(lang, 'บันทึก', 'Save'),
            onclick: async () => { try { await account.updateSubmission(s.id, { status: pick.value, reviewer_note: note.value }); say(L(lang, 'บันทึกแล้ว', 'Saved')); render(); } catch (error) { say(error.message, true); } } }),
          h('button', { type: 'button', class: 'btn', text: L(lang, 'ประวัติ', 'History'),
            onclick: async () => { clear(events); for (const e of await account.submissionEvents(s.id)) events.append(h('li', { text: `${date(e.created_at, lang)} · ${e.action} · ${e.status || ''}${e.note ? ` · ${e.note}` : ''}` })); } })),
        events));
    }
    root.append(list);
  }
  async function users() {
    const rows = await account.listProfiles();
    root.append(h('div', { class: 'table-scroll' }, h('table', { class: 'lab-table', 'data-review-users': '' },
      h('thead', {}, h('tr', {}, ...[L(lang, 'ชื่อ', 'Name'), L(lang, 'อีเมล', 'Email'), L(lang, 'หน่วยงาน', 'Organisation'), L(lang, 'วัตถุประสงค์', 'Purpose'), L(lang, 'ลงทะเบียน', 'Registered'), L(lang, 'บทบาท', 'Role'), L(lang, 'สถานะ', 'Status'), ''].map(t => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, ...rows.map(p => {
        const role = h('select', {}, ...['user', 'reviewer', 'admin'].map(v => h('option', { value: v, selected: p.role === v, text: v })));
        const st = h('select', {}, ...['pending', 'active', 'suspended'].map(v => h('option', { value: v, selected: p.status === v, text: v })));
        return h('tr', { 'data-review-user': p.id }, h('th', { scope: 'row', text: p.full_name || '—' }), h('td', { text: p.email || '' }), h('td', { text: p.organization || '' }),
          h('td', { text: p.purpose || '' }), h('td', { text: date(p.created_at, lang) }), h('td', {}, role), h('td', {}, st),
          h('td', {}, h('button', { type: 'button', class: 'btn btn--small', text: L(lang, 'บันทึก', 'Save'),
            onclick: async () => { try { await account.setUser(p.id, role.value, st.value); say(L(lang, 'บันทึกแล้ว', 'Saved')); } catch (error) { say(error.message, true); } } })));
      })))),
      h('p', { class: 'lab-help', text: L(lang, `ผู้ใช้ทั้งหมด ${rows.length} คน · รออนุมัติ ${rows.filter(r => r.status === 'pending').length} คน`, `${rows.length} users · ${rows.filter(r => r.status === 'pending').length} pending`) }));
  }
  async function settings() {
    const s = await account.settings();
    const box = h('input', { type: 'checkbox', checked: !!s.require_approval });
    root.append(h('label', { class: 'lab-auth__consent' }, box, h('span', { text: L(lang, 'ผู้ใช้ใหม่ต้องรอผู้ดูแลอนุมัติก่อนใช้ส่วนที่ต้องเข้าสู่ระบบ', 'New users wait for approval before using signed-in features') })),
      h('div', { class: 'lab-actions' }, h('button', { type: 'button', class: 'btn btn--primary', text: L(lang, 'บันทึก', 'Save'),
        onclick: async () => { try { await account.updateSettings({ require_approval: box.checked }); say(L(lang, 'บันทึกแล้ว', 'Saved')); } catch (error) { say(error.message, true); } } })));
  }
  render();
  return { destroy() { clear(host); }, refresh: render };
}
