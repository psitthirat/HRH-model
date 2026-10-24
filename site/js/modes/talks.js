// Talks ("นำเสนอ"): the chooser for every presentation of the project. The WS3
// talks are self-contained decks in story/talks/<id>/ (opened in a new tab, so
// the presenter's notes window and full screen belong to the deck); the WS2
// scene sequence opens in this app's Present and Story modes. Cards come from
// story/reader/talks.json. A deck or PDF that is not built yet is shown as
// "กำลังจัดทำ" instead of a broken link.

import { h, clear } from "../util/dom.js";

const SOURCE = new URL("../../reader/talks.json", import.meta.url);

async function exists(href) {
  try {
    const r = await fetch(href, { method: "HEAD", cache: "no-cache" });
    return r.ok;
  } catch { return false; }
}

function deckCard(t) {
  const thumb = h("div", { class: "tk-thumb" }, h("span", { class: "tk-thumb__ph", text: t.title }));
  const open = h("a", { class: "tk-btn tk-btn--primary", href: t.href, target: "_blank", rel: "noopener", text: "เปิดสไลด์" });
  const pdf = h("a", { class: "tk-btn", href: t.pdf, download: "", text: "ดาวน์โหลด PDF" });
  // PPTX: pictures of the slides, no speaker notes; only for talks that list one
  const pptx = t.pptx ? h("a", { class: "tk-btn", href: t.pptx, download: "", text: "ดาวน์โหลด PPTX" }) : null;
  const card = h("article", { class: "tk-card", id: `talk-${t.id}` }, thumb,
    h("div", { class: "tk-card__body" },
      h("p", { class: "tk-event", text: t.event }),
      h("h2", { class: "tk-title", text: t.title }),
      h("p", { class: "tk-sub", text: t.subtitle }),
      h("p", { class: "tk-meta" }, h("span", { text: t.speaker }), h("span", { text: t.minutes })),
      h("div", { class: "tk-actions" }, open, pdf, pptx)));
  // Thumbnails and PDFs are produced with the decks; show them only when they exist.
  const img = new Image();
  img.alt = "";
  img.onload = () => { clear(thumb).append(img); };
  img.src = t.thumb;
  exists(t.href).then((ok) => { if (!ok) { open.replaceWith(h("span", { class: "tk-btn tk-btn--off", text: "สไลด์กำลังจัดทำ" })); } });
  exists(t.pdf).then((ok) => { if (!ok) { pdf.replaceWith(h("span", { class: "tk-btn tk-btn--off", text: "PDF กำลังจัดทำ" })); } });
  if (pptx) exists(t.pptx).then((ok) => { if (!ok) { pptx.replaceWith(h("span", { class: "tk-btn tk-btn--off", text: "PPTX กำลังจัดทำ" })); } });
  return card;
}

export function initTalks(app) {
  const { main } = app;
  clear(main).append(h("p", { class: "loading", text: "กำลังโหลดรายการนำเสนอ…" }));
  let alive = true;
  fetch(SOURCE, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`โหลดรายการไม่สำเร็จ (${r.status})`);
    return r.json();
  }).then((T) => {
    if (!alive) return;
    const W = T.ws2;
    const ws2 = h("article", { class: "tk-card tk-card--ws2" },
      h("div", { class: "tk-card__body" },
        h("p", { class: "tk-event", text: W.event }),
        h("h2", { class: "tk-title", text: W.title }),
        h("p", { class: "tk-sub", text: W.subtitle }),
        h("div", { class: "tk-actions" },
          h("button", { class: "tk-btn tk-btn--primary", type: "button", text: W.present,
            onclick: () => { app.state.talk = null; app.state.scene = null; app.state.step = 1; app.switchMode("present"); } }),
          h("button", { class: "tk-btn", type: "button", text: W.story, onclick: () => { app.state.scene = null; app.switchMode("story"); } }),
          h("button", { class: "tk-btn", type: "button", text: W.explore, onclick: () => app.switchMode("explore") }))));
    const items = T.documents?.items || [];
    const docs = items.length ? h("section", { class: "tk-docs" }, h("h3", { text: T.documents.title }),
      h("ul", {}, ...items.map((d) => h("li", {}, h("a", { href: d.href, download: "", text: d.label }))))) : null;
    clear(main).append(h("div", { class: "talks" },
      h("header", { class: "tk-head" }, h("p", { class: "rd-eyebrow", text: "HRH-MODEL / การนำเสนอ" }),
        h("h1", { class: "tk-h1", text: T.title }), h("p", { class: "tk-intro", text: T.intro })),
      h("div", { class: "tk-grid" }, ...T.talks.map(deckCard)),
      ws2, docs));
    const where = document.querySelector(".topbar__where");
    if (where) clear(where).append(h("span", { class: "topbar__chapter", text: T.title }));
  }).catch((err) => {
    if (!alive) return;
    clear(main).append(h("div", { class: "fatal" }, h("h1", { text: "เปิดรายการนำเสนอไม่ได้" }), h("p", { text: String(err.message || err) })));
  });
  return {
    render() {}, goto() {},
    destroy() { alive = false; const where = document.querySelector(".topbar__where"); if (where) clear(where); clear(main); },
  };
}
