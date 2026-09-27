// Lines and small multiples. One y-axis per panel (never two); counts of
// different magnitude get their own panels, indexed series share one axis.

import { h, s, clear, tween, duration } from "../util/dom.js";
import { num, be, yearLabel, tickFormat } from "../util/format.js";
import { linear, extent, nice, tickStep } from "../util/scale.js";
import { color, colorSpec, axisLeft, axisBottom, legend, bindTip, tipHTML, hideTip, showTip, tooltip, textWidth, wrapText } from "./core.js";
import { regionsInset } from "./provinces.js";
import { t } from "../util/i18n.js";

// space between small-multiple panels (px); panels never touch
const GUTTER = 28;

function seriesLabel(R, col, v) {
  if (col === "metric") return R.label("metric", v);
  if (col === "scenario") return R.label("scenario", v);
  if (col === "cadre") return R.label("cadre", v);
  if (col === "scope") return R.label("scope", v);
  if (col === "tier") return R.label("tier", v);
  if (col === "outcome") return R.label("outcome", v);
  return String(v);
}

export class Lines {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.prev = new Map(); // key -> last path d, to animate from
  }

  update(spec, ctx) {
    this.ctx = ctx;
    const R = ctx.release;
    const rows = R.select(spec.dataset, spec.filter);
    const xcol = spec.x || "year";
    const basis = spec.x_basis || (xcol === "fiscal_year" ? "fiscal_year" : "report_year");
    const facetCol = spec.facet || null;
    const facetKeys = facetCol ? orderKeys(R, facetCol, [...new Set(rows.map((r) => r[facetCol]))], spec) : [null];
    // series: from a column, or from several y columns
    let series;
    if (spec.ys?.length) series = spec.ys.map((y) => ({ key: y.col, label: y.label, col: y.col, color: colorSpec(y.color), raw: y.raw_col, lo: y.lo, hi: y.hi }));
    else if (spec.series) {
      const listed = Array.isArray(spec.filter?.[spec.series]) ? spec.filter[spec.series] : null;
      const keys = listed || orderKeys(R, spec.series, [...new Set(rows.map((r) => r[spec.series]))], spec);
      series = keys.map((k, i) => ({
        key: k, label: seriesLabel(R, spec.series, k), col: spec.y, raw: spec.raw_value, lo: spec.lo, hi: spec.hi,
        color: spec.color_by === "cadre" ? color("cadre", k) : spec.color_by === "scenario" ? color("scenario", k) : spec.color_by === "sector" ? color("sector", k === "moph_service" ? "moph" : k) : color("series", i + 1),
        filter: (r) => r[spec.series] === k,
      }));
    } else series = [{ key: spec.y, label: spec.y_label, col: spec.y, color: null, raw: spec.raw_value, lo: spec.lo, hi: spec.hi }];
    const reveal = spec.reveal ? new Set(spec.reveal) : null;
    const dashed = new Set(spec.dash_series || []);
    const scenarioRows = spec.scenario_lines ? R.select(spec.scenario_lines.dataset, spec.scenario_lines.filter) : [];
    const centralVariant = R.ds(spec.dataset).meta.central_variant || {};

    const shared = spec.mode === "index" || spec.y_shared || !facetCol;
    clear(this.el);
    hideTip();
    const wrap = h("div", { class: "lines" });
    this.el.append(wrap);
    if (spec.banner) wrap.append(h("p", { class: "chart-banner", text: spec.banner }));
    const showLegend = series.length > 1;
    if (showLegend) wrap.append(legend(series.filter((sr) => !reveal || reveal.has(sr.key)).map((sr) => ({ label: sr.label, color: sr.color || "var(--accent)", shape: "line", dash: dashed.has(sr.key) }))));
    if (facetCol && spec.y_label) wrap.append(h("p", { class: "chart-unit", text: t("chart.y_axis", { label: spec.y_label }) + (shared ? "" : t("chart.free_scale")) }));
    const box = h("div", { class: "lines__plot" });
    if (spec.inset === "regions") {
      // the inset sits beside the panels, never on top of them
      const row = h("div", { class: "lines__row" }, box);
      wrap.append(row);
      regionsInset(row, R, { width: 120, height: 200 });
    } else wrap.append(box);

    const r = box.getBoundingClientRect();
    const W = Math.max(300, r.width), H = Math.max(240, r.height);
    const n = facetKeys.length;
    let cols = n === 1 ? 1 : n === 2 ? 2 : n === 3 ? (W > 900 ? 3 : 1) : W > 640 ? 2 : 1;
    let rowsN = Math.ceil(n / cols);
    let gx = cols > 1 ? GUTTER : 0, gy = rowsN > 1 ? GUTTER : 0;
    let fw = (W - gx * (cols - 1)) / cols, fh = (H - gy * (rowsN - 1)) / rowsN;
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${spec.y_label || ""}: ${series.map((x) => x.label).join(", ")}` });
    box.append(svg);

    // x runs over the years that carry a value (an index with a later base year starts there)
    const ycols = [...new Set(series.map((sr) => sr.col))];
    const xs = [...new Set(rows.filter((r) => ycols.some((c) => r[c] != null)).map((r) => r[xcol]))].sort((a, b) => a - b);
    const valuesFor = (fk, sr) => rows.filter((r) => (fk == null || r[facetCol] === fk) && (!sr.filter || sr.filter(r)));
    const domainOf = (fks) => {
      const vals = [];
      for (const fk of fks) for (const sr of series) for (const r of valuesFor(fk, sr)) {
        vals.push(r[sr.col]);
        if (sr.lo) vals.push(r[sr.lo]);
        if (sr.hi) vals.push(r[sr.hi]);
      }
      if (spec.mode === "index") vals.push(100);
      if (spec.y_zero) vals.push(0);
      for (const rf of spec.ref || []) if (rf.y != null) vals.push(rf.y);
      return spec.y_domain || nice(extent(vals), 5);
    };
    const endpointText = (pts, sr) => {
      const last = pts[pts.length - 1];
      if (spec.endpoint_stat === "cagr") {
        // Read the analysis' exported CAGR; do not infer it from a rounded index.
        const stat = R.rows(spec.endpoint_dataset || "sector_contrib").find((r) =>
          r.kind === "universe_growth" && r.cadre === last.cadre && r.part === last.scope);
        if (stat?.cagr_pct != null) return t("chart.cagr", { v: num(stat.cagr_pct, 2) });
      }
      return fmtVal(last[sr.col], spec);
    };
    const sharedDom = shared ? domainOf(facetKeys) : null;
    const covid = spec.bands === "covid" ? R.ds(spec.dataset).meta.covid_years : null;
    const dur = duration();
    let tickCount = fh > 260 ? 5 : 3;
    // Measure the exact labels rendered by the shared axis formatter. Counts
    // and long endpoint values need more space than a fixed 64/70 px margin.
    // Shared margins also keep years aligned between the small multiples.
    const marginsFor = (count) => {
      let left = 32, right = 50;
      for (const fk of facetKeys) {
        const dom = sharedDom || domainOf([fk]);
        const probe = linear(dom, [0, 1]);
        const format = tickFormat(Math.abs(tickStep(dom[0], dom[1], count)));
        left = Math.max(left, Math.ceil(textWidth(svg, probe.ticks(count).map(format), "tick")) + 14);
        const endpoints = series.map((sr) => {
          const pts = valuesFor(fk, sr).filter((row) => row[sr.col] != null).sort((a, b) => a[xcol] - b[xcol]);
          return pts.length ? endpointText(pts, sr) : "";
        });
        right = Math.max(right, Math.ceil(textWidth(svg, endpoints, "end-label")) + 16);
      }
      return [left, right];
    };
    let [leftMargin, rightMargin] = marginsFor(tickCount);
    // Side-by-side panels are useful only when their plots still have
    // enough width after accommodating real tick and endpoint text.
    if ((n === 2 || n === 3) && cols > 1 && fw - leftMargin - rightMargin < 300) {
      cols = 1; rowsN = n; gx = 0; gy = GUTTER;
      fw = W; fh = (H - gy * (rowsN - 1)) / rowsN;
      tickCount = fh > 260 ? 5 : 3;
      [leftMargin, rightMargin] = marginsFor(tickCount);
    }
    const yearGap = Math.max(64, textWidth(svg, xs.map(be), "tick") + 18);
    const labelProbe = s("text", { class: "end-label", text: "0" });
    svg.append(labelProbe);
    const labelGap = Math.ceil(labelProbe.getBBox().height + 4);
    labelProbe.remove();

    const facetLabel = (fk) => spec.facet_labels?.[fk] || seriesLabel(R, facetCol, fk);
    const headers = new Map();
    let headerTop = facetCol ? 44 : 28;
    if (facetCol) {
      for (const fk of facetKeys) {
        const m = { l: leftMargin, r: rightMargin, t: 44 };
        const g = s("g", { class: "facet-heading" });
        svg.append(g);
        const title = s("text", { class: "facet-title", x: m.l, y: 18 });
        g.append(title);
        wrapText(title, facetLabel(fk), fw - m.l - 8, 1.2);
        const titleBox = title.getBBox();
        m.t = Math.max(m.t, titleBox.y + titleBox.height + 24);
        for (const annotation of (spec.annotations || []).filter((a) => a.kind !== "break" && (!a.facet || a.facet === fk))) {
          const note = s("text", { class: "facet-note", x: fw - m.r, y: 18, "text-anchor": "end", text: annotation.text });
          g.append(note);
          if (note.getBBox().x < titleBox.x + titleBox.width + 12) {
            note.setAttribute("x", m.l);
            note.setAttribute("y", titleBox.y + titleBox.height + 20);
            note.setAttribute("text-anchor", "start");
            wrapText(note, annotation.text, fw - m.l - 8, 1.2);
          }
          const noteBox = note.getBBox();
          m.t = Math.max(m.t, noteBox.y + noteBox.height + 18);
        }
        if (spec.color_by === "cadre" && facetCol === "cadre") g.append(s("rect", { class: "facet-key", x: m.l - 16, y: 8, width: 10, height: 10, rx: 2, style: `fill:${color("cadre", fk)}` }));
        headerTop = Math.max(headerTop, m.t);
        headers.set(fk, g);
        g.remove();
      }
    }
    facetKeys.forEach((fk, i) => {
      const cx = (i % cols) * (fw + gx), cy = Math.floor(i / cols) * (fh + gy);
      const m = { l: leftMargin, r: rightMargin, t: headerTop, b: basis === "fiscal_year" ? 50 : 36 };
      const g = s("g", { transform: `translate(${cx},${cy})` });
      svg.append(g);
      if (headers.has(fk)) g.append(headers.get(fk));
      const x = linear([xs[0], xs[xs.length - 1]], [m.l, fw - m.r]);
      const y = linear(sharedDom || domainOf([fk]), [fh - m.b, m.t]);
      const markLabel = (xx, text) => {
        // Keep a dated annotation inside the plot, leaving the measured right
        // margin exclusively for endpoint values. Near the last years, the
        // annotation can sit to the left of its line instead of crossing them.
        const gap = 8;
        const right = Math.max(1, fw - m.r - xx - gap);
        const left = Math.max(1, xx - m.l - gap);
        const width = textWidth(g, [text], "mark-label");
        const onRight = width <= right || (width > left && right >= left);
        const available = onRight ? right : left;
        const label = s("text", { class: "mark-label", x: xx + (onRight ? gap : -gap),
          y: m.t + 12, "text-anchor": onRight ? "start" : "end" });
        g.append(label);
        wrapText(label, text, available, 1.2);
      };
      if (covid) {
        const b = s("rect", { class: "band", x: x(Math.min(...covid) - 0.5), y: m.t, width: x(Math.max(...covid) + 0.5) - x(Math.min(...covid) - 0.5), height: fh - m.t - m.b });
        g.append(b, s("text", { class: "band-label", x: x(Math.min(...covid) - 0.5) + 4, y: m.t + 12, text: t("chart.covid") }));
      }
      axisLeft(g, y, { x0: m.l, x1: fw - m.r, ticks: tickCount, label: facetCol ? "" : spec.y_label });
      const yearsShown = [];
      for (const year of xs) {
        if (!yearsShown.length || x(year) - x(yearsShown[yearsShown.length - 1]) >= yearGap) yearsShown.push(year);
      }
      const lastYear = xs[xs.length - 1];
      if (yearsShown[yearsShown.length - 1] !== lastYear) {
        if (yearsShown.length > 1 && x(lastYear) - x(yearsShown[yearsShown.length - 1]) < yearGap) yearsShown.pop();
        yearsShown.push(lastYear);
      }
      axisBottom(g, x, yearsShown, be, { y0: fh - m.b });
      if (basis === "fiscal_year" && i === 0) g.append(s("text", { class: "axis-note", x: m.l, y: fh - 4, "text-anchor": "start", text: t("chart.fiscal_axis") }));
      if (spec.mode === "index") g.append(s("line", { class: "ref-100", x1: m.l, x2: fw - m.r, y1: y(100), y2: y(100) }));
      for (const rf of spec.ref || []) {
        if (rf.y == null) continue;
        g.append(s("line", { class: "ref-line", x1: m.l, x2: fw - m.r, y1: y(rf.y), y2: y(rf.y) }));
        g.append(s("text", { class: "ref-label", x: m.l + 6, y: y(rf.y) - 6, text: `${rf.label} ${rf.display ?? num(rf.y)}` }));
      }
      for (const mk of spec.marks || []) {
        if (mk.at == null || mk.at < xs[0] || mk.at > xs[xs.length - 1]) continue;
        g.append(s("line", { class: "mark-line", x1: x(mk.at), x2: x(mk.at), y1: m.t, y2: fh - m.b }));
        markLabel(x(mk.at), `${yearLabel(mk.at, basis)}: ${mk.text}`);
      }
      for (const an of spec.annotations || []) {
        if (an.facet && an.facet !== fk) continue;
        if (an.kind === "break") {
          const at = an.at === "first+1" ? xs[1] : Number(an.at);
          const xx = (x(at) + x(at - 1)) / 2;
          g.append(s("line", { class: "break-line", x1: xx, x2: xx, y1: m.t, y2: fh - m.b }));
          markLabel(xx, an.text);
        } else if (!facetCol) g.append(s("text", { class: "facet-note", x: fw - m.r, y: 18, "text-anchor": "end", text: an.text }));
      }
      const labels = [];
      const drawn = new Map(); // path d -> label entry, to spot series that coincide exactly
      series.forEach((sr) => {
        if (reveal && !reveal.has(sr.key)) return;
        const pts = valuesFor(fk, sr).filter((r) => r[sr.col] != null).sort((a, b) => a[xcol] - b[xcol]);
        if (!pts.length) return;
        const col = sr.color || (facetCol === "cadre" ? color("cadre", fk) : "var(--accent)");
        const interval = pts.filter((p) => sr.lo && sr.hi && p[sr.lo] != null && p[sr.hi] != null);
        if (interval.length > 1) {
          const upper = interval.map((p, j) => `${j ? "L" : "M"}${x(p[xcol])},${y(p[sr.hi])}`).join("");
          const lower = [...interval].reverse().map((p) => `L${x(p[xcol])},${y(p[sr.lo])}`).join("");
          g.append(s("path", { class: "series-interval", d: upper + lower + "Z", style: `fill:${col}` }));
        }
        const pathOf = (points) => points.map((p, j) => `${j ? "L" : "M"}${x(p[xcol]).toFixed(1)},${y(p[sr.col]).toFixed(1)}`).join("");
        if (scenarioRows.length) {
          const variants = new Map();
          for (const point of scenarioRows.filter((row) => (!sr.filter || sr.filter(row)) && (fk == null || row[facetCol] === fk))) {
            if (Object.keys(centralVariant).length && Object.entries(centralVariant).every(([key, value]) => point[key] === value)) continue;
            const variant = (spec.scenario_lines.group_by || []).map((key) => point[key]).join("|");
            if (!variants.has(variant)) variants.set(variant, []);
            variants.get(variant).push(point);
          }
          for (const points of variants.values()) {
            points.sort((a, b) => a[xcol] - b[xcol]);
            g.append(s("path", { class: "series-line scenario-variant", d: pathOf(points), style: `stroke:${col}` }));
          }
        }
        const d = pathOf(pts);
        const key = `${fk}|${sr.key}`;
        const same = drawn.get(d);
        const futureAt = spec.segment_by ? pts.findIndex((point) => point[spec.segment_by] === "scenario") : -1;
        const segments = futureAt > 0 ? [
          { points: pts.slice(0, futureAt), suffix: "observed", dash: false },
          { points: pts.slice(futureAt - 1), suffix: "projection", dash: true },
        ] : [{ points: pts, suffix: "", dash: dashed.has(sr.key) }];
        for (const segment of segments) {
          const segmentKey = key + segment.suffix, target = pathOf(segment.points);
          const path = s("path", { class: "series-line" + (same ? " coincident" : "") + (segment.suffix === "projection" ? " series-projection" : ""),
            d: this.prev.get(segmentKey) || target, style: `stroke:${col}`,
            "stroke-dasharray": segment.dash ? "9 6" : null });
          g.append(path);
          tween(path, { d: target }, dur);
          this.prev.set(segmentKey, target);
        }
        const last = pts[pts.length - 1];
        g.append(s("circle", { class: "end-dot", cx: x(last[xcol]), cy: y(last[sr.col]), r: 4.5, style: `fill:${col}` }));
        const first = pts[0];
        g.append(s("circle", { class: "start-dot", cx: x(first[xcol]), cy: y(first[sr.col]), r: 3, style: `stroke:${col}` }));
        if (same) { same.overlap = true; return; }
        const entry = { y: y(last[sr.col]), x: x(last[xcol]) + 8, text: endpointText(pts, sr), name: series.length > 1 ? sr.label : "" };
        drawn.set(d, entry);
        labels.push(entry);
      });
      // end labels: nudge apart minimally; if they would collide badly, keep values only (legend carries names)
      labels.sort((a, b) => a.y - b.y);
      for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < labelGap) labels[k].y = labels[k - 1].y + labelGap;
      const labelOverflow = Math.max(0, ...labels.map((L) => L.y + (L.overlap ? labelGap : 0) - (fh - m.b)));
      if (labelOverflow) for (const L of labels) L.y -= labelOverflow;
      for (const L of labels) {
        g.append(s("text", { class: "end-label", x: L.x, y: L.y, "dominant-baseline": "middle", text: L.text }));
        // two series drawn on the same path: say so under the value, not beside it (keeps the margin narrow)
        if (L.overlap) g.append(s("text", { class: "facet-note", x: fw - 4, y: L.y + labelGap, "text-anchor": "end", "dominant-baseline": "middle", text: t("chart.overlap").trim() }));
      }
      // hover layer: nearest year, all visible series
      const hit = s("rect", { class: "hit", x: m.l, y: m.t, width: fw - m.l - m.r, height: fh - m.t - m.b, tabindex: -1 });
      const cross = s("line", { class: "crosshair", visibility: "hidden", y1: m.t, y2: fh - m.b, x1: -10, x2: -10 });
      g.append(cross, hit);
      const tipAt = (evt) => {
        const bb = hit.getBoundingClientRect();
        const px = ((evt.clientX - bb.left) / bb.width) * (fw - m.l - m.r) + m.l;
        const xv = x.invert(px);
        const near = xs.reduce((a, b) => (Math.abs(b - xv) < Math.abs(a - xv) ? b : a), xs[0]);
        cross.setAttribute("x1", x(near)); cross.setAttribute("x2", x(near)); cross.setAttribute("visibility", "visible");
        const rowsTip = series.filter((sr) => (!reveal || reveal.has(sr.key)) && valuesFor(fk, sr).length).flatMap((sr) => {
          const r = valuesFor(fk, sr).find((q) => q[xcol] === near);
          const label = facetCol && facetCol === spec.series ? facetLabel(fk) : sr.label || spec.y_label || "";
          const out = [[label, r ? fmtVal(r[sr.col], spec) : t("chart.no_data")]];
          const raw = sr.raw || spec.raw_value;
          if (r && raw && r[raw] != null && raw !== sr.col)
            out.push([`${label} · ${spec.raw_label || t("chart.raw_value")}`, num(r[raw], spec.raw_digits ?? (raw === "headcount" || raw === "value" ? 0 : 2))]);
          if (r && sr.lo && sr.hi && r[sr.lo] != null && r[sr.hi] != null)
            out.push([spec.interval_kind === "scenario_range" ? t("chart.scenario_range") : t("chart.interval"), `${num(r[sr.lo], 2)}–${num(r[sr.hi], 2)}`]);
          for (const point of scenarioRows.filter((row) => row[xcol] === near && (!sr.filter || sr.filter(row)) && (fk == null || row[facetCol] === fk))) {
            const years = String(point.window_years).split("-").map((year) => be(Number(year))).join("–");
            const population = point.population_scenario === "pop_fixed" ? t("chart.population_fixed") : t("chart.population_trend");
            out.push([`${t("chart.scenario_window", { years })} · ${population}`, num(point[sr.col], 2)]);
          }
          return out;
        });
        const discrepant = spec.series === "scope" && (R.ds(spec.dataset).meta.sector_total_discrepancies || []).some((row) =>
          row.year === near && (facetCol === "cadre" ? row.cadre === fk : row.cadre === spec.filter?.cadre));
        if (discrepant) rowsTip.push([t("chart.sector_total_mismatch"), ""]);
        const content = tipHTML(`${facetCol ? facetLabel(fk) + " · " : ""}${yearLabel(near, basis)}`, rowsTip);
        showTip(hit, scenarioRows.length ? `<div class="lines-tip--scenario">${content}</div>` : content, evt);
        // Scenario details are deliberately complete. Keep their measured box
        // inside the viewport when there is no room above the pointer.
        if (scenarioRows.length) {
          const tip = tooltip();
          if (tip) tip.style.top = `${Math.max(8, Math.min(parseFloat(tip.style.top), innerHeight - tip.offsetHeight - 8))}px`;
        }
      };
      hit.addEventListener("mousemove", tipAt);
      hit.addEventListener("mouseleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); });
      hit.addEventListener("touchstart", (e) => tipAt(e.touches[0] ? Object.assign(e, { clientX: e.touches[0].clientX }) : e), { passive: true });
    });
  }

  destroy() { hideTip(); clear(this.el); }
}

function fmtVal(v, spec) {
  if (v == null) return t("chart.no_data");
  if (spec.y === "gini" || spec.y === "gini_weighted") return num(v, 3);
  if (spec.mode === "index") return num(v, 1);
  if (spec.y_label && spec.y_label.includes("%")) return num(v, 1) + "%";
  return num(v);
}

function orderKeys(R, col, keys, spec) {
  const orderTable = { cadre: R.vocab.cadres, scenario: R.vocab.scenarios };
  const t = orderTable[col];
  if (t) return keys.sort((a, b) => (t[a]?.order ?? 99) - (t[b]?.order ?? 99));
  if (Array.isArray(spec.filter?.[col])) return spec.filter[col].filter((k) => keys.includes(k));
  return keys;
}
