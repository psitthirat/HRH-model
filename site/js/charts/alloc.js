// Allocation viewer: the explicit annual plan, province by province.
//
// A reader picks a plan and a year (or all years together); the map shades every
// province by the number of new physicians it receives, and the table beside it lists
// all provinces with the same year's number under every plan, so the plans can be
// compared line by line. One colour scale per year is shared by all plans, so a
// darker province always means more physicians, whichever plan is shown.
// The scene step sets the starting plan/year; buttons change them locally.

import { h, s, clear } from "../util/dom.js";
import { num, be } from "../util/format.js";
import { nice } from "../util/scale.js";
import { bindTip, tipHTML, hideTip, colorSpec, legend } from "./core.js";
import { projector, pathFor } from "./provinces.js";
import { t } from "../util/i18n.js";

const SEQ = [0, 1, 2, 3, 4, 5, 6].map((i) => `var(--seq-${i})`);

// One selector feeds the map, its tooltips and chart-data downloads.
export function selectAllocations(rows, plans, year) {
  const out = new Map(plans.map(p => [p.key, new Map()]));
  const years = [...new Set(rows.map(r => r.year))].sort((a,b) => a-b);
  const first = years[0], last = years.at(-1);
  for (const r of rows) {
    const m=out.get(r.plan);if(!m)continue;
    if(year!=='all'){if(r.year===year)m.set(r.prov_code,{...r});continue;}
    const cur=m.get(r.prov_code)||{...r,x:0,departures:0};cur.x+=r.x;
    if(r.year===first)cur.opening=r.opening;
    if(r.year===last){cur.closing=r.closing;cur.attainment_pop=r.attainment_pop;}
    cur.departures+=r.departures;
    cur.year=r.year;m.set(r.prov_code,cur);
  }
  return out;
}
export function allocationFigureRows(rows, plans, plan, year) {
  const years=[...new Set(rows.map(r=>r.year))].sort((a,b)=>a-b),all=year==='all';
  return [...(selectAllocations(rows,plans,year).get(plan)?.values()||[])].map(r=>({plan:r.plan,prov_code:r.prov_code,province:r.province,
    period:all?'cumulative':'annual',year_ce:all?null:year,first_year_ce:all?years[0]:year,last_year_ce:all?years.at(-1):year,
    appointments:r.x,opening_stock:r.opening,departures:r.departures,closing_stock:r.closing,attainment_population:r.attainment_pop,
    cap_binding:all?null:r.cap_binding,floor_only:all?null:r.floor_only}));
}

export class Alloc {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.key = null;
    this.state = null;
    this.timer = null;
    this.hot = null;
  }

  update(spec, ctx) {
    this.ctx = ctx;
    this.spec = spec;
    const key = JSON.stringify([spec.dataset, spec.plan, spec.year]);
    if (key !== this.key || !this.state) {
      this.key = key;
      this.state = { plan: spec.plan || spec.plans[0].key, year: spec.year ?? "all" };
    }
    this.stop();
    const R = ctx.release;
    this.rows = R.select(spec.dataset, spec.filter);
    this.years = [...new Set(this.rows.map((r) => r.year))].sort((a, b) => a - b);
    this.render();
  }

  // values for the current year (or all years) under every plan: plan -> code -> record
  table() {
    return selectAllocations(this.rows,this.spec.plans,this.state.year);
  }

  figureData(){return {rows:allocationFigureRows(this.rows,this.spec.plans,this.state.plan,this.state.year),selection:{plan:this.state.plan,year:this.state.year}};}

  render() {
    const R = this.ctx.release;
    const spec = this.spec;
    const st = this.state;
    const plans = spec.plans;
    const planOf = (k) => plans.find((p) => p.key === k);
    const data = this.table();
    const cur = data.get(st.plan);
    const keepSliderFocus = document.activeElement?.matches(".alloc__years input") && this.el.contains(document.activeElement);
    const renderKey = `${st.plan}|${st.year}`;
    const oldScroll = this.el.querySelector(".alloc__scroll");
    const scrollTop = this.renderedKey === renderKey ? oldScroll?.scrollTop || 0 : 0;
    this.renderedKey = renderKey;
    clear(this.el);
    hideTip();
    const wrap = h("div", { class: "alloc" + (this.el.getBoundingClientRect().width < 900 ? " alloc--narrow" : "") });
    this.el.append(wrap);
    if (spec.banner) wrap.append(h("p", { class: "chart-banner", text: spec.banner }));

    // ---------------------------------------------------------- controls
    const bar = h("div", { class: "alloc__bar" });
    const seg = h("div", { class: "alloc__plans", role: "group", "aria-label": t("alloc.plans") });
    for (const p of plans) {
      const b = h("button", { type: "button", class: "alloc__plan" + (p.key === st.plan ? " is-on" : ""),
        "aria-pressed": p.key === st.plan ? "true" : "false", style: `--pc:${colorSpec(p.color)}`,
        onclick: () => { this.stop(); st.plan = p.key; this.render(); } },
        h("span", { class: "alloc__dot" }), h("span", { text: p.label }));
      seg.append(b);
    }
    bar.append(seg);
    const yr = h("div", { class: "alloc__years" });
    const first = this.years[0], last = this.years[this.years.length - 1];
    const slider = h("input", { type: "range", min: first, max: last, step: 1, value: st.year === "all" ? last : st.year,
      "aria-label": t("alloc.year"), class: st.year === "all" ? "is-dim" : "",
      oninput: (e) => { this.stop(); st.year = Number(e.target.value); this.render(); } });
    const out = h("output", { class: "alloc__yearlabel",
      text: st.year === "all" ? t("alloc.all_label", { a: be(first), b: be(last) }) : t("alloc.year_label", { y: be(st.year) }) });
    const play = h("button", { type: "button", class: "btn", text: this.timer ? t("alloc.pause") : t("alloc.play"),
      onclick: () => { if (this.timer) { this.stop(); this.render(); } else this.play(); } });
    const all = h("button", { type: "button", class: "btn" + (st.year === "all" ? " btn--primary" : ""), text: t("alloc.all_years"),
      "aria-pressed": st.year === "all" ? "true" : "false", onclick: () => { this.stop(); st.year = "all"; this.render(); } });
    yr.append(h("span", { class: "alloc__lab", text: t("alloc.year") }), slider, out, play, all);
    bar.append(yr);
    wrap.append(bar);

    // ---------------------------------------------------------- body
    const body = h("div", { class: "alloc__body" });
    // The note takes part in flex sizing before we measure the map. Appending
    // it later shrinks the SVG box but leaves a larger, stale viewBox behind.
    wrap.append(body, h("p", { class: "chart-note", text: t("alloc.note") }));
    const mapBox = h("div", { class: "alloc__map" });
    const side = h("div", { class: "alloc__side" });
    body.append(mapBox, side);

    // one scale for all plans in the shown year
    let vmax = 0;
    for (const m of data.values()) for (const r of m.values()) vmax = Math.max(vmax, r.x);
    const dom = nice([0, Math.max(1, vmax)], SEQ.length);
    const bin = (v) => Math.max(0, Math.min(SEQ.length - 1, Math.floor((v / (dom[1] || 1)) * SEQ.length)));
    const leg = h("div", { class: "alloc__legend" }, h("span", { class: "legend__title",
      text: st.year === "all" ? t("alloc.legend_all") : t("alloc.legend") }));
    const ramp = h("span", { class: "alloc__ramp" });
    SEQ.forEach((c, i) => ramp.append(h("span", { style: `background:${c}`, title: `${num((dom[1] * i) / SEQ.length, 0)}–${num((dom[1] * (i + 1)) / SEQ.length, 0)}` })));
    leg.append(h("span", { class: "tick", text: "0" }), ramp, h("span", { class: "tick", text: num(dom[1], 0) }),
      legend([{ label: t("alloc.bangkok"), color: "var(--map-excluded)", shape: "square" }]));
    mapBox.append(leg);

    const svgBox = h("div", { class: "alloc__svgbox" });
    mapBox.append(svgBox);
    const r0 = svgBox.getBoundingClientRect();
    const W = Math.max(120, r0.width || 400), H = Math.max(120, r0.height || 480);
    const svg = s("svg", { class: "map-svg", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", role: "img",
      "aria-label": t("alloc.aria", { plan: planOf(st.plan).label }) });
    svgBox.append(svg);
    const geo = R.geo;
    const proj = projector(geo.bbox, W, H, 8);
    this.nodes = new Map();
    const top = [...cur.values()].sort((a, b) => b.x - a.x).slice(0, spec.label_top ?? 5).map((r) => r.prov_code);
    for (const p of geo.provinces) {
      const rec = cur.get(p.code);
      const path = s("path", { d: pathFor(p.polygons, proj), class: "prov__shape alloc__prov",
        style: `fill:${rec ? SEQ[bin(rec.x)] : "var(--map-excluded)"}`, tabindex: rec ? 0 : -1 });
      svg.append(path);
      this.nodes.set(p.code, path);
      if (rec) bindTip(path, () => tipHTML(`${rec.province} · ${planOf(st.plan).label}`, this.tipRows(rec, data)));
      else bindTip(path, () => tipHTML(p.name_th, [[t("alloc.status"), t("alloc.bangkok")]]));
      path.addEventListener("mouseenter", () => this.setHot(p.code));
      path.addEventListener("mouseleave", () => this.setHot(null));
    }
    const labels = [];
    for (const code of top) {
      const p = geo.provinces.find((q) => q.code === code);
      if (!p) continue;
      const [x, y] = proj(...p.label_point);
      const text = s("text", { class: "alloc__label", "dominant-baseline": "middle", text: `${p.name_th} ${num(cur.get(code).x, 0)}` });
      svg.append(text);
      const width = text.getComputedTextLength();
      const gap = Math.max(28, parseFloat(getComputedStyle(text).fontSize) * 1.65);
      const right = x >= W / 2;
      const lx = right ? Math.min(x + 26, W - width - 8) : Math.max(x - 26, width + 8);
      const left = right ? lx : lx - width;
      labels.push({ x, y, ly: Math.max(gap / 2, y), lx, left, rightEdge: left + width, gap, right, text });
    }
    labels.sort((a, b) => a.y - b.y);
    labels.forEach((it, i) => {
      for (const before of labels.slice(0, i)) {
        if (it.left < before.rightEdge + 8 && it.rightEdge > before.left - 8) it.ly = Math.max(it.ly, before.ly + Math.max(it.gap, before.gap));
      }
    });
    const overflow = Math.max(0, ...labels.map((it) => it.ly + it.gap / 2 - H));
    for (const it of labels) {
      it.ly -= overflow;
      svg.insertBefore(s("path", { class: "leader", d: `M${it.x},${it.y} L${it.right ? it.lx - 5 : it.lx + 5},${it.ly} L${it.lx},${it.ly}`, fill: "none" }), it.text);
      it.text.setAttribute("x", it.lx);
      it.text.setAttribute("y", it.ly);
      it.text.setAttribute("text-anchor", it.right ? "start" : "end");
    }

    // ---------------------------------------------------------- table: every province, every plan
    side.append(h("p", { class: "alloc__caption", text: t("alloc.table_caption", { name: planOf(st.plan).label,
      when: st.year === "all" ? t("alloc.all_label", { a: be(first), b: be(last) }) : t("alloc.year_label", { y: be(st.year) }) }) }));
    const tbl = h("table", { class: "alloc__table" });
    const base = plans[0];
    const showDiff = st.plan !== base.key;
    tbl.append(h("thead", {}, h("tr", {},
      h("th", { scope: "col", text: t("alloc.col_rank") }), h("th", { scope: "col", text: t("alloc.col_province") }),
      ...plans.map((p) => h("th", { scope: "col", class: "num" + (p.key === st.plan ? " is-on" : ""), style: `--pc:${colorSpec(p.color)}`, text: p.short || p.label })),
      showDiff ? h("th", { scope: "col", class: "num", text: t("alloc.col_diff", { name: base.short || base.label }) }) : "")));
    const tb = h("tbody");
    const order = [...cur.values()].sort((a, b) => b.x - a.x || a.province.localeCompare(b.province, "th"));
    order.forEach((rec, i) => {
      const tr = h("tr", { "data-code": rec.prov_code, tabindex: "0" });
      tr.append(h("td", { class: "num muted", text: String(i + 1) }), h("th", { scope: "row", text: rec.province }));
      for (const p of plans) {
        const v = data.get(p.key).get(rec.prov_code)?.x;
        tr.append(h("td", { class: "num" + (p.key === st.plan ? " is-on" : ""), text: v == null ? "—" : num(v, 0) }));
      }
      if (showDiff) {
        const d = rec.x - (data.get(base.key).get(rec.prov_code)?.x ?? 0);
        tr.append(h("td", { class: "num " + (d > 0 ? "pos" : d < 0 ? "neg" : "muted"), text: d > 0 ? `+${num(d, 0)}` : d < 0 ? `−${num(-d, 0)}` : "0" }));
      }
      tr.addEventListener("mouseenter", () => this.setHot(rec.prov_code));
      tr.addEventListener("mouseleave", () => this.setHot(null));
      tr.addEventListener("focus", () => this.setHot(rec.prov_code));
      tr.addEventListener("blur", () => this.setHot(null));
      bindTip(tr, () => tipHTML(`${rec.province} · ${planOf(st.plan).label}`, this.tipRows(rec, data)));
      tb.append(tr);
    });
    tbl.append(tb);
    const totals = plans.map((p) => [...data.get(p.key).values()].reduce((a, r) => a + r.x, 0));
    tbl.append(h("tfoot", {}, h("tr", {}, h("td", {}), h("th", { scope: "row", text: t("alloc.total") }),
      ...totals.map((v, j) => h("td", { class: "num" + (plans[j].key === st.plan ? " is-on" : ""), text: num(v, 0) })),
      showDiff ? h("td", {}) : "")));
    const scroll = h("div", { class: "alloc__scroll", tabindex: "0", role: "region", "aria-label": t("alloc.table_caption", {
      name: planOf(st.plan).label, when: st.year === "all" ? t("alloc.all_label", { a: be(first), b: be(last) }) : t("alloc.year_label", { y: be(st.year) }) }) }, tbl);
    scroll.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.stopPropagation();
    });
    side.append(scroll);
    scroll.scrollTop = scrollTop;
    this.tbody = tb;
    if (keepSliderFocus) slider.focus({ preventScroll: true });
  }

  tipRows(rec, data) {
    const all = this.state.year === "all";
    const rows = [[all ? t("alloc.new_total") : t("alloc.new"), t("alloc.persons", { n: num(rec.x, 0) })]];
    for (const p of this.spec.plans) {
      if (p.key === this.state.plan) continue;
      const v = data.get(p.key).get(rec.prov_code)?.x;
      if (v != null) rows.push([t("alloc.under", { name: p.label }), t("alloc.persons", { n: num(v, 0) })]);
    }
    rows.push([all ? t("alloc.opening_first") : t("alloc.opening"), num(rec.opening, 0)]);
    rows.push([all ? t("alloc.departures_total") : t("alloc.departures"), num(rec.departures, 1)]);
    rows.push([all ? t("alloc.closing_last") : t("alloc.closing"), num(rec.closing, 0)]);
    rows.push([t("alloc.attain"), num(rec.attainment_pop, 2)]);
    if (!all && rec.cap_binding) rows.push([t("alloc.status"), t("alloc.cap")]);
    else if (!all && rec.floor_only) rows.push([t("alloc.status"), t("alloc.floor")]);
    return rows;
  }

  setHot(code) {
    if (this.hot && this.nodes.get(this.hot)) this.nodes.get(this.hot).classList.remove("is-hot");
    this.tbody?.querySelector("tr.is-hot")?.classList.remove("is-hot");
    this.hot = code;
    if (!code) return;
    this.nodes.get(code)?.classList.add("is-hot");
    this.tbody?.querySelector(`tr[data-code="${code}"]`)?.classList.add("is-hot");
  }

  play() {
    const st = this.state;
    if (st.year === "all" || st.year >= this.years[this.years.length - 1]) st.year = this.years[0];
    this.timer = setInterval(() => {
      if (st.year >= this.years[this.years.length - 1]) { this.stop(); this.render(); return; }
      st.year += 1;
      this.render();
    }, 1100);
    this.render();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  destroy() { this.stop(); hideTip(); clear(this.el); }
}
