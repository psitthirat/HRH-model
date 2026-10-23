/* Toolkit for the HRH WS3 talks (classic script, works from file://). The file keeps
 * its old "hud" name; the look is now the event poster's night sky (hud.css).
 * Load order: data.js, hud.js, figures.js, slides.js, notes.js, deck.js.
 *   - draws one starfield canvas behind every slide (twinkle and a slow drift;
 *     a single still frame for reduced motion and Read mode; print gets a static
 *     SVG star layer per page instead);
 *   - decorates every slide after the engine renders it (a quiet slide counter and
 *     the funder acknowledgement in the footer: HSRI agreement, logo and wording
 *     on every presentation page);
 *   - gives figures small helpers: SVG/HTML builders, tweens and counters that
 *     jump to the end in Read mode, print and prefers-reduced-motion, render
 *     loops that pause while their slide is hidden, the province map and the
 *     tile grid drawn from window.TALKDATA.geo, a pulse marker and a reticle.
 */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  window.PEITHO = window.PEITHO || {};
  var HOOKS = window.PEITHO.hooks = window.PEITHO.hooks || { afterRender: [], onShow: [] };

  function S(tag, a, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in a) { if (a[k] == null) continue; if (k === "text") e.textContent = a[k]; else e.setAttribute(k, a[k]); }
    if (parent) parent.appendChild(e);
    return e;
  }
  function H(tag, cls, html, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  function isStatic() {
    if (window.PEITHO.isStatic) return window.PEITHO.isStatic();
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  var ease = {
    out: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    lin: function (t) { return t; },
    back: function (t) { var c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  };
  // tween(ms, fn(t)) - fn receives eased progress 0..1. Static views get fn(1) at once.
  function tween(ms, fn, opt) {
    opt = opt || {};
    if (isStatic() || ms <= 0) { fn(1); if (opt.done) opt.done(); return { stop: function () {} }; }
    var t0 = null, raf = 0, e = opt.ease || ease.out, delay = opt.delay || 0, alive = true;
    function f(ts) {
      if (!alive) return;
      if (t0 === null) t0 = ts + delay;
      var t = Math.min(1, Math.max(0, (ts - t0) / ms));
      fn(e(t));
      if (t < 1) raf = requestAnimationFrame(f); else if (opt.done) opt.done();
    }
    if (delay) fn(0);
    raf = requestAnimationFrame(f);
    return { stop: function () { alive = false; cancelAnimationFrame(raf); } };
  }
  // Number formatting that matches the claims' display strings (comma thousands, ASCII minus).
  function fmt(v, d) {
    d = d || 0;
    var s = Math.abs(v).toFixed(d), parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (v < 0 && +s !== 0 ? "-" : "") + parts.join(".");
  }
  // count(el, to, {from, ms, d, pre, post}) - an odometer. "to" may be a display string ("45,937").
  // ms: 0 means "set the final text now": the step controller settles earlier steps that
  // way, so a 0 must never fall back to the default duration (that replayed step-1 counters).
  function count(el, to, opt) {
    opt = opt || {};
    var target = typeof to === "string" ? +to.replace(/,/g, "") : to;
    var d = opt.d != null ? opt.d : (typeof to === "string" && to.indexOf(".") > -1 ? to.split(".")[1].length : 0);
    var from = opt.from || 0;
    var finalText = (opt.pre || "") + (typeof to === "string" ? to : fmt(target, d)) + (opt.post || "");
    return tween(opt.ms != null ? opt.ms : 1400, function (t) {
      el.textContent = t >= 1 ? finalText : (opt.pre || "") + fmt(from + (target - from) * t, d) + (opt.post || "");
    }, { ease: opt.ease || ease.out, delay: opt.delay });
  }
  // A job list per figure so a new step can cancel the last step's motion.
  function jobs() {
    var list = [];
    return { add: function (j) { list.push(j); return j; }, stop: function () { list.forEach(function (j) { if (j && j.stop) j.stop(); }); list = []; } };
  }
  // Step controller shared by both decks. Only the new step animates:
  //   - stepping forward on the slide on screen animates step k; earlier steps are only
  //     settled with static draws (so an interrupted animation never stays half-drawn);
  //   - arriving at a slide already at step k > 1 (going back, a jump, a reload with a hash),
  //     or arriving from a later slide at all, draws every step statically; arriving
  //     forward at step 1 plays step 1 from the start;
  //   - going back a step, Read mode, print and reduced motion are static.
  // The engine sets steps on every slide at boot or on a mode switch; a slide that is not on
  // screen ignores them, so its animation plays when it appears.
  var lastShown = -1;
  HOOKS.onShow.push(function (i) { lastShown = i; });
  function stepper(host, n, draw) {
    var cur = 0, job = jobs();
    return {
      steps: n,
      setStep: function (k) {
        var slide = host.closest && host.closest(".slide");
        if (!isStatic() && slide && !slide.classList.contains("is-active")) return;
        var idx = slide && slide.id ? +slide.id.replace("slide-", "") - 1 : -1;
        var arriving = idx !== lastShown, backward = arriving && lastShown > idx;
        job.stop();
        var animate = !isStatic() && (arriving ? k === 1 && !backward : k > cur);
        var from = animate && !arriving ? Math.max(1, cur) : 1;
        for (var i = from; i < k; i++) draw(i, false, job);
        draw(k, animate, job);
        cur = k;
      }
    };
  }
  // loop(host, fn(dt, ts)) - runs while the host's slide is on screen; never runs when static.
  function loop(host, fn) {
    var raf = 0, last = 0, alive = true;
    function f(ts) {
      if (!alive) return;
      var slide = host.closest && host.closest(".slide");
      if (slide && !slide.classList.contains("is-active")) { last = 0; raf = requestAnimationFrame(f); return; }
      var dt = last ? Math.min(48, ts - last) : 16; last = ts;
      fn(dt, ts);
      raf = requestAnimationFrame(f);
    }
    if (!isStatic()) raf = requestAnimationFrame(f);
    return { stop: function () { alive = false; cancelAnimationFrame(raf); } };
  }
  function svgHost(host, vb, label, align) {
    var wrap = H("div", "fig__svg", null, host);
    var svg = S("svg", { viewBox: vb, role: "img", "aria-label": label || "", preserveAspectRatio: align || "xMidYMid meet" });
    wrap.appendChild(svg);
    return svg;
  }
  // A second SVG in the slide's text column, filling the space under the text (the lower-left
  // of a split slide). The figure function owns it like its main SVG.
  function sideHost(host, vb, label, align) {
    var slide = host.closest && host.closest(".slide"), col = slide && slide.querySelector(".slide__text");
    var box = H("div", "fig fig-side", null, col || host);
    return svgHost(box, vb, label, align || "xMinYMin meet");
  }
  // Shared glow filter (defined once per SVG that asks for it).
  function defs(svg) {
    var d = svg.querySelector("defs") || S("defs", {}, svg);
    if (!d.querySelector("#hud-glow")) {
      var f = S("filter", { id: "hud-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, d);
      S("feGaussianBlur", { stdDeviation: "2.2", result: "b" }, f);
      var m = S("feMerge", {}, f); S("feMergeNode", { in: "b" }, m); S("feMergeNode", { in: "SourceGraphic" }, m);
      var hatch = S("pattern", { id: "hud-hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, d);
      S("line", { x1: 0, y1: 0, x2: 0, y2: 6, style: "stroke:var(--muted);stroke-width:1.2;opacity:.6" }, hatch);
    }
    return d;
  }

  /* ---------- province map and tiles from TALKDATA.geo ---------- */
  function geo() { return (window.TALKDATA && window.TALKDATA.geo) || null; }
  function map(parent, opt) {
    opt = opt || {};
    var G = geo(); if (!G) return null;
    var g = S("g", { class: "hud-map" }, parent);
    var el = {}, pt = {};
    G.provinces.forEach(function (p) {
      var bkk = p.code === "10";
      var path = S("path", { d: p.d, "data-code": p.code,
        style: bkk ? "fill:url(#hud-hatch);stroke:var(--line);stroke-width:.6" : "fill:var(--surface-2);stroke:var(--line-strong);stroke-width:.6;transition:fill .5s, opacity .5s" }, g);
      el[p.code] = path; pt[p.code] = [p.x, p.y];
    });
    return { g: g, el: el, pt: pt, w: G.w, h: G.h, names: names() };
  }
  function names() { var o = {}; (geo() ? geo().provinces : []).forEach(function (p) { o[p.code] = p.th; }); return o; }
  function codeOf(th) { var hit = (geo() ? geo().provinces : []).filter(function (p) { return p.th === th; })[0]; return hit ? hit.code : null; }
  // tiles(parent, {x, y, size, gap}) -> {cell: {code: {x,y,s}}, cols, rows}
  function tiles(opt) {
    var G = geo(); if (!G) return null;
    var size = opt.size, gap = opt.gap || 2, cell = {};
    G.provinces.forEach(function (p) {
      if (!p.tile || p.code === "10") return;
      cell[p.code] = { x: opt.x + p.tile[0] * (size + gap), y: opt.y + p.tile[1] * (size + gap), s: size };
    });
    return { cell: cell, cols: G.tiles.cols, rows: G.tiles.rows };
  }
  // A rotating lock-on reticle around (x, y).
  function reticle(parent, x, y, r, label, cls) {
    var g = S("g", { class: "hud-reticle " + (cls || ""), transform: "translate(" + x + "," + y + ")" }, parent);
    var ring = S("g", {}, g);
    for (var k = 0; k < 4; k++) {
      var a0 = k * 90 + 12, a1 = k * 90 + 78;
      var p0 = [Math.cos(a0 * Math.PI / 180) * r, Math.sin(a0 * Math.PI / 180) * r];
      var p1 = [Math.cos(a1 * Math.PI / 180) * r, Math.sin(a1 * Math.PI / 180) * r];
      S("path", { d: "M" + p0 + "A" + r + "," + r + " 0 0 1 " + p1, style: "fill:none;stroke:currentColor;stroke-width:1.6" }, ring);
    }
    S("circle", { r: 2.2, style: "fill:currentColor" }, g);
    var t = null;
    if (label) t = S("text", { x: r + 6, y: -r - 2, "font-size": 13, style: "fill:currentColor;font-weight:500", text: label }, g);
    var spin = { stop: function () {} };
    if (!isStatic()) {
      var a = 0;
      spin = loop(g, function (dt) { a = (a + dt * 0.06) % 360; ring.setAttribute("transform", "rotate(" + a + ")"); });
    }
    return { g: g, label: t, stop: function () { spin.stop(); } };
  }
  // A soft pulse around (x, y): one ring that widens and fades, like a star breathing.
  // Static views get the ring at rest.
  function pulse(parent, x, y, r, color) {
    var g = S("g", { transform: "translate(" + x + "," + y + ")", style: "color:" + (color || "var(--bad-text)") }, parent);
    var ring = S("circle", { r: r, style: "fill:none;stroke:currentColor;stroke-width:1.8;opacity:.85" }, g);
    S("circle", { r: Math.max(2.4, r * 0.12), style: "fill:currentColor" }, g);
    var lp = { stop: function () {} };
    if (!isStatic()) {
      var t = 0;
      lp = loop(g, function (dt) { t = (t + dt / 1700) % 1; ring.setAttribute("r", r * (0.55 + 0.75 * t)); ring.style.opacity = 0.9 * (1 - t); });
    }
    return { g: g, stop: function () { lp.stop(); } };
  }

  /* ---------- the night sky (event poster) ---------- */
  // Deterministic random so every screen and every export draws the same sky.
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // Stars are fainter over the middle of the screen, where the slide's text and charts sit,
  // and the few bright, glowing ones live only near the edges.
  function edgeWeight(x, y, W, H) {
    var dx = (x / W - 0.5) / 0.46, dy = (y / H - 0.5) / 0.42, d = Math.sqrt(dx * dx + dy * dy);
    return Math.max(0, Math.min(1, (d - 0.55) / 0.5));
  }
  var WARM = ["255,214,170", "255,190,140", "255,170,190"], COOL = ["236,240,255", "214,224,255", "255,255,255"];
  function makeSky(W, H, seed) {
    var rnd = rng(seed || 20261026), stars = [], glows = [], n = Math.round(W * H / 5600);
    for (var i = 0; i < n; i++) {
      var x = rnd() * W, y = rnd() * H, e = edgeWeight(x, y, W, H), r = rnd();
      var s = r < 0.74 ? 0.45 + rnd() * 0.45 : r < 0.96 ? 0.85 + rnd() * 0.55 : 1.3 + rnd() * 0.7;
      if (s > 1.25 && e < 0.6) s = 0.9;   // no bright star under the content
      var warm = rnd() < 0.15;
      stars.push({ x: x, y: y, s: s, a: (0.28 + rnd() * 0.5) * (0.4 + 0.6 * e), ph: rnd() * 6.283, sp: 0.35 + rnd() * 1.2,
        c: (warm ? WARM : COOL)[Math.floor(rnd() * 3)], vx: (rnd() - 0.5) * 2.2, vy: (rnd() - 0.5) * 1.1 });
    }
    for (var k = 0; k < 40 && glows.length < 6; k++) {
      var gx = rnd() * W, gy = rnd() * H;
      if (edgeWeight(gx, gy, W, H) < 0.75) continue;
      glows.push({ x: gx, y: gy, r: 4 + rnd() * 8, a: 0.22 + rnd() * 0.25, ph: rnd() * 6.283, sp: 0.18 + rnd() * 0.3, c: WARM[Math.floor(rnd() * 2)], vx: (rnd() - 0.5) * 3, vy: (rnd() - 0.5) * 1.5 });
    }
    return { stars: stars, glows: glows };
  }
  function starfield() {
    if (document.querySelector(".starfield") || !document.body) return;
    var cv = document.createElement("canvas");
    cv.className = "starfield"; cv.setAttribute("aria-hidden", "true");
    document.body.insertBefore(cv, document.body.firstChild);
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = 1, sky = null, raf = 0, last = 0, t = 0;
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      sky = makeSky(W, H, 20261026);
    }
    function light() { return document.documentElement.getAttribute("data-theme") === "light"; }
    function draw(dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var sec = dt / 1000;
      sky.glows.forEach(function (g) {
        g.x = (g.x + g.vx * sec + W) % W; g.y = (g.y + g.vy * sec + H) % H;
        var a = g.a * (0.7 + 0.3 * Math.sin(t * g.sp + g.ph)), R = g.r * 3.2;
        var grd = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, R);
        grd.addColorStop(0, "rgba(" + g.c + "," + a + ")"); grd.addColorStop(0.25, "rgba(" + g.c + "," + (a * 0.55) + ")"); grd.addColorStop(1, "rgba(" + g.c + ",0)");
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(g.x, g.y, R, 0, 6.2832); ctx.fill();
      });
      sky.stars.forEach(function (s) {
        s.x = (s.x + s.vx * sec + W) % W; s.y = (s.y + s.vy * sec + H) % H;
        var a = s.a * (0.55 + 0.45 * Math.sin(t * s.sp + s.ph));
        ctx.fillStyle = "rgba(" + s.c + "," + a.toFixed(3) + ")";
        if (s.s < 0.9) ctx.fillRect(s.x, s.y, s.s * 1.4, s.s * 1.4);
        else { ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, 6.2832); ctx.fill(); }
      });
    }
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (document.hidden || light()) { last = ts; return; }
      var dt = last ? Math.min(64, ts - last) : 16; last = ts; t += dt / 1000;
      if (isStatic()) { if (!frame.still) { draw(0); frame.still = true; } return; }
      frame.still = false;
      draw(dt);
    }
    var rs = 0;
    window.addEventListener("resize", function () { clearTimeout(rs); rs = setTimeout(function () { size(); frame.still = false; }, 150); });
    size(); draw(0);
    raf = requestAnimationFrame(frame);
  }
  // Print: a static star layer (SVG data URI) behind every 1920x1080 page.
  function printStars() {
    var W = 1920, H = 1080, sky = makeSky(W, H, 20261026), out = [];
    sky.glows.forEach(function (g) {
      out.push('<circle cx="' + g.x.toFixed(1) + '" cy="' + g.y.toFixed(1) + '" r="' + (g.r * 2.2).toFixed(1) + '" fill="rgb(' + g.c + ')" fill-opacity="' + (g.a * 0.35).toFixed(2) + '"/>');
      out.push('<circle cx="' + g.x.toFixed(1) + '" cy="' + g.y.toFixed(1) + '" r="' + (g.r * 0.5).toFixed(1) + '" fill="rgb(' + g.c + ')" fill-opacity="' + Math.min(0.9, g.a * 2).toFixed(2) + '"/>');
    });
    sky.stars.forEach(function (s, i) {
      if (i % 2) return;   // half the density keeps the PDF light
      out.push('<circle cx="' + s.x.toFixed(1) + '" cy="' + s.y.toFixed(1) + '" r="' + (s.s * 0.85).toFixed(2) + '" fill="rgb(' + s.c + ')" fill-opacity="' + (s.a * 0.8).toFixed(2) + '"/>');
    });
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '">' + out.join("") + "</svg>";
    return 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
  }

  /* ---------- slide decorations ---------- */
  var FUNDER = "ได้รับการสนับสนุนจาก สถาบันวิจัยระบบสาธารณสุข (สวรส.)";
  HOOKS.afterRender.push(function (slides) {
    var logo = (window.TALKDATA && TALKDATA.assets && TALKDATA.assets.hsri) || "../../assets/logos/05_HSRI.svg";
    if (document.documentElement.classList.contains("print")) document.documentElement.style.setProperty("--print-stars", printStars());
    else starfield();
    Array.prototype.forEach.call(document.querySelectorAll(".slide"), function (el, i) {
      var meta = H("div", "hud-meta", "<span>" + String(i + 1).padStart(2, "0") + " / " + slides.length + "</span>");
      meta.setAttribute("aria-hidden", "true");
      el.insertBefore(meta, el.firstChild);
      var foot = el.querySelector(".slide__foot");
      if (!foot) { foot = H("div", "slide__foot", '<div class="slide__source"></div>', el); }
      var right = H("div", "foot-right");
      var kick = el.querySelector(".kicker"), badges = foot.querySelectorAll(".badge");
      if (badges.length) {
        var bs = H("span", "badges");
        Array.prototype.forEach.call(badges, function (b) { bs.appendChild(b); });
        if (kick) kick.appendChild(bs); else right.appendChild(bs);
      }
      H("span", "funder", '<span class="chip-logo"><img src="' + logo + '" alt="ตราสถาบันวิจัยระบบสาธารณสุข (สวรส.)" decoding="async"></span>' + FUNDER, right);
      foot.appendChild(right);
    });
    var back = document.querySelector(".topbar__tools");
    if (back && !document.querySelector(".back-site")) {
      var a = H("a", "back-site", "← เว็บไซต์"); a.href = "../../index.html?mode=talks"; back.insertBefore(a, back.firstChild);
    }
  });

  window.HUD = { S: S, H: H, NS: NS, isStatic: isStatic, ease: ease, tween: tween, fmt: fmt, count: count, jobs: jobs, loop: loop, stepper: stepper,
    svgHost: svgHost, sideHost: sideHost, defs: defs, map: map, tiles: tiles, reticle: reticle, pulse: pulse, names: names, codeOf: codeOf };
})();
