// Compare saved plans only: colours and points never run a new allocation model.
import { h, s, clear } from "../util/dom.js";
import { num, be } from "../util/format.js";
import { linear, nice } from "../util/scale.js";
import { projector, pathFor } from "./provinces.js";
import { bindTip, tipHTML, hideTip } from "./core.js";
import { t } from "../util/i18n.js";
import { toCSV, download } from "../ui/table.js";

export const PLAN_KEYS = ["P-R", "S-R", "N-R", "SQ-C", "NFB0.5-R", "NFB1-R"];
const PLAN_COLOURS = ["var(--n-1)", "var(--n-2)", "var(--n-3)", "var(--n-neutral)", "var(--accent)", "var(--accent-violet)"];
export const planLabel = key => t(`compare.plan_${PLAN_KEYS.indexOf(key)}`);
const sign = (value, decimals = 0) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${num(Math.abs(value), decimals)}`;
const colour = (value, limit) => value === 0 ? "var(--div-0)" : `var(--div-${value > 0 ? "p" : "n"}${Math.min(3, Math.max(1, Math.ceil(Math.abs(value) / limit * 3)))})`;
const metricLabel = value => t(`compare.metric_${value}`);

export class PlanCompare {
  constructor(el) { this.el = el; this.key = null; this.selected = null; }

  update(spec, ctx) {
    this.spec = spec; this.ctx = ctx;
    this.rows = ctx.release.rows(spec.dataset);
    this.years = [...new Set(this.rows.map(r => r.year).filter(y => y !== "all"))].sort((a, b) => a - b);
    const key = JSON.stringify(spec);
    if (key !== this.key) {
      this.key = key;
      this.state = { base: spec.base_plan || "P-R", compare: spec.compare_plan || "S-R",
        year: spec.year ?? "all", metric: spec.metric || "x" };
      this.selected = null;
    }
    if (ctx.selected?.length) this.selected = ctx.selected[0];
    this.render();
  }

  records() {
    const st = this.state;
    const byPlan = new Map(PLAN_KEYS.map(p => [p, new Map()]));
    for (const row of this.rows) if (row.year === st.year) byPlan.get(row.plan)?.set(row.prov_code, row);
    const base = byPlan.get(st.base), compare = byPlan.get(st.compare);
    return { byPlan, rows: [...base.values()].map(a => {
      const b = compare.get(a.prov_code);
      const delta = st.metric === "rank" ? a.rank - b.rank : b[st.metric] - a[st.metric];
      return { code: a.prov_code, province: a.province, a, b, delta };
    }) };
  }

  switchCount() {
    const st = this.state;
    const selected = this.rows.filter(r => r.year !== "all" && (st.year === "all" || r.year === st.year));
    const lookup = new Map(selected.filter(r => r.plan === st.base).map(r => [`${r.year}|${r.prov_code}`, r.x]));
    const baseTotal = [...lookup.values()].reduce((a, b) => a + b, 0);
    const moved = selected.filter(r => r.plan === st.compare).reduce((sum, r) => sum + Math.abs(r.x - lookup.get(`${r.year}|${r.prov_code}`)), 0) / 2;
    return { moved, pct: baseTotal ? moved / baseTotal * 100 : 0 };
  }

  select(label, key, options) {
    const select = h("select", { "data-control": key, "aria-label": label, onchange: event => {
      this.state[key] = key === "year" && event.target.value !== "all" ? Number(event.target.value) : event.target.value;
      if (this.state.base === this.state.compare) this.state[key === "base" ? "compare" : "base"] = PLAN_KEYS.find(p => p !== event.target.value);
      this.render();
      this.el.querySelector(`[data-control="${key}"]`)?.focus({ preventScroll: true });
    } }, ...options.map(([value, text]) => h("option", { value, text, selected: String(value) === String(this.state[key]) })));
    return h("label", { class: "compare__field" }, h("span", { text: label }), select);
  }

  render() {
    hideTip(); clear(this.el);
    const st = this.state, spec = this.spec;
    const gini = st.metric === "gini";
    const wrap = h("div", { class: `plan-compare plan-compare--${spec.kind || "map"}` });
    this.el.append(wrap);
    const controls = h("div", { class: "compare__controls" });
    const planOptions = PLAN_KEYS.map(p => [p, planLabel(p)]);
    if (!gini) controls.append(this.select(t("compare.base"), "base", planOptions), this.select(t("compare.other"), "compare", planOptions));
    if (!gini) controls.append(this.select(t("compare.period"), "year", [["all", t(["x", "rank"].includes(st.metric) ? "compare.all_years" : "compare.last_year", { a: be(this.years[0]), b: be(this.years.at(-1)) })], ...this.years.map(y => [y, be(y)])]));
    const metrics = spec.metrics || (spec.kind === "scatter" ? ["x", "closing", "attainment_p", "attainment_s", "gini"] : ["x", "rank"]);
    if (metrics.length > 1) controls.append(this.select(t("compare.measure"), "metric", metrics.map(k => [k, metricLabel(k)])));
    wrap.append(controls);
    if (gini) { this.gini(wrap); return; }
    const { byPlan, rows } = this.records();
    const summary = this.switchCount();
    const kpis = h("div", { class: "compare__summary" },
      this.kpi(t("compare.switched"), t("map.persons", { n: num(summary.moved, 0) }), t("compare.pool_share", { v: num(summary.pct, 1) })),
      this.kpi(t("compare.more"), num(rows.filter(r => r.b.x > r.a.x).length, 0), t("compare.provinces")),
      this.kpi(t("compare.less"), num(rows.filter(r => r.b.x < r.a.x).length, 0), t("compare.provinces")));
    wrap.append(kpis);
    bindTip(kpis.firstElementChild, () => tipHTML(t("compare.switched"), [["", t("compare.switch_definition")]]));
    const body = h("div", { class: "compare__body" });
    wrap.append(body);
    const plot = h("div", { class: "compare__plot" });
    const side = h("div", { class: "compare__side" });
    body.append(plot, side);
    const note = st.metric === "rank" ? t("compare.rank_definition") : spec.kind === "scatter" ? t("compare.diagonal_note", { plan: st.compare }) : t("compare.map_note");
    wrap.append(h("p", { class: "compare__note", text: `${note}${["closing", "attainment_p", "attainment_s"].includes(st.metric) ? ` · ${t("compare.endyear_note")}` : ""}` }));
    if (spec.kind === "scatter") this.scatter(plot, rows, byPlan);
    else this.map(plot, rows, byPlan);
    this.table(side, rows);
  }

  kpi(label, value, detail) {
    return h("div", { class: "compare__kpi" }, h("span", { text: label }), h("strong", { text: value }), h("small", { text: detail }));
  }

  tip(row) {
    const st = this.state;
    const unit = st.metric.startsWith("attainment") ? 2 : 0;
    return tipHTML(row.province, [[metricLabel(st.metric), ""], [planLabel(st.base), num(row.a[st.metric], unit)],
      [planLabel(st.compare), num(row.b[st.metric], unit)], [t(st.metric === "rank" ? "compare.rank_change" : "compare.delta"), sign(row.delta, unit)],
      [t("compare.allocation_ranks"), `${row.a.rank} → ${row.b.rank}`], [t("compare.basis"), st.year === "all" ? t("compare.period_definition") : be(st.year)]]);
  }

  map(plot, rows, byPlan) {
    // One symmetric scale across every pair of plans in the selected period.
    const st = this.state;
    const differences = rows.map(r => {
      const values = [...byPlan.values()].map(m => m.get(r.code)[st.metric]);
      return Math.max(...values) - Math.min(...values);
    });
    const limit = Math.max(1, ...differences);
    const leg = h("div", { class: "compare__legend" }, h("span", { text: t(st.metric === "rank" ? "compare.rank_down" : "compare.fewer") }),
      h("span", { class: "compare__ramp" }), h("span", { text: t(st.metric === "rank" ? "compare.rank_up" : "compare.more_short") }));
    plot.append(leg);
    bindTip(leg, () => tipHTML(t("compare.scale"), [[t("compare.range"), `${sign(-limit)} … ${sign(limit)}`], ["", t("compare.scale_shared")]]));
    const box = h("div", { class: "compare__svgbox" }); plot.append(box);
    const { width, height } = box.getBoundingClientRect(), W = Math.max(260, width), H = Math.max(260, height);
    const svg = s("svg", { class: "compare__map", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": t("compare.map_aria", { a: st.base, b: st.compare }) });
    box.append(svg);
    const R = this.ctx.release, project = projector(R.geo.bbox, W, H, 12), lookup = new Map(rows.map(r => [r.code, r]));
    for (const province of R.geo.provinces) {
      const row = lookup.get(province.code);
      const path = s("path", { class: `prov__shape compare__province${this.selected === province.code ? " is-selected" : ""}`, "data-code": province.code,
        d: pathFor(province.polygons, project), style: `fill:${row ? colour(row.delta, limit) : "var(--map-excluded)"}`, tabindex: row ? 0 : -1,
        "aria-label": row ? `${row.province}: ${sign(row.delta)}` : t("alloc.bangkok") });
      svg.append(path);
      bindTip(path, () => row ? this.tip(row) : tipHTML(province.name_th, [["", t("alloc.bangkok")]]));
      if (row) this.selection(path, row.code);
    }
    const chosen = lookup.get(this.selected);
    if (chosen) {
      const province = R.geoByCode.get(chosen.code), [x, y] = project(...province.label_point);
      svg.append(s("circle", { cx: x, cy: y, r: 6, class: "compare__locator" }));
    }
  }

  selection(element, code) {
    const choose = () => { this.selected = this.selected === code ? null : code; this.render(); };
    element.addEventListener("click", choose);
    element.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); choose(); }
    });
  }

  scatter(plot, rows, byPlan) {
    const st = this.state;
    const decimals = st.metric.startsWith("attainment") ? 2 : 0;
    const max = Math.max(1, ...[...byPlan.values()].flatMap(m => [...m.values()].map(r => r[st.metric])));
    const domain = nice([0, max * 1.08], 5);
    const graph = this.plotAxes(plot, domain, decimals, {
      x: t("compare.x_axis", { label: st.base }), y: t("compare.y_axis", { label: st.compare }),
    });
    const { svg, x, y, W, H } = graph;
    svg.append(s("line", { class: "ref-line", x1: x(domain[0]), y1: y(domain[0]), x2: x(domain[1]), y2: y(domain[1]) }));
    for (const row of rows) {
      const px = x(row.a[st.metric]), py = y(row.b[st.metric]);
      const point = s("g", { class: `compare__point${this.selected === row.code ? " is-selected" : ""}`, tabindex: 0, "data-code": row.code,
        "aria-label": `${row.province}: ${num(row.a[st.metric], decimals)} / ${num(row.b[st.metric], decimals)}` });
      point.append(s("circle", { cx: px, cy: py, r: 12, class: "hit-c" }),
        s("circle", { cx: px, cy: py, r: this.selected === row.code ? 7 : 5, style: `fill:${colour(row.delta, max)}`, class: "compare__dot" }));
      if (this.selected === row.code) point.append(s("text", { class: "map-label", x: px > W * .65 ? px - 12 : px + 12,
        y: Math.max(30, Math.min(H - 40, py - 12)), "text-anchor": px > W * .65 ? "end" : "start", text: row.province }));
      bindTip(point, () => this.tip(row)); this.selection(point, row.code); svg.append(point);
    }
  }

  plotAxes(plot, domain, decimals, labels) {
    const margin = { l: decimals ? 64 : 80, r: 30, t: 24, b: 44 };
    plot.style.setProperty("--compare-axis-left", `${margin.l}px`);
    plot.style.setProperty("--compare-axis-right", `${margin.r}px`);
    const box = h("div", { class: "compare__svgbox" });
    // Reserve both captions before measuring the plot. The x caption is
    // centred on the plotting area, below its tick labels, in every mode.
    plot.append(h("p", { class: "compare__axis compare__axis--y", text: labels.y }), box,
      h("p", { class: "compare__axis compare__axis--x", text: labels.x }));
    const { width, height } = box.getBoundingClientRect(), W = Math.max(300, width), H = Math.max(270, height);
    const x = linear(domain, [margin.l, W - margin.r]), y = linear(domain, [H - margin.b, margin.t]);
    const svg = s("svg", { class: "compare__scatter", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": metricLabel(this.state.metric) });
    box.append(svg);
    for (const value of x.ticks(5)) {
      svg.append(s("line", { class: "grid", x1: margin.l, x2: W - margin.r, y1: y(value), y2: y(value) }),
        s("text", { class: "tick", x: margin.l - 10, y: y(value), "text-anchor": "end", "dominant-baseline": "middle", text: num(value, decimals) }),
        s("text", { class: "tick", x: x(value), y: H - 16, "text-anchor": "middle", text: num(value, decimals) }));
    }
    svg.append(s("line", { class: "baseline", x1: margin.l, x2: W - margin.r, y1: H - margin.b, y2: H - margin.b }));
    return { svg, x, y, W, H };
  }

  table(side, rows) {
    const st = this.state;
    const selected = rows.find(r => r.code === this.selected);
    side.append(h("h3", { text: selected ? selected.province : t("compare.ranking_title") }));
    if (selected) {
      const decimals = st.metric.startsWith("attainment") ? 2 : 0;
      side.append(h("p", { class: "compare__selection", text: `${metricLabel(st.metric)} · ${st.base}: ${num(selected.a[st.metric], decimals)} → ${st.compare}: ${num(selected.b[st.metric], decimals)}` }));
    }
    const search = h("input", { type: "search", placeholder: t("compare.search"), "aria-label": t("compare.search"), value: this.query || "" });
    side.append(search);
    const scroll = h("div", { class: "compare__scroll", tabindex: 0, "aria-label": t("compare.province_table") });
    const table = h("table", { class: "compare__table" }, h("thead", {}, h("tr", {},
      h("th", { text: t("compare.province") }), h("th", { text: st.base }), h("th", { text: st.compare }), h("th", { text: t("compare.delta") }))));
    const body = h("tbody"); table.append(body); scroll.append(table); side.append(scroll);
    const ordered = [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.province.localeCompare(b.province, "th"));
    const decimals = st.metric.startsWith("attainment") ? 2 : 0;
    const draw = () => {
      clear(body);
      for (const row of ordered.filter(r => !this.query || r.province.includes(this.query))) {
        const tr = h("tr", { tabindex: 0, "data-code": row.code, class: this.selected === row.code ? "is-selected" : "" },
          h("th", { scope: "row", text: row.province }), h("td", { text: num(row.a[st.metric], decimals) }),
          h("td", { text: num(row.b[st.metric], decimals) }), h("td", { class: row.delta > 0 ? "compare--positive" : row.delta < 0 ? "compare--negative" : "", text: sign(row.delta, decimals) }));
        bindTip(tr, () => this.tip(row)); this.selection(tr, row.code); body.append(tr);
      }
    };
    search.addEventListener("input", event => { this.query = event.target.value.trim(); draw(); }); draw();
    side.append(h("button", { type: "button", class: "btn btn--ghost", text: t("explore.download"), onclick: () => {
      const data = { columns: [{ key: "province", label: t("compare.province") }, { key: "base", label: st.base }, { key: "compare", label: st.compare }, { key: "difference", label: t("compare.delta") }],
        rows: rows.map(r => ({ province: r.province, base: r.a[st.metric], compare: r.b[st.metric], difference: r.delta })) };
      download(`comparison-${st.base}-${st.compare}-${st.year}-${st.metric}.csv`, toCSV(data, [metricLabel(st.metric), `release ${this.ctx.release.id}`, st.year === "all" ? t("compare.period_definition") : String(be(st.year)),
        st.metric === "rank" ? t("compare.rank_definition") : t("compare.map_note")]));
    } }));
  }

  gini(wrap) {
    const rows = this.ctx.release.rows(this.spec.gini_dataset || "c5_gini_final");
    const body = h("div", { class: "compare__body" }), plot = h("div", { class: "compare__plot" }), side = h("div", { class: "compare__side" });
    body.append(plot, side); wrap.append(body, h("p", { class: "compare__note", text: t("compare.gini_note") }));
    if (!rows.length) return;
    const max = Math.max(...rows.flatMap(r => [r.gini_p, r.gini_s]));
    const { svg, x, y } = this.plotAxes(plot, nice([0, max * 1.18], 5), 2, {
      x: t("compare.gini_x"), y: t("compare.gini_y"),
    });
    const labelOffsets = { "P-R": [-14, -21, "end"], "N-R": [0, -34, "start"],
      "NFB0.5-R": [-16, 40, "end"], "NFB1-R": [16, -12, "start"], "S-R": [13, 24, "start"], "SQ-C": [14, -16, "start"] };
    for (const [index, row] of rows.entries()) {
      const px = x(row.gini_p), py = y(row.gini_s);
      const [dx, dy, anchor] = row.label_offset || labelOffsets[row.plan] || [index % 2 ? -12 : 12, -18 - 18 * (index % 3), index % 2 ? "end" : "start"];
      const label = row.label || planLabel(row.plan);
      const point = s("g", { class: "compare__point", tabindex: 0, "aria-label": `${label}: ${num(row.gini_p, 3)}, ${num(row.gini_s, 3)}` },
        s("circle", { cx: px, cy: py, r: 8, style: `fill:${row.color || PLAN_COLOURS[Math.max(0, PLAN_KEYS.indexOf(row.plan))]}` }),
        s("line", { x1: px, y1: py + (dy < 0 ? -9 : 9), x2: px + dx, y2: py + dy + (dy < 0 ? 5 : -14), class: "compare__leader" }),
        s("text", { x: px + dx, y: py + dy, "text-anchor": anchor, class: "map-label", text: row.short_label || row.label || row.plan.replace("NFB", "N-FB ") }));
      bindTip(point, () => tipHTML(label, [[t("compare.gini_x"), num(row.gini_p, 3)], [t("compare.gini_y"), num(row.gini_s, 3)]])); svg.append(point);
    }
    side.append(h("h3", { text: t("compare.final_gini", { year: be(rows[0].year) }) }), giniTable(this.ctx.release, this.spec.gini_dataset),
      h("p", { class: "compare__selection", text: t("compare.gini_read") }));
  }

  destroy() { hideTip(); clear(this.el); }
}

export function giniTable(R, dataset = "c5_gini_final") {
  const table = h("table", { class: "gini-table" }, h("thead", {}, h("tr", {}, h("th", { text: t("compare.plan") }),
    h("th", { text: t("compare.population_short") }), h("th", { text: t("compare.service_short") }))));
  const rows = R.rows(dataset || "c5_gini_final"), body = h("tbody"); table.append(body);
  const minP = Math.min(...rows.map(r => r.gini_p)), minS = Math.min(...rows.map(r => r.gini_s));
  for (const row of rows) body.append(h("tr", {}, h("th", { scope: "row", text: row.label || row.plan.replace("NFB", "N-FB ") }),
    h("td", { class: row.gini_p === minP ? "is-lowest" : "", text: num(row.gini_p, 3) }),
    h("td", { class: row.gini_s === minS ? "is-lowest" : "", text: num(row.gini_s, 3) })));
  return table;
}
