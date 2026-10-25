/* Peitho deck engine.
 * Slides are data (slides.js -> window.DECK); figures are functions
 * (figures.js -> window.FIGS). This file renders both, runs steps and
 * navigation, the planned-time progress bar and pace timer, the presenter
 * notes window (index.html#notes, linked by postMessage so it also works
 * from file://), the overview and the Read mode.
 * Classic script on purpose: double-clicking index.html must work offline.
 */
(function () {
  "use strict";
  var D = window.DECK, FIGS = window.FIGS || {};
  // Speaker notes live in notes.js (window.DECK_NOTES, keyed by slide id) so the
  // public copy can leave them out; a deck without notes.js still runs. On the public
  // site the scripts are kept online instead (owner request 25 Oct 2569): the presenter
  // types the internal passcode, the deck reads them with get_talk_script (Supabase, the
  // passcode is checked in the database), keeps them for this tab in sessionStorage, and
  // may edit and save them (save_talk_script). Offline files carry notes.js and need nothing.
  var BK = (window.TALKDATA && window.TALKDATA.backend) || {};
  var SCRIPT_KEY = "peitho:" + D.meta.id + ":script", CODE_KEY = "peitho:talk-code";
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  var ONLINE_NOTES = !window.DECK_NOTES && !!(BK.url && BK.key);
  var NOTES = window.DECK_NOTES || (function () { try { return JSON.parse(sget(SCRIPT_KEY) || "{}"); } catch (e) { return {}; } })();
  var LOCKED = ONLINE_NOTES && !Object.keys(NOTES).length;
  var CAN_EDIT = ONLINE_NOTES && !LOCKED && !!sget(CODE_KEY);
  D.slides.forEach(function (s) {
    var n = s.id && NOTES[s.id];
    if (n) { if (!s.notes) s.notes = n.notes || n; if (!s.bridge && n.bridge) s.bridge = n.bridge; }
  });
  (function () {
    var css = ".code-dialog form{display:flex;flex-direction:column;gap:12px;padding:4px}.code-dialog input{font:inherit;font-size:18px;padding:8px 10px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface-2);color:var(--text-1)}" +
      ".code-dialog__btns,.script-edit__btns{display:flex;gap:8px;justify-content:flex-end;align-items:center}.script-edit__msg{margin-right:auto;color:var(--muted)}" +
      ".script-edit{display:flex;flex-direction:column;gap:6px;margin-top:8px}.script-edit__lbl{font-size:13px;color:var(--muted)}" +
      ".script-edit__ta{font:inherit;font-size:16px;line-height:1.55;padding:8px 10px;border-radius:8px;border:1px solid var(--line-strong);background:var(--surface-2);color:var(--text-1);resize:vertical;width:100%;box-sizing:border-box}" +
      ".script-tools{display:flex;gap:8px;margin-top:10px}.btn--primary{background:var(--accent);color:var(--inverse,#000);border-color:var(--accent)}" +
      ".popup-help{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:70;display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:12px;background:var(--surface-3);border:1px solid var(--line-strong);box-shadow:0 8px 24px rgba(0,0,0,.35);color:var(--text-1)}" +
      "html.print .popup-help{display:none}";
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  })();
  var PRINT = /[?&]print\b/.test(location.search);
  if (PRINT) document.documentElement.classList.add("print");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem("peitho:" + D.meta.id + ":" + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem("peitho:" + D.meta.id + ":" + k, v); } catch (e) { /* storage blocked: fine */ } }
  };
  var S = D.slides;
  var plannedStart = [], total = 0;
  S.forEach(function (s) { plannedStart.push(total); total += s.seconds || 0; });

  var state = { i: 0, step: 1, mode: "present", started: null, notesWin: null };
  var figs = [];          // figure API per slide (or null)
  var stepsOf = [];       // number of steps per slide

  function strip(html) { var d = document.createElement("div"); d.innerHTML = (html || "").replace(/<br\s*\/?>/gi, " "); return d.textContent.replace(/\s+/g, " ").trim(); }
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function chapterName(s) { return (D.chapters && D.chapters[s.chapter]) || ""; }
  var TH = /^th/i.test(document.documentElement.lang || "");
  var L = TH ? { step: "ขั้น", plan: "แผน", wait: "เริ่มจับเวลาเมื่อกดครั้งแรก", behind: "ช้ากว่าแผน", ahead: "เร็วกว่าแผน",
      slide: "สไลด์", of: "จาก", thisSlide: "สไลด์นี้", restart: "เริ่มจับเวลาใหม่", nextSlide: "สไลด์ถัดไป", lastSlide: "สไลด์สุดท้าย",
      next: "ต่อไป", planned: "ตามแผน", notes: "บันทึกผู้บรรยาย", startsAt: "เริ่มนับเมื่อกดครั้งแรก",
      askCode: "ใส่รหัสเพื่อเปิดบันทึกผู้บรรยาย", unlockBtn: "ใส่รหัสเพื่อดูบันทึกผู้บรรยาย", wrongCode: "รหัสไม่ถูกต้อง",
      unlocked: "เปิดบันทึกผู้บรรยายแล้ว หน้าจะโหลดใหม่ แล้วกด N อีกครั้ง", netFail: "เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ต หรือใช้ไฟล์ offline",
      noScript: "ยังไม่มีบทพูดของชุดนี้บนเว็บ", ok: "ตกลง", cancel: "ยกเลิก", edit: "แก้ไขบทพูด", save: "บันทึก", saving: "กำลังบันทึก…",
      saved: "บันทึกแล้ว", bridgeLabel: "ประโยคส่งต่อ", stepLabel: "ขั้นที่", popupBlocked: "เบราว์เซอร์บล็อกหน้าต่างบทพูด",
      openWin: "เปิดหน้าต่างบทพูด", changeCode: "เปลี่ยนรหัส", newCode: "รหัสใหม่ (อย่างน้อย 12 ตัวอักษร)", newCode2: "พิมพ์รหัสใหม่อีกครั้ง",
      codeMismatch: "รหัสใหม่สองครั้งไม่ตรงกัน", codeChanged: "เปลี่ยนรหัสแล้ว ใช้รหัสใหม่ทั้งบทพูดและหน้า 2 ส่งรหัสใหม่ให้ผู้ที่ต้องใช้" }
    : { step: "step", plan: "plan", wait: "Timer starts at your first move", behind: "behind", ahead: "ahead",
      slide: "Slide", of: "of", thisSlide: "This slide", restart: "Restart timer", nextSlide: "Next slide", lastSlide: "Last slide",
      next: "Next", planned: "planned", notes: "Notes", startsAt: "Starts at the first move",
      askCode: "Passcode for the speaker notes", unlockBtn: "Enter the passcode to see the notes", wrongCode: "Wrong passcode",
      unlocked: "Notes unlocked. The page reloads; press N again.", netFail: "Cannot connect: check the internet or use the offline file",
      noScript: "No script for this deck on the website yet", ok: "OK", cancel: "Cancel", edit: "Edit script", save: "Save", saving: "Saving…",
      saved: "Saved", bridgeLabel: "Hand-over line", stepLabel: "Step", popupBlocked: "The browser blocked the notes window",
      openWin: "Open the notes window", changeCode: "Change passcode", newCode: "New passcode (12 characters or more)", newCode2: "Type the new passcode again",
      codeMismatch: "The two new passcodes differ", codeChanged: "Passcode changed. Use it for the notes and slide 2, and send it to those who need it" };
  var CLAIM = TH
    ? { reported: "ผลจากข้อมูล", model: "ผลจากแบบจำลอง", schematic: "แผนภาพเชิงแนวคิด", reading: "การตีความของคณะวิจัย" }
    : { reported: "Reported finding", model: "Model result", schematic: "Schematic", reading: "Our reading" };

  /* ---------- tooltip shared with figures ---------- */
  var tipEl = null;
  window.PEITHO = window.PEITHO || {};
  var HOOKS = window.PEITHO.hooks = window.PEITHO.hooks || { afterRender: [], onShow: [] };
  window.PEITHO.isStatic = function () {
    return PRINT || state.mode === "read" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  };
  window.PEITHO.tip = function (html, x, y) {
      if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tooltip"; tipEl.setAttribute("role", "tooltip"); document.body.appendChild(tipEl); }
      if (!html) { tipEl.hidden = true; return; }
      tipEl.innerHTML = html; tipEl.hidden = false;
      var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      var left = Math.min(x + 14, window.innerWidth - w - 8), top = y - h - 12;
      if (top < 8) top = y + 16;
      tipEl.style.left = left + "px"; tipEl.style.top = top + "px";
  };

  /* ---------- render ---------- */
  function slideHTML(s, i) {
    var h = [];
    var kicker = s.kicker ? '<div class="kicker">' + (s.paper ? '<span class="dot" aria-hidden="true"></span>' : "") + s.kicker + "</div>" : "";
    var titleTag = i === 0 ? "h1" : "h2";
    var title = s.title ? "<" + titleTag + ' class="' + (s.display ? "display" : "title") + '">' + s.title + "</" + titleTag + ">" : "";
    h.push('<div class="slide__text">' + kicker + title + (s.lead ? '<p class="lead">' + s.lead + "</p>" : "") + (s.body ? '<div class="body">' + s.body + "</div>" : "") + (s.html || "") + "</div>");
    if (s.quote) h.push('<div class="slide__quote"' + (s.quote.step ? ' data-step="' + s.quote.step + '"' : "") + '><blockquote class="quote"><p>' + s.quote.text + "</p><cite>" + s.quote.cite + "</cite></blockquote></div>");
    if (s.colA) h.push('<div class="col-a"' + (s.colA.step ? ' data-step="' + s.colA.step + '"' : "") + '><div class="colhead">' + s.colA.head + "</div>" + s.colA.html + "</div>");
    if (s.colB) h.push('<div class="col-b"' + (s.colB.step ? ' data-step="' + s.colB.step + '"' : "") + '><div class="colhead">' + s.colB.head + "</div>" + s.colB.html + "</div>");
    if (s.fig || s.figHtml) h.push('<div class="slide__fig">' + (s.figHtml || '<div class="fig" data-fig="' + s.fig + '"></div>') + "</div>");
    var claims = s.claims || (s.claim ? [s.claim] : []);
    if (s.source || claims.length) h.push('<div class="slide__foot"><div class="slide__source">' + (s.source || "") + "</div>" +
      claims.map(function (c) { return '<span class="badge" data-claim="' + c + '">' + CLAIM[c] + "</span>"; }).join("") + "</div>");
    return h.join("");
  }
  function notesHTML(s) {
    var n = (s.notes || []).map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("");
    if (s.bridge) n += '<p class="note-bridge">' + L.next + ": " + esc(s.bridge) + "</p>";
    return n;
  }

  function render() {
    var deck = $("#deck");
    deck.innerHTML = S.map(function (s, i) {
      return '<div class="slide-wrap"><section class="slide" id="slide-' + (i + 1) + '" data-layout="' + (s.layout || "split") + '"' + (s.partStart ? " data-part-start" : "") +
        (s.paper ? ' data-paper="' + s.paper + '"' : "") + ' aria-label="Slide ' + (i + 1) + ": " + strip(s.title).replace(/"/g, "&quot;") + '">' + slideHTML(s, i) + "</section>" +
        '<details class="read-notes"><summary>' + L.notes + " · " + fmt(s.seconds || 0) + " " + L.planned + "</summary>" +
        '<div class="read-notes__body">' + notesHTML(s) + "</div>" +
        (CAN_EDIT ? '<p class="script-tools"><button class="btn btn--ghost" type="button" data-edit-read="' + i + '">' + L.edit + "</button></p>" : "") + "</details></div>";
    }).join("");
    $$(".slide", deck).forEach(function (el, i) {
      var figEl = $(".fig[data-fig]", el), api = null;
      if (figEl && FIGS[figEl.dataset.fig]) {
        try { api = FIGS[figEl.dataset.fig](figEl, { slide: S[i] }); } catch (e) { figEl.innerHTML = '<p class="note">Figure failed to load: ' + e.message + "</p>"; if (window.console) console.error(e); }
      }
      figs[i] = api;
      var max = S[i].steps || 1;
      $$("[data-step]", el).forEach(function (n) { max = Math.max(max, +n.dataset.step || 1); });
      if (api && api.steps) max = Math.max(max, api.steps);
      stepsOf[i] = max;
    });
    HOOKS.afterRender.forEach(function (fn) { try { fn(S); } catch (e) { if (window.console) console.error(e); } });
  }

  /* ---------- show ---------- */
  function applySteps(i, step) {
    var el = $("#slide-" + (i + 1));
    if (!el) return;
    var all = state.mode === "read";
    $$("[data-step]", el).forEach(function (n) { n.classList.toggle("is-pending", !all && +n.dataset.step > step); });
    if (figs[i] && figs[i].setStep) {
      try { figs[i].setStep(all ? stepsOf[i] : step); } catch (e) { if (window.console) console.error("Figure on slide " + (i + 1) + ":", e); }
    }
  }
  function show() {
    var i = state.i, s = S[i];
    $$(".slide").forEach(function (el, k) { el.classList.toggle("is-active", k === i); });
    applySteps(i, state.step);
    $("#chapter-name").textContent = chapterName(s);
    $("#slide-number").textContent = (i + 1) + " / " + S.length;
    $("#pos").textContent = (i + 1) + " / " + S.length + (stepsOf[i] > 1 ? " · " + L.step + " " + state.step + "/" + stepsOf[i] : "");
    var pos = plannedStart[i] + (s.seconds || 0) * (state.step - 1) / stepsOf[i];
    $("#progress").style.width = (total ? Math.min(100, pos / total * 100) : 0) + "%";
    var pb = $(".ribbon__progress"); pb.setAttribute("aria-valuemax", total); pb.setAttribute("aria-valuenow", Math.round(pos));
    document.title = (i ? strip(s.title) + " · " : "") + D.meta.title;
    var h = "#s" + (i + 1);
    if (location.hash !== h) { try { history.replaceState(null, "", h); } catch (e) { /* file:// in some browsers */ } }
    $("#btn-prev").disabled = i === 0 && state.step === 1;
    $("#btn-next").disabled = i === S.length - 1 && state.step === stepsOf[i];
    drawDrawer(); tick(); post();
    HOOKS.onShow.forEach(function (fn) { try { fn(i, state.step); } catch (e) { if (window.console) console.error(e); } });
  }
  function go(i, step) {
    state.i = Math.max(0, Math.min(S.length - 1, i));
    state.step = step === "last" ? stepsOf[state.i] : Math.max(1, Math.min(stepsOf[state.i], step || 1));
    show();
    if (state.mode === "read") { var el = $("#slide-" + (state.i + 1)); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  function move(dir) {
    if (!state.started && state.mode === "present") state.started = Date.now();
    if (dir > 0) {
      if (state.step < stepsOf[state.i]) { state.step++; show(); }
      else if (state.i < S.length - 1) go(state.i + 1, 1);
    } else {
      if (state.step > 1) { state.step--; show(); }
      else if (state.i > 0) go(state.i - 1, "last");
    }
  }

  /* ---------- timer ---------- */
  function paceInfo() {
    var el = state.started ? (Date.now() - state.started) / 1000 : 0;
    var s = S[state.i];
    var due = plannedStart[state.i] + (s.seconds || 0) * (state.step - 1) / stepsOf[state.i];
    return { elapsed: el, diff: el - due, due: due };
  }
  function tick() {
    var t = $("#timer"); if (!t) return;
    if (!state.started) { t.textContent = L.wait + " · " + L.plan + " " + fmt(total); return; }
    var p = paceInfo(), d = Math.round(p.diff);
    var cls = d > 30 ? "late" : d < -30 ? "early" : "";
    t.innerHTML = fmt(p.elapsed) + " / " + fmt(total) + ' · <span class="' + cls + '">' + (d >= 0 ? "+" : "−") + fmt(Math.abs(d)) + " " + (d >= 0 ? L.behind : L.ahead) + "</span>";
  }
  setInterval(function () { tick(); post(); }, 1000);

  /* ---------- presenter notes (drawer + second window) ---------- */
  function notesBlock(i, step) {
    var s = S[i], ns = s.notes || [];
    var out = ns.map(function (t, k) {
      var cls = k + 1 === step ? "is-now" : k + 1 < step ? "is-past" : "";
      return '<p class="note-step ' + cls + '">' + esc(t) + "</p>";
    }).join("");
    if (s.bridge) out += '<p class="note-bridge">' + L.next + ": " + esc(s.bridge) + "</p>";
    return out;
  }
  function drawDrawer() {
    var d = $("#notes-drawer"); if (d.hidden) return;
    d.innerHTML = "<h3>" + L.notes + " · " + L.slide + " " + (state.i + 1) + " · " + fmt(S[state.i].seconds || 0) + " " + L.planned + "</h3>" + notesBlock(state.i, state.step);
  }
  function toggleDrawer() { var d = $("#notes-drawer"); d.hidden = !d.hidden; drawDrawer(); }
  function esc(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  // A small dialog with a masked field: the passcode never shows on a projected screen.
  function askCode(message) {
    return new Promise(function (resolve) {
      var dlg = document.createElement("dialog"); dlg.className = "sheet sheet--narrow code-dialog";
      dlg.innerHTML = '<form method="dialog"><p class="code-dialog__msg"></p><input type="password" autocomplete="off" spellcheck="false">' +
        '<div class="code-dialog__btns"><button class="btn" value="cancel" type="button">' + L.cancel + '</button><button class="btn btn--primary" value="ok">' + L.ok + "</button></div></form>";
      $(".code-dialog__msg", dlg).textContent = message;
      document.body.appendChild(dlg);
      var input = $("input", dlg), done = false;
      function finish(v) { if (done) return; done = true; if (dlg.open) dlg.close(); dlg.remove(); resolve(v); }
      $("form", dlg).addEventListener("submit", function (e) { e.preventDefault(); finish(input.value.trim() || null); });
      $("button[value=cancel]", dlg).addEventListener("click", function () { finish(null); });
      dlg.addEventListener("cancel", function () { finish(null); });
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
      input.focus();
    });
  }
  window.PEITHO = window.PEITHO || {};
  window.PEITHO.askCode = askCode;
  function rpc(name, body) {
    return fetch(BK.url + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey: BK.key, "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.text().then(function (t) { if (!r.ok) throw new Error(t || String(r.status)); return t ? JSON.parse(t) : null; }); });
  }
  function rpcError(err) { alert(/wrong passcode/.test(String(err && err.message)) ? L.wrongCode : L.netFail); }
  function unlockNotes() {
    if (!window.fetch) { alert(L.netFail); return; }
    askCode(L.askCode).then(function (code) {
      if (!code) return;
      rpc("get_talk_script", { p_deck: D.meta.id, p_code: code }).then(function (data) {
        if (!data || !Object.keys(data).length) { alert(L.noScript); return; }
        sset(SCRIPT_KEY, JSON.stringify(data)); sset(CODE_KEY, code);
        alert(L.unlocked); location.reload();
      }, rpcError);
    });
  }
  // Keep a saved slide in this tab's copy, so a reload shows it.
  function remember(i) {
    try { var all = JSON.parse(sget(SCRIPT_KEY) || "{}"); all[S[i].id] = { notes: S[i].notes, bridge: S[i].bridge || "" }; sset(SCRIPT_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }
  // Edit one slide's script in place: one box per click, plus the hand-over line. done(saved) closes the editor.
  function editScript(box, i, done) {
    var s = S[i], ns = s.notes || [];
    box.innerHTML = ns.map(function (t, k) {
      return '<label class="script-edit__lbl">' + L.stepLabel + " " + (k + 1) + '</label><textarea class="script-edit__ta" rows="4">' + esc(t) + "</textarea>";
    }).join("") + '<label class="script-edit__lbl">' + L.bridgeLabel + '</label><textarea class="script-edit__ta script-edit__bridge" rows="2">' + esc(s.bridge || "") + "</textarea>" +
      '<div class="script-edit__btns"><span class="script-edit__msg"></span><button class="btn" type="button" data-x="cancel">' + L.cancel + '</button><button class="btn btn--primary" type="button" data-x="save">' + L.save + "</button></div>";
    var tas = $$(".script-edit__ta", box), msg = $(".script-edit__msg", box);
    $("[data-x=cancel]", box).addEventListener("click", function () { done(false); });
    $("[data-x=save]", box).addEventListener("click", function () {
      var notes = tas.slice(0, ns.length).map(function (t) { return t.value.trim(); }), bridge = tas[ns.length].value.trim();
      msg.textContent = L.saving;
      rpc("save_talk_script", { p_deck: D.meta.id, p_slide: s.id, p_notes: notes, p_bridge: bridge, p_code: sget(CODE_KEY) || "" }).then(function () {
        s.notes = notes; s.bridge = bridge; remember(i);
        if (window.opener && isNotesView) { try { window.opener.postMessage({ peitho: D.meta.id, type: "script", i: i, notes: notes, bridge: bridge }, "*"); } catch (e) { /* opener gone */ } }
        done(true);
      }, function (err) { msg.textContent = ""; rpcError(err); });
    });
    if (tas[0]) tas[0].focus();
  }
  function changeCode() {
    askCode(L.newCode).then(function (a) {
      if (!a) return;
      askCode(L.newCode2).then(function (b) {
        if (!b) return;
        if (a !== b) { alert(L.codeMismatch); return; }
        rpc("change_talk_passcode", { p_old: sget(CODE_KEY) || "", p_new: a }).then(function () { sset(CODE_KEY, a); alert(L.codeChanged); }, function (err) {
          alert(/12 characters/.test(String(err && err.message)) ? L.newCode : /wrong passcode/.test(String(err && err.message)) ? L.wrongCode : L.netFail);
        });
      });
    });
  }
  function withNotes(fn) { return function () { if (LOCKED) unlockNotes(); else fn(); }; }
  function openNotes() {
    var url = location.href.split("#")[0] + "#notes", w = null;
    try { w = window.open(url, "peitho-notes", "width=980,height=720"); } catch (e) { w = null; }
    if (w === window) {   // a host that reuses this window: notes in the drawer
      if (location.hash === "#notes") { try { history.replaceState(null, "", "#s" + (state.i + 1)); } catch (e) { /* ignore */ } }
      toggleDrawer(); return;
    }
    if (!w) { popupHelp(); return; }   // blocked (Safari blocks windows opened from a key): ask for a click instead
    var help = $(".popup-help"); if (help) help.remove();
    state.notesWin = w;
    setTimeout(post, 600);
  }
  function popupHelp() {
    if ($(".popup-help")) return;
    var d = document.createElement("div"); d.className = "popup-help";
    d.innerHTML = "<span>" + L.popupBlocked + '</span><button class="btn btn--primary" type="button">' + L.openWin + '</button><button class="btn btn--ghost" type="button" aria-label="' + L.cancel + '">×</button>';
    $$("button", d)[0].addEventListener("click", function () { d.remove(); openNotes(); });
    $$("button", d)[1].addEventListener("click", function () { d.remove(); });
    document.body.appendChild(d);
  }
  function post() {
    var w = state.notesWin; if (!w || w.closed) return;
    try { w.postMessage({ peitho: D.meta.id, type: "state", i: state.i, step: state.step, steps: stepsOf[state.i], started: state.started }, "*"); } catch (e) { /* closed */ }
  }
  window.addEventListener("message", function (ev) {
    var m = ev.data || {};
    if (m.peitho !== D.meta.id || isNotesView) return;
    if (ev.source && ev.source !== window) state.notesWin = ev.source;
    if (m.type === "nav") move(m.dir);
    if (m.type === "goto") go(m.i, 1);
    if (m.type === "hello") post();
    if (m.type === "reset") { state.started = Date.now(); tick(); post(); }
    if (m.type === "script" && S[m.i]) { S[m.i].notes = m.notes; S[m.i].bridge = m.bridge; remember(m.i); }
  });

  /* ---------- notes window view ---------- */
  var isNotesView = location.hash === "#notes";
  function notesView() {
    document.body.className = "view-notes";
    var root = document.createElement("div"); root.className = "nw"; document.body.appendChild(root);
    var st = { i: 0, step: 1, steps: 1, started: null };
    function send(m) { m.peitho = D.meta.id; if (window.opener) { try { window.opener.postMessage(m, "*"); } catch (e) { /* opener gone */ } } }
    function draw() {
      if (st.editing) return;
      var s = S[st.i], nx = S[st.i + 1];
      var el = st.started ? (Date.now() - st.started) / 1000 : 0;
      var due = plannedStart[st.i] + (s.seconds || 0) * (st.step - 1) / st.steps, d = Math.round(el - due);
      var slotEnd = plannedStart[st.i] + (s.seconds || 0);
      root.innerHTML =
        '<div class="nw__main"><div class="nw__meta">' + L.slide + " " + (st.i + 1) + " " + L.of + " " + S.length + " · " + chapterName(s) + " · " + L.step + " " + st.step + "/" + st.steps + "</div>" +
        '<div class="nw__title">' + strip(s.title) + "</div>" +
        (LOCKED ? '<p class="note-step is-now"><button class="btn" data-unlock>' + L.unlockBtn + "</button></p>" : notesBlock(st.i, st.step)) +
        (CAN_EDIT ? '<p class="script-tools"><button class="btn btn--ghost" data-edit>' + L.edit + '</button><button class="btn btn--ghost" data-code>' + L.changeCode + "</button></p>" : "") + "</div>" +
        '<div class="nw__side"><div class="nw__clock">' + (st.started ? fmt(el) : "0:00") + "</div>" +
        '<div class="nw__pace ' + (!st.started ? "" : d > 30 ? "late" : d < -30 ? "early" : "") + '">' + (st.started ? (d >= 0 ? "+" : "−") + fmt(Math.abs(d)) + " " + (d >= 0 ? L.behind : L.ahead) : L.startsAt) + "</div>" +
        '<div class="nw__meta">' + L.thisSlide + ": " + fmt(plannedStart[st.i]) + "–" + fmt(slotEnd) + " " + L.of + " " + fmt(total) + "</div>" +
        '<div class="nw__btns"><button class="btn btn--nav" data-nav="-1" aria-label="Previous">‹</button><button class="btn btn--nav" data-nav="1" aria-label="Next">›</button><button class="btn" data-reset>' + L.restart + '</button></div>' +
        (nx ? '<div class="nw__next">' + L.nextSlide + "<b>" + strip(nx.title) + "</b>" + fmt(nx.seconds || 0) + " " + L.planned + "</div>" : '<div class="nw__next">' + L.lastSlide + "</div>") + "</div>";
    }
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-nav]"); if (b) send({ type: "nav", dir: +b.dataset.nav });
      if (e.target.closest("[data-reset]")) send({ type: "reset" });
      if (e.target.closest("[data-unlock]")) unlockNotes();
      if (e.target.closest("[data-code]")) changeCode();
      if (e.target.closest("[data-edit]")) {
        var main = $(".nw__main", root), box = document.createElement("div"); box.className = "script-edit";
        $$(".note-step, .note-bridge, .script-tools", main).forEach(function (el) { el.remove(); });
        main.appendChild(box); st.editing = true;
        editScript(box, st.i, function () { st.editing = false; draw(); });
      }
    });
    document.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowRight" || k === "PageDown" || k === " ") { e.preventDefault(); send({ type: "nav", dir: 1 }); }
      else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); send({ type: "nav", dir: -1 }); }
    });
    window.addEventListener("message", function (ev) {
      var m = ev.data || {}; if (m.peitho !== D.meta.id || m.type !== "state") return;
      if (st.editing && m.i !== st.i) st.editing = false;   // the speaker moved on: leave the editor
      m.editing = st.editing; st = m; draw();
    });
    setInterval(draw, 1000);
    draw(); send({ type: "hello" });
    document.title = L.notes + " · " + D.meta.title;
  }

  /* ---------- overview, help, mode, theme ---------- */
  function buildOverview() {
    $("#overview-list").innerHTML = S.map(function (s, i) {
      var c = s.paper ? "var(--" + s.paper + ")" : "var(--accent)";
      return '<li><button type="button" data-goto="' + i + '"><span class="o-n"><span><span class="o-dot" style="background:' + c + '"></span>' + (i + 1) + " · " + chapterName(s) + "</span><span>" + fmt(plannedStart[i]) + "</span></span>" +
        '<span class="o-t">' + strip(s.title) + "</span></button></li>";
    }).join("");
  }
  function openDialog(id) {
    var d = $(id);
    if (id === "#overview") $$("#overview-list button").forEach(function (b) { b.setAttribute("aria-current", +b.dataset.goto === state.i ? "true" : "false"); });
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }
  function closeDialogs() { $$("dialog[open]").forEach(function (d) { d.close ? d.close() : d.removeAttribute("open"); }); }

  function setMode(m) {
    state.mode = m;
    document.body.classList.toggle("mode-present", m === "present");
    document.body.classList.toggle("mode-read", m === "read");
    $$(".modes button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.mode === m ? "true" : "false"); });
    store.set("mode", m);
    for (var i = 0; i < S.length; i++) applySteps(i, i === state.i ? state.step : 1);
    show();
    if (m === "read") { var el = $("#slide-" + (state.i + 1)); if (el) el.scrollIntoView({ block: "start" }); }
  }
  function currentTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    store.set("theme", t);
    var b = $("#btn-theme"); if (b) b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
  function fullscreen() {
    var de = document.documentElement;
    try {
      if (!document.fullscreenElement) { var p = de.requestFullscreen && de.requestFullscreen(); if (p && p.catch) p.catch(function () {}); }
      else if (document.exitFullscreen) document.exitFullscreen();
    } catch (e) { /* not allowed here */ }
  }

  /* ---------- present: the bar and ribbon hide when the mouse rests ---------- */
  // Chromium sends synthetic mousemove events when the page changes under a resting cursor,
  // so only a move of a few pixels counts.
  var chromeT = 0, lastXY = null;
  function chrome(on) {
    clearTimeout(chromeT);
    document.body.classList.toggle("chrome-off", !on);
    if (on) chromeT = setTimeout(function () {
      if (document.querySelector(".topbar:hover, .ribbon:hover, dialog[open]") || (document.activeElement && document.activeElement.closest && document.activeElement.closest(".topbar, .ribbon"))) { chrome(true); return; }
      document.body.classList.add("chrome-off");
    }, 2200);
  }
  document.addEventListener("mousemove", function (e) {
    if (lastXY && Math.abs(e.clientX - lastXY[0]) + Math.abs(e.clientY - lastXY[1]) < 4) return;
    lastXY = [e.clientX, e.clientY]; chrome(true);
  }, { passive: true });
  document.addEventListener("focusin", function (e) { if (e.target.closest && e.target.closest(".topbar, .ribbon")) chrome(true); });

  function onKey(e) {
    if (e.target.closest && e.target.closest("input, select, textarea, [contenteditable]")) return;
    if ($("dialog[open]")) { if (e.key === "Escape") closeDialogs(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || (k === " " && !(e.target.closest && e.target.closest("button")))) { e.preventDefault(); move(1); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); move(-1); }
    else if (k === "Home") { e.preventDefault(); go(0, 1); }
    else if (k === "End") { e.preventDefault(); go(S.length - 1, 1); }
    else if (k === "N") withNotes(toggleDrawer)();
    else if (k === "n") withNotes(openNotes)();
    else if (k === "o" || k === "O") openDialog("#overview");
    else if (k === "f" || k === "F") fullscreen();
    else if (k === "t" || k === "T") setTheme(currentTheme() === "dark" ? "light" : "dark");
    else if (k === "r" || k === "R") setMode(state.mode === "read" ? "present" : "read");
    else if (k === "0") { state.started = Date.now(); tick(); post(); }
    else if (k === "?") openDialog("#help");
  }

  /* ---------- boot ---------- */
  function boot() {
    if (isNotesView) { notesView(); return; }
    // A saved choice wins; then a theme the host page already set; otherwise dark, for projectors.
    var t = store.get("theme");
    if (t === "light" || t === "dark") setTheme(t);
    else if (!document.documentElement.getAttribute("data-theme")) document.documentElement.setAttribute("data-theme", "dark");
    render(); buildOverview();
    if (PRINT) {
      state.mode = "read";
      document.body.className = "mode-print";
      $$(".slide").forEach(function (el) { el.classList.add("is-active"); });
      for (var k = 0; k < S.length; k++) applySteps(k, stepsOf[k]);
      document.documentElement.setAttribute("data-print-ready", "1");
      return;
    }
    var m = /^#s(\d+)$/.exec(location.hash);
    if (m) state.i = Math.max(0, Math.min(S.length - 1, +m[1] - 1));
    var mode = store.get("mode");
    setMode(mode === "read" ? "read" : "present");
    chrome(true);
    document.addEventListener("keydown", onKey);
    $("#btn-prev").addEventListener("click", function () { move(-1); });
    $("#btn-next").addEventListener("click", function () { move(1); });
    $("#btn-notes").addEventListener("click", withNotes(openNotes));
    $("#btn-overview").addEventListener("click", function () { openDialog("#overview"); });
    $("#btn-help").addEventListener("click", function () { openDialog("#help"); });
    $("#btn-theme").addEventListener("click", function () { setTheme(currentTheme() === "dark" ? "light" : "dark"); });
    $("#btn-full").addEventListener("click", fullscreen);
    $$(".modes button").forEach(function (b) { b.addEventListener("click", function () { setMode(b.dataset.mode); }); });
    $$("[data-close]").forEach(function (b) { b.addEventListener("click", closeDialogs); });
    $("#overview-list").addEventListener("click", function (e) { var b = e.target.closest("[data-goto]"); if (b) { closeDialogs(); go(+b.dataset.goto, 1); } });
    // Read mode: edit a slide's script in place (only when it came from the website with the passcode)
    $("#deck").addEventListener("click", function (e) {
      var b = e.target.closest("[data-edit-read]"); if (!b) return;
      var i = +b.dataset.editRead, det = b.closest(".read-notes"), body = $(".read-notes__body", det), tools = b.parentNode;
      tools.style.display = "none";
      editScript(body, i, function () { body.innerHTML = notesHTML(S[i]); tools.style.display = ""; });
    });
    window.addEventListener("hashchange", function () { var mm = /^#s(\d+)$/.exec(location.hash); if (mm && +mm[1] - 1 !== state.i) go(+mm[1] - 1, 1); });
    $("#deck").focus({ preventScroll: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
