// The Lab trailer (5:42, video/lab-trailer, release v3.1): a dialog that opens once per browser on the first visit to the
// Lab home, and from the "ดูคลิปแนะนำ" button at any time.  Sound starts only when the viewer presses play.
import { h } from '../util/dom.js';

const SEEN_KEY = 'hrh-lab-trailer-seen';
const VIDEO = 'assets/video/workforce-lab-trailer.mp4';
const POSTER = 'assets/video/workforce-lab-trailer-poster.jpg';
const CAPTIONS = 'assets/video/workforce-lab-trailer.th.vtt';
const L = (lang, th, en) => lang === 'en' ? en : th;

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }   // no storage: never pop up uninvited
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: nothing to remember */ }
}

export function openTrailer(lang = 'th') {
  if (document.querySelector('[data-lab-trailer]')) return;
  markSeen();
  const video = h('video', { class: 'lab-trailer__video', preload: 'metadata', poster: POSTER },
    h('source', { src: VIDEO, type: 'video/mp4' }),
    h('track', { kind: 'captions', srclang: 'th', label: 'ไทย', src: CAPTIONS }));
  video.controls = true;
  video.playsInline = true;
  const dialog = h('dialog', { class: 'lab-trailer', 'aria-labelledby': 'lab-trailer-title', 'data-lab-trailer': '' });
  const close = () => { video.pause(); dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  dialog.append(
    h('div', { class: 'lab-trailer__head' },
      h('h2', { id: 'lab-trailer-title', text: L(lang, 'Workforce Lab ใน 5 นาที', 'Workforce Lab in five minutes') }),
      h('button', { type: 'button', class: 'btn btn--ghost lab-trailer__skip', text: L(lang, 'ข้าม', 'Skip'), onclick: close })),
    video,
    h('p', { class: 'lab-trailer__note', text: L(lang,
      'คลิปแนะนำ 5:42 นาที เสียงพากย์ภาษาไทย เปิดคำบรรยายได้ที่ปุ่ม CC ดูอีกครั้งได้จากปุ่ม "ดูคลิปแนะนำ" ในหน้านี้',
      'A 5:42 introduction in Thai with captions (CC). Watch it again from the "Watch the introduction" button on this page.') }));
  document.body.append(dialog);
  dialog.showModal();
}

// First visit to the Lab home only.
export function maybeShowTrailer(lang = 'th') {
  if (seen() || navigator.webdriver) return;   // automated browser tests drive the page without it
  queueMicrotask(() => openTrailer(lang));
}

export function trailerButton(lang = 'th') {
  return h('button', { type: 'button', class: 'btn btn--ghost lab-hub__trailer', onclick: () => openTrailer(lang) },
    L(lang, '▶ ดูคลิปแนะนำ (5:42)', '▶ Watch the introduction (5:42)'));
}
