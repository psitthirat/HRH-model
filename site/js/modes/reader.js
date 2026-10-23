// Read ("อ่านเนื้อหา"): the editorial page of the study, in the manner of the
// PVS site. Copy, figure metadata, credits and province tiles come from
// story/reader/content.json, built by scripts/webstory/reader_build.py from
// config/web/reader.toml; every number in the copy is already resolved from
// the claims ledger, so this file never formats a research value. Native
// scrolling only: chapters are articles, figures are interactive charts drawn
// from each figure's data (story/js/reader/), each with a table view and
// PNG, SVG and CSV downloads, and "สำรวจข้อมูล" opens the matching Explore scene.

import { h, s, clear } from "../util/dom.js";
import { mountFigure, actions, definition } from "../reader/figure.js";

const CONTENT = new URL("../../reader/content.json", import.meta.url);
const THEME_KEY = "hrh.reader.theme";
let cache = null;

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

// Read and Talks are light by default; the other modes keep the dark projector theme.
export function applyTheme(editorial) {
  const root = document.documentElement;
  if (!editorial) { root.removeAttribute("data-theme"); return; }
  root.dataset.theme = storedTheme() === "dark" ? "dark" : "light";
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage may be blocked: the toggle still works for this page */ }
  document.documentElement.dataset.theme = next;
}

async function loadContent() {
  if (!cache) {
    cache = fetch(CONTENT, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`โหลดเนื้อหาไม่สำเร็จ (${r.status})`);
      return r.json();
    }).catch((e) => { cache = null; throw e; });
  }
  return cache;
}

const ICON_EXPAND = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_DL = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 17 17 7m0 0H9m8 0v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function tilesSvg(tiles, group) {
  const pitch = 10, r = 3.6;
  const cols = Math.max(...tiles.map((t) => t.col)) + 1, rows = Math.max(...tiles.map((t) => t.row)) + 1;
  const svg = s("svg", { viewBox: `0 0 ${cols * pitch} ${rows * pitch}`, class: "rd-tiles", role: "img",
    "aria-label": "จังหวัดเจ็ดสิบหกจังหวัดบนตารางตามตำแหน่งบนแผนที่" });
  for (const t of tiles) {
    const c = s("circle", { cx: t.col * pitch + pitch / 2, cy: t.row * pitch + pitch / 2, r, class: "rd-tile", "data-group": t.group });
    c.append(s("title", { text: t.name }));
    svg.append(c);
  }
  paintTiles(svg, group);
  return svg;
}

function paintTiles(svg, group) {
  svg.querySelectorAll(".rd-tile").forEach((c) => c.classList.toggle("is-on", c.dataset.group === group));
}

function hero(C, app) {
  const M = C.meta, H = C.hero;
  const tabs = h("div", { class: "rd-tabs", role: "tablist", "aria-label": "เลือกไม้บรรทัด" });
  const map = tilesSvg(C.tiles, H.tab[0].id);
  const stat = h("div", { class: "rd-stat", "aria-live": "polite" });
  function show(tab) {
    paintTiles(map, tab.id);
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === tab.id)));
    clear(stat).append(h("b", { class: "rd-stat__v", text: tab.stat }),
      h("div", {}, h("strong", { text: `${tab.unit} ${tab.caption}` }), h("span", { text: tab.sub })));
  }
  for (const tab of H.tab) tabs.append(h("button", { type: "button", role: "tab", "data-id": tab.id, text: tab.label, onclick: () => show(tab) }));
  show(H.tab[0]);
  const first = () => document.getElementById("rd-part-1")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return h("header", { class: "rd-hero" },
    h("div", { class: "rd-hero__text" },
      h("p", { class: "rd-eyebrow", text: M.eyebrow }),
      h("h1", { class: "rd-hero__title", "aria-label": M.title }, ...(M.title_lines || [M.title]).map((line) => h("span", { text: line }))),
      h("p", { class: "rd-hero__q", text: M.question }),
      h("p", { class: "rd-hero__desc", text: M.description }),
      h("div", { class: "rd-cta" },
        h("button", { class: "rd-cta__primary", type: "button", onclick: first, html: `${M.read_cta} <span aria-hidden="true">↓</span>` }),
        h("a", { class: "rd-cta__link", href: M.newsletter_pdf, download: "", html: `${M.newsletter_cta} ${ICON_DL}` }),
        h("button", { class: "rd-cta__link", type: "button", onclick: () => app.switchMode("talks"), html: `${M.talks_cta} ${ICON_OUT}` })),
      h("p", { class: "rd-meta", text: M.meta_line })),
    h("aside", { class: "rd-panel", "aria-label": H.panel_title },
      h("div", { class: "rd-panel__head" }, h("span", { text: H.panel_title }), h("span", { class: "rd-panel__tag", text: H.panel_tag })),
      tabs, h("div", { class: "rd-panel__map" }, map), stat,
      h("p", { class: "rd-panel__note", text: H.note })));
}

// Figures mount when they come near the viewport, so the page loads only the
// data it is about to show.
const lazy = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { lazy.unobserve(e.target); e.target._mount?.(); }
  }, { rootMargin: "700px 0px" })
  : null;

function figurePanel(figs, C, openLightbox, live) {
  const wrap = h("figure", { class: "rd-fig" });
  const head = h("div", { class: "rd-fig__head" });
  const tabs = figs.length > 1 ? h("div", { class: "rd-tabs rd-tabs--fig", role: "tablist", "aria-label": "เลือกภาพ" }) : null;
  const body = h("div", { class: "rd-fig__body" });
  let api = null;
  function show(i) {
    const f = figs[i];
    clear(head).append(h("span", { class: "rd-fig__title", text: f.title }),
      h("button", { class: "rd-fig__expand", type: "button", html: `ขยาย ${ICON_EXPAND}`, onclick: () => openLightbox(f, api) }));
    tabs?.querySelectorAll("button").forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
    api?.destroy();
    api = null;
    const card = h("div", { class: `rd-fig__card${f.kind === "diagram" ? " rd-fig__card--diagram" : ""}` });
    const mount = () => { api = mountFigure(card, f, C); live.add(api); };
    clear(body).append(card,
      h("figcaption", { class: "rd-fig__cap", text: f.caption }),
      f.credit ? h("p", { class: "rd-fig__credit", text: f.credit }) : "",
      f.notes ? h("details", { class: "rd-more" }, h("summary", { text: "ตัวหาร ข้อจำกัด และที่มา" }), h("p", { text: f.notes })) : "",
      actions(f, C, () => { if (!api) mount(); return api; }));
    if (lazy) { card._mount = mount; lazy.observe(card); }
    else mount();
  }
  if (tabs) figs.forEach((f, i) => tabs.append(h("button", { type: "button", role: "tab", text: f.title, onclick: () => show(i) })));
  show(0);
  wrap.append(head, tabs || "", body);
  return wrap;
}

function sourcesBlock(part) {
  if (!part.sources?.length) return "";
  return h("aside", { class: "rd-sources", "aria-label": `แหล่งข้อมูลของส่วนที่ ${part.id}` },
    h("p", { class: "rd-eyebrow", text: `แหล่งข้อมูล ส่วนที่ ${part.id}` }),
    h("ul", {}, ...part.sources.map((src) => h("li", {},
      h("span", { class: "rd-sources__name", text: src.name }),
      src.by ? h("span", { class: "rd-sources__by", text: src.by }) : "",
      src.url ? h("a", { href: src.url, target: "_blank", rel: "noopener", text: src.url.replace(/^https?:\/\//, "") }) : ""))));
}

function chapterBlock(ch, part, index, app, C, openLightbox, live) {
  const links = h("div", { class: "rd-links" },
    h("details", { class: "rd-more rd-more--inline" }, h("summary", { text: "วิธีอ่านและข้อจำกัด" }), h("p", { text: ch.caveat })));
  if (ch.explore) links.append(h("a", { class: "rd-out", href: `?mode=explore&scene=${ch.explore}`, html: `สำรวจข้อมูล ${ICON_OUT}`,
    onclick: (e) => { e.preventDefault(); app.state.scene = ch.explore; app.state.step = 1; app.switchMode("explore"); } }));
  if (ch.lab) links.append(h("a", { class: "rd-out", href: "?mode=lab", html: `ทดลองใน Lab ${ICON_OUT}`,
    onclick: (e) => { e.preventDefault(); app.enterLab({ kind: "main_menu" }); } }));
  const text = h("div", { class: "rd-text" },
    h("div", { class: "rd-kicker" }, h("span", { class: "rd-num", text: ch.id }), h("span", { text: `ส่วนที่ ${part.id} / ${part.title}` })),
    h("h2", { class: "rd-h", text: ch.headline }),
    ...ch.body.map((p) => h("p", { class: "rd-p", text: p })),
    h("p", { class: "rd-take", text: ch.takeaway }),
    links);
  const wide = ch.figures.some((f) => definition(f)?.wide);
  return h("article", { class: `rd-ch${index % 2 ? " rd-ch--flip" : ""}${wide ? " rd-ch--wide" : ""}`, id: `ch-${ch.id}`, "data-ch": ch.id, "aria-labelledby": `ch-${ch.id}-h` },
    h("div", { class: "rd-ch__grid" }, figurePanel(ch.figures, C, openLightbox, live), text));
}

function closingBlock(C, openLightbox, app, live) {
  const K = C.closing;
  return h("section", { class: "rd-closing", id: "ch-closing", "data-ch": "closing" },
    h("div", { class: "rd-closing__head" }, h("p", { class: "rd-eyebrow", text: "ปิดท้าย" }), h("h2", { class: "rd-h", text: K.title }), h("p", { class: "rd-p", text: K.intro })),
    h("div", { class: "rd-closing__grid" },
      h("ol", { class: "rd-steps" }, ...K.proposals.map((p) => h("li", {}, h("b", { text: p.title }), h("span", { text: p.text })))),
      K.figures?.length ? figurePanel(K.figures, C, openLightbox, live) : ""),
    h("div", { class: "rd-debates" },
      h("h3", { text: K.debates_title }), h("p", { class: "rd-p", text: K.debates_intro }),
      h("ol", { class: "rd-debates__list" }, ...K.debates.map((d) => h("li", { text: d })))),
    K.explore ? h("p", {}, h("a", { class: "rd-out", href: `?mode=explore&scene=${K.explore}`, html: `ดูข้อเสนอในสไลด์ ${ICON_OUT}`,
      onclick: (e) => { e.preventDefault(); app.state.scene = K.explore; app.state.step = 1; app.switchMode("present"); } })) : "");
}

function footer(C, app) {
  const M = C.meta;
  return h("footer", { class: "rd-foot" },
    h("div", { class: "rd-foot__grid" },
      h("div", {}, h("p", { class: "rd-eyebrow", text: "ดาวน์โหลด" }),
        h("p", {}, h("a", { href: M.newsletter_pdf, download: "", html: `${ICON_DL} จดหมายข่าวสี่หน้า (A4, PDF)` })),
        h("p", {}, h("a", { href: M.booklet_pdf, download: "", html: `${ICON_DL} ฉบับพิมพ์ A3 พับครึ่ง (PDF)` })),
        h("p", {}, h("button", { class: "linkbtn", type: "button", onclick: () => app.switchMode("talks"), text: "สไลด์การนำเสนอทั้งหมด" }))),
      h("div", {}, h("p", { class: "rd-eyebrow", text: "อ้างอิง" }), h("p", { class: "rd-cite", text: M.citation }),
        h("p", { class: "rd-cite", text: M.status_note })),
      h("div", { class: "rd-foot__fund" }, h("img", { src: "assets/logos/05_HSRI.svg", alt: "ตราสถาบันวิจัยระบบสาธารณสุข", loading: "lazy" }),
        h("p", { text: M.funding }), h("p", { class: "rd-cite", text: M.team }))));
}

// The enlarged figure: the same chart drawn again at full width, starting from
// the reader's current choices.
function lightbox(C, live) {
  const dlg = h("dialog", { class: "rd-lightbox", "aria-label": "ภาพขยาย" });
  let api = null;
  const close = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener("close", () => { api?.destroy(); live.delete(api); api = null; });
  return {
    el: dlg,
    open(f, from) {
      const card = h("div", { class: `rd-fig__card rd-fig__card--box${f.kind === "diagram" ? " rd-fig__card--diagram" : ""}` });
      clear(dlg).append(h("div", { class: "rd-lightbox__bar" }, h("span", { text: f.title }),
        h("button", { class: "btn btn--ghost btn--icon", type: "button", "aria-label": "ปิด", text: "×", onclick: close })),
        card, h("p", { class: "rd-fig__cap", text: f.caption }), f.credit ? h("p", { class: "rd-fig__credit", text: f.credit }) : "");
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
      api = mountFigure(card, f, C, { state: from ? from.state : null });
      live.add(api);
      dlg.append(actions(f, C, () => api));
    },
  };
}

export function initReader(app) {
  const { main } = app;
  clear(main).append(h("p", { class: "loading", text: "กำลังโหลดเนื้อหา…" }));
  let alive = true;
  const cleanups = [];
  const live = new Set();
  loadContent().then((C) => {
    if (!alive) return;
    const lb = lightbox(C, live);
    const open = (f, api) => lb.open(f, api);
    const parts = new Map(C.parts.map((p) => [p.id, p]));
    const progress = h("div", { class: "rd-progress", "aria-hidden": "true" }, h("span"));
    const root = h("div", { class: "reader" }, progress, hero(C, app));
    let n = 0;
    C.chapters.forEach((ch, i) => {
      const part = parts.get(ch.part);
      if (i === 0 || C.chapters[i - 1].part !== ch.part) {
        root.append(h("section", { class: "rd-part", id: `rd-part-${part.id}` },
          h("p", { class: "rd-part__no", text: `ส่วนที่ ${part.id}` }), h("h2", { class: "rd-part__title", text: part.title }),
          h("p", { class: "rd-part__intro", text: part.intro })));
      }
      root.append(chapterBlock(ch, part, n++, app, C, open, live));
      if (i === C.chapters.length - 1 || C.chapters[i + 1].part !== ch.part) root.append(sourcesBlock(part));
    });
    root.append(closingBlock(C, open, app, live), footer(C, app), lb.el);
    clear(main).append(root);
    // figures without a definition fall back to a message rather than failing silently
    for (const ch of C.chapters) for (const f of ch.figures) if (!definition(f)) console.warn("no interactive definition for", f.id);

    // Topbar: the chapter in view and the reading progress.
    const where = document.querySelector(".topbar__where");
    const total = C.chapters.length;
    const byId = new Map(C.chapters.map((c, i) => [c.id, { c, i }]));
    function setWhere(id) {
      if (!where) return;
      clear(where);
      const hit = byId.get(id);
      if (hit) where.append(h("span", { class: "topbar__chapter", text: hit.c.short }), h("span", { class: "topbar__scene", text: `${hit.i + 1} / ${total}` }));
      else if (id === "closing") where.append(h("span", { class: "topbar__chapter", text: "ข้อเสนอและข้อถกเถียง" }));
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setWhere(e.target.dataset.ch);
    }, { rootMargin: "-45% 0px -50% 0px" });
    root.querySelectorAll("[data-ch]").forEach((el) => io.observe(el));
    const bar = progress.firstChild;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = `${max > 0 ? Math.min(100, (scrollY / max) * 100) : 0}%`;
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    cleanups.push(() => { io.disconnect(); removeEventListener("scroll", onScroll); });
    if (location.hash.startsWith("#ch-")) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }).catch((err) => {
    if (!alive) return;
    console.error(err);
    clear(main).append(h("div", { class: "fatal" }, h("h1", { text: "เปิดหน้าอ่านเนื้อหาไม่ได้" }), h("p", { text: String(err.message || err) }),
      h("p", { text: "สร้างเนื้อหาด้วย python -m scripts.webstory.reader_build" })));
  });
  return {
    render() {},
    goto() {},
    destroy() {
      alive = false;
      cleanups.forEach((f) => f());
      for (const api of live) api?.destroy();
      live.clear();
      const where = document.querySelector(".topbar__where");
      if (where) clear(where);
      clear(main);
    },
  };
}
