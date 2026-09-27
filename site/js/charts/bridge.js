// Stock-flow bridge: recorded net entries -> reconciliation residual -> stock
// change. Each bar carries its base and years above it, because the two bases
// differ in scope and timing; the residual is a diagnostic, never "lost staff".

import { h, s, clear, tween, duration } from "../util/dom.js";
import { num, be } from "../util/format.js";
import { linear, extent, nice } from "../util/scale.js";
import { bindTip, tipHTML, hideTip, wrapText } from "./core.js";
import { t } from "../util/i18n.js";

export class Bridge {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; this.prev = new Map(); }

  update(spec, ctx) {
    const R = ctx.release;
    const row = R.select(spec.dataset, spec.filter)[0];
    clear(this.el); hideTip();
    if (!row) { this.el.append(h("p", { class: "empty", text: t("bridge.empty") })); return; }
    const meta = R.ds(spec.dataset).meta;
    const reveal = new Set(spec.reveal || ["net", "residual", "stock"]);
    const flowMeta = R.ds("flows_national").meta;
    const [f0, f1] = flowMeta.years;
    const [s0, s1] = meta.years;
    const bars = [
      { key: "net", label: t("bridge.net"), sub: t("bridge.net_sub", { a: be(f0), b: be(f1) }), from: 0, to: row.net_flow, cls: "br-net" },
      { key: "residual", label: t("bridge.residual"), sub: t("bridge.residual_sub"), from: row.net_flow, to: row.net_flow + row.residual, cls: "br-res" },
      { key: "stock", label: t("bridge.stock"), sub: t("bridge.stock_sub", { a: be(s0), b: be(s1) }), from: 0, to: row.dW, cls: "br-stock" },
    ];
    const box = h("div", { class: "bridge" });
    this.el.append(box);
    const note = row.cadre === "professional_nurses"
      ? h("p", { class: "chart-note", text: t("bridge.nurse_note") }) : null;
    if (note) box.append(note);
    const r0 = box.getBoundingClientRect();
    // Keep one drawing unit equal to one CSS pixel. A capped viewBox stretched
    // to 100% width also enlarged the headers and pushed them outside the stage.
    const noteH = note ? note.getBoundingClientRect().height + 12 : 0;
    const W = Math.min(Math.max(300, r0.width), 1160);
    const H = Math.min(Math.max(260, r0.height - noteH), 720);
    const m = { l: 76, r: 22, t: 104, b: 40 };
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: `width:${W}px;height:${H}px`, role: "img",
      "aria-label": t("bridge.aria", { cadre: R.label("cadre", row.cadre), net: num(row.net_flow, 0), res: num(row.residual, 0), d: num(row.dW, 0) }) });
    box.prepend(svg);
    // Measure wrapped Thai headings before choosing the plotting area. Both
    // headings and definitions stay visible at every disclosure step.
    const colW = (W - m.l - m.r) / 3 - 36;
    const groups = bars.map((b, i) => {
      const cx = m.l + ((i + 0.5) * (W - m.l - m.r)) / 3;
      const g = s("g", { class: "br " + b.cls + (reveal.has(b.key) ? "" : " is-hidden"), tabindex: -1 });
      svg.append(g);
      const tl = s("text", { class: "br-label", x: cx, y: 28, "text-anchor": "middle" });
      g.append(tl);
      wrapText(tl, b.label, colW + 16, 1.3);
      const headBox = tl.getBBox();
      const ts = s("text", { class: "br-sub", x: cx, y: headBox.y + headBox.height + 24, "text-anchor": "middle" });
      g.append(ts);
      wrapText(ts, b.sub, colW, 1.35);
      const subBox = ts.getBBox();
      m.t = Math.max(m.t, Math.ceil(subBox.y + subBox.height + 38));
      return g;
    });
    const y = linear(nice(extent([0, row.net_flow, row.dW, row.net_flow + row.residual]), 5), [H - m.b, m.t]);
    for (const tk of y.ticks(5)) {
      svg.append(s("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(tk), y2: y(tk) }));
      svg.append(s("text", { class: "tick", x: m.l - 8, y: y(tk), "text-anchor": "end", "dominant-baseline": "middle", text: num(tk, 0) }));
    }
    svg.append(s("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));
    const bw = Math.min(150, (W - m.l - m.r) / 5);
    const dur = duration();
    bars.forEach((b, i) => {
      const cx = m.l + ((i + 0.5) * (W - m.l - m.r)) / 3;
      const top = y(Math.max(b.from, b.to)), bot = y(Math.min(b.from, b.to));
      const shown = reveal.has(b.key);
      const g = groups[i];
      svg.append(g); // values and bars above the grid; preserve column headers
      if (!shown) return;
      const prev = this.prev.get(b.key) || { y: y(b.from), height: 0 };
      const rect = s("rect", { class: "br-bar", x: cx - bw / 2, width: bw, y: prev.y, height: prev.height, rx: 3 });
      g.append(rect);
      tween(rect, { y: top, height: Math.max(1, bot - top) }, dur);
      this.prev.set(b.key, { y: top, height: Math.max(1, bot - top) });
      const val = b.key === "residual" ? row.residual : b.to - b.from;
      g.append(s("text", { class: "br-value", x: cx, y: b.key === "residual" ? (top + bot) / 2 : top - 12, "text-anchor": "middle",
        "dominant-baseline": b.key === "residual" ? "middle" : "auto",
        text: (val > 0 && b.key === "residual" ? "+" : "") + num(val, 0).replace("-", "−") }));
      if (b.key === "residual") g.append(s("line", { class: "br-connector", x1: cx - bw * 1.5, x2: cx + bw / 2, y1: y(b.from), y2: y(b.from) }));
      g.append(s("rect", { class: "hit", x: cx - bw, y: m.t, width: bw * 2, height: H - m.t - m.b }));
      bindTip(g, () => tipHTML(b.label, [[t("chart.value"), num(val, 0)], [t("bridge.base"), b.sub],
        ...(b.key === "residual" ? [[t("bridge.pct_of_stock"), num(row.residual_pct_of_dW, 1) + "%"],
          [t("bridge.big_residual"), t("bridge.of", { a: num(row.residual_exceeds_10pct_stock, 0), b: num(row.province_years, 0) })]] : [])]));
    });
  }
  destroy() { hideTip(); clear(this.el); }
}
