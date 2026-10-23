// "ส่งให้ทีมวิจัย" (design doc section 8): a self-checking package (ZIP), a submission record in the user's
// account (Supabase: table submissions + bucket lab-submissions; reviewers see it, other users never do) and an
// email drafted for the user to send.  The research side checks the package with
//   PYTHONPATH=src .venv/bin/python -m workspace.lab_submission check <zip> --inputs <release>/lab/inputs.json --rerun
import { h, clear } from '../util/dom.js';
import { LAB_SYSTEM } from './system-config.js';
import { requireSignIn, sha256Hex } from './account.js';
import { workbookBytes, saveBlob } from './exports.js';
import { cadreWorkbookBytes, summaryOf, csvText } from './mydata.js';
import { scopeName, cadreName, cadreOf, dataSource } from './labels.js';

const L = (lang, th, en) => lang === 'en' ? en : th;
const PURPOSES = [['review', 'ขอให้ทีมตรวจและให้ความเห็น', 'Ask the team to check and comment'],
  ['merge', 'ขอให้รวมข้อมูลเข้ากับฐานข้อมูลของโครงการ', 'Ask the team to merge the data into the project'],
  ['publish', 'ขอให้เผยแพร่ผลบนเว็บ', 'Ask for the result to be published on the website']];
const FILES = { 'lab.physician_stock/1': 'data/physician_stock.csv', 'lab.positions_j18/1': 'data/positions_j18.csv' };
const enc = new TextEncoder();

export async function buildPackage(run, { lang = 'th', lab, release, form, account }) {
  const { zipSync, strToU8 } = await import('../../vendor/fflate/browser.js');
  const files = {}, datasets = [];
  const me = account.current();
  const user = run.user_inputs || {};
  files['scenario.json'] = strToU8(JSON.stringify({ schema_version: 'workforce-lab.scenario/1', config: run.config, resolved_config: run.resolved_config,
    scope: run.scope || { level: 'national' }, versions: run.versions }, null, 2));
  for (const [contract, text] of Object.entries(user.datasets || {})) {
    const path = FILES[contract] || `data/${contract.replace(/[^\w]+/g, '_')}.csv`;
    files[path] = strToU8(text);
    const prof = (run.data_profile?.datasets || []).find(d => d.contract === contract) || {};
    datasets.push({ contract, file: path, sha256_contract: prof.sha256 || null, provinces_changed: prof.provinces_changed ?? null });
  }
  let cadre = null;
  if (run.cadre && user.cadre) {
    const rows = typeof user.cadre.rows === 'string' ? user.cadre.rows : csvText(user.cadre.rows, ['prov_code', 'headcount']);
    files['data/cadre.csv'] = strToU8(rows.replace(/^﻿/, ''));
    cadre = Object.fromEntries(Object.entries(user.cadre).filter(([k]) => k !== 'rows'));
    datasets.push({ contract: 'lab.cadre/1', file: 'data/cadre.csv', sha256_contract: run.cadre.sha256 });
  }
  const summary = summaryOf(run);
  files['result_summary.json'] = strToU8(JSON.stringify(summary, null, 2));
  try {
    files['allocation.xlsx'] = run.cadre ? await cadreWorkbookBytes(run) : await workbookBytes(run, { lab, lang, release });
  } catch { /* an incomplete run has no plan workbook; the scenario and data still travel */ }
  files['README.txt'] = strToU8([
    'HRH Workforce Lab — submission package / แพ็กเกจส่งงาน',
    '',
    'submission.json   who, why, versions and the SHA-256 of every file / ผู้ส่ง วัตถุประสงค์ รุ่น และ checksum',
    'scenario.json     the assumptions used / สมมติฐานที่ใช้จริง',
    'data/*.csv        the user datasets (aggregate, by province) / ชุดข้อมูลของผู้ใช้ (ข้อมูลรวมรายจังหวัด)',
    'allocation.xlsx   the allocation plan / แผนจัดสรร',
    '',
    'Research team check / ทีมวิจัยตรวจด้วย:',
    '  PYTHONPATH=src .venv/bin/python -m workspace.lab_submission check <this.zip> --inputs <release>/lab/inputs.json --lab <release>/lab/lab.json --rerun',
  ].join('\n') + '\n');
  const digests = {};
  for (const [name, bytes] of Object.entries(files)) digests[name] = await sha256Hex(bytes);
  const id = crypto.randomUUID();
  const manifest = { schema_version: 'hrh-lab.submission/1', submission_id: id, created_at: new Date().toISOString(), title: form.title,
    purposes: form.purposes, message: form.message, data_source: form.data_source,
    submitter: { name: me?.profile?.full_name || '', organization: form.organization, email: me?.user?.email || '' },
    consent: { aggregate_only: true, use_for_purposes: true, at: new Date().toISOString() },
    release_id: release?.id, versions: run.versions, scope: run.scope || { level: 'national' }, cadre, labels: run.labels || null,
    result: { run_id: run.run_id, computation_hash: run.computation_hash, status: run.status, plan_id: run.plan_id },
    datasets, files: digests };
  files['submission.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const bytes = zipSync(files, { level: 6 });
  return { id, manifest, bytes, summary };
}

export function emailDraft({ lang = 'th', run, manifest, sub, account, hash }) {
  const me = account.current(), purposes = PURPOSES.filter(([k]) => manifest.purposes.includes(k)).map(([, th, en]) => L(lang, th, en));
  const data = dataSource(run) === 'user'
    ? (run.data_profile?.datasets || []).map(d => `${d.title_th}${d.provinces_changed != null ? ` (${d.provinces_changed} จังหวัด)` : ''}`).join('; ')
    : L(lang, 'ข้อมูลของโครงการ', 'project data');
  const subject = `${LAB_SYSTEM.submission?.subject_prefix || '[HRH Lab]'} ${purposes.join(' / ')}: ${manifest.title} (${String(sub?.id || manifest.submission_id).slice(0, 8)})`;
  const body = L(lang, [
    'เรียน ทีมวิจัยโครงการกำลังคนด้านสุขภาพ', '',
    `ข้าพเจ้าส่งผลจาก Workforce Lab เพื่อ: ${purposes.join('; ')}`,
    `ชื่อผล: ${manifest.title}`, `รหัสส่งงาน: ${sub?.id || manifest.submission_id}`,
    `ผู้ส่ง: ${me?.profile?.full_name || ''} (${manifest.submitter.organization}${me?.profile?.position ? `, ${me.profile.position}` : ''}) อีเมลบัญชี: ${me?.user?.email || ''}`,
    `ขอบเขต: ${scopeName(run, 'th')} · วิชาชีพ: ${cadreName(cadreOf(run), 'th')} · ข้อมูล: ${data}`,
    manifest.data_source ? `ที่มาของข้อมูล: ${manifest.data_source}` : '', manifest.message ? `ข้อความเพิ่มเติม: ${manifest.message}` : '', '',
    sub ? `แพ็กเกจบันทึกในระบบ Lab แล้ว (SHA-256 ${hash.slice(0, 16)}…)` : 'แนบไฟล์แพ็กเกจ .zip ที่ดาวน์โหลดไว้',
    'ข้าพเจ้ายืนยันว่าข้อมูลเป็นข้อมูลรวมระดับจังหวัด ไม่มีข้อมูลรายบุคคล และยินยอมให้ทีมวิจัยใช้ตามวัตถุประสงค์ข้างต้น', '',
    'ขอบคุณ', me?.profile?.full_name || ''].filter(x => x !== '').join('\n'), [
    'Dear HRH research team,', '',
    `I am submitting a Workforce Lab result for: ${purposes.join('; ')}`,
    `Title: ${manifest.title}`, `Submission ID: ${sub?.id || manifest.submission_id}`,
    `From: ${me?.profile?.full_name || ''} (${manifest.submitter.organization}) account email: ${me?.user?.email || ''}`,
    `Scope: ${scopeName(run, 'en')} · cadre: ${cadreName(cadreOf(run), 'en')} · data: ${data}`,
    manifest.data_source ? `Source of the data: ${manifest.data_source}` : '', manifest.message ? `Message: ${manifest.message}` : '', '',
    sub ? `The package is stored in the Lab (SHA-256 ${hash.slice(0, 16)}…).` : 'The .zip package is attached.',
    'The data are aggregate province-level figures without individual records, and I agree to their use for the purposes above.', '',
    'Thank you', me?.profile?.full_name || ''].filter(x => x !== '').join('\n'));
  const to = LAB_SYSTEM.submission?.recipient || '';
  return { to, subject, body,
    mailto: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

export async function openSubmitDialog({ lang = 'th', account, run, lab, release, onDone }) {
  if (!(await requireSignIn(account, lang, L(lang, 'การส่งผลให้ทีมวิจัยต้องเข้าสู่ระบบ ทีมจะติดต่อกลับทางอีเมลของบัญชี', 'Submitting to the team needs an account; the team replies to its email')))) return null;
  return new Promise(resolve => {
    const me = account.current();
    const dialog = h('dialog', { class: 'lab-submit', 'aria-labelledby': 'lab-submit-title', 'data-submit-dialog': '' });
    const close = value => { dialog.close(); dialog.remove(); resolve(value); onDone?.(value); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    const status = h('p', { class: 'lab-auth__message', role: 'status', 'aria-live': 'polite' });
    const form = h('form', { class: 'lab-auth__form', 'data-submit-form': '' },
      h('fieldset', { class: 'lab-submit__purposes' }, h('legend', { text: L(lang, 'ต้องการให้ทีมทำอะไร', 'What should the team do') }),
        ...PURPOSES.map(([value, th, en], i) => h('label', {}, h('input', { type: 'checkbox', name: 'purpose', value, checked: i === 0 }), h('span', { text: L(lang, th, en) })))),
      h('label', {}, h('span', { text: L(lang, 'ชื่อผล', 'Title') }), h('input', { name: 'title', required: true, maxlength: 160, value: run.config?.name || run.title || '' })),
      h('label', {}, h('span', { text: L(lang, 'หน่วยงาน', 'Organisation') }), h('input', { name: 'organization', required: true, maxlength: 160, value: me?.profile?.organization || '' })),
      h('label', {}, h('span', { text: L(lang, 'ที่มาของข้อมูล (ถ้าใช้ข้อมูลของคุณ)', 'Source of your data (if any)') }), h('input', { name: 'data_source', maxlength: 500 })),
      h('label', {}, h('span', { text: L(lang, 'ข้อความถึงทีม', 'Message to the team') }), h('textarea', { name: 'message', rows: 3, maxlength: 2000 })),
      h('label', { class: 'lab-auth__consent' }, h('input', { type: 'checkbox', name: 'consent', value: 'yes', required: true }),
        h('span', { text: L(lang, 'ยืนยันว่าเป็นข้อมูลรวมระดับจังหวัด ไม่มีข้อมูลรายบุคคล และยินยอมให้ทีมใช้ตามวัตถุประสงค์ที่เลือก', 'The data are aggregate province-level figures without individual records; the team may use them for the purposes chosen') })),
      h('div', { class: 'lab-actions' }, h('button', { type: 'submit', class: 'btn btn--primary', 'data-action': 'send-submission', text: L(lang, 'สร้างแพ็กเกจและส่ง', 'Create the package and submit') }),
        h('button', { type: 'button', class: 'btn', text: L(lang, 'ยกเลิก', 'Cancel'), onclick: () => close(null) })));
    form.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(form), purposes = fd.getAll('purpose');
      if (!purposes.length) { status.textContent = L(lang, 'เลือกอย่างน้อยหนึ่งข้อ', 'Choose at least one'); return; }
      const values = { title: fd.get('title'), organization: fd.get('organization'), data_source: fd.get('data_source') || '', message: fd.get('message') || '', purposes };
      status.textContent = L(lang, 'กำลังสร้างแพ็กเกจ…', 'Building the package…');
      form.querySelectorAll('button,input,textarea').forEach(n => { n.disabled = true; });
      try {
        const pkg = await buildPackage(run, { lang, lab, release, form: values, account });
        status.textContent = L(lang, 'กำลังบันทึกในระบบ…', 'Saving…');
        const sub = await account.createSubmission({ title: values.title, purposes, message: values.message, organization: values.organization,
          data_source: values.data_source, consent: true, summary: { ...pkg.summary, manifest_id: pkg.manifest.submission_id } }, pkg.bytes);
        const draft = emailDraft({ lang, run, manifest: pkg.manifest, sub, account, hash: sub.package_sha256 || await sha256Hex(pkg.bytes) });
        done(pkg, sub, draft);
      } catch (error) {
        status.textContent = `${L(lang, 'ส่งไม่สำเร็จ', 'Submission failed')}: ${error.message}`;
        form.querySelectorAll('button,input,textarea').forEach(n => { n.disabled = false; });
      }
    };
    function done(pkg, sub, draft) {
      clear(dialog);
      dialog.append(h('h2', { id: 'lab-submit-title', text: L(lang, 'ส่งให้ทีมวิจัยแล้ว', 'Submitted to the research team') }),
        h('p', { 'data-submission-id': sub.id, text: L(lang, `รหัสส่งงาน ${sub.id} สถานะ: ได้รับแล้ว ติดตามได้ในพื้นที่ส่วนตัว`, `Submission ${sub.id}, status: received. Follow it in your workspace.`) }),
        h('p', { text: L(lang, `ขั้นสุดท้าย: ส่งอีเมลแจ้งทีม (${draft.to}) ข้อความร่างไว้ให้แล้ว`, `Last step: email the team (${draft.to}); the text is drafted for you.`) }),
        h('div', { class: 'lab-actions' },
          h('a', { class: 'btn btn--primary', href: draft.mailto, 'data-email-draft': 'mailto', text: L(lang, 'เปิดอีเมลที่ร่างไว้', 'Open the drafted email') }),
          h('a', { class: 'btn', href: draft.gmail, target: '_blank', rel: 'noopener', 'data-email-draft': 'gmail', text: L(lang, 'เปิดใน Gmail', 'Open in Gmail') }),
          h('button', { type: 'button', class: 'btn', 'data-email-draft': 'copy', text: L(lang, 'คัดลอกข้อความ', 'Copy the text'),
            onclick: e => navigator.clipboard?.writeText(`${draft.subject}\n\n${draft.body}`).then(() => { e.target.textContent = L(lang, 'คัดลอกแล้ว', 'Copied'); }) }),
          h('button', { type: 'button', class: 'btn', text: L(lang, 'ดาวน์โหลดแพ็กเกจ', 'Download the package'),
            onclick: () => saveBlob(`hrh-lab-submission-${sub.id.slice(0, 8)}.zip`, new Blob([pkg.bytes], { type: 'application/zip' })) })),
        h('details', {}, h('summary', { text: L(lang, 'ดูข้อความอีเมล', 'Show the email text') }), h('pre', { class: 'lab-submit__email', text: `${draft.subject}\n\n${draft.body}` })),
        h('div', { class: 'lab-actions' }, h('button', { type: 'button', class: 'btn', text: L(lang, 'ปิด', 'Close'), onclick: () => close(sub) })));
    }
    dialog.append(h('h2', { id: 'lab-submit-title', text: L(lang, 'ส่งผลนี้ให้ทีมวิจัย', 'Submit this result to the research team') }),
      h('p', { class: 'lab-help', text: L(lang, 'ระบบจะสร้างแพ็กเกจ (สมมติฐาน ข้อมูลของคุณ แผนจัดสรร และ checksum) บันทึกในระบบให้ทีมผู้ทบทวนเห็น แล้วร่างอีเมลแจ้งทีมให้', 'The Lab builds a package (assumptions, your data, the plan and checksums), stores it for the reviewers and drafts an email to the team.') }),
      form, status);
    document.body.append(dialog); dialog.showModal();
  });
}
