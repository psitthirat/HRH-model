// Chart kit for the Read page: data loading, scales, axes, legends, tooltips,
// the panel shapes the reader's figures use (lines, bars, dots, maps) and the
// PNG/SVG export with the credit band. Figures are described in figures.js and
// diagrams.js; this file never holds a research value. Every number drawn comes
// from the figure's CSV (copied from the research outputs by reader_build.py).
//
// Colours are roles (--rv-*) defined in css/reader.css for the light and dark
// themes, validated with the dataviz palette checker; an export always renders
// the light theme on white.

import { h, s, clear } from "../util/dom.js";
import { linear, log as logScale, ticks as tickValues, nice } from "../util/scale.js";

export const BE = 543;
const SVGNS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------- data
const files = new Map();
const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1 || r[0] !== "").map((r) => {
    const o = {};
    head.forEach((k, j) => {
      const v = r[j] ?? "";
      o[k] = v === "" ? null : NUM.test(v) ? Number(v) : v === "True" ? true : v === "False" ? false : v;
    });
    return o;
  });
}

export function loadCSV(href) {
  if (!files.has(href)) {
    files.set(href, fetch(new URL(`../../${href}`, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ ${href} (${r.status})`);
      return r.text();
    }).then(parseCSV).catch((e) => { files.delete(href); throw e; }));
  }
  return files.get(href);
}

export function loadJSON(href) {
  if (!files.has(href)) {
    files.set(href, fetch(new URL(`../../${href}`, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ ${href} (${r.status})`);
      return r.json();
    }).catch((e) => { files.delete(href); throw e; }));
  }
  return files.get(href);
}

export const code = (v) => String(Math.round(Number(v)));

// ---------------------------------------------------------------- formatting
const nfCache = new Map();
function nf(d) {
  if (!nfCache.has(d)) nfCache.set(d, new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  return nfCache.get(d);
}
export const fmt = {
  int: (v) => (v == null || !Number.isFinite(v) ? "–" : nf(0).format(Math.round(v) === 0 ? 0 : Math.round(v))),
  dec: (d) => (v) => (v == null || !Number.isFinite(v) ? "–" : nf(d).format(v)),
  pct: (d = 1) => (v) => (v == null || !Number.isFinite(v) ? "–" : `${nf(d).format(v)}%`),
  signed: (d = 1, unit = "") => (v) => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(d).format(Math.abs(v))}${unit}`),
  be: (y) => String(Math.round(y) + BE),
};

// Axis ticks: compact from ten thousand up, decimals from the tick step.
export function tickFormat(step) {
  if (step >= 1) return (v) => nf(0).format(v);
  const d = Math.min(3, Math.max(1, Math.ceil(-Math.log10(step) - 1e-9)));
  return (v) => nf(d).format(v);
}

// ---------------------------------------------------------------- text
let measureCtx = null;
export function textWidth(str, size = 12, weight = 400) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = `${weight} ${size}px Prompt, "Noto Sans Thai", Thonburi, sans-serif`;
  return measureCtx.measureText(String(str)).width;
}

const seg = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("th", { granularity: "word" }) : null;
// Words the Thai segmenter splits but a line must keep together.
const GLUE = new Set(["เสียเปรียบ", "ได้เปรียบ", "ภาคเอกชน", "แพทย์ใหม่", "โรงพยาบาล", "สาธารณสุข", "ใช้ทุน", "ตำแหน่ง", "ตัวหาร", "เยี่ยมบ้าน", "ตัดสิน", "ฉากทัศน์"]);
function words(str) {
  const w = seg ? [...seg.segment(String(str))].map((x) => x.segment) : String(str).split(/(\s+)/);
  const ascii = /^[\x21-\x7e]+$/;
  for (let i = 0; i < w.length - 1; i++) {
    const a = w[i], b = w[i + 1];
    if (GLUE.has(a + b) || a === "(" || b === ")" || (ascii.test(a) && ascii.test(b))) { w.splice(i, 2, a + b); i--; }
  }
  return w;
}
export function wrap(str, maxW, size = 12, weight = 400) {
  const words_ = words(str);
  const lines = [];
  let cur = "";
  for (const w of words_) {
    const test = cur + w;
    if (cur.trim() && textWidth(test.trimEnd(), size, weight) > maxW) { lines.push(cur.trim()); cur = w.trimStart(); }
    else cur = test;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.length ? lines : [""];
}

// SVG text with an optional class and a vertical nudge instead of
// dominant-baseline (office apps ignore it when the SVG is downloaded).
export function text(g, x, y, str, cls = "rv-lab", attrs = {}) {
  const t = s("text", { x, y, class: cls, ...attrs });
  t.textContent = str;
  g.append(t);
  return t;
}

export function textLines(g, x, y, lines, cls, lh, attrs = {}) {
  const t = s("text", { x, y, class: cls, ...attrs });
  lines.forEach((ln, i) => t.append(s("tspan", { x, dy: i ? lh : 0, text: ln })));
  g.append(t);
  return t;
}

// ---------------------------------------------------------------- colours
export const C = {
  s: (n) => `var(--rv-${n})`,
  ink: "var(--rv-ink)", ink2: "var(--rv-ink2)", muted: "var(--rv-muted)", neutral: "var(--rv-neutral)",
  neutral2: "var(--rv-neutral2)", none: "var(--rv-none)", surface: "var(--rv-surface)",
  seq: (i) => `var(--rv-seq-${i})`,
};
export function paint(el, { fill, stroke, width, dash, opacity, cap } = {}) {
  if (fill !== undefined) el.style.fill = fill;
  if (stroke !== undefined) el.style.stroke = stroke;
  if (width !== undefined) el.style.strokeWidth = width;
  if (dash) el.style.strokeDasharray = dash;
  if (opacity !== undefined) el.style.opacity = opacity;
  if (cap) { el.style.strokeLinecap = cap; el.style.strokeLinejoin = "round"; }
  return el;
}
export const DASH = { solid: null, dash: "6 4", dot: "1.5 3.5", long: "10 5" };

// ---------------------------------------------------------------- tooltip
let tipEl = null;
function tipNode() {
  if (!tipEl) tipEl = document.getElementById("tooltip");
  return tipEl;
}
// rows: [{ label, value, color?, dash?, swatch? }]. Values lead, labels follow;
// every string goes in as text, never as markup.
export function showTip(evt, title, rows = [], note = "") {
  const t = tipNode();
  if (!t) return;
  clear(t);
  t.classList.add("rv-tip");
  if (title) t.append(h("strong", { class: "rv-tip__title", text: title }));
  for (const r of rows) {
    const key = r.color ? h("span", { class: `rv-tip__key rv-tip__key--${r.swatch || (r.dash ? "dash" : "line")}` }) : null;
    if (key) key.style.setProperty("--k", r.color);
    t.append(h("div", { class: "rv-tip__row" }, h("b", { text: r.value }), h("span", {}, key || "", h("span", { text: r.label }))));
  }
  if (note) t.append(h("div", { class: "rv-tip__note", text: note }));
  t.hidden = false;
  let x, y;
  if (evt && evt.clientX != null && evt.type && !evt.type.startsWith("key") && !evt.type.startsWith("focus")) { x = evt.clientX; y = evt.clientY; }
  else {
    const r = (evt && evt.anchor) || (evt && evt.target && evt.target.getBoundingClientRect && evt.target.getBoundingClientRect());
    x = r ? r.left + r.width / 2 : innerWidth / 2; y = r ? r.top : innerHeight / 2;
  }
  const tw = t.offsetWidth, th = t.offsetHeight;
  let left = x + 16, top = y - th - 14;
  if (left + tw > innerWidth - 8) left = x - tw - 16;
  if (left < 8) left = 8;
  if (top < 8) top = y + 20;
  if (top + th > innerHeight - 8) top = Math.max(8, innerHeight - th - 8);
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}
export function hideTip() {
  const t = tipNode();
  if (t) { t.hidden = true; t.classList.remove("rv-tip"); }
}

// Hover, focus and touch all open the same tooltip for a mark.
export function bindTip(el, fn) {
  const show = (e) => { const r = fn(e); if (r) showTip(e, r.title, r.rows, r.note); };
  el.addEventListener("pointerenter", show);
  el.addEventListener("pointermove", show);
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("focus", (e) => { const r = fn(e); if (r) showTip({ type: "focus", anchor: el.getBoundingClientRect() }, r.title, r.rows, r.note); });
  el.addEventListener("blur", hideTip);
}

// ---------------------------------------------------------------- axes and frames
export function yAxis(g, y, plot, { ticks, format, grid = true, label } = {}) {
  const vals = ticks || y.ticks(5);
  const st = vals.length > 1 ? Math.abs(vals[1] - vals[0]) : 1;
  const f = format || tickFormat(st);
  const ax = s("g", { class: "rv-axis" });
  for (const v of vals) {
    const yy = y(v);
    if (grid) ax.append(s("line", { class: "rv-grid", x1: plot.x0, x2: plot.x1, y1: yy, y2: yy }));
    text(ax, plot.x0 - 8, yy + 4, f(v), "rv-tick", { "text-anchor": "end" });
  }
  if (label) text(ax, plot.x0 - 8 - (plot.tickW || 0), plot.y0 - 12, label, "rv-axlab");
  g.append(ax);
  return ax;
}

export function xAxis(g, x, plot, values, format, { every = 1, label, baseline = true, tickmarks = true } = {}) {
  const ax = s("g", { class: "rv-axis" });
  if (baseline) ax.append(s("line", { class: "rv-base", x1: plot.x0, x2: plot.x1, y1: plot.y1, y2: plot.y1 }));
  values.forEach((v, i) => {
    if (i % every && i !== values.length - 1) return;
    const xx = x(v);
    if (tickmarks) ax.append(s("line", { class: "rv-base", x1: xx, x2: xx, y1: plot.y1, y2: plot.y1 + 4 }));
    text(ax, xx, plot.y1 + 18, format(v), "rv-tick", { "text-anchor": "middle" });
  });
  if (label) text(ax, (plot.x0 + plot.x1) / 2, plot.y1 + 38, label, "rv-axlab", { "text-anchor": "middle" });
  g.append(ax);
  return ax;
}

export function title(g, x, y, str, maxW) {
  const lines = wrap(str, maxW, 13.5, 500);
  textLines(g, x, y, lines, "rv-ptitle", 18);
  return lines.length * 18;
}

// How many x labels fit without colliding.
export function every(values, x, format, minGap = 10) {
  if (values.length < 2) return 1;
  const w = Math.max(...values.map((v) => textWidth(format(v), 11.5))) + minGap;
  const step = Math.abs(x(values[1]) - x(values[0])) || 1;
  return Math.max(1, Math.ceil(w / step));
}

// Push labels apart vertically (sorted by y), keeping them inside [lo, hi].
export function spread(items, gap, lo, hi) {
  const a = items.slice().sort((p, q) => p.y - q.y);
  for (let i = 1; i < a.length; i++) if (a[i].y - a[i - 1].y < gap) a[i].y = a[i - 1].y + gap;
  const over = a.length ? a[a.length - 1].y - hi : 0;
  if (over > 0) for (const it of a) it.y -= over;
  for (let i = a.length - 2; i >= 0; i--) if (a[i + 1].y - a[i].y < gap) a[i].y = a[i + 1].y - gap;
  for (const it of a) it.y = Math.max(lo, it.y);
  return items;
}

// ---------------------------------------------------------------- line panel
// o: { title, x: {values, format, label}, y: {domain, ticks, format, label, zero},
//      series: [{key, label, color, dash, width, points: [{x, y}], dots, end}],
//      refs: [{y, label}], vlines: [{x, label}], bands: [{x0, x1, label}],
//      tip(xv) -> {title, rows}, endFormat }
export function linePanel(g, box, o, env) {
  const narrow = box.w < 480;
  let top = box.y;
  if (o.title) top += title(g, box.x, box.y + 13, o.title, box.w) + 6;
  const vis = o.series.filter((sr) => sr.points.length);
  const all = vis.flatMap((sr) => sr.points.map((p) => p.y)).concat((o.refs || []).map((r) => r.y)).filter(Number.isFinite);
  let dom = o.y.domain || [Math.min(...all), Math.max(...all)];
  if (!o.y.domain) {
    if (o.y.zero !== false && dom[0] > 0 && dom[0] < dom[1] * 0.45) dom[0] = 0;
    const pad = (dom[1] - dom[0]) * 0.06 || 1;
    dom = nice([o.y.zero !== false && dom[0] === 0 ? 0 : dom[0] - pad, dom[1] + pad], 5);
  }
  const yTicks = o.y.ticks || tickValues(dom[0], dom[1], narrow ? 4 : 5);
  const st = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
  const yf = o.y.format || tickFormat(st);
  const tickW = o.tickW ?? Math.max(...yTicks.map((v) => textWidth(yf(v), 11.5)));
  // end labels: only where they fit
  const endItems = vis.filter((sr) => sr.end !== false);
  const endText = (sr) => (o.endFormat ? `${o.endFormat(sr.points[sr.points.length - 1].y)}  ${sr.endLabel || ""}`.trim() : sr.endLabel || sr.label);
  let endW = endItems.length && !o.noEnd ? Math.max(...endItems.map((sr) => textWidth(endText(sr), 11.5))) + 14 : 8;
  if (endW > box.w * 0.34) endW = 8;
  if (o.endW != null) endW = o.endW;
  const plot = { x0: box.x + tickW + 10, x1: box.x + box.w - endW, y0: top + (o.y.label ? 22 : 8), y1: box.y + box.h - (o.x.label ? 44 : 26), tickW };
  plot.tickW = 0;
  const xs = o.x.values;
  const x = linear([xs[0], xs[xs.length - 1]], [plot.x0 + 4, plot.x1 - 4]);
  const y = linear(dom, [plot.y1, plot.y0]);
  for (const b of o.bands || []) {
    const r = s("rect", { class: "rv-band", x: x(b.x0), y: plot.y0, width: Math.max(1, x(b.x1) - x(b.x0)), height: plot.y1 - plot.y0 });
    g.append(r);
    if (b.label) text(g, (x(b.x0) + x(b.x1)) / 2, plot.y0 + 12, b.label, "rv-note", { "text-anchor": "middle" });
  }
  yAxis(g, y, plot, { ticks: yTicks, format: yf, label: o.y.label });
  for (const v of o.vlines || []) {
    g.append(s("line", { class: "rv-vline", x1: x(v.x), x2: x(v.x), y1: plot.y0, y2: plot.y1 }));
  }
  if (o.vlineLabel && (o.vlines || []).length) {
    const vx = x(o.vlines[0].x);
    text(g, vx + 4, plot.y0 + 11, o.vlineLabel, "rv-note");
  }
  if (dom[0] < 0 && dom[1] > 0) g.append(s("line", { class: "rv-zero", x1: plot.x0, x2: plot.x1, y1: y(0), y2: y(0) }));
  for (const r of o.refs || []) {
    g.append(s("line", { class: "rv-ref", x1: plot.x0, x2: plot.x1, y1: y(r.y), y2: y(r.y) }));
    if (r.label) text(g, r.align === "right" ? plot.x1 - 4 : plot.x0 + 6, y(r.y) - 6, r.label, "rv-note", { "text-anchor": r.align === "right" ? "end" : "start" });
  }
  const ev = every(xs, x, o.x.format);
  xAxis(g, x, plot, xs, o.x.format, { every: ev, label: o.x.label });
  const lineG = s("g", { class: "rv-lines" });
  for (const sr of vis) {
    const segs = [];
    let cur = [];
    for (const p of sr.points) {
      if (p.y == null || !Number.isFinite(p.y)) { if (cur.length) segs.push(cur); cur = []; continue; }
      if (cur.length && sr.gapX && p.x - cur[cur.length - 1].x > sr.gapX) { segs.push(cur); cur = []; }
      cur.push(p);
    }
    if (cur.length) segs.push(cur);
    for (const sg of segs) {
      const d = sg.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
      lineG.append(paint(s("path", { d, class: "rv-line", "data-key": sr.key }), { stroke: sr.color, width: sr.width || 2, dash: sr.dash, cap: "round", fill: "none" }));
    }
    if (sr.dots) for (const p of sr.points) if (Number.isFinite(p.y)) lineG.append(paint(s("circle", { class: "rv-dot", cx: x(p.x), cy: y(p.y), r: sr.dotR || 3.2 }), { fill: sr.color }));
  }
  g.append(lineG);
  if (endW > 8 && !o.noEnd && endItems.length) {
    const items = endItems.map((sr) => { const p = sr.points[sr.points.length - 1]; return { sr, y: y(p.y) + 4, y0: y(p.y), x: x(p.x) }; });
    spread(items, 14, plot.y0 + 4, plot.y1);
    for (const it of items) {
      g.append(paint(s("circle", { class: "rv-enddot", cx: it.x, cy: it.y0, r: 3.6 }), { fill: it.sr.color }));
      if (Math.abs(it.y - 4 - it.y0) > 3) g.append(s("line", { class: "rv-leader", x1: it.x + 5, y1: it.y0, x2: it.x + 10, y2: it.y - 4 }));
      text(g, it.x + 12, it.y, endText(it.sr), "rv-end");
    }
  }
  // crosshair: the pointer finds the nearest x; one readout for every series
  if (!env?.export && o.tip) {
    const hair = s("line", { class: "rv-hair", x1: 0, x2: 0, y1: plot.y0, y2: plot.y1, visibility: "hidden" });
    const marks = s("g", { class: "rv-hairdots" });
    const hit = s("rect", { class: "rv-hit", x: plot.x0, y: plot.y0, width: plot.x1 - plot.x0, height: plot.y1 - plot.y0, tabindex: 0,
      role: "img", "aria-label": `${o.title || ""} ใช้ปุ่มลูกศรเพื่ออ่านค่ารายปี` });
    let idx = -1;
    const at = (i, evt) => {
      idx = Math.max(0, Math.min(xs.length - 1, i));
      const xv = xs[idx], px = x(xv);
      hair.setAttribute("x1", px); hair.setAttribute("x2", px); hair.setAttribute("visibility", "visible");
      clear(marks);
      for (const sr of vis) {
        const p = sr.points.find((q) => q.x === xv);
        if (p && Number.isFinite(p.y)) marks.append(paint(s("circle", { cx: px, cy: y(p.y), r: 4.2, class: "rv-hairdot" }), { fill: sr.color }));
      }
      const r = o.tip(xv);
      if (r) showTip(evt, r.title, r.rows, r.note);
    };
    const nearest = (cx) => {
      let best = 0, bd = Infinity;
      xs.forEach((v, i) => { const d = Math.abs(x(v) - cx); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const local = (e) => { const r = hit.ownerSVGElement.getBoundingClientRect(); const k = r.width / hit.ownerSVGElement.viewBox.baseVal.width; return (e.clientX - r.left) / k; };
    hit.addEventListener("pointermove", (e) => at(nearest(local(e)), e));
    hit.addEventListener("pointerdown", (e) => at(nearest(local(e)), e));
    const off = () => { hair.setAttribute("visibility", "hidden"); clear(marks); hideTip(); };
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("blur", off);
    hit.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const r = hit.getBoundingClientRect();
        at((idx < 0 ? 0 : idx + (e.key === "ArrowRight" ? 1 : -1)), { type: "key", anchor: { left: r.left + (x(xs[Math.max(0, idx)]) - plot.x0) * (r.width / (plot.x1 - plot.x0)), top: r.top, width: 0 } });
      } else if (e.key === "Escape") off();
    });
    g.append(hair, marks, hit);
  }
  return { plot, x, y };
}

// ---------------------------------------------------------------- bar panel (horizontal)
// o: { title, cats: [{key, label}], series: [{key, label, color}], value(cat, ser), lo?/hi? (error bars),
//      x: {domain, format, label}, stacked, valueLabels, tip(cat, ser), rowH, labelW }
export function hbarPanel(g, box, o, env) {
  let top = box.y;
  if (o.title) top += title(g, box.x, box.y + 13, o.title, box.w) + 6;
  const ser = o.series;
  const rowH = o.rowH || (ser.length > 1 && !o.stacked ? 14 * ser.length + 10 : 26);
  const labelW = Math.min(o.labelW || Math.max(...o.cats.map((c) => textWidth(c.label, 12))) + 12, box.w * 0.42);
  const vals = [];
  for (const c of o.cats) {
    if (o.stacked) vals.push(ser.reduce((a, sr) => a + (o.value(c, sr) || 0), 0));
    else for (const sr of ser) vals.push(o.value(c, sr));
  }
  let dom = o.x.domain || [Math.min(0, ...vals.filter(Number.isFinite)), Math.max(0, ...vals.filter(Number.isFinite))];
  if (!o.x.domain) dom = nice(dom, 5);
  const valW = o.valueLabels ? Math.max(...vals.filter(Number.isFinite).map((v) => textWidth(o.x.format(v), 11.5))) + 8 : 0;
  const plot = { x0: box.x + labelW, x1: box.x + box.w - Math.max(6, valW), y0: top + (o.x.labelTop ? 22 : 6), y1: 0 };
  plot.y1 = plot.y0 + rowH * o.cats.length;
  const x = linear(dom, [plot.x0 + (dom[0] < 0 && o.valueLabels ? valW : 0), plot.x1]);
  const xt = tickValues(dom[0], dom[1], box.w < 480 ? 4 : 6);
  const st = xt.length > 1 ? xt[1] - xt[0] : 1;
  const xf = o.x.tickFormat || tickFormat(st);
  for (const v of xt) g.append(s("line", { class: v === 0 ? "rv-zero" : "rv-grid", x1: x(v), x2: x(v), y1: plot.y0 - 2, y2: plot.y1 }));
  for (const v of xt) text(g, x(v), plot.y1 + 16, xf(v), "rv-tick", { "text-anchor": "middle" });
  if (o.x.label) text(g, (plot.x0 + plot.x1) / 2, plot.y1 + 36, o.x.label, "rv-axlab", { "text-anchor": "middle" });
  if (o.x.labelTop) text(g, plot.x0, plot.y0 - 10, o.x.labelTop, "rv-axlab");
  o.cats.forEach((c, i) => {
    const yy = plot.y0 + i * rowH;
    const lines = wrap(c.label, labelW - 10, 12);
    textLines(g, plot.x0 - 8, yy + rowH / 2 + 4 - (lines.length - 1) * 7, lines.slice(0, 2), "rv-cat", 14, { "text-anchor": "end" });
    let acc = 0;
    ser.forEach((sr, j) => {
      const v = o.value(c, sr);
      if (v == null || !Number.isFinite(v)) return;
      const bh = o.stacked ? Math.min(18, rowH - 8) : Math.min(18, (rowH - 10) / ser.length - 2);
      const by = o.stacked ? yy + (rowH - bh) / 2 : yy + 5 + j * (bh + 2);
      const a = o.stacked ? acc : 0, b = o.stacked ? acc + v : v;
      const x0 = x(Math.min(a, b)), x1 = x(Math.max(a, b));
      const r = s("rect", { class: "rv-bar", x: x0, y: by, width: Math.max(0.8, x1 - x0 - (o.stacked ? 1 : 0)), height: bh, rx: 2 });
      paint(r, { fill: sr.color });
      if (o.tip && !env?.export) bindTip(r, () => o.tip(c, sr));
      g.append(r);
      if (o.valueLabels && !o.stacked) {
        const right = v >= 0;
        text(g, right ? x1 + 4 : x0 - 4, by + bh / 2 + 4, o.x.format(v), "rv-val", { "text-anchor": right ? "start" : "end" });
      }
      acc += o.stacked ? v : 0;
    });
    if (o.valueLabels && o.stacked) text(g, x(acc) + 4, yy + rowH / 2 + 4, o.x.format(acc), "rv-val");
    if (o.rowHit && o.tip && !env?.export) {
      const hit = s("rect", { class: "rv-hit", x: box.x, y: yy, width: box.w, height: rowH });
      bindTip(hit, (e) => o.tip(c, null, e));
      g.append(hit);
    }
  });
  return { plot, x, height: plot.y1 + (o.x.label ? 44 : 24) - box.y };
}

// ---------------------------------------------------------------- column panel (vertical)
// o: { title, cats: [{key, label}], series: [{key, label, color}], value(cat, ser), stacked,
//      y: {domain, format, label}, xLabels (false to hide), x: {label}, lines: [{key, color, dash, dots, points: [{cat, y}]}],
//      valueLabels, tip(cat) }
export function vbarPanel(g, box, o, env) {
  let top = box.y;
  if (o.title) top += title(g, box.x, box.y + 13, o.title, box.w) + 6;
  const narrow = box.w < 480;
  const vals = [];
  for (const c of o.cats) {
    if (o.stacked) {
      let pos = 0, neg = 0;
      for (const sr of o.series) { const v = o.value(c, sr) || 0; if (v >= 0) pos += v; else neg += v; }
      vals.push(pos, neg);
    } else for (const sr of o.series) vals.push(o.value(c, sr));
  }
  for (const ln of o.lines || []) for (const p of ln.points) vals.push(p.y);
  const fin = vals.filter(Number.isFinite);
  let dom = o.y.domain || nice([Math.min(0, ...fin), Math.max(0, ...fin)], narrow ? 4 : 5);
  const yt = tickValues(dom[0], dom[1], narrow ? 4 : 5);
  const yf = o.y.format || tickFormat(yt.length > 1 ? yt[1] - yt[0] : 1);
  const tickW = Math.max(...yt.map((v) => textWidth(yf(v), 11.5)));
  const plot = { x0: box.x + tickW + 10, x1: box.x + box.w - 6, y0: top + (o.y.label ? 22 : 8), y1: box.y + box.h - (o.xLabels === false ? 10 : o.x?.label ? 44 : 26) };
  const y = linear(dom, [plot.y1, plot.y0]);
  yAxis(g, y, plot, { ticks: yt, format: yf, label: o.y.label });
  const n = o.cats.length, band = (plot.x1 - plot.x0) / n;
  const k = o.stacked ? 1 : o.series.length;
  const bw = Math.max(1.5, Math.min(24, (band * 0.78 - 2 * (k - 1)) / k));
  const cx = (i) => plot.x0 + band * (i + 0.5);
  g.append(s("line", { class: "rv-base", x1: plot.x0, x2: plot.x1, y1: y(0), y2: y(0) }));
  o.cats.forEach((c, i) => {
    let pos = 0, neg = 0;
    o.series.forEach((sr, j) => {
      const v = o.value(c, sr);
      if (v == null || !Number.isFinite(v)) return;
      let a, b, xx;
      if (o.stacked) { if (v >= 0) { a = pos; b = pos + v; pos = b; } else { a = neg; b = neg + v; neg = b; } xx = cx(i) - bw / 2; }
      else { a = 0; b = v; xx = cx(i) - (k * bw + 2 * (k - 1)) / 2 + j * (bw + 2); }
      const y0 = y(Math.max(a, b)), y1 = y(Math.min(a, b));
      const r = s("rect", { class: "rv-bar", x: xx, y: y0, width: bw, height: Math.max(0.6, y1 - y0 - (o.stacked ? 1 : 0)), rx: bw > 6 ? 2 : 0 });
      paint(r, { fill: sr.color });
      g.append(r);
      if (o.valueLabels && !o.stacked) text(g, xx + bw / 2, v >= 0 ? y0 - 4 : y1 + 12, (o.valueFormat || yf)(v), "rv-val", { "text-anchor": "middle" });
    });
  });
  if (o.xLabels !== false) {
    const lf = (c) => c.label;
    const w = Math.max(...o.cats.map((c) => textWidth(lf(c), 11.5))) + 8;
    const ev = Math.max(1, Math.ceil(w / band));
    o.cats.forEach((c, i) => {
      if (i % ev && i !== n - 1) return;
      const lines = String(lf(c)).split("\n");
      textLines(g, cx(i), plot.y1 + 18, lines, "rv-tick", 13, { "text-anchor": "middle" });
    });
  }
  if (o.x?.label) text(g, (plot.x0 + plot.x1) / 2, plot.y1 + 40, o.x.label, "rv-axlab", { "text-anchor": "middle" });
  for (const ln of o.lines || []) {
    const pts = ln.points.filter((p) => Number.isFinite(p.y)).map((p) => [cx(o.cats.findIndex((c) => c.key === p.cat)), y(p.y)]);
    if (!pts.length) continue;
    g.append(paint(s("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(""), class: "rv-line" }),
      { stroke: ln.color, width: ln.width || 2, dash: ln.dash, fill: "none", cap: "round" }));
    if (ln.dots) for (const p of pts) g.append(paint(s(ln.square ? "rect" : "circle", ln.square ? { x: p[0] - 3.5, y: p[1] - 3.5, width: 7, height: 7 } : { cx: p[0], cy: p[1], r: 3.8 }), { fill: ln.color, stroke: C.surface, width: 1.2 }));
  }
  if (o.tip && !env?.export) o.cats.forEach((c, i) => {
    const hit = s("rect", { class: "rv-hit", x: plot.x0 + band * i, y: plot.y0, width: band, height: plot.y1 - plot.y0 });
    bindTip(hit, () => o.tip(c));
    g.append(hit);
  });
  return { plot, y, cx, band };
}

// ---------------------------------------------------------------- dot and whisker
// o: { cats, series:[{key,color}], get(cat, ser) -> {v, lo, hi, filled}, x: {domain, log, ref, format, label, ticks},
//      tip(cat, ser), valueLabels, labelW, rowH }
export function dotPanel(g, box, o, env) {
  let top = box.y;
  if (o.title) top += title(g, box.x, box.y + 13, o.title, box.w) + 6;
  const rowH = o.rowH || 26;
  const labelW = o.labelW != null ? o.labelW : Math.min(Math.max(...o.cats.map((c) => textWidth(c.label, 12))) + 14, box.w * 0.45);
  const valW = o.valueLabels ? 34 : 6;
  const plot = { x0: box.x + labelW, x1: box.x + box.w - valW, y0: top + 6, y1: 0 };
  plot.y1 = plot.y0 + rowH * o.cats.length;
  const x = o.x.log ? logScale(o.x.domain, [plot.x0 + 6, plot.x1 - 4]) : linear(o.x.domain, [plot.x0 + 6, plot.x1 - 4]);
  const xt = o.x.ticks || tickValues(o.x.domain[0], o.x.domain[1], 5);
  for (const v of xt) {
    g.append(s("line", { class: "rv-grid", x1: x(v), x2: x(v), y1: plot.y0 - 2, y2: plot.y1 }));
    text(g, x(v), plot.y1 + 16, o.x.format(v), "rv-tick", { "text-anchor": "middle" });
  }
  if (o.x.ref != null) g.append(s("line", { class: "rv-zero", x1: x(o.x.ref), x2: x(o.x.ref), y1: plot.y0 - 2, y2: plot.y1 }));
  if (o.x.label) {
    const lw = textWidth(o.x.label, 12) / 2;
    text(g, Math.min(box.x + box.w - lw, Math.max(box.x + lw, (plot.x0 + plot.x1) / 2)), plot.y1 + 36, o.x.label, "rv-axlab", { "text-anchor": "middle" });
  }
  o.cats.forEach((c, i) => {
    const yy = plot.y0 + i * rowH + rowH / 2;
    if (labelW > 0) {
      const lines = wrap(c.label, labelW - 12, 12);
      textLines(g, plot.x0 - 8, yy + 4 - (Math.min(2, lines.length) - 1) * 7, lines.slice(0, 2), "rv-cat", 14, { "text-anchor": "end" });
    }
    o.series.forEach((sr, j) => {
      const d = o.get(c, sr);
      if (!d || !Number.isFinite(d.v)) return;
      const off = (j - (o.series.length - 1) / 2) * 7;
      const lo = Number.isFinite(d.lo) ? x(Math.max(o.x.domain[0], d.lo)) : null, hi = Number.isFinite(d.hi) ? x(Math.min(o.x.domain[1], d.hi)) : null;
      if (lo != null && hi != null) g.append(paint(s("line", { class: "rv-ci", x1: lo, x2: hi, y1: yy + off, y2: yy + off }), { stroke: sr.color, width: 2.4, cap: "round" }));
      const dot = s("circle", { class: "rv-dot", cx: x(d.v), cy: yy + off, r: 5 });
      paint(dot, d.filled === false ? { fill: C.surface, stroke: sr.color, width: 2.2 } : { fill: sr.color, stroke: C.surface, width: 1.5 });
      g.append(dot);
      if (o.valueLabels) text(g, Math.min(plot.x1 + 2, (hi ?? x(d.v)) + 6), yy + off + 4, o.x.format(d.v), "rv-val");
    });
    if (o.tip && !env?.export) {
      const hit = s("rect", { class: "rv-hit", x: box.x, y: yy - rowH / 2, width: box.w, height: rowH });
      bindTip(hit, () => o.tip(c));
      g.append(hit);
    }
  });
  return { plot, x, height: plot.y1 + (o.x.label ? 44 : 24) - box.y };
}

// ---------------------------------------------------------------- scatter
// o: { title, points: [{x, y, r, color, ring, label, show, key, datum}], x: {domain, format, label}, y: {...},
//      diag, refX, refY, tip(p) }
export function scatterPanel(g, box, o, env) {
  let top = box.y;
  if (o.title) top += title(g, box.x, box.y + 13, o.title, box.w) + 6;
  const narrow = box.w < 480;
  const yd = o.y.domain, xd = o.x.domain;
  const yt = tickValues(yd[0], yd[1], narrow ? 4 : 5), xt = tickValues(xd[0], xd[1], narrow ? 4 : 6);
  const yf = o.y.format || tickFormat(yt.length > 1 ? yt[1] - yt[0] : 1);
  const xf = o.x.format || tickFormat(xt.length > 1 ? xt[1] - xt[0] : 1);
  const tickW = Math.max(...yt.map((v) => textWidth(yf(v), 11.5)));
  const plot = { x0: box.x + tickW + 10, x1: box.x + box.w - 10, y0: top + (o.y.label ? 22 : 8), y1: box.y + box.h - (o.x.label ? 44 : 26) };
  const x = linear(xd, [plot.x0 + 4, plot.x1 - 4]);
  const y = linear(yd, [plot.y1 - 4, plot.y0 + 4]);
  yAxis(g, y, plot, { ticks: yt, format: yf, label: o.y.label });
  for (const v of xt) g.append(s("line", { class: "rv-grid", x1: x(v), x2: x(v), y1: plot.y0, y2: plot.y1 }));
  xAxis(g, x, plot, xt, xf, { label: o.x.label });
  if (o.diag) {
    const a = Math.max(xd[0], yd[0]), b = Math.min(xd[1], yd[1]);
    g.append(s("line", { class: "rv-ref", x1: x(a), y1: y(a), x2: x(b), y2: y(b) }));
    if (o.diagLabel) text(g, x(b) - 4, y(b) + 14, o.diagLabel, "rv-note", { "text-anchor": "end" });
  }
  if (o.refX != null) g.append(s("line", { class: "rv-ref", x1: x(o.refX), x2: x(o.refX), y1: plot.y0, y2: plot.y1 }));
  if (o.refY != null) g.append(s("line", { class: "rv-ref", x1: plot.x0, x2: plot.x1, y1: y(o.refY), y2: y(o.refY) }));
  const pts = o.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const dots = s("g", { class: "rv-dots" });
  const sorted = pts.slice().sort((a, b) => (b.r || 4) - (a.r || 4));
  for (const p of sorted) {
    const c = s("circle", { class: "rv-pt", cx: x(p.x), cy: y(p.y), r: p.r || 4.2 });
    paint(c, { fill: p.color, stroke: p.ring ? C.ink : C.surface, width: p.ring ? 1.6 : 1.2, opacity: p.opacity ?? 0.88 });
    p._el = c;
    dots.append(c);
  }
  g.append(dots);
  const labels = pts.filter((p) => p.show).map((p) => ({ p, y: y(p.y) - (p.r || 4) - 4, x: x(p.x) }));
  spread(labels, 13, plot.y0 + 10, plot.y1 - 2);
  for (const l of labels) {
    const right = l.x < (plot.x0 + plot.x1) / 2;
    text(g, l.x + (right ? 6 : -6), l.y, l.p.label, "rv-plab", { "text-anchor": right ? "start" : "end" });
  }
  if (o.tip && !env?.export) {
    const hit = s("rect", { class: "rv-hit", x: plot.x0, y: plot.y0, width: plot.x1 - plot.x0, height: plot.y1 - plot.y0, tabindex: 0,
      role: "img", "aria-label": `${o.title || ""} ใช้ปุ่มลูกศรเพื่ออ่านค่าทีละจุด` });
    let cur = null, ki = -1;
    const order = pts.slice().sort((a, b) => a.x - b.x);
    const pick = (p, e) => {
      if (cur && cur._el) cur._el.classList.remove("is-hot");
      cur = p;
      if (!p) { hideTip(); return; }
      p._el.classList.add("is-hot");
      const r = o.tip(p);
      if (r) showTip(e, r.title, r.rows, r.note);
    };
    const local = (e) => { const r = hit.ownerSVGElement.getBoundingClientRect(); const k = r.width / hit.ownerSVGElement.viewBox.baseVal.width; return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
    const near = (e) => {
      const [mx, my] = local(e);
      let best = null, bd = 30 * 30;
      for (const p of pts) { const d = (x(p.x) - mx) ** 2 + (y(p.y) - my) ** 2; if (d < bd) { bd = d; best = p; } }
      return best;
    };
    hit.addEventListener("pointermove", (e) => pick(near(e), e));
    hit.addEventListener("pointerdown", (e) => pick(near(e), e));
    hit.addEventListener("pointerleave", () => pick(null));
    hit.addEventListener("blur", () => pick(null));
    hit.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "Escape"].includes(e.key)) return;
      e.preventDefault();
      if (e.key === "Escape") { pick(null); return; }
      ki = Math.max(0, Math.min(order.length - 1, ki + (e.key === "ArrowRight" ? 1 : -1)));
      const p = order[ki], r = p._el.getBoundingClientRect();
      pick(p, { type: "key", anchor: r });
    });
    g.append(hit);
  }
  return { plot, x, y };
}

// ---------------------------------------------------------------- map
// o: { geo, fill(code) -> colour|null, outline(code) -> {dash}|null, tip(code), excluded: Set, maxH }
export function mapPanel(g, box, o, env) {
  const G = o.geo;
  const scale = Math.min(box.w / G.w, (o.maxH || box.h) / G.h);
  const w = G.w * scale, hgt = G.h * scale;
  const ox = box.x + (box.w - w) / 2, oy = box.y;
  const m = s("g", { class: "rv-map", transform: `translate(${ox.toFixed(1)},${oy.toFixed(1)}) scale(${scale.toFixed(4)})` });
  const top = s("g");
  for (const p of G.provinces) {
    const ex = o.excluded?.has(p.code);
    const path = s("path", { d: p.d, class: `rv-prov${ex ? " is-excluded" : ""}`, "data-code": p.code });
    const f = ex ? null : o.fill(p.code);
    if (ex) path.style.fill = hatchOf(g);
    else paint(path, { fill: f || C.none });
    path.style.strokeWidth = `${0.7 / scale}px`;
    m.append(path);
    const ol = ex ? null : o.outline?.(p.code);
    if (ol) {
      const e = s("path", { d: p.d, class: "rv-outline" });
      e.style.strokeWidth = `${1.6 / scale}px`;
      if (ol.dash) e.style.strokeDasharray = `${3 / scale} ${2.2 / scale}`;
      top.append(e);
    }
    if (o.tip && !env?.export && !ex) {
      path.setAttribute("tabindex", "-1");
      bindTip(path, () => o.tip(p.code, p));
    }
  }
  m.append(top);
  g.append(m);
  return { height: hgt, scale, ox, oy };
}

// A hatch pattern for "not in the analysis" (Bangkok), one per SVG with its own id.
let hatchN = 0;
export function defs(svg) {
  const id = `rv-hatch-${++hatchN}`;
  const d = s("defs");
  const pat = s("pattern", { id, width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pat.append(paint(s("rect", { width: 4, height: 4 }), { fill: C.none }), paint(s("line", { x1: 0, y1: 0, x2: 0, y2: 4 }), { stroke: C.neutral, width: 1.2 }));
  d.append(pat);
  svg.append(d);
  svg.dataset.hatch = id;
  return id;
}
const hatchOf = (g) => {
  let el = g;
  while (el && !(el.dataset && el.dataset.hatch)) el = el.parentNode;
  return el ? `url(#${el.dataset.hatch})` : C.none;
};

// ---------------------------------------------------------------- legends
// items: [{key, label, color, shape: line|dash|dot|rect|ring|hollow|outline|outline-dash|hatch, toggle}]
export function legendHTML(items, hidden, onToggle) {
  const el = h("div", { class: "rv-legend", role: "group", "aria-label": "คำอธิบายสัญลักษณ์" });
  for (const it of items) {
    const sw = h("span", { class: `rv-sw rv-sw--${it.shape || "line"}`, "aria-hidden": "true" });
    sw.style.setProperty("--k", it.color || C.neutral);
    if (it.width) sw.style.height = `${it.width}px`;
    const lab = h("span", { text: it.label });
    if (it.toggle && onToggle) {
      const on = !hidden.has(it.key);
      const b = h("button", { type: "button", class: "rv-leg rv-leg--btn", "aria-pressed": String(on), title: on ? "คลิกเพื่อซ่อน" : "คลิกเพื่อแสดง",
        onclick: () => onToggle(it.key) }, sw, lab);
      el.append(b);
    } else el.append(h("span", { class: "rv-leg" }, sw, lab));
  }
  return el;
}

// The same legend drawn in SVG for the export (wrapping rows).
export function legendSVG(g, items, x0, y0, maxW) {
  let x = x0, y = y0 + 12;
  for (const it of items) {
    const w = 26 + textWidth(it.label, 12.5) + 18;
    if (x + w > x0 + maxW && x > x0) { x = x0; y += 22; }
    swatchSVG(g, it, x, y - 4);
    text(g, x + 24, y, it.label, "rv-leglab");
    x += w;
  }
  return y - y0 + 10;
}

function swatchSVG(g, it, x, y) {
  const col = it.color || C.neutral;
  switch (it.shape) {
    case "rect": g.append(paint(s("rect", { x, y: y - 6, width: 16, height: 12, rx: 2 }), { fill: col })); break;
    case "dot": g.append(paint(s("circle", { cx: x + 8, cy: y, r: 5 }), { fill: col })); break;
    case "hollow": g.append(paint(s("circle", { cx: x + 8, cy: y, r: 4.6 }), { fill: C.surface, stroke: col, width: 2 })); break;
    case "ring": g.append(paint(s("circle", { cx: x + 8, cy: y, r: 5 }), { fill: C.neutral2, stroke: C.ink, width: 1.6 })); break;
    case "outline": g.append(paint(s("rect", { x, y: y - 6, width: 16, height: 12, rx: 2 }), { fill: C.none, stroke: C.ink, width: 1.6 })); break;
    case "outline-dash": g.append(paint(s("rect", { x, y: y - 6, width: 16, height: 12, rx: 2 }), { fill: C.none, stroke: C.ink, width: 1.6, dash: "3 2" })); break;
    case "hatch": g.append(paint(s("rect", { x, y: y - 6, width: 16, height: 12, rx: 2 }), { fill: hatchOf(g), stroke: C.neutral, width: 1 })); break;
    default: g.append(paint(s("line", { x1: x, x2: x + 18, y1: y, y2: y }), { stroke: col, width: it.width || 2.6, dash: it.shape === "dash" ? "5 3" : it.shape === "dotted" ? "1.5 3" : null, cap: "round" }));
  }
}

// A stepped colour key for maps: classes with their labels.
export function classKey(items, titleText) {
  const el = h("div", { class: "rv-key", role: "group", "aria-label": titleText || "ระดับสี" });
  if (titleText) el.append(h("span", { class: "rv-key__title", text: titleText }));
  for (const it of items) {
    const sw = h("span", { class: `rv-sw rv-sw--${it.shape || "rect"}`, "aria-hidden": "true" });
    sw.style.setProperty("--k", it.color);
    el.append(h("span", { class: "rv-leg" }, sw, h("span", { text: it.label })));
  }
  return el;
}

// ---------------------------------------------------------------- table view
export function tableView(spec) {
  const t = h("table", { class: "rv-table" });
  if (spec.caption) t.append(h("caption", { text: spec.caption }));
  const thead = h("thead"), tr = h("tr");
  for (const c of spec.columns) tr.append(h("th", { scope: "col", text: c.label }));
  thead.append(tr);
  const tb = h("tbody");
  for (const r of spec.rows) {
    const row = h("tr");
    spec.columns.forEach((c, i) => {
      const v = r[c.key];
      const out = c.format ? c.format(v, r) : v == null ? "–" : String(v);
      row.append(h(i === 0 ? "th" : "td", { scope: i === 0 ? "row" : null, class: c.num ? "num" : null, text: out }));
    });
    tb.append(row);
  }
  t.append(thead, tb);
  return t;
}

// ---------------------------------------------------------------- export
const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "opacity", "font-size", "font-weight", "text-anchor", "visibility"];
const FONT_STACK = "Prompt, 'Noto Sans Thai', Thonburi, Tahoma, sans-serif";
let fontCSS = null;

async function embeddedFonts() {
  if (!fontCSS) {
    fontCSS = (async () => {
      const faces = [];
      for (const [file, weight] of [["Prompt-Regular.ttf", 400], ["Prompt-Medium.ttf", 500]]) {
        const buf = await (await fetch(new URL(`../../fonts/${file}`, import.meta.url))).arrayBuffer();
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        faces.push(`@font-face{font-family:Prompt;font-weight:${weight};src:url(data:font/ttf;base64,${btoa(bin)}) format("truetype");}`);
      }
      return faces.join("");
    })().catch((e) => { fontCSS = null; throw e; });
  }
  return fontCSS;
}

// Replace classes and CSS variables with plain presentation attributes, so the
// downloaded file looks the same without the page's stylesheet. All computed
// styles are read before any element is changed.
function inline(root) {
  const els = [root, ...root.querySelectorAll("*")].filter((el) => el.tagName !== "defs" && !el.closest("defs"));
  const read = els.map((el) => { const cs = getComputedStyle(el); return STYLE_PROPS.map((p) => [p, cs.getPropertyValue(p)]); });
  els.forEach((el, i) => {
    for (const [p, v] of read[i]) if (v && v !== "normal" && v !== "auto") el.setAttribute(p, v);
    if (el.tagName === "text" || el.tagName === "tspan") el.setAttribute("font-family", FONT_STACK);
  });
  for (const el of els) {
    if (el.classList?.contains("rv-hit") || el.classList?.contains("rv-hair") || el.classList?.contains("rv-hairdots")) { el.remove(); continue; }
    el.removeAttribute("style");
    el.removeAttribute("class");
    el.removeAttribute("tabindex");
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
  }
}

// Render a figure off screen at a fixed width in the light theme, add its
// legend (above the plot, never on it) and the credit band (below), and return
// a standalone SVG string.
export async function composeSVG({ draw, legend, credit, width = 1000 }) {
  const host = h("div", { class: "rv rv--export", "aria-hidden": "true" });
  Object.assign(host.style, { position: "fixed", left: "-30000px", top: "0", width: `${width}px` });
  document.body.append(host);
  try {
    if (document.fonts?.load) await Promise.all([document.fonts.load("400 12px Prompt"), document.fonts.load("500 12px Prompt")]);
    const pad = 28, inner = width - pad * 2;
    const W = width;
    const out = s("svg", { xmlns: SVGNS, width: W, height: 10, viewBox: `0 0 ${W} 10` });
    host.append(out);
    const hatch = defs(out);
    const bg = paint(s("rect", { x: 0, y: 0, width: W, height: 10 }), { fill: "#ffffff" });
    out.append(bg);
    // legend
    const lg = s("g", { transform: `translate(${pad},${pad - 4})` });
    out.append(lg);
    const legH = legend && legend.length ? legendSVG(lg, legend, 0, 0, inner) + 8 : 0;
    // the figure itself, drawn by the same code as on screen
    const body = s("svg", { width: inner, height: 10, viewBox: `0 0 ${inner} 10`, x: pad, y: pad + legH, overflow: "visible" });
    body.dataset.hatch = hatch;
    out.append(body);
    const ch = draw(body, inner, { export: true });
    body.setAttribute("viewBox", `0 0 ${inner} ${ch}`);
    body.setAttribute("height", ch);
    // credit band
    const top = pad + legH + ch + 18;
    const band = s("g", { transform: `translate(0,${top})` });
    out.append(band);
    const bandBg = paint(s("rect", { x: 0, y: 0, width: W, height: 10 }), { fill: "#f2f4f7" });
    band.append(bandBg, paint(s("line", { x1: 0, x2: W, y1: 0, y2: 0 }), { stroke: "#d6dbe2", width: 1 }));
    const cg = s("g", { transform: `translate(${pad},0)` });
    band.append(cg);
    const lines = [{ t: credit.title, cls: "rv-cred1", size: 14, weight: 500 }];
    for (const t of [credit.project, credit.funder, credit.data]) if (t) lines.push({ t, cls: "rv-cred", size: 12, weight: 400 });
    let cy = 24;
    for (const ln of lines) for (const piece of wrap(ln.t, inner - 4, ln.size, ln.weight)) { text(cg, 0, cy, piece, ln.cls); cy += ln.size + 7; }
    const credH = cy + 6;
    const Htot = Math.ceil(top + credH);
    bandBg.setAttribute("height", credH);
    for (const el of [out, bg]) el.setAttribute("height", Htot);
    out.setAttribute("viewBox", `0 0 ${W} ${Htot}`);
    inline(out);
    const css = await embeddedFonts().catch(() => "");
    const st = document.createElementNS(SVGNS, "style");
    st.textContent = css;
    out.insertBefore(st, out.firstChild);
    for (const el of out.querySelectorAll("pattern *")) {
      el.removeAttribute("style");
      el.setAttribute(el.tagName === "line" ? "stroke" : "fill", el.tagName === "line" ? "#9aa3ad" : "#e9edf2");
      if (el.tagName === "line") el.setAttribute("stroke-width", "1.2");
    }
    return { svg: new XMLSerializer().serializeToString(out), width: W, height: Htot };
  } finally {
    host.remove();
  }
}

export async function svgToPNG(svgText, width, height, scale = 2) {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    await img.decode();
    await new Promise((r) => setTimeout(r, 60));
    const c = document.createElement("canvas");
    c.width = Math.round(width * scale); c.height = Math.round(height * scale);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
