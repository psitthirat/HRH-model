// Lab accounts (owner decision 23 Oct 2569: sign-in is required for data uploads, My data, the private
// workspace and submissions; exploring policies stays public).  One interface, three backends:
//   supabase  the real service (config/web/lab_system.toml -> system-config.js); Row Level Security in
//             backend/supabase/migrations keeps every user's items private;
//   dev       a local IndexedDB account store, only on localhost while Supabase is not configured, so the
//             flows can be developed, tested and recorded; never on the public site;
//   disabled  no service configured: account features explain that sign-in is not yet available.
// Computation stays in the browser in every mode.  Items saved to an account are gzip-compressed JSON.
import { h, clear } from '../util/dom.js';
import { LAB_SYSTEM } from './system-config.js';

export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
const L = (lang, th, en) => lang === 'en' ? en : th;
const PURPOSES = [['national', 'วางแผนระดับประเทศ', 'National planning'], ['region', 'วางแผนระดับเขตสุขภาพ', 'Health-region planning'],
  ['province', 'วางแผนระดับจังหวัด/หน่วยบริการ', 'Province or facility planning'], ['research', 'วิจัย', 'Research'],
  ['teaching', 'การเรียนการสอน', 'Teaching'], ['other', 'อื่น ๆ', 'Other']];

export async function gzipJSON(value) {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzipJSON(blob) {
  const stream = (blob instanceof Blob ? blob : new Blob([blob])).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const redirectURL = () => `${location.origin}${location.pathname}?mode=lab&labview=hub`;
const friendly = (error, lang) => {
  const m = String(error?.message || error || '');
  if (/invalid login credentials/i.test(m)) return L(lang, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'Wrong email or password');
  if (/email not confirmed/i.test(m)) return L(lang, 'ยังไม่ได้ยืนยันอีเมล กรุณาเปิดลิงก์ในอีเมลยืนยันก่อน', 'Confirm your email first (see the confirmation email)');
  if (/already registered|already exists/i.test(m)) return L(lang, 'อีเมลนี้ลงทะเบียนแล้ว ใช้เมนูเข้าสู่ระบบหรือลืมรหัสผ่าน', 'This email is already registered; sign in or reset the password');
  if (/password/i.test(m) && /(short|least|weak)/i.test(m)) return L(lang, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร', 'The password needs at least 8 characters');
  return m || L(lang, 'เกิดข้อผิดพลาด', 'Something went wrong');
};

// ----------------------------------------------------------------------------- Supabase backend
class SupabaseBackend {
  constructor(cfg) { this.mode = 'supabase'; this.cfg = cfg; this.state = null; this.listeners = new Set(); }
  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { createClient } = await import(SUPABASE_JS);
      this.sb = createClient(this.cfg.supabase_url, this.cfg.supabase_anon_key,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'hrh-lab-auth' } });
      this.sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') this.recovery = true;
        queueMicrotask(() => this._refresh(session));
      });
      const { data } = await this.sb.auth.getSession();
      await this._refresh(data.session);
    })();
    return this.ready;
  }
  async _refresh(session) {
    let profile = null;
    if (session?.user) {
      const { data } = await this.sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      profile = data || null;
    }
    this.state = session?.user ? { user: { id: session.user.id, email: session.user.email }, profile } : null;
    for (const fn of this.listeners) fn(this.state);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  current() { return this.state; }
  _check({ error }) { if (error) throw error; }
  async signUp({ email, password, meta }) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { data: meta, emailRedirectTo: redirectURL() } });
    if (error) throw error;
    return { confirm: !data.session };
  }
  async signIn({ email, password }) { this._check(await this.sb.auth.signInWithPassword({ email, password })); await this._refresh((await this.sb.auth.getSession()).data.session); }
  async signInWithGoogle() { this._check(await this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectURL() } })); }
  async resetPassword(email) { this._check(await this.sb.auth.resetPasswordForEmail(email, { redirectTo: redirectURL() })); }
  async setPassword(password) { this._check(await this.sb.auth.updateUser({ password })); this.recovery = false; }
  async signOut() { await this.sb.auth.signOut(); await this._refresh(null); }
  async updateProfile(patch) {
    const allowed = ['full_name', 'organization', 'position', 'province', 'purpose'];
    const row = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    this._check(await this.sb.from('profiles').update(row).eq('id', this.state.user.id));
    await this._refresh((await this.sb.auth.getSession()).data.session);
  }
  async listItems() {
    const { data, error } = await this.sb.from('lab_items').select('*').order('created_at', { ascending: false });
    if (error) throw error; return data;
  }
  async saveItem(meta, payload) {
    const id = crypto.randomUUID(), bytes = await gzipJSON(payload), path = `${this.state.user.id}/${id}.json.gz`;
    this._check(await this.sb.storage.from('lab-private').upload(path, new Blob([bytes], { type: 'application/gzip' }), { contentType: 'application/gzip', upsert: false }));
    const row = { id, kind: meta.kind, title: meta.title, summary: meta.summary || {}, versions: meta.versions || {}, release_id: meta.release_id || null,
      storage_path: path, size_bytes: bytes.length, sha256: await sha256Hex(bytes) };
    const { data, error } = await this.sb.from('lab_items').insert(row).select().single();
    if (error) { await this.sb.storage.from('lab-private').remove([path]); throw error; }
    return data;
  }
  async loadItem(item) {
    const { data, error } = await this.sb.storage.from('lab-private').download(item.storage_path);
    if (error) throw error; return gunzipJSON(data);
  }
  async deleteItem(item) {
    if (item.storage_path) this._check(await this.sb.storage.from('lab-private').remove([item.storage_path]));
    this._check(await this.sb.from('lab_items').delete().eq('id', item.id));
  }
  async createSubmission(row, zipBytes) {
    const id = crypto.randomUUID(), path = `${this.state.user.id}/${id}.zip`;
    this._check(await this.sb.storage.from('lab-submissions').upload(path, new Blob([zipBytes], { type: 'application/zip' }), { contentType: 'application/zip', upsert: false }));
    const { data, error } = await this.sb.from('submissions').insert({ ...row, id, package_path: path, package_sha256: await sha256Hex(zipBytes) }).select().single();
    if (error) throw error; return data;
  }
  async listSubmissions({ all = false } = {}) {
    let q = this.sb.from('submissions').select('*, submitter:profiles!submissions_owner_fkey(full_name,organization,email)').order('created_at', { ascending: false });
    if (!all) q = q.eq('owner', this.state.user.id);
    const { data, error } = await q; if (error) throw error; return data;
  }
  async updateSubmission(id, patch) {
    const { data, error } = await this.sb.from('submissions').update(patch).eq('id', id).select().single();
    if (error) throw error; return data;
  }
  async submissionPackage(sub) {
    const { data, error } = await this.sb.storage.from('lab-submissions').download(sub.package_path);
    if (error) throw error; return data;
  }
  async submissionEvents(id) {
    const { data, error } = await this.sb.from('submission_events').select('*').eq('submission_id', id).order('created_at');
    if (error) throw error; return data;
  }
  async listProfiles() {
    const { data, error } = await this.sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error; return data;
  }
  async setUser(id, role, status) { this._check(await this.sb.rpc('admin_set_user', { target: id, new_role: role, new_status: status })); }
  async settings() { const { data } = await this.sb.from('app_settings').select('*').eq('id', 1).maybeSingle(); return data || {}; }
  async updateSettings(patch) { this._check(await this.sb.from('app_settings').update(patch).eq('id', 1)); }
}

// ----------------------------------------------------------------------------- local development backend
// Accounts in this browser only (IndexedDB "hrh-lab-dev-accounts").  The first account becomes admin so the
// reviewer and admin rooms can be exercised.  Passwords are salted SHA-256 hashes; this is not a security boundary.
class DevBackend {
  constructor() { this.mode = 'dev'; this.state = null; this.listeners = new Set(); }
  _db() {
    return this.db ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('hrh-lab-dev-accounts', 1);
      req.onupgradeneeded = () => { for (const s of ['users', 'profiles', 'items', 'blobs', 'submissions', 'events', 'settings']) req.result.createObjectStore(s); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  async _tx(store, mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), os = tx.objectStore(store); let out;
      Promise.resolve(fn(os)).then(v => { out = v; });
      tx.oncomplete = () => resolve(out); tx.onerror = () => reject(tx.error);
    });
  }
  _get(store, key) { return this._tx(store, 'readonly', os => new Promise(r => { const q = os.get(key); q.onsuccess = () => r(q.result ?? null); })); }
  _all(store) { return this._tx(store, 'readonly', os => new Promise(r => { const q = os.getAll(); q.onsuccess = () => r(q.result || []); })); }
  _put(store, key, value) { return this._tx(store, 'readwrite', os => { os.put(structuredClone(value), key); }); }
  _del(store, key) { return this._tx(store, 'readwrite', os => { os.delete(key); }); }
  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const uid = sessionStorage.getItem('hrh-lab-dev-session') || localStorage.getItem('hrh-lab-dev-session');
      if (uid) await this._login(uid, false);
    })().catch(() => {});
    return this.ready;
  }
  async _login(uid, remember = true) {
    const profile = await this._get('profiles', uid);
    if (!profile) { this.state = null; return; }
    const user = await this._get('users', profile.email);
    this.state = { user: { id: uid, email: user?.email || profile.email }, profile };
    if (remember) localStorage.setItem('hrh-lab-dev-session', uid);
    for (const fn of this.listeners) fn(this.state);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  current() { return this.state; }
  async _hash(email, password) { return sha256Hex(`hrh-lab-dev|${email}|${password}`); }
  async signUp({ email, password, meta }) {
    email = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('invalid email');
    if (String(password).length < 8) throw new Error('password too short: at least 8');
    if (await this._get('users', email)) throw new Error('User already registered');
    const id = crypto.randomUUID(), first = !(await this._all('profiles')).length, settings = (await this._get('settings', 1)) || {};
    await this._put('users', email, { email, id, hash: await this._hash(email, password) });
    await this._put('profiles', id, { id, email, full_name: meta.full_name || '', organization: meta.organization || '', position: meta.position || '',
      province: meta.province || '', purpose: meta.purpose || '', role: first ? 'admin' : 'user',
      status: !first && settings.require_approval ? 'pending' : 'active', consent_at: meta.consent ? new Date().toISOString() : null,
      created_at: new Date().toISOString() });
    await this._login(id);
    return { confirm: false };
  }
  async signIn({ email, password }) {
    email = String(email).trim().toLowerCase();
    const user = await this._get('users', email);
    if (!user || user.hash !== await this._hash(email, password)) throw new Error('Invalid login credentials');
    await this._login(user.id);
  }
  async signInWithGoogle() { throw new Error(L('th', 'โหมดทดสอบไม่รองรับ Google', 'Google sign-in is not available in development mode')); }
  async resetPassword() { throw new Error('โหมดทดสอบ: ลงทะเบียนใหม่ด้วยอีเมลอื่น / development mode: register another email'); }
  async setPassword() {}
  async signOut() { localStorage.removeItem('hrh-lab-dev-session'); sessionStorage.removeItem('hrh-lab-dev-session'); this.state = null; for (const fn of this.listeners) fn(null); }
  _me() { if (!this.state) throw new Error('not signed in'); return this.state; }
  _active() { const me = this._me(); if (me.profile.status !== 'active') throw new Error('account pending approval'); return me; }
  async updateProfile(patch) {
    const me = this._me(), allowed = ['full_name', 'organization', 'position', 'province', 'purpose'];
    await this._put('profiles', me.user.id, { ...me.profile, ...Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))) });
    await this._login(me.user.id);
  }
  async listItems() { const me = this._active(); return (await this._all('items')).filter(i => i.owner === me.user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async saveItem(meta, payload) {
    const me = this._active(), id = crypto.randomUUID(), bytes = await gzipJSON(payload);
    await this._put('blobs', id, bytes);
    const row = { id, owner: me.user.id, kind: meta.kind, title: meta.title, summary: meta.summary || {}, versions: meta.versions || {},
      release_id: meta.release_id || null, storage_path: `${me.user.id}/${id}.json.gz`, size_bytes: bytes.length, sha256: await sha256Hex(bytes),
      created_at: new Date().toISOString() };
    await this._put('items', id, row); return row;
  }
  async loadItem(item) { this._active(); const bytes = await this._get('blobs', item.id); if (!bytes) throw new Error('item data missing'); return gunzipJSON(bytes); }
  async deleteItem(item) { this._active(); await this._del('blobs', item.id); await this._del('items', item.id); }
  async createSubmission(row, zipBytes) {
    const me = this._active(), id = crypto.randomUUID();
    await this._put('blobs', `sub:${id}`, zipBytes);
    const sub = { ...row, id, owner: me.user.id, status: 'submitted', reviewer_note: '', package_path: `${me.user.id}/${id}.zip`,
      package_sha256: await sha256Hex(zipBytes), created_at: new Date().toISOString() };
    await this._put('submissions', id, sub); await this._event(id, 'submitted', 'submitted', '');
    return sub;
  }
  async _event(id, action, status, note) { await this._put('events', crypto.randomUUID(), { submission_id: id, actor: this.state?.user.id, action, status, note, created_at: new Date().toISOString() }); }
  async listSubmissions({ all = false } = {}) {
    const me = this._active(), reviewer = ['reviewer', 'admin'].includes(me.profile.role);
    const profiles = new Map((await this._all('profiles')).map(p => [p.id, p]));
    return (await this._all('submissions')).filter(s => (all && reviewer) || s.owner === me.user.id)
      .map(s => ({ ...s, submitter: (({ full_name, organization, email }) => ({ full_name, organization, email }))(profiles.get(s.owner) || {}) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async updateSubmission(id, patch) {
    const me = this._active(), sub = await this._get('submissions', id), reviewer = ['reviewer', 'admin'].includes(me.profile.role);
    if (!sub) throw new Error('unknown submission');
    if (!reviewer && !(sub.owner === me.user.id && patch.status === 'withdrawn' && Object.keys(patch).length === 1)) throw new Error('not allowed');
    const next = { ...sub, ...Object.fromEntries(Object.entries(patch).filter(([k]) => ['status', 'reviewer_note'].includes(k))), reviewer: reviewer ? me.user.id : sub.reviewer, updated_at: new Date().toISOString() };
    await this._put('submissions', id, next); await this._event(id, patch.status ? 'status' : 'note', next.status, patch.reviewer_note || '');
    return next;
  }
  async submissionPackage(sub) { return new Blob([await this._get('blobs', `sub:${sub.id}`)], { type: 'application/zip' }); }
  async submissionEvents(id) { return (await this._all('events')).filter(e => e.submission_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async listProfiles() { const me = this._active(); if (!['reviewer', 'admin'].includes(me.profile.role)) throw new Error('not allowed'); return this._all('profiles'); }
  async setUser(id, role, status) {
    const me = this._active(); if (me.profile.role !== 'admin') throw new Error('not allowed');
    const p = await this._get('profiles', id); await this._put('profiles', id, { ...p, role, status });
    if (id === me.user.id) await this._login(id);
  }
  async settings() { return { require_approval: false, submission_email: LAB_SYSTEM.submission.recipient, ...((await this._get('settings', 1)) || {}) }; }
  async updateSettings(patch) { const me = this._active(); if (me.profile.role !== 'admin') throw new Error('not allowed'); await this._put('settings', 1, { ...(await this.settings()), ...patch }); }
}

class DisabledBackend {
  constructor() { this.mode = 'disabled'; }
  async init() {}
  onChange() { return () => {}; }
  current() { return null; }
}

let singleton;
export function getAccount() {
  if (singleton) return singleton;
  const cfg = LAB_SYSTEM.accounts || {};
  const devHost = (cfg.dev_hosts || []).includes(location.hostname) || new URLSearchParams(location.search).get('labauth') === 'dev' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  singleton = cfg.supabase_url && cfg.supabase_anon_key ? new SupabaseBackend(cfg) : devHost ? new DevBackend() : new DisabledBackend();
  return singleton;
}
export const signedIn = account => !!account.current();
export const isActive = account => account.current()?.profile?.status === 'active';
export const roleOf = account => account.current()?.profile?.role || null;
export const isReviewer = account => ['reviewer', 'admin'].includes(roleOf(account));
export const requiredFor = feature => (LAB_SYSTEM.accounts?.required_for || []).includes(feature);

// ----------------------------------------------------------------------------- UI
export function modeNote(account, lang) {
  if (account.mode === 'dev') return h('p', { class: 'lab-account-mode lab-account-mode--dev', 'data-account-mode': 'dev',
    text: L(lang, 'โหมดทดสอบบนเครื่อง: บัญชีและผลที่บันทึกอยู่ในเบราว์เซอร์นี้เท่านั้น ยังไม่ได้เชื่อมระบบบัญชีจริง (Supabase)', 'Local development mode: accounts and saved items stay in this browser; the real account service (Supabase) is not connected yet.') });
  if (account.mode === 'disabled') return h('p', { class: 'lab-account-mode', 'data-account-mode': 'disabled',
    text: L(lang, 'ระบบบัญชีผู้ใช้กำลังเปิดใช้งาน: ส่วนที่ต้องเข้าสู่ระบบจะใช้ได้เมื่อผู้ดูแลตั้งค่าเสร็จ ส่วนสำรวจนโยบายใช้ได้ตามปกติ', 'User accounts are being set up: parts that need sign-in open once the administrators finish; policy exploration works as usual.') });
  return null;
}

export function accountChip(account, { lang = 'th', onWorkspace, onChange } = {}) {
  const host = h('div', { class: 'lab-account-chip', 'data-account-chip': '' });
  const paint = () => {
    clear(host);
    const me = account.current();
    if (account.mode === 'disabled') { host.append(h('span', { class: 'lab-help', text: L(lang, 'บัญชีผู้ใช้: เร็ว ๆ นี้', 'Accounts: coming soon') })); return; }
    if (!me) { host.append(h('button', { type: 'button', class: 'btn', 'data-action': 'sign-in', text: L(lang, 'เข้าสู่ระบบ / ลงทะเบียน', 'Sign in / Register'),
      onclick: () => openAuthDialog(account, { lang }).then(() => onChange?.()) })); return; }
    const name = me.profile?.full_name || me.user.email;
    const menu = h('details', { class: 'lab-account-menu' }, h('summary', { 'data-account-name': '', text: name }),
      h('div', { class: 'lab-account-menu__body' },
        h('p', { class: 'lab-help', text: `${me.user.email}${me.profile?.organization ? ` · ${me.profile.organization}` : ''}` }),
        me.profile?.status === 'pending' ? h('p', { class: 'lab-account-pending', text: L(lang, 'บัญชีรอผู้ดูแลอนุมัติ', 'Account awaiting approval') }) : '',
        h('button', { type: 'button', class: 'btn', text: L(lang, 'พื้นที่ส่วนตัว', 'My workspace'), onclick: () => onWorkspace?.() }),
        h('button', { type: 'button', class: 'btn', 'data-action': 'sign-out', text: L(lang, 'ออกจากระบบ', 'Sign out'), onclick: async () => { await account.signOut(); onChange?.(); } })));
    host.append(menu);
  };
  paint();
  host.repaint = paint;
  return host;
}

// Resolves with the account state, or null when the dialog is closed.  `reason` says why sign-in is needed.
export function openAuthDialog(account, { lang = 'th', reason = '', initial = 'signin' } = {}) {
  return new Promise(resolve => {
    if (account.mode === 'disabled') { resolve(null); return; }
    let view = account.recovery ? 'recovery' : initial, busy = false;
    const dialog = h('dialog', { class: 'lab-auth', 'aria-labelledby': 'lab-auth-title', 'data-auth-dialog': '' });
    const close = value => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(account.current()); });
    const message = h('p', { class: 'lab-auth__message', role: 'status', 'aria-live': 'polite' });
    const say = (text, error = false) => { message.textContent = text; message.classList.toggle('lab-auth__message--error', error); };
    const field = (name, label, attrs = {}) => h('label', {}, h('span', { text: label }), h('input', { name, ...attrs }));
    const submit = async (form, fn) => {
      if (busy) return; busy = true; say(L(lang, 'กำลังดำเนินการ…', 'Working…'));
      try { await fn(Object.fromEntries(new FormData(form))); } catch (error) { say(friendly(error, lang), true); } finally { busy = false; }
    };
    const render = () => {
      clear(dialog);
      dialog.append(h('div', { class: 'lab-auth__head' },
        h('h2', { id: 'lab-auth-title', text: { signin: L(lang, 'เข้าสู่ระบบ Workforce Lab', 'Sign in to the Workforce Lab'), signup: L(lang, 'ลงทะเบียนผู้ใช้ Lab', 'Register for the Lab'),
          reset: L(lang, 'ลืมรหัสผ่าน', 'Reset password'), recovery: L(lang, 'ตั้งรหัสผ่านใหม่', 'Set a new password') }[view] }),
        h('button', { type: 'button', class: 'btn lab-auth__close', 'aria-label': L(lang, 'ปิด', 'Close'), text: '×', onclick: () => close(account.current()) })));
      if (reason) dialog.append(h('p', { class: 'lab-auth__reason', text: reason }));
      dialog.append(modeNote(account, lang) || '');
      if (view !== 'recovery') dialog.append(h('div', { class: 'lab-auth__tabs', role: 'tablist' },
        ...[['signin', L(lang, 'เข้าสู่ระบบ', 'Sign in')], ['signup', L(lang, 'ลงทะเบียน', 'Register')]].map(([id, text]) =>
          h('button', { type: 'button', role: 'tab', class: 'btn', 'aria-selected': String(view === id), 'data-auth-tab': id, text, onclick: () => { view = id; render(); } }))));
      let form;
      if (view === 'signin') {
        form = h('form', { class: 'lab-auth__form', 'data-auth-form': 'signin' },
          field('email', L(lang, 'อีเมล', 'Email'), { type: 'email', required: true, autocomplete: 'email' }),
          field('password', L(lang, 'รหัสผ่าน', 'Password'), { type: 'password', required: true, autocomplete: 'current-password' }),
          h('button', { type: 'submit', class: 'btn btn--primary', text: L(lang, 'เข้าสู่ระบบ', 'Sign in') }),
          h('button', { type: 'button', class: 'btn btn--link', text: L(lang, 'ลืมรหัสผ่าน', 'Forgot password'), onclick: () => { view = 'reset'; render(); } }));
        form.onsubmit = e => { e.preventDefault(); submit(form, async v => { await account.signIn(v); close(account.current()); }); };
      } else if (view === 'signup') {
        form = h('form', { class: 'lab-auth__form lab-auth__form--grid', 'data-auth-form': 'signup' },
          field('email', L(lang, 'อีเมล (ใช้ยืนยันตัวตน)', 'Email (for verification)'), { type: 'email', required: true, autocomplete: 'email' }),
          field('password', L(lang, 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)', 'Password (at least 8 characters)'), { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }),
          field('full_name', L(lang, 'ชื่อ–นามสกุล', 'Full name'), { required: true, maxlength: 120, autocomplete: 'name' }),
          field('organization', L(lang, 'หน่วยงาน', 'Organisation'), { required: true, maxlength: 160, autocomplete: 'organization' }),
          field('position', L(lang, 'ตำแหน่ง', 'Position'), { maxlength: 120 }),
          field('province', L(lang, 'จังหวัด/เขตที่รับผิดชอบ (ถ้ามี)', 'Province or region (optional)'), { maxlength: 80 }),
          h('label', {}, h('span', { text: L(lang, 'วัตถุประสงค์การใช้', 'Purpose of use') }),
            h('select', { name: 'purpose', required: true }, h('option', { value: '', text: L(lang, 'เลือก', 'Choose') }),
              ...PURPOSES.map(([value, th, en]) => h('option', { value, text: L(lang, th, en) })))),
          h('details', { class: 'lab-auth__privacy' }, h('summary', { text: L(lang, 'ข้อมูลที่เก็บและการใช้ (PDPA)', 'What we store and why (PDPA)') }),
            h('p', { text: L(lang,
              'ทีมวิจัยเก็บอีเมล ชื่อ หน่วยงาน ตำแหน่ง และวัตถุประสงค์ เพื่อยืนยันตัวตน ติดต่อกลับเมื่อคุณส่งผล และรายงานจำนวนผู้ใช้ในภาพรวมต่อแหล่งทุน ผลและชุดข้อมูลที่คุณบันทึกเห็นได้เฉพาะคุณ ทีมเห็นเฉพาะสิ่งที่คุณกดส่ง ข้อมูลเก็บบน Supabase (ภูมิภาคสิงคโปร์) ขอดู แก้ไข หรือลบข้อมูลได้ทางอีเมลผู้ดูแล',
              'The research team stores your email, name, organisation, position and purpose to verify accounts, reply to submissions and report aggregate use to the funder. Items you save are visible only to you; the team sees only what you submit. Data are kept on Supabase (Singapore region). Ask the administrator by email to see, correct or delete your data.') }),
            h('p', { class: 'lab-help', text: LAB_SYSTEM.submission?.recipient || '' })),
          h('label', { class: 'lab-auth__consent' }, h('input', { type: 'checkbox', name: 'consent', value: 'yes', required: true }),
            h('span', { text: L(lang, 'ยอมรับการเก็บและใช้ข้อมูลตามข้างต้น และจะอัปโหลดเฉพาะข้อมูลรวมระดับจังหวัด ไม่มีข้อมูลรายบุคคล', 'I accept the above and will upload only aggregate province-level data, never individual records') })),
          h('button', { type: 'submit', class: 'btn btn--primary', text: L(lang, 'ลงทะเบียน', 'Register') }));
        form.onsubmit = e => { e.preventDefault(); submit(form, async v => {
          const out = await account.signUp({ email: v.email, password: v.password, meta: { full_name: v.full_name, organization: v.organization, position: v.position,
            province: v.province, purpose: v.purpose, consent: v.consent === 'yes' } });
          if (out.confirm) { say(L(lang, 'ลงทะเบียนแล้ว: เปิดลิงก์ยืนยันในอีเมลของคุณ แล้วกลับมาเข้าสู่ระบบ', 'Registered: open the confirmation link in your email, then sign in.')); view = 'signin'; return; }
          if (account.current()?.profile?.status === 'pending') { say(L(lang, 'ลงทะเบียนแล้ว บัญชีรอผู้ดูแลอนุมัติ', 'Registered; your account awaits approval.')); return; }
          close(account.current());
        }); };
      } else if (view === 'reset') {
        form = h('form', { class: 'lab-auth__form', 'data-auth-form': 'reset' }, field('email', L(lang, 'อีเมลที่ลงทะเบียน', 'Registered email'), { type: 'email', required: true }),
          h('button', { type: 'submit', class: 'btn btn--primary', text: L(lang, 'ส่งลิงก์ตั้งรหัสผ่านใหม่', 'Send reset link') }),
          h('button', { type: 'button', class: 'btn btn--link', text: L(lang, 'กลับไปเข้าสู่ระบบ', 'Back to sign in'), onclick: () => { view = 'signin'; render(); } }));
        form.onsubmit = e => { e.preventDefault(); submit(form, async v => { await account.resetPassword(v.email); say(L(lang, 'ส่งลิงก์แล้ว ตรวจอีเมลของคุณ', 'Link sent; check your email.')); }); };
      } else {
        form = h('form', { class: 'lab-auth__form', 'data-auth-form': 'recovery' }, field('password', L(lang, 'รหัสผ่านใหม่', 'New password'), { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }),
          h('button', { type: 'submit', class: 'btn btn--primary', text: L(lang, 'บันทึกรหัสผ่าน', 'Save password') }));
        form.onsubmit = e => { e.preventDefault(); submit(form, async v => { await account.setPassword(v.password); close(account.current()); }); };
      }
      dialog.append(form);
      if (LAB_SYSTEM.accounts?.google_sign_in && account.mode === 'supabase' && ['signin', 'signup'].includes(view))
        dialog.append(h('button', { type: 'button', class: 'btn', text: L(lang, 'เข้าสู่ระบบด้วย Google', 'Continue with Google'), onclick: () => account.signInWithGoogle().catch(e => say(friendly(e, lang), true)) }));
      dialog.append(message);
    };
    document.body.append(dialog); render(); dialog.showModal();
    dialog.querySelector('input')?.focus();
  });
}

// The account state when signed in and active; otherwise opens the dialog (or explains a pending account).
export async function requireSignIn(account, lang, reason) {
  await account.init();
  if (account.mode === 'disabled') return null;
  if (!account.current()) await openAuthDialog(account, { lang, reason });
  return isActive(account) ? account.current() : null;
}

// A panel for rooms that need an account: the reason, and a sign-in button that repaints the room.
export function signInGate(account, { lang, reason, onSignedIn }) {
  const me = account.current();
  const box = h('section', { class: 'lab-signin-gate', 'data-signin-gate': '' });
  box.append(h('h3', { text: account.mode === 'disabled' ? L(lang, 'ส่วนนี้ต้องเข้าสู่ระบบ', 'This part needs an account') : me ? L(lang, 'บัญชีรอผู้ดูแลอนุมัติ', 'Your account awaits approval') : L(lang, 'เข้าสู่ระบบเพื่อใช้ส่วนนี้', 'Sign in to use this part') }),
    h('p', { text: reason }), modeNote(account, lang) || '');
  if (account.mode !== 'disabled' && !me) box.append(h('div', { class: 'lab-actions' },
    h('button', { type: 'button', class: 'btn btn--primary', 'data-action': 'gate-sign-in', text: L(lang, 'เข้าสู่ระบบ', 'Sign in'), onclick: () => openAuthDialog(account, { lang, reason }).then(() => onSignedIn?.()) }),
    h('button', { type: 'button', class: 'btn', 'data-action': 'gate-register', text: L(lang, 'ลงทะเบียนใหม่', 'Register'), onclick: () => openAuthDialog(account, { lang, reason, initial: 'signup' }).then(() => onSignedIn?.()) })));
  return box;
}
