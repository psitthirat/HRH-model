// Province stage: the unit the story follows. One <g> per province code keeps its
// identity while the layout moves between the equal-tile mosaic and the map, so
// a transition never implies that staff moved - only the drawing changes.
//
// fill modes
//   none        land colour (context)
//   density     sequential, ONE equal-interval domain across every year shown
//   membership  lowest-quartile group under the active denominator (categorical)
//   relative    R on a shared log2 scale around 1 (diverging), same scale on both maps
// Bangkok in the 76-province set is hatched "excluded by design" - never 0, never missing.

import { h, s, clear, tween, duration } from "../util/dom.js";
import { num, be } from "../util/format.js";
import { extent, nice, linear } from "../util/scale.js";
import { bindTip, tipHTML, legend, hideTip, textWidth } from "./core.js";
import { t, pin, caseLoc, uiLoc } from "../util/i18n.js";

const SEQ = [0, 1, 2, 3, 4, 5, 6].map((i) => `var(--seq-${i})`);
const RED_GREEN = ["#bd5b67", "#d48375", "#dfaf89", "#d6c9a1", "#9dbb9a", "#64ad97", "#26a58d"];
const DIV = ["var(--div-n3)", "var(--div-n2)", "var(--div-n1)", "var(--div-0)", "var(--div-p1)", "var(--div-p2)", "var(--div-p3)"];

// Descriptive categories from the six observed denominators. These are not
// clinical/context clusters: the exact six-bit pattern remains visible in tips.
export function provinceGroups(R) {
  const core = R.vocab.core_six;
  const rows = R.select("priority", { cadre: "physicians", scope: "moph" });
  const definitions = [
    { id: "all", label: t("group.all"), short: t("group.all_short"), color: "var(--member-strong)" },
    { id: "population", label: t("group.population"), short: t("group.population_short"), color: "var(--n-1)" },
    { id: "service", label: t("group.service"), short: t("group.service_short"), color: "var(--n-3)" },
    { id: "mixed", label: t("group.mixed"), short: t("group.mixed_short"), color: "var(--div-neg)" },
    { id: "none", label: t("group.none"), short: t("group.none_short"), color: "var(--map-land)" },
  ].map((g) => ({ ...g, codes: [] }));
  const groups = new Map(definitions.map((g) => [g.id, g])), byCode = new Map();
  const codes = [...R.provinces.values()].filter((p) => p.status_76 === "included").map((p) => p.prov_code);
  for (const code of codes) {
    const members = core.map((d) => rows.find((r) => r.prov_code === code && r.denominator === d)?.priority === true);
    const populationDenominators = new Set(["population", "entitlement", "age_scenario_moderate"]);
    const a = core.some((d, i) => populationDenominators.has(d) && members[i]);
    const b = core.some((d, i) => !populationDenominators.has(d) && members[i]);
    const id = members.every(Boolean) ? "all" : a && b ? "mixed" : a ? "population" : b ? "service" : "none";
    const group = groups.get(id);
    group.codes.push(code); byCode.set(code, { group, members });
  }
  for (const group of definitions) group.codes.sort((a, b) => R.provinceName(a).localeCompare(R.provinceName(b), "th"));
  return { definitions, byCode, core };
}

function contextPanels(R) {
  const grouping = provinceGroups(R);
  return { ...grouping, panels: [{ key: "context", title: "", value: (code) => grouping.byCode.get(code)?.group.id,
    fill: (code) => grouping.byCode.get(code)?.group.color,
    tip: (code) => { const r = grouping.byCode.get(code); return r ? [[t("group.tip"), r.group.label], ["", t("group.definitionTooltip")],
      ...grouping.core.map((d, i) => [R.shortLabel("denominator", d), r.members[i] ? t("map.matrix_in") : t("map.matrix_out")]) ] : []; } }], legend: null };
}

export const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

export function projector(bbox, w, h, pad = 10) {
  const [x0, y0, x1, y1] = bbox;
  const dx = ((x1 - x0) * Math.PI) / 180, dy = mercY(y1) - mercY(y0);
  const k = Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy);
  const ox = (w - dx * k) / 2, oy = (h - dy * k) / 2;
  const p = (lon, lat) => [ox + (((lon - x0) * Math.PI) / 180) * k, oy + (mercY(y1) - mercY(lat)) * k];
  return p;
}

export function pathFor(polygons, p) {
  let d = "";
  for (const poly of polygons) for (const ring of poly) {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = p(lon, lat);
      d += (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    });
    d += "Z";
  }
  return d;
}

export function hatchDefs(svg, id) {
  const defs = s("defs");
  const pat = s("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pat.append(s("rect", { width: 6, height: 6, class: "hatch-bg" }), s("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hatch-line" }));
  defs.append(pat);
  svg.append(defs);
}

// ---------------------------------------------------------------- data per panel
function densityPanels(R, spec) {
  const rows = R.select(spec.dataset, spec.filter);
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const pick = (y) => (y === "first" ? years[0] : y === "last" ? years[years.length - 1] : Number(y));
  const ys = (spec.years || ["last"]).map(pick).filter((y) => years.includes(y));
  const vcol = spec.value || "density_per_100k";
  const all = rows.filter((r) => ys.includes(r.year)).map((r) => r[vcol]);
  const dom = nice(extent(all), 6);
  const colors = spec.palette === "red_green" ? RED_GREEN : SEQ;
  const bins = colors.length;
  const edges = Array.from({ length: bins + 1 }, (_, i) => dom[0] + ((dom[1] - dom[0]) * i) / bins);
  const cls = (v) => (v == null ? -1 : Math.max(0, Math.min(bins - 1, Math.floor(((v - dom[0]) / (dom[1] - dom[0] || 1)) * bins))));
  const panels = ys.map((y) => {
    const by = new Map(rows.filter((r) => r.year === y).map((r) => [r.prov_code, r]));
    return {
      key: `y${y}`, title: t("chart.year_be", { y: be(y) }), year: y,
      value: (code) => by.get(code)?.[vcol],
      fill: (code) => { const c = cls(by.get(code)?.[vcol]); return c < 0 ? null : colors[c]; },
      tip: (code) => { const r = by.get(code); return r ? [[t("chart.year"), be(y)], [spec.value_label || t("chart.value"), num(r[vcol], 1)],
        [t("map.staff"), t("map.persons", { n: num(r.headcount, 0) })], [t("map.population"), t("map.persons", { n: num(r.population, 0) })]]
        : [[t("chart.year"), be(y)], [t("chart.value"), t("chart.no_data")]]; },
    };
  });
  const leg = { kind: "seq", edges, colors, title: t("map.seq_legend", { label: spec.value_label || "" }) };
  return { panels, legend: leg, rows, years: ys };
}

function sequentialPanels(R, spec) {
  const rows = R.select(spec.dataset, spec.filter);
  const by = new Map(rows.map((r) => [r.prov_code, r]));
  const vcol = spec.value;
  const dom = nice(extent(rows.map((r) => r[vcol])), 6);
  const bins = SEQ.length;
  const edges = Array.from({ length: bins + 1 }, (_, i) => dom[0] + ((dom[1] - dom[0]) * i) / bins);
  const cls = (v) => (v == null ? -1 : Math.max(0, Math.min(bins - 1, Math.floor(((v - dom[0]) / (dom[1] - dom[0] || 1)) * bins))));
  return {
    panels: [{ key: "seq", title: "", value: (code) => by.get(code)?.[vcol],
      fill: (code) => { const c = cls(by.get(code)?.[vcol]); return c < 0 ? null : SEQ[c]; },
      tip: (code) => { const r = by.get(code); return r ? [[spec.value_label || vcol, num(r[vcol], 2)]] : []; } }],
    legend: { kind: "seq", edges, colors: SEQ, title: t("map.seq_legend_one", { label: spec.value_label || vcol }) },
  };
}

function priorityData(R, spec) {
  const rows = R.select(spec.dataset || "priority", spec.filter);
  const byDen = new Map();
  for (const r of rows) {
    if (!byDen.has(r.denominator)) byDen.set(r.denominator, new Map());
    byDen.get(r.denominator).set(r.prov_code, r);
  }
  return { rows, byDen };
}

function membershipPanels(R, spec) {
  const { byDen } = priorityData(R, spec);
  const core = spec.denominators || R.vocab.core_six;
  const counts = new Map();
  for (const d of core) for (const [code, r] of byDen.get(d) || []) if (r.priority) counts.set(code, (counts.get(code) || 0) + 1);
  const den = spec.denominator || core[0];
  const all = (code) => counts.get(code) === core.length;
  let fill, title, legendItems;
  if (den === "intersection") {
    fill = (code) => (all(code) ? "var(--member-strong)" : counts.get(code) ? "var(--member-soft)" : null);
    title = t("map.title_all", { n: core.length });
    legendItems = [{ label: t("map.member_all"), color: "var(--member-strong)", shape: "square" },
      { label: t("map.member_any"), color: "var(--member-soft)", shape: "square" }];
  } else {
    const m = byDen.get(den) || new Map();
    fill = (code) => (m.get(code)?.priority ? "var(--member)" : null);
    title = t("map.title_den", { label: R.label("denominator", den) });
    legendItems = [{ label: t("map.member_one"), color: "var(--member)", shape: "square" }];
  }
  const tip = (code) => {
    const out = [];
    for (const d of core) {
      const r = byDen.get(d)?.get(code);
      if (!r) continue;
      out.push([R.shortLabel("denominator", d), t("map.rank_tip", { rank: r.rank, r: num(r.R, 2) }) + (r.priority ? t("map.in_group") : "") + (r.prob_priority != null ? t("province.bootstrap", { p: num(r.prob_priority * 100, 1) }) : "")]);
    }
    return out;
  };
  return {
    panels: [{ key: "m", title, fill, tip, value: (code) => counts.get(code) || 0 }],
    legend: { kind: "cat", items: legendItems, title: t("map.member_title") },
    counts, core, byDen, den,
  };
}

function relativePanels(R, spec) {
  const { byDen } = priorityData(R, spec);
  const pair = spec.pair || ["population"];
  const vals = [];
  for (const d of spec.scale_denominators || pair) for (const r of (byDen.get(d) || new Map()).values()) if (r.R > 0) vals.push(Math.abs(Math.log2(r.R)));
  const L = Math.max(0.25, Math.ceil(Math.max(...vals, 0.25) * 4) / 4);
  const bins = DIV.length;
  const cls = (v) => {
    if (!(v > 0)) return -1;
    const t = (Math.log2(v) + L) / (2 * L);
    return Math.max(0, Math.min(bins - 1, Math.floor(t * bins)));
  };
  const edges = Array.from({ length: bins + 1 }, (_, i) => Math.pow(2, -L + (2 * L * i) / bins));
  const panels = pair.map((d) => {
    const m = byDen.get(d) || new Map();
    return {
      key: `r_${d}`, title: t("map.title_pair", { label: R.shortLabel("denominator", d) }),
      value: (code) => m.get(code)?.R,
      fill: (code) => { const c = cls(m.get(code)?.R); return c < 0 ? null : DIV[c]; },
      tip: (code) => { const r = m.get(code); return r ? [[t("ribbon.den"), R.label("denominator", d)], ["R", num(r.R, 2)],
        [t("map.rank"), String(r.rank)]] : [["R", t("chart.no_data")]]; },
    };
  });
  return { panels, legend: { kind: "div", edges, colors: DIV, title: t("map.div_legend") } };
}

// ---------------------------------------------------------------- component
export class ProvinceStage {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.root = h("div", { class: "pstage" });
    this.legendEl = h("div", { class: "pstage__legend" });
    this.mapsEl = h("div", { class: "pstage__maps" });
    this.sideEl = h("div", { class: "pstage__side" });
    this.chipsEl = h("div", { class: "pstage__chips", "aria-live": "polite" });
    this.root.append(this.legendEl, h("div", { class: "pstage__body" }, this.mapsEl, this.sideEl), this.chipsEl);
    el.append(this.root);
    this.verificationEl = h("div", { class: "province-verification", hidden: true });
    el.append(this.verificationEl);
    this.svgs = [];
    this.layout = null;
    this.hatchId = "hatch-" + Math.random().toString(36).slice(2, 7);
  }

  update(spec, ctx) {
    this.ctx = ctx;
    const R = ctx.release;
    this.spec = spec;
    const verification = spec.fill === "verification";
    this.root.hidden = verification; this.verificationEl.hidden = !verification;
    if (verification) { this.drawVerification(spec); return; }
    const geoSet = spec.geo_set || "national_77";
    const excluded = (code) => geoSet !== "national_77" && R.provinces.get(code)?.status_76 === "excluded_by_design";
    let data;
    if (spec.fill === "context") data = contextPanels(R);
    else if (spec.fill === "density") data = densityPanels(R, spec);
    else if (spec.fill === "membership") data = membershipPanels(R, spec);
    else if (spec.fill === "relative") data = relativePanels(R, spec);
    else if (spec.fill === "sequential") data = sequentialPanels(R, spec);
    else data = { panels: [{ key: "base", title: "", fill: () => null, tip: () => [], value: () => null }], legend: null };
    this.data = data;

    // side panel
    const side = spec.side;
    const narrative = spec.side_placement === "narrative" && ctx.mode === "present" && window.innerWidth > 1100
      ? this.el.closest(".scene")?.querySelector(".scene__data-summary") : null;
    this.sideExternal = !!narrative;
    (narrative || this.root.querySelector(".pstage__body")).append(this.sideEl);
    this.sideEl.classList.toggle("pstage__side--narrative", this.sideExternal);
    this.root.classList.toggle("has-side", !!side && !this.sideExternal);
    this.root.classList.toggle("has-matrix", side === "matrix");
    this.root.classList.toggle("has-context", side === "context_groups");
    this.root.classList.toggle("has-discordance", side === "discordance");
    this.root.classList.toggle("has-change", side === "province_change");
    this.root.classList.toggle("two-panels", data.panels.length > 1);
    const focusedMatrixCode = ctx.resized && this.sideEl.contains(document.activeElement) ? document.activeElement.closest(".mx-row")?.dataset.code : null;
    const matrixScroll = this.sideEl.querySelector(".matrix-scroll");
    this.matrixScroll = matrixScroll ? { top: matrixScroll.scrollTop, left: matrixScroll.scrollLeft } : null;
    clear(this.sideEl);

    // legend
    clear(this.legendEl);
    const legItems = [];
    if (geoSet !== "national_77") legItems.push({ label: t("map.bangkok"), color: "var(--map-hatch)", shape: "hatch" });
    if (data.legend?.kind === "cat") this.legendEl.append(legend([...data.legend.items, ...legItems], { title: data.legend.title }));
    else if (data.legend) this.legendEl.append(rampLegend(data.legend), legItems.length ? legend(legItems) : "");
    else if (legItems.length) this.legendEl.append(legend(legItems));
    if (R.highlightCodes(spec).length) {
      this.legendEl.append(legend([{ label: t("chart.case_studies"), color: "var(--accent-soft)", shape: "ring" }]));
    }
    if (spec.fill === "none" && spec.layout === "tiles" && ctx.mode !== "present") {
      this.legendEl.append(pin(h("p", { class: "pstage__note", text: t("map.tile_note") }), uiLoc("map.tile_note")));
    }

    // maps (reuse SVGs so identities persist between steps and scenes)
    const n = data.panels.length;
    while (this.svgs.length > n) this.svgs.pop().wrap.remove();
    const { w: W, h: H } = this.sizes();
    const pw = n > 1 && !this.stackPanels ? Math.floor((W - 12) / n) : W;
    const ph = n > 1 && this.stackPanels ? Math.floor((H - 12) / n) : H;
    data.panels.forEach((panel, i) => {
      let P = this.svgs[i];
      if (!P) {
        const wrap = h("div", { class: "pstage__map" });
        const title = h("p", { class: "pstage__title" });
        const svg = s("svg", { class: "map-svg", role: "img" });
        hatchDefs(svg, this.hatchId + i);
        const g = s("g", { class: "provs" });
        const over = s("g", { class: "overlay" });
        svg.append(g, over);
        wrap.append(title, svg);
        this.mapsEl.append(wrap);
        P = { wrap, title, svg, g, over, nodes: new Map() };
        this.svgs[i] = P;
      }
      P.title.textContent = panel.title || "";
      P.title.hidden = !panel.title;
      this.drawPanel(P, panel, i, pw, ph - (panel.title ? 30 : 0), spec, excluded);
    });
    if (side === "province_dumbbell" && spec.fill === "density") this.drawDumbbell(data, spec);
    if (side === "matrix" && spec.fill === "membership") {
      this.drawMatrix(data, spec);
      if (focusedMatrixCode) requestAnimationFrame(() => this.sideEl.querySelector(`.mx-row[data-code="${focusedMatrixCode}"] .mx-name`)?.focus({ preventScroll: true }));
    }
    if (side === "context_groups") this.drawContextGroups(data, spec);
    if (side === "province_change") this.drawChangeRanking(data, spec);
    if (side === "discordance") this.drawDiscordance(spec);
    if (side === "case_list") this.drawCaseList(spec);
    this.drawChips(spec.chips || []);
  }

  sizes() {
    const r = this.el.getBoundingClientRect();
    const matrix = this.spec.side === "matrix";
    const matrixStacked = matrix && r.width < 760;
    const customSide = !this.sideExternal && ["context_groups", "discordance", "province_change"].includes(this.spec.side);
    const customStacked = customSide && r.width < 760;
    this.root.classList.toggle("province-side-stacked", customStacked);
    this.root.classList.toggle("matrix-stacked", matrixStacked);
    const side = this.sideExternal ? 0 : matrix ? (matrixStacked ? 0 : 0.58) : ["context_groups", "discordance", "province_change"].includes(this.spec.side) ? (r.width >= 760 ? 0.52 : 0) : this.spec.side ?
      (r.width > 980 || (this.spec.side === "province_dumbbell" && r.width >= 820) ? 0.36 : r.width > 640 ? 0.44 : 0) : 0;
    const legendH = this.legendEl.getBoundingClientRect().height || 40;
    const chipsH = (this.spec.chips || []).length ? 64 : 0;
    const W = Math.max(240, Math.floor(r.width * (1 - side)) - (side ? 16 : 0));
    const bodyH = Math.floor(r.height - legendH - chipsH - 12);
    const H = matrixStacked || customStacked ? Math.max(180, Math.floor(bodyH * 0.43)) : Math.max(260, bodyH);
    if (customStacked) this.root.style.setProperty("--province-map-h", `${H}px`);
    if (matrixStacked) this.root.style.setProperty("--matrix-map-h", `${H}px`);
    this.stackPanels = W < 520 && this.data?.panels.length > 1;
    this.root.classList.toggle("stacked", !!this.stackPanels);
    this.root.style.setProperty("--side-w", side ? `${Math.round(side * 100)}%` : "0px");
    return { w: W, h: H };
  }

  drawPanel(P, panel, idx, w, hgt, spec, excluded) {
    const R = this.ctx.release;
    const geo = R.geo;
    const layout = spec.layout || "map";
    // SVGs survive scene and reveal changes. Tooltips must read the current
    // panel instead of capturing the first year's data when a node is created.
    P.panel = panel;
    P.excluded = excluded;
    P.svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
    P.svg.setAttribute("width", w);
    P.svg.setAttribute("height", hgt);
    P.svg.setAttribute("aria-label", t("map.aria", { title: panel.title || t("map.aria_default"), kind: layout === "tiles" ? t("map.aria_tiles") : t("map.aria_map") }));
    const proj = projector(geo.bbox, w, hgt, 8);
    const cols = geo.tiles.cols, rows = geo.tiles.rows;
    const cell = Math.min((w - 16) / cols, (hgt - 16) / rows);
    const tx0 = (w - cell * cols) / 2, ty0 = (hgt - cell * rows) / 2;
    const dur = duration();
    const hatch = `url(#${this.hatchId}${idx})`;
    const cs = new Set(R.highlightCodes(spec));

    for (const p of geo.provinces) {
      let node = P.nodes.get(p.code);
      const d = pathFor(p.polygons, proj);
      const [lx, ly] = proj(...p.label_point);
      const tx = tx0 + p.tile[0] * cell + cell * 0.06, ty = ty0 + p.tile[1] * cell + cell * 0.06, ts = cell * 0.88;
      if (!node) {
        const g = s("g", { class: "prov", "data-code": p.code, tabindex: this.ctx.mode === "explore" ? 0 : -1 });
        const path = s("path", { d, class: "prov__shape" });
        const rect = s("rect", { class: "prov__tile", rx: Math.max(2, ts * 0.12) });
        if (layout === "tiles") { rect.setAttribute("x", tx); rect.setAttribute("y", ty); rect.setAttribute("width", ts); rect.setAttribute("height", ts); path.style.opacity = 0; }
        else { rect.setAttribute("x", lx); rect.setAttribute("y", ly); rect.setAttribute("width", 0); rect.setAttribute("height", 0); rect.style.opacity = 0; }
        g.append(path, rect);
        P.g.append(g);
        node = { g, path, rect };
        P.nodes.set(p.code, node);
        bindTip(g, () => tipHTML(this.ctx.release.provinceName(p.code), this.tipRows(p.code, P.panel, P.excluded)));
        g.addEventListener("click", () => this.ctx.onSelect?.(p.code));
      }
      node.path.setAttribute("d", d);
      node.g.setAttribute("tabindex", this.ctx.mode === "explore" ? 0 : -1);
      const isEx = excluded(p.code);
      const f = isEx ? hatch : panel.fill(p.code) || (spec.fill === "none" || spec.fill === "membership" ? "var(--map-land)" : "var(--map-excluded)");
      const missing = !isEx && !["none", "membership"].includes(spec.fill) && panel.fill(p.code) == null;
      for (const el of [node.path, node.rect]) {
        el.style.fill = f;
        el.classList.toggle("is-missing", missing);
        el.classList.toggle("is-excluded", isEx);
        el.classList.toggle("is-case", cs.has(p.code));
        el.classList.toggle("is-selected", (this.ctx.selected || []).includes(p.code));
      }
      node.g.classList.toggle("outlined", !!spec.outline);
      node.g.setAttribute("aria-label", `${p.name_th}${isEx ? t("map.excluded_suffix") : ""}`);
      if (layout === "tiles") {
        tween(node.rect, { x: tx, y: ty, width: ts, height: ts, opacity: 1 }, dur);
        tween(node.path, { opacity: 0 }, dur);
      } else {
        tween(node.rect, { x: lx, y: ly, width: 0, height: 0, opacity: 0 }, dur);
        tween(node.path, { opacity: 1 }, dur);
      }
      if (cs.has(p.code)) node.g.parentNode.append(node.g); // draw rings on top
    }
    this.drawOverlay(P, spec, proj, { tx0, ty0, cell, layout, idx, panels: this.data.panels.length }, excluded);
  }

  tipRows(code, panel, excluded) {
    if (excluded(code)) return [[t("map.status"), t("map.bangkok_tip")]];
    const rows = panel.tip(code) || [];
    const cs = this.ctx.release.caseByCode.get(code);
    if (cs && this.spec.fill === "none") rows.push([t("cards.role"), cs.role]);
    return rows.length ? rows : [[t("map.status"), this.spec.fill === "none" ? "—" : t("chart.no_data")]];
  }

  drawOverlay(P, spec, proj, t, excluded) {
    const R = this.ctx.release;
    clear(P.over);
    const geo = R.geo;
    if (spec.regions) {
      for (const reg of geo.regions) P.over.append(s("path", { class: "region-outline", d: pathFor(reg.polygons, proj) }));
    }
    let labelCodes = [];
    if (spec.labels === "case_studies") labelCodes = R.caseStudies;
    if (spec.labels === "highlight") labelCodes = R.highlightCodes(spec);
    if (spec.labels === "intersection" && this.data.counts) {
      labelCodes = [...this.data.counts].filter(([, n]) => n === this.data.core.length).map(([c]) => c);
    }
    const W = Number(P.svg.getAttribute("width"));
    const H = Number(P.svg.getAttribute("height"));
    const measureLabel = s("text", { class: "map-label" });
    P.over.append(measureLabel);
    const labelGap = Math.max(26, parseFloat(getComputedStyle(measureLabel).fontSize) * 1.65);
    // with two maps side by side, name the provinces once (on the right-hand map)
    if (t.panels > 1 && t.idx < t.panels - 1 && spec.labels !== "intersection") labelCodes = [];
    // west of centre -> label to the left, east -> to the right (flip if it would leave the drawing);
    // then spread labels on each side so none overlap
    const items = [];
    for (const code of labelCodes) {
      const p = R.geoByCode.get(code);
      if (!p) continue;
      let x, y;
      if (t.layout === "tiles") { x = t.tx0 + (p.tile[0] + 0.5) * t.cell; y = t.ty0 + (p.tile[1] + 0.5) * t.cell; }
      else [x, y] = proj(...p.label_point);
      measureLabel.textContent = p.name_th;
      const wText = measureLabel.getComputedTextLength();
      let right = x >= W * 0.5;
      if (right && x + 32 + wText > W - 4) right = false;
      if (!right && x - 32 - wText < 4) right = true;
      items.push({ p, x, y, ly: Math.max(labelGap / 2, Math.min(H - labelGap / 2, y)), right, wText });
    }
    measureLabel.remove();
    for (const side of [true, false]) {
      const col = items.filter((it) => it.right === side).sort((a, b) => a.y - b.y);
      for (let k = 1; k < col.length; k++) if (col[k].ly - col[k - 1].ly < labelGap) col[k].ly = col[k - 1].ly + labelGap;
      if (col.length && col[col.length - 1].ly > H - labelGap / 2) {
        col[col.length - 1].ly = H - labelGap / 2;
        for (let k = col.length - 2; k >= 0; k--) col[k].ly = Math.min(col[k].ly, col[k + 1].ly - labelGap);
      }
    }
    // On a narrow map both label columns can extend into the same space.
    // Resolve these cross-column collisions after clamping text to the SVG.
    for (const it of items) {
      it.lx = it.right ? Math.min(it.x + 28, W - it.wText - 8) : Math.max(it.x - 28, it.wText + 8);
      it.left = it.right ? it.lx + 4 : it.lx - 4 - it.wText;
      it.rightEdge = it.left + it.wText;
    }
    const ordered = [...items].sort((a, b) => a.ly - b.ly);
    ordered.forEach((it, i) => {
      for (const before of ordered.slice(0, i)) {
        if (it.left < before.rightEdge + 8 && it.rightEdge > before.left - 8) it.ly = Math.max(it.ly, before.ly + labelGap);
      }
    });
    const overflow = Math.max(0, ...items.map((it) => it.ly + labelGap / 2 - H));
    if (overflow) for (const it of items) it.ly -= overflow;
    for (const it of items) {
      const lx = it.lx;
      P.over.append(s("path", { class: "leader", d: `M${it.x},${it.y} L${it.right ? lx - 8 : lx + 8},${it.ly} L${lx},${it.ly}`, fill: "none" }));
      P.over.append(s("text", { class: "map-label", x: it.right ? lx + 4 : lx - 4, y: it.ly, "text-anchor": it.right ? "start" : "end",
        "dominant-baseline": "middle", text: it.p.name_th }));
    }
  }

  drawChips(chips) {
    clear(this.chipsEl);
    for (const c of chips) this.chipsEl.append(h("span", { class: "chip", text: c }));
  }

  drawDumbbell(data, spec) {
    const R = this.ctx.release;
    const [pA, pB] = data.panels;
    const codes = [...R.provinces.values()].filter((p) => p.status_76 === "included").map((p) => p.prov_code);
    const last = pB || pA;
    codes.sort((a, b) => (last.value(b) ?? -1) - (last.value(a) ?? -1));
    const leg = legend(pB ? [{ label: pA.title, color: "var(--text-muted)", shape: "ring" }, { label: pB.title, color: "var(--seq-5)", shape: "dot" }]
      : [{ label: pA.title, color: "var(--seq-5)", shape: "dot" }]);
    this.sideEl.append(leg);
    const r = this.sideEl.getBoundingClientRect();
    const w = Math.max(220, r.width || 320), hh = Math.max(220, (r.height || 500) - leg.getBoundingClientRect().height - 8);
    const svg = s("svg", { class: "side-svg", width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, role: "img",
      "aria-label": t("map.dumbbell_aria") });
    this.sideEl.append(svg);
    const cs = new Set(R.highlightCodes(spec)); // names only for the provinces the step points at
    const labelWidth = textWidth(svg, [...cs].map((code) => R.provinceName(code)), "db-name");
    const m = { l: Math.max(24, Math.ceil(labelWidth) + 12), r: 16, t: 30, b: 34 };
    const vals = data.panels.flatMap((p) => codes.map((c) => p.value(c)));
    const [lo, hi] = nice(extent(vals), 4);
    const x = (v) => m.l + ((v - lo) / (hi - lo || 1)) * (w - m.l - m.r);
    const step = (hh - m.t - m.b) / codes.length;
    svg.append(s("text", { class: "axis-label", x: 0, y: 14, text: spec.value_label || "" }));
    for (const tv of [lo, (lo + hi) / 2, hi]) {
      svg.append(s("line", { class: "grid", x1: x(tv), x2: x(tv), y1: m.t - 6, y2: hh - m.b }));
      svg.append(s("text", { class: "tick", x: x(tv), y: hh - m.b + 16, "text-anchor": "middle", text: num(tv, 0) }));
    }
    codes.forEach((code, i) => {
      const y = m.t + i * step + step / 2;
      const a = pA.value(code), b = pB ? pB.value(code) : null;
      const g = s("g", { class: "db-row" + (cs.has(code) ? " is-case" : ""), tabindex: -1 });
      if (b != null && a != null) g.append(s("line", { class: "db-line", x1: x(a), x2: x(b), y1: y, y2: y }));
      if (a != null) g.append(s("circle", { class: pB ? "db-a" : "db-b", cx: x(a), cy: y, r: Math.min(3.5, step * 0.45 + 1) }));
      if (b != null) g.append(s("circle", { class: "db-b", cx: x(b), cy: y, r: Math.min(3.5, step * 0.45 + 1) }));
      if (cs.has(code)) g.append(s("text", { class: "db-name", x: m.l - 6, y, "text-anchor": "end", "dominant-baseline": "middle", text: R.provinceName(code) }));
      g.append(s("rect", { class: "hit", x: 0, y: y - step / 2, width: w, height: step }));
      bindTip(g, () => tipHTML(R.provinceName(code), data.panels.map((p) => [p.title, num(p.value(code), 1)])));
      svg.append(g);
    });
  }

  drawMatrix(data, spec) {
    const R = this.ctx.release;
    const core = data.core;
    const rows = [...data.counts.entries()].sort((a, b) => b[1] - a[1] ||
      (data.byDen.get(core[0])?.get(a[0])?.rank ?? 99) - (data.byDen.get(core[0])?.get(b[0])?.rank ?? 99)).map(([c]) => c);
    const cs = new Set(R.highlightCodes(spec).length ? R.highlightCodes(spec) : R.caseStudies);
    const table = h("table", { class: "matrix matrix-table",
      "aria-label": t("map.matrix_aria", { n: rows.length, k: core.length }) });
    const header = h("tr", {}, h("th", { class: "mx-province", scope: "col", text: t("map.province") }));
    core.forEach((d) => {
      const active = spec.denominator === d || spec.denominator === "intersection";
      const label = R.shortLabel("denominator", d);
      const th = h("th", { class: "mx-head" + (active ? " is-active" : ""), scope: "col",
        title: R.label("denominator", d) });
      // Keep this familiar Thai term together when a narrow column wraps.
      const suffix = "ผู้ป่วยนอก";
      if (label.endsWith(suffix)) th.append(label.slice(0, -suffix.length), h("wbr"), h("span", { class: "mx-term", text: suffix }));
      else th.textContent = label;
      header.append(th);
    });
    table.append(h("thead", {}, header));
    const tbody = h("tbody");
    rows.forEach((code) => {
      const all = data.counts.get(code) === core.length;
      const row = h("tr", { class: "mx-row" + (cs.has(code) ? " is-case" : "") + (all ? " is-all" : ""), "data-code": code });
      const name = h("button", { class: "mx-name", type: "button", text: R.provinceName(code),
        onclick: () => this.ctx.onSelect?.(code) });
      row.append(h("th", { scope: "row" }, name));
      core.forEach((d) => {
        const rr = data.byDen.get(d)?.get(code);
        const on = rr?.priority;
        const status = rr ? (on ? t("map.matrix_in") : t("map.matrix_out")) + (rr.near_cutoff ? t("map.near_cut") : "") : t("chart.no_data");
        row.append(h("td", { class: spec.denominator === d || spec.denominator === "intersection" ? "mx-active-column" : "", "aria-label": status },
          h("span", { class: "mx-cell" + (on ? " on" : "") + (rr?.near_cutoff ? " near" : ""), "aria-hidden": "true" })));
      });
      const tip = () => tipHTML(R.provinceName(code), core.map((d) => {
        const rr = data.byDen.get(d)?.get(code);
        return [R.shortLabel("denominator", d), rr ? t("map.rank_tip", { rank: rr.rank, r: num(rr.R, 2) }) + (rr.priority ? t("map.in_group") : "") + (rr.near_cutoff ? t("map.near_cut") : "") + (rr.prob_priority != null ? t("province.bootstrap", { p: num(rr.prob_priority * 100, 1) }) : "") : "—"];
      }));
      bindTip(row, tip);
      bindTip(name, tip);
      tbody.append(row);
    });
    table.append(tbody);
    const scroll = h("div", { class: "matrix-scroll", tabindex: "0", role: "region",
      "aria-label": t("map.matrix_aria", { n: rows.length, k: core.length }) }, table);
    // Navigation keys operate on the focused table without advancing a slide.
    scroll.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.stopPropagation();
    });
    scroll.addEventListener("scroll", () => {
      hideTip();
      // Focusing an off-screen row scrolls it into view after its focus event.
      // Restore that keyboard tooltip at its new position on the next frame.
      const focused = document.activeElement;
      if (scroll.contains(focused) && focused.matches(".mx-name")) requestAnimationFrame(() => {
        if (focused === document.activeElement && focused.isConnected) focused.dispatchEvent(new FocusEvent("focus"));
      });
    }, { passive: true });
    this.sideEl.append(h("p", { class: "matrix-active-label", text: spec.denominator === "intersection" ? t("province.matrix_all") : t("province.matrix_active", { label: R.label("denominator", spec.denominator || core[0]) }) }),
      h("p", { class: "side-note", text: t("map.matrix_note", { n: rows.length }) }),
      h("p", { class: "matrix-help", text: t("map.matrix_scroll") }), scroll);
    if (this.matrixScroll) {
      scroll.scrollTop = this.matrixScroll.top;
      scroll.scrollLeft = this.matrixScroll.left;
    }
  }

  drawContextGroups(data, spec) {
    const R = this.ctx.release;
    const list = h("div", { class: "context-groups", tabindex: "0", role: "region", "aria-label": t("group.aria") });
    list.append(h("p", { class: "context-definition", text: t("group.definition") }));
    for (const group of data.definitions) {
      const box = h("section", { class: "context-group", "data-group": group.id });
      box.style.setProperty("--group-color", group.color);
      const heading = h("h3", { tabindex: "0" }, h("span", { class: "context-swatch", "aria-hidden": "true" }), group.label,
        h("span", { class: "context-count", text: t("group.count", { n: group.codes.length }) }));
      bindTip(heading, () => tipHTML(group.label, [["", t("group.definitionTooltip")]]));
      box.append(heading);
      if (spec.context_representatives) {
        const cases = group.codes.filter((code) => R.caseByCode.has(code));
        const names = h("p", { class: "context-representative" });
        for (const [index, code] of cases.entries()) {
          if (index) names.append(" · ");
          const name = h("button", { class: "province-name-button", type: "button", text: R.provinceName(code), onclick: () => this.ctx.onSelect?.(code) });
          bindTip(name, () => tipHTML(R.provinceName(code), [[t("cards.role"), R.caseByCode.get(code).role], ...data.panels[0].tip(code)]));
          names.append(name);
        }
        box.append(names);
      }
      const detail = h("details", { class: "context-members", open: this.ctx.mode === "print" }, h("summary", { text: t("group.members") }));
      const names = h("p");
      group.codes.forEach((code, i) => { if (i) names.append(" · ");
        const name = h("button", { type: "button", class: "province-name-button", text: R.provinceName(code), onclick: () => this.ctx.onSelect?.(code) });
        bindTip(name, () => tipHTML(R.provinceName(code), data.panels[0].tip(code))); names.append(name); });
      detail.append(names); box.append(detail); list.append(box);
    }
    stopScrollNavigation(list); this.sideEl.append(list);
  }

  drawChangeRanking(data, spec) {
    const R = this.ctx.release;
    const [a, b] = data.panels;
    if (!a || !b) return;
    const rows = [...R.provinces.values()].filter((r) => r.status_76 === "included")
      .map((r) => ({ code: r.prov_code, a: a.value(r.prov_code), b: b.value(r.prov_code) }))
      .filter((r) => r.a != null && r.b != null).map((r) => ({ ...r, delta: r.b - r.a }))
      .sort((a, b) => b.delta - a.delta || a.code.localeCompare(b.code));
    const cases = new Set(R.highlightCodes(spec));
    this.sideEl.append(h("h3", { class: "province-table-title", text: t("province.change_title") }),
      h("p", { class: "side-note", text: t("province.change_note", { b: b.title, a: a.title, unit: spec.value_label || "" }) }));
    const table = h("table", { class: "province-table change-ranking", "aria-label": t("province.change_aria") });
    table.append(h("thead", {}, h("tr", {}, ...[t("province.rank"), t("province.name"), a.title, b.title, t("province.delta")].map((label) => h("th", { scope: "col", text: label })))));
    const tbody = h("tbody");
    const deltaMax = Math.max(...rows.map(r => Math.abs(r.delta)), 1e-9);
    // Density cells use the exact shared map colour bins. Changes have their
    // own continuous, symmetric scale about zero; values and ranks stay intact.
    const changeColor = value => {
      const neutral = [214, 201, 161], end = value >= 0 ? [38, 165, 141] : [189, 91, 103];
      const u = Math.min(1, Math.abs(value) / deltaMax);
      return `rgb(${neutral.map((n, i) => Math.round(n + (end[i] - n) * u)).join(",")})`;
    };
    let rank = 0, prev;
    rows.forEach((r, i) => { if (prev !== r.delta) rank = i + 1; prev = r.delta;
      const row = h("tr", { class: cases.has(r.code) ? "is-case" : "", "data-code": r.code }, h("td", { text: rank }),
        h("th", { scope: "row" }, h("button", { class: "province-name-button", type: "button", text: R.provinceName(r.code), onclick: () => this.ctx.onSelect?.(r.code) })),
        h("td", { text: num(r.a, 1) }), h("td", { text: num(r.b, 1) }), h("td", { class: "change-value", text: `${r.delta > 0 ? "+" : ""}${num(r.delta, 1)}` }));
      row.children[2].style.color = a.fill(r.code);
      row.children[3].style.color = b.fill(r.code);
      row.children[4].style.color = changeColor(r.delta);
      tbody.append(row);
    });
    table.append(tbody);
    const scroll = h("div", { class: "province-table-scroll", tabindex: "0", role: "region", "aria-label": t("province.change_scroll") }, table);
    stopScrollNavigation(scroll); this.sideEl.append(scroll);
  }

  drawDiscordance(spec) {
    const R = this.ctx.release;
    const { byDen } = priorityData(R, spec);
    const [base, service] = spec.pair;
    if (!base || !service) return;
    const pop = byDen.get(base), srv = byDen.get(service);
    const groups = [[], [], [], []]; // both below, pop-only below, service-only below, neither below
    for (const [code, row] of pop || []) {
      const other = srv?.get(code); if (row.R == null || other?.R == null) continue;
      groups[(row.R < 1 ? 0 : 2) + (other.R < 1 ? 0 : 1)].push(code);
    }
    const discordant = groups[1].length + groups[2].length;
    const total = groups.flat().length;
    const serviceLabel = R.shortLabel("denominator", service);
    this.sideEl.append(h("p", { class: "discordance-summary" },
      h("strong", { text: `${discordant} / ${total}` }), t("province.disc_summary")),
      h("p", { class: "side-note", text: t("province.disc_note", { label: serviceLabel }) }));
    const table = h("table", { class: "discordance-table", "aria-label": t("province.disc_aria", { label: serviceLabel }) });
    table.append(h("thead", {}, h("tr", {}, h("th", { scope: "col", text: t("province.disc_base") }),
      h("th", { scope: "col", text: "R < 1" }), h("th", { scope: "col", text: "R ≥ 1" }))));
    const tbody = h("tbody");
    for (let i = 0; i < 2; i++) {
      const row = h("tr", {}, h("th", { scope: "row", text: i === 0 ? "R < 1" : "R ≥ 1" }));
      for (let j = 0; j < 2; j++) {
        const idx = i * 2 + j, codes = groups[idx];
        const td = h("td", { class: idx === 1 || idx === 2 ? "is-discordant" : "" }, h("strong", { text: codes.length }), h("span", { text: t("province.count_suffix") }));
        const details = h("details", { open: this.ctx.mode === "print" }, h("summary", { text: t("province.disc_names") }), h("p", { text: codes.map((c) => R.provinceName(c)).sort((a, b) => a.localeCompare(b, "th")).join(" · ") || "—" }));
        td.append(details); row.append(td);
      }
      tbody.append(row);
    }
    table.append(tbody);
    const scroll = h("div", { class: "discordance-scroll", tabindex: "0", role: "region", "aria-label": t("province.disc_scroll") }, table);
    stopScrollNavigation(scroll); this.sideEl.append(scroll);
    this.sideEl.append(h("p", { class: "discordance-key", text: t("province.disc_key") }));
  }

  drawVerification(spec) {
    const R = this.ctx.release;
    clear(this.verificationEl); hideTip();
    const rows = R.rows(spec.dataset || "province_verification");
    const sourceCases = new Set(spec.highlight?.length ? R.highlightCodes(spec) : ["38", "96", "13"]);
    const panels = [
      { title: t("province.verify_phys"), x: "pop_per_physician", y: "op_per_physician", xl: t("province.verify_phys_x"), yl: t("province.verify_phys_y"), color: "var(--c-physicians)", rays: true },
      { title: t("province.verify_nurse"), x: "pop_per_nurse", y: "ipdays_per_nurse", xl: t("province.verify_nurse_x"), yl: t("province.verify_nurse_y"), color: "var(--c-professional_nurses)", rays: false },
    ];
    for (const panel of panels) {
      const facet = h("section", { class: "verification-panel" }, h("h3", { text: panel.title }), h("p", { class: "verification-y-label", text: panel.yl }));
      const plot = h("div", { class: "verification-plot" }); facet.append(plot, h("p", { class: "verification-x-label", text: panel.xl }));
      this.verificationEl.append(facet);
      const box = plot.getBoundingClientRect(), W = Math.max(280, box.width), H = Math.max(180, box.height);
      const svg = s("svg", { class: "chart-svg verification-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("province.verify_aria", { x: panel.xl, y: panel.yl }) }); plot.append(svg);
      const rawX = extent(rows.map((r) => r[panel.x])), rawY = extent(rows.map((r) => r[panel.y]));
      const domainX = nice([rawX[0] * .9, rawX[1] * 1.05], 5);
      const domainY = nice([rawY[0] * .9, panel.rays ? Math.max(rawY[1] * 1.05, rawX[1] * 1.05 * 3) : rawY[1] * 1.05], 5);
      const yLabels = linear(domainY, [0, 1]).ticks(5).map((v) => num(v, 0));
      const xLabels = linear(domainX, [0, 1]).ticks(4).map((v) => num(v, 0));
      const m = { l: Math.ceil(textWidth(svg, yLabels, "tick")) + 14, r: Math.max(20, Math.ceil(textWidth(svg, xLabels, "tick") / 2) + 8), t: 25, b: 36 };
      const x = linear(domainX, [m.l, W - m.r]), y = linear(domainY, [H - m.b, m.t]);
      for (const tk of x.ticks(4)) { svg.append(s("line", { class: "grid", x1: x(tk), x2: x(tk), y1: m.t, y2: H - m.b }), s("text", { class: "tick", x: x(tk), y: H - 10, "text-anchor": "middle", text: num(tk, 0) })); }
      for (const tk of y.ticks(5)) { svg.append(s("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(tk), y2: y(tk) }), s("text", { class: "tick", x: m.l - 8, y: y(tk), "text-anchor": "end", "dominant-baseline": "middle", text: num(tk, 0) })); }
      if (panel.rays) for (const k of [1, 2, 3]) {
        const a = Math.max(domainX[0], domainY[0] / k), b = Math.min(domainX[1], domainY[1] / k);
        svg.append(s("line", { class: "ref-line verification-ray", x1: x(a), y1: y(k * a), x2: x(b), y2: y(k * b) }),
          s("text", { class: "ref-label", x: x(b) - 5, y: Math.max(m.t + 16, y(k * b) - 7), "text-anchor": "end", text: t("province.verify_ray", { n: k }) }));
      }
      const placedLabels = [];
      for (const r of [...rows].sort((a, b) => Number(sourceCases.has(a.prov_code)) - Number(sourceCases.has(b.prov_code)))) {
        const selected = sourceCases.has(r.prov_code), px = x(r[panel.x]), py = y(r[panel.y]);
        const g = s("g", { class: "verification-point" + (selected ? " is-case" : ""), tabindex: 0, "data-code": r.prov_code, "aria-label": `${R.provinceName(r.prov_code)}: ${num(r[panel.x], 1)}, ${num(r[panel.y], 1)}` });
        g.append(s("circle", { class: "hit-c", cx: px, cy: py, r: 11 }), s("circle", { class: "verification-dot", cx: px, cy: py, r: selected ? 6 : 4, fill: selected ? "var(--div-neg)" : panel.color }));
        if (selected) {
          const label = s("text", { class: "map-label", x: px + 10, y: py - 10, text: R.provinceName(r.prov_code) }); g.append(label); svg.append(g);
          if (label.getBBox().x + label.getBBox().width > W - 4) { label.setAttribute("x", px - 10); label.setAttribute("text-anchor", "end"); }
          for (let attempt = 0; attempt < 5; attempt++) {
            const bb = label.getBBox();
            const overlap = placedLabels.some((other) => bb.x < other.x + other.width + 6 && bb.x + bb.width > other.x - 6 && bb.y < other.y + other.height + 4 && bb.y + bb.height > other.y - 4);
            if (!overlap) break;
            label.setAttribute("y", Math.max(m.t + bb.height, Number(label.getAttribute("y")) - bb.height - 6));
          }
          placedLabels.push(label.getBBox());
        }
        bindTip(g, () => tipHTML(R.provinceName(r.prov_code), [[panel.xl, num(r[panel.x], 2)], [panel.yl, num(r[panel.y], 2)], [t("province.verify_op_pp"), num(r.op_per_person, 2)]]));
        g.addEventListener("click", () => this.ctx.onSelect?.(r.prov_code)); svg.append(g);
      }
    }
  }

  // S02: who the case studies are and what each one shows (text from [[case_study]] in scenes.toml)
  drawCaseList(spec) {
    const R = this.ctx.release;
    const ol = h("ol", { class: "case-list" });
    for (const c of R.cases) {
      ol.append(pin(h("li", { class: "case-list__item" + (c.role_ok ? "" : " is-off") },
        h("strong", { text: c.name }), h("span", { text: c.role }),
        c.role_ok ? "" : h("em", { text: t("cards.role_off") })), caseLoc(c.key)));
    }
    this.sideEl.append(h("h3", { class: "case-list__title", text: t("map.cases_title") }), ol);
  }

  destroy() { hideTip(); this.sideEl.remove(); this.root.remove(); this.verificationEl.remove(); }
}

function stopScrollNavigation(el) {
  el.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.stopPropagation();
  });
}

function rampLegend(L) {
  const el = h("div", { class: "ramp", role: "img", "aria-label": L.title });
  el.append(h("span", { class: "legend__title", text: L.title }));
  const bar = h("div", { class: "ramp__bar" });
  L.colors.forEach((c) => { const sw = h("span", { class: "ramp__step" }); sw.style.background = c; bar.append(sw); });
  const labels = h("div", { class: "ramp__labels" });
  const fmt = (v) => (L.kind === "div" ? num(v, 2) : num(v, v >= 100 ? 0 : 1));
  const idx = L.kind === "div" ? [0, 2, 3.5, 5, 7] : [0, 7];
  for (const i of idx) {
    const v = L.kind === "div" && i === 3.5 ? 1 : L.edges[Math.round(i)];
    const lab = h("span", { text: fmt(v) });
    lab.style.left = `${(i / 7) * 100}%`;
    labels.append(lab);
  }
  el.append(bar, labels);
  return el;
}

// Small health-region map for insets (Theil between/within).
export function regionsInset(container, R, { width = 150, height = 250 } = {}) {
  const svg = s("svg", { class: "inset-svg", width, height, viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-label": t("map.regions_aria") });
  const proj = projector(R.geo.bbox, width, height, 4);
  for (const p of R.geo.provinces) svg.append(s("path", { class: "inset-prov", d: pathFor(p.polygons, proj) }));
  for (const reg of R.geo.regions) svg.append(s("path", { class: "region-outline", d: pathFor(reg.polygons, proj) }));
  container.append(h("figure", { class: "inset" }, svg, h("figcaption", { text: t("map.regions_caption") })));
}
