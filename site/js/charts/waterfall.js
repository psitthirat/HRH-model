// Waterfall: one year of a plan as an account (opening - departures + re-entries +
// new appointments = closing). Bars float from the running total; the start and end
// bars stand on zero. Values come from the dataset; nothing is computed here but
// the running sum that the account itself defines.

import { h, s, clear } from "../util/dom.js";
import { num } from "../util/format.js";
import { linear, nice } from "../util/scale.js";
import { bindTip, tipHTML, hideTip, textWidth } from "./core.js";
import { t } from "../util/i18n.js";

const FILL = { start: "var(--n-neutral)", end: "var(--accent)", minus: "var(--f-exits)", plus: "var(--f-entries)" };

export class Waterfall {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; }

  update(spec, ctx) {
    const R = ctx.release;
    const vcol = spec.value || "value", lcol = spec.label || "item_label", kcol = spec.kind || "kind";
    const rows = R.select(spec.dataset, spec.filter).sort((a, b) => a.order - b.order);
    clear(this.el); hideTip();
    const wrap = h("div", { class: "waterfall" });
    this.el.append(wrap);
    if (spec.banner) wrap.append(h("p", { class: "chart-banner", text: spec.banner }));
    if (!rows.length) { wrap.append(h("p", { class: "empty", text: t("chart.no_data") })); return; }
    wrap.append(h("p", { class: "waterfall__title", text: t("wf.title", { name: rows[0].example_label ?? "" }) }));
    const box = h("div", { class: "waterfall__plot" });
    wrap.append(box);
    const r0 = box.getBoundingClientRect();
    const W = Math.max(320, r0.width), H = Math.max(260, r0.height);
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": rows.map((r) => `${r[lcol]} ${num(r[vcol], 0)}`).join(", ") });
    box.append(svg);
    // running account
    let run = 0;
    const bars = rows.map((r) => {
      const v = r[vcol];
      let a, b;
      if (r[kcol] === "start" || r[kcol] === "end") { a = 0; b = v; run = v; }
      else { a = run; b = run + v; run = b; }
      return { r, a, b, v, kind: r[kcol] };
    });
    const lo = Math.min(0, ...bars.map((x) => Math.min(x.a, x.b)));
    const hi = Math.max(...bars.map((x) => Math.max(x.a, x.b)));
    // flows are small next to the stock: a broken axis would hide that, so show the true scale
    const m = { l: 70, r: 16, t: 34, b: 58 };
    const y = linear(nice([lo, hi], 5), [H - m.b, m.t]);
    for (const tk of y.ticks(5)) {
      svg.append(s("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(tk), y2: y(tk) }));
      svg.append(s("text", { class: "tick", x: m.l - 8, y: y(tk), "text-anchor": "end", "dominant-baseline": "middle", text: num(tk, 0) }));
    }
    const bw = (W - m.l - m.r) / bars.length;
    bars.forEach((x, i) => {
      const x0 = m.l + i * bw + bw * 0.18, w = bw * 0.64;
      const top = y(Math.max(x.a, x.b)), bot = y(Math.min(x.a, x.b));
      const g = s("g", { class: `wf-bar wf-${x.kind}`, tabindex: 0 });
      g.append(s("rect", { x: x0, y: top, width: w, height: Math.max(2, bot - top), rx: 3, style: `fill:${FILL[x.kind]}` }));
      const sign = x.kind === "minus" ? "−" : x.kind === "plus" ? "+" : "";
      const digits = Math.abs(x.v) >= 100 ? 0 : 1;
      g.append(s("text", { class: "wf-value", x: x0 + w / 2, y: top - 8, "text-anchor": "middle", text: sign + num(Math.abs(x.v), digits) }));
      g.append(s("text", { class: "cat-label", x: x0 + w / 2, y: H - m.b + 22, "text-anchor": "middle", text: x.r[lcol] }));
      if (i < bars.length - 1) {
        const nx = m.l + (i + 1) * bw + bw * 0.18;
        svg.append(s("line", { class: "wf-link", x1: x0 + w, x2: nx, y1: y(x.b), y2: y(x.b) }));
      }
      bindTip(g, () => tipHTML(x.r[lcol], [[t("wf.value"), sign + num(Math.abs(x.v), 1)], [t("wf.running"), num(x.b, 1)]]));
      svg.append(g);
    });
    wrap.append(h("p", { class: "chart-note", text: t("wf.note") }));
  }
  destroy() { hideTip(); clear(this.el); }
}
