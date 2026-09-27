// Bars: single-series (coloured by entity) or grouped series columns, optional
// facets. Bars grow from one baseline that includes zero, so negatives read
// correctly; values sit at the bar tip and only where they fit.

import { h, s, clear, tween, duration } from "../util/dom.js";
import { num, be, yearLabel } from "../util/format.js";
import { linear, band, extent, nice } from "../util/scale.js";
import { color, colorSpec, legend, bindTip, tipHTML, hideTip, textWidth } from "./core.js";
import { tickFormat } from "../util/format.js";
import { tickStep } from "../util/scale.js";
import { t as tr } from "../util/i18n.js";

const GUTTER = 28;

function catLabel(R, col, v, spec) {
  if (col === "part") return R.label("workforce", v);
  if (col === "cadre") return R.label("cadre", v);
  if (col === "fiscal_year" || spec.category_basis === "fiscal_year") return be(v);
  if (col === "year") return be(v);
  return String(v);
}

export class Bars {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; this.prev = new Map(); }

  update(spec, ctx) {
    this.ctx = ctx;
    if (spec.layout === "sector_comparison") return this.sectorComparison(spec, ctx);
    const R = ctx.release;
    const rows = R.select(spec.dataset, spec.filter);
    const cat = spec.category;
    const facetCol = spec.facet || null;
    let facets = facetCol ? [...new Set(rows.map((r) => r[facetCol]))] : [null];
    if (facetCol === "cadre") facets.sort((a, b) => R.vocab.cadres[a].order - R.vocab.cadres[b].order);
    const series = spec.series_cols
      ? spec.series_cols.map((c) => ({ key: c.col, label: c.label, color: colorSpec(c.color) }))
      : [{ key: spec.value, label: spec.value_label, color: null }];
    const horiz = spec.orientation === "h";

    clear(this.el); hideTip();
    const wrap = h("div", { class: "bars" });
    this.el.append(wrap);
    if (series.length > 1) wrap.append(legend(series.map((x) => ({ label: x.label, color: x.color, shape: "square" }))));
    const freeScale = facetCol && !spec.y_shared;
    if (facetCol && spec.value_label) wrap.append(h("p", { class: "chart-unit", text: `${spec.value_label}${freeScale ? tr("chart.free_scale") : ""}` }));
    const box = h("div", { class: "bars__plot" });
    wrap.append(box);
    const rr = box.getBoundingClientRect();
    const W = Math.max(300, rr.width), H = Math.max(220, rr.height);
    const n = facets.length;
    const cols = horiz ? 1 : n <= 2 ? n : W > 700 ? 2 : 1;
    const rowsN = Math.ceil(n / cols);
    const gx = cols > 1 ? GUTTER : 0, gy = rowsN > 1 ? GUTTER : 0;
    const fw = (W - gx * (cols - 1)) / cols, fhAll = (H - gy * (rowsN - 1)) / rowsN;
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": spec.value_label || "" });
    box.append(svg);
    // one value domain for all facets unless facets have their own (declared in the unit line)
    const domFor = (rs) => nice(extent([...rs.flatMap((r) => series.map((sr) => r[sr.key])), 0]), 5);
    const allDom = domFor(rows);
    const allCats = [...new Set(rows.map((r) => r[cat]))].map((c) => catLabel(R, cat, c, spec));
    const labW = horiz ? Math.min(W * 0.4, textWidth(svg, allCats) + 18) : 0;
    const dur = duration();

    facets.forEach((fk, i) => {
      const data = rows.filter((r) => fk == null || r[facetCol] === fk);
      let cats = [...new Set(data.map((r) => r[cat]))];
      if (Array.isArray(spec.filter?.[cat])) cats = spec.filter[cat].filter((c) => cats.includes(c));
      if (cat === "fiscal_year" || cat === "year") cats.sort((a, b) => a - b);
      const dom = freeScale ? domFor(data) : allDom;
      const valueLabels = data.flatMap((r) => series.map((sr) => labelFor(r, r[sr.key], spec) || ""));
      const ratioW = spec.ratio_labels ? textWidth(svg, data.map((r) => tr("bars.ratio", { r: num(r[spec.ratio_labels], 2) })), "ratio-label") + 90
        : Math.max(76, textWidth(svg, valueLabels, "bar-label") + 18);
      const m = horiz ? { l: labW + 12, r: ratioW, t: facetCol ? 36 : 14, b: 54 } : { l: 64, r: 16, t: facetCol ? 40 : 16, b: 34 };
      // a few horizontal bars should not stretch over a tall stage: cap the band and centre the block
      let fh = fhAll, oy = 0;
      if (horiz && !facetCol) {
        const cap = m.t + m.b + cats.length * (series.length > 1 ? 104 : 84);
        if (fh > cap) { oy = (fh - cap) / 2; fh = cap; }
      }
      const fx = (i % cols) * (fw + gx), fy = Math.floor(i / cols) * (fhAll + gy) + oy;
      const g = s("g", { transform: `translate(${fx},${fy})` });
      svg.append(g);
      if (facetCol) g.append(s("text", { class: "facet-title", x: m.l, y: 20, text: catLabel(R, facetCol, fk, spec) }));
      const vScale = horiz ? linear(dom, [m.l, fw - m.r]) : linear(dom, [fh - m.b, m.t]);
      const cScale = band(cats, horiz ? [m.t, fh - m.b] : [m.l, fw - m.r], 0.28);
      const bw = Math.min(horiz ? 34 : 28, cScale.bandwidth / series.length - 2);
      // value axis
      const tks = vScale.ticks(horiz ? 5 : fh - m.t - m.b < 160 ? 2 : 4);
      const tf = tickFormat(Math.abs(tickStep(dom[0], dom[1], 5)));
      for (const t of tks) {
        if (horiz) {
          g.append(s("line", { class: "grid", x1: vScale(t), x2: vScale(t), y1: m.t, y2: fh - m.b }));
          g.append(s("text", { class: "tick", x: vScale(t), y: fh - m.b + 18, "text-anchor": "middle", text: tf(t) }));
        } else {
          g.append(s("line", { class: "grid", x1: m.l, x2: fw - m.r, y1: vScale(t), y2: vScale(t) }));
          g.append(s("text", { class: "tick", x: m.l - 8, y: vScale(t), "text-anchor": "end", "dominant-baseline": "middle", text: tf(t) }));
        }
      }
      const zero = vScale(0);
      g.append(horiz ? s("line", { class: "baseline", x1: zero, x2: zero, y1: m.t, y2: fh - m.b })
        : s("line", { class: "baseline", x1: m.l, x2: fw - m.r, y1: zero, y2: zero }));
      if (i === 0 && spec.value_label && !facetCol) g.append(s("text", { class: "axis-label", x: m.l, y: horiz ? fh - 6 : m.t - 6, text: spec.value_label }));
      const every = horiz ? 1 : Math.ceil(cats.length / Math.max(2, Math.floor((fw - m.l - m.r) / 44)));
      cats.forEach((c, ci) => {
        const pos = cScale(c);
        if (horiz) g.append(s("text", { class: "cat-label", x: m.l - 10, y: pos + cScale.bandwidth / 2, "text-anchor": "end", "dominant-baseline": "middle", text: catLabel(R, cat, c, spec) }));
        else if (ci % every === 0 || ci === cats.length - 1) g.append(s("text", { class: "tick", x: pos + cScale.bandwidth / 2, y: fh - m.b + 18, "text-anchor": "middle", text: catLabel(R, cat, c, spec) }));
        const row = data.find((r) => r[cat] === c);
        if (!row) return;
        series.forEach((sr, si) => {
          const v = row[sr.key];
          if (v == null) return;
          const off = pos + (cScale.bandwidth - (bw + 2) * series.length) / 2 + si * (bw + 2);
          const col = sr.color || (spec.color_by === "sector" ? color("sector", c) : "var(--accent)");
          const a = vScale(Math.min(0, v)), b = vScale(Math.max(0, v));
          const geo = horiz ? { x: Math.min(a, b), y: off, width: Math.abs(b - a), height: bw }
            : { x: off, y: Math.min(a, b), width: bw, height: Math.abs(b - a) };
          const key = `${fk}|${c}|${sr.key}`;
          const prev = this.prev.get(key) || (horiz ? { ...geo, width: 0, x: zero } : { ...geo, height: 0, y: zero });
          const rect = s("rect", { class: "bar", ...prev, rx: 3, style: `fill:${col}`, tabindex: -1 });
          g.append(rect);
          tween(rect, geo, dur);
          this.prev.set(key, geo);
          bindTip(rect, () => tipHTML(`${facetCol ? catLabel(R, facetCol, fk, spec) + " · " : ""}${catLabel(R, cat, c, spec)}`,
            [[sr.label || spec.value_label || "", fmt(v, spec)], ...(spec.labels === "share_pct" && row.share_pct != null ? [[tr("bars.share"), num(row.share_pct, 2) + "%"]] : [])]));
          // tip label only where it fits
          const lab = labelFor(row, v, spec);
          if (lab && (horiz || series.length === 1)) {
            const tx = horiz ? (v >= 0 ? b + 6 : a - 6) : off + bw / 2;
            const ty = horiz ? off + bw / 2 : (v >= 0 ? b - 6 : a + 14);
            g.append(s("text", { class: "bar-label", x: tx, y: ty, "text-anchor": horiz ? (v >= 0 ? "start" : "end") : "middle", "dominant-baseline": horiz ? "middle" : "auto", text: lab }));
          }
        });
        if (spec.ratio_labels && row[spec.ratio_labels] != null && horiz) {
          g.append(s("text", { class: "ratio-label", x: fw - 8, y: pos + cScale.bandwidth / 2, "text-anchor": "end", "dominant-baseline": "middle",
            text: tr("bars.ratio", { r: num(row[spec.ratio_labels], 2) }) }));
        }
      });
    });
  }

  sectorComparison(spec, ctx) {
    clear(this.el); hideTip();
    const wide = this.el.clientWidth >= 1100;
    const wrap = h("div", { class: "sector-comparison" + (wide ? " sector-comparison--wide" : "") });
    this.el.append(wrap);
    const common = { ...spec, layout: undefined, facet: undefined, category: "part", orientation: "h", color_by: "sector" };
    const filter = { ...spec.filter, part: ["moph", "other_public", "private"] };
    const views = [
      { title: tr("bars.contribution_title"), value: "delta", value_label: tr("bars.contribution_unit"), labels: "share_pct", kind: "sector_delta" },
      { title: tr("bars.growth_title"), value: "cagr_pct", value_label: tr("bars.growth_unit"), labels: "value", kind: "universe_growth" },
    ];
    const panels = views.map((v) => {
      const stage = h("div", { class: "sector-comparison__plot" });
      wrap.append(h("section", { class: "sector-comparison__panel" }, h("h4", { text: v.title }), stage));
      return { v, stage };
    });
    // Both panels read the same exported rows, with independent declared units.
    for (const { v, stage } of panels) new Bars(stage, ctx).update({ ...common, ...v, filter: { ...filter, kind: v.kind } }, ctx);
  }

  destroy() { hideTip(); clear(this.el); }
}

function fmt(v, spec) {
  if (spec.value_label && spec.value_label.includes("%")) return num(v, 2) + "%";
  return num(v, Math.abs(v) >= 100 ? 0 : 2);
}

function labelFor(row, v, spec) {
  if (spec.labels === "share_pct" && row.share_pct != null) return tr("bars.people_share", { n: num(v, 0), pct: num(row.share_pct, 1) });
  if (spec.labels === "value") return fmt(v, spec);
  if (spec.series_cols && spec.orientation === "h") return num(v, spec.digits ?? 2);
  return null;
}
