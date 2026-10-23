/* Figures for ws3-next (อ.สัมฤทธิ์). Same contract as ws3-findings: FIGS[id](host)
 * returns { steps, setStep(n) }; numbers come from F(id) with a claim id (resolved by
 * talks_build into TALKDATA.facts); colours come from tokens. The recurring motif is the
 * 2x2 knowledge map (diagnosis/prescription x within/changing the frame), drawn by quad().
 * Steps accumulate: the last step holds every element, so Read mode and the PDF are complete.
 */
(function () {
  "use strict";
  var U = window.HUD, S = U.S, H = U.H;
  var T = window.TALKDATA || {}, FACTS = T.facts || {};
  function F(id) { var v = FACTS[id]; if (v == null) { if (window.console) console.warn("missing fact " + id); return "?"; } return v; }
  var FIGS = {};
  var DECK_ID = (window.DECK && window.DECK.meta && window.DECK.meta.id) || "ws3-next";

  // Step controller (shared, hud.js): only the new step animates; arrivals at a later step are static.
  var stepper = U.stepper;
  function txt(parent, x, y, s, size, cls, anchor, extra) {
    return S("text", Object.assign({ x: x, y: y, "font-size": size || 14, class: cls || "", "text-anchor": anchor || "start", text: s }, extra || {}), parent);
  }
  function fade(el, on, ms, jobs, delay) {
    if (!el) return;
    if (!ms) { el.style.opacity = on ? 1 : 0; return; }
    var from = +(el.style.opacity || (on ? 0 : 1));
    jobs.add(U.tween(ms, function (t) { el.style.opacity = from + ((on ? 1 : 0) - from) * t; }, { delay: delay || 0 }));
  }
  function later(jobs, ms, fn) { var tm = setTimeout(fn, ms); jobs.add({ stop: function () { clearTimeout(tm); } }); }

  // Scoped styles for the HTML figures of this deck (no engine edits).
  (function style() {
    if (document.getElementById("nx-style")) return;
    var css = [
      ".nx-grid{display:grid;gap:calc(var(--u)*1.1);height:100%;align-content:start}",
      ".nx-card{padding:calc(var(--u)*1) calc(var(--u)*1.2);display:flex;flex-direction:column;gap:calc(var(--u)*.45);min-width:0;transition:opacity .45s var(--ease),transform .45s var(--ease)}",
      ".nx-card h4{font-size:calc(var(--fs-body)*1.05);color:var(--text-1);font-weight:500;line-height:1.35;margin:0}",
      ".nx-card p{font-size:var(--fs-small);color:var(--text-2);line-height:1.5;margin:0}",
      ".nx-num{font-family:var(--display);font-size:calc(var(--fs-title)*1.05);color:var(--accent-text);text-shadow:var(--glow);line-height:1}",
      ".nx-tag{display:inline-flex;align-self:flex-start;font-size:calc(var(--fs-small)*.92);border-radius:999px;padding:1px 10px;border:1px solid var(--line-strong);color:var(--text-2)}",
      ".nx-chip{display:inline-block;font-size:var(--fs-small);color:var(--text-1);border-left:2px solid var(--accent);padding:2px 0 2px 10px;line-height:1.45}",
      ".nx-chip b{color:var(--accent-text);font-weight:500}",
      ".nx-head{display:flex;align-items:baseline;gap:calc(var(--u)*.8)}",
      ".nx-note{min-height:calc(var(--u)*5.2);border:1px dashed var(--line-strong);border-radius:6px;padding:calc(var(--u)*.6) calc(var(--u)*.8);font-size:var(--fs-body);color:var(--text-1);line-height:1.5;outline:none;background:var(--accent-soft)}",
      ".nx-note:focus{border-color:var(--accent-text);background:var(--accent-soft)}",
      ".nx-note:empty::before{content:attr(data-ph);color:var(--muted)}",
      ".nx-edit{font-size:calc(var(--fs-small)*.9);color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 9px;margin-left:auto;white-space:nowrap}",
      ".nx-col h5{margin:0 0 calc(var(--u)*.6);font-size:var(--fs-small);font-weight:500;color:var(--accent-text);letter-spacing:.02em}",
      ".nx-col ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:calc(var(--u)*.55)}",
      ".nx-col li{font-size:var(--fs-small);color:var(--text-1);line-height:1.45;padding:calc(var(--u)*.45) calc(var(--u)*.6);border:1px solid var(--line);border-radius:6px;background:var(--card);transition:opacity .4s var(--ease)}",
      ".nx-col li b{color:var(--accent-text);font-weight:500}",
      ".nx-table{width:100%;border-collapse:collapse;font-size:var(--fs-small);line-height:1.45}",
      ".nx-table th{text-align:left;font-weight:500;color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--line-strong)}",
      ".nx-table td{padding:calc(var(--u)*.55) 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--text-2);transition:opacity .4s var(--ease)}",
      ".nx-table td:first-child{color:var(--text-1);font-weight:500;white-space:nowrap}",
      ".nx-check li::before{content:'✓ ';color:var(--good-text)}",
      ".nx-quote{font-size:calc(var(--fs-lead)*.98);color:var(--text-1);font-weight:300;line-height:1.45;border-left:3px solid var(--accent);padding-left:calc(var(--u)*1)}",
      ".nx-src{font-size:calc(var(--fs-small)*.9);color:var(--muted)}"
    ].join("\n");
    var st = document.createElement("style"); st.id = "nx-style"; st.textContent = css; document.head.appendChild(st);
  })();

  /* ---------------- the 2x2 knowledge map ---------------- */
  var QNAME = ["วินิจฉัยภายในกรอบเดิม", "วินิจฉัยเชิงรากฐาน · วิพากษ์", "ข้อเสนอภายใต้กติกาปัจจุบัน", "ข้อเสนอเชิงโครงสร้างระยะกลางถึงยาว"];
  // quad(g, {x, y, w, h, labels}) -> {tiles, rect(i), center(i)}; i = 0..3 for ช่องที่ 1..4
  function quad(g, o) {
    var gap = o.gap == null ? 8 : o.gap, lw = o.rowLabel === false ? 0 : 58, top = o.colLabel === false ? 0 : 26;
    var tw = (o.w - lw - gap) / 2, th = (o.h - top - gap) / 2, x0 = o.x + lw, y0 = o.y + top;
    if (o.colLabel !== false) {
      txt(g, x0 + tw / 2, o.y + 16, "ภายในกรอบ", o.fs || 14, "t-muted", "middle");
      txt(g, x0 + tw + gap + tw / 2, o.y + 16, "เปลี่ยนกรอบ", o.fs || 14, "t-accent", "middle");
    }
    if (o.rowLabel !== false) {
      txt(g, o.x, y0 + th / 2 + 5, "วินิจฉัย", o.fs || 14, "t-muted");
      txt(g, o.x, y0 + th + gap + th / 2 - 4, "เสนอ", o.fs || 14, "t-muted");
      txt(g, o.x, y0 + th + gap + th / 2 + 14, "ทางออก", o.fs || 14, "t-muted");
    }
    var tiles = [0, 1, 2, 3].map(function (i) {
      var cx = x0 + (i % 2) * (tw + gap), cy = y0 + Math.floor(i / 2) * (th + gap);
      var t = S("g", {}, g);
      S("rect", { x: cx, y: cy, width: tw, height: th, rx: 6, style: "fill:" + (i === 3 ? "var(--accent-soft)" : "var(--card)") + ";stroke:" + (i === 3 ? "var(--accent)" : "var(--line-strong)") + ";stroke-width:" + (i === 3 ? 1.6 : 1) }, t);
      txt(t, cx + 12, cy + (o.numSize || 30) + 4, String(i + 1), o.numSize || 30, i === 3 ? "t-accent glow" : "t-muted");
      if (o.labels !== false) txt(t, cx + 12, cy + th - 12, QNAME[i], o.lfs || 13, i === 3 ? "t-accent" : "t-strong");
      return t;
    });
    return {
      tiles: tiles,
      rect: function (i) { return { x: x0 + (i % 2) * (tw + gap), y: y0 + Math.floor(i / 2) * (th + gap), w: tw, h: th }; },
      center: function (i) { var r = this.rect(i); return [r.x + r.w / 2, r.y + r.h / 2]; }
    };
  }

  /* ---------------- s01 title: rotating 2x2 hologram ---------------- */
  FIGS.s01 = function (host) {
    var wrap = H("div", "fig__svg", null, host);
    wrap.style.perspective = "1300px";
    var svg = S("svg", { viewBox: "-60 -60 640 640", role: "img", "aria-label": "แผนที่ความรู้สี่ช่อง" });
    svg.style.transform = "rotateX(18deg) rotateY(-14deg)"; svg.style.transformOrigin = "50% 50%";
    wrap.appendChild(svg); U.defs(svg);
    var q = quad(svg, { x: 40, y: 60, w: 440, h: 420, labels: false, numSize: 54, gap: 14 });
    var ring = S("g", { transform: "translate(260,280)" }, svg);
    [290, 320].forEach(function (r, i) { S("circle", { r: r, style: "fill:none;stroke:var(--line-strong);stroke-width:1;stroke-dasharray:" + (i ? "2 10" : "70 18") }, ring); });
    var q4 = q.tiles[3].querySelector("rect");
    var a = 0;
    U.loop(svg, function (dt, ts) {
      a = (a + dt * 0.005) % 360; ring.setAttribute("transform", "translate(260,280) rotate(" + a + ")");
      q4.style.fillOpacity = 0.6 + 0.4 * Math.abs(Math.sin(ts / 1100));
    });
    return { steps: 1, setStep: function () {} };
  };

  /* ---------------- s02 live recap: four editable debate cards ---------------- */
  FIGS.s02 = function (host) {
    var debates = [
      "ความจำเป็นใดควรถูกนับก่อน",
      "ใครควรเป็นผู้จ้าง และอะไรกำหนดว่าพื้นที่รับคนได้เท่าใด",
      "ใครรับภาระของความไม่เพียงพอ ระหว่างรัฐ ผู้ทำงาน ครอบครัว และชุมชน",
      "ใครควรมีสิทธิ์ตัดสินว่าเท่าใดจึงเพียงพอ และฉันทามติควรสร้างผ่านช่องทางใด"
    ];
    var grid = H("div", "nx-grid", null, host);
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    grid.style.gridAutoRows = "1fr";
    function key(i) { return "peitho:" + DECK_ID + ":panel-note:" + i; }
    var cards = debates.map(function (d, i) {
      var c = H("div", "nx-card hud-panel", null, grid);
      var head = H("div", "nx-head", '<span class="nx-num">' + (i + 1) + "</span><h4>" + d + "</h4>", c);
      H("span", "nx-edit", "พิมพ์ได้", head);
      var note = H("div", "nx-note", null, c);
      note.style.flex = "1";
      note.setAttribute("contenteditable", "true");
      note.setAttribute("data-ph", "[จดสิ่งที่ได้ยินระหว่างวงเสวนา]");
      note.setAttribute("aria-label", "บันทึกข้อถกเถียงที่ " + (i + 1));
      try { var v = localStorage.getItem(key(i)); if (v) note.textContent = v; } catch (e) { /* storage blocked */ }
      note.addEventListener("input", function () { try { localStorage.setItem(key(i), note.textContent); } catch (e) { /* storage blocked */ } });
      return c;
    });
    return stepper(host, 1, function (k, anim, jobs) {
      cards.forEach(function (c, i) {
        if (!anim) { c.style.opacity = 1; c.style.transform = "none"; return; }
        c.style.opacity = 0; c.style.transform = "translateY(8px)";
        later(jobs, 120 + i * 160, function () { c.style.opacity = 1; c.style.transform = "none"; });
      });
    });
  };

  /* ---------------- s03 the frame and the findings that hit its walls ---------------- */
  FIGS.s03 = function (host) {
    var svg = U.svgHost(host, "0 0 640 520", "ผลที่คงทนที่สุดชนผนังของกรอบที่แบบจำลองรับไว้"); U.defs(svg);
    var box = { x: 10, y: 70, w: 300, h: 360 };
    S("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: 10, style: "fill:var(--accent-soft);stroke:var(--accent);stroke-width:2", class: "glow" }, svg);
    txt(svg, box.x + 16, box.y + 30, "กติกาที่แบบจำลองรับไว้", 15, "t-accent");
    txt(svg, box.x + 16, box.y + 52, "ตำแหน่ง · ผู้จ้าง · ที่ตั้งการฝึก · ตลาด · งานดูแล", 11.5, "t-muted");
    var parts = [];
    for (var i = 0; i < 26; i++) {
      var a = i * 2.39996;
      parts.push({ x: box.x + 40 + (i * 37) % (box.w - 80), y: box.y + 90 + (i * 53) % (box.h - 120), vx: Math.cos(a) * 0.09, vy: Math.sin(a) * 0.09,
        el: S("circle", { r: 4, style: "fill:var(--p1)" }, svg) });
    }
    var hits = S("g", {}, svg);
    U.loop(svg, function (dt) {
      parts.forEach(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        var hit = false;
        if (p.x < box.x + 6 || p.x > box.x + box.w - 6) { p.vx = -p.vx; hit = true; p.x = Math.max(box.x + 6, Math.min(box.x + box.w - 6, p.x)); }
        if (p.y < box.y + 66 || p.y > box.y + box.h - 6) { p.vy = -p.vy; hit = true; p.y = Math.max(box.y + 66, Math.min(box.y + box.h - 6, p.y)); }
        p.el.setAttribute("cx", p.x); p.el.setAttribute("cy", p.y);
        if (hit && hits.childNodes.length < 14) {
          var f = S("circle", { cx: p.x, cy: p.y, r: 3, style: "fill:none;stroke:var(--accent);stroke-width:1.5" }, hits), age = 0;
          var job = U.loop(f, function (d) { age += d; f.setAttribute("r", 3 + age / 30); f.style.opacity = Math.max(0, 1 - age / 600); if (age > 600) { job.stop(); f.remove(); } });
        }
      });
    });
    if (U.isStatic()) parts.forEach(function (p) { p.el.setAttribute("cx", p.x); p.el.setAttribute("cy", p.y); });
    var chips = [
      "กรอบเต็มแล้ว ทุกหลักคิดให้ " + F("c5f_PR_F0_bq_P"),
      "วางตำแหน่งถูกที่ = เพิ่ม " + F("c5f_prorata_equiv_ratio") + " เท่า",
      "ใครจ่าย: " + F("c5f_PR_GDh5_bq_P") + " เทียบ " + F("c5f_PR_GDc5_bq_P"),
      F("c46_dis_n_all_four") + " จังหวัดต่ำทุกไม้บรรทัด",
      "เฉพาะทาง " + F("c46_conc_top10_all1") + "% ในร้อยละสิบของสถานพยาบาล",
      "ผู้ตอบ " + F("c77_pct_primary_carer") + "% เป็นผู้ดูแลหลักในครอบครัว"
    ].map(function (s, i) {
      var g = S("g", { style: "opacity:0" }, svg), y = 84 + i * 60;
      S("path", { d: "M" + (box.x + box.w) + "," + (box.y + 40 + i * 56) + " C" + (box.x + box.w + 30) + "," + (box.y + 40 + i * 56) + " 320," + (y + 4) + " 342," + (y + 4), style: "fill:none;stroke:var(--accent);stroke-width:1.2;stroke-dasharray:3 4" }, g);
      S("rect", { x: 342, y: y - 20, width: 296, height: 46, rx: 6, style: "fill:var(--card);stroke:var(--line-strong)" }, g);
      txt(g, 354, y + 8, s, 12.5, "t-strong");
      return g;
    });
    txt(svg, box.x, 466, "ผลที่คงทนที่สุดชี้ไปนอกกติกาที่เปลี่ยนได้ในรอบการจัดสรร", 13, "t-muted");
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) chips.forEach(function (c) { c.style.opacity = 0; });
      if (k === 2) chips.forEach(function (c, i) { fade(c, true, anim ? 380 : 0, jobs, 150 + i * 260); });
    });
  };

  /* ---------------- s04 the four boxes of knowledge ---------------- */
  FIGS.s04 = function (host) {
    var svg = U.svgHost(host, "0 0 640 520", "กรอบสี่ช่อง: วินิจฉัยหรือเสนอทางออก ภายในกรอบหรือเปลี่ยนกรอบ"); U.defs(svg);
    var g = S("g", {}, svg);
    var q = quad(g, { x: 0, y: 0, w: 640, h: 420, lfs: 13.5 });
    var extra = S("g", { style: "opacity:0" }, svg);
    var r3 = q.rect(2), r4 = q.rect(3), my = r3.y + r3.h / 2, xa = r3.x + r3.w - 70, xb = r4.x + 70;
    S("rect", { x: xa - 8, y: my - 34, width: xb - xa + 16, height: 68, rx: 8, style: "fill:var(--card-strong);stroke:var(--accent);stroke-width:1" }, extra);
    S("path", { d: "M" + xa + "," + (my - 8) + " H" + (xb - 10), style: "fill:none;stroke:var(--accent);stroke-width:1.8" }, extra);
    S("path", { d: "M" + (xb - 12) + "," + (my - 14) + " L" + xb + "," + (my - 8) + " L" + (xb - 12) + "," + (my - 2) + "Z", style: "fill:var(--accent)" }, extra);
    S("path", { d: "M" + xb + "," + (my + 12) + " H" + (xa + 10), style: "fill:none;stroke:var(--p1);stroke-width:1.8" }, extra);
    S("path", { d: "M" + (xa + 12) + "," + (my + 6) + " L" + xa + "," + (my + 12) + " L" + (xa + 12) + "," + (my + 18) + "Z", style: "fill:var(--p1)" }, extra);
    txt(extra, (xa + xb) / 2, my - 18, "ส่งงานให้กัน", 12.5, "t-strong", "middle");
    txt(extra, 58, 452, "Lindblom · ปรับทีละน้อย เปรียบเทียบทางเลือกที่ใกล้กัน", 13.5, "t-muted");
    txt(extra, 58, 476, "Etzioni · กวาดตาแบบผสม: สำรวจทางเลือกพื้นฐานอย่างกว้าง แล้วลงมือทีละขั้น", 13.5, "t-accent");
    txt(extra, 58, 504, "radical = การแตะถึงราก ไม่ใช่ความสุดโต่ง", 13.5, "t-strong");
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        extra.style.opacity = 0;
        q.tiles.forEach(function (t, i) { if (!anim) { t.style.opacity = 1; return; } t.style.opacity = 0; fade(t, true, 420, jobs, 200 + i * 350); });
      }
      if (k === 2) fade(extra, true, anim ? 450 : 0, jobs);
    });
  };

  /* ---------------- s05 where this study sits ---------------- */
  FIGS.s05 = function (host) {
    var svg = U.svgHost(host, "0 0 640 520", "งานของการศึกษาครั้งนี้ในสี่ช่อง"); U.defs(svg);
    var q = quad(svg, { x: 0, y: 0, w: 640, h: 380, labels: false, numSize: 22 });
    var items = [
      [0, ["การนับและตัวหาร", "การไหลเข้าออก", "การสำรวจกำลังคน"], "var(--p1)"],
      [1, ["กรอบการจัดให้มีบริการ", "อำนาจวิชาชีพ", "แรงงานดูแล"], "var(--p2)"],
      [2, ["แบบจำลองจัดสรร", "ชุดมาตรการคงอยู่"], "var(--p1)"],
      [3, ["วงจรทบทวนรายปี"], "var(--accent)"]
    ];
    var dots = [];
    items.forEach(function (it) {
      var r = q.rect(it[0]);
      it[1].forEach(function (lab, j) {
        var g = S("g", { style: "opacity:0" }, svg), x = r.x + 26, y = r.y + 58 + j * 34;
        S("circle", { cx: x, cy: y - 5, r: 7, style: "fill:" + it[2] }, g);
        txt(g, x + 16, y, lab, 14, "t-strong");
        dots.push(g);
      });
    });
    var r4 = q.rect(3);
    var empty = S("g", { style: "opacity:0" }, svg);
    S("rect", { x: r4.x + 6, y: r4.y + 6, width: r4.w - 12, height: r4.h - 12, rx: 6, style: "fill:none;stroke:var(--accent);stroke-width:1.5;stroke-dasharray:6 6" }, empty);
    txt(empty, r4.x + r4.w - 16, r4.y + r4.h - 16, "เกือบว่าง", 16, "t-accent glow", "end");
    var quote = S("g", { style: "opacity:0" }, svg);
    S("line", { x1: 0, y1: 404, x2: 0, y2: 500, style: "stroke:var(--accent);stroke-width:3" }, quote);
    txt(quote, 18, 428, "“การศึกษาครั้งนี้กล่าวได้ว่าภายใต้กติกาที่สมมติ ทางเลือกใดให้ผลอย่างไร", 15, "t-strong");
    txt(quote, 18, 454, "แต่ยังกล่าวไม่ได้ว่าการเปลี่ยนกติกาใดจะให้ผลดีกว่า", 15, "t-strong");
    txt(quote, 18, 480, "และต้องแลกด้วยอะไร”", 15, "t-strong");
    txt(quote, 18, 506, "รายงานการศึกษา บทที่ 11", 11.5, "t-muted");
    var pulse = { stop: function () {} };
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        quote.style.opacity = 0;
        dots.forEach(function (d, i) { fade(d, true, anim ? 300 : 0, jobs, 200 + i * 180); });
        fade(empty, true, anim ? 400 : 0, jobs, 200 + dots.length * 180);
        pulse.stop();
        if (!U.isStatic()) { var dash = 0; pulse = jobs.add(U.loop(empty, function (dt) { dash = (dash + dt * 0.02) % 12; empty.firstChild.style.strokeDashoffset = dash; })); }
      }
      if (k === 2) fade(quote, true, anim ? 450 : 0, jobs);
    });
  };

  /* ---------------- s06 why quadrant four first, and on what conditions ---------------- */
  FIGS.s06 = function (host) {
    var svg = U.svgHost(host, "0 0 640 520", "เหตุผลสามข้อและเงื่อนไขของช่องที่สี่"); U.defs(svg);
    // reason 1: the findings point there
    var g1 = S("g", {}, svg);
    txt(g1, 0, 18, "เหตุผลที่หนึ่ง · ผลของการศึกษาชี้ไปที่นั่น", 14, "t-accent");
    [["กรอบคือสูตร", F("c5f_PR_F0_bq_P") + " ทุกหลักคิด"], ["ไม่มีตำแหน่งรองรับ", F("c5f_PR_pool2500_unplaced") + " คน*"], ["ต่ำทุกไม้บรรทัด", F("c46_dis_n_all_four") + " จังหวัด"]].forEach(function (c, i) {
      var x = i * 214;
      S("rect", { x: x, y: 30, width: 204, height: 74, rx: 6, style: "fill:var(--card);stroke:var(--line-strong)" }, g1);
      txt(g1, x + 12, 56, c[0], 13, "t-muted");
      txt(g1, x + 12, 88, c[1], 20, "t-strong");
    });
    txt(g1, 0, 124, "* แพทย์พร้อมจัดสรรปีละสองพันห้าร้อยคน กรอบโตร้อยละห้าต่อรอบ", 11, "t-muted");
    // reasons 2 and 3: time and Thai history
    var g2 = S("g", { style: "opacity:0" }, svg);
    S("line", { x1: 0, y1: 140, x2: 640, y2: 140, style: "stroke:var(--line)" }, g2);
    txt(g2, 0, 164, "เหตุผลที่สอง · เวลา: “สังคมจะเลือกโดยไม่รู้ว่ากำลังเลือก”", 14, "t-accent");
    txt(g2, 0, 194, "เหตุผลที่สาม · ประวัติศาสตร์ไทย: การเปลี่ยนที่สำคัญมาจากทางเลือกเชิงโครงสร้าง", 14, "t-accent");
    var X0 = 20, X1 = 620;
    function xOf(y) { return X0 + (y - 2510) / (2531 - 2510) * (X1 - X0); }
    S("line", { x1: X0, y1: 250, x2: X1, y2: 250, class: "axis" }, g2);
    var marks = [[2511, "บังคับชดใช้ทุน"], [2515, "ใช้ทุนรุ่นแรก"], [2519, "ขยาย รพ.ชนบท"], [2528, ""]];
    marks.forEach(function (m) { S("line", { x1: xOf(m[0]), y1: 244, x2: xOf(m[0]), y2: 256, class: "axis" }, g2); txt(g2, xOf(m[0]), 274, String(m[0]), 11, "mono t-muted", "middle"); if (m[1]) txt(g2, xOf(m[0]), 232, m[1], 12, "t-muted", "middle"); });
    var band = S("rect", { x: xOf(2519), y: 246, width: 0, height: 8, rx: 3, style: "fill:var(--p1)" }, g2);
    var facts = S("g", { style: "opacity:0" }, g2);
    txt(facts, 0, 306, "รพ.ชนบท " + F("lit.rural_hosp_start") + " → " + F("lit.rural_hosp_end") + " แห่ง", 15, "t-strong");
    txt(facts, 220, 306, "แพทย์ชนบท " + F("lit.rural_md_start") + " → " + F("lit.rural_md_end") + " คน", 15, "t-strong");
    txt(facts, 460, 306, "อีสาน/กทม. × " + F("lit.gap_1979") + " → × " + F("lit.gap_1986"), 15, "t-need");
    // conditions: three arrows into quadrant four
    var g3 = S("g", { style: "opacity:0" }, svg);
    S("line", { x1: 0, y1: 330, x2: 640, y2: 330, style: "stroke:var(--line)" }, g3);
    txt(g3, 0, 356, "เงื่อนไข · ช่องที่สี่ต้องได้งานจากอีกสามช่อง", 14, "t-accent");
    var mq = quad(g3, { x: 430, y: 364, w: 210, h: 150, labels: false, numSize: 16, gap: 6, rowLabel: false, colLabel: false });
    var q4 = mq.rect(3);
    var ends = [[q4.x + 10, q4.y + 10], [q4.x + q4.w * 0.62, q4.y + 4], [q4.x + 4, q4.y + q4.h * 0.62]];
    [[0, "หลักฐานกลไก ← ช่องที่หนึ่ง"], [1, "ใครได้ ใครรับต้นทุน ← ช่องที่สอง"], [2, "ขั้นทดลองที่มีจุดตรวจ ← ช่องที่สาม"]].forEach(function (c, i) {
      var ci = mq.center(c[0]), e = ends[i], ang = Math.atan2(e[1] - ci[1], e[0] - ci[0]);
      S("path", { d: "M" + ci[0] + "," + ci[1] + " L" + e[0] + "," + e[1], style: "fill:none;stroke:var(--accent);stroke-width:1.8" }, g3);
      var hx = e[0] - 9 * Math.cos(ang), hy = e[1] - 9 * Math.sin(ang), px = 5 * Math.sin(ang), py = -5 * Math.cos(ang);
      S("path", { d: "M" + e[0] + "," + e[1] + " L" + (hx + px) + "," + (hy + py) + " L" + (hx - px) + "," + (hy - py) + "Z", style: "fill:var(--accent)" }, g3);
      txt(g3, 0, 392 + i * 34, c[1], 15, "t-strong");
    });
    txt(g3, 0, 500, "ขาดสามสิ่งนี้ ช่องที่สี่เป็นวิสัยทัศน์ที่ตรวจไม่ได้", 13, "t-bad");
    return stepper(host, 3, function (k, anim, jobs) {
      if (k === 1) { g2.style.opacity = 0; g3.style.opacity = 0; if (anim) { g1.style.opacity = 0; fade(g1, true, 400, jobs); } else g1.style.opacity = 1; }
      if (k === 2) {
        fade(g2, true, anim ? 350 : 0, jobs);
        jobs.add(U.tween(anim ? 1400 : 0, function (t) { band.setAttribute("width", (xOf(2528) - xOf(2519)) * t); }, { delay: 300 }));
        fade(facts, true, anim ? 400 : 0, jobs, 1500);
      }
      if (k === 3) fade(g3, true, anim ? 450 : 0, jobs);
    });
  };

  /* ---------------- s07 six research programmes ---------------- */
  FIGS.s07 = function (host) {
    var LEVEL = { "ชุมชน": "var(--p1)", "ชุมชนและเศรษฐกิจ": "var(--p1)", "เศรษฐกิจและรัฐ": "var(--p3)", "เศรษฐกิจ": "var(--p3)", "สังคมและเศรษฐกิจ": "var(--p2)", "สังคม": "var(--p2)" };
    var progs = [
      ["ระบบดูแลระดับพื้นที่หลังการกระจายอำนาจ", "ชุมชน", "การกำกับและการเงินแบบใดรักษาทีมปฐมภูมิและเส้นทางอาชีพข้ามนายจ้างได้", "รพ.สต. ในตัวอย่าง <b>" + F("c77_units_P_local") + "</b> จาก <b>" + F("c77_units_P") + "</b> แห่งถ่ายโอนแล้ว"],
      ["การผลิตจากพื้นที่ที่ผูกกับเส้นทางอาชีพ", "ชุมชนและเศรษฐกิจ", "รับผู้เรียนจากพื้นที่ แหล่งฝึกในภูมิภาค และบันไดอาชีพ เปลี่ยนการคงอยู่ได้เพียงใด", "บ้านเกิดผูกคนไว้กับพื้นที่ (ออดส์ <b>" + F("c77_or_leave_areaB_home_province_match") + "</b>) ไม่ใช่กับสังกัด"],
      ["ระบบการจ้างและกรอบตำแหน่งตามพันธะบริการ", "เศรษฐกิจและรัฐ", "รูปแบบการจ้างแบบใดเปลี่ยนการกระจาย ความมั่นคง และต้นทุน", "ใครจ่าย: <b>" + F("c5f_PR_GDh5_bq_P") + "</b> เทียบ <b>" + F("c5f_PR_GDc5_bq_P") + "</b>"],
      ["พันธะสาธารณะของบริการเอกชนและการทำงานสองภาค", "เศรษฐกิจ", "ระบบหลักประกันและเงื่อนไขอนุญาตทำให้เอกชนรับผิดชอบพื้นที่ขาดได้หรือไม่", "เฉพาะทาง <b>" + F("c46_conc_top10_all1") + "%</b> อยู่ในร้อยละสิบของสถานพยาบาล"],
      ["เศรษฐกิจการดูแลและการสนับสนุนผู้ดูแล", "สังคมและเศรษฐกิจ", "ผู้ดูแลชุมชนที่ได้ค่าตอบแทน การพักทดแทน และการดูแลระยะยาว เปลี่ยนภาระอย่างไร", "ผู้ตอบ <b>" + F("c77_pct_primary_carer") + "%</b> เป็นผู้ดูแลหลักในครอบครัว"],
      ["การตัดสินร่วมเรื่องความเพียงพอและฐานจัดสรร", "สังคม", "กระบวนการตัดสินร่วมที่ใช้แบบจำลองเปิด เปลี่ยนเกณฑ์และการยอมรับผลอย่างไร", "หลักคิดต่างกัน แพทย์ใหม่จังหวัดเดียวต่าง <b>" + F("c54_maxcum_PR_vs_SR") + "</b> คน"]
    ];
    var grid = H("div", "nx-grid", null, host);
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    var cards = progs.map(function (p, i) {
      var c = H("div", "nx-card hud-panel", null, grid);
      H("div", "nx-head", '<span class="nx-num">' + (i + 1) + "</span><h4>" + p[0] + "</h4>", c);
      var tag = H("span", "nx-tag", p[1], c); tag.style.borderColor = LEVEL[p[1]]; tag.style.color = LEVEL[p[1]];
      H("p", "", p[2], c);
      H("span", "nx-chip", p[3], c);
      return c;
    });
    return stepper(host, 2, function (k, anim, jobs) {
      cards.forEach(function (c, i) {
        var show = k === 2 ? true : i < 3;
        var was = c.style.opacity === "1";
        if (!show) { c.style.opacity = 0; c.style.transform = "translateY(8px)"; return; }
        if (!anim || was) { c.style.opacity = 1; c.style.transform = "none"; return; }
        later(jobs, 100 + (i % 3) * 220, function () { c.style.opacity = 1; c.style.transform = "none"; });
      });
    });
  };

  /* ---------------- s08 checkable structural proposals: gates and mixed scanning ---------------- */
  FIGS.s08 = function (host) {
    var svg = U.svgHost(host, "0 0 640 520", "เกณฑ์ห้าข้อ และการกวาดตาแบบผสม"); U.defs(svg);
    var g1 = S("g", {}, svg);
    txt(g1, 0, 18, "ห้าคำถามที่ทุกข้อเสนอเชิงโครงสร้างต้องตอบ", 14, "t-muted");
    var gates = [["พึงปรารถนา", "", "wright"], ["ทำงานได้", "และยั่งยืน", "wright"], ["ไปถึงได้", "มีพันธมิตร", "wright"], ["ต้นทุนและ", "ความเสี่ยงตกกับใคร", "plus"], ["เรียนรู้และ", "ย้อนกลับได้", "plus"]].map(function (gt, i) {
      var x = 100 + i * 104, g = S("g", {}, g1);
      var bar = S("rect", { x: x - 3, y: 44, width: 6, height: 130, rx: 3, style: "fill:" + (gt[2] === "wright" ? "var(--line-strong)" : "var(--p2-soft)") }, g);
      txt(g, x, 196, gt[0], 12.5, "t-strong", "middle"); if (gt[1]) txt(g, x, 214, gt[1], 12.5, "t-strong", "middle");
      return { x: x, bar: bar, kind: gt[2] };
    });
    txt(g1, 100, 240, "Wright", 12, "mono t-muted", "middle"); txt(g1, 464, 240, "เพิ่มโดยการศึกษานี้", 12, "t-muted", "middle");
    var card = S("g", {}, g1);
    S("rect", { x: 0, y: 92, width: 96, height: 34, rx: 6, style: "fill:var(--accent-soft);stroke:var(--accent)" }, card);
    txt(card, 48, 114, "ข้อเสนอ", 13, "t-accent", "middle");
    function moveCard(t) {
      var x = -10 + t * 548; card.setAttribute("transform", "translate(" + x + ",0)");
      gates.forEach(function (gt) { var lit = x + 48 >= gt.x; gt.bar.setAttribute("style", "fill:" + (lit ? (gt.kind === "wright" ? "var(--accent)" : "var(--p2)") : (gt.kind === "wright" ? "var(--line-strong)" : "var(--p2-soft)"))); });
    }
    // mixed scanning radar
    var g2 = S("g", { style: "opacity:0" }, svg);
    S("line", { x1: 0, y1: 262, x2: 640, y2: 262, style: "stroke:var(--line)" }, g2);
    txt(g2, 0, 288, "การกวาดตาแบบผสม (Etzioni)", 14, "t-muted");
    var cx = 130, cy = 400, R = 104;
    [R, R * 0.66, R * 0.33].forEach(function (r) { S("circle", { cx: cx, cy: cy, r: r, style: "fill:none;stroke:var(--line-strong);stroke-width:1" }, g2); });
    S("line", { x1: cx - R, y1: cy, x2: cx + R, y2: cy, style: "stroke:var(--line)" }, g2);
    S("line", { x1: cx, y1: cy - R, x2: cx, y2: cy + R, style: "stroke:var(--line)" }, g2);
    var wedge = S("path", { d: "", style: "fill:var(--accent-soft);stroke:var(--accent);stroke-width:1" }, g2);
    var needle = S("line", { x1: cx, y1: cy, x2: cx + R, y2: cy, style: "stroke:var(--p1);stroke-width:2" }, g2);
    function wedgeAt(a) {
      var a0 = a - 0.9, p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)], p1 = [cx + R * Math.cos(a), cy + R * Math.sin(a)];
      wedge.setAttribute("d", "M" + cx + "," + cy + " L" + p0 + " A" + R + "," + R + " 0 0 1 " + p1 + " Z");
    }
    wedgeAt(-0.6); needle.setAttribute("x2", cx + R * Math.cos(1.2)); needle.setAttribute("y2", cy + R * Math.sin(1.2));
    S("rect", { x: 270, y: 330, width: 14, height: 14, style: "fill:var(--accent-soft);stroke:var(--accent)" }, g2);
    txt(g2, 292, 342, "กวาดกว้างทุกห้าปี: สำรวจทางเลือกพื้นฐาน", 14, "t-strong");
    S("line", { x1: 270, y1: 377, x2: 284, y2: 377, style: "stroke:var(--p1);stroke-width:2" }, g2);
    txt(g2, 292, 382, "ขั้นทดลองรายปี มีจุดตรวจ", 14, "t-strong");
    txt(g2, 270, 422, "ขยาย · ปรับ · หยุด ตามเกณฑ์ที่ประกาศล่วงหน้า", 14, "t-need");
    txt(g2, 270, 462, "ระหว่างนี้เรียกว่า", 12.5, "t-muted");
    txt(g2, 270, 486, "การทดลองทางความคิดภายใต้เงื่อนไข", 16, "t-accent glow");
    var spin = { stop: function () {} };
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        g2.style.opacity = 0;
        if (!anim) { moveCard(1); return; }
        moveCard(0);
        jobs.add(U.tween(3600, moveCard, { ease: U.ease.inOut, delay: 400 }));
      }
      if (k === 2) {
        fade(g2, true, anim ? 400 : 0, jobs);
        if (!U.isStatic()) {
          var a = -0.6, b = 0;
          spin = jobs.add(U.loop(g2, function (dt) { a += dt * 0.0006; b += dt * 0.006; wedgeAt(a); needle.setAttribute("x2", cx + R * Math.cos(b)); needle.setAttribute("y2", cy + R * Math.sin(b)); }));
        }
      }
    });
  };

  /* ---------------- s09 the immediate agenda in three quadrants ---------------- */
  FIGS.s09 = function (host) {
    var cols = [
      ["ช่องที่ 1 · วินิจฉัยภายในกรอบ", ["กระทบยอดจำนวนแพทย์ สป. กับแฟ้มเหตุการณ์เข้าออก", "เชื่อมระเบียนรายบุคคลแบบนิรนาม", "วัดเวลาทำงานจริง: ผู้ตอบ <b>" + F("c77_early_retire_all") + "%</b> คิดเกษียณก่อนกำหนดหรือลดชั่วโมงทำงาน", "เก็บหลักฐานจากผู้ที่ออกแล้ว"]],
      ["ช่องที่ 2 · วิพากษ์", ["ใครกำหนดกรอบอัตรากำลัง ด้วยเหตุผลและข้อมูลใด", "ใครผลิตตัวเลขความขาดแคลน เพื่อขอทรัพยากรชนิดใด", "ตลาดเอกชนกับงานดูแลในครัวเรือนดึงคนออกจากพื้นที่ขาดอย่างไร"]],
      ["ช่องที่ 3 · ข้อเสนอภายใต้กติกาปัจจุบัน", ["จัดสรรรอบหน้าด้วยหลายเกณฑ์", "วางตำแหน่งใหม่ตามความจำเป็นทุกรอบกรอบ", "ส่งแพทย์ใหม่ทุกปีจากตำแหน่งว่างจริง", "ประกาศกลุ่ม เวลาเริ่ม และผลที่จะวัดไว้ล่วงหน้า งานปกติจึงกลายเป็นการทดลอง"]]
    ];
    var grid = H("div", "nx-grid", null, host);
    grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    var lis = [];
    cols.forEach(function (c) {
      var col = H("div", "nx-col", "<h5>" + c[0] + "</h5>", grid);
      col.querySelector("h5").style.fontSize = "var(--fs-body)";
      var ul = H("ul", "", null, col);
      c[1].forEach(function (t) { var li = H("li", "", t, ul); li.style.fontSize = "var(--fs-body)"; li.style.padding = "calc(var(--u)*.7) calc(var(--u)*.8)"; lis.push(li); });
    });
    var hand = H("div", "nx-card hud-panel", '<div class="nx-head"><span class="nx-num">4</span><h4>ทุกงานในสามช่องนี้ควรส่งหลักฐานที่ช่องที่สี่ต้องใช้ ข้อมูลที่ตอบคำถามจัดสรรรอบหน้าได้และใช้ประเมินการเปลี่ยนกติกาได้ด้วย ควรได้รับความสำคัญก่อน</h4></div>', grid);
    hand.style.gridColumn = "1 / -1"; hand.style.borderColor = "var(--accent)";
    lis.push(hand);
    return stepper(host, 1, function (k, anim, jobs) {
      lis.forEach(function (li, i) {
        if (!anim) { li.style.opacity = 1; return; }
        li.style.opacity = 0; later(jobs, 150 + i * 140, function () { li.style.opacity = 1; });
      });
    });
  };

  /* ---------------- s10 roles of academics ---------------- */
  FIGS.s10 = function (host) {
    var wrap = H("div", "nx-grid", null, host);
    wrap.style.gridTemplateColumns = "minmax(0, .78fr) minmax(0, 2fr)";
    wrap.style.alignItems = "start";
    var left = H("div", "", null, wrap);
    var svgWrap = H("div", "fig__svg", null, left);
    var svg = S("svg", { viewBox: "0 0 420 400", role: "img", "aria-label": "งานสี่แบบของ Burawoy และการใช้งานวิจัยของ Weiss บนกรอบสี่ช่อง" });
    svgWrap.appendChild(svg); U.defs(svg);
    var q = quad(svg, { x: 0, y: 0, w: 420, h: 330, labels: false, numSize: 20, fs: 13 });
    var bur = ["งานวิชาชีพ", "งานวิพากษ์", "งานนโยบาย", "งานสาธารณะ"];
    var wei = ["", "ใช้เพื่อเปิดความเข้าใจ", "ใช้แก้ปัญหาเฉพาะหน้า", "ใช้เพื่อเปิดความเข้าใจ"];
    var labs = [0, 1, 2, 3].map(function (i) {
      var r = q.rect(i), g = S("g", { style: "opacity:0" }, svg);
      txt(g, r.x + 12, r.y + r.h / 2 + 10, bur[i], 16, i === 3 ? "t-accent" : "t-strong");
      if (wei[i]) txt(g, r.x + 12, r.y + r.h - 12, wei[i], 11.5, "t-muted");
      return g;
    });
    txt(svg, 0, 362, "Burawoy · งานสี่แบบตามชนิดความรู้และผู้ฟัง", 12, "t-muted");
    txt(svg, 0, 382, "Weiss · การใช้งานวิจัยสองแบบ", 12, "t-muted");
    var right = H("div", "", null, wrap);
    var rows = [
      ["ผู้วิเคราะห์และผู้ดูแลข้อมูล", "ตัวเลขที่ระบุขอบเขต ตัวหาร และความไม่แน่นอน", "ถือนิยามของผู้จัดเก็บเป็นความจริง", "ประกาศขอบเขตและการกระทบยอด รายงานส่วนที่อธิบายไม่ได้"],
      ["ผู้วิพากษ์", "ข้อจำกัดที่ถูกทำให้ดูเป็นธรรมชาติ และผู้ที่รับต้นทุน", "หยุดที่อรรถาธิบาย ไม่ทดสอบ", "ระบุกลไก ผู้กระทำ และผลที่สังเกตได้ ยอมปรับเมื่อหลักฐานไม่สนับสนุน"],
      ["ที่ปรึกษานโยบาย", "ทางเลือกที่ใช้ได้ในรอบตัดสิน พร้อมผลที่แลกกัน", "ตอบคำถามผู้ว่าจ้างโดยไม่ถามว่าคำถามถูกตั้งอย่างไร", "แยกระดับหลักฐาน ประกาศเกณฑ์ล่วงหน้า รายงานผลไม่ผ่าน เปิดเผยแหล่งทุน"],
      ["ผู้ร่วมสร้างทางเลือกกับสาธารณะ", "ทางเลือกระยะยาวที่ตรวจได้ด้วยเกณฑ์ที่เปิดเผย", "เสนอแทนผู้อื่น หรือใช้ความน่าเชื่อถือทางวิชาการรับรองอุดมการณ์", "ใช้เกณฑ์ห้าข้อ ทำงานร่วมกับผู้ทำงาน <span style=\"white-space:nowrap\">ผู้ดูแล</span> และชุมชน บันทึกความเห็นต่าง"]
    ];
    var table = H("table", "nx-table", "<thead><tr><th>บทบาท</th><th>สิ่งที่ให้</th><th>ความเสี่ยงเมื่อทำลำพัง</th><th>หลักปฏิบัติ</th></tr></thead>", right);
    table.style.fontSize = "var(--fs-body)";
    var tb = H("tbody", "", null, table);
    var trs = rows.map(function (r, i) { var tr = H("tr", "", "<td>" + (i + 1) + " " + r[0] + "</td><td>" + r[1] + "</td><td>" + r[2] + "</td><td>" + r[3] + "</td>", tb); return tr; });
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) {
        trs.forEach(function (tr) { tr.style.opacity = 0.12; });
        labs.forEach(function (g, i) { fade(g, true, anim ? 350 : 0, jobs, 200 + i * 260); });
      }
      if (k === 2) trs.forEach(function (tr, i) { if (!anim) { tr.style.opacity = 1; return; } later(jobs, 150 + i * 260, function () { tr.style.transition = "opacity .4s"; tr.style.opacity = 1; }); });
    });
  };

  /* ---------------- s11 proximity in the Thai context; A4R for academics ---------------- */
  FIGS.s11 = function (host) {
    var wrap = H("div", "nx-grid", null, host);
    wrap.style.gridTemplateColumns = "minmax(0,1fr)";
    var a = H("div", "nx-card hud-panel", null, wrap);
    a.innerHTML = '<div class="nx-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:calc(var(--u)*1)">' +
      '<div><h4>Harris · การยึดรัฐเพื่อการพัฒนา</h4><p>เครือข่ายข้าราชการนักปฏิรูประดมทรัพยากรจนสถาปนาหลักประกันสุขภาพถ้วนหน้า</p></div>' +
      '<div><h4>Selway · กติกาการเลือกตั้งและพรรค</h4><p>ขบวนการวิชาชีพจำเป็น แต่การเมืองเชิงสถาบันชี้ขาดมากกว่า</p></div></div>' +
      '<p class="nx-src" style="margin-top:calc(var(--u)*.6)">ความเสี่ยงของความใกล้ชิด</p>' +
      '<div class="nx-col"><ul><li>วาระวิจัยถูกกำหนดด้วยคำถามที่หน่วยงานถามได้ภายในอำนาจของตน</li><li>ผู้สร้างความรู้กับผู้ตัดสินเป็นเครือข่ายเดียวกัน การตรวจจากภายนอกอ่อน</li><li>ผู้ที่อยู่นอกเครือข่ายไม่มีช่องทางโต้แย้งเกณฑ์ที่ถูกเลือก</li></ul></div>';
    var b = H("div", "nx-card hud-panel", null, wrap);
    b.innerHTML = '<div class="nx-grid" style="grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:calc(var(--u)*1.2)">' +
      '<div><h4>A4R ใช้กับนักวิชาการด้วย</h4><div class="nx-col" style="margin-top:calc(var(--u)*.5)"><ul><li><b>เปิดเผย</b>เหตุผล</li><li>เหตุผลต้อง<b>เกี่ยวข้อง</b></li><li>มี<b>ช่องทางอุทธรณ์</b></li><li>มี<b>กลไกกำกับ</b></li></ul></div></div>' +
      '<div><h4>สิ่งที่การศึกษาครั้งนี้ทำแล้ว</h4><div class="nx-col nx-check" style="margin-top:calc(var(--u)*.5)"><ul><li>ประกาศเกณฑ์ตรวจแบบจำลองก่อนรัน และรายงานผลที่ไม่ผ่าน</li><li>กำหนดผลลัพธ์หลักของการสำรวจก่อนคำนวณ</li><li>ปรับสถานะข้อเสนอเรื่องภาระงานที่ข้อมูลไม่สนับสนุน</li><li>เปิดโค้ดและเครื่องมือทดลองให้ผู้อื่นตรวจ</li><li>แยกข้อมูลรายบุคคลออกจากผลที่เผยแพร่</li></ul></div></div></div>';
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) { b.style.opacity = 0; if (anim) { a.style.opacity = 0; later(jobs, 80, function () { a.style.opacity = 1; }); } else a.style.opacity = 1; }
      if (k === 2) { if (!anim) b.style.opacity = 1; else later(jobs, 80, function () { b.style.opacity = 1; }); }
    });
  };

  /* ---------------- s12 polycentric learning network (Ostrom) ---------------- */
  FIGS.s12 = function (host) {
    var svg = U.svgHost(host, "0 0 640 520", "เครือข่ายการเรียนรู้หลายศูนย์"); U.defs(svg);
    var C = [320, 262], R1 = 170, R2 = 236;
    var under = S("g", {}, svg);
    var locals = [];
    var pAng = [0, 1, 2, 3, 4].map(function (i) { return -Math.PI / 2 + i * 2 * Math.PI / 5; });
    for (var i = 0; i < 14; i++) {
      var a = i * 2 * Math.PI / 14 + 0.2, x = C[0] + R2 * Math.cos(a), y = C[1] + R2 * Math.sin(a) * 0.9;
      if (pAng.some(function (pa) { var d = Math.abs(((a - pa) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); return d < 0.22; })) continue;
      S("line", { x1: C[0], y1: C[1], x2: x, y2: y, style: "stroke:var(--line);stroke-dasharray:2 6" }, under);
      locals.push({ x: x, y: y, el: S("circle", { cx: x, cy: y, r: 6, style: "fill:var(--p1)" }, svg) });
    }
    var partners = [["สธ."], ["สถาบันพระบรมราชชนก", "และ สพพ."], ["PIER"], ["กรรมาธิการ", "การสาธารณสุข"], ["สวรส."]];
    partners.forEach(function (p, i) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / partners.length, x = C[0] + R1 * Math.cos(ang), y = C[1] + R1 * Math.sin(ang) * 0.82;
      S("line", { x1: C[0], y1: C[1], x2: x, y2: y, style: "stroke:var(--line-strong);stroke-width:1.2" }, under);
      var g = S("g", {}, svg);
      S("circle", { cx: x, cy: y, r: 13, style: "fill:var(--p2);stroke:var(--bg);stroke-width:2" }, g);
      var right = x >= C[0] - 1, dy = p.length > 1 ? -4 : 5;
      p.forEach(function (line, j) { txt(g, x + (right ? 20 : -20), y + dy + j * 18, line, 13.5, "t-strong", right ? "start" : "end"); });
    });
    var hubG = S("g", {}, svg);
    S("circle", { cx: C[0], cy: C[1], r: 66, style: "fill:var(--card-strong);stroke:var(--accent);stroke-width:1.6", class: "glow" }, hubG);
    S("circle", { cx: C[0], cy: C[1], r: 66, style: "fill:var(--accent-soft)" }, hubG);
    txt(hubG, C[0], C[1] - 6, "เวทีทบทวน", 15, "t-strong", "middle");
    txt(hubG, C[0], C[1] + 16, "กติการะดับประเทศ", 13, "t-accent", "middle");
    txt(svg, 0, 514, "จุดเล็ก: ผู้วิเคราะห์ระดับเขตและจังหวัด ส่งผลการทดลองกลับสู่เวทีทบทวน (Ostrom)", 12, "t-muted");
    var pulses = locals.map(function (l, i) { return { l: l, o: i / locals.length, el: S("circle", { r: 3, style: "fill:var(--accent)" }, under) }; });
    U.loop(svg, function (dt, ts) {
      pulses.forEach(function (p) {
        p.o = (p.o + dt / 3200) % 1;
        p.el.setAttribute("cx", p.l.x + (C[0] - p.l.x) * p.o); p.el.setAttribute("cy", p.l.y + (C[1] - p.l.y) * p.o);
        p.el.style.opacity = Math.sin(p.o * Math.PI);
      });
      locals.forEach(function (l, i) { l.el.style.opacity = 0.5 + 0.5 * Math.abs(Math.sin(ts / 700 + i)); });
    });
    if (U.isStatic()) pulses.forEach(function (p) { p.el.style.display = "none"; });
    return { steps: 1, setStep: function () {} };
  };

  /* ---------------- s13 closing: quadrant four, lit ---------------- */
  FIGS.s13 = function (host) {
    var wrap = H("div", "fig__svg", null, host);
    wrap.style.perspective = "1300px";
    var svg = S("svg", { viewBox: "-60 -60 640 640", role: "img", "aria-label": "ช่องที่สี่ของกรอบความรู้" });
    svg.style.transform = "rotateX(14deg) rotateY(12deg)"; svg.style.transformOrigin = "50% 50%";
    wrap.appendChild(svg); U.defs(svg);
    var q = quad(svg, { x: 40, y: 60, w: 440, h: 420, labels: false, numSize: 54, gap: 14 });
    q.tiles.slice(0, 3).forEach(function (t) { t.style.opacity = 0.45; });
    var r4 = q.rect(3);
    var glow = S("rect", { x: r4.x - 6, y: r4.y - 6, width: r4.w + 12, height: r4.h + 12, rx: 10, style: "fill:none;stroke:var(--accent);stroke-width:2" }, svg);
    var ring = S("g", { transform: "translate(260,280)" }, svg);
    [300].forEach(function (r) { S("circle", { r: r, style: "fill:none;stroke:var(--line-strong);stroke-width:1;stroke-dasharray:60 18" }, ring); });
    var a = 0;
    U.loop(svg, function (dt, ts) { a = (a + dt * 0.004) % 360; ring.setAttribute("transform", "translate(260,280) rotate(" + a + ")"); glow.style.opacity = 0.5 + 0.5 * Math.abs(Math.sin(ts / 900)); });
    return { steps: 1, setStep: function () {} };
  };

  window.FIGS = FIGS;
})();
