// 100% stacked area of the three age groups (ordinal: one hue, light -> dark),
// with the optional "three frames" panel that separates what is measured
// (structure, services) from what must be decided (services to cover).

import { h, s, clear } from "../util/dom.js";
import { num, be } from "../util/format.js";
import { linear } from "../util/scale.js";
import { legend, showTip, hideTip, tipHTML, evidenceBadge } from "./core.js";
import { t } from "../util/i18n.js";

const RAMP = ["var(--seq-2)", "var(--seq-4)", "var(--seq-6)"];

export class Stack {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; }

  update(spec, ctx) {
    const R = ctx.release;
    const rows = R.select(spec.dataset, spec.filter);
    const order = spec.order;
    const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
    const by = new Map(rows.map((r) => [`${r.year}|${r[spec.series]}`, r]));
    clear(this.el); hideTip();
    const wrap = h("div", { class: "stack" + (spec.frames ? " with-frames" : "") });
    this.el.append(wrap);
    const gl = (k) => (k === "60+" ? t("stack.60") : t("stack.group", { g: k }));
    wrap.append(legend(order.map((k, i) => ({ label: gl(k), color: RAMP[i], shape: "square" })), { title: t("stack.groups") }));
    const box = h("div", { class: "stack__plot" });
    wrap.append(box);
    const r0 = box.getBoundingClientRect();
    const W = Math.max(300, r0.width), H = Math.max(200, r0.height);
    const m = { l: 56, r: 90, t: 12, b: 34 };
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": t("stack.aria") });
    box.append(svg);
    const x = linear([years[0], years[years.length - 1]], [m.l, W - m.r]);
    const y = linear([0, 100], [H - m.b, m.t]);
    for (const tk of [0, 25, 50, 75, 100]) {
      svg.append(s("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(tk), y2: y(tk) }));
      svg.append(s("text", { class: "tick", x: m.l - 8, y: y(tk), "text-anchor": "end", "dominant-baseline": "middle", text: `${tk}%` }));
    }
    const cum = new Map(years.map((yy) => [yy, 0]));
    order.forEach((k, i) => {
      const lower = years.map((yy) => cum.get(yy));
      const upper = years.map((yy) => { const v = by.get(`${yy}|${k}`)?.[spec.value] ?? 0; cum.set(yy, cum.get(yy) + v); return cum.get(yy); });
      const d = years.map((yy, j) => `${j ? "L" : "M"}${x(yy)},${y(upper[j])}`).join("") +
        years.slice().reverse().map((yy, j) => `L${x(yy)},${y(lower[years.length - 1 - j])}`).join("") + "Z";
      svg.append(s("path", { class: "stack-area", d, style: `fill:${RAMP[i]}` }));
      const last = years[years.length - 1];
      const mid = (upper[years.length - 1] + lower[years.length - 1]) / 2;
      svg.append(s("text", { class: "end-label", x: W - m.r + 8, y: y(mid), "dominant-baseline": "middle",
        text: `${num(by.get(`${last}|${k}`)?.[spec.value], 1)}%` }));
      const first = years[0];
      const midF = (upper[0] + lower[0]) / 2;
      svg.append(s("text", { class: "in-label", x: m.l + 8, y: y(midF), "dominant-baseline": "middle", text: `${num(by.get(`${first}|${k}`)?.[spec.value], 1)}%` }));
    });
    const every = Math.ceil(years.length / 7);
    years.forEach((yy, j) => { if (j % every === 0 || j === years.length - 1) svg.append(s("text", { class: "tick", x: x(yy), y: H - m.b + 18, "text-anchor": "middle", text: be(yy) })); });
    const hit = s("rect", { class: "hit", x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b });
    svg.append(hit);
    hit.addEventListener("mousemove", (e) => {
      const bb = hit.getBoundingClientRect();
      const yv = x.invert(((e.clientX - bb.left) / bb.width) * (W - m.l - m.r) + m.l);
      const near = years.reduce((a, b) => (Math.abs(b - yv) < Math.abs(a - yv) ? b : a));
      showTip(hit, tipHTML(t("chart.year_be", { y: be(near) }), order.map((k) => [gl(k),
        t("stack.persons", { pct: num(by.get(`${near}|${k}`)?.[spec.value], 2), n: num(by.get(`${near}|${k}`)?.persons, 0) })])), e);
    });
    hit.addEventListener("mouseleave", hideTip);
    if (spec.frames) {
      const fr = h("div", { class: "frames" });
      for (const f of spec.frames) fr.append(h("div", { class: `frame frame--${f.evidence}` }, evidenceBadge(R, f.evidence), h("h4", { text: f.title }), h("p", { text: f.text })));
      wrap.append(fr);
    }
  }
  destroy() { hideTip(); clear(this.el); }
}
