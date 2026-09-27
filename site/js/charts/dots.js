// Dot plot / forest plot. Rows keep their position across steps (unrevealed rows
// stay as placeholders) so a reveal never reshuffles what the audience has read.
// An interval that crosses zero is drawn hollow and labelled - uncertainty is
// part of the mark, not a footnote.
//
// spec.series (optional) draws several estimates per row, offset vertically and
// coloured by series (e.g. two model variants); the legend names each series.
// spec.row_labels [{key, label}] gives readable names for coded row ids.

import { h, s, clear, tween, duration } from "../util/dom.js";
import { num, signed } from "../util/format.js";
import { linear, extent, nice } from "../util/scale.js";
import { evidencePath, legend, bindTip, tipHTML, hideTip, textWidth, wrapText } from "./core.js";
import { t } from "../util/i18n.js";

const GUTTER = 32;
const SERIES_COLORS = ["var(--accent)", "var(--n-2)", "var(--n-3)"];

export class Dots {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; this.prev = new Map(); }

  update(spec, ctx) {
    this.ctx = ctx;
    const R = ctx.release;
    const rows = R.select(spec.dataset, spec.filter);
    const facetCol = spec.facet || null;
    const facets = facetCol ? [...new Set(rows.map((r) => r[facetCol]))].sort((a, b) =>
      ["op_moph", "ip_moph", "adjrw"].indexOf(a) - ["op_moph", "ip_moph", "adjrw"].indexOf(b)) : [null];
    const cat = spec.category;
    let cats = spec.order || [...new Set(rows.map((r) => r[cat]))];
    cats = cats.filter((c) => rows.some((r) => r[cat] === c));
    const reveal = spec.reveal ? new Set(spec.reveal) : null;
    const emph = spec.emphasis ? new Set(spec.emphasis) : null;
    const rowLabel = new Map((spec.row_labels || []).map((x) => [x.key, x.label]));
    const lab = (c, r) => {
      if (rowLabel.has(c)) return rowLabel.get(c);
      if (spec.category_label === "step") return `${r?.baseline ?? ""}→${c}`;
      if (spec.category_label === "comparison_denominators") return R.label("comparison_denominators", c);
      return String(c);
    };
    const desc = (c) => (spec.category_label === "step" ? R.label("step", c) : "");
    // series within a row
    const serCol = spec.series || null;
    const OUT_ORDER = ["op_moph", "ip_moph", "adjrw"];
    const serKeys = serCol ? (Array.isArray(spec.filter?.[serCol]) ? spec.filter[serCol] : [...new Set(rows.map((r) => r[serCol]))]
      .sort((a, b) => OUT_ORDER.indexOf(a) - OUT_ORDER.indexOf(b))) : [null];
    const serLabel = (k) => (serCol === "variant" ? R.label("variant", k) : serCol === "outcome" ? R.label("outcome", k) : String(k));
    const serColor = (k) => SERIES_COLORS[Math.max(0, serKeys.indexOf(k)) % SERIES_COLORS.length];

    clear(this.el); hideTip();
    const wrap = h("div", { class: "dots" + (spec.ladder ? " has-ladder" : "") });
    this.el.append(wrap);
    const legends = h("div", { class: "legend-row" });
    if (spec.shape_by === "evidence") {
      const types = [...new Set(rows.map((r) => r.evidence))];
      legends.append(legend(types.map((ty) => ({ label: R.label("evidence", ty), color: "var(--text-secondary)", shape: `ev-${ty}` })), { title: t("chart.evidence") }));
    }
    if (serCol && serKeys.length > 1) legends.append(legend(serKeys.map((k) => ({ label: serLabel(k), color: serColor(k), shape: "dot" }))));
    if (spec.lo) legends.append(legend([{ label: t("chart.ci_clear"), color: "var(--accent)", shape: "dot" },
      { label: t("chart.ci_cross"), color: "var(--accent)", shape: "ring" }]));
    wrap.append(legends);
    const body = h("div", { class: "dots__body" });
    wrap.append(body);
    if (spec.ladder) {
      const ul = h("ol", { class: "ladder", "aria-label": t("chart.model_ladder") });
      for (const [k, v] of Object.entries(R.vocab.model_steps)) {
        const on = !reveal || reveal.has(k) || k === "M0";
        ul.append(h("li", { class: (on ? "on" : "") + (emph?.has(k) ? " emph" : "") }, h("strong", { text: k }), " ", v));
      }
      body.append(ul);
    }
    const box = h("div", { class: "dots__plot" });
    body.append(box);
    if (spec.definition) wrap.append(h("div", { class: "definition" }, h("span", { class: "definition__tag", text: t("chart.definition") }), h("p", { text: spec.definition })));

    const r0 = box.getBoundingClientRect();
    const W = Math.max(300, r0.width), H = Math.max(220, r0.height);
    const n = facets.length;
    const cols = n > 1 && W > 600 ? n : 1;
    const rowsN = Math.ceil(n / cols);
    const gx = cols > 1 ? GUTTER : 0, gy = rowsN > 1 ? GUTTER : 0;
    const fw = (W - gx * (cols - 1)) / cols, fh = (H - gy * (rowsN - 1)) / rowsN;
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": spec.value_label || "" });
    box.append(svg);
    const vals = rows.filter((r) => cats.includes(r[cat])).flatMap((r) => [r[spec.value], spec.lo ? r[spec.lo] : null, spec.hi ? r[spec.hi] : null]);
    if (spec.zero_line) vals.push(0);
    const dom = nice(extent(vals), 5);
    const dur = duration();
    const showCatLabels = (i) => i % cols === 0;
    // readable rows: cap the row height so a short list does not spread over the whole stage
    const maxRow = serKeys.length > 1 ? 150 : 90;

    facets.forEach((fk, i) => {
      const fx = (i % cols) * (fw + gx), fy = Math.floor(i / cols) * (fh + gy);
      const g = s("g", { transform: `translate(${fx},${fy})` });
      svg.append(g);
      const labels = cats.map((c) => lab(c, rows.find((q) => q[cat] === c)));
      const lw = showCatLabels(i) ? Math.min(fw * 0.42, textWidth(svg, labels) + 26) : 16;
      const m = { l: lw, r: 86, t: facetCol ? 40 : 16, b: 52 };
      if (facetCol) g.append(s("text", { class: "facet-title", x: m.l, y: 20, text: R.label("outcome", fk) }));
      const x = linear(dom, [m.l, fw - m.r]);
      const rowH = Math.min(maxRow, (fh - m.t - m.b) / cats.length);
      const plotH = rowH * cats.length;
      for (const tk of x.ticks(4)) {
        g.append(s("line", { class: "grid", x1: x(tk), x2: x(tk), y1: m.t, y2: m.t + plotH }));
        g.append(s("text", { class: "tick", x: x(tk), y: m.t + plotH + 18, "text-anchor": "middle", text: num(tk, 0) }));
      }
      if (spec.zero_line) g.append(s("line", { class: "zero-line", x1: x(0), x2: x(0), y1: m.t - 6, y2: m.t + plotH }));
      if (i === 0) g.append(s("text", { class: "axis-label", x: m.l, y: m.t + plotH + 40, text: spec.value_label || "" }));
      cats.forEach((c, ci) => {
        const yMid = m.t + ci * rowH + rowH / 2;
        if (showCatLabels(i)) {
          const tx = s("text", { class: "cat-label" + (reveal && !reveal.has(c) ? " dim" : "") + (emph?.has(c) ? " emph" : ""),
            x: m.l - 12, y: yMid, "text-anchor": "end", "dominant-baseline": "middle", text: lab(c, rows.find((q) => q[cat] === c)) });
          g.append(tx);
          wrapText(tx, lab(c, rows.find((q) => q[cat] === c)), m.l - 24, 1.25);
          const lines = tx.querySelectorAll("tspan").length;
          tx.setAttribute("y", yMid - (lines - 1) * parseFloat(getComputedStyle(tx).fontSize) * .625);
        }
        const shown = !reveal || reveal.has(c);
        if (!shown) {
          g.append(s("line", { class: "placeholder", x1: m.l, x2: fw - m.r, y1: yMid, y2: yMid }));
          return;
        }
        const present = serKeys.filter((k) => rows.some((q) => q[cat] === c && (fk == null || q[facetCol] === fk) && (k == null || q[serCol] === k)));
        present.forEach((sk, si) => {
          const r = rows.find((q) => q[cat] === c && (fk == null || q[facetCol] === fk) && (sk == null || q[serCol] === sk));
          const separation = Math.min(28, rowH / (present.length + 1));
          const off = present.length > 1 ? (si - (present.length - 1) / 2) * separation : 0;
          const y = yMid + off;
          const v = r[spec.value], lo = spec.lo ? r[spec.lo] : null, hi = spec.hi ? r[spec.hi] : null;
          const crosses = lo != null && hi != null && lo <= 0 && hi >= 0;
          const key = `${fk}|${c}|${sk}`;
          const col = serCol ? serColor(sk) : null;
          const grp = s("g", { class: "dot-row" + (emph && !emph.has(c) ? " is-dim" : "") + (emph?.has(c) ? " is-emph" : ""), tabindex: -1 });
          if (col) grp.style.setProperty("--dot", col);
          g.append(grp);
          if (lo != null && hi != null) grp.append(s("line", { class: "ci", x1: x(lo), x2: x(hi), y1: y, y2: y }));
          const px = x(v);
          const prevX = this.prev.get(key) ?? x(0);
          const shape = s("path", { class: "dot" + (crosses ? " hollow" : ""), d: evidencePath(spec.shape_by === "evidence" ? r.evidence : "observed", 7),
            transform: `translate(${prevX},${y})` });
          grp.append(shape);
          tween(shape, { transform: `translate(${px},${y})` }, dur);
          this.prev.set(key, px);
          const txt = signed(v, 1) + (spec.value_label?.includes("%") ? "%" : "");
          // A dedicated value column keeps estimates clear of neighbouring intervals.
          grp.append(s("text", { class: "dot-label", x: fw - 4, y, "text-anchor": "end", "dominant-baseline": "middle", text: txt }));
          const tipRows = [[spec.value_label || t("chart.value"), num(v, 2)]];
          if (sk != null) tipRows.unshift([t("chart.series"), serLabel(sk)]);
          if (lo != null) tipRows.push([t("chart.ci95"), t("chart.ci_range", { lo: num(lo, 2), hi: num(hi, 2) })]);
          if (desc(c)) tipRows.push([t("chart.step_adds"), desc(c)]);
          if (r.evidence) tipRows.push([t("chart.evidence"), R.label("evidence", r.evidence)]);
          if (r.responsibility) tipRows.push([t("chart.represents"), r.responsibility]);
          if (r.year_basis === "fiscal_year") tipRows.push([t("chart.basis"), t("chart.fiscal_basis")]);
          grp.append(s("rect", { class: "hit", x: 0, y: y - Math.max(9, rowH / (2 * present.length)), width: fw, height: Math.max(18, rowH / present.length) }));
          bindTip(grp, () => tipHTML(`${facetCol ? R.label("outcome", fk) + " · " : ""}${lab(c, r)}`, tipRows));
        });
      });
    });
  }

  destroy() { hideTip(); clear(this.el); }
}
