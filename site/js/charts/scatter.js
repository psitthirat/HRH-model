// Province scatter (Explore): entries vs exits per 100 prior-year staff.
// A dense scatter uses generous hit areas; the diagonal marks exits = entries.

import { h, s, clear } from "../util/dom.js";
import { num } from "../util/format.js";
import { linear, extent, nice } from "../util/scale.js";
import { bindTip, tipHTML, hideTip, legend } from "./core.js";
import { t } from "../util/i18n.js";

export class Scatter {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; }

  update(spec, ctx) {
    const R = ctx.release;
    const rows = R.select(spec.dataset, spec.filter).filter((r) => r[spec.x] != null && r[spec.y] != null);
    clear(this.el); hideTip();
    const wrap = h("div", { class: "scatter" });
    this.el.append(wrap);
    const hl = R.highlightCodes(spec).length ? R.highlightCodes(spec) : R.caseStudies;
    wrap.append(legend([{ label: t("scatter.provinces"), color: "var(--c-physicians)", shape: "dot" },
      { label: t("chart.case_studies"), color: "var(--accent-soft)", shape: "ring" },
      { label: t("scatter.priority"), color: "var(--text-primary)", shape: "ring" }]));
    const box = h("div", { class: "scatter__plot" });
    wrap.append(box);
    const r0 = box.getBoundingClientRect();
    const W = Math.max(300, r0.width), H = Math.max(260, r0.height);
    const m = { l: 60, r: 20, t: 16, b: 50 };
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": t("scatter.aria", { x: spec.x_label, y: spec.y_label }) });
    box.append(svg);
    const all = [...rows.map((r) => r[spec.x]), ...rows.map((r) => r[spec.y]), 0];
    const dom = nice(extent(all), 5);
    const x = linear(dom, [m.l, W - m.r]), y = linear(dom, [H - m.b, m.t]);
    for (const tk of x.ticks(5)) {
      svg.append(s("line", { class: "grid", x1: x(tk), x2: x(tk), y1: m.t, y2: H - m.b }));
      svg.append(s("text", { class: "tick", x: x(tk), y: H - m.b + 18, "text-anchor": "middle", text: num(tk, 0) }));
      svg.append(s("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(tk), y2: y(tk) }));
      svg.append(s("text", { class: "tick", x: m.l - 8, y: y(tk), "text-anchor": "end", "dominant-baseline": "middle", text: num(tk, 0) }));
    }
    if (spec.diagonal) {
      svg.append(s("line", { class: "ref-line", x1: x(dom[0]), y1: y(dom[0]), x2: x(dom[1]), y2: y(dom[1]) }));
      svg.append(s("text", { class: "ref-label", x: x(dom[1]) - 6, y: y(dom[1]) + 16, "text-anchor": "end", text: t("scatter.diagonal") }));
    }
    svg.append(s("text", { class: "axis-label", x: m.l, y: H - 8, text: spec.x_label }));
    svg.append(s("text", { class: "axis-label", x: m.l + 4, y: m.t + 12, text: spec.y_label }));
    const cs = new Set(hl);
    const sel = new Set(ctx.selected || []);
    for (const r of rows) {
      const g = s("g", { class: "pt" + (cs.has(r.prov_code) ? " is-case" : "") + (r.priority_43 ? " is-priority" : "") + (sel.has(r.prov_code) ? " is-selected" : ""), tabindex: 0,
        "aria-label": `${R.provinceName(r.prov_code)}: ${num(r[spec.x], 1)} / ${num(r[spec.y], 1)}` });
      g.append(s("circle", { class: "hit-c", cx: x(r[spec.x]), cy: y(r[spec.y]), r: 12 }));
      g.append(s("circle", { class: "pt-dot", cx: x(r[spec.x]), cy: y(r[spec.y]), r: 5 }));
      if (cs.has(r.prov_code) || sel.has(r.prov_code)) {
        const label = s("text", { class: "map-label", x: x(r[spec.x]) + 9, y: y(r[spec.y]) - 8, text: R.provinceName(r.prov_code) });
        g.append(label);
        // Measure only once the group is in the document.
        svg.append(g);
        const bb = label.getBBox();
        if (bb.x + bb.width > W - 4) {
          label.setAttribute("x", x(r[spec.x]) - 9);
          label.setAttribute("text-anchor", "end");
        }
        if (bb.y < 0) label.setAttribute("y", y(r[spec.y]) + bb.height + 6);
      }
      bindTip(g, () => tipHTML(R.provinceName(r.prov_code), [[spec.x_label, num(r[spec.x], 2)], [spec.y_label, num(r[spec.y], 2)],
        [t("scatter.resign"), num(r.resignations_per100, 2)], [t("scatter.cagr"), num(r.cagr_stock_pct, 2) + "%"],
        [t("scatter.bq"), r.baseline_quartile ?? "—"]]));
      g.addEventListener("click", () => ctx.onSelect?.(r.prov_code));
      svg.append(g);
    }
  }
  destroy() { hideTip(); clear(this.el); }
}
