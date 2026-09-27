// Baseline-quartile groups (membership fixed in the base year). Three readings of
// the same rows: density start -> end, % increase, absolute increase per 100,000.
// The same four rows stay in place; only what is measured along them changes.

import { h, s, clear, tween, duration } from "../util/dom.js";
import { num, signed, be } from "../util/format.js";
import { linear, extent, nice } from "../util/scale.js";
import { legend, bindTip, tipHTML, hideTip, wrapText } from "./core.js";
import { t } from "../util/i18n.js";

export class Dumbbell {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; this.prev = new Map(); }

  update(spec, ctx) {
    this.ctx = ctx;
    const R = ctx.release;
    const rows = R.select(spec.dataset, spec.filter).slice().sort((a, b) => a.quartile.localeCompare(b.quartile));
    const metric = spec.metric || "density";
    const density = metric === "density" || metric === "density_gain";
    const combined = metric === "density_gain";
    const meta = R.ds(spec.dataset).meta;
    clear(this.el); hideTip();
    const wrap = h("div", { class: "dumbbell" });
    this.el.append(wrap);
    if (density) wrap.append(legend([
      { label: `${t("dumbbell.start")} ${be(meta.years[0])}`, color: "var(--text-muted)", shape: "ring" }, { label: `${t("dumbbell.end")} ${be(meta.years[1])}`, color: "var(--c-physicians)", shape: "dot" }]));
    if (metric === "pct") wrap.append(h("p", { class: "chart-note dumbbell__formula", text: t("dumbbell.pct_formula") }));
    const box = h("div", { class: "dumbbell__plot" });
    wrap.append(box);
    const r0 = box.getBoundingClientRect();
    const W = Math.max(300, r0.width), H = Math.max(220, r0.height);
    const qLabel = (r) => R.vocab.quartiles?.[r.quartile] ?? r.quartile_th;
    const lw = Math.max(...rows.map((r) => qLabel(r).length)) * 9 + 30;
    const m = { l: Math.min(W * 0.35, Math.max(150, lw)), r: combined ? 180 : 150, t: combined ? 64 : 20, b: 50 };
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": spec.value_label });
    box.append(svg);
    const vals = density ? rows.flatMap((r) => [r[spec.start], r[spec.end]]) : rows.map((r) => r[spec.value]);
    const x = linear(nice(extent([0, ...vals]), 5), [m.l, W - m.r]);
    // cap the row height and centre the rows, so four rows do not stretch over a tall stage
    const rowH = Math.min(84, (H - m.t - m.b) / rows.length);
    m.t = Math.max(m.t, (H - m.b - rowH * rows.length) / 2);
    for (const tk of x.ticks(5)) {
      svg.append(s("line", { class: "grid", x1: x(tk), x2: x(tk), y1: m.t, y2: m.t + rowH * rows.length }));
      svg.append(s("text", { class: "tick", x: x(tk), y: m.t + rowH * rows.length + 18, "text-anchor": "middle", text: num(tk, 0) }));
    }
    svg.append(s("text", { class: "axis-label", x: m.l, y: m.t + rowH * rows.length + 40, text: spec.value_label }));
    if (combined) {
      const head = s("text", { class: "axis-label", x: W - 80, y: m.t - 40, "text-anchor": "middle" });
      svg.append(head);
      wrapText(head, t("dumbbell.gain_heading"), 152, 1.2);
    }
    const dur = duration();
    rows.forEach((r, i) => {
      const y = m.t + i * rowH + rowH / 2;
      const g = s("g", { class: "db-group", tabindex: -1 });
      svg.append(g);
      g.append(s("text", { class: "cat-label", x: m.l - 14, y, "text-anchor": "end", "dominant-baseline": "middle", text: qLabel(r) }));
      g.append(s("text", { class: "cat-sub", x: m.l - 14, y: y + 18, "text-anchor": "end", "dominant-baseline": "middle", text: t("dumbbell.provinces", { n: r.provinces }) }));
      const key = r.quartile;
      const prev = this.prev.get(key) || { a: x(0), b: x(0) };
      let a, b, label;
      if (density) { a = x(r[spec.start]); b = x(r[spec.end]); label = `${num(r[spec.start], 1)} → ${num(r[spec.end], 1)}`; }
      else { a = x(0); b = x(r[spec.value]); label = metric === "pct" ? `${signed(r[spec.value], 1)}%` : t("dumbbell.abs_label", { v: num(r[spec.value], 1) }); }
      const line = s("line", { class: density ? "db-line" : "db-bar", x1: prev.a, x2: prev.b, y1: y, y2: y });
      g.append(line);
      tween(line, { x1: a, x2: b }, dur);
      if (density) {
        const ca = s("circle", { class: "db-a", cx: prev.a, cy: y, r: 7 });
        const cb = s("circle", { class: "db-b", cx: prev.b, cy: y, r: 8 });
        g.append(ca, cb);
        tween(ca, { cx: a }, dur); tween(cb, { cx: b }, dur);
      }
      if (combined) {
        g.append(s("text", { class: "db-start-value", x: a, y: y - 17, "text-anchor": "middle", text: num(r[spec.start], 1) }));
        g.append(s("text", { class: "db-end-value", x: b, y: y + 29, "text-anchor": "middle", text: num(r[spec.end], 1) }));
        g.append(s("text", { class: "db-gain-value", x: W - 80, y, "text-anchor": "middle", "dominant-baseline": "middle", text: signed(r.abs_increase_per100k, 1) }));
      } else g.append(s("text", { class: "dot-label", x: Math.max(a, b) + 14, y, "dominant-baseline": "middle", text: label }));
      this.prev.set(key, { a, b });
      g.append(s("rect", { class: "hit", x: 0, y: y - rowH / 2, width: W, height: rowH }));
      const members = r.province_codes || meta.group_membership?.find((group) => group.cadre === r.cadre && group.scope === r.scope && group.quartile === r.quartile)?.province_codes || [];
      bindTip(g, () => `<div class="dumbbell-tip${members.length ? " dumbbell-tip--members" : ""}">` + tipHTML(`${qLabel(r)} (${t("dumbbell.provinces", { n: r.provinces })}) · ${R.label("scope", r.scope)}`, [
        [t("dumbbell.density"), `${num(r.density_start, 1)} → ${num(r.density_end, 1)}`],
        [t("dumbbell.pct"), num(r.pct_increase_density, 1) + "%"], [t("dumbbell.abs"), num(r.abs_increase_per100k, 1)],
        [t("dumbbell.share_staff"), num(r.share_of_net_staff_increase_pct, 1) + "%"],
        [t("dumbbell.share_pop"), num(r.pop_share_end_pct, 1) + "%"],
        ...(members.length ? [[t("dumbbell.members"), members.map((code) => R.provinceName(code)).join(", ")]] : [])]) + "</div>");
    });
  }
  destroy() { hideTip(); clear(this.el); }
}
