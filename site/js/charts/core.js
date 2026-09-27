// Shared chart pieces: SVG frame, axes, legend, tooltip, evidence shapes,
// colour-by-meaning. Colours are CSS custom properties set through `style`, so
// the print stylesheet re-points them without touching any chart code.

import { h, s, clear } from "../util/dom.js";
import { tickFormat, num } from "../util/format.js";
import { tickStep } from "../util/scale.js";
import { t } from "../util/i18n.js";

// Colour follows the entity, never the series order.
export function color(kind, key) {
  switch (kind) {
    case "cadre": return `var(--c-${key})`;
    case "sector": return `var(--s-${key}, var(--n-neutral))`;
    case "flow": return `var(--f-${key})`;
    case "scenario": return { growth_only: "var(--n-neutral)", redistribution_only: "var(--n-1)",
      growth_plus_redistribution: "var(--n-2)", growth_additions_only: "var(--n-3)" }[key] || "var(--n-neutral)";
    case "neutral": return "var(--n-neutral)";
    case "series": return `var(--n-${key})`;
    default: return "var(--accent)";
  }
}

export function colorSpec(spec) {
  // "cadre:physicians" | "flow:entries" | "neutral"
  if (!spec) return "var(--accent)";
  if (spec === "neutral") return color("neutral");
  const [k, v] = spec.split(":");
  return color(k, v);
}

export function svgFrame(container, w, h_, label) {
  clear(container);
  const svg = s("svg", {
    class: "chart-svg", width: w, height: h_, viewBox: `0 0 ${w} ${h_}`, role: "img", "aria-label": label || "",
    preserveAspectRatio: "xMidYMid meet",
  });
  container.append(svg);
  return svg;
}

export function measure(el, minW = 280, minH = 220) {
  const r = el.getBoundingClientRect();
  return { w: Math.max(minW, Math.floor(r.width)), h: Math.max(minH, Math.floor(r.height)) };
}

export function axisLeft(g, y, { x0, x1, ticks = 5, format, label, grid = true, domain } = {}) {
  const [a, b] = domain || y.domain;
  const vals = y.ticks ? y.ticks(ticks) : [];
  const fmt = format || tickFormat(Math.abs(tickStep(a, b, ticks)));
  const ax = s("g", { class: "axis axis--y" });
  for (const v of vals) {
    const yy = y(v);
    if (grid) ax.append(s("line", { class: "grid", x1: x0, x2: x1, y1: yy, y2: yy }));
    ax.append(s("text", { class: "tick", x: x0 - 8, y: yy, "text-anchor": "end", "dominant-baseline": "middle",
      text: fmt(v) }));
  }
  if (label) ax.append(s("text", { class: "axis-label", x: x0, y: y.range[1] - 14, "text-anchor": "start", text: label }));
  g.append(ax);
  return ax;
}

export function axisBottom(g, x, values, fmt, { y0, labelEvery = 1 } = {}) {
  const ax = s("g", { class: "axis axis--x" });
  ax.append(s("line", { class: "baseline", x1: x.range[0], x2: x.range[1], y1: y0, y2: y0 }));
  values.forEach((v, i) => {
    if (i % labelEvery !== 0 && i !== values.length - 1) return;
    const xx = x(v);
    ax.append(s("line", { class: "tickmark", x1: xx, x2: xx, y1: y0, y2: y0 + 5 }));
    ax.append(s("text", { class: "tick", x: xx, y: y0 + 20, "text-anchor": "middle", text: fmt(v) }));
  });
  g.append(ax);
  return ax;
}

export function legend(items, { title } = {}) {
  const el = h("div", { class: "legend", role: "list", "aria-label": title || t("chart.legend") });
  if (title) el.append(h("span", { class: "legend__title", text: title }));
  for (const it of items) {
    let sw;
    if ((it.shape || "").startsWith("ev-")) {
      sw = s("svg", { class: "legend__ev", viewBox: "-9 -9 18 18", width: 16, height: 16, "aria-hidden": "true" },
        s("path", { d: evidencePath(it.shape.slice(3), 6) }));
    } else {
      sw = h("span", { class: `legend__swatch legend__swatch--${it.shape || "line"}` });
      if (it.dash) sw.classList.add("legend__swatch--dash");
    }
    sw.style.setProperty("--sw", it.color);
    el.append(h("span", { class: "legend__item", role: "listitem" }, sw, h("span", { text: it.label })));
  }
  return el;
}

// Evidence type is carried by shape as well as by the written label.
export function evidencePath(type, r = 6) {
  switch (type) {
    case "model": return `M0,${-r * 1.15} L${r * 1.1},${r * 0.8} L${-r * 1.1},${r * 0.8} Z`;
    case "scenario": return `M${-r},${-r} H${r} V${r} H${-r} Z`;
    case "derived": return `M0,${-r * 1.25} L${r * 1.1},0 L0,${r * 1.25} L${-r * 1.1},0 Z`;
    case "discussion": return `M${-r},${-r * 0.8} H${r} V${r * 0.5} H${-r * 0.2} L${-r * 0.7},${r * 1.1} V${r * 0.5} H${-r} Z`;
    default: return `M${r},0 A${r},${r} 0 1,1 ${-r},0 A${r},${r} 0 1,1 ${r},0 Z`;
  }
}

export function evidenceBadge(release, type) {
  const label = release.label("evidence", type);
  const svg = s("svg", { class: "badge__shape", viewBox: "-8 -8 16 16", width: 16, height: 16, "aria-hidden": "true" },
    s("path", { d: evidencePath(type, 6) }));
  return h("span", { class: `badge badge--${type}`, title: release.vocab.evidence[type]?.uncertainty || "" },
    svg, h("span", { text: label }));
}

// ---------------------------------------------------------------- tooltip
let tip;
export function tooltip() {
  if (!tip) tip = document.getElementById("tooltip");
  return tip;
}
export function showTip(anchor, html, evt) {
  const t = tooltip();
  if (!t) return;
  t.innerHTML = html;
  t.hidden = false;
  const r = anchor.getBoundingClientRect();
  const x = evt && evt.clientX != null && evt.type.startsWith("mouse") ? evt.clientX : r.left + r.width / 2;
  const y = evt && evt.clientY != null && evt.type.startsWith("mouse") ? evt.clientY : r.top;
  const tw = t.offsetWidth, th = t.offsetHeight;
  let left = x + 14, top = y - th - 12;
  if (left + tw > innerWidth - 8) left = x - tw - 14;
  if (top < 8) top = y + 18;
  t.style.left = Math.max(8, left) + "px";
  t.style.top = Math.max(8, top) + "px";
}
export function hideTip() {
  const t = tooltip();
  if (t) t.hidden = true;
}

// Hover, keyboard focus and touch all open the same tooltip.
export function bindTip(el, htmlFn) {
  el.addEventListener("mouseenter", (e) => showTip(el, htmlFn(), e));
  el.addEventListener("mousemove", (e) => showTip(el, htmlFn(), e));
  el.addEventListener("mouseleave", hideTip);
  el.addEventListener("focus", (e) => showTip(el, htmlFn(), e));
  el.addEventListener("blur", hideTip);
  el.addEventListener("touchstart", (e) => { showTip(el, htmlFn(), e); }, { passive: true });
}

export function tipHTML(title, rows) {
  const esc = (x) => String(x ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return `<strong>${esc(title)}</strong>` + (rows || []).map(([k, v]) =>
    `<div class="tip-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");
}

export function valueFmt(v) { return num(v); }

// Width of the widest string when drawn with a given class inside `svg`.
export function textWidth(svg, strings, cls = "cat-label") {
  const t = s("text", { class: cls, x: -9999, y: -9999 });
  svg.append(t);
  let w = 0;
  for (const str of strings) { t.textContent = String(str); w = Math.max(w, t.getComputedTextLength()); }
  t.remove();
  return w;
}

export function wrapText(textEl, str, maxWidth, lineHeight = 1.25) {
  // Thai word boundaries keep combining vowels and tone marks with their word.
  textEl.textContent = "";
  const words = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("th", { granularity: "word" }).segment(String(str))].map((x) => x.segment)
    : String(str).split(/(\s+)/).filter((w) => w.length);
  let line = s("tspan", { x: textEl.getAttribute("x"), dy: 0 });
  textEl.append(line);
  let cur = "";
  for (const w of words) {
    const test = cur + w;
    line.textContent = test;
    if (line.getComputedTextLength() > maxWidth && cur.trim()) {
      line.textContent = cur.trimEnd();
      line = s("tspan", { x: textEl.getAttribute("x"), dy: `${lineHeight}em` });
      textEl.append(line);
      cur = w.trimStart();
      line.textContent = cur;
    } else cur = test;
  }
  return textEl;
}
