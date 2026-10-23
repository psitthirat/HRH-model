// The Read page's charts, one definition per figure id. Each definition draws
// from the figure's own CSV (D.main), plus the extra research tables named in
// config/web/reader.toml (D.<table>) and, for maps, the province outlines
// (D.geo). Labels for plans, denominators and categories come from [labels] in
// the same config; numbers are formatted from the data, never typed here.
//
// A definition: { needs, controls(D, ctx), legend(state, D, ctx), draw(svg, W, state, D, ctx, env) -> height,
//                 table(state, D, ctx), note?, minWidth?, initialHidden? }

import { s } from "../util/dom.js";
import { linear, ticks as tickValues, nice } from "../util/scale.js";
import { C, fmt, paint, text, textLines, wrap, textWidth, title as ptitle, bindTip, code,
  linePanel, hbarPanel, vbarPanel, dotPanel, scatterPanel, mapPanel, yAxis, xAxis, tickFormat, spread } from "./viz.js";

const CADRES = ["แพทย์", "พยาบาลวิชาชีพ", "เภสัชกร", "ทันตแพทย์"];
const cadreColor = (c) => C.s(CADRES.indexOf(c) + 1);
const lab = (ctx, table, key) => (ctx.labels?.[table] && ctx.labels[table][key]) || key;
const opt = (v, label) => ({ v, label: label ?? v });
const seg = (id, label, options, value, extra = {}) => ({ id, label, options, value: value ?? options[0].v, ...extra });
const uniq = (a) => [...new Set(a)];
const sorted = (a) => uniq(a).sort((p, q) => p - q);
const G = (svg) => { const g = s("g"); svg.append(g); return g; };
const lineH = (W) => Math.round(Math.max(250, Math.min(390, W * 0.52)));
const be = (y) => fmt.be(y);
const pct1 = fmt.pct(1), dec1 = fmt.dec(1), dec2 = fmt.dec(2), dec3 = fmt.dec(3);
const cadreOptions = () => CADRES.map((c) => opt(c));
const byCode = (rows, key = "prov_code") => new Map(rows.map((r) => [code(r[key]), r]));
const nameOf = (D, c) => D.geo?.provinces.find((p) => p.code === c)?.name || c;

// ================================================================ ส่วนที่ 1
const F41_WORKFORCE_COUNTS = {
  controls: () => [seg("mode", "แสดงเป็น", [opt("count", "จำนวนคน"), opt("index", "ดัชนี (พ.ศ. 2556 = 100)")])],
  legend: () => CADRES.map((c) => ({ key: c, label: c, color: cadreColor(c), shape: "line", toggle: true })),
  series(st, D, ctx) {
    const years = sorted(D.main.map((r) => r.year));
    return CADRES.filter((c) => !ctx.hidden?.has(c)).map((c) => {
      const rows = D.main.filter((r) => r.cadre === c);
      const base = rows.find((r) => r.year === years[0])?.headcount;
      return { key: c, label: c, color: cadreColor(c), dots: true, endLabel: c,
        points: years.map((y) => { const r = rows.find((q) => q.year === y); return { x: y, y: r ? (st.mode === "index" ? (100 * r.headcount) / base : r.headcount) : null }; }) };
    });
  },
  draw(svg, W, st, D, ctx, env) {
    const series = this.series(st, D, ctx), years = sorted(D.main.map((r) => r.year)), H = lineH(W);
    const f = st.mode === "index" ? dec1 : fmt.int;
    linePanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
      x: { values: years, format: be },
      y: { label: st.mode === "index" ? "ดัชนี (พ.ศ. 2556 = 100)" : "จำนวนบุคลากร (คน)", zero: st.mode !== "index" },
      refs: st.mode === "index" ? [{ y: 100 }] : [],
      series,
      tip: (x) => ({ title: `พ.ศ. ${be(x)}`, rows: series.map((sr) => ({ label: sr.label, value: f(sr.points.find((p) => p.x === x)?.y), color: sr.color })) }),
    }, env);
    return H;
  },
  table(st, D) {
    const years = sorted(D.main.map((r) => r.year));
    return { caption: "จำนวนบุคลากรทุกสังกัด (คน)", columns: [{ key: "y", label: "พ.ศ." }, ...CADRES.map((c) => ({ key: c, label: c, num: true, format: fmt.int }))],
      rows: years.map((y) => Object.fromEntries([["y", be(y)], ...CADRES.map((c) => [c, D.main.find((r) => r.year === y && r.cadre === c)?.headcount])])) };
  },
};

const DENOMS = ["civil_population", "entitlement_population", "age_weighted_scenario_flat", "age_weighted_scenario_moderate",
  "age_weighted_scenario_steep", "op_visits_moph", "ip_days_moph", "adjrw_casemix", "m5_expected_op_moph", "m5_expected_ip_moph", "m5_expected_adjrw"];
const F424_DENOMINATOR_COMPARISON = {
  controls: () => [
    seg("cadre", "วิชาชีพ", [opt("แพทย์"), opt("พยาบาลวิชาชีพ")]),
    seg("metric", "ค่าที่แสดง", [opt("cum", "เปลี่ยนตลอดช่วงยาว (%)"), opt("cagr", "เฉลี่ยต่อปี สองช่วงเวลา (%)")], "cum", { reset: true }),
  ],
  legend: (st, D, ctx) => st.metric === "cagr"
    ? ["long", "common_2023_2025"].map((k, i) => ({ key: k, label: lab(ctx, "window", k), color: C.s(i + 1), shape: "rect", toggle: true })) : [],
  rows: (st, D) => D.main.filter((r) => r.workforce === "moph" && r.cadre === st.cadre),
  draw(svg, W, st, D, ctx, env) {
    const rows = this.rows(st, D);
    const cats = DENOMS.filter((k) => rows.some((r) => r.denominator === k)).map((k) => ({ key: k, label: lab(ctx, "denominator", k) }));
    const field = st.metric === "cum" ? "ratio_pct_change" : "ratio_cagr_pct";
    const series = st.metric === "cum" ? [{ key: "long", color: C.s(1) }]
      : ["long", "common_2023_2025"].filter((k) => !ctx.hidden.has(k)).map((k, i) => ({ key: k, color: C.s(k === "long" ? 1 : 2) }));
    const get = (c, sr) => rows.find((r) => r.denominator === c.key && r.window === sr.key);
    const out = hbarPanel(G(svg), { x: 0, y: 0, w: W, h: 0 }, {
      cats, series, value: (c, sr) => get(c, sr)?.[field], valueLabels: true, labelW: Math.min(220, W * 0.4),
      x: { format: fmt.signed(1, "%"), tickFormat: (v) => fmt.dec(0)(v), label: st.metric === "cum" ? "การเปลี่ยนแปลงของแพทย์ต่อตัวหาร ตลอดช่วงที่ตัวหารนั้นมี (%)" : "อัตราการเปลี่ยนแปลงเฉลี่ยของอัตราส่วน (% ต่อปี)" },
      tip: (c, sr) => {
        const r = get(c, sr);
        if (!r) return null;
        return { title: c.label, rows: [
          { label: st.metric === "cum" ? "บุคลากรต่อตัวหาร เปลี่ยน" : "บุคลากรต่อตัวหาร เปลี่ยนต่อปี", value: fmt.signed(1, "%")(r[field]), color: sr.color, swatch: "rect" },
          { label: "ช่วงปี", value: `${be(r.start)}–${be(r.end)}` },
          { label: "บุคลากรเปลี่ยน", value: fmt.signed(1, "%")(r.workforce_pct_change) },
          { label: "ตัวหารเปลี่ยน", value: fmt.signed(1, "%")(r.denominator_pct_change) },
        ], note: [r.responsibility, r.interpretation_issue].filter(Boolean).join(" · ") };
      },
    }, env);
    return out.height;
  },
  table(st, D, ctx) {
    const rows = this.rows(st, D);
    return { caption: `${st.cadre} สังกัดกระทรวงสาธารณสุข`, columns: [
      { key: "d", label: "ตัวหาร" }, { key: "w", label: "ช่วง" }, { key: "y", label: "ปี" },
      { key: "p", label: "เปลี่ยน (%)", num: true, format: fmt.dec(1) }, { key: "c", label: "ต่อปี (%)", num: true, format: fmt.dec(2) }],
      rows: rows.map((r) => ({ d: lab(ctx, "denominator", r.denominator), w: lab(ctx, "window", r.window), y: `${be(r.start)}–${be(r.end)}`, p: r.ratio_pct_change, c: r.ratio_cagr_pct })) };
  },
};

const SCOPES3 = ["all_sectors", "public_total", "moph"];
const F421_DENSITY_SCOPES = {
  controls: () => [seg("cadre", "วิชาชีพ", cadreOptions())],
  legend: (st, D, ctx) => SCOPES3.map((k, i) => ({ key: k, label: lab(ctx, "scope", k), color: C.s(i + 1), shape: "line", toggle: true })),
  draw(svg, W, st, D, ctx, env) {
    const rows = D.main.filter((r) => r.cadre === st.cadre), years = sorted(rows.map((r) => r.year)), H = lineH(W);
    const series = SCOPES3.filter((k) => !ctx.hidden.has(k)).map((k, i) => ({ key: k, label: lab(ctx, "scope", k), color: C.s(SCOPES3.indexOf(k) + 1), dots: true,
      endLabel: lab(ctx, "scope", k), points: years.map((y) => ({ x: y, y: rows.find((r) => r.year === y && r.universe === k)?.density_per_100k })) }));
    linePanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
      x: { values: years, format: be }, y: { label: `${st.cadre} ต่อประชากรแสนคน` }, series,
      tip: (x) => ({ title: `${st.cadre} พ.ศ. ${be(x)}`, rows: series.map((sr) => {
        const r = rows.find((q) => q.year === x && q.universe === sr.key);
        return { label: `${sr.label} (${fmt.int(r?.headcount)} คน)`, value: dec1(r?.density_per_100k), color: sr.color };
      }) }),
    }, env);
    return H;
  },
  table(st, D, ctx) {
    const rows = D.main.filter((r) => r.cadre === st.cadre);
    return { caption: `${st.cadre} ต่อประชากรแสนคน`, columns: [{ key: "y", label: "พ.ศ." }, ...SCOPES3.map((k) => ({ key: k, label: lab(ctx, "scope", k), num: true, format: dec1 }))],
      rows: sorted(rows.map((r) => r.year)).map((y) => Object.fromEntries([["y", be(y)], ...SCOPES3.map((k) => [k, rows.find((r) => r.year === y && r.universe === k)?.density_per_100k])])) };
  },
};

const F45_DENSITY_VS_BURDEN = {
  controls: () => [
    seg("view", "มุมมอง", [opt("ci", "ดัชนีการกระจุกตัว"), opt("q", "ห้ากลุ่มภาระโรค")]),
    seg("rank", "เรียงจังหวัดด้วย", [opt("daly", "DALY"), opt("yll", "YLL"), opt("yld", "YLD")], "daly", { when: (st) => st.view === "ci" }),
    seg("cadre", "วิชาชีพ", cadreOptions(), "แพทย์", { when: (st) => st.view === "q" }),
    seg("scope", "สังกัด", [opt("moph", "กระทรวงสาธารณสุข"), opt("all_sectors", "ทุกสังกัด")], "moph", { when: (st) => st.view === "q" }),
  ],
  legend: (st) => st.view === "ci"
    ? [...CADRES.map((c) => ({ key: c, label: c, color: cadreColor(c), shape: "line", toggle: true })),
      { key: "_moph", label: "เส้นทึบ: กระทรวงสาธารณสุข", color: C.ink2, shape: "line" }, { key: "_all", label: "เส้นประ: ทุกสังกัด", color: C.ink2, shape: "dash" }]
    : [{ key: "start", label: "พ.ศ. 2556", color: C.seq(3), shape: "rect", toggle: true }, { key: "end", label: "พ.ศ. 2568", color: C.seq(6), shape: "rect", toggle: true }],
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg);
    if (st.view === "ci") {
      const rows = D.main.filter((r) => r.rank_by === st.rank), years = sorted(rows.map((r) => r.year)), H = lineH(W);
      const series = [];
      for (const c of CADRES.filter((c) => !ctx.hidden.has(c))) for (const sc of ["moph", "all_sectors"]) {
        series.push({ key: `${c}|${sc}`, label: `${c} ${sc === "moph" ? "สธ." : "ทุกสังกัด"}`, color: cadreColor(c), dash: sc === "moph" ? null : "6 4",
          width: sc === "moph" ? 2.4 : 1.6, end: sc === "moph", endLabel: c, points: years.map((y) => ({ x: y, y: rows.find((r) => r.cadre === c && r.scope === sc && r.year === y)?.ci })) });
      }
      linePanel(g, { x: 0, y: 0, w: W, h: H }, {
        x: { values: years, format: be }, y: { label: "ดัชนีการกระจุกตัว (ติดลบ = เอนไปจังหวัดภาระต่ำ)", zero: false }, series,
        tip: (x) => ({ title: `พ.ศ. ${be(x)}`, rows: series.map((sr) => ({ label: sr.label, value: dec3(sr.points.find((p) => p.x === x)?.y), color: sr.color, dash: !!sr.dash })) }),
      }, env);
      return H;
    }
    const q = (D.T45_BURDEN_QUINTILE_DENSITY || []).filter((r) => r.cadre === st.cadre && r.scope === st.scope).sort((a, b) => a.quintile - b.quintile);
    const cats = q.map((r) => ({ key: r.quintile, label: r.quintile === 1 ? "1\nภาระต่ำสุด" : r.quintile === 5 ? "5\nภาระสูงสุด" : String(r.quintile), r }));
    const series = [{ key: "start", color: C.seq(3) }, { key: "end", color: C.seq(6) }].filter((sr) => !ctx.hidden.has(sr.key));
    const H = lineH(W);
    vbarPanel(g, { x: 0, y: 0, w: W, h: H }, {
      cats, series, value: (c, sr) => (sr.key === "start" ? c.r.density_start : c.r.density_end),
      y: { label: `${st.cadre} ${lab(ctx, "scope", st.scope)} ต่อประชากรแสนคน` }, x: { label: "กลุ่มจังหวัดตามภาระโรค (ห้ากลุ่ม)" },
      valueLabels: W > 420, valueFormat: dec1,
      tip: (c) => ({ title: `กลุ่มภาระโรค ${c.key} (${c.r.provinces} จังหวัด)`, rows: [
        { label: "พ.ศ. 2556", value: dec1(c.r.density_start), color: C.seq(3), swatch: "rect" },
        { label: "พ.ศ. 2568", value: dec1(c.r.density_end), color: C.seq(6), swatch: "rect" },
        { label: "เพิ่มขึ้น", value: pct1(c.r.growth_pct) },
        { label: "DALY ปรับอายุเฉลี่ย ต่อแสนคน", value: fmt.int(c.r.mean_bod_daly) },
        { label: "ส่วนของที่เพิ่มทั้งประเทศ", value: pct1(100 * c.r.share_of_added) },
      ] }),
    }, env);
    return H;
  },
  table(st, D, ctx) {
    if (st.view === "ci") {
      const rows = D.main.filter((r) => r.rank_by === st.rank);
      return { caption: `ดัชนีการกระจุกตัว เรียงจังหวัดด้วย ${st.rank.toUpperCase()}`, columns: [{ key: "y", label: "พ.ศ." },
        ...CADRES.flatMap((c) => ["moph", "all_sectors"].map((sc) => ({ key: `${c}|${sc}`, label: `${c} ${sc === "moph" ? "สธ." : "ทุกสังกัด"}`, num: true, format: dec3 })))],
        rows: sorted(rows.map((r) => r.year)).map((y) => Object.fromEntries([["y", be(y)], ...rows.filter((r) => r.year === y).map((r) => [`${r.cadre}|${r.scope}`, r.ci])])) };
    }
    const q = (D.T45_BURDEN_QUINTILE_DENSITY || []).filter((r) => r.cadre === st.cadre && r.scope === st.scope);
    return { caption: `${st.cadre} ${lab(ctx, "scope", st.scope)} ต่อประชากรแสนคน ตามกลุ่มภาระโรค`, columns: [{ key: "quintile", label: "กลุ่ม" }, { key: "provinces", label: "จังหวัด", num: true },
      { key: "density_start", label: "พ.ศ. 2556", num: true, format: dec1 }, { key: "density_end", label: "พ.ศ. 2568", num: true, format: dec1 }, { key: "growth_pct", label: "เพิ่ม (%)", num: true, format: dec1 }], rows: q };
  },
};

// Equal-interval classes on round numbers that cover every value (at most seven,
// one per step of the sequential ramp); `step(i)` is the ramp step of class i.
function classes(values, n) {
  const fin = values.filter(Number.isFinite);
  const [a, b] = [Math.min(...fin), Math.max(...fin)];
  const st = (b - a) / n;
  const mag = 10 ** Math.floor(Math.log10(Math.max(st, 1e-9)));
  const step = Math.ceil(st / mag) * mag;
  const lo = Math.floor(a / step) * step;
  const k = Math.min(7, Math.max(1, Math.ceil((b - lo) / step + 1e-9)));
  const edges = Array.from({ length: k + 1 }, (_, i) => lo + i * step);
  const off = 7 - k + 1;
  return { edges, k, step: (i) => i + off, idx: (v) => (Number.isFinite(v) ? Math.max(0, Math.min(k - 1, Math.floor((v - lo) / step))) : -1) };
}

const CAUSES = [["ncd", "bod_daly_ncd", "share_ncd"], ["inj", "bod_daly_inj", "share_inj"], ["cmnn", "bod_daly_cmnn", "share_cmnn"]];
const F45_BOD_MAP = {
  needs: ["geo"],
  controls: () => [
    seg("view", "มุมมอง", [opt("map", "แผนที่"), opt("bars", "แท่งรายจังหวัด")], "map", { reset: true }),
    seg("cause", "สาเหตุ", [opt("all", "ทุกสาเหตุ"), opt("ncd", "โรคไม่ติดต่อ"), opt("inj", "การบาดเจ็บ"), opt("cmnn", "โรคติดต่อ มารดา ทารก และโภชนาการ")], "all", { when: (st) => st.view === "map" }),
  ],
  field: (st) => (st.cause === "all" ? "bod_daly" : CAUSES.find((c) => c[0] === st.cause)[1]),
  legend(st, D, ctx) {
    if (st.view === "bars") return CAUSES.map(([k], i) => ({ key: k, label: lab(ctx, "cause", k), color: C.s(i + 1), shape: "rect", toggle: true }));
    const cl = classes(D.main.map((r) => r[this.field(st)]), 6);
    return [...cl.edges.slice(0, -1).map((e, i) => ({ key: `c${i}`, label: `${fmt.int(e)}–${fmt.int(cl.edges[i + 1])}`, color: C.seq(cl.step(i)), shape: "rect" })),
      { key: "bkk", label: "กรุงเทพฯ (ไม่อยู่ในการวิเคราะห์)", shape: "hatch" }];
  },
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), rows = byCode(D.main);
    const tip = (c) => {
      const r = rows.get(c);
      if (!r) return null;
      return { title: r.province, rows: [
        { label: "DALY ปรับอายุต่อแสนคน ทุกสาเหตุ", value: fmt.int(r.bod_daly) },
        ...CAUSES.map(([k, f, sh], i) => ({ label: lab(ctx, "cause", k), value: `${fmt.int(r[f])} (${pct1(100 * r[sh])})`, color: C.s(i + 1), swatch: "rect" })),
        { label: "อันดับ (สูงไปต่ำ)", value: String(r.rank_daly_high_to_low) },
      ] };
    };
    if (st.view === "map") {
      const f = this.field(st), cl = classes(D.main.map((r) => r[f]), 6);
      const lead = st.cause === "all" ? "ภาระโรคทุกสาเหตุ" : lab(ctx, "cause", st.cause);
      const th = ptitle(g, 0, 13, `${lead}: DALY ปรับมาตรฐานอายุ ต่อประชากรแสนคน พ.ศ. 2565`, W);
      const m = s("g", { transform: `translate(0,${th + 8})` });
      g.append(m);
      const out = mapPanel(m, { x: 0, y: 0, w: W, h: 0 }, {
        geo: D.geo, maxH: env?.export ? 860 : Math.min(680, Math.max(440, W * 1.1)), excluded: new Set(["10"]),
        fill: (c) => { const r = rows.get(c); return r ? C.seq(cl.step(cl.idx(r[f]))) : null; }, tip,
      }, env);
      return th + 8 + out.height + 6;
    }
    const order = [...D.main].sort((a, b) => b.bod_daly - a.bod_daly);
    const series = CAUSES.filter(([k]) => !ctx.hidden.has(k)).map(([k, f], i) => ({ key: k, color: C.s(CAUSES.findIndex((c) => c[0] === k) + 1), f }));
    const out = hbarPanel(g, { x: 0, y: 0, w: W, h: 0 }, {
      cats: order.map((r) => ({ key: code(r.prov_code), label: r.province })), series, stacked: true, rowH: 15, labelW: 96,
      value: (c, sr) => rows.get(c.key)?.[sr.f], x: { format: fmt.int, labelTop: "DALY ปรับมาตรฐานอายุ ต่อประชากรแสนคน แยกกลุ่มสาเหตุ" },
      tip: (c) => tip(c.key), rowHit: true,
    }, env);
    return out.height;
  },
  table(st, D, ctx) {
    return { caption: "ภาระโรคระดับจังหวัด พ.ศ. 2565 (DALY ปรับมาตรฐานอายุ ต่อประชากรแสนคน)", columns: [{ key: "province", label: "จังหวัด" },
      { key: "bod_daly", label: "ทุกสาเหตุ", num: true, format: fmt.int }, ...CAUSES.map(([k, f]) => ({ key: f, label: lab(ctx, "cause", k), num: true, format: fmt.int })),
      { key: "rank_daly_high_to_low", label: "อันดับ", num: true }], rows: [...D.main].sort((a, b) => a.rank_daly_high_to_low - b.rank_daly_high_to_low) };
  },
};

const F45_AGE_BURDEN = {
  controls: () => [seg("view", "มุมมอง", [opt("sc", "อายุกับภาระส่วนเกิน"), opt("share", "ส่วนของผู้อายุหกสิบปีขึ้นไป")])],
  legend: (st) => (st.view === "sc" ? [{ key: "p", label: "จังหวัด (ขนาดจุด = ประชากร)", color: C.s(1), shape: "dot" }] : []),
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), rows = D.main;
    if (st.view === "sc") {
      const H = Math.round(Math.max(300, Math.min(460, W * 0.62)));
      const show = new Set([...[...rows].sort((a, b) => b.crude_rate - a.crude_rate).slice(0, 3), ...[...rows].sort((a, b) => a.crude_rate - b.crude_rate).slice(0, 3),
        rows.reduce((a, b) => (b.excess_factor > a.excess_factor ? b : a)), rows.reduce((a, b) => (b.excess_factor < a.excess_factor ? b : a))].map((r) => r.prov_code));
      const xs = rows.map((r) => r.age_factor), ys = rows.map((r) => r.excess_factor);
      const pad = (a) => [Math.min(...a) - 0.02, Math.max(...a) + 0.02];
      const maxPop = Math.max(...rows.map((r) => r.mid_pop_2022));
      scatterPanel(g, { x: 0, y: 0, w: W, h: H }, {
        x: { domain: pad(xs), label: "ผลของโครงสร้างอายุ (หนึ่ง = ค่ารวมทุกจังหวัด)", format: dec2 },
        y: { domain: pad(ys), label: "ภาระส่วนเกินเมื่อคุมอายุแล้ว", format: dec2 }, refX: 1, refY: 1,
        points: rows.map((r) => ({ x: r.age_factor, y: r.excess_factor, r: 3 + 9 * Math.sqrt(r.mid_pop_2022 / maxPop), color: C.s(1), opacity: 0.7,
          label: r.province, show: show.has(r.prov_code), datum: r })),
        tip: (p) => ({ title: p.datum.province, rows: [
          { label: "DALY หยาบต่อแสนคน", value: fmt.int(p.datum.crude_rate) }, { label: "DALY ปรับอายุต่อแสนคน", value: fmt.int(p.datum.asr) },
          { label: "ผลของโครงสร้างอายุ", value: dec2(p.datum.age_factor) }, { label: "ภาระส่วนเกิน", value: dec2(p.datum.excess_factor) },
          { label: "ส่วนของภาระในผู้อายุ ๖๐+", value: pct1(100 * p.datum.share_60plus_of_daly) }, { label: "ประชากรกลางปี", value: fmt.int(p.datum.mid_pop_2022) }] }),
      }, env);
      return H;
    }
    const order = [...rows].sort((a, b) => b.share_60plus_of_daly - a.share_60plus_of_daly);
    const H = Math.round(Math.max(260, Math.min(360, W * 0.48)));
    const cats = order.map((r) => ({ key: code(r.prov_code), label: "", r }));
    const out = vbarPanel(g, { x: 0, y: 0, w: W, h: H }, {
      cats, series: [{ key: "v", color: C.s(1) }], value: (c) => 100 * c.r.share_60plus_of_daly, xLabels: false,
      y: { label: "ร้อยละของภาระโรค (DALY) ที่อยู่กับผู้อายุหกสิบปีขึ้นไป", domain: [0, Math.ceil(Math.max(...order.map((r) => 100 * r.share_60plus_of_daly)) / 10) * 10] },
      x: { label: "จังหวัด เรียงจากมากไปน้อย" },
      tip: (c) => ({ title: c.r.province, rows: [{ label: "ส่วนของภาระในผู้อายุหกสิบปีขึ้นไป", value: pct1(100 * c.r.share_60plus_of_daly) }, { label: "ผลของโครงสร้างอายุ", value: dec2(c.r.age_factor) }] }),
    }, env);
    for (const i of [0, 1, order.length - 2, order.length - 1]) {
      const r = order[i], xx = out.cx(i), yy = out.y(100 * r.share_60plus_of_daly);
      text(g, xx, yy - 6, r.province, "rv-plab", { "text-anchor": i < 2 ? "start" : "end" });
    }
    return H;
  },
  table: (st, D) => ({ caption: "อายุกับภาระโรครายจังหวัด", columns: [{ key: "province", label: "จังหวัด" }, { key: "crude_rate", label: "DALY หยาบ", num: true, format: fmt.int },
    { key: "asr", label: "DALY ปรับอายุ", num: true, format: fmt.int }, { key: "age_factor", label: "ผลของอายุ", num: true, format: dec2 }, { key: "excess_factor", label: "ส่วนเกิน", num: true, format: dec2 },
    { key: "share_60plus_of_daly", label: "ส่วนในผู้อายุ ๖๐+ (%)", num: true, format: (v) => dec1(100 * v) }], rows: [...D.main].sort((a, b) => b.crude_rate - a.crude_rate) }),
};

const GROUPS = [["all_four", C.s(1)], ["burden_not_service", C.s(3)], ["service_not_burden", C.s(2)], ["mixed", C.neutral], ["none", C.none]];
const F46_RANK_DISAGREEMENT_MAP = {
  needs: ["geo"],
  legend: (st, D, ctx) => [...GROUPS.map(([k, col]) => ({ key: k, label: `${lab(ctx, "group", k)} (${D.main.filter((r) => r.group === k).length})`, color: col, shape: "rect", toggle: true })),
    { key: "bkk", label: "กรุงเทพฯ (ไม่อยู่ในการวิเคราะห์)", shape: "hatch" }],
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), rows = byCode(D.main), col = Object.fromEntries(GROUPS);
    const out = mapPanel(g, { x: 0, y: 0, w: W, h: 0 }, {
      geo: D.geo, maxH: env?.export ? 900 : Math.min(720, Math.max(460, W * 1.15)), excluded: new Set(["10"]),
      fill: (c) => { const r = rows.get(c); return r ? (ctx.hidden.has(r.group) ? C.none : col[r.group]) : null; },
      tip: (c) => {
        const r = rows.get(c);
        if (!r) return null;
        return { title: r.province, rows: [{ label: lab(ctx, "group", r.group), value: "กลุ่ม", color: col[r.group], swatch: "rect" },
          ...["P", "S", "N", "B"].map((k) => ({ label: `อันดับตาม${lab(ctx, "criterion", k)}`, value: `${r[`rank_${k}`]} จาก ๗๖`.replace("๗๖", "76") })),
          { label: "ส่วนของผู้อายุหกสิบปีขึ้นไป", value: pct1(100 * r.share_60plus) }, { label: "แพทย์นอก สธ. ในจังหวัด", value: pct1(100 * r.non_moph_physician_share) }] };
      },
    }, env);
    return out.height + 4;
  },
  table: (st, D, ctx) => ({ caption: "อันดับแพทย์ สธ. ต่อตัวหารสี่แบบ (หนึ่ง = ต่ำสุด)", columns: [{ key: "province", label: "จังหวัด" }, { key: "g", label: "กลุ่ม" },
    ...["P", "S", "N", "B"].map((k) => ({ key: `rank_${k}`, label: lab(ctx, "criterion", k), num: true }))],
  rows: [...D.main].map((r) => ({ ...r, g: lab(ctx, "group", r.group) })).sort((a, b) => a.rank_P - b.rank_P) }),
};

const RANK_COLS = ["population", "entitlement", "age_scenario_moderate", "op_visits", "ip_days", "adjrw", "m5_op_moph", "m5_ip_moph", "m5_adjrw"];
const F43_PRIORITY_SWITCHES = {
  minWidth: 380,
  controls: (D, ctx) => [seg("sort", "เรียงตาม", ["population", "op_visits", "adjrw", "m5_op_moph"].map((k) => opt(k, lab(ctx, "rank_denominator", k))))],
  legend: () => [{ key: "a", label: "อยู่ในกลุ่มต่ำสุด (สีเข้ม = อันดับต่ำกว่า)", color: C.seq(6), shape: "rect" }, { key: "b", label: "ไม่อยู่ในกลุ่มต่ำสุด", color: C.none, shape: "rect" }],
  rowsOf(st, D) {
    const by = new Map();
    for (const r of D.main) { if (!by.has(r.prov_code)) by.set(r.prov_code, { code: r.prov_code, province: r.province, c: {} }); by.get(r.prov_code).c[r.denominator] = r; }
    const list = [...by.values()].filter((p) => RANK_COLS.some((k) => p.c[k]?.priority));
    return list.sort((a, b) => a.c[st.sort].rank - b.c[st.sort].rank);
  },
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), rows = this.rowsOf(st, D);
    const nameW = Math.min(110, Math.max(80, W * 0.16)), colW = (W - nameW) / RANK_COLS.length;
    const small = colW < 46, fs = small ? 10 : 11;
    const heads = RANK_COLS.map((k) => wrap(lab(ctx, "rank_denominator", k), colW - 4, fs));
    const hh = Math.max(...heads.map((l) => l.length)) * (fs + 2) + 10;
    heads.forEach((lines, i) => textLines(g, nameW + colW * (i + 0.5), hh - (lines.length - 1) * (fs + 2) - 6, lines, small ? "rv-tick" : "rv-cat", fs + 2, { "text-anchor": "middle" }));
    const rowH = small ? 18 : 20;
    rows.forEach((p, i) => {
      const yy = hh + 4 + i * rowH;
      text(g, nameW - 6, yy + rowH / 2 + 4, p.province, "rv-cat", { "text-anchor": "end" });
      RANK_COLS.forEach((k, j) => {
        const r = p.c[k];
        if (!r) return;
        const step = r.priority ? 7 - Math.floor(((r.rank - 1) / 19) * 6) : 0;
        const cell = s("rect", { x: nameW + colW * j + 1, y: yy + 1, width: colW - 2, height: rowH - 2, rx: 2, class: "rv-cell" });
        paint(cell, { fill: r.priority ? C.seq(Math.max(2, Math.min(7, step))) : C.none });
        g.append(cell);
        text(g, nameW + colW * (j + 0.5), yy + rowH / 2 + 4, String(r.rank), r.priority && step >= 5 ? "rv-cellv rv-cellv--inv" : "rv-cellv", { "text-anchor": "middle" });
        if (!env?.export) bindTip(cell, () => ({ title: p.province, rows: [{ label: lab(ctx, "rank_denominator", k), value: `อันดับ ${r.rank}` },
          { label: "แพทย์ สธ. ต่อตัวหาร เทียบค่าเฉลี่ย", value: dec2(r.R) }, { label: "กลุ่มต่ำสุด", value: r.priority ? "ใช่" : "ไม่ใช่" },
          ...(r.near_cutoff ? [{ label: "หมายเหตุ", value: "อยู่ใกล้เส้นแบ่งกลุ่ม" }] : [])] }));
      });
    });
    const x6 = nameW + colW * 6;
    g.append(s("line", { class: "rv-divider", x1: x6, x2: x6, y1: 4, y2: hh + 4 + rows.length * rowH }));
    return hh + 8 + rows.length * rowH;
  },
  table(st, D, ctx) {
    return { caption: "อันดับแพทย์ สธ. ต่อตัวหาร (หนึ่ง = ต่ำสุด) จังหวัดที่เคยอยู่ในกลุ่มต่ำสุดอย่างน้อยหนึ่งตัวหาร",
      columns: [{ key: "province", label: "จังหวัด" }, ...RANK_COLS.map((k) => ({ key: k, label: lab(ctx, "rank_denominator", k), num: true }))],
      rows: this.rowsOf(st, D).map((p) => Object.fromEntries([["province", p.province], ...RANK_COLS.map((k) => [k, p.c[k]?.rank])])) };
  },
};

// ================================================================ ส่วนที่ 2
const LEVELS = ["share_regional_general", "share_community", "share_private", "share_other_public"];
const F46_SPECIALIST_CONCENTRATION = {
  controls: () => [
    seg("metric", "ค่าที่แสดง", [opt("top", "ส่วนของสถานพยาบาลหนึ่งในสิบแรก"), opt("level", "ส่วนตามระดับสถานพยาบาล")], "top", { reset: true }),
    seg("scope", "สังกัด", [opt("all", "ทุกสังกัด"), opt("moph", "กระทรวงสาธารณสุข")], "all", { when: (st) => st.metric === "level" }),
  ],
  levels: (st) => LEVELS.filter((k) => !(st.scope === "moph" && (k === "share_private" || k === "share_other_public"))),
  legend(st, D, ctx) {
    return st.metric === "top" ? ["all", "moph"].map((k, i) => ({ key: k, label: lab(ctx, "scope", k), color: C.s(i + 1), shape: "line", toggle: true }))
      : this.levels(st).map((k) => ({ key: k, label: lab(ctx, "level", k), color: C.s(LEVELS.indexOf(k) + 1), shape: "line", toggle: true }));
  },
  draw(svg, W, st, D, ctx, env) {
    const H = lineH(W), years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
    let series;
    if (st.metric === "top") series = ["all", "moph"].filter((k) => !ctx.hidden.has(k)).map((k) => ({ key: k, label: lab(ctx, "scope", k), color: C.s(k === "all" ? 1 : 2), dots: true, gapX: 1,
      endLabel: lab(ctx, "scope", k), points: D.main.filter((r) => r.scope === k).map((r) => ({ x: r.year, y: 100 * r.top10pct_share })) }));
    else series = this.levels(st).filter((k) => !ctx.hidden.has(k)).map((k) => ({ key: k, label: lab(ctx, "level", k), color: C.s(LEVELS.indexOf(k) + 1), dots: true, gapX: 1,
      endLabel: lab(ctx, "level", k), points: D.main.filter((r) => r.scope === st.scope).map((r) => ({ x: r.year, y: 100 * r[k] })) }));
    linePanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
      x: { values: years, format: be }, y: { label: st.metric === "top" ? "ร้อยละของตำแหน่งแพทย์เฉพาะทาง ที่อยู่ในสถานพยาบาลหนึ่งในสิบแรก" : "ร้อยละของตำแหน่งแพทย์เฉพาะทาง", zero: st.metric !== "top" },
      bands: [{ x0: 2019.5, x1: 2020.5, label: "ไม่แสดง" }], series,
      tip: (x) => {
        if (x === 2020) return { title: "พ.ศ. 2563", rows: [], note: "ยอดปีนี้ผิดปกติ จึงไม่แสดง" };
        const sc = st.metric === "top" ? null : D.main.find((r) => r.scope === st.scope && r.year === x);
        return { title: `พ.ศ. ${be(x)}`, rows: [...series.map((sr) => ({ label: sr.label, value: pct1(sr.points.find((p) => p.x === x)?.y), color: sr.color })),
          ...(sc ? [{ label: "ตำแหน่งแพทย์เฉพาะทาง", value: fmt.int(sc.specialists) }] : [])] };
      },
    }, env);
    return H;
  },
  table: (st, D, ctx) => ({ caption: "การกระจุกตัวของตำแหน่งแพทย์เฉพาะทาง", columns: [{ key: "scope", label: "สังกัด", format: (v) => lab(ctx, "scope", v) }, { key: "year", label: "พ.ศ.", format: be },
    { key: "specialists", label: "ตำแหน่ง", num: true, format: fmt.int }, { key: "top10pct_share", label: "หนึ่งในสิบแรก (%)", num: true, format: (v) => dec1(100 * v) },
    { key: "gini_across_facilities", label: "Gini", num: true, format: dec3 }, ...LEVELS.map((k) => ({ key: k, label: `${lab(ctx, "level", k)} (%)`, num: true, format: (v) => dec1(100 * v) }))],
  rows: D.main }),
};

const NEEDS = ["population", "services", "burden"];
const NEED_TH = { population: "ส่วนแบ่งประชากร (%)", services: "ส่วนแบ่งบริการที่เกิดขึ้น (%)", burden: "ส่วนแบ่งภาระโรคคาดหมาย (%)" };
const F47_FRAME_VS_NEED = {
  controls: () => [seg("need", "เทียบกับ", [opt("population", "ประชากร"), opt("services", "บริการที่เกิดขึ้น"), opt("burden", "ภาระโรคคาดหมาย")])],
  legend: () => [{ key: "p", label: "จังหวัด", color: C.s(1), shape: "dot" }, { key: "d", label: "เส้นทแยง: ส่วนแบ่งเท่ากัน", color: C.muted, shape: "dash" }],
  pts(st, D) {
    const tp = D.main.reduce((a, r) => a + r.positions, 0), tn = D.main.reduce((a, r) => a + r[st.need], 0);
    return D.main.map((r) => ({ r, x: (100 * r[st.need]) / tn, y: (100 * r.positions) / tp }));
  },
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), pts = this.pts(st, D);
    const rel = (p) => p.y / p.x;
    const ord = [...pts].sort((a, b) => rel(a) - rel(b));
    const show = new Set([...ord.slice(0, 3), ...ord.slice(-2)].map((p) => p.r.prov_code));
    const mx = Math.max(...pts.map((p) => Math.max(p.x, p.y))) * 1.05;
    const H = Math.round(Math.max(320, Math.min(500, W * 0.7)));
    scatterPanel(g, { x: 0, y: 0, w: W, h: H }, {
      title: ctx.text?.[st.need], diag: true,
      x: { domain: [0, mx], label: NEED_TH[st.need], format: dec1 }, y: { domain: [0, mx], label: "ส่วนแบ่งตำแหน่งนายแพทย์ (%)", format: dec1 },
      points: pts.map((p) => ({ x: p.x, y: p.y, r: 4.6, color: C.s(1), label: p.r.province, show: show.has(p.r.prov_code), datum: p })),
      tip: (p) => ({ title: p.datum.r.province, rows: [{ label: "ตำแหน่งนายแพทย์ (จ.18)", value: fmt.int(p.datum.r.positions) },
        { label: "ส่วนแบ่งตำแหน่ง", value: fmt.pct(2)(p.datum.y) }, { label: NEED_TH[st.need].replace(" (%)", ""), value: fmt.pct(2)(p.datum.x) },
        { label: "ได้ตำแหน่งเทียบส่วนแบ่งความจำเป็น", value: `${dec2(p.datum.y / p.datum.x)} เท่า` }] }),
    }, env);
    return H;
  },
  table(st, D) {
    return { caption: "ส่วนแบ่งตำแหน่งนายแพทย์เทียบส่วนแบ่งความจำเป็น (%)", columns: [{ key: "province", label: "จังหวัด" }, { key: "positions", label: "ตำแหน่ง", num: true, format: fmt.int },
      { key: "ps", label: "ส่วนแบ่งตำแหน่ง", num: true, format: fmt.dec(2) }, { key: "ns", label: NEED_TH[st.need], num: true, format: fmt.dec(2) }],
    rows: this.pts(st, D).map((p) => ({ province: p.r.province, positions: p.r.positions, ps: p.y, ns: p.x })).sort((a, b) => a.ps / a.ns - b.ps / b.ns) };
  },
};

const F44_STOCK_FLOW = {
  controls: () => [seg("cadre", "วิชาชีพ", cadreOptions())],
  legend: (st, D, ctx) => [
    { key: "entry", label: lab(ctx, "flow", "entry"), color: C.s(3), shape: "rect", toggle: true },
    { key: "exit", label: lab(ctx, "flow", "exit"), color: C.s(8), shape: "rect", toggle: true },
    { key: "dW", label: lab(ctx, "flow", "dW"), color: C.ink, shape: "line", toggle: true },
    { key: "net_flow", label: lab(ctx, "flow", "net_flow"), color: C.s(1), shape: "dash", toggle: true }],
  draw(svg, W, st, D, ctx, env) {
    const rows = D.main.filter((r) => r.cadre === st.cadre).sort((a, b) => a.year - b.year), H = lineH(W);
    const cats = rows.map((r) => ({ key: r.year, label: be(r.year), r }));
    const series = [{ key: "entry", color: C.s(3) }, { key: "exit", color: C.s(8) }].filter((sr) => !ctx.hidden.has(sr.key));
    const lines = [{ key: "dW", color: C.ink, dots: true, width: 2.2 }, { key: "net_flow", color: C.s(1), dash: "6 4", dots: true, square: true }]
      .filter((l) => !ctx.hidden.has(l.key)).map((l) => ({ ...l, points: rows.map((r) => ({ cat: r.year, y: r[l.key] })) }));
    vbarPanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
      cats, series, stacked: true, value: (c, sr) => (sr.key === "entry" ? c.r.entry : -c.r.exit), lines,
      y: { label: `${st.cadre}: คนหรือเหตุการณ์ต่อปี` }, x: { label: "ปีงบประมาณ" },
      tip: (c) => ({ title: `${st.cadre} ปีงบประมาณ ${be(c.key)}`, rows: [
        { label: lab(ctx, "flow", "entry"), value: fmt.int(c.r.entry), color: C.s(3), swatch: "rect" }, { label: lab(ctx, "flow", "exit"), value: fmt.int(c.r.exit), color: C.s(8), swatch: "rect" },
        { label: lab(ctx, "flow", "net_flow"), value: fmt.signed(0)(c.r.net_flow), color: C.s(1), dash: true }, { label: lab(ctx, "flow", "dW"), value: fmt.signed(0)(c.r.dW), color: C.ink },
        { label: "ส่วนที่ไม่ได้บันทึกเป็นการรับเข้าหรือออก", value: fmt.signed(0)(c.r.residual) }] }),
    }, env);
    return H;
  },
  table: (st, D, ctx) => ({ caption: `${st.cadre} สังกัดสำนักงานปลัดกระทรวงสาธารณสุข`, columns: [{ key: "year", label: "ปีงบ", format: be },
    ...["entry", "exit", "net_flow", "dW"].map((k) => ({ key: k, label: lab(ctx, "flow", k), num: true, format: fmt.int })), { key: "W", label: "จำนวนคงอยู่", num: true, format: fmt.int }],
  rows: D.main.filter((r) => r.cadre === st.cadre).sort((a, b) => a.year - b.year) }),
};

const F44_PROVINCE_FLOWS = {
  controls: () => [seg("cadre", "วิชาชีพ", cadreOptions())],
  legend: () => [{ key: "p", label: "จังหวัด", color: C.s(1), shape: "dot" }, { key: "q", label: "ความหนาแน่นตั้งต้นอยู่ในกลุ่มต่ำสุด", shape: "ring" },
    { key: "d", label: "เส้นทแยง: รับเข้าเท่ากับออก", color: C.muted, shape: "dash" }],
  draw(svg, W, st, D, ctx, env) {
    const rows = D.main.filter((r) => r.cadre === st.cadre);
    const mx = Math.max(...rows.map((r) => Math.max(r.entries_per100, r.exits_per100))) * 1.06;
    const show = new Set([...[...rows].sort((a, b) => b.entries_per100 - a.entries_per100).slice(0, 2), ...[...rows].sort((a, b) => b.exits_per100 - a.exits_per100).slice(0, 2)].map((r) => r.prov_code));
    const H = Math.round(Math.max(320, Math.min(480, W * 0.68)));
    scatterPanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
      diag: true, x: { domain: [0, mx], label: "รับเข้าต่อบุคลากรร้อยคนต่อปี", format: (v) => fmt.dec(0)(v) }, y: { domain: [0, mx], label: "ออกต่อบุคลากรร้อยคนต่อปี", format: (v) => fmt.dec(0)(v) },
      points: rows.map((r) => ({ x: r.entries_per100, y: r.exits_per100, r: 4.8, color: C.s(1), ring: r.priority === true, label: r.province, show: show.has(r.prov_code), datum: r })),
      tip: (p) => ({ title: `${p.datum.province} (${st.cadre})`, rows: [{ label: "รับเข้าต่อร้อยคนต่อปี", value: dec1(p.datum.entries_per100) },
        { label: "ออกต่อร้อยคนต่อปี", value: dec1(p.datum.exits_per100) }, { label: "ลาออกต่อร้อยคนต่อปี", value: dec1(p.datum.resignations_per100) },
        { label: "แบบแผน", value: p.datum.typology }, { label: "อัตราเติบโตต่อปี 2559–2568", value: fmt.signed(1, "%")(p.datum.cagr_2016_2025) },
        { label: "ความหนาแน่นตั้งต้น", value: p.datum.baseline_density_quartile }] }),
    }, env);
    return H;
  },
  table: (st, D) => ({ caption: `${st.cadre}: การเข้าออกต่อบุคลากรร้อยคนต่อปี`, columns: [{ key: "province", label: "จังหวัด" }, { key: "entries_per100", label: "รับเข้า", num: true, format: dec1 },
    { key: "exits_per100", label: "ออก", num: true, format: dec1 }, { key: "resignations_per100", label: "ลาออก", num: true, format: dec1 }, { key: "typology", label: "แบบแผน" }],
  rows: D.main.filter((r) => r.cadre === st.cadre).sort((a, b) => b.entries_per100 - a.entries_per100) }),
};

// ================================================================ ส่วนที่ 3
const BASIS = [["P-R", 1, null, 2.8], ["P-RT", 1, "6 4", 2.2], ["S-R", 2, null, 2], ["S-RT", 2, "6 4", 1.8], ["N-R", 3, null, 2], ["N-RT", 3, "6 4", 1.8], ["SQ-C", 0, null, 2]];
const basisColor = (n) => (n ? C.s(n) : C.neutral);
const F54_PANELS = { national_attainment: "ความเพียงพอระดับประเทศ (แพทย์ ÷ เป้าหมาย)", bottom_quartile_attainment: "ความเพียงพอของจังหวัดกลุ่มล่าง", gini: "ความเหลื่อมล้ำของความเพียงพอ (Gini)" };
const F54_ADEQUACY_AND_INEQUALITY = {
  controls: () => [seg("panel", "ตัวชี้วัด", [opt("national_attainment", "ระดับประเทศ"), opt("bottom_quartile_attainment", "จังหวัดกลุ่มล่าง"), opt("gini", "Gini"), opt("gap", "ส่วนขาด")], "bottom_quartile_attainment", { reset: true })],
  legend: (st, D, ctx) => st.panel === "gap"
    ? [{ key: "gap_national", label: "ส่วนขาดระดับประเทศ", color: C.s(1), shape: "rect", toggle: true }, { key: "gap_spatial", label: "ส่วนขาดจากการกระจาย", color: C.s(2), shape: "rect", toggle: true }]
    : BASIS.map(([k, n, dash]) => ({ key: k, label: lab(ctx, "plan_basis", k), color: basisColor(n), shape: dash ? "dash" : "line", toggle: true })),
  draw(svg, W, st, D, ctx, env) {
    const H = lineH(W);
    if (st.panel === "gap") {
      const rows = D.main.filter((r) => r.plan_id === "P-R" && r.panel === "national_attainment").sort((a, b) => a.year_ce - b.year_ce);
      vbarPanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
        title: `แผน ${lab(ctx, "plan_basis", "P-R")} เป้าหมายตัวอย่างหนึ่งต่อพัน`,
        cats: rows.map((r) => ({ key: r.year_ce, label: be(r.year_ce), r })),
        series: [{ key: "gap_national", color: C.s(1) }, { key: "gap_spatial", color: C.s(2) }].filter((sr) => !ctx.hidden.has(sr.key)),
        value: (c, sr) => Math.max(0, c.r[sr.key]), y: { label: "แพทย์ที่ขาด (คน)" },
        tip: (c) => ({ title: `พ.ศ. ${be(c.key)}`, rows: [{ label: "ส่วนขาดระดับประเทศ", value: fmt.int(c.r.gap_national), color: C.s(1), swatch: "rect" },
          { label: "ส่วนขาดจากการกระจาย", value: fmt.int(Math.max(0, c.r.gap_spatial)), color: C.s(2), swatch: "rect" }, { label: "แพทย์รวม", value: fmt.int(c.r.total_stock) }, { label: "เป้าหมายรวม", value: fmt.int(c.r.total_target) }] }),
      }, env);
      return H;
    }
    const rows = D.main.filter((r) => r.panel === st.panel);
    const years = sorted(rows.map((r) => r.year_ce));
    const series = BASIS.filter(([k]) => !ctx.hidden.has(k)).map(([k, n, dash, w]) => ({ key: k, label: lab(ctx, "plan_basis", k), color: basisColor(n), dash, width: w,
      points: years.map((y) => ({ x: y, y: rows.find((r) => r.plan_id === k && r.year_ce === y)?.[st.panel] })) }));
    linePanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
      x: { values: years, format: be }, y: { label: F54_PANELS[st.panel], zero: false }, series, noEnd: true,
      tip: (x) => ({ title: `พ.ศ. ${be(x)} (เกณฑ์ประชากร)`, rows: series.map((sr) => ({ label: sr.label, value: dec3(sr.points.find((p) => p.x === x)?.y), color: sr.color, dash: !!sr.dash })) }),
    }, env);
    return H;
  },
  table(st, D, ctx) {
    const metric = st.panel === "gap" ? "gap_national" : st.panel;
    const rows = D.main.filter((r) => r.panel === (st.panel === "gap" ? "national_attainment" : st.panel));
    const years = sorted(rows.map((r) => r.year_ce));
    return { caption: st.panel === "gap" ? "ส่วนขาดระดับประเทศ (คน)" : F54_PANELS[st.panel], columns: [{ key: "y", label: "พ.ศ." }, ...BASIS.map(([k]) => ({ key: k, label: k, num: true, format: st.panel === "gap" ? fmt.int : dec3 }))],
      rows: years.map((y) => Object.fromEntries([["y", be(y)], ...BASIS.map(([k]) => [k, rows.find((r) => r.plan_id === k && r.year_ce === y)?.[metric]])])) };
  },
};

const FRAME_PLANS = [["P-R", 1], ["P-R|F1", 2], ["P-R|F0", 3], ["P-R|need", 4]];
const roundYears = (rows) => {
  const m = rows.filter((r) => r.plan_id === "P-R").sort((a, b) => a.year_ce - b.year_ce);
  return m.filter((r, i) => i && r.positions > m[i - 1].positions + 0.5).map((r) => r.year_ce);
};
const F5F_NATIONAL = {
  controls: () => [seg("unit", "กราฟล่าง", [opt("year", "ต่อปี"), opt("cum", "สะสม")])],
  legend: (st, D, ctx) => [...FRAME_PLANS.map(([k, n]) => ({ key: k, label: lab(ctx, "plan_frame", k), color: C.s(n), shape: "line", toggle: true })),
    { key: "_s", label: "เส้นทึบ: จำนวนแพทย์", color: C.ink2, shape: "line" }, { key: "_c", label: "เส้นประ: ขีดรับตามกรอบ", color: C.ink2, shape: "dash" }],
  data(st, D, ctx) {
    const rows = D.main, years = sorted(rows.map((r) => r.year_ce));
    const plans = FRAME_PLANS.filter(([k]) => !ctx.hidden.has(k));
    const get = (k, y) => rows.find((r) => r.plan_id === k && r.year_ce === y);
    const un = (k) => { let acc = 0; return years.map((y) => { const v = Math.max(0, get(k, y)?.unplaced || 0); acc += v; return { x: y, y: st.unit === "cum" ? acc : v }; }); };
    return { years, plans, get, un, rounds: roundYears(rows) };
  },
  draw(svg, W, st, D, ctx, env) {
    const { years, plans, get, un, rounds } = this.data(st, D, ctx);
    const g = G(svg), H1 = lineH(W), H2 = Math.round(lineH(W) * 0.82), gap = 26;
    const vlines = rounds.map((x) => ({ x }));
    const stockSeries = plans.flatMap(([k, n]) => [
      { key: k, label: lab(ctx, "plan_frame", k), color: C.s(n), width: 2.4, end: true, endLabel: "", points: years.map((y) => ({ x: y, y: get(k, y)?.stock })) },
      { key: `${k}|cap`, label: "", color: C.s(n), width: 1.4, dash: "5 4", end: false, points: years.map((y) => ({ x: y, y: get(k, y)?.capacity })) }]);
    const tickW = textWidth("00,000", 11.5), endW = textWidth("00,000", 11.5) + 22;
    linePanel(g, { x: 0, y: 0, w: W, h: H1 }, {
      title: "ก. แพทย์ สธ. ในพื้นที่ (เส้นทึบ) และขีดรับตามกรอบของแต่ละแผน (เส้นประ)", tickW, endW,
      x: { values: years, format: be }, y: { label: "คน", zero: false }, series: stockSeries, endFormat: fmt.int, vlines, vlineLabel: "เพิ่มตำแหน่งรอบใหม่",
      tip: (x) => ({ title: `พ.ศ. ${be(x)}`, rows: plans.map(([k, n]) => ({ label: `${lab(ctx, "plan_frame", k)} (ขีดรับ ${fmt.int(get(k, x)?.capacity)})`, value: fmt.int(get(k, x)?.stock), color: C.s(n) })) }),
    }, env);
    const g2 = s("g", { transform: `translate(0,${H1 + gap})` });
    g.append(g2);
    const unSeries = plans.map(([k, n]) => ({ key: k, label: lab(ctx, "plan_frame", k), color: C.s(n), width: 2.4, dots: st.unit === "year", dotR: 2.6, points: un(k) }));
    linePanel(g2, { x: 0, y: 0, w: W, h: H2 }, {
      title: st.unit === "cum" ? "ข. แพทย์ใหม่ที่ไม่มีตำแหน่งรองรับ สะสมตั้งแต่ พ.ศ. 2569" : "ข. แพทย์ใหม่ที่ไม่มีตำแหน่งรองรับในแต่ละปี",
      x: { values: years, format: be }, y: { label: st.unit === "cum" ? "แพทย์ใหม่ที่ไม่มีตำแหน่งรองรับ (คน สะสม)" : "แพทย์ใหม่ที่ไม่มีตำแหน่งรองรับ (คนต่อปี)" },
      series: unSeries, vlines, endFormat: st.unit === "cum" ? fmt.int : null, noEnd: st.unit !== "cum", tickW, endW,
      tip: (x) => ({ title: `พ.ศ. ${be(x)}`, rows: unSeries.map((sr) => ({ label: sr.label, value: `${fmt.int(sr.points.find((p) => p.x === x)?.y)} คน${st.unit === "cum" ? " (สะสม)" : ""}`, color: sr.color })) }),
    }, env);
    return H1 + gap + H2;
  },
  table(st, D, ctx) {
    const { years, get } = this.data(st, D, { ...ctx, hidden: new Set() });
    const rows = [];
    for (const [k] of FRAME_PLANS) {
      let acc = 0;
      for (const y of years) {
        const r = get(k, y), u = Math.max(0, r?.unplaced || 0);
        acc += u;
        rows.push({ plan: lab(ctx, "plan_frame", k), y: be(y), s: r?.stock, c: r?.capacity, u, cu: acc });
      }
    }
    return { caption: "จำนวนแพทย์ ขีดรับ และแพทย์ใหม่ที่ไม่มีตำแหน่งรองรับ รายแผนและรายปี", columns: [{ key: "plan", label: "แผน" }, { key: "y", label: "พ.ศ." },
      { key: "s", label: "แพทย์", num: true, format: fmt.int }, { key: "c", label: "ขีดรับ", num: true, format: fmt.int },
      { key: "u", label: "ไม่มีตำแหน่ง (คนต่อปี)", num: true, format: fmt.int }, { key: "cu", label: "สะสม", num: true, format: fmt.int }], rows };
  },
};

const num = (str) => Number(String(str || "").replace(/[^\d.\-]/g, ""));
const F5F_FRONTIER = {
  needs: ["F5F_NATIONAL"],
  controls: () => [seg("m", "แกนตั้ง", [opt("bq", "ความเพียงพอของจังหวัดกลุ่มล่าง พ.ศ. 2583"), opt("vac", "ตำแหน่งที่ยังว่าง พ.ศ. 2583")])],
  legend: (st, D, ctx) => [{ key: "F1", label: lab(ctx, "frontier_rule", "F1"), color: C.s(2), shape: "line", toggle: true },
    { key: "F2", label: lab(ctx, "frontier_rule", "F2"), color: C.s(1), shape: "line", toggle: true },
    { key: "F0", label: lab(ctx, "plan_frame", "P-R|F0"), color: C.s(3), shape: "rect" }, { key: "need", label: lab(ctx, "plan_frame", "P-R|need"), color: C.s(4), shape: "dot" }],
  ends(D) {
    const nat = D.F5F_NATIONAL || [], last = Math.max(...nat.map((r) => r.year_ce));
    const f0 = nat.find((r) => r.plan_id === "P-R|F0" && r.year_ce === last), nd = nat.find((r) => r.plan_id === "P-R|need" && r.year_ce === last);
    const first = nat.find((r) => r.plan_id === "P-R|need" && r.year_ce === Math.min(...nat.map((q) => q.year_ce)));
    return { f0, nd, ndAdded: nd && first ? nd.positions - first.positions : null };
  },
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), H = Math.round(Math.max(320, Math.min(480, W * 0.66)));
    const fy = st.m === "bq" ? (r) => r.bottom19_P_2040 : (r) => Math.max(0, r.vacancy_2040);
    const { f0, nd, ndAdded } = this.ends(D);
    const origin = { x: 0, y: st.m === "bq" ? f0?.bottom19_P : Math.max(0, (f0?.capacity || 0) - (f0?.stock || 0)) };
    const rules = ["F1", "F2"].filter((k) => !ctx.hidden.has(k));
    const lines = rules.map((k) => ({ k, color: C.s(k === "F1" ? 2 : 1), pts: [origin, ...D.main.filter((r) => r.rule === k).map((r) => ({ x: r.added_total, y: fy(r), r })).sort((a, b) => a.x - b.x)] }));
    const allY = lines.flatMap((l) => l.pts.map((p) => p.y)).concat(nd && st.m === "bq" ? [nd.bottom19_P] : []).filter(Number.isFinite);
    const allX = lines.flatMap((l) => l.pts.map((p) => p.x)).concat(ndAdded ? [ndAdded] : []);
    const yd = st.m === "bq" ? nice([Math.min(...allY) - 0.01, Math.max(...allY) + 0.01], 5) : nice([0, Math.max(...allY) * 1.05], 5);
    const xd = nice([0, Math.max(...allX) * 1.04], 5);
    const yt = tickValues(yd[0], yd[1], 5), yf = st.m === "bq" ? dec2 : fmt.int;
    const tickW = Math.max(...yt.map((v) => textWidth(yf(v), 11.5)));
    const plot = { x0: tickW + 10, x1: W - 16, y0: 22, y1: H - 44 };
    const x = linear(xd, [plot.x0 + 4, plot.x1 - 8]), y = linear(yd, [plot.y1 - 4, plot.y0 + 4]);
    yAxis(g, y, plot, { ticks: yt, format: yf, label: st.m === "bq" ? "ความเพียงพอของจังหวัดกลุ่มล่าง พ.ศ. 2583" : "ตำแหน่งที่ยังว่าง พ.ศ. 2583" });
    const xt = tickValues(xd[0], xd[1], W < 480 ? 4 : 5);
    for (const v of xt) g.append(s("line", { class: "rv-grid", x1: x(v), x2: x(v), y1: plot.y0, y2: plot.y1 }));
    xAxis(g, x, plot, xt, fmt.int, { label: "ตำแหน่งที่เพิ่มในสิบห้าปี" });
    const main = D.main.find((r) => r.plan_id === "P-R");
    if (st.m === "bq" && main) {
      g.append(s("line", { class: "rv-ref", x1: plot.x0, x2: plot.x1, y1: y(main.bottom19_P_2040), y2: y(main.bottom19_P_2040) }));
      const ex = num(ctx.text?.equiv_x);
      if (Number.isFinite(ex) && ex > 0 && !ctx.hidden.has("F1")) {
        g.append(paint(s("circle", { cx: x(ex), cy: y(main.bottom19_P_2040), r: 7 }), { fill: "none", stroke: C.ink, width: 1.4 }));
        const lines2 = wrap(ctx.text.equiv, Math.min(260, W * 0.42), 11.5);
        const tx = Math.min(x(ex) + 14, plot.x1 - Math.min(260, W * 0.42)), ty = y(main.bottom19_P_2040) + 26;
        textLines(g, tx, ty, lines2, "rv-note", 15);
      }
    }
    for (const l of lines) {
      g.append(paint(s("path", { d: l.pts.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(""), class: "rv-line" }), { stroke: l.color, width: 2.4, fill: "none", cap: "round" }));
      const pct = (r) => `${fmt.dec((r.growth_per_frame * 100) % 1 ? 1 : 0)(r.growth_per_frame * 100)}%`;
      const pts = l.pts.slice(1);
      pts.forEach((p, i) => {
        const near = (q) => q && Math.hypot(x(q.x) - x(p.x), y(q.y) - y(p.y)) < 16;
        if (near(pts[i - 1])) return;                       // labelled with the point before it
        const lab2 = near(pts[i + 1]) ? `${pct(p.r)} และ ${pct(pts[i + 1].r)}` : pct(p.r);
        text(g, x(p.x) + 9, y(p.y) + (l.k === "F1" ? 15 : -9), lab2, "rv-plab");
      });
      for (const p of pts) {
        const c = paint(s("circle", { cx: x(p.x), cy: y(p.y), r: 4.6, class: "rv-dot" }), { fill: l.color, stroke: C.surface, width: 1.4 });
        g.append(c);
        if (!env?.export) bindTip(c, () => ({ title: p.r.label, rows: [{ label: "ตำแหน่งที่เพิ่มในสิบห้าปี", value: fmt.int(p.r.added_total) },
          { label: "ความเพียงพอของจังหวัดกลุ่มล่าง พ.ศ. 2583", value: dec3(p.r.bottom19_P_2040) }, { label: "ตำแหน่งที่ยังว่าง พ.ศ. 2583", value: fmt.int(Math.max(0, p.r.vacancy_2040)) },
          { label: "แพทย์ใหม่ที่ไม่มีตำแหน่งรองรับ (สะสม)", value: fmt.int(Math.max(0, p.r.unplaced_total)) }] }));
      }
    }
    if (Number.isFinite(origin.y)) g.append(paint(s("rect", { x: x(0) - 6, y: y(origin.y) - 6, width: 12, height: 12, rx: 2 }), { fill: C.s(3), stroke: C.surface, width: 1.4 }));
    if (nd && ndAdded && st.m === "bq") {
      const dx = x(ndAdded), dy = y(nd.bottom19_P);
      g.append(paint(s("path", { d: `M${dx},${dy - 8}L${dx + 8},${dy}L${dx},${dy + 8}L${dx - 8},${dy}Z` }), { fill: C.s(4), stroke: C.surface, width: 1.4 }));
    }
    return H;
  },
  table: (st, D, ctx) => ({ caption: "แผนที่เพิ่มตำแหน่งในอัตราต่างกัน", columns: [{ key: "label", label: "แผน" }, { key: "added_total", label: "ตำแหน่งที่เพิ่ม", num: true, format: fmt.int },
    { key: "bottom19_P_2040", label: "กลุ่มล่าง 2583", num: true, format: dec3 }, { key: "vacancy_2040", label: "ว่าง 2583", num: true, format: (v) => fmt.int(Math.max(0, v)) },
    { key: "unplaced_total", label: "ไม่มีตำแหน่ง (สะสม)", num: true, format: (v) => fmt.int(Math.max(0, v)) }], rows: [...D.main].sort((a, b) => a.rule.localeCompare(b.rule) || a.added_total - b.added_total) }),
};

const ADD_BINS = [[0, 0.5, "ไม่เพิ่ม", C.none], [0.5, 19.5, "1–19", C.seq(2)], [19.5, 49.5, "20–49", C.seq(4)], [49.5, 99.5, "50–99", C.seq(5)], [99.5, Infinity, "100 ขึ้นไป", C.seq(7)]];
const DEN_BINS = [[0, 35, "ต่ำกว่า 35", C.seq(1)], [35, 40, "35–39", C.seq(2)], [40, 45, "40–44", C.seq(4)], [45, 55, "45–54", C.seq(5)], [55, Infinity, "55 ขึ้นไป", C.seq(7)]];
const binOf = (bins, v) => bins.find(([a, b]) => v >= a && v < b);
const F5F_MAP_FIRST_FRAME = {
  needs: ["geo"],
  controls: () => [seg("map", "แผนที่", [opt("added", "ตำแหน่งใหม่รอบ 2570–2574"), opt("den", "แพทย์ สธ. ต่อประชากรแสนคน 2568")])],
  legend: (st) => [...(st.map === "added" ? ADD_BINS : DEN_BINS).map(([, , l, c], i) => ({ key: `b${i}`, label: l, color: c, shape: "rect" })),
    ...(st.map === "added" ? [{ key: "need", label: "เส้นขอบทึบ: รายการมั่นคง ขาดแพทย์", shape: "outline" }, { key: "commit", label: "เส้นขอบประ: รายการมั่นคง รับแพทย์ผูกพันหรือผู้กลับจากฝึกอบรม", shape: "outline-dash" }] : []),
    { key: "bkk", label: "กรุงเทพฯ (ไม่อยู่ในแบบจำลอง)", shape: "hatch" }],
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), rows = byCode(D.main), kind = new Map((D.F5F_FIRST_FRAME || []).map((r) => [code(r.prov_code), r.robust_kind]));
    const KIND = { need: "รายการมั่นคง: ขาดแพทย์", commit: "รายการมั่นคง: รับแพทย์ผูกพันหรือผู้กลับจากฝึกอบรม" };
    const out = mapPanel(g, { x: 0, y: 0, w: W, h: 0 }, {
      geo: D.geo, maxH: env?.export ? 900 : Math.min(720, Math.max(460, W * 1.15)), excluded: new Set(["10"]),
      fill: (c) => { const r = rows.get(c); if (!r) return null; const b = st.map === "added" ? binOf(ADD_BINS, r.added_first_frame) : binOf(DEN_BINS, r.physicians_per100k); return b ? b[3] : null; },
      outline: st.map === "added" ? (c) => (kind.get(c) === "need" ? {} : kind.get(c) === "commit" ? { dash: true } : null) : null,
      tip: (c, p) => {
        const r = rows.get(c);
        if (!r) return null;
        return { title: p.name, rows: [{ label: "ตำแหน่งใหม่รอบ 2570–2574", value: fmt.int(r.added_first_frame) }, { label: "แพทย์ สธ. ต่อประชากรแสนคน 2568", value: dec1(r.physicians_per100k) },
          { label: "รายการมั่นคง", value: KIND[kind.get(c)] ? KIND[kind.get(c)].replace("รายการมั่นคง: ", "") : "ไม่อยู่ในรายการ" }] };
      },
    }, env);
    return out.height + 4;
  },
  table: (st, D) => {
    const kind = new Map((D.F5F_FIRST_FRAME || []).map((r) => [code(r.prov_code), r.robust_kind]));
    const name = new Map((D.F5F_FIRST_FRAME || []).map((r) => [code(r.prov_code), r.province]));
    return { caption: "ตำแหน่งใหม่รอบ 2570–2574 ตามแผนหลัก และแพทย์ต่อประชากรแสนคน", columns: [{ key: "c", label: "จังหวัด" }, { key: "added_first_frame", label: "ตำแหน่งใหม่", num: true, format: fmt.int },
      { key: "physicians_per100k", label: "แพทย์ต่อแสน", num: true, format: dec1 }, { key: "k", label: "รายการมั่นคง" }],
    rows: [...D.main].map((r) => ({ ...r, c: name.get(code(r.prov_code)) || code(r.prov_code), k: { need: "ขาดแพทย์", commit: "แพทย์ผูกพัน/ผู้กลับจากฝึก" }[kind.get(code(r.prov_code))] || "" }))
      .sort((a, b) => b.added_first_frame - a.added_first_frame) };
  },
};

const GOV = [["P-R", 1], ["P-R|F1", 2], ["P-R|GDh5", 3], ["P-R|GDc5", 4]];
const F5F_GOV_DIRECTION = {
  controls: () => [seg("view", "มุมมอง", [opt("bq", "ความเพียงพอของจังหวัดกลุ่มล่าง"), opt("cap", "ขีดรับ พ.ศ. 2583")], "bq", { reset: true })],
  legend: (st, D, ctx) => st.view === "bq" ? GOV.map(([k, n]) => ({ key: k, label: lab(ctx, "plan_gov", k), color: C.s(n), shape: "line", toggle: true }))
    : [{ key: "civil", label: "ข้าราชการ (แพทย์ในพื้นที่ตามตำแหน่ง)", color: C.seq(6), shape: "rect" }, { key: "emp", label: "ลูกจ้าง", color: C.seq(3), shape: "rect" }],
  draw(svg, W, st, D, ctx, env) {
    const rows = D.main, years = sorted(rows.map((r) => r.year_ce)), last = years[years.length - 1];
    if (st.view === "bq") {
      const H = lineH(W);
      const series = GOV.filter(([k]) => !ctx.hidden.has(k)).map(([k, n]) => ({ key: k, label: lab(ctx, "plan_gov", k), color: C.s(n), width: 2.4,
        points: years.map((y) => ({ x: y, y: rows.find((r) => r.plan_id === k && r.year_ce === y)?.bottom19_P })) }));
      linePanel(G(svg), { x: 0, y: 0, w: W, h: H }, {
        x: { values: years, format: be }, y: { label: "ความเพียงพอของจังหวัดกลุ่มล่าง (เกณฑ์ประชากร)", zero: false }, series, endFormat: dec3,
        tip: (x) => ({ title: `พ.ศ. ${be(x)}`, rows: series.map((sr) => ({ label: sr.label, value: dec3(sr.points.find((p) => p.x === x)?.y), color: sr.color })) }),
      }, env);
      return H;
    }
    const cats = GOV.map(([k]) => ({ key: k, label: lab(ctx, "plan_gov", k), r: rows.find((r) => r.plan_id === k && r.year_ce === last) }));
    const out = hbarPanel(G(svg), { x: 0, y: 0, w: W, h: 0 }, {
      cats, series: [{ key: "civil", color: C.seq(6) }, { key: "emp", color: C.seq(3) }], stacked: true, valueLabels: true, rowH: 40, labelW: Math.min(230, W * 0.42),
      value: (c, sr) => (sr.key === "civil" ? c.r.capacity - c.r.employees : c.r.employees), x: { format: fmt.int, label: "แพทย์ในพื้นที่ที่กรอบรับได้ ปี 2583 (คน)" },
      tip: (c) => ({ title: c.label, rows: [{ label: "ขีดรับรวม", value: fmt.int(c.r.capacity) }, { label: "ข้าราชการ", value: fmt.int(c.r.capacity - c.r.employees), color: C.seq(6), swatch: "rect" },
        { label: "ลูกจ้าง", value: fmt.int(c.r.employees), color: C.seq(3), swatch: "rect" }, { label: "ตำแหน่งข้าราชการ", value: fmt.int(c.r.positions) }] }),
    }, env);
    return out.height;
  },
  table: (st, D, ctx) => ({ caption: "ความเพียงพอของจังหวัดกลุ่มล่างและขีดรับ รายแผนและรายปี", columns: [{ key: "plan", label: "แผน", format: (v) => lab(ctx, "plan_gov", v) },
    { key: "year_be", label: "พ.ศ." }, { key: "bottom19_P", label: "กลุ่มล่าง", num: true, format: dec3 }, { key: "capacity", label: "ขีดรับ", num: true, format: fmt.int },
    { key: "employees", label: "ลูกจ้าง", num: true, format: fmt.int }, { key: "positions", label: "ตำแหน่งข้าราชการ", num: true, format: fmt.int }],
  rows: GOV.flatMap(([k]) => D.main.filter((r) => r.plan_id === k).sort((a, b) => a.year_ce - b.year_ce).map((r) => ({ ...r, plan: k }))) }),
};

const MODES = ["fixed_schedule_same_paths", "adaptive_replanning", "perfect_foresight_bound"];
const CRIT_PLAN = { P: "P-R", S: "S-R", N: "N-R" };
const F5A_UNCERTAINTY = {
  controls: (D, ctx) => [
    seg("view", "เทียบ", [opt("modes", "แผนตายตัวกับการปรับแผนรายปี"), opt("plans", "ทุกแผน (แผนตายตัว)")]),
    seg("crit", "เกณฑ์", ["P", "S", "N"].map((k) => opt(k, lab(ctx, "criterion", k)))),
  ],
  legend: (st) => st.view === "modes" ? [{ key: "m", label: "ค่าเฉลี่ยของเส้นทาง", color: C.s(1), shape: "dot" }, { key: "r", label: "ช่วงร้อยละห้าถึงเก้าสิบห้าของเส้นทาง", color: C.s(1), shape: "line" }]
    : [{ key: "b", label: "กล่อง: ครึ่งกลางของเส้นทาง เส้น: ต่ำสุดถึงสูงสุด", color: C.seq(3), shape: "rect" }, { key: "m", label: "ค่ากลาง", color: C.ink, shape: "line" }],
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg);
    if (st.view === "modes") {
      const plan = CRIT_PLAN[st.crit];
      const rows = (D.T5_UNCERTAINTY_SUMMARY || []).filter((r) => r.plan_id === plan && r.criterion === st.crit && r.metric === "bottom_quartile_2040" && MODES.includes(r.mode));
      const cats = MODES.map((m) => ({ key: m, label: lab(ctx, "mode", m), r: rows.find((r) => r.mode === m) })).filter((c) => c.r);
      const lo = Math.min(...cats.map((c) => c.r.p05)), hi = Math.max(...cats.map((c) => c.r.p95));
      const dom = nice([lo - (hi - lo) * 0.15, hi + (hi - lo) * 0.15], 5);
      const out = dotPanel(g, { x: 0, y: 0, w: W, h: 0 }, {
        title: `${lab(ctx, "plan_basis", plan)}: ความเพียงพอของจังหวัดกลุ่มล่าง พ.ศ. 2583 วัดด้วยเกณฑ์${lab(ctx, "criterion", st.crit)}`,
        cats, series: [{ key: "m", color: C.s(1) }], rowH: 46, valueLabels: true,
        get: (c) => ({ v: c.r.mean, lo: c.r.p05, hi: c.r.p95 }), x: { domain: dom, format: dec3, label: "ความเพียงพอของจังหวัดกลุ่มล่าง" },
        tip: (c) => ({ title: c.label, rows: [{ label: "ค่าเฉลี่ย", value: dec3(c.r.mean) }, { label: "ค่ากลาง", value: dec3(c.r.p50) }, { label: "ร้อยละห้า", value: dec3(c.r.p05) },
          { label: "ร้อยละเก้าสิบห้า", value: dec3(c.r.p95) }, { label: "เส้นทางที่ใช้ได้", value: fmt.int(c.r.n_valid) }] }),
      }, env);
      return out.height;
    }
    const rows = D.main.filter((r) => r.criterion === st.crit).sort((a, b) => b["50%"] - a["50%"]);
    const lo = Math.min(...rows.map((r) => r.min)), hi = Math.max(...rows.map((r) => r.max));
    const dom = nice([lo - 0.005, hi + 0.005], 5);
    const labelW = Math.min(250, Math.max(140, W * 0.4)), rowH = 28;
    const plot = { x0: labelW, x1: W - 12, y0: 8, y1: 8 + rowH * rows.length };
    const x = linear(dom, [plot.x0 + 6, plot.x1 - 4]);
    const xt = tickValues(dom[0], dom[1], W < 480 ? 4 : 6);
    for (const v of xt) { g.append(s("line", { class: "rv-grid", x1: x(v), x2: x(v), y1: plot.y0, y2: plot.y1 })); text(g, x(v), plot.y1 + 16, dec3(v), "rv-tick", { "text-anchor": "middle" }); }
    text(g, (plot.x0 + plot.x1) / 2, plot.y1 + 36, `ความเพียงพอของจังหวัดกลุ่มล่าง พ.ศ. 2583 วัดด้วยเกณฑ์ของแต่ละแผน`, "rv-axlab", { "text-anchor": "middle" });
    rows.forEach((r, i) => {
      const yy = plot.y0 + i * rowH + rowH / 2;
      const lines = wrap(lab(ctx, "plan_basis", r.plan_id), labelW - 12, 11.5);
      textLines(g, plot.x0 - 8, yy + 4 - (Math.min(2, lines.length) - 1) * 6.5, lines.slice(0, 2), "rv-cat", 13, { "text-anchor": "end" });
      g.append(paint(s("line", { x1: x(r.min), x2: x(r.max), y1: yy, y2: yy }), { stroke: C.muted, width: 1.4 }));
      g.append(paint(s("rect", { x: x(r["25%"]), y: yy - 7, width: Math.max(1, x(r["75%"]) - x(r["25%"])), height: 14, rx: 2, class: "rv-bar" }), { fill: C.seq(3) }));
      g.append(paint(s("line", { x1: x(r["50%"]), x2: x(r["50%"]), y1: yy - 8, y2: yy + 8 }), { stroke: C.ink, width: 2 }));
      if (!env?.export) {
        const hit = s("rect", { class: "rv-hit", x: 0, y: yy - rowH / 2, width: W, height: rowH });
        bindTip(hit, () => ({ title: lab(ctx, "plan_basis", r.plan_id), rows: [{ label: "ค่ากลาง", value: dec3(r["50%"]) }, { label: "ครึ่งกลาง", value: `${dec3(r["25%"])}–${dec3(r["75%"])}` },
          { label: "ต่ำสุด–สูงสุด", value: `${dec3(r.min)}–${dec3(r.max)}` }, { label: "เส้นทาง", value: fmt.int(r.count) }] }));
        g.append(hit);
      }
    });
    return plot.y1 + 46;
  },
  table(st, D, ctx) {
    if (st.view === "modes") {
      const rows = (D.T5_UNCERTAINTY_SUMMARY || []).filter((r) => r.plan_id === CRIT_PLAN[st.crit] && r.criterion === st.crit && r.metric === "bottom_quartile_2040" && MODES.includes(r.mode));
      return { caption: "ความเพียงพอของจังหวัดกลุ่มล่าง พ.ศ. 2583", columns: [{ key: "mode", label: "วิธี", format: (v) => lab(ctx, "mode", v) },
        ...["p05", "p50", "p95", "mean"].map((k) => ({ key: k, label: k, num: true, format: dec3 })), { key: "n_valid", label: "เส้นทาง", num: true }], rows };
    }
    return { caption: "ความเพียงพอของจังหวัดกลุ่มล่าง พ.ศ. 2583 ภายใต้แผนตายตัว", columns: [{ key: "plan_id", label: "แผน", format: (v) => lab(ctx, "plan_basis", v) },
      ...["min", "25%", "50%", "75%", "max"].map((k) => ({ key: k, label: k, num: true, format: dec3 }))], rows: D.main.filter((r) => r.criterion === st.crit) };
  },
};

const METHODS = [["hamilton_perry_national_control", 1], ["no_change_2019", 0], ["hamilton_perry_unconstrained", 2], ["linear_trend_totals_2013_2019", 3]];
const F5A_POP_BACKTEST = {
  initialHidden: ["hamilton_perry_unconstrained", "linear_trend_totals_2013_2019"],
  controls: () => [seg("view", "มุมมอง", [opt("ape", "ความคลาดเคลื่อนรายจังหวัด"), opt("s60", "สัดส่วนผู้สูงอายุ ฉายเทียบจริง")])],
  legend: (st, D, ctx) => st.view === "ape" ? METHODS.map(([k, n]) => ({ key: k, label: lab(ctx, "method", k), color: n ? C.s(n) : C.neutral, shape: "line", toggle: true }))
    : [{ key: "p", label: "จังหวัด (Hamilton–Perry ควบคุมยอดประเทศ)", color: C.s(1), shape: "dot" }, { key: "d", label: "เส้นทแยง: ฉายตรงกับจริง", color: C.muted, shape: "dash" }],
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg);
    if (st.view === "ape") {
      const H = lineH(W);
      const series = METHODS.filter(([k]) => !ctx.hidden.has(k)).map(([k, n]) => {
        const rows = D.main.filter((r) => r.method === k).sort((a, b) => a.ape_pct - b.ape_pct);
        return { key: k, label: lab(ctx, "method", k), color: n ? C.s(n) : C.neutral, width: 2.2, rows, points: rows.map((r, i) => ({ x: i + 1, y: r.ape_pct })) };
      });
      const n = Math.max(...series.map((sr) => sr.points.length), 1);
      linePanel(g, { x: 0, y: 0, w: W, h: H }, {
        x: { values: Array.from({ length: n }, (_, i) => i + 1), format: (v) => String(v), label: "จังหวัด เรียงจากคลาดเคลื่อนน้อยไปมาก" },
        y: { label: "ความคลาดเคลื่อนสัมบูรณ์ของประชากรที่ฉาย (%)" }, series, noEnd: true,
        tip: (x) => ({ title: `ลำดับที่ ${x}`, rows: series.map((sr) => ({ label: `${sr.label}: ${sr.rows[x - 1]?.province || ""}`, value: fmt.pct(2)(sr.rows[x - 1]?.ape_pct), color: sr.color })) }),
      }, env);
      return H;
    }
    const rows = D.main.filter((r) => r.method === "hamilton_perry_national_control" && Number.isFinite(r.share60_predicted));
    const v = rows.flatMap((r) => [100 * r.share60_observed, 100 * r.share60_predicted]);
    const dom = [Math.floor(Math.min(...v)) - 1, Math.ceil(Math.max(...v)) + 1];
    const H = Math.round(Math.max(320, Math.min(480, W * 0.66)));
    scatterPanel(g, { x: 0, y: 0, w: W, h: H }, {
      diag: true, x: { domain: dom, label: "สัดส่วนผู้อายุหกสิบปีขึ้นไปจริง พ.ศ. 2568 (%)", format: (q) => fmt.dec(0)(q) }, y: { domain: dom, label: "สัดส่วนที่ฉาย (%)", format: (q) => fmt.dec(0)(q) },
      points: rows.map((r) => ({ x: 100 * r.share60_observed, y: 100 * r.share60_predicted, r: 4.4, color: C.s(1), label: r.province, datum: r })),
      tip: (p) => ({ title: p.datum.province, rows: [{ label: "จริง", value: fmt.pct(1)(100 * p.datum.share60_observed) }, { label: "ฉาย", value: fmt.pct(1)(100 * p.datum.share60_predicted) },
        { label: "ประชากรคลาดเคลื่อน", value: fmt.pct(2)(p.datum.ape_pct) }] }),
    }, env);
    return H;
  },
  table: (st, D, ctx) => ({ caption: "ประชากรรายจังหวัด พ.ศ. 2568 ที่ฉายเทียบจริง", columns: [{ key: "method", label: "วิธี", format: (v) => lab(ctx, "method", v) }, { key: "province", label: "จังหวัด" },
    { key: "observed_2025", label: "จริง", num: true, format: fmt.int }, { key: "predicted_2025", label: "ฉาย", num: true, format: fmt.int }, { key: "ape_pct", label: "คลาดเคลื่อน (%)", num: true, format: fmt.dec(2) }],
  rows: D.main.filter((r) => !ctx.hidden?.has?.(r.method)) }),
};

// ================================================================ ส่วนที่ 4
const OUTCOMES = ["itl_3y", "leave_area", "seek_private"];
const ISSUE = "ประเด็นที่ไม่พึงพอใจ";
const F77_DRIVERS = {
  controls: (D, ctx) => [seg("out", "ผลลัพธ์", OUTCOMES.map((k) => opt(k, lab(ctx, "outcome", k))))],
  legend: () => [{ key: "s", label: "ร้อยละที่ไม่พอใจ (ถ่วงน้ำหนัก)", color: C.neutral2, shape: "rect" },
    { key: "f", label: "ออดส์: ผ่านเกณฑ์ FDR", color: C.s(1), shape: "dot" }, { key: "n", label: "ออดส์: ไม่ผ่าน", color: C.s(1), shape: "hollow" }],
  rows(st, D) {
    const sat = new Map((D.T77_SATISFACTION || []).map((r) => [r["ประเด็น"], r]));
    return D.main.filter((r) => r.outcome === st.out).sort((a, b) => b.or - a.or).map((r) => ({ key: r[ISSUE], label: r[ISSUE], r, s: sat.get(r[ISSUE]) }));
  },
  draw(svg, W, st, D, ctx, env) {
    const g = G(svg), cats = this.rows(st, D);
    const lo = Math.min(...cats.map((c) => c.r.lo)), hi = Math.max(...cats.map((c) => c.r.hi));
    const dom = [Math.min(0.5, lo * 0.9), Math.max(2, hi * 1.08)];
    const tks = [0.25, 0.5, 1, 2, 4, 8, 16].filter((v) => v >= dom[0] && v <= dom[1]);
    const tip = (c) => ({ title: c.label, rows: [
      ...(c.s ? [{ label: "ไม่พอใจ (ถ่วงน้ำหนัก)", value: `${pct1(c.s["ไม่พึงพอใจ (%) ถ่วง"])} (${dec1(c.s["95% CI ล่าง"])}–${dec1(c.s["95% CI บน"])})` }] : []),
      { label: `ออดส์ของ${lab(ctx, "outcome", st.out)}`, value: `${dec2(c.r.or)} (${dec2(c.r.lo)}–${dec2(c.r.hi)})`, color: C.s(1) },
      { label: "q (FDR)", value: c.r.q < 0.001 ? "< 0.001" : dec3(c.r.q) }, { label: "ผ่านเกณฑ์ FDR", value: c.r["ผ่าน FDR"] ? "ผ่าน" : "ไม่ผ่าน" }] });
    const wide = W >= 560, rowH = 27;
    const labelW = Math.min(wide ? 250 : 190, W * (wide ? 0.34 : 0.5));
    const shareW = wide ? (W - labelW) * 0.36 : W;
    const orBox = wide ? { x: labelW + shareW, w: W - labelW - shareW } : { x: 0, w: W };
    const top = 22;
    text(g, wide ? labelW : labelW, 13, "ไม่พอใจ (%)", "rv-axlab");
    const sx = linear([0, Math.max(70, ...cats.map((c) => c.s?.["ไม่พึงพอใจ (%) ถ่วง"] || 0)) + 5], [labelW + 4, (wide ? labelW + shareW : W) - 40]);
    cats.forEach((c, i) => {
      const yy = top + i * rowH;
      const lines = wrap(c.label, labelW - 12, 11.5);
      textLines(g, labelW - 8, yy + rowH / 2 + 4 - (Math.min(2, lines.length) - 1) * 6.5, lines.slice(0, 2), "rv-cat", 13, { "text-anchor": "end" });
      if (c.s) {
        const v = c.s["ไม่พึงพอใจ (%) ถ่วง"];
        g.append(paint(s("rect", { class: "rv-bar", x: sx(0), y: yy + 6, width: Math.max(1, sx(v) - sx(0)), height: rowH - 12, rx: 2 }), { fill: C.neutral2 }));
        text(g, sx(v) + 4, yy + rowH / 2 + 4, fmt.dec(0)(v), "rv-val");
      }
    });
    const orTop = wide ? 0 : top + rowH * cats.length + 30;
    const og = s("g", { transform: `translate(${orBox.x},${orTop})` });
    g.append(og);
    if (!wide) text(og, labelW, 13, "ออดส์ (สเกลลอการิทึม)", "rv-axlab");
    const out = dotPanel(og, { x: 0, y: top - 6, w: orBox.w, h: 0 }, {
      cats, series: [{ key: "or", color: C.s(1) }], rowH, labelW: wide ? 0 : labelW,
      get: (c) => ({ v: c.r.or, lo: c.r.lo, hi: c.r.hi, filled: !!c.r["ผ่าน FDR"] }),
      x: { domain: dom, log: true, ref: 1, ticks: tks, format: (v) => (v < 1 ? String(v) : fmt.dec(0)(v)), label: "ออดส์ของผู้ที่ไม่พอใจ (หนึ่ง = ไม่ต่าง)" }, tip,
    }, env);
    if (wide) text(og, 6, 13, "ออดส์ (สเกลลอการิทึม)", "rv-axlab");
    if (!env?.export && wide) cats.forEach((c, i) => { const hit = s("rect", { class: "rv-hit", x: 0, y: top + i * rowH, width: labelW + shareW, height: rowH }); bindTip(hit, () => tip(c)); g.append(hit); });
    return orTop + top - 6 + out.height + 4;
  },
  table(st, D, ctx) {
    return { caption: `ความไม่พอใจกับ${lab(ctx, "outcome", st.out)}`, columns: [{ key: "label", label: "ประเด็น" }, { key: "s", label: "ไม่พอใจ (%)", num: true, format: (v) => dec1(v) },
      { key: "or", label: "OR", num: true, format: dec2 }, { key: "ci", label: "95% CI" }, { key: "q", label: "q", num: true, format: dec3 }, { key: "fdr", label: "FDR" }],
    rows: this.rows(st, D).map((c) => ({ label: c.label, s: c.s?.["ไม่พึงพอใจ (%) ถ่วง"], or: c.r.or, ci: `${dec2(c.r.lo)}–${dec2(c.r.hi)}`, q: c.r.q, fdr: c.r["ผ่าน FDR"] ? "ผ่าน" : "ไม่ผ่าน" })) };
  },
};

const F77_INTENTIONS = {
  controls: (D, ctx) => [seg("out", "ผลลัพธ์", OUTCOMES.map((k) => opt(k, lab(ctx, "outcome", k))))],
  legend: () => [{ key: "v", label: "ร้อยละถ่วงน้ำหนัก", color: C.s(1), shape: "dot" }, { key: "c", label: "ช่วงความเชื่อมั่นร้อยละเก้าสิบห้า", color: C.s(1), shape: "line" }],
  draw(svg, W, st, D, ctx, env) {
    const rows = D.main.filter((r) => r.outcome === st.out);
    const cats = rows.map((r) => ({ key: r["กลุ่ม"], label: r["กลุ่ม"], r }));
    const hi = Math.max(...rows.map((r) => r["95% CI บน"]));
    const out = dotPanel(G(svg), { x: 0, y: 0, w: W, h: 0 }, {
      title: lab(ctx, "outcome", st.out), cats, series: [{ key: "v", color: C.s(1) }], rowH: 32, valueLabels: true,
      get: (c) => ({ v: c.r["ร้อยละ (ถ่วง)"], lo: c.r["95% CI ล่าง"], hi: c.r["95% CI บน"] }),
      x: { domain: [0, Math.ceil((hi + 2) / 10) * 10], format: (v) => fmt.dec(0)(v), label: "ร้อยละของผู้ตอบ (ถ่วงน้ำหนัก)" },
      tip: (c) => ({ title: c.label, rows: [{ label: "ร้อยละ (ถ่วงน้ำหนัก)", value: pct1(c.r["ร้อยละ (ถ่วง)"]), color: C.s(1) },
        { label: "ช่วงความเชื่อมั่น", value: `${dec1(c.r["95% CI ล่าง"])}–${dec1(c.r["95% CI บน"])}` }, { label: "ผู้ตอบ", value: fmt.int(c.r["ผู้ตอบ"]) }] }),
    }, env);
    return out.height;
  },
  table: (st, D, ctx) => ({ caption: lab(ctx, "outcome", st.out), columns: [{ key: "กลุ่ม", label: "กลุ่ม" }, { key: "ผู้ตอบ", label: "ผู้ตอบ", num: true },
    { key: "ร้อยละ (ถ่วง)", label: "ร้อยละ", num: true, format: dec1 }, { key: "95% CI ล่าง", label: "ล่าง", num: true, format: dec1 }, { key: "95% CI บน", label: "บน", num: true, format: dec1 }],
  rows: D.main.filter((r) => r.outcome === st.out) }),
};

export const CHARTS = {
  F41_WORKFORCE_COUNTS, F424_DENOMINATOR_COMPARISON, F421_DENSITY_SCOPES, F45_DENSITY_VS_BURDEN, F45_BOD_MAP, F45_AGE_BURDEN,
  F46_RANK_DISAGREEMENT_MAP, F43_PRIORITY_SWITCHES, F46_SPECIALIST_CONCENTRATION, F47_FRAME_VS_NEED, F44_STOCK_FLOW, F44_PROVINCE_FLOWS,
  F54_ADEQUACY_AND_INEQUALITY, F5F_NATIONAL, F5F_FRONTIER, F5F_MAP_FIRST_FRAME, F5F_GOV_DIRECTION, F5A_UNCERTAINTY, F5A_POP_BACKTEST,
  F77_DRIVERS, F77_INTENTIONS,
};
