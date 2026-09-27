// Half-life of the gap between provinces (S15): if low-start provinces keep
// catching up at the pace observed, how many years until the proportional gap
// is halved. One row per cadre (and per window when two are shown); the dot is
// the central estimate, the bar the range implied by the 95% interval of beta.
// A beta interval that reaches zero has no upper bound: the bar ends in an arrow.
// Values beyond the axis are drawn at the edge with the number written out.

import { h, s, clear, tween, duration } from "../util/dom.js";
import { num, be } from "../util/format.js";
import { linear } from "../util/scale.js";
import { legend, bindTip, tipHTML, hideTip, textWidth, wrapText } from "./core.js";
import { t } from "../util/i18n.js";

export class HalfLife {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; this.prev = new Map(); }

  update(spec, ctx) {
    const R = ctx.release;
    const all = R.select(spec.dataset, spec.filter);
    const cadres = spec.cadres || ["physicians"];
    const windows = spec.windows || ["full"];
    const maxY = spec.max_years || 100;
    const items = [];
    for (const c of cadres) for (const w of windows) {
      const r = all.find((q) => q.cadre === c && q.window === w);
      if (r) items.push({ c, w, r });
    }
    clear(this.el); hideTip();
    const wrap = h("div", { class: "halflife" });
    this.el.append(wrap);
    wrap.append(legend([{ label: t("hl.beta"), color: "var(--text-secondary)", shape: "dot" },
      { label: t("chart.ci95"), color: "var(--text-secondary)", shape: "line" },
      ...(windows.length > 1 ? [{ label: t("hl.recent"), color: "var(--text-secondary)", shape: "line", dash: true }] : [])]));
    const box = h("div", { class: "halflife__plot" });
    wrap.append(box);
    const r0 = box.getBoundingClientRect();
    const W = Math.max(320, r0.width), Hs = Math.max(240, r0.height);
    const svg = s("svg", { class: "chart-svg", width: W, height: Hs, viewBox: `0 0 ${W} ${Hs}`, role: "img", "aria-label": t("hl.aria") });
    box.append(svg);
    const rowLabel = (it) => R.label("cadre", it.c) + (windows.length > 1 ? ` · ${it.w === "recent" ? t("hl.recent") : t("hl.full")} ${be(it.r.start)}–${be(it.r.end)}` : "");
    const lw = Math.min(W * 0.4, textWidth(svg, items.map(rowLabel)) + 24);
    const m = { l: lw, r: Math.min(230, W * 0.3), t: 12, b: 50 };
    // readable rows: capped height, block centred in the stage
    const gap = windows.length > 1 ? 14 : 0;
    const groups = cadres.length;
    const rowH = Math.min(windows.length > 1 ? 64 : 80, (Hs - m.t - m.b - gap * (groups - 1)) / Math.max(1, items.length));
    const blockH = rowH * items.length + gap * (groups - 1);
    const top = Math.max(m.t, (Hs - m.b - blockH) / 2);
    const x = linear([0, maxY], [m.l, W - m.r]);
    for (const tk of x.ticks(5)) {
      svg.append(s("line", { class: "grid", x1: x(tk), x2: x(tk), y1: top - 6, y2: top + blockH + 6 }));
      svg.append(s("text", { class: "tick", x: x(tk), y: top + blockH + 24, "text-anchor": "middle", text: num(tk, 0) }));
    }
    svg.append(s("text", { class: "axis-label", x: m.l, y: top + blockH + 46, text: t("hl.axis") }));
    const clip = (v) => Math.min(v, maxY);
    const dur = duration();
    items.forEach((it, i) => {
      const gi = cadres.indexOf(it.c);
      const y = top + i * rowH + rowH / 2 + gi * gap;
      const { r } = it;
      const col = `var(--c-${it.c})`;
      const g = s("g", { class: "hl-row" + (it.w === "recent" ? " is-recent" : ""), tabindex: -1 });
      g.style.setProperty("--dot", col);
      svg.append(g);
      const name = s("text", { class: "cat-label", x: m.l - 12, y, "text-anchor": "end", "dominant-baseline": "middle" });
      g.append(name);
      wrapText(name, rowLabel(it), m.l - 24, 1.25);
      name.setAttribute("y", y - (name.childElementCount - 1) * parseFloat(getComputedStyle(name).fontSize) * .625);
      const hl = r.half_life, lo = r.half_life_fast, hi = r.half_life_slow;
      if (hl == null || !(hl > 0)) {
        g.append(s("text", { class: "dot-label", x: m.l + 6, y, "dominant-baseline": "middle", text: t("hl.none") }));
        return;
      }
      const open = hi == null;
      const x1 = x(lo != null ? clip(lo) : 0), x2 = open || hi > maxY ? x(maxY) : x(hi);
      g.append(s("line", { class: "ci" + (it.w === "recent" ? " dashed" : ""), x1, x2, y1: y, y2: y }));
      if (open || hi > maxY) g.append(s("path", { class: "hl-arrow", d: `M${x(maxY) - 2},${y - 6} L${x(maxY) + 8},${y} L${x(maxY) - 2},${y + 6} Z` }));
      const key = `${it.c}|${it.w}`;
      const px = x(clip(hl));
      const dot = s("circle", { class: "dot" + (hl > maxY ? " hollow" : ""), cx: this.prev.get(key) ?? x(0), cy: y, r: 7 });
      g.append(dot);
      tween(dot, { cx: px }, dur);
      this.prev.set(key, px);
      const hiText = open ? t("hl.open") : num(hi, 0);
      const label = open ? `${t("hl.years", { n: num(hl, 0) })} · ${t("hl.open")}` : `${t("hl.years", { n: num(hl, 0) })} (${num(lo, 0)}–${hiText})`;
      const value = s("text", { class: "dot-label", x: x(maxY) + 14, y, "dominant-baseline": "middle" });
      g.append(value);
      wrapText(value, label, m.r - 24, 1.25);
      value.setAttribute("y", y - (value.childElementCount - 1) * parseFloat(getComputedStyle(value).fontSize) * .625);
      g.append(s("rect", { class: "hit", x: 0, y: y - rowH / 2, width: W, height: rowH }));
      bindTip(g, () => tipHTML(rowLabel(it), [
        [t("hl.beta"), t("hl.years", { n: num(hl, 1) })],
        [t("chart.ci95"), `${num(lo, 1)} – ${hiText}`],
        [t("hl.sigma"), r.half_life_sigma != null ? t("hl.years", { n: num(r.half_life_sigma, 1) }) : t("hl.none")],
        ["β", `${num(r.beta, 4)} (${t("chart.ci_range", { lo: num(r.lo95, 4), hi: num(r.hi95, 4) })})`]]));
    });
  }

  destroy() { hideTip(); clear(this.el); }
}
