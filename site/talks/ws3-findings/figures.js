/* Figures for ws3-findings. Each FIGS[id](host) draws into the slide's figure slot
 * and returns { steps, setStep(n) }. Numbers come from F(id) with a claim id (resolved by
 * talks_build into TALKDATA.facts, so every drawn number is in the ledger) or from
 * TALKDATA series built from the research outputs. Colours: tokens only.
 * Going forward a step animates; going back or Read/print jumps to the end state.
 *
 * One type scale on every slide: a figure unit is 1.56 projected px at 1080p. The main
 * figure of a split slide is 640 units wide (the 999-px column), a wide slide's figure
 * 1132 units, and the second figure under the text column (sideHost, the lower-left)
 * 460 units. Sizes in units: 12 = 19 px (the floor for any label), 13 = 20 px,
 * 14 = 22 px, 16 = 25 px, 20 = 31 px, 28 = 44 px.
 */
(function () {
  "use strict";
  var U = window.HUD, S = U.S, H = U.H;
  var T = window.TALKDATA || {}, FACTS = T.facts || {};
  function F(id) { var v = FACTS[id]; if (v == null) { if (window.console) console.warn("missing fact " + id); return "?"; } return v; }
  function N(id) { return +String(F(id)).replace(/,/g, "").replace("%", ""); }
  var FIGS = {};

  // Step controller (shared, hud.js): only the new step animates; arrivals at a later step are static.
  var stepper = U.stepper;
  function txt(parent, x, y, s, size, cls, anchor, extra) {
    return S("text", Object.assign({ x: x, y: y, "font-size": size || 14, class: cls || "", "text-anchor": anchor || "start", text: s }, extra || {}), parent);
  }
  // A run of differently styled words on one line: parts = [[text, size, cls], ...]
  function runs(parent, x, y, parts, anchor) {
    var t = S("text", { x: x, y: y, "text-anchor": anchor || "start" }, parent);
    parts.forEach(function (p) { S("tspan", { "font-size": p[1], class: p[2] || "", text: p[0] }, t); });
    return t;
  }
  function fade(el, on, ms, jobs, delay) {
    if (!el) return;
    if (!ms) { el.style.opacity = on ? 1 : 0; return; }
    var from = +(el.style.opacity || (on ? 0 : 1));
    jobs.add(U.tween(ms, function (t) { el.style.opacity = from + ((on ? 1 : 0) - from) * t; }, { delay: delay || 0 }));
  }
  function later(jobs, ms, fn) { var tm = setTimeout(fn, ms); jobs.add({ stop: function () { clearTimeout(tm); } }); }
  function main(host, h, label) { var s = U.svgHost(host, "0 0 640 " + h, label, "xMidYMin meet"); U.defs(s); return s; }
  function wide(host, h, label, align) { var s = U.svgHost(host, "0 0 1132 " + h, label, align || "xMidYMid meet"); U.defs(s); return s; }
  function side(host, h, label) { var s = U.sideHost(host, "0 0 460 " + h, label); U.defs(s); return s; }
  // Push labels down so none sits closer than gap to the one above (sorted by y; sets p.ly).
  function stack(list, gap) { var last = -1e9; list.sort(function (a, b) { return a.y - b.y; }).forEach(function (p) { p.ly = Math.max(p.y, last + gap); last = p.ly; }); return list; }
  // Province map at a given height; stroke widths are given in screen units and divided by the scale.
  function mapAt(parent, x, y, h) {
    var G = T.geo || { w: 520, h: 960 }, sc = h / G.h;
    var g = S("g", { transform: "translate(" + x + "," + y + ") scale(" + sc.toFixed(4) + ")" }, parent);
    var m = U.map(g);
    m.sc = sc; m.x = x; m.y = y; m.W = G.w * sc; m.H = h;
    m.paint = function (code, fill, stroke, sw) { if (m.el[code]) m.el[code].setAttribute("style", "fill:" + fill + ";stroke:" + (stroke || "var(--line-strong)") + ";stroke-width:" + ((sw || 0.6) / sc).toFixed(2) + ";transition:fill .45s, stroke .45s"); };
    m.each = function (fn) { Object.keys(m.el).forEach(function (c) { if (c !== "10") fn(c); }); };
    m.at = function (code) { var p = m.pt[code]; return p ? { x: x + p[0] * sc, y: y + p[1] * sc } : null; };
    return m;
  }
  // Direct labels for map provinces: those west of split (share of the map's width, default 0.58,
  // so the north-east cluster keeps its labels on the right) go left, the rest right.
  function mapLabels(parent, m, codes, size, cls, gap, col, split) {
    var names = U.names(), mid = m.x + m.W * (split || 0.58), pts = codes.map(function (c) { var p = m.at(c); return p ? { c: c, x: p.x, y: p.y } : null; }).filter(Boolean);
    [[pts.filter(function (p) { return p.x < mid; }), m.x - 14, "end"], [pts.filter(function (p) { return p.x >= mid; }), m.x + m.W + 14, "start"]].forEach(function (side) {
      stack(side[0], gap).forEach(function (p) {
        var lx = side[1] + (side[2] === "end" ? 4 : -4);
        S("path", { d: "M" + p.x.toFixed(1) + "," + p.y.toFixed(1) + " L" + lx.toFixed(1) + "," + p.ly.toFixed(1), style: "fill:none;stroke:" + col + ";stroke-width:1.2;opacity:.8" }, parent);
        S("circle", { cx: p.x, cy: p.y, r: 3, style: "fill:" + col }, parent);
        txt(parent, side[1], p.ly + size * 0.36, names[p.c] || p.c, size, cls, side[2]);
      });
    });
  }

  /* ---------------- s01 title: Thailand as a constellation (the poster's night sky) ---------------- */
  FIGS.s01 = function (host) {
    var G = (T.geo || { w: 520, h: 960 });
    var svg = U.svgHost(host, "-30 -30 " + (G.w + 60) + " " + (G.h + 60), "แผนที่ประเทศไทย 76 จังหวัด แต่ละจังหวัดเป็นดาวหนึ่งดวง");
    var m = U.map(svg);
    Object.keys(m.el).forEach(function (c) { m.el[c].setAttribute("style", "fill:rgba(255,255,255,.028);stroke:rgba(255,214,170,.30);stroke-width:.9"); });
    var nodes = S("g", {}, svg), dots = [];
    Object.keys(m.pt).forEach(function (c, i) {
      if (c === "10") return;
      var warm = i % 4 === 0;
      dots.push({ el: S("circle", { cx: m.pt[c][0], cy: m.pt[c][1], r: warm ? 3.4 : 2.4, style: "fill:" + (warm ? "#ffd2a0" : "#eef1ff") }, nodes), ph: i * 0.77, sp: 0.7 + (i % 5) * 0.18 });
    });
    U.loop(svg, function (dt, ts) {
      dots.forEach(function (d) { d.el.style.opacity = 0.35 + 0.65 * Math.abs(Math.sin(ts / 1300 * d.sp + d.ph)); });
    });
    return { steps: 1, setStep: function () {} };
  };

  /* ---------------- s02 progress is real: growth index; the provinces it has not reached ---------------- */
  // A polyline's length from its points (getTotalLength is unreliable on slides not yet shown).
  function polyLen(pts) { var L = 0; for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
  // Draw a path from start to end over ms (static views: the whole path at once).
  function drawPath(p, len, anim, jobs, delay, ms) {
    if (!anim) { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; return; }
    p.style.strokeDasharray = len + " " + (len + 2); p.style.strokeDashoffset = len;
    jobs.add(U.tween(ms || 1500, function (t) { p.style.strokeDashoffset = len * (1 - t); if (t >= 1) { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; } }, { delay: delay || 0, ease: U.ease.inOut }));
  }
  FIGS.s02 = function (host) {
    var svg = main(host, 530, "แพทย์และพยาบาลเพิ่มเร็วกว่าประชากรมาก ดัชนี พ.ศ. 2556 เท่ากับ 100");
    var Gr = T.growth || { years: [], physicians: [], nurses: [], population: [] }, n = Gr.years.length;
    var X0 = 36, X1 = 384, V0 = 96, V1 = 176, Y0 = 470, Y1 = 92;
    function x(i) { return X0 + (X1 - X0) * i / Math.max(1, n - 1); }
    function y(v) { return Y0 - (v - V0) / (V1 - V0) * (Y0 - Y1); }
    txt(svg, 0, 22, "เพิ่มขึ้นเท่าใด เทียบกับปี 2556", 16, "t-strong");
    txt(svg, 0, 48, "ดัชนี ปี 2556 = 100", 13, "t-muted");
    // No y ticks: the end labels carry the values. One baseline at 100 and the two end years.
    S("line", { x1: X0, x2: X1, y1: y(100), y2: y(100), class: "axis" }, svg);
    txt(svg, X0 - 8, y(100) + 5, "100", 13, "t-muted", "end");
    if (n) { txt(svg, X0, y(100) + 34, String(Gr.years[0]), 13, "t-muted", "middle"); txt(svg, X1, y(100) + 34, String(Gr.years[n - 1]), 13, "t-muted", "middle"); }
    var series = [
      { key: "physicians", col: "var(--accent)", cls: "t-accent", lab: "แพทย์", pct: "c41_physicians_pct", a: "c41_physicians_start", b: "c41_physicians_end", big: 32, w: 4.5 },
      { key: "nurses", col: "var(--p1)", cls: "t-need", lab: "พยาบาล", pct: "c41_professional_nurses_pct", a: "c41_professional_nurses_start", b: "c41_professional_nurses_end", big: 28, w: 4.5 },
      { key: "population", col: "var(--neutral)", cls: "t-pro", lab: "ประชากร", pct: "c421_pop_pct", big: 24, w: 3.4, above: true }
    ];
    var lines = series.map(function (s) {
      var vals = Gr[s.key] || [], pts = vals.map(function (v, i) { return [x(i), y(v)]; });
      var p = S("path", { d: pts.map(function (q, i) { return (i ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(""),
        style: "fill:none;stroke:" + s.col + ";stroke-width:" + s.w + ";stroke-linejoin:round;stroke-linecap:round" }, svg);
      var ey = pts.length ? pts[pts.length - 1][1] : y(100), g = S("g", { style: "opacity:0" }, svg), lx = X1 + 18;
      S("circle", { cx: X1, cy: ey, r: 6, style: "fill:" + s.col }, g);
      if (s.above) { txt(g, lx, ey - 34, s.lab, 16, s.cls); txt(g, lx, ey - 2, "+" + F(s.pct) + "%", s.big, s.cls); }
      else {
        txt(g, lx, ey - 14, s.lab, 16, s.cls);
        txt(g, lx, ey + 22, "+" + F(s.pct) + "%", s.big, s.cls);
        txt(g, lx, ey + 46, F(s.a) + " → " + F(s.b) + " คน", 13, "t-muted");
      }
      return { p: p, len: polyLen(pts), g: g };
    });
    // Step 2, lower-left under "แต่มี 8 จังหวัด…": the provinces this progress has not reached, named.
    var sv = side(host, 330, "แปดจังหวัดที่อยู่กลุ่มต่ำสุดทุกตัวหารหลัก"), low = S("g", { style: "opacity:0" }, sv);
    var m = mapAt(low, 150, 6, 318);
    var codes = String(F("c46_dis_list_all_four")).split(/\s*,\s*/).map(U.codeOf).filter(Boolean);
    m.each(function (c) { m.paint(c, codes.indexOf(c) > -1 ? "var(--bad)" : "var(--surface-2)", codes.indexOf(c) > -1 ? "var(--bad-text)" : "var(--line-strong)", codes.indexOf(c) > -1 ? 0.9 : 0.4); });
    mapLabels(low, m, codes, 15, "t-bad", 25, "var(--bad-text)", 0.62);   // หนองบัวลำภู goes left, clear of สกลนคร
    var bk = m.at(U.codeOf("บึงกาฬ")), ring = null;
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        lines.forEach(function (L, i) {
          drawPath(L.p, L.len, anim, jobs, i * 450, 1500);
          if (anim) { L.g.style.opacity = 0; fade(L.g, true, 350, jobs, i * 450 + 1250); } else L.g.style.opacity = 1;
        });
        low.style.opacity = 0;
        if (ring) { ring.stop(); ring.g.remove(); ring = null; }
      }
      if (k === 2) {
        fade(low, true, anim ? 500 : 0, jobs, anim ? 150 : 0);
        if (bk && !ring) ring = U.pulse(low, bk.x, bk.y, 15, "var(--bad-text)");
      }
    });
  };

  /* ---------------- s03 / s18 provisioning diagram ---------------- */
  // The process boxes are context (grey outlines); the four seams are the point (filled markers,
  // 24-px labels). Geometry is shared with s18 so the closing slide returns to the same map.
  function provisioning(svg, opt) {
    opt = opt || {};
    var L = [["ความจำเป็นของประชาชน", 60], ["การตีความและการยอมรับ", 150], ["สิทธิ มาตรฐาน ผู้รับผิดชอบ", 240]];
    var R = [["การศึกษาและการฝึก", 60], ["การจ้างและการจัดงาน", 150], ["ชีวิตการทำงานและการธำรงคนในระบบ", 240]];
    txt(svg, 120, 16, "กระบวนการกำหนดพันธะ", 13, "t-muted", "middle");
    txt(svg, 500, 16, "กระบวนการสร้างขีดความสามารถ", 13, "t-muted", "middle");
    function node(x, y, label) {
      var g = S("g", {}, svg);
      S("rect", { x: x - 105, y: y - 22, width: 210, height: 44, rx: 6, style: "fill:none;stroke:var(--line-strong);stroke-width:1.2" }, g);
      txt(g, x, y + 5, label, 12.5, "t-muted", "middle");
      return g;
    }
    L.forEach(function (n) { node(120, n[1], n[0]); });
    R.forEach(function (n) { node(500, n[1], n[0]); });
    var out = S("g", {}, svg);
    S("rect", { x: 205, y: 378, width: 210, height: 44, rx: 6, style: "fill:var(--accent-soft);stroke:var(--accent-text);stroke-width:1.6" }, out);
    txt(out, 310, 405, "บริการที่ประชาชนได้รับจริง", 14, "t-accent", "middle");
    var paths = [
      "M120,82 V128", "M120,172 V218", "M500,82 V128", "M500,172 V218",
      "M120,262 C120,330 230,350 260,378", "M500,262 C500,330 390,350 360,378"
    ].map(function (d) { return S("path", { d: d, style: "fill:none;stroke:var(--accent);stroke-width:1.4;opacity:.7" }, svg); });
    // particles along the six paths
    var dots = [];
    paths.forEach(function (p, i) { for (var k = 0; k < 3; k++) dots.push({ p: p, len: p.getTotalLength ? p.getTotalLength() : 60, o: k / 3 + i * 0.07, el: S("circle", { r: 2.6, style: "fill:var(--accent);opacity:0" }, svg) }); });
    U.loop(svg, function (dt, ts) {
      dots.forEach(function (d) {
        var t = ((ts / 2600) + d.o) % 1, pt = d.p.getPointAtLength ? d.p.getPointAtLength(t * d.len) : { x: 0, y: 0 };
        d.el.setAttribute("cx", pt.x); d.el.setAttribute("cy", pt.y); d.el.style.opacity = Math.sin(t * Math.PI);
      });
    });
    if (U.isStatic()) dots.forEach(function (d) { d.el.style.display = "none"; });
    // The four seams. 1 sits on the dashed seam between the two bottom boxes and 4 under the service
    // box, each with its words below. 2 and 3 are markers in the gaps of the capacity column; their
    // words stand in the gutter between the two columns (clear of every box), joined to the marker
    // by a short leader. Line two is a plain-language gloss (s03) or the evidence (s18, opt.e).
    var breaks = [
      { x: 310, y: 240, n: "1", t: "มีสิทธิ แต่ไม่มีตำแหน่ง", g: "ไม่มีตำแหน่งให้จ้างคน บริการจึงไม่เกิด", place: "below", seam: [225, 395] },
      { x: 500, y: 105, n: "2", t: "ฝึกแล้ว แต่ไม่ถูกจ้าง", g: "ไม่มีตำแหน่งหรือผู้จ้างในพื้นที่", place: "left" },
      { x: 500, y: 195, n: "3", t: "จ้างแล้ว แต่อยู่ไม่ได้", g: "ทีม ภาระงาน ชีวิตในพื้นที่", place: "left" },
      { x: 310, y: 444, n: "4", t: "มีในสถิติ แต่คนที่จำเป็นเข้าไม่ถึง", g: "บริการไม่ถึงผู้ที่ต้องการที่สุด", place: "below" }
    ];
    // Each seam keeps handles to its marker and words, so s18 can clear the words and keep the marks.
    var parts = breaks.map(function (b, i) {
      var g = S("g", { style: "opacity:0" }, svg), line2 = opt.e ? opt.e[i] : b.g, cls2 = opt.e ? "t-accent" : "t-muted";
      var p = { g: g, x: b.x, y: b.y, words: [] };
      if (b.seam) S("line", { x1: b.seam[0], x2: b.seam[1], y1: b.y, y2: b.y, style: "stroke:var(--bad-text);stroke-width:2;stroke-dasharray:6 5" }, g);
      p.ring = S("circle", { cx: b.x, cy: b.y, r: 16, style: "fill:var(--bad);stroke:var(--bg);stroke-width:2" }, g);
      p.words.push(txt(g, b.x, b.y + 5.5, b.n, 16, "", "middle", { style: "fill:var(--inverse);font-weight:700" }));
      if (b.place === "left") {
        var gx = 384;
        p.words.push(S("path", { d: "M" + (gx + 8) + "," + b.y + " H" + (b.x - 17), style: "fill:none;stroke:var(--bad-text);stroke-width:1.4;opacity:.8" }, g));
        p.words.push(txt(g, gx, b.y + 5, b.t, 15.5, "t-bad", "end"));
        if (line2) p.words.push(txt(g, gx, b.y + 25, line2, 12, cls2, "end"));
      } else {
        p.words.push(txt(g, b.x, b.y + 40, b.t, 15.5, "t-bad", "middle"));
        if (line2) p.words.push(txt(g, b.x, b.y + 60, line2, 12, cls2, "middle"));
      }
      return p;
    });
    return { breaks: parts.map(function (p) { return p.g; }), parts: parts };
  }
  FIGS.s03 = function (host) {
    var svg = U.svgHost(host, "-10 0 640 516", "สองกระบวนการของการจัดให้มีบริการ และรอยต่อสี่จุด", "xMidYMin meet"); U.defs(svg);
    var d = provisioning(svg);
    // Step 2 reveals the seams in the order 1 to 4, so the click teaches the numbering (1.9 s).
    return stepper(host, 2, function (k, anim, jobs) {
      d.breaks.forEach(function (g, i) { if (k < 2) g.style.opacity = 0; else fade(g, true, anim ? 350 : 0, jobs, i * 500); });
    });
  };

  /* ---------------- s04 whose staff, against what ---------------- */
  // One leftward axis for every decrease on the slide: the two counting choices (step 1, top) and the
  // same MOPH doctors against four denominators (step 2). The scope circles sit in the lower-left.
  FIGS.s04 = function (host) {
    var svg = main(host, 530, "ความหนาแน่นแพทย์ขยับเท่าใดเมื่อเปลี่ยนเกณฑ์การนับ และแพทย์ สธ. เทียบตัวหารต่างชนิด");
    var Z = 330, K = 4.0;
    function X(v) { return Z + v * K; }
    var g1 = S("g", {}, svg), g2 = S("g", { style: "opacity:0" }, svg);
    txt(g1, 0, 22, "แพทย์ต่อประชากรลดลงเท่าใด เมื่อเปลี่ยนเกณฑ์การนับ (%)", 14, "t-muted");
    S("line", { x1: Z, x2: Z, y1: 40, y2: 172, class: "axis" }, g1);
    function strip(y, label, a, b, col, value, cls) {
      txt(g1, 0, y + 24, label, 15, "t-strong");
      var r = S("rect", { x: X(-a), y: y, width: 0, height: 34, rx: 4, style: "fill:" + col }, g1);
      var v = txt(g1, Z + 14, y + 26, value, 22, cls); v.style.opacity = 0;
      return { r: r, x0: X(-a), w: (b - a) * K, v: v };
    }
    var reg = [Math.abs(N("c421_register_gap_civil_grand")), Math.abs(N("c421_register_gap_nhso_rights"))].sort(function (p, q) { return p - q; });
    var strips = [
      strip(56, "ขอบเขตบุคลากร", N("c421_scope_gap_min_abs"), N("c421_scope_gap_max_abs"), "var(--accent)", "-" + F("c421_scope_gap_min_abs") + "% ถึง -" + F("c421_scope_gap_max_abs") + "%", "t-accent"),
      strip(120, "ทะเบียนประชากร", reg[0], reg[1], "var(--neutral)", F("c421_register_gap_civil_grand") + "% และ " + F("c421_register_gap_nhso_rights") + "%", "t-pro")
    ];
    // step 2: diverging bars, the same MOPH physicians against four denominators
    S("line", { x1: 0, y1: 200, x2: 640, y2: 200, style: "stroke:var(--line)" }, g2);
    txt(g2, 0, 232, "แพทย์ สธ. ชุดเดียวกัน เทียบกับตัวหารต่างชนิด (% เปลี่ยน)", 14, "t-muted");
    S("line", { x1: Z, y1: 248, x2: Z, y2: 516, class: "axis" }, g2);
    var rows = [
      ["ประชากร", "", "c424_moph_physicians_civil_population_long"],
      ["ครั้งผู้ป่วยนอก", "", "c424_moph_physicians_op_visits_moph_long"],
      ["วันนอน", "", "c424_moph_physicians_ip_days_moph_long"],
      ["งานผู้ป่วยใน", "ถ่วงความซับซ้อน (AdjRW)", "c424_moph_physicians_adjrw_casemix_long"]
    ];
    var bars = rows.map(function (r, i) {
      var y = 254 + i * 66, v = N(r[2]), w = Math.abs(v) * K;
      txt(g2, 0, y + (r[1] ? 18 : 28), r[0], 15, "t-strong");
      if (r[1]) txt(g2, 0, y + 38, r[1], 12, "t-muted");
      var b = S("rect", { x: Z, y: y + 6, width: 0, height: 34, rx: 4, style: "fill:" + (v < 0 ? "var(--p3)" : "var(--p1)") }, g2);
      var t = txt(g2, v < 0 ? Z - w - 10 : Z + w + 10, y + 31, (v > 0 ? "+" : "") + F(r[2]) + "%", 20, v < 0 ? "t-hosp" : "t-strong", v < 0 ? "end" : "start");
      t.style.opacity = 0;
      return { b: b, t: t, v: v, w: w };
    });
    // lower-left: the three scopes as nested circles (area = density), labels outside with leaders
    var sv = side(host, 260, "แพทย์ต่อประชากรแสนคนตามขอบเขต พ.ศ. 2568");
    var sc = [
      { id: "c421_dens_physicians_all_sectors_end", lab: "ทุกสังกัด", col: "var(--accent)", cls: "t-accent" },
      { id: "c421_dens_physicians_public_total_end", lab: "ภาครัฐ", col: "var(--p1)", cls: "t-need" },
      { id: "c421_dens_physicians_moph_end", lab: "สธ.", col: "var(--p2)", cls: "t-strong" }
    ];
    var maxv = N(sc[0].id), base = 252, R0 = 112, cx = 124, circles = [], lastY = -1e9;
    sc.forEach(function (s) {
      var r = R0 * Math.sqrt(N(s.id) / maxv), top = base - 2 * r, ly = Math.max(top, lastY + 32); lastY = ly;
      var c = S("circle", { cx: cx, cy: base - r, r: 0, style: "fill:" + s.col + ";fill-opacity:.13;stroke:" + s.col + ";stroke-width:2" }, sv);
      var lab = S("g", { style: "opacity:0" }, sv);
      S("path", { d: "M" + cx + "," + top.toFixed(1) + " L248," + top.toFixed(1) + " L272," + ly.toFixed(1), style: "fill:none;stroke:var(--line-strong);stroke-width:1" }, lab);
      S("circle", { cx: cx, cy: top, r: 3, style: "fill:" + s.col }, lab);
      runs(lab, 282, ly + 7, [[s.lab + " ", 15, "t-strong"], [F(s.id), 20, s.cls]]);
      circles.push({ c: c, r: r, lab: lab });
    });
    txt(sv, 282, 226, "แพทย์ต่อประชากรแสนคน", 13, "t-muted");
    txt(sv, 282, 248, "พ.ศ. 2568", 13, "t-muted");
    return stepper(host, 2, function (step, anim, jobs) {
      if (step === 1) {
        g2.style.opacity = 0;
        circles.forEach(function (c, i) {
          jobs.add(U.tween(anim ? 800 : 0, function (t) { c.c.setAttribute("r", c.r * t); }, { delay: i * 200, ease: U.ease.back }));
          fade(c.lab, true, anim ? 350 : 0, jobs, 600 + i * 200);
        });
        strips.forEach(function (s, i) {
          jobs.add(U.tween(anim ? 900 : 0, function (t) { s.r.setAttribute("width", s.w * t); s.r.setAttribute("x", s.x0 - s.w * t); }, { delay: 300 + i * 300 }));
          fade(s.v, true, anim ? 350 : 0, jobs, 900 + i * 300);
        });
      }
      if (step === 2) {
        fade(g2, true, anim ? 350 : 0, jobs);
        bars.forEach(function (b, i) {
          jobs.add(U.tween(anim ? 800 : 0, function (t) { b.b.setAttribute("width", b.w * t); if (b.v < 0) b.b.setAttribute("x", Z - b.w * t); }, { delay: 200 + i * 220 }));
          fade(b.t, true, anim ? 300 : 0, jobs, 700 + i * 220);
        });
      }
    });
  };

  /* ---------------- s05 switching rulers: one map; the rulers, then the four main denominators ---------------- */
  FIGS.s05 = function (host) {
    var svg = main(host, 530, "จังหวัดกลุ่มต่ำสุดเมื่อสลับไม้บรรทัดหกชนิด และการจัดกลุ่มตามสี่ตัวหารหลัก");
    var R = T.rulers || {}, order = R.six_order || [], groups = R.groups || {};
    var m = mapAt(svg, 118, 4, 520);
    var base = function (c) { m.paint(c, "var(--surface-2)", "var(--line-strong)", 0.5); };
    m.each(base);
    // step 1: two counters beside the map
    var cnt = S("g", {}, svg);
    txt(cnt, 430, 286, "เคยอยู่กลุ่มต่ำสุด", 14, "t-muted");
    var everN = txt(cnt, 430, 338, "0", 44, "t-strong");
    txt(cnt, 430 + 70, 338, "จังหวัด", 14, "t-muted");
    txt(cnt, 430, 400, "อยู่ทุกไม้บรรทัดทั้งหก", 14, "t-muted");
    var allN = txt(cnt, 430, 452, "19", 44, "t-bad");
    txt(cnt, 430 + 70, 452, "จังหวัด", 14, "t-muted");
    // step 2: the eight core provinces named on the map
    var core = String(F("c46_dis_list_all_four")).split(/\s*,\s*/).map(U.codeOf).filter(Boolean);
    var named = S("g", { style: "opacity:0" }, svg);
    mapLabels(named, m, core, 14, "t-bad", 24, "var(--bad-text)");
    // lower-left slot: the six rulers (step 1), swapped for the four main denominators (step 2)
    var sv = side(host, 230, "ไม้บรรทัดหกชนิด และสี่ตัวหารหลัก");
    var tabs = S("g", {}, sv);
    txt(tabs, 0, 18, "ไม้บรรทัดที่ใช้จัดอันดับ", 14, "t-muted");
    var chips = order.map(function (d, i) {
      var x = (i % 2) * 232, y = 34 + Math.floor(i / 2) * 44, g = S("g", {}, tabs);
      var box = S("rect", { x: x, y: y, width: 222, height: 36, rx: 8, style: "fill:var(--card);stroke:var(--line);transition:fill .3s, stroke .3s" }, g);
      var t = txt(g, x + 14, y + 24, (R.six_th || {})[d] || d, 14, "t-muted");
      var dot = S("circle", { cx: x + 204, cy: y + 18, r: 5, style: "fill:var(--bad-text);opacity:0" }, g);
      return { box: box, t: t, dot: dot };
    });
    function setTab(i, visitedUpTo) {
      chips.forEach(function (c, j) {
        var on = j === i;
        c.box.setAttribute("style", "fill:" + (on ? "var(--bad-soft)" : "var(--card)") + ";stroke:" + (on ? "var(--bad-text)" : "var(--line)") + ";transition:fill .3s, stroke .3s");
        c.t.setAttribute("class", on ? "t-strong" : "t-muted");
        c.dot.style.opacity = j <= visitedUpTo && !on ? 1 : 0;
      });
    }
    var leg = S("g", { style: "opacity:0" }, sv);
    txt(leg, 0, 18, "สี่ตัวหารหลัก", 15, "t-strong");
    txt(leg, 0, 44, "ประชากร · บริการที่เกิดขึ้น · บริการคาดหมายมาตรฐาน · ภาระโรค", 13, "t-muted");
    [["var(--bad)", "ต่ำทุกตัวหารหลัก", F("c46_dis_n_all_four") + " จังหวัด", "t-bad"],
     ["var(--accent)", "ต่ำตามภาระโรค ไม่ต่ำตามบริการ", F("c46_dis_n_burden_not_service") + " จังหวัด", "t-accent"],
     ["var(--p1)", "ต่ำตามบริการ ไม่ต่ำตามภาระโรค", F("c46_dis_n_service_not_burden") + " จังหวัด", "t-need"]].forEach(function (r, i) {
      var y = 86 + i * 40;
      S("rect", { x: 0, y: y - 15, width: 18, height: 18, rx: 4, style: "fill:" + r[0] }, leg);
      runs(leg, 30, y, [[r[1] + "  ", 15, "t-strong"], [r[2], 15, r[3]]]);
    });
    function sets() { return order.map(function (d) { return (R.six || {})[d] || []; }); }
    function summary() {
      var S6 = sets(), ever = {}, all = S6.length ? S6[0].slice() : [];
      S6.forEach(function (s) { s.forEach(function (c) { ever[c] = 1; }); all = all.filter(function (c) { return s.indexOf(c) > -1; }); });
      m.each(function (c) { if (all.indexOf(c) > -1) m.paint(c, "var(--bad)", "var(--bad-text)", 0.8); else if (ever[c]) m.paint(c, "var(--bad-soft)", "var(--line-strong)", 0.5); else base(c); });
      setTab(-1, order.length - 1);
      everN.textContent = F("c43_pri_any6_n"); allN.textContent = F("c43_pri_all6_n");
    }
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        leg.style.opacity = 0; named.style.opacity = 0; tabs.style.opacity = 1; cnt.style.opacity = 1;
        if (!anim) { summary(); return; }
        var S6 = sets(), ever = {}, inter = null, shownEver = 0, shownAll = 19;
        m.each(base); setTab(-1, -1); everN.textContent = "0"; allN.textContent = "19";
        S6.forEach(function (set, i) {
          later(jobs, 250 + i * 1000, function () {
            set.forEach(function (c) { ever[c] = 1; });
            inter = inter ? inter.filter(function (c) { return set.indexOf(c) > -1; }) : set.slice();
            m.each(function (c) { if (set.indexOf(c) > -1) m.paint(c, "var(--bad)", "var(--bad-text)", 0.8); else if (ever[c]) m.paint(c, "var(--bad-soft)", "var(--line-strong)", 0.5); else base(c); });
            setTab(i, i - 1);
            var e = Object.keys(ever).length, a = inter.length;
            jobs.add(U.count(everN, U.fmt(e), { from: shownEver, ms: 420 })); shownEver = e;
            jobs.add(U.count(allN, U.fmt(a), { from: shownAll, ms: 420 })); shownAll = a;
          });
        });
        later(jobs, 250 + S6.length * 1000, summary);
      }
      if (k === 2) {
        m.each(function (c) {
          var gname = groups[c];
          if (gname === "all_four") m.paint(c, "var(--bad)", "var(--bad-text)", 0.8);
          else if (gname === "burden_not_service") m.paint(c, "var(--accent)", "var(--accent-text)", 0.6);
          else if (gname === "service_not_burden") m.paint(c, "var(--p1)", "var(--p1-text)", 0.6);
          else base(c);
        });
        // the same slot changes meaning: rulers out, denominators in; the counters give way to names
        fade(tabs, false, anim ? 250 : 0, jobs); fade(cnt, false, anim ? 250 : 0, jobs);
        fade(leg, true, anim ? 350 : 0, jobs, anim ? 250 : 0); fade(named, true, anim ? 350 : 0, jobs, anim ? 350 : 0);
      }
    });
  };

  /* ---------------- s06 burden: ageing (lower-left), then doctors against the burden (the map) ---------------- */
  // Doctors-to-burden index (national = 1) in four diverging classes: a light and a mid pink for the
  // two deficit classes (one hue, lightness falling toward the middle), a neutral grey for "near",
  // the comparison blue for "above". Checked on the night ground: neighbouring classes differ by
  // 2.2, 1.8 and 1.9 to 1 in luminance, every pair by OKLab dE >= 19 (worst CVD pair 8.5, and the
  // five lowest are labelled), every class >= 3:1 against the ground.
  var BURDEN_BANDS = [
    { max: 0.5, lab: "น้อยกว่าครึ่งหนึ่ง", fill: "#ffa9d3" },
    { max: 0.8, lab: "ต่ำกว่าค่าประเทศ", fill: "var(--bad)" },
    { max: 1.25, lab: "ใกล้ค่าประเทศ", fill: "#585d6f" },
    { max: 1e9, lab: "สูงกว่าค่าประเทศ", fill: "var(--p1)" }
  ];
  function band(v) { for (var i = 0; i < BURDEN_BANDS.length; i++) if (v < BURDEN_BANDS[i].max) return BURDEN_BANDS[i]; return BURDEN_BANDS[BURDEN_BANDS.length - 1]; }
  FIGS.s06 = function (host) {
    var svg = main(host, 530, "ภาระโรคปรับอายุ ต่ำสุดที่นนทบุรีและสูงสุดที่ชัยภูมิ แล้วแพทย์ทุกสังกัดเทียบกับภาระโรครายจังหวัด แพทย์ยังกระจุกอยู่ในจังหวัดที่ภาระโรคต่ำ");
    // Step 1 pre-positions the hero: the map in grey with only the two provinces the speaker names.
    // Step 2 colours it and its header becomes the step's claim, the index as its detail.
    var h1 = S("g", {}, svg);
    txt(h1, 0, 22, "ภาระโรคปรับอายุ ต่ำสุดและสูงสุด", 16, "t-strong");
    txt(h1, 0, 46, "ปีสุขภาวะที่สูญเสียต่อประชากรแสนคน", 13, "t-muted");
    var h2 = S("g", { style: "opacity:0" }, svg);
    txt(h2, 0, 24, "แต่แพทย์ยังกระจุกอยู่ในจังหวัดที่ภาระโรคต่ำ", 18, "t-strong");
    runs(h2, 0, 52, [["ดัชนีกระจุกตัว ", 13, "t-muted"], [F("c45_ci_physicians_all_sectors_daly_2025"), 16, "t-bad"], [" · กฎการดูแลผกผัน (inverse care law)", 13, "t-muted"]]);
    txt(h2, 0, 76, "แผนที่: แพทย์ทุกสังกัดเทียบกับภาระโรค แต่ละจังหวัดเทียบค่าประเทศ · พ.ศ. 2568", 13, "t-muted");
    var B = T.burden || { idx: {} }, idx = B.idx || {};
    var m = mapAt(svg, 120, 92, 434);
    var hi = U.codeOf("ชัยภูมิ"), lo = U.codeOf("นนทบุรี");
    function grey() { m.each(function (c) { var on = c === hi || c === lo; m.paint(c, c === hi ? "var(--accent)" : c === lo ? "var(--accent-soft)" : "var(--surface-2)", on ? "var(--accent-text)" : "var(--line-strong)", on ? 1 : 0.4); }); }
    function classes() { m.each(function (c) { var v = idx[c], b = v == null ? null : band(v); if (b) m.paint(c, b.fill, "var(--bg)", 0.6); else m.paint(c, "var(--surface-2)", "var(--line)", 0.5); }); }
    var l1 = S("g", {}, svg);
    stack([[hi, "ชัยภูมิ", "ภาระโรคสูงสุด ", "c45_daly_max", "t-accent"], [lo, "นนทบุรี", "ภาระโรคต่ำสุด ", "c45_daly_min", "t-strong"]].map(function (r) {
      var p = m.at(r[0]); return p ? { x: p.x, y: p.y, r: r } : null;
    }).filter(Boolean), 64).forEach(function (q) {
      var lx = 392;
      S("path", { d: "M" + q.x.toFixed(1) + "," + q.y.toFixed(1) + " L" + (lx - 10) + "," + (q.ly - 5).toFixed(1), style: "fill:none;stroke:var(--accent-text);stroke-width:1.2;opacity:.85" }, l1);
      S("circle", { cx: q.x, cy: q.y, r: 3, style: "fill:var(--accent-text)" }, l1);
      txt(l1, lx, q.ly, q.r[1], 18, q.r[4]);
      runs(l1, lx, q.ly + 26, [[q.r[2], 13, "t-muted"], [F(q.r[3]), 16, q.r[4]]]);
    });
    var g2 = S("g", { style: "opacity:0" }, svg);
    var low = Object.keys(idx).sort(function (a, b) { return idx[a] - idx[b]; }).slice(0, 5);
    mapLabels(g2, m, low, 15, "t-bad", 25, "var(--bad-text)");
    var lg = S("g", {}, g2), lx = 444;
    txt(lg, lx, 392, "แพทย์ต่อภาระโรค", 13, "t-muted");
    BURDEN_BANDS.forEach(function (b, i) {
      var y = 410 + i * 28;
      S("rect", { x: lx, y: y, width: 20, height: 20, rx: 4, style: "fill:" + b.fill }, lg);
      txt(lg, lx + 30, y + 16, b.lab, 14, "t-strong");
    });
    // lower-left, under the lead: who carries the burden, and how fast it grows (both steps)
    var sv = side(host, 384, "สัดส่วนของคนอายุหกสิบปีขึ้นไปในประชากรและในภาระโรค");
    txt(sv, 0, 20, "สัดส่วนของคนอายุหกสิบปีขึ้นไป", 16, "t-strong");
    function waffle(x, y, share, label, col) {
      txt(sv, x, y - 12, label, 14, "t-muted");
      var cells = [];
      for (var i = 0; i < 100; i++) cells.push(S("rect", { x: x + (i % 10) * 20, y: y + Math.floor(i / 10) * 20, width: 16, height: 16, rx: 3, style: "fill:var(--surface-3)" }, sv));
      return { cells: cells, n: Math.round(share), col: col };
    }
    var w1 = waffle(0, 70, N("c45_share60_pop"), "ในประชากร", "var(--neutral)");
    var w2 = waffle(244, 70, N("c45_share60_daly"), "ในภาระโรค (DALY)", "var(--accent)");
    var v1 = txt(sv, 0, 312, "", 32, "t-pro"), v2 = txt(sv, 244, 312, "", 32, "t-accent");
    var grow = runs(sv, 0, 362, [["พ.ศ. 2556–2568 ภาระคาดหมาย ", 15, "t-strong"], ["+" + F("c45_expected_growth_1325") + "%", 18, "t-accent"], [" ประชากร ", 15, "t-strong"], ["+" + F("c45_pop_growth_1325") + "%", 18, "t-pro"]]);
    grow.style.opacity = 0;
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        h2.style.opacity = 0; g2.style.opacity = 0; h1.style.opacity = 1; l1.style.opacity = 1; grey();
        [w1, w2].forEach(function (w, j) {
          jobs.add(U.tween(anim ? 1100 : 0, function (t) {
            var lit = Math.round(w.n * t);
            w.cells.forEach(function (c, i) { c.setAttribute("style", "fill:" + (99 - i < lit ? w.col : "var(--surface-3)")); });
          }, { delay: j * 400 }));
        });
        jobs.add(U.count(v1, F("c45_share60_pop"), { post: "%", ms: anim ? 1100 : 0 }));
        jobs.add(U.count(v2, F("c45_share60_daly"), { post: "%", ms: anim ? 1100 : 0, delay: 400 }));
        fade(grow, true, anim ? 350 : 0, jobs, 1500);
      }
      if (k === 2) {
        classes();
        fade(h1, false, anim ? 250 : 0, jobs); fade(l1, false, anim ? 250 : 0, jobs);
        fade(h2, true, anim ? 400 : 0, jobs, anim ? 250 : 0); fade(g2, true, anim ? 500 : 0, jobs, anim ? 300 : 0);
      }
    });
  };

  /* ---------------- s07 Myrdal: the mechanism (lower-left), the Thai history and this study (chart) ---------------- */
  // Three clicks, nothing on autoplay: 1 the mechanism and where the history starts (2522),
  // 2 the rural investment and the private pull back, 3 this study's own series.
  FIGS.s07 = function (host) {
    var svg = main(host, 522, "แพทย์ต่อประชากร กรุงเทพฯ เทียบภาคตะวันออกเฉียงเหนือ จากวรรณกรรมและจากข้อมูลของการศึกษานี้");
    var fb = H("span", "badge fig-badge", "ผลจากข้อมูล", host); fb.setAttribute("data-claim", "reported");
    txt(svg, 0, 22, "แพทย์ต่อประชากร กรุงเทพฯ สูงกว่าภาคตะวันออกเฉียงเหนือกี่เท่า", 15, "t-strong");
    var XA = 2520, XB = 2570, PX0 = 22, PX1 = 618, PY0 = 436, PY1 = 70, VMAX = 23;
    function tx(yr) { return PX0 + (yr - XA) / (XB - XA) * (PX1 - PX0); }
    function ty(v) { return PY0 - v / VMAX * (PY0 - PY1); }
    S("line", { x1: PX0, x2: PX1, y1: PY0, y2: PY0, class: "axis" }, svg);
    [2522, 2529, 2539, 2556, 2568].forEach(function (yr) { txt(svg, tx(yr), PY0 + 26, String(yr), 13, "t-muted", "middle"); });
    var H3 = [[2522, "lit.gap_1979"], [2529, "lit.gap_1986"], [2539, "lit.gap_1996"]].map(function (h) { return { x: tx(h[0]), y: ty(N(h[1])), id: h[1] }; });
    function point(g, p, cls, left) {
      S("circle", { cx: p.x, cy: p.y, r: 6, style: "fill:var(--text-2)" }, g);
      if (left) txt(g, p.x - 14, p.y + 7, "×" + F(p.id), 20, cls, "end");
      else txt(g, p.x + 4, p.y - 14, "×" + F(p.id), 20, cls, "middle");
    }
    var ph = [S("g", {}, svg), S("g", { style: "opacity:0" }, svg), S("g", { style: "opacity:0" }, svg), S("g", { style: "opacity:0" }, svg)];
    point(ph[0], H3[0], "t-strong");
    var seg1 = S("path", { d: "M" + H3[0].x + "," + H3[0].y + " L" + H3[1].x + "," + H3[1].y, style: "fill:none;stroke:var(--p1-text);stroke-width:3" }, ph[1]);
    point(ph[1], H3[1], "t-need", true);
    txt(ph[1], 150, 340, "ลงทุนชนบท 2519–2528", 15, "t-need");
    txt(ph[1], 150, 364, "รพ.ชนบท " + F("lit.rural_hosp_start") + " → " + F("lit.rural_hosp_end") + " แห่ง", 13, "t-muted");
    txt(ph[1], 150, 386, "แพทย์ชนบท " + F("lit.rural_md_start") + " → " + F("lit.rural_md_end") + " คน", 13, "t-muted");
    var seg2 = S("path", { d: "M" + H3[1].x + "," + H3[1].y + " L" + H3[2].x + "," + H3[2].y, style: "fill:none;stroke:var(--bad-text);stroke-width:3" }, ph[2]);
    point(ph[2], H3[2], "t-bad");
    txt(ph[2], H3[2].x + 14, H3[2].y + 32, "แรงดึงของ รพ.เอกชน", 15, "t-bad");
    var GP = T.gap || { years: [], ratio: [] }, gx = tx(2551);
    S("line", { x1: gx, x2: gx, y1: PY1, y2: PY0, style: "stroke:var(--line-strong);stroke-dasharray:4 5" }, ph[3]);
    txt(ph[3], gx + 8, PY1 + 14, "ข้อมูลคนละชุด", 13, "t-muted");
    var gpts = GP.years.map(function (yr, i) { return [tx(yr), ty(GP.ratio[i])]; });
    var seg3 = S("path", { d: gpts.map(function (q, i) { return (i ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(""), style: "fill:none;stroke:var(--accent-text);stroke-width:3.4;stroke-linejoin:round" }, ph[3]);
    if (gpts.length) {
      var a0 = gpts[0], a1 = gpts[gpts.length - 1];
      S("circle", { cx: a0[0], cy: a0[1], r: 5, style: "fill:var(--accent-text)" }, ph[3]);
      S("circle", { cx: a1[0], cy: a1[1], r: 6, style: "fill:var(--accent-text)" }, ph[3]);
      txt(ph[3], a0[0], a0[1] - 16, "×" + F("c43_gap_bkk_ne_start"), 20, "t-accent", "middle");
      txt(ph[3], a1[0] + 4, a1[1] - 18, "×" + F("c43_gap_bkk_ne_end"), 24, "t-accent", "end");
      txt(ph[3], (a0[0] + a1[0]) / 2, a1[1] - 62, "การศึกษานี้", 16, "t-accent", "middle");
    }
    txt(ph[3], 0, 494, "ช่วงหลังเป็นข้อมูลของการศึกษานี้ (บุคลากรทุกสังกัด ประชากรทะเบียนราษฎร) คนละชุดกับในอดีต เทียบได้ในระดับขนาด", 12, "t-muted");
    txt(ph[3], 0, 516, "ประชากรตามทะเบียนของกรุงเทพฯ ต่ำกว่าคนที่อยู่จริง ค่ากรุงเทพฯ จึงสูงกว่าที่เป็นจริง", 12, "t-muted");
    var segs = [null, { p: seg1, len: Math.hypot(H3[1].x - H3[0].x, H3[1].y - H3[0].y) }, { p: seg2, len: Math.hypot(H3[2].x - H3[1].x, H3[2].y - H3[1].y) }, { p: seg3, len: polyLen(gpts) }];
    // lower-left: the cycle, at a size the room can read
    var sv = side(host, 236, "วงจรเหตุปัจจัยแบบวนและสะสมของ Myrdal");
    var hub = { x: 108, y: 124 };
    var ringG = S("g", { transform: "translate(" + hub.x + "," + hub.y + ")" }, sv);
    S("circle", { r: 76, style: "fill:none;stroke:var(--accent-text);stroke-width:2;stroke-dasharray:118 22;opacity:.85" }, ringG);
    S("path", { d: "M70,-30 l10,-2 l-2,11 z", style: "fill:var(--accent-text)" }, ringG);
    S("circle", { cx: hub.x, cy: hub.y, r: 50, style: "fill:var(--accent-soft);stroke:var(--accent-text);stroke-width:1.4" }, sv);
    txt(sv, hub.x, hub.y - 4, "พื้นที่", 16, "t-strong", "middle");
    txt(sv, hub.x, hub.y + 18, "ได้เปรียบ", 16, "t-strong", "middle");
    txt(sv, hub.x, 30, "บริการ การฝึก ทีม", 14, "t-accent", "middle");
    txt(sv, hub.x, 228, "ดึงและรักษาคน", 14, "t-accent", "middle");
    var peri = [[290, 92], [356, 78], [420, 112], [404, 172], [330, 186], [272, 150]].map(function (p) { return { x: p[0], y: p[1] }; });
    var nodes = peri.map(function (p) {
      var cx = (p.x + hub.x) / 2, cy = Math.min(p.y, hub.y) - 12;
      S("path", { d: "M" + p.x + "," + p.y + " Q" + cx + "," + cy + " " + hub.x + "," + hub.y, style: "fill:none;stroke:var(--line-strong);stroke-dasharray:4 6" }, sv);
      return { p: p, cx: cx, cy: cy, c: S("circle", { cx: p.x, cy: p.y, r: 12, style: "fill:var(--surface-2);stroke:var(--line-strong);stroke-width:1.4" }, sv) };
    });
    txt(sv, 348, 228, "พื้นที่เสียเปรียบ", 14, "t-muted", "middle");
    var mode = txt(sv, 236, 22, "", 16, "t-accent"), modeTh = txt(sv, 236, 46, "", 13, "t-muted");
    var parts = [];
    for (var k = 0; k < 30; k++) parts.push({ n: k % nodes.length, o: (k * 0.137) % 1, el: S("circle", { r: 2.6, style: "fill:var(--accent-text);opacity:0" }, sv) });
    var dir = -1, rot = 0;
    U.loop(sv, function (dt) {
      rot = (rot + dt * 0.03 * (dir < 0 ? 1 : 0.4)) % 360; ringG.setAttribute("transform", "translate(" + hub.x + "," + hub.y + ") rotate(" + rot + ")");
      parts.forEach(function (q) {
        q.o = (q.o + dt / 2600) % 1;
        var t = dir < 0 ? q.o : 1 - q.o, nd = nodes[q.n], p = nd.p;
        q.el.setAttribute("cx", (1 - t) * (1 - t) * p.x + 2 * (1 - t) * t * nd.cx + t * t * hub.x);
        q.el.setAttribute("cy", (1 - t) * (1 - t) * p.y + 2 * (1 - t) * t * nd.cy + t * t * hub.y);
        q.el.style.opacity = Math.sin(q.o * Math.PI);
      });
    });
    if (U.isStatic()) parts.forEach(function (q) { q.el.style.display = "none"; });
    var states = [
      function () { dir = -1; mode.textContent = "ผลดูดกลับ (backwash)"; modeTh.textContent = "คนไหลเข้าหาพื้นที่ได้เปรียบ"; nodes.forEach(function (n) { n.c.setAttribute("style", "fill:var(--surface-2);stroke:var(--line-strong);stroke-width:1.4"); }); },
      function () { dir = 1; mode.textContent = "ผลกระจายออก (spread)"; modeTh.textContent = "แรงจากภายนอกที่มีทิศและแรงพอ"; nodes.forEach(function (n) { n.c.setAttribute("style", "fill:var(--p1);stroke:var(--p1-text);stroke-width:1.4"); }); },
      function () { dir = -1; mode.textContent = "ผลดูดกลับ (backwash)"; modeTh.textContent = "แรงดึงของภาคเอกชนกลับมา"; nodes.forEach(function (n) { n.c.setAttribute("style", "fill:var(--surface-2);stroke:var(--bad-text);stroke-width:1.6"); }); },
      function () { dir = -1; mode.textContent = "วงจรยังหมุน"; modeTh.textContent = "ความต่างกลับกว้างขึ้นในช่วงการศึกษานี้"; nodes.forEach(function (n) { n.c.setAttribute("style", "fill:var(--surface-2);stroke:var(--bad-text);stroke-width:1.6"); }); }
    ];
    return stepper(host, 3, function (s, anim, jobs) {
      if (s === 1) { ph[1].style.opacity = 0; ph[2].style.opacity = 0; ph[3].style.opacity = 0; states[0](); }
      if (s === 2) {
        // the history in one click: spread down to ×8.6, then the private pull back up (1.5 s)
        fade(ph[1], true, anim ? 300 : 0, jobs); drawPath(seg1, segs[1].len, anim, jobs, 0, 650); states[1]();
        if (!anim) { ph[2].style.opacity = 1; drawPath(seg2, segs[2].len, false); states[2](); }
        else later(jobs, 850, function () { fade(ph[2], true, 300, jobs); drawPath(seg2, segs[2].len, true, jobs, 0, 650); states[2](); });
      }
      if (s === 3) { fade(ph[3], true, anim ? 300 : 0, jobs); drawPath(seg3, segs[3].len, anim, jobs, 0, 1300); states[3](); }
    });
  };

  /* ---------------- s08 the loop today: four readings on one cycle; the running target ---------------- */
  // The cycle is drawn once, with no arrows between the readings: they are four places the same
  // loop shows itself, not a causal chain. Step 2's chase sits under the sentence it illustrates.
  FIGS.s08 = function (host) {
    var svg = main(host, 530, "ทักษะ ตำแหน่ง ตำแหน่งว่าง และบริการ ไหลไปหาที่ที่มีอยู่แล้ว และเป้าหมายตามบริการที่วิ่งหนีแพทย์ที่ส่งไป");
    var C = { x: 320, y: 270 }, Rr = 112;
    var ringG = S("g", { transform: "translate(" + C.x + "," + C.y + ")" }, svg);
    S("circle", { r: Rr, style: "fill:none;stroke:var(--accent-text);stroke-width:2.2;stroke-dasharray:150 26;opacity:.8" }, ringG);
    S("path", { d: "M" + (Rr - 9) + ",-40 l10,-4 l0,12 z", style: "fill:var(--accent-text)" }, ringG);
    txt(svg, C.x, C.y - 8, "ไหลไปหา", 16, "t-muted", "middle");
    txt(svg, C.x, C.y + 24, "ที่ที่มีอยู่แล้ว", 21, "t-accent", "middle");
    var rot = 0;
    U.loop(svg, function (dt) { rot = (rot + dt * 0.012) % 360; ringG.setAttribute("transform", "translate(" + C.x + "," + C.y + ") rotate(" + rot + ")"); });
    function reading(ang, bx, by, anchor, key, lines, ey) {
      var g = S("g", { style: "opacity:0" }, svg), a = ang * Math.PI / 180, px = C.x + Rr * Math.cos(a), py = C.y + Rr * Math.sin(a);
      var ex = anchor === "end" ? bx + 14 : bx - 14;
      S("path", { d: "M" + px.toFixed(1) + "," + py.toFixed(1) + " L" + ex + "," + ey, style: "fill:none;stroke:var(--line-strong);stroke-width:1.2" }, g);
      S("circle", { cx: px, cy: py, r: 7, style: "fill:var(--accent-text);stroke:var(--bg);stroke-width:2" }, g);
      txt(g, bx, by, key, 16, "t-accent", anchor);
      lines(g, bx, by, anchor);
      return g;
    }
    var rs = [
      reading(-140, 210, 24, "end", "ทักษะ", function (g, x, y, a) {
        txt(g, x, y + 50, F("c46_conc_top10_all1") + "%", 36, "t-strong", a);
        txt(g, x, y + 80, "ของแพทย์เฉพาะทาง อยู่ใน", 14, "t-strong", a);
        txt(g, x, y + 102, "สถานพยาบาลหนึ่งในสิบ", 14, "t-strong", a);
        txt(g, x, y + 126, "จาก " + F("c46_conc_top10_allT") + "% ใน พ.ศ. 2564", 13, "t-muted", a);
      }, 140),
      reading(-40, 430, 24, "start", "ตำแหน่ง", function (g, x, y, a) {
        txt(g, x, y + 50, "×" + F("c47_pos100k_ratio"), 36, "t-strong", a);
        txt(g, x, y + 80, "ตำแหน่งนายแพทย์ต่อประชากร", 14, "t-strong", a);
        txt(g, x, y + 102, "จังหวัดมากสุดเทียบน้อยสุด", 13, "t-muted", a);
      }, 140),
      reading(40, 430, 386, "start", "ตำแหน่งว่าง", function (g, x, y, a) {
        txt(g, x, y + 50, F("c47_vacrate_level_F3") + "%", 36, "t-bad", a);
        txt(g, x, y + 80, "ใน รพ.ชุมชนขนาดเล็ก", 14, "t-strong", a);
        txt(g, x, y + 102, "รพ.ศูนย์ " + F("c47_vacrate_level_A") + "%", 13, "t-muted", a);
      }, 366),
      reading(140, 210, 386, "end", "บริการตามเตียง", function (g, x, y, a) {
        // the elasticity as two proportional bars: beds +1% -> bed-days +0.708%
        var e = N("c423_assoc_ip_moph_long_pooled_year_fe_beds"), W = 200;
        txt(g, x, y + 30, "เตียงเพิ่ม 1%", 14, "t-strong", a);
        S("rect", { x: x - W, y: y + 38, width: W, height: 16, rx: 3, style: "fill:var(--neutral)" }, g);
        runs(g, x, y + 82, [["วันนอนเพิ่ม ", 14, "t-strong"], [F("c423_assoc_ip_moph_long_pooled_year_fe_beds") + "%", 20, "t-accent"]], a);
        S("rect", { x: x - W, y: y + 90, width: W * e, height: 16, rx: 3, style: "fill:var(--accent)" }, g);
        txt(g, x, y + 130, "ความยืดหยุ่น", 13, "t-muted", a);
      }, 366)
    ];
    // step 2, lower-left: the target runs from the doctors sent. The named start block is the
    // target before anyone is sent; each doctor sent (blue) lifts the service-based target by
    // c55_gainB_first_1 of a doctor (solid gold). The pink gap sits at the end of the doctors' row
    // from the first frame and, at each doctor, moves right and shrinks by only 0.12 of a block.
    // The start gap and the five doctors are illustrative; the only number shown is the claim.
    var sv = side(host, 300, "เป้าหมายตามบริการที่วิ่งหนีแพทย์ที่ส่งไป ช่องว่างแทบไม่ลด ภาพอธิบายกลไก"), run = S("g", { style: "opacity:0" }, sv);
    var gB = N("c55_gainB_first_1"), UW = 64, G0 = 2, K = 5;
    txt(run, 0, 20, "แพทย์เพิ่มหนึ่งคน", 15, "t-muted");
    runs(run, 0, 58, [["เป้าหมายเพิ่ม ", 20, "t-strong"], [F("c55_gainB_first_1") + " คน", 30, "t-accent"]]);
    txt(run, 0, 98, "เป้าหมายตามบริการ", 13, "t-muted");
    txt(run, 0, 170, "แพทย์ที่ส่งไป", 13, "t-muted");
    S("rect", { x: 0, y: 108, width: G0 * UW - 3, height: 34, rx: 4, style: "fill:var(--accent-soft);stroke:var(--accent)" }, run);
    txt(run, (G0 * UW - 3) / 2, 131, "เป้าหมายตอนเริ่ม", 12.5, "t-accent", "middle");
    var tP = [], dP = [];
    for (var i = 0; i < K; i++) {
      tP.push(S("rect", { x: (G0 + gB * i) * UW, y: 108, width: gB * UW - 3, height: 34, rx: 4, style: "fill:var(--accent);opacity:0" }, run));
      dP.push(S("rect", { x: i * UW, y: 180, width: UW - 3, height: 34, rx: 4, style: "fill:var(--p1);opacity:0" }, run));
    }
    var gapR = S("rect", { y: 180, height: 34, rx: 4, style: "fill:var(--bad-soft);stroke:var(--bad-text);stroke-width:1.8;stroke-dasharray:5 4" }, run);
    var gapL = txt(run, 0, 244, "ช่องว่าง", 15, "t-bad", "end");
    function setGap(k) { var x0 = k * UW, x1 = (G0 + gB * k) * UW - 3; gapR.setAttribute("x", x0.toFixed(1)); gapR.setAttribute("width", Math.max(0, x1 - x0).toFixed(1)); gapL.setAttribute("x", x1.toFixed(1)); }
    setGap(0);
    txt(run, 0, 282, "ช่องฟ้าคือแพทย์หนึ่งคน ช่องทองทึบคือเป้าหมายที่เพิ่มตาม · ภาพอธิบายกลไก", 12, "t-muted");
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) { run.style.opacity = 0; rs.forEach(function (g, i) { if (anim) g.style.opacity = 0; fade(g, true, anim ? 350 : 0, jobs, 200 + i * 300); }); }
      if (k === 2) {
        if (!anim) { dP.concat(tP).forEach(function (e) { e.style.opacity = 1; }); setGap(K); gapL.textContent = "ช่องว่างแทบไม่ลด"; run.style.opacity = 1; return; }
        dP.concat(tP).forEach(function (e) { e.style.opacity = 0; }); setGap(0); gapL.textContent = "ช่องว่าง";
        fade(run, true, 300, jobs);
        // one doctor every 0.6 s: blue in, gold in, the gap slides on and shrinks a little
        dP.forEach(function (r, i) {
          var t0 = 700 + i * 600;
          fade(r, true, 200, jobs, t0);
          fade(tP[i], true, 200, jobs, t0 + 250);
          later(jobs, t0 + 250, function () { jobs.add(U.tween(300, function (t) { setGap(i + t); })); });
        });
        later(jobs, 700 + K * 600, function () { gapL.textContent = "ช่องว่างแทบไม่ลด"; });
      }
    });
  };

  /* ---------------- s09 the leaky bucket ---------------- */
  // Water level = what stays per entry (1 minus exits per entry), so the drawing carries the same
  // contrast as the ratios. The drip runs three times, then rests.
  FIGS.s09 = function (host) {
    var svg = wide(host, 380, "รับเข้าและออกของแพทย์และพยาบาลวิชาชีพ ปีงบ 2560–2568");
    function bucket(x, label, inId, outId, ratioId) {
      var g = S("g", {}, svg), top = 70, bot = 318, Wt = 250, Wb = 186, cx = x + Wt / 2;
      txt(g, cx, 26, label, 20, "t-strong", "middle");
      S("path", { d: "M" + x + "," + top + " L" + (x + (Wt - Wb) / 2) + "," + bot + " L" + (x + (Wt + Wb) / 2) + "," + bot + " L" + (x + Wt) + "," + top, style: "fill:var(--card);stroke:var(--line-strong);stroke-width:2" }, g);
      var water = S("path", { d: "", style: "fill:var(--p1);opacity:.42" }, g);
      var stay = txt(g, cx, 0, "ส่วนที่เหลือ", 13, "t-need", "middle");
      runs(g, x + Wt + 14, top + 14, [["รับเข้า ", 15, "t-muted"], [F(inId), 20, "t-need"]]);
      runs(g, x + (Wt + Wb) / 2 + 14, bot + 4, [["ออก ", 15, "t-muted"], [F(outId), 20, "t-hosp"]]);
      txt(g, x + Wt + 14, 196, F(ratioId), 44, "t-accent");
      txt(g, x + Wt + 14, 224, "ออกต่อรับเข้า", 14, "t-muted");
      var level = 1 - N(ratioId), H = bot - top;
      function setLevel(l) {
        var y = bot - H * l, k = (bot - y) / H, xl = x + (Wt - Wb) / 2 - (Wt - Wb) / 2 * k, xr = x + (Wt + Wb) / 2 + (Wt - Wb) / 2 * k;
        water.setAttribute("d", "M" + xl + "," + y + " L" + (x + (Wt - Wb) / 2) + "," + bot + " L" + (x + (Wt + Wb) / 2) + "," + bot + " L" + xr + "," + y + "Z");
        stay.setAttribute("y", y - 10); stay.style.opacity = l > 0.02 ? 1 : 0;
      }
      setLevel(level);
      var drops = [];
      for (var i = 0; i < 18; i++) {
        var into = i % 2 === 0;
        drops.push({ o: (i * 0.173) % 1, into: into, el: S("circle", { r: 3.4, style: "fill:" + (into ? "var(--p1-text)" : "var(--p3-text)") + ";opacity:0" }, g) });
      }
      return { drops: drops, cx: cx, top: top, bot: bot, setLevel: setLevel, level: level };
    }
    var bs = [bucket(150, "แพทย์", "c44_physicians_entries_total", "c44_physicians_exits_total", "c44_physicians_exit_entry_ratio"),
              bucket(650, "พยาบาลวิชาชีพ", "c44_professional_nurses_entries_total", "c44_professional_nurses_exits_total", "c44_professional_nurses_exit_entry_ratio")];
    var t0 = null;
    U.loop(svg, function (dt, ts) {
      if (t0 === null) t0 = ts;
      var el = ts - t0, cyc = el / 1900, live = cyc < 3;
      bs.forEach(function (b) {
        b.setLevel(b.level * Math.min(1, el / 2200));
        b.drops.forEach(function (d) {
          var o = (d.o + cyc) % 1;
          if (d.into) { d.el.setAttribute("cx", b.cx + Math.sin(o * 9) * 6); d.el.setAttribute("cy", b.top - 30 + o * 120); }
          else { d.el.setAttribute("cx", b.cx + Math.sin(o * 7) * 18); d.el.setAttribute("cy", b.bot + 6 + o * 40); }
          d.el.style.opacity = live ? Math.sin(o * Math.PI) * Math.min(1, (3 - cyc) * 2) : 0;
        });
      });
    });
    return stepper(host, 1, function (k, anim) { t0 = null; if (!anim) bs.forEach(function (b) { b.setLevel(b.level); }); });
  };

  /* ---------------- s10 how much vs who: two full-width bars ---------------- */
  FIGS.s10 = function (host) {
    var svg = wide(host, 344, "ความเพียงพอระดับประเทศ พ.ศ. 2568 และ 2583 และช่องว่าง พ.ศ. 2583 แยกส่วนระดับประเทศกับส่วนที่แก้ได้ด้วยการเกลี่ย");
    var W = 1000, a0 = N("c51_attain_2025"), a1 = N("c54_nat_PR_P");
    txt(svg, 0, 20, "ความเพียงพอระดับประเทศของแพทย์ สธ. เทียบค่าอ้างอิงตัวอย่าง " + F("lit.target_ratio"), 15, "t-muted");
    S("rect", { x: 0, y: 58, width: W, height: 36, rx: 6, style: "fill:var(--surface-3)" }, svg);
    var fill = S("rect", { x: 0, y: 58, width: W * a0, height: 36, rx: 6, style: "fill:var(--accent)" }, svg);
    S("line", { x1: W * a0, x2: W * a0, y1: 50, y2: 104, style: "stroke:var(--text-1);stroke-width:2.5" }, svg);
    runs(svg, W * a0, 128, [["2568 ", 14, "t-muted"], [F("c51_attain_2025"), 18, "t-strong"]], "middle");
    var endL = runs(svg, W * a1 + 14, 85, [["2583 ", 15, "t-muted"], [F("c54_nat_PR_P"), 26, "t-accent"]]); endL.style.opacity = 0;
    txt(svg, 0, 124, "0", 13, "t-muted", "start");
    txt(svg, W, 124, "1 = ค่าอ้างอิงตัวอย่าง", 13, "t-muted", "end");
    txt(svg, 0, 158, "แพทย์ สธ. " + F("c51_H0_total") + " → " + F("c54_stock2040_PR") + " คน (2568 → 2583) · ค่าอ้างอิงตัวอย่างปี 2568 ต้องมี " + F("c51_target_2025") + " คน", 14, "t-muted");
    // The gap in 2583 as one bar split in two: the national part and the part moving doctors between
    // provinces could close (c54_gapsp: doctors above target elsewhere; zero when every province is short).
    var g2 = S("g", { style: "opacity:0" }, svg), GW = 930;
    txt(g2, 0, 206, "ช่องว่าง พ.ศ. 2583", 15, "t-muted");
    var gbar = S("rect", { x: 0, y: 220, width: 0, height: 60, rx: 6, style: "fill:var(--p3)" }, g2);
    var inl = runs(g2, 22, 260, [["ระดับประเทศ ", 18, "t-strong"], [F("c54_gapnat_PR_P") + " คน", 26, "t-strong"]]); inl.style.opacity = 0;
    S("line", { x1: GW + 1, x2: GW + 1, y1: 210, y2: 290, style: "stroke:var(--accent-text);stroke-width:3" }, g2);
    txt(g2, GW + 16, 240, "แก้ได้ด้วยการเกลี่ย", 15, "t-accent");
    txt(g2, GW + 16, 274, F("c54_gapsp_PR_P") + " คน", 26, "t-accent");
    txt(g2, 0, 330, "ไม่มีจังหวัดใดมีแพทย์เกินเป้าหมาย ทุกจังหวัดยังขาด ช่องว่างทั้งหมดจึงเป็นการขาดระดับประเทศ", 15, "t-strong");
    return stepper(host, 1, function (k, anim, jobs) {
      jobs.add(U.tween(anim ? 1100 : 0, function (t) { fill.setAttribute("width", W * (a0 + (a1 - a0) * t)); }, { delay: 200 }));
      fade(endL, true, anim ? 300 : 0, jobs, 1000);
      fade(g2, true, anim ? 300 : 0, jobs, anim ? 700 : 0);
      jobs.add(U.tween(anim ? 800 : 0, function (t) { gbar.setAttribute("width", GW * t); }, { delay: 800 }));
      fade(inl, true, anim ? 300 : 0, jobs, 1400);
    });
  };

  /* ---------------- s11 76 jars: the frame fills in 2572; then the frame is the formula ---------------- */
  function jars(svg, plan, opt) {
    var P = (T.plans || {})[plan]; if (!P) return null;
    var tl = U.tiles({ x: opt.x, y: opt.y, size: opt.size, gap: opt.gap || 3 });
    var low = (T.low19 || []).reduce(function (o, c) { o[c] = 1; return o; }, {});
    var J = {};
    Object.keys(tl.cell).forEach(function (code) {
      var c = tl.cell[code], g = S("g", {}, svg);
      S("rect", { x: c.x, y: c.y, width: c.s, height: c.s, rx: 3, style: "fill:var(--surface)" }, g);
      var w = S("rect", { x: c.x + 1.5, y: c.y + c.s, width: c.s - 3, height: 0, style: "fill:var(--p1)" }, g);
      var cap = S("line", { x1: c.x + 1, x2: c.x + c.s - 1, y1: c.y, y2: c.y, style: "stroke:var(--bad-text);stroke-width:2" }, g);
      S("rect", { x: c.x, y: c.y, width: c.s, height: c.s, rx: 3, style: "fill:none;stroke:" + (low[code] ? "var(--accent-text)" : "var(--line)") + ";stroke-width:" + (low[code] ? 2 : 0.8) }, g);
      J[code] = { c: c, w: w, cap: cap, s: P.prov[code] };
    });
    function show(yi) {
      var blue = 0;
      Object.keys(J).forEach(function (code) {
        var j = J[code]; if (!j.s) return;
        var att = Math.min(1, j.s.s[yi] / j.s.t[yi]), capv = Math.min(1, j.s.c[yi] / j.s.t[yi]);
        var hgt = Math.min(j.c.s - 3, (j.c.s - 3) * att / 0.8), hc = Math.min(j.c.s - 3, (j.c.s - 3) * capv / 0.8);
        j.w.setAttribute("y", j.c.y + j.c.s - 1.5 - hgt); j.w.setAttribute("height", hgt);
        j.cap.setAttribute("y1", j.c.y + j.c.s - 1.5 - hc); j.cap.setAttribute("y2", j.c.y + j.c.s - 1.5 - hc);
        var full = j.s.s[yi] >= j.s.c[yi] - 0.5;
        j.w.style.fill = full ? "var(--neutral)" : "var(--p1)";
        if (!full) blue++;
      });
      return blue;
    }
    return { show: show, years: P.years, P: P };
  }
  FIGS.s11 = function (host) {
    var svg = main(host, 530, "ตำแหน่งนายแพทย์เต็มภายในสามปีภายใต้กรอบคงที่ แต่ละช่องคือหนึ่งจังหวัด");
    var J = jars(svg, "P-R|F0", { x: 352, y: 10, size: 29, gap: 3 });
    var fullYear = N("c5f_PR_F0_first_unplaced");
    txt(svg, 0, 22, "แผนกรอบคงที่ · แต่ละช่องคือหนึ่งจังหวัด", 13, "t-muted");
    var head = runs(svg, 0, 80, [["เต็มปี ", 26, "t-accent"], [F("c5f_PR_F0_first_unplaced"), 40, "t-accent"]]); head.style.opacity = 0;
    var yearT = txt(svg, 0, 116, "ภาพนี้คือ พ.ศ. 2569", 15, "t-muted");
    // legend: only marks that are on screen (the blue key leaves when no province is below its cap)
    S("rect", { x: 0, y: 150, width: 18, height: 18, rx: 3, style: "fill:var(--neutral)" }, svg); txt(svg, 28, 165, "เต็มกรอบแล้ว", 14, "t-strong");
    S("line", { x1: 0, x2: 18, y1: 193, y2: 193, style: "stroke:var(--bad-text);stroke-width:2.5" }, svg); txt(svg, 28, 198, "ขีดรับของตำแหน่ง", 14, "t-strong");
    S("rect", { x: 0, y: 218, width: 18, height: 18, rx: 3, style: "fill:none;stroke:var(--accent-text);stroke-width:2" }, svg); txt(svg, 28, 233, "19 จังหวัดล่างสุด", 14, "t-strong");
    var keyBlue = S("g", {}, svg);
    S("rect", { x: 0, y: 252, width: 18, height: 18, rx: 3, style: "fill:var(--p1)" }, keyBlue); txt(keyBlue, 28, 267, "แพทย์ยังไม่ถึงขีดรับ", 14, "t-strong");
    txt(svg, 0, 330, "แพทย์ใหม่ที่ไม่มีตำแหน่งรองรับ (สะสม)", 14, "t-muted");
    var un = txt(svg, 0, 380, "0", 36, "t-bad");
    txt(svg, 0, 412, "คน ถึง พ.ศ. 2583", 13, "t-muted");
    // step 2, lower-left: switch the formula after the frame is full
    var sv = side(host, 210, "สลับสูตรจัดสรรหลังกรอบเต็ม 19 จังหวัดล่างสุดได้ความเพียงพอเท่ากัน"), formula = S("g", { style: "opacity:0" }, sv);
    txt(formula, 0, 18, "สลับสูตรจัดสรร · 19 จังหวัดล่างสุด พ.ศ. 2583", 14, "t-muted");
    var rows = [["ประชากร", "c5f_PR_F0_bq_P"], ["บริการคาดหมายมาตรฐาน", "c5f_NR_F0_bq_P"], ["ภาระโรค", "c5f_BR_F0_bq_P"]].map(function (r, i) {
      var g = S("g", { style: "opacity:0" }, formula), y = 60 + i * 40;
      txt(g, 0, y, r[0], 17, "t-strong");
      txt(g, 380, y + 2, F(r[1]), 26, "t-accent", "end");
      return g;
    });
    var stamp = txt(formula, 0, 196, "เท่ากันทุกสูตร", 24, "t-accent"); stamp.style.opacity = 0;
    var cum = [], acc = 0; (J ? J.P.unplaced : []).forEach(function (u) { acc += u; cum.push(acc); });
    var fi = J ? Math.max(0, J.years.indexOf(fullYear)) : 0;
    function setYear(yi) {
      if (!J) return;
      var blue = J.show(yi);
      keyBlue.style.opacity = blue ? 1 : 0;
      yearT.textContent = "ภาพนี้คือ พ.ศ. " + J.years[yi];
      un.textContent = yi === J.years.length - 1 ? F("c5f_PR_F0_unplaced") : U.fmt(Math.round(cum[yi]));
      head.style.opacity = J.years[yi] >= fullYear ? 1 : 0;
    }
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        formula.style.opacity = 0;
        var n = J ? J.years.length : 1;
        if (!anim) { setYear(n - 1); return; }
        // run to the full year, hold on it, then run on to 2583
        setYear(0);
        var t1 = fi * 600, hold = 1100, t2 = (n - 1 - fi) * 240;
        jobs.add(U.tween(t1, function (t) { setYear(Math.min(fi, Math.floor(t * fi + 0.0001))); }, { ease: U.ease.lin, delay: 300 }));
        later(jobs, 300 + t1, function () { setYear(fi); });
        later(jobs, 300 + t1 + hold, function () { jobs.add(U.tween(t2, function (t) { setYear(Math.min(n - 1, fi + Math.floor(t * (n - 1 - fi) + 0.0001))); }, { ease: U.ease.lin })); });
      }
      if (k === 2) {
        if (J) setYear(J.years.length - 1);
        fade(formula, true, anim ? 300 : 0, jobs);
        rows.forEach(function (r, i) { fade(r, true, anim ? 300 : 0, jobs, 200 + i * 350); });
        fade(stamp, true, anim ? 350 : 0, jobs, 200 + 3 * 350);
      }
    });
  };

  /* ---------------- s12 same positions, placed right: the 2x comparison is the hero ---------------- */
  FIGS.s12 = function (host) {
    var svg = wide(host, 400, "ตำแหน่งจำนวนเท่ากัน เกลี่ยตามสัดส่วนเดิมเทียบวางตามความจำเป็น และจำนวนตำแหน่งที่การเกลี่ยตามสัดส่วนต้องใช้เพื่อได้ผลเท่ากัน", "xMidYMin meet");
    // step 1, left: three outcomes of the same added positions, arrows on one column
    var g1 = S("g", {}, svg), CA = 318, CR = 392, CB = 470;
    txt(g1, 0, 20, "ตำแหน่งเพิ่มเท่ากัน " + F("c54_positions_added_PR") + " ตำแหน่ง · ผลใน พ.ศ. 2583", 15, "t-muted");
    txt(g1, CA, 62, "เกลี่ยตามสัดส่วนเดิม", 14, "t-pro", "middle");
    txt(g1, CB, 62, "วางตามความจำเป็น", 14, "t-need", "middle");
    var stats = [["19 จังหวัดล่างสุด", "ความเพียงพอ", "c5f_PR_F1_bq_P", "c5f_PR_bq_P"],
                 ["Gini", "ยิ่งต่ำยิ่งเท่าเทียม", "c5f_PR_F1_gini_P", "c5f_PR_gini_P"],
                 ["แพทย์ผูกพัน", "ที่กลับบ้านไม่ได้ (คน)", "c5f_PR_F1_committed_unplaced", "c54_committed_not_home_PR"]].map(function (r, i) {
      var y = 112 + i * 62, g = S("g", { style: "opacity:0" }, g1);
      txt(g, 0, y - 6, r[0], 17, "t-strong"); txt(g, 0, y + 16, r[1], 13, "t-muted");
      txt(g, CA, y + 6, F(r[2]), 26, "t-pro", "middle");
      txt(g, CR, y + 2, "→", 20, "t-muted", "middle");
      txt(g, CB, y + 8, F(r[3]), 32, "t-need", "middle");
      return g;
    });
    // step 2, right, the hero: positions needed for the same result
    var g2 = S("g", { style: "opacity:0" }, svg), BX = 600, BW = 430, mx = N("c5f_prorata_equiv_added");
    S("line", { x1: 560, x2: 560, y1: 0, y2: 300, style: "stroke:var(--line)" }, g2);
    txt(g2, BX, 20, "ตำแหน่งที่ต้องเพิ่ม เพื่อได้ผลเท่ากัน", 15, "t-muted");
    txt(g2, BX, 66, "วางตามความจำเป็น", 16, "t-need");
    var b1 = S("rect", { x: BX, y: 78, width: 0, height: 58, rx: 5, style: "fill:var(--p1)" }, g2);
    var v1 = txt(g2, BX + BW * N("c54_positions_added_PR") / mx + 14, 118, F("c54_positions_added_PR"), 30, "t-strong");
    txt(g2, BX, 176, "เกลี่ยตามสัดส่วนเดิม", 16, "t-pro");
    var b2 = S("rect", { x: BX, y: 188, width: 0, height: 58, rx: 5, style: "fill:var(--neutral)" }, g2);
    var v2 = txt(g2, BX + BW + 14, 228, F("c5f_prorata_equiv_added"), 30, "t-strong");
    var ratio = runs(g2, BX + BW, 296, [[F("c5f_prorata_equiv_ratio"), 44, "t-accent"], [" เท่า", 26, "t-accent"]], "end");
    [v1, v2, ratio].forEach(function (e) { e.style.opacity = 0; });
    // step 3, bottom left: the provinces every rule agrees on for the 2570-2574 frame
    var g3 = S("g", { style: "opacity:0" }, svg);
    S("line", { x1: 0, x2: 520, y1: 290, y2: 290, style: "stroke:var(--line)" }, g3);
    txt(g3, 0, 318, "รอบกรอบ 2570–2574 ที่กำลังจัดทำ", 14, "t-muted");
    runs(g3, 0, 360, [[F("c5f_robust_core_n") + " จังหวัด", 28, "t-accent"], [" ควรได้ตำแหน่งใหม่ไม่ว่าจะใช้เกณฑ์ใด", 16, "t-strong"]]);
    txt(g3, 0, 396, "ขาดแพทย์ " + F("c5f_core_need_n") + " · ต้องรับแพทย์ผูกพันหรือผู้กลับจากฝึกอบรม " + F("c5f_core_commit_n"), 13, "t-muted");
    return stepper(host, 3, function (k, anim, jobs) {
      if (k === 1) { g2.style.opacity = 0; g3.style.opacity = 0; stats.forEach(function (g, i) { if (anim) g.style.opacity = 0; fade(g, true, anim ? 300 : 0, jobs, 200 + i * 300); }); }
      if (k === 2) {
        fade(g2, true, anim ? 300 : 0, jobs);
        jobs.add(U.tween(anim ? 900 : 0, function (t) { b1.setAttribute("width", BW * N("c54_positions_added_PR") / mx * Math.min(1, t * 2)); b2.setAttribute("width", BW * t); }, { delay: 200 }));
        fade(v1, true, anim ? 250 : 0, jobs, 650); fade(v2, true, anim ? 250 : 0, jobs, 1100); fade(ratio, true, anim ? 350 : 0, jobs, 1300);
      }
      if (k === 3) fade(g3, true, anim ? 350 : 0, jobs);
    });
  };

  /* ---------------- s13 Bueng Kan's ladder (zero-based; the reference is 1, off the top) ---------------- */
  FIGS.s13 = function (host) {
    var svg = wide(host, 400, "ความเพียงพอของบึงกาฬ พ.ศ. 2583 ภายใต้แต่ละกติกา", "xMidYMin meet");
    var y0 = 376, k = 640, RL = 526, RR = 646;
    function Y(v) { return y0 - v * k; }
    S("line", { x1: RL - 20, x2: RR + 20, y1: y0, y2: y0, class: "axis" }, svg);
    txt(svg, RL - 32, y0 + 6, "0", 16, "t-muted", "end");
    [RL, RR].forEach(function (x) { S("line", { x1: x, y1: y0, x2: x, y2: 34, style: "stroke:var(--line-strong);stroke-width:2.5" }, svg); });
    txt(svg, (RL + RR) / 2, 18, "ค่าอ้างอิง = 1 ↑", 14, "t-muted", "middle");
    var rungs = [
      ["c54_worst_province_attain_2025", "ปี 2568 จุดตั้งต้น", "var(--muted)", "t-pro"],
      ["c5f_pw_F0", "กรอบคงที่", "var(--neutral)", "t-pro"],
      ["c5f_pw_F1", "เพิ่มตามสัดส่วน", "var(--neutral)", "t-pro"],
      ["c5f_pw_main", "วางตามความจำเป็น (แผนหลัก)", "var(--p1)", "t-need"],
      ["c5f_pw_need", "ไม่จำกัดงบ", "var(--accent)", "t-accent"]
    ];
    var rg = rungs.map(function (r) {
      var y = Y(N(r[0])), g = S("g", { style: "opacity:0" }, svg);
      S("line", { x1: RL, x2: RR, y1: y, y2: y, style: "stroke:" + r[2] + ";stroke-width:4" }, g);
      txt(g, RR + 18, y + 7, r[1], 18, r[3] === "t-pro" ? "t-strong" : r[3]);
      txt(g, RL - 18, y + 7, F(r[0]), 20, r[3], "end");
      return g;
    });
    var marker = S("circle", { cx: (RL + RR) / 2, cy: Y(N("c54_worst_province_attain_2025")), r: 11, style: "fill:var(--p1-text)" }, svg);
    var tb = S("g", {}, svg);
    txt(tb, 430, 150, "บึงกาฬ", 34, "t-bad", "end");
    txt(tb, 430, 184, "ความเพียงพอ พ.ศ. 2583", 16, "t-strong", "end");
    txt(tb, 430, 212, "ตำแหน่ง " + F("c5f_pw_K0") + " → " + F("c5f_pw_K_main") + " ตามแผนหลัก", 14, "t-muted", "end");
    return stepper(host, 1, function (kk, anim, jobs) {
      rg.forEach(function (g, i) { fade(g, true, anim ? 300 : 0, jobs, i * 200); });
      var a = N("c54_worst_province_attain_2025"), b = N("c5f_pw_main");
      jobs.add(U.tween(anim ? 1200 : 0, function (t) { marker.setAttribute("cy", Y(a + (b - a) * t)); }, { delay: 900 }));
    });
  };

  /* ---------------- s14 who pays: two maps; the two shares as the hero in the lower-left ---------------- */
  // Hospital-funded employees (P-R|GDh5) follow each province's share of MOPH hospital services
  // (outpatient visits and case-mix-weighted inpatient work, the S index): the model has no hospital
  // finance data, and services are the base of a hospital's maintenance-fund revenue.
  FIGS.s14 = function (host) {
    var svg = main(host, 530, "ลูกจ้างที่โรงพยาบาลจ้างเอง เทียบลูกจ้างจากงบส่วนกลางที่วางตามความจำเป็น");
    var low = (T.low19 || []).reduce(function (o, c) { o[c] = 1; return o; }, {});
    function panel(x, plan, title, sub, col, cls) {
      var g = S("g", {}, svg);
      txt(g, x + 155, 22, title, 16, cls, "middle");
      sub.forEach(function (line, i) { txt(g, x + 155, 46 + i * 21, line, 13, "t-muted", "middle"); });
      var m = mapAt(g, x + 155 - 121, 84, 442), P = (T.plans || {})[plan], yi = 1;
      m.each(function (c) { m.paint(c, low[c] ? "var(--surface-3)" : "var(--surface-2)", "var(--line)", 0.4); });
      var bubbles = [];
      if (P) Object.keys(P.prov).forEach(function (c) {
        var e = P.prov[c].e[yi] || 0, p = m.at(c); if (e < 1 || !p) return;
        bubbles.push({ el: S("circle", { cx: p.x, cy: p.y, r: 0, style: "fill:" + col + ";opacity:.72" }, g), r: 1.5 * Math.sqrt(e) });
      });
      // the nineteen provinces in a 2-px gold outline, drawn above the bubbles
      var top = S("g", { transform: "translate(" + m.x + "," + m.y + ") scale(" + m.sc.toFixed(4) + ")", style: "pointer-events:none" }, g);
      Object.keys(low).forEach(function (c) { if (m.el[c]) S("path", { d: m.el[c].getAttribute("d"), style: "fill:none;stroke:var(--accent-text);stroke-width:" + (1.6 / m.sc).toFixed(2) }, top); });
      return { g: g, bubbles: bubbles };
    }
    var A = panel(0, "P-R|GDh5", "โรงพยาบาลจ้างจากรายได้", ["ประมาณรายได้จากสัดส่วนบริการของ รพ. สธ.", "ผู้ป่วยนอกและผู้ป่วยในถ่วงความซับซ้อน"], "var(--p3)", "t-hosp");
    var B = panel(330, "P-R|GDc5", "ส่วนกลางจ่าย วางตามความจำเป็น", ["วางในจังหวัดที่ขาดก่อน", "ไม่ขึ้นกับรายได้ของโรงพยาบาล"], "var(--p1)", "t-need");
    B.g.style.opacity = 0;
    // lower-left: the result, one name for the target set
    var sv = side(host, 266, "ส่วนของลูกจ้างที่อยู่ใน 19 จังหวัดที่ขาดที่สุด");
    txt(sv, 0, 18, "ลูกจ้างที่อยู่ใน 19 จังหวัดที่ขาดที่สุด", 15, "t-muted");
    function hero(x, shareId, label, bqId, cls) {
      var g = S("g", {}, sv);
      txt(g, x, 92, F(shareId) + "%", 56, cls);
      txt(g, x, 124, label, 15, cls);
      runs(g, x, 166, [["ความเพียงพอ ", 13, "t-muted"], [F(bqId), 20, cls]]);
      return g;
    }
    var hA = hero(0, "c5f_gdh_low19_share", "โรงพยาบาลจ้างจากรายได้", "c5f_PR_GDh5_bq_P", "t-hosp");
    var hB = hero(240, "c5f_gdc_low19_share", "ส่วนกลางจ่าย", "c5f_PR_GDc5_bq_P", "t-need");
    var key = S("g", {}, sv);
    S("rect", { x: 0, y: 206, width: 22, height: 16, rx: 3, style: "fill:var(--surface-3);stroke:var(--accent-text);stroke-width:2" }, key);
    txt(key, 32, 220, "เส้นทองบนแผนที่ = 19 จังหวัดที่ขาดที่สุดในปีฐาน", 13, "t-muted");
    S("circle", { cx: 6, cy: 249, r: 4, style: "fill:var(--neutral)" }, key); S("circle", { cx: 20, cy: 247, r: 7, style: "fill:var(--neutral)" }, key);
    txt(key, 32, 254, "ขนาดวง = จำนวนลูกจ้างในจังหวัด", 13, "t-muted");
    hB.style.opacity = 0;
    function grow(P, anim, jobs) { P.bubbles.forEach(function (b, i) { jobs.add(U.tween(anim ? 650 : 0, function (t) { b.el.setAttribute("r", b.r * t); }, { delay: i * 20, ease: U.ease.back })); }); }
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        B.g.style.opacity = 0; hB.style.opacity = 0; B.bubbles.forEach(function (b) { b.el.setAttribute("r", 0); });
        grow(A, anim, jobs); if (anim) hA.style.opacity = 0; fade(hA, true, anim ? 300 : 0, jobs, 700);
      }
      if (k === 2) { fade(B.g, true, anim ? 300 : 0, jobs); grow(B, anim, jobs); fade(hB, true, anim ? 300 : 0, jobs, 700); }
    });
  };

  /* ---------------- s15 replan yearly (the two-layer plan under the lead) + honest validation ---------------- */
  FIGS.s15 = function (host) {
    var svg = main(host, 530, "แผนตายตัวเทียบการตัดสินใหม่ทุกปี และผลทดสอบย้อนหลังตามเกณฑ์ที่ประกาศก่อนรัน");
    var g1 = S("g", {}, svg), g2 = S("g", { style: "opacity:0" }, svg), CA = 420, CR = 494, CB = 566;
    txt(g1, CA, 22, "ตารางตายตัว", 15, "t-pro", "middle");
    txt(g1, CB, 22, "ตัดสินใหม่ทุกปี", 15, "t-need", "middle");
    function pair(y, l1, l2, a, b) {
      var g = S("g", { style: "opacity:0" }, g1);
      txt(g, 0, y, l1, 15, "t-strong"); txt(g, 0, y + 22, l2, 13, "t-muted");
      txt(g, CA, y + 12, F(a), 30, "t-pro", "middle");
      txt(g, CR, y + 8, "→", 20, "t-muted", "middle");
      txt(g, CB, y + 14, F(b), 36, "t-need", "middle");
      return g;
    }
    var pairs = [pair(78, "ส่งแพทย์ใหม่ไปจังหวัดที่ไม่มี", "ตำแหน่งว่างจริง (คนต่ออนาคต)", "c53_blocked_mean_P-R", "c53_blocked_adaptive_replanning_P-R"),
                 pair(160, "19 จังหวัดล่างสุด", "ความเพียงพอ พ.ศ. 2583", "c53_fixed_schedule_same_paths_bq_P", "c53_adaptive_replanning_bq_P")];
    txt(g1, 0, 228, "เฉลี่ยจาก " + F("c53_n_paths") + " อนาคตจำลองแบบจับคู่", 13, "t-muted");
    S("line", { x1: 0, y1: 252, x2: 640, y2: 252, style: "stroke:var(--line)" }, g2);
    txt(g2, 0, 282, "เกณฑ์ทดสอบย้อนหลังที่ประกาศก่อนรัน", 14, "t-muted");
    var crit = [
      ["ความคลาดเคลื่อนสามปีล่วงหน้า", F("c5a_hc_mae_sf_unconditional_h3") + " คนต่อจังหวัด · ค่าเดิม " + F("c5a_hc_mae_persistence_h3") + " · ตามประชากร " + F("c5a_hc_mae_poponly_h3"), true],
      ["ช่วงคาดการณ์ครอบค่าจริง", F("c5a_hc_c2_value") + " · เกณฑ์ " + F("lit.c2_lo") + "–" + F("lit.c2_hi"), false],
      ["รายชื่อกลุ่มล่างตรงกับจริง", F("c5a_hc_jac_sf_unconditional_h3") + " · เกณฑ์ " + F("lit.c3_min") + " · รายชื่อเดิม " + F("c5a_hc_jac_persistence_h3"), false]
    ];
    var items = crit.map(function (c, i) {
      var g = S("g", { style: "opacity:0" }, g2), y = 298 + i * 78;
      S("rect", { x: 0, y: y, width: 640, height: 70, rx: 8, style: "fill:var(--card);stroke:" + (c[2] ? "var(--good)" : "var(--bad)") + ";stroke-width:1.5" }, g);
      txt(g, 18, y + 28, (i + 1) + " · " + c[0], 15, "t-strong");
      txt(g, 18, y + 56, c[1], 14, c[2] ? "t-good" : "t-bad");
      txt(g, 620, y + 45, c[2] ? "ผ่าน" : "ไม่ผ่าน", 24, c[2] ? "t-good" : "t-bad", "end");
      return g;
    });
    // lower-left, under the lead it draws: positions decided every five years, postings every year.
    // Each box spans exactly its years' dots.
    var sv = side(host, 236, "ตำแหน่งตัดสินทุกห้าปี การส่งแพทย์ใหม่ตัดสินทุกปี");
    var slot = 460 / 15;
    function cx(y) { return (y - 2569 + 0.5) * slot; }
    txt(sv, 0, 20, "ตำแหน่ง · ตัดสินทุกห้าปี", 16, "t-accent");
    [[2570, 2574], [2575, 2579], [2580, 2583]].forEach(function (f) {
      S("rect", { x: cx(f[0]) - slot / 2 + 2, y: 38, width: (f[1] - f[0] + 1) * slot - 4, height: 54, rx: 7, style: "fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.5" }, sv);
      txt(sv, (cx(f[0]) + cx(f[1])) / 2, 71, f[0] + "–" + f[1], 14, "t-accent", "middle");
    });
    for (var y = 2569; y <= 2583; y++) S("circle", { cx: cx(y), cy: 126, r: 9, style: "fill:var(--p1)" }, sv);
    txt(sv, cx(2569), 160, "2569", 13, "t-muted", "middle"); txt(sv, cx(2583), 160, "2583", 13, "t-muted", "middle");
    txt(sv, 0, 200, "ส่งแพทย์ใหม่ · ตัดสินทุกปี", 16, "t-need");
    txt(sv, 0, 226, "จากตำแหน่งว่างที่เกิดขึ้นจริง", 14, "t-muted");
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) { g2.style.opacity = 0; pairs.forEach(function (p, i) { if (anim) p.style.opacity = 0; fade(p, true, anim ? 300 : 0, jobs, 300 + i * 400); }); }
      if (k === 2) { fade(g2, true, anim ? 300 : 0, jobs); items.forEach(function (g, i) { fade(g, true, anim ? 350 : 0, jobs, 250 + i * 400); }); }
    });
  };

  /* ---------------- s16 complaints vs what separates leavers (direct labels, no legend) ---------------- */
  FIGS.s16 = function (host) {
    var svg = wide(host, 340, "ความไม่พอใจเทียบความสัมพันธ์กับความตั้งใจออก และปัจจัยเชิงโครงสร้าง");
    var g1 = S("g", {}, svg), g2 = S("g", { style: "opacity:0" }, svg);
    var X0 = 62, X1 = 680, Y0 = 290, Y1 = 30, LA = Math.log(0.85), LB = Math.log(3.2);
    function x(v) { return X0 + v / 66 * (X1 - X0); }
    function y(v) { return Y0 - (Math.log(v) - LA) / (LB - LA) * (Y0 - Y1); }
    S("line", { x1: X0, y1: Y0, x2: X1, y2: Y0, class: "axis" }, g1);
    S("line", { x1: X0, y1: Y0, x2: X0, y2: Y1, class: "axis" }, g1);
    S("line", { x1: X0, y1: y(1), x2: X1, y2: y(1), style: "stroke:var(--line-strong);stroke-dasharray:5 5" }, g1);
    txt(g1, X0 + 8, y(1) + 22, "OR = 1 คือไม่ต่างระหว่างคนอยู่กับคนคิดออก", 12.5, "t-muted");
    txt(g1, 0, 14, "OR ของความตั้งใจออก", 13, "t-muted");
    txt(g1, (X0 + X1) / 2, Y0 + 44, "สัดส่วนผู้ตอบที่ไม่พอใจ (%)", 13, "t-muted", "middle");
    [0, 60].forEach(function (v) { txt(g1, x(v), Y0 + 22, String(v), 13, "t-muted", "middle"); });
    [1, 3].forEach(function (v) { txt(g1, X0 - 10, y(v) + 5, String(v), 13, "t-muted", "end"); });
    // [label, dissatisfied %, OR, dx, dy, anchor, gold]
    var pts = [
      ["ทีมและเพื่อนร่วมงาน", "c77_dis_coworkers", "c77_dr_itl_3y_coworkers", 13, 5, "start", true],
      ["คุณภาพชีวิตในพื้นที่", "c77_dis_quality_of_life", "c77_dr_itl_3y_quality_of_life", 13, 5, "start", true],
      ["โอกาสฝึก", "c77_dis_training", "c77_dr_itl_3y_training", 13, 5, "start", true],
      ["การยอมรับ", "c77_dis_recognition", "c77_dr_itl_3y_recognition", -13, 5, "end", true],
      ["เส้นทางความก้าวหน้า", "c77_dis_career_path", "c77_dr_itl_3y_career_path", 8, -15, "start", false],
      ["รายได้", "c77_dis_income", "c77_dr_itl_3y_income", -8, -15, "end", false],
      ["ภาระงาน", "c77_dis_workload", "c77_dr_itl_3y_workload", -13, 5, "end", false],
      ["นโยบายกำลังคนของกระทรวง", "c77_dis_moph_policy", "c77_dr_itl_3y_moph_policy", 12, 26, "end", false]
    ].map(function (it) {
      var g = S("g", { style: "opacity:0" }, g1), cx = x(N(it[1])), cy = y(N(it[2]));
      S("circle", { cx: cx, cy: cy, r: 9, style: "fill:" + (it[6] ? "var(--accent)" : "var(--neutral)") }, g);
      runs(g, cx + it[3], cy + it[4], [[it[0] + " ", 13.5, it[6] ? "t-accent" : "t-strong"], ["OR " + F(it[2]), 13.5, it[6] ? "t-accent" : "t-pro"]], it[5]);
      return g;
    });
    var grp = S("g", { style: "opacity:0" }, g1);
    txt(grp, 420, 56, "บ่นน้อย แต่แยกคนที่คิดออกได้", 16, "t-accent");
    txt(grp, 520, 168, "บ่นมาก แต่ไม่แยก", 16, "t-pro");
    // step 2, right: structural factors
    S("line", { x1: 730, x2: 730, y1: 0, y2: 330, style: "stroke:var(--line)" }, g2);
    txt(g2, 760, 22, "ปัจจัยเชิงโครงสร้าง", 15, "t-muted");
    var st = [["หน่วยในพื้นที่ทุรกันดาร", "→ ตั้งใจออก", "c77_or_itl3B_remote", "t-bad"],
              ["การจ้างที่ไม่มั่นคง", "→ ตั้งใจออก", "c77_or_itl3B_employment_temporary", "t-bad"],
              ["ทำงานในจังหวัดบ้านเกิด", "→ คิดย้ายออกจากพื้นที่", "c77_or_leave_areaB_home_province_match", "t-need"]];
    var rows = st.map(function (r, i) {
      var g = S("g", { style: "opacity:0" }, g2), yy = 84 + i * 84;
      txt(g, 760, yy, r[0], 16, "t-strong"); txt(g, 760, yy + 24, r[1], 14, "t-muted");
      txt(g, 1132, yy + 14, "OR " + F(r[2]), 30, r[3], "end");
      return g;
    });
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) { g2.style.opacity = 0; pts.forEach(function (p, i) { if (anim) p.style.opacity = 0; fade(p, true, anim ? 300 : 0, jobs, 200 + i * 140); }); fade(grp, true, anim ? 350 : 0, jobs, anim ? 1400 : 0); }
      if (k === 2) { fade(g2, true, anim ? 300 : 0, jobs); rows.forEach(function (r, i) { fade(r, true, anim ? 300 : 0, jobs, 200 + i * 300); }); }
    });
  };

  /* ---------------- s17 the gap closes three ways: one way per step, then who carries it ---------------- */
  // Every column starts from the same pair (obligation 150, capacity 88 units): a dashed ghost keeps
  // that start on screen. 1 capacity grows to the obligation; 2 the obligation shrinks to capacity
  // (the cut part stays dashed); 3 a family segment fills the gap at the end of the capacity bar.
  FIGS.s17 = function (host) {
    var svg = main(host, 530, "ช่องว่างปิดได้สามทาง");
    var OB = 150, CP = 88, Y1 = 160, Y2 = 300, BH = 56;
    txt(svg, 0, Y1 + 32, "พันธะ", 16, "t-muted");
    txt(svg, 0, Y2 + 32, "ขีดความสามารถ", 16, "t-muted");
    var heads = [["เพิ่มขีดความ", "สามารถจริง"], ["เปลี่ยนเป้าหมาย", "หรือขอบเขต"], ["ย้ายภาระ", "ไปให้ผู้อื่น"]];
    var outc = [["ปิดจริง", "t-need"], ["ปิดบนกระดาษ", "t-pro"], ["ย้ายไปที่บ้าน", "t-bad"]];
    var parts = heads.map(function (h, i) {
      var x = 128 + i * 172, g = S("g", {}, svg);
      S("circle", { cx: x + 14, cy: 58, r: 15, style: "fill:" + (i === 2 ? "var(--bad)" : "var(--text-2)") }, g);
      txt(g, x + 14, 64, String(i + 1), 16, "", "middle", { style: "fill:var(--inverse);font-weight:700" });
      txt(g, x + 38, 52, h[0], 15, i === 2 ? "t-bad" : "t-strong"); txt(g, x + 38, 74, h[1], 15, i === 2 ? "t-bad" : "t-strong");
      // ghosts of the starting pair
      S("rect", { x: x, y: Y1, width: OB, height: BH, rx: 5, style: "fill:none;stroke:var(--p2-text);stroke-width:1.4;stroke-dasharray:5 4;opacity:.6" }, g);
      S("rect", { x: x, y: Y2, width: CP, height: BH, rx: 5, style: "fill:none;stroke:var(--p1-text);stroke-width:1.4;stroke-dasharray:5 4;opacity:.6" }, g);
      var ob = S("rect", { x: x, y: Y1, width: OB, height: BH, rx: 5, style: "fill:var(--p2)" }, g);
      var cap = S("rect", { x: x, y: Y2, width: CP, height: BH, rx: 5, style: "fill:var(--p1)" }, g);
      var gap = S("rect", { x: x + CP, y: Y2, width: OB - CP, height: BH, rx: 5, style: "fill:none;stroke:var(--bad-text);stroke-width:1.6;stroke-dasharray:5 4" }, g);
      var fam = S("rect", { x: x + CP, y: Y2, width: 0, height: BH, rx: 5, style: "fill:var(--bad)" }, g);
      var lab = txt(g, x + CP + (OB - CP) / 2, Y2 + BH + 30, "ช่องว่าง", 14, "t-bad", "middle");
      var famL = S("g", { style: "opacity:0" }, g);
      txt(famL, x + OB, Y2 + BH + 30, "ครอบครัว", 15, "t-bad", "end"); txt(famL, x + OB, Y2 + BH + 52, "และวิชาชีพอื่น", 13, "t-bad", "end");
      var out = txt(g, x, 478, outc[i][0], 22, outc[i][1]); out.style.opacity = 0;
      return { g: g, x: x, ob: ob, cap: cap, gap: gap, fam: fam, lab: lab, famL: famL, out: out };
    });
    var ways = [
      function (p, anim, jobs) { jobs.add(U.tween(anim ? 1100 : 0, function (t) { p.cap.setAttribute("width", CP + (OB - CP) * t); p.gap.setAttribute("x", p.x + CP + (OB - CP) * t); p.gap.setAttribute("width", (OB - CP) * (1 - t)); }, { delay: 300 })); },
      function (p, anim, jobs) { jobs.add(U.tween(anim ? 1100 : 0, function (t) { p.ob.setAttribute("width", OB - (OB - CP) * t); p.gap.setAttribute("width", (OB - CP) * (1 - t)); }, { delay: 300 })); },
      function (p, anim, jobs) { jobs.add(U.tween(anim ? 1100 : 0, function (t) { p.fam.setAttribute("width", (OB - CP) * t); }, { delay: 300 })); fade(p.famL, true, anim ? 300 : 0, jobs, 900); }
    ];
    // step 4, lower-left under its sentence: way three is closer than it looks
    var sv = side(host, 196, "ร้อยละของผู้ตอบที่เป็นผู้ดูแลหลักในครอบครัว และที่คิดเกษียณก่อนกำหนด"), call = S("g", { style: "opacity:0" }, sv);
    txt(call, 0, 18, "ทางที่ 3 ในชีวิตจริงของผู้ตอบ", 14, "t-bad");
    txt(call, 0, 84, F("c77_pct_primary_carer") + "%", 56, "t-bad");
    txt(call, 0, 120, "ของผู้ตอบเป็นผู้ดูแลหลัก", 15, "t-strong"); txt(call, 0, 144, "ของผู้สูงอายุหรือผู้ป่วยในครอบครัว", 15, "t-strong");
    txt(call, 250, 84, F("c77_early_retire_all") + "%", 56, "t-bad");
    txt(call, 250, 120, "คิดเกษียณก่อนกำหนด", 15, "t-strong"); txt(call, 250, 144, "หรือลดชั่วโมงทำงาน", 15, "t-strong");
    txt(call, 0, 184, "การสำรวจผู้ปฏิบัติงาน พ.ศ. 2569", 12, "t-muted");
    return stepper(host, 4, function (k, anim, jobs) {
      if (k === 1) {   // only the first way is on screen; every column starts with its gap open
        call.style.opacity = 0;
        parts.forEach(function (p, i) {
          p.ob.setAttribute("width", OB); p.cap.setAttribute("width", CP); p.fam.setAttribute("width", 0);
          p.gap.setAttribute("x", p.x + CP); p.gap.setAttribute("width", OB - CP);
          p.lab.style.opacity = 1; p.famL.style.opacity = 0; p.out.style.opacity = 0; p.g.style.opacity = i === 0 ? 1 : 0;
        });
      }
      if (k <= 3) {
        var p = parts[k - 1];
        if (k > 1) fade(p.g, true, anim ? 300 : 0, jobs);
        ways[k - 1](p, anim, jobs);
        fade(p.lab, false, anim ? 250 : 0, jobs, 1300);
        fade(p.out, true, anim ? 300 : 0, jobs, 1300);
      }
      if (k === 4) fade(call, true, anim ? 400 : 0, jobs);
    });
  };

  /* ---------------- s18 back to the four seams: seven proposals placed where they act ---------------- */
  // Step 1 is the s03 map with the evidence at each seam. Step 2 keeps the seams as marks, clears
  // their words and puts each proposal where it acts, numbered in the order it must be done. A
  // proposal's colour is the frame of the talk it comes from (key in the lower-left): social
  // provisioning, Myrdal's cumulative causation, labour economics. Proposal 7, the yearly review,
  // is the loop back to counting.
  FIGS.s18 = function (host) {
    var svg = U.svgHost(host, "-10 0 640 516", "รอยต่อสี่จุด และข้อเสนอเจ็ดข้อที่วางตรงจุดที่แก้ เรียงตามลำดับที่ต้องทำ", "xMidYMin meet"); U.defs(svg);
    var d = provisioning(svg, { e: ["กรอบคือสูตร · เต็มปี " + F("c5f_PR_F0_first_unplaced"), "ไม่มีตำแหน่ง " + F("c5f_PR_F0_unplaced") + " คน", "ทีม การฝึก การยอมรับ", "ป่วยหนัก หมอน้อย " + F("c45_ci_physicians_all_sectors_daly_2025")] });
    d.breaks.forEach(function (g) { g.style.opacity = 1; });
    var FR = {
      sp: { c: "var(--p1)", n: "การจัดให้มีบริการทางสังคม", m: "ใครมีพันธะ และเรานับอะไร" },
      my: { c: "var(--accent)", n: "วงจรสะสม (Myrdal)", m: "แรงจากภายนอกที่ต้องมีทิศ" },
      lab: { c: "var(--p2)", n: "เศรษฐศาสตร์แรงงาน", m: "สิ่งที่ผูกคนไว้ และใครรับภาระ" }
    };
    // the loop back from the service to counting (proposal 7), drawn under the chips
    var loop = S("path", { d: "M205,400 C150,400 -2,410 -2,330 L-2,84 C-2,68 4,60 12,60", style: "fill:none;stroke:var(--p1);stroke-width:2.4;opacity:0" }, svg);
    var head = S("path", { d: "M5,53 L15,60 L5,67 Z", style: "fill:var(--p1);opacity:0" }, svg);
    var st = [
      { n: 1, x: 240, y: 60, f: "sp", lx: 262, ly: 58, a: "start", t: ["กระทบยอดจำนวน", "และขอบเขต"] },
      { n: 2, x: 240, y: 150, f: "sp", lx: 262, ly: 148, a: "start", t: ["เทียบแผนหลายฐาน", "เปิดผลได้–เสีย"] },
      { n: 3, x: 310, y: 278, f: "my", lx: 310, ly: 318, a: "middle", t: ["ตำแหน่งตามความจำเป็น", "ส่วนกลางจ่าย"] },
      { n: 4, x: 466, y: 105, f: "my", lx: 446, ly: 111, a: "end", t: ["ผูกโควตาผลิตกับตำแหน่ง"] },
      { n: 5, x: 466, y: 195, f: "lab", lx: 446, ly: 201, a: "end", t: ["ออกแบบการธำรงคนในระบบ เริ่มที่ทุรกันดาร"] },
      { n: 6, x: 348, y: 444, f: "lab", lx: 372, ly: 450, a: "start", t: ["ทีมและการดูแลต่อเนื่อง", "ไม่ซ่อนภาระผู้ดูแล"] },
      { n: 7, x: 55, y: 389, f: "sp", lx: 34, ly: 430, a: "start", t: ["ทบทวนรายปี", "เปิดเหตุผลให้ตรวจ"] }
    ];
    var chips = st.map(function (c) {
      var g = S("g", { style: "opacity:0" }, svg);
      if (c.n === 6) S("path", { d: "M320,444 H333", style: "fill:none;stroke:var(--bad-text);stroke-width:2" }, g);   // joined to seam 4
      S("circle", { cx: c.x, cy: c.y, r: 15, style: "fill:" + FR[c.f].c + ";stroke:var(--bg);stroke-width:2.5" }, g);
      txt(g, c.x, c.y + 5.5, String(c.n), 16, "", "middle", { style: "fill:var(--inverse);font-weight:700" });
      c.t.forEach(function (line, i) { txt(g, c.lx, c.ly + i * 22, line, 15.5, "t-strong", c.a); });
      return g;
    });
    // lower-left: what the colours mean, at reading size
    var sv = side(host, 300, "สีของข้อเสนอบอกกรอบของเรื่องที่ข้อเสนอนั้นมาจาก"), leg = S("g", { style: "opacity:0" }, sv);
    txt(leg, 0, 20, "ตัวเลขคือลำดับที่ต้องทำ · สีบอกว่ามาจากกรอบใด", 14, "t-muted");
    ["sp", "my", "lab"].forEach(function (k, i) {
      var y = 72 + i * 70;
      S("circle", { cx: 12, cy: y - 6, r: 11, style: "fill:" + FR[k].c }, leg);
      txt(leg, 34, y, FR[k].n, 17, "t-strong");
      txt(leg, 34, y + 26, FR[k].m, 14, "t-muted");
    });
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        d.parts.forEach(function (p) {
          p.words.forEach(function (w) { w.style.opacity = 1; });
          p.ring.setAttribute("r", 16); p.ring.setAttribute("style", "fill:var(--bad);stroke:var(--bg);stroke-width:2");
        });
        chips.forEach(function (g) { g.style.opacity = 0; });
        loop.style.opacity = 0; head.style.opacity = 0; leg.style.opacity = 0;
      }
      if (k === 2) {
        if (anim) chips.concat([loop, head, leg]).forEach(function (e) { e.style.opacity = 0; });
        // the seams stay as open pink marks; their words make way for the proposals
        d.parts.forEach(function (p) {
          p.words.forEach(function (w) { fade(w, false, anim ? 250 : 0, jobs); });
          p.ring.setAttribute("r", 10); p.ring.setAttribute("style", "fill:var(--bg);stroke:var(--bad-text);stroke-width:2.6");
        });
        chips.forEach(function (g, i) { if (i < 6) fade(g, true, anim ? 280 : 0, jobs, 250 + i * 230); });
        var t7 = 250 + 6 * 230;
        fade(loop, true, anim ? 350 : 0, jobs, t7); fade(head, true, anim ? 350 : 0, jobs, t7);
        fade(chips[6], true, anim ? 280 : 0, jobs, t7 + 200);
        fade(leg, true, anim ? 350 : 0, jobs, anim ? 400 : 0);
      }
    });
  };

  // Closing slide: a QR the back rows can scan, and the address at reading size.
  window.PEITHO = window.PEITHO || {};
  (window.PEITHO.hooks = window.PEITHO.hooks || { afterRender: [], onShow: [] }).afterRender.push(function () {
    var q = document.getElementById("s19-qr");
    if (!q || q.firstChild) return;
    var src = (T.assets && T.assets.qr) || "../../assets/qr/hrh-model.svg";
    q.innerHTML = '<span class="qr"><img src="' + src + '" alt="QR เว็บไซต์ HRH-model"></span>' +
      '<p>ตรวจทุกผล และลองเปลี่ยนแผนเองได้ใน <b class="nobr">Workforce Lab</b></p><p class="url">psitthirat.github.io/<wbr><span class="nobr">HRH-model</span></p>';
  });

  window.FIGS = FIGS;
})();
