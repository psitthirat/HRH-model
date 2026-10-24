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
  // adequacy as a percentage of the example target (owner, 24 Oct 2569): a claim id with "|pct" gives 100 x the unrounded ratio
  var ADEQ = "ความเพียงพอ: จำนวนแพทย์เป็นร้อยละของเป้าหมายตัวอย่าง " + F("lit.target_ratio") + " ประชากร";
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
      ".nx-src{font-size:calc(var(--fs-small)*.9);color:var(--muted)}",
      // Thai units from the typesetting pass below; balanced wrapping only chooses among unit boundaries
      ".tw{white-space:nowrap}",
      ".slide .body li,.nx-card p,.nx-col li,.nx-table td,.nx-chip{text-wrap:pretty}",
      // caveats name what the slide is not (a commitment, an agreement): readable from the back (owner floor 20-22 px)
      ".slide .caveat{font-size:max(15px,calc(var(--u)*1.1));line-height:1.45}",
      // s02: the typing aid is for the presenter only - it shows on hover or focus, never in print
      ".nx-edit{opacity:0;transition:opacity .2s}",
      ".nx-card:hover .nx-edit,.nx-card:focus-within .nx-edit{opacity:1}",
      "html.print .nx-edit{display:none}",
      "html.print .nx-note:empty::before{content:none}",
      ".nx-head .nx-num{display:inline-block;min-width:1.15em}",
      ".nx-progs{gap:calc(var(--u)*1)}",
      "#slide-7 .slide__fig{margin-top:calc(var(--u)*-1.35)}",
      ".nx-progs .nx-chip .nx-src{font-size:calc(var(--fs-body)*.86)}",   // s07 card 3: what the two percentages are of
      ".nx-progs .nx-card{padding:calc(var(--u)*.85) calc(var(--u)*1.1);gap:calc(var(--u)*.4)}",
      ".nx-progs .nx-head{align-items:flex-start}",
      ".nx-progs .nx-card h4{font-size:calc(var(--fs-body)*1.06);line-height:1.3;min-height:2.6em}",
      ".nx-progs .nx-num{font-size:var(--fs-title)}",
      ".nx-progs .nx-tag{font-size:max(13px,calc(var(--u)*1));color:var(--text-2);border-color:var(--line-strong)}",
      ".nx-progs .nx-card p{font-size:var(--fs-body);line-height:1.42;color:var(--text-2)}",
      ".nx-progs .nx-chip{font-size:var(--fs-body);line-height:1.4}",
      ".nx-agenda{gap:calc(var(--u)*.7) calc(var(--u)*1.1)}",
      ".nx-agenda h5{margin:0 0 calc(var(--u)*.1);font-size:var(--fs-body);font-weight:500;line-height:1.3}",
      ".nx-item{font-size:calc(var(--fs-body)*1.05);color:var(--text-1);line-height:1.42;padding:calc(var(--u)*.7) calc(var(--u)*.85);border:1px solid var(--line);border-radius:6px;background:var(--card);transition:opacity .4s var(--ease);text-wrap:pretty}",
      ".nx-item b{color:var(--accent-text);font-weight:500}",
      ".nx-hand{margin-top:calc(var(--u)*.5)}",
      ".nx-hand h4{font-size:var(--fs-lead)}",
      ".nx-table.nx-roles{table-layout:fixed}",
      ".nx-roles td:first-child{white-space:normal}",
      ".nx-roles tbody tr:last-child td{background:var(--accent-soft)}",
      ".nx-roles tbody tr:last-child td:first-child{background:linear-gradient(var(--accent),var(--accent)) left top/3px 100% no-repeat,var(--accent-soft);color:var(--accent-text)}",   // a background prints; the old inset shadow did not
      ".nx-near .nx-card{gap:calc(var(--u)*.6)}",
      ".nx-near .nx-card .nx-grid{height:auto}",
      ".nx-near .nx-card h4{font-size:calc(var(--fs-body)*1.05)}",
      ".nx-near .nx-card p{font-size:var(--fs-body);line-height:1.45}",
      ".nx-near .nx-label{font-size:max(13px,calc(var(--u)*1));color:var(--muted);margin-top:calc(var(--u)*.4)}",
      ".nx-near .nx-col li{font-size:var(--fs-body);line-height:1.42;padding:calc(var(--u)*.5) calc(var(--u)*.7)}",
      ".nx-near .nx-col{margin-top:calc(var(--u)*.4)}",
      ".nx-plain{list-style:none;margin:calc(var(--u)*.5) 0 0;padding:0;display:flex;flex-direction:column;gap:calc(var(--u)*.55)}",
      ".nx-plain li{position:relative;padding-left:1.1em;font-size:var(--fs-body);color:var(--text-1);line-height:1.42}",
      ".nx-plain li::before{content:'';position:absolute;left:0;top:.62em;width:.42em;height:.42em;border-radius:50%;background:var(--accent)}",
      ".nx-plain li b{color:var(--accent-text);font-weight:500}",
      ".nx-quote{margin:0}",
      // s13: the closing line in four lines, the last one whole ("ของแต่ละทางเลือกปรากฏชัด")
      "#slide-13 .display{font-size:calc(var(--fs-display)*.9)}",
      // round 3: use the lower left of the text column (s03 key, s04 names, s06 conditions, s08 two rows)
      ".nx-key{display:flex;flex-direction:column;gap:calc(var(--u)*.55);margin:auto 0;padding-top:calc(var(--u)*1);border-top:1px solid var(--line)}",
      ".nx-key p{display:flex;align-items:baseline;gap:.55em;margin:0;font-size:var(--fs-body);line-height:1.42;color:var(--text-2)}",
      ".nx-key svg{flex:none;width:1.05em;height:1.05em;transform:translateY(.16em)}",
      ".nx-key p.nx-key__hit{color:var(--accent-text)}",
      ".nx-key p.nx-key__def{font-size:calc(var(--fs-body)*.88);color:var(--muted)}",
      ".nx-key p.nx-key__hit:not(.is-pending){transition-delay:1.9s}",   // s03: the takeaway lands after callout 6
      ".nx-names{margin-top:auto;margin-bottom:calc(var(--u)*2.7);display:flex;flex-direction:column;gap:calc(var(--u)*.5);padding-left:calc(var(--u)*.9);border-left:2px solid var(--line-strong)}",
      ".nx-names p{margin:0;font-size:var(--fs-body);line-height:1.42;color:var(--text-2)}",
      ".nx-names b{color:var(--text-1);font-weight:500}",
      ".nx-names p.nx-names__e,.nx-names p.nx-names__e b{color:var(--accent-text)}",
      "@media (min-width:861px){#slide-4.slide[data-layout=\"split\"],#slide-5.slide[data-layout=\"split\"]{grid-template-columns:minmax(0,.74fr) minmax(0,1.46fr)}" +
        "#slide-8 .slide__text{position:relative}" +
        "#slide-8 .slide__text .nx-row2{position:absolute;left:0;right:0;top:calc(var(--u)*23.7);margin:0;padding-top:calc(var(--u)*1.1);border-top:1px solid var(--line)}}",
      ".nx-quote cite{display:block;font-style:normal;font-size:var(--fs-kicker);color:var(--muted);margin-top:.35em}"
    ].join("\n");
    var st = document.createElement("style"); st.id = "nx-style"; st.textContent = css; document.head.appendChild(st);
  })();

  /* ---------------- Thai line breaking (this deck only; adapted from story/reader/newsletter/typeset.js) ----------------
   * Chromium breaks Thai wherever its ICU dictionary sees a word boundary: it splits compounds (หลัก|ฐาน, ตัว|หาร,
   * เพียง|พอ, ครัว|เรือน) and leaves joining words (การ ความ ที่ และ) at line ends. After the deck renders, each
   * text node of the slide text and of the HTML figures is cut into units: Intl.Segmenter words, with KEEP words never
   * cut (words pythainlp keeps whole where ICU cuts them in this deck's text, 24 Oct 2569, plus key phrases), GLUE
   * prefixes and conjunctions joined to the word after them, and SOFT prepositions joined to the next word while the
   * unit stays short. Each unit is a no-break span and units meet at a zero-width space, so a line ends only between
   * units. A key term in <strong> or <b> stays whole, and a block's last unit never sits alone on its line.
   * SVG text does not wrap: figures break it by hand. */
  (function typeset() {
    var KEEP = ("ภายในกติกาเดิม กติกาเดิม การเปลี่ยนแปลงโครงสร้าง การสังเคราะห์ข้อเสนอ วิเคราะห์ปัญหา เชิงโครงสร้าง " +
      "ช่องที่หนึ่ง ช่องที่สอง ช่องที่สาม ช่องที่สี่ ที่หนึ่ง ที่สอง ที่สาม ที่สี่ คงทนที่สุด มากที่สุด ที่สุด " +
      "เพียงพอ ความเพียงพอ ไม่เพียงพอ ความไม่เพียงพอ แหล่งข้อมูล แหล่งทุน รากศัพท์ หลักฐาน หลักฐานกลไก พื้นฐาน " +
      "ทางเลือกพื้นฐาน กำลังคน การสำรวจกำลังคน แบบจำลอง แบบจำลองจัดสรร ครัวเรือน นิรนาม แบบนิรนาม รายบุคคล " +
      "ความจำเป็น ล่วงหน้า น่าเชื่อถือ ความน่าเชื่อถือ ตัวหาร กรอบตำแหน่ง ตำแหน่งว่าง พื้นที่ขาด หลักประกัน " +
      "หลักประกันสุขภาพถ้วนหน้า โครงการผลิตเพื่อพื้นที่ คำอธิบาย ไม่ได้ เกิดอะไรขึ้น เกิดขึ้น จัดสรรรอบหน้า รอบหน้า " +
      "เรียกว่า รอบตัดสิน ตรวจได้ เป็นธรรมชาติ ธรรมชาติ ความสามารถ บริการเอกชน สองภาค ฐานจัดสรร พันธะบริการ " +
      "ระดับพื้นที่ กระบวนการ กระบวนการนโยบาย เรียนรู้ต่อได้ทุกปี ทุกปี รายปี ทุกห้าปี ห้าปี ระยะยาว ระยะสั้น " +
      "ระยะกลางถึงยาว ข้อเสนอ ข้อจำกัด ข้อตกลง ข้อถกเถียง ข้ออ้าง ทางเลือก การศึกษา ผลการศึกษา ความรู้ องค์ความรู้ " +
      "นักวิชาการ ทางวิชาการ เครือข่าย หน่วยงาน การทดลอง การวินิจฉัย การธำรง ครั้งนี้ ความเสี่ยง ช่องทาง ตอบคำถาม " +
      "ตั้งคำถาม ผู้เขียน นำเสนอ เปิดเผย กระทบยอด กวาดตา การประชุม การประเมิน การผลิต ความขาดแคลน " +
      "ความสำคัญ ความเห็น ความเอนเอียง ความใกล้ชิด งานวิจัย ถกเถียง ผู้จ้าง ผู้ตัดสิน ผู้ทำงาน ภายใต้ วิสัยทัศน์ " +
      "สถานพยาบาล หลักปฏิบัติ อย่างไร เครื่องมือ เฉพาะทาง แพทย์เฉพาะทาง เส้นทาง เหล่านี้ เหล่านั้น โต้แย้ง ใช้ทุน " +
      "กระจาย กระจายอำนาจ กลายเป็น การกำกับ การสาธารณสุข การอธิบาย การเงิน การเรียนรู้ การเลือกตั้ง ก่อนกำหนด " +
      "ครัวเรือน ความคิด ความจริง ความมั่นคง ความร่วมมือ ความสำเร็จ ความหมาย ความเข้าใจ ความไม่แน่นอน คำตอบ " +
      "ค่าคงที่ ค่าตอบแทน จัดเก็บ ช่องว่าง ดีกว่า ตรงกันข้าม ตรงไหน ตรวจสอบ ตัดสินใจ ตัวเอง ตั้งต้น ถ่ายโอน ถ้วนหน้า " +
      "ทีละขั้น ทีละน้อย ทีละปี ที่ตั้ง ที่ปรึกษา ทุกท่าน นักปฏิรูป บ้านเกิด ปฐมภูมิ ปรากฏชัด ปัญหาเฉพาะหน้า ผลตอบแทน " +
      "ผิดทาง ผู้ปฏิบัติงาน ผู้ว่าจ้าง ผู้ออกแบบ มีคุณค่า มีสิทธิ์ รับทุน รับผิดชอบ รับภาระ รูปแบบ ร่วมกัน ร้อยละ " +
      "ลดคุณค่า สุดโต่ง ความสุดโต่ง ส่วนหนึ่ง ส่วนใหญ่ หรือไม่ ออดส์ เข้าออก เปรียบเทียบ เผยแพร่ เพราะอะไร เพียงใด " +
      "เรียนรู้ เวลาทำงาน เวลาเริ่ม แผนงาน แผนงานวิจัย โครงการวิจัย โรงพยาบาล ในที่นี้ ในอนาคต ได้รับ สถาบันวิจัย " +
      "จุดตรวจ ขั้นทดลอง วงเสวนา ฉันทามติ ผลผลิต ผู้ดูแลหลัก บันไดอาชีพ อาชีพ แหล่งฝึก ภูมิภาค " +
      "ผู้สูงอายุ ผู้ป่วย ผู้ตอบ ผู้ดูแล ประชากร ตำแหน่ง บุคลากร สาธารณสุข กระทรวง ผู้ร่วมเสวนา การตัดสินร่วม " +
      "ผลที่คงทนที่สุด มันคือ ทำอะไร ขอให้เลือก ธำรงคน ธำรงคนไว้ การธำรงคนในระบบ ธำรงคนในระบบ หนึ่งในสิบ ระบบการจ้าง " +
      "แบบจำลองการเลือก ดูเป็นธรรมชาติ ทุกทางเลือก การกวาดตาแบบผสม กวาดตาแบบผสม ถูกเรียกว่า ช่องอื่น เส้นทางอาชีพ " +
      "การดูแลระยะยาว ดูแลระยะยาว ด้วยการกวาดตาแบบผสม ฉากทัศน์ แกนแรก แกนที่สอง มาตรการทั่วไป รับไว้ " +
      "ที่มี ก็มี เพื่อขอ กรอบสี่ช่อง ขั้นทดลองที่มีจุดตรวจ ตัวเลขความขาดแคลน การเมืองเชิงสถาบัน คำตอบภายในกติกาเดิม " +
      "แบบจำลองการเลือกของบุคลากร ความเสี่ยงที่ต้องจัดการ หลายเรื่อง ส่งงาน ส่งงานให้กัน สองคอลัมน์ " +
      "ช่วยให้คนทำงาน ช่วยให้ตัดสินใจ ให้น้ำหนักกับกติกาการเลือกตั้ง มองข้าม ข้อสรุป ข้อสรุปวิชาการ เกิดผล เกิดผลอย่างไร เทียบอะไร ถ่ายโอนให้ท้องถิ่นแล้ว ช่วยให้ คนทำงาน " +
      "ความสมเหตุสมผล ต่อความสมเหตุสมผล รับฟังกันได้ กติกาการเลือกตั้ง พรรคการเมือง ผู้ให้ทุน เป้าหมายตัวอย่าง " +
      "สวรส. สธ. สพพ. รพ.สต. สป.").split(" ").sort(function (a, b) { return b.length - a.length; });
    var GLUE = new Set("ความ การ ผู้ นัก แต่ และ หรือ จึง ซึ่ง เพราะ ถ้า หาก เมื่อ แม้ โดย ทั้ง ส่วน เชิง แต่ละ ทุก จนกว่า มันคือ ไม่ได้ ที่มี ก็มี เพื่อขอ ออกจาก เพียง".split(" "));
    var SOFT = new Set("ที่ ไม่ ของ ใน จาก กับ ให้ เป็น คือ ต่อ ตาม เพื่อ อย่าง จะ ต้อง ควร ยัง ระหว่าง ว่า ภายใน ภายใต้ ด้วย ถึง แก่ บน สู่ สำหรับ".split(" "));
    var SHORT = 16;                               // longest unit a SOFT word may make, in characters
    var WHOLE = 40;                               // a <strong>/<b> term up to this length never breaks
    var START = /[ก-ฮเ-ไ]/, END = /[ก-ฺๅ-๎]/, THAI = /[ก-๎]/;
    var seg = window.Intl && Intl.Segmenter ? new Intl.Segmenter("th", { granularity: "word" }) : null;

    function units(run) {
      if (!seg) return { list: [run], glue: false };
      var cut = new Set(), out = [], last = "", i, k, j;
      Array.from(seg.segment(run)).forEach(function (s) { if (s.index > 0) cut.add(s.index); });
      KEEP.forEach(function (w) {
        for (k = run.indexOf(w); k >= 0; k = run.indexOf(w, k + 1))
          for (j = k + 1; j < k + w.length; j++) cut.delete(j);
      });
      cut.forEach(function (c) { if (!END.test(run[c - 1]) || !START.test(run[c])) cut.delete(c); });
      var at = [0].concat(Array.from(cut).sort(function (a, b) { return a - b; }), [run.length]);
      var words = [], ends = [];
      for (i = 0; i + 1 < at.length; i++) {
        var w = run.slice(at[i], at[i + 1]);
        if (words.length && GLUE.has(last)) words[words.length - 1] += w; else words.push(w);
        ends[words.length - 1] = w;
        last = w;
      }
      words.forEach(function (w, n) {
        var prev = out[out.length - 1];
        if (n && SOFT.has(ends[n - 1]) && (prev + w).length <= SHORT) out[out.length - 1] += w; else out.push(w);
      });
      return { list: out, glue: GLUE.has(last) };
    }
    function span(t) { var s = document.createElement("span"); s.className = "tw"; s.textContent = t; return s; }
    function set(node) {
      var whole = node.parentElement && /^(STRONG|B)$/.test(node.parentElement.tagName) && node.data.trim().length <= WHOLE;
      var parts = node.data.split(/(\s+)/), frag = document.createDocumentFragment(), glue = false;
      parts.forEach(function (p, i) {
        if (!p) return;
        if (/^\s+$/.test(p)) { frag.append(glue || whole || /^ๆ/.test(parts[i + 1] || "") ? " " : p); glue = false; return; }
        var u = whole || !THAI.test(p) ? { list: [p], glue: false } : units(p);
        u.list.forEach(function (t, n) { if (n) frag.append("​"); frag.append(span(t)); });
        glue = u.glue;
      });
      node.replaceWith(frag);
    }
    // the last unit of a block joins the one before it, across a zero-width space or a space
    function orphan(block) {
      var tws = block.querySelectorAll(".tw");
      if (tws.length < 3) return;
      var a = tws[tws.length - 2], b = tws[tws.length - 1];
      if (b.textContent.length > 9 || a.parentNode !== b.parentNode) return;
      var mid = a.nextSibling;
      if (mid === b) { a.textContent += b.textContent; b.remove(); return; }
      if (mid && mid.nodeType === 3 && mid.nextSibling === b && /^[​\s]+$/.test(mid.data)) {
        if (mid.data === "​") { mid.remove(); a.textContent += b.textContent; b.remove(); }
        else mid.data = " ";
      }
    }
    // flex containers that hold text directly (the kicker) keep their text as it is: one unit per flex item would add gaps
    var SKIP = "svg, script, style, .tw, .nobr, [contenteditable], .nx-edit, .badge, .hud-meta, .read-notes, .kicker, .nx-tag";
    var BLOCKS = "h1, h2, h3, h4, h5, p, li, td, th, .nx-chip, .nx-quote, .nx-tag, .nx-item, .lead";
    function run() {
      Array.prototype.forEach.call(document.querySelectorAll(".slide .slide__text, .slide .slide__fig"), function (root) {
        if (root.dataset.ts) return;
        root.dataset.ts = "1";
        var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
          return /[^\s​]/.test(n.data) && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
        var nodes = [];
        while (walk.nextNode()) nodes.push(walk.currentNode);
        nodes.forEach(set);
        Array.prototype.forEach.call(root.querySelectorAll(BLOCKS), orphan);
      });
      document.documentElement.dataset.typeset = "done";
    }
    window.PEITHO = window.PEITHO || {};
    var hooks = window.PEITHO.hooks = window.PEITHO.hooks || { afterRender: [], onShow: [] };
    hooks.afterRender.push(run);
  })();

  /* ---------------- print: stars without the glow discs ----------------
   * The engine's print star layer (hud.js printStars, CSS variable --print-stars) draws each soft glow as
   * a faint disc with a bright core; in the PDF they print as hard grey dots, one under every title. This
   * deck keeps the stars (r <= 1.6) and drops the glows (r >= 2.4) after the engine has set the layer. */
  (function printWithoutGlows() {
    var hooks = window.PEITHO.hooks = window.PEITHO.hooks || { afterRender: [], onShow: [] };
    hooks.afterRender.push(function () {
      var root = document.documentElement;
      if (!root.classList.contains("print")) return;
      var m = (root.style.getPropertyValue("--print-stars") || "").match(/^url\("data:image\/svg\+xml;charset=utf-8,(.*)"\)$/);
      if (!m) return;
      var svg = decodeURIComponent(m[1]).replace(/<circle [^>]*\br="([\d.]+)"[^>]*\/>/g, function (c, r) { return +r >= 2 ? "" : c; });
      root.style.setProperty("--print-stars", 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")');
    });
  })();

  /* ---------------- the 2x2 knowledge map ---------------- */
  // Axes and box names as the owner set them (24 Oct 2569): each box is named from its two axes.
  var COLS = ["ภายในกติกาเดิม", "การเปลี่ยนแปลงโครงสร้าง"];
  var ROWS = [["การวินิจฉัยและ", "การวิเคราะห์ปัญหา"], ["การสังเคราะห์", "ข้อเสนอ"]];
  var QNAME = ["วิเคราะห์ปัญหาภายในกติกาเดิม", "วิเคราะห์ปัญหาเชิงโครงสร้าง", "ข้อเสนอภายในกติกาเดิม", "ข้อเสนอเปลี่ยนแปลงโครงสร้าง"];
  // quad(g, {x, y, w, h, labels, lw, fs}) -> {tiles, rect(i), center(i), x0, y0, gw, gh}; i = 0..3 for ช่องที่ 1..4
  // base: an opaque ground under each tile, so an orbit drawn before the map passes behind it (s01, s13);
  // halo: labels get a ground-coloured outline for the same reason; top: room between column labels and boxes.
  function quad(g, o) {
    var fs = o.fs || 14, gap = o.gap == null ? 8 : o.gap, lw = o.rowLabel === false ? 0 : (o.lw || 118), top = o.colLabel === false ? 0 : (o.top || 26);
    var tw = (o.w - lw - gap) / 2, th = (o.h - top - gap) / 2, x0 = o.x + lw, y0 = o.y + top;
    var halo = o.halo ? { style: "paint-order:stroke;stroke:var(--bg);stroke-width:7px;stroke-linejoin:round" } : null;
    if (o.colLabel !== false) {
      txt(g, x0 + tw / 2, o.y + 16, COLS[0], fs, "t-muted", "middle", halo);
      txt(g, x0 + tw + gap + tw / 2, o.y + 16, COLS[1], fs, "t-accent", "middle", halo);
    }
    if (o.rowLabel !== false) {
      ROWS.forEach(function (lines, r) {
        var cy = y0 + r * (th + gap) + th / 2, lh = fs * 1.3;
        lines.forEach(function (s, j) { txt(g, o.x, cy + (j - (lines.length - 1) / 2) * lh + fs * 0.35, s, fs, "t-muted", "start", halo); });
      });
    }
    if (o.base) {
      var bases = S("g", {}, g);
      [0, 1, 2, 3].forEach(function (i) {
        S("rect", { x: x0 + (i % 2) * (tw + gap), y: y0 + Math.floor(i / 2) * (th + gap), width: tw, height: th, rx: 6, style: "fill:var(--bg)" }, bases);
      });
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
      tiles: tiles, x0: x0, y0: y0, gw: 2 * tw + gap, gh: 2 * th + gap,
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
    var ring = S("g", { transform: "translate(260,280)" }, svg);    // drawn first: it passes behind the boxes
    [290, 320].forEach(function (r, i) { S("circle", { r: r, style: "fill:none;stroke:var(--line-strong);stroke-width:1;stroke-dasharray:" + (i ? "2 10" : "70 18") }, ring); });
    var q = quad(svg, { x: 0, y: 60, w: 520, h: 420, labels: false, numSize: 54, gap: 14, fs: 17, lw: 152, top: 34, base: true, halo: true });
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
      "ใครควรเป็นผู้จ้าง<br>และอะไรกำหนดว่าพื้นที่รับคนได้เท่าใด",
      "ใครรับภาระของความไม่เพียงพอ<br>ระหว่างรัฐ ผู้ทำงาน ครอบครัว และชุมชน",
      "ใครควรมีสิทธิ์ตัดสินว่าเท่าใดจึงเพียงพอ<br>และฉันทามติควรสร้างผ่านช่องทางใด"
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
    var svg = U.svgHost(host, "0 44 640 406", "ผลการศึกษาภายใต้เงื่อนไขที่ใช้ในการศึกษา และกติกาที่ผลเหล่านี้ชี้ให้ทบทวน"); U.defs(svg);
    var box = { x: 10, y: 70, w: 300, h: 360 };
    S("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: 10, style: "fill:var(--accent-soft);stroke:var(--accent);stroke-width:2", class: "glow" }, svg);
    txt(svg, box.x + 16, box.y + 30, "เงื่อนไขที่ใช้ในการศึกษา", 15, "t-accent");
    txt(svg, box.x + 16, box.y + 52, "กรอบตำแหน่ง · ผู้จ้าง · ที่ตั้งการฝึก", 12, "t-muted");
    txt(svg, box.x + 16, box.y + 70, "ตลาดแรงงาน · งานดูแล", 12, "t-muted");
    // The figure's two captions live in a key under the body (the empty lower left of the text column):
    // the dot, then (with the click) the wall chevron and the line the six findings add up to.
    var col = host.closest(".slide").querySelector(".slide__text");
    var key = H("div", "nx-key", null, col);
    H("p", "", '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4.5" style="fill:var(--p1)"/></svg><span>จุด = ผลการศึกษาภายใต้เงื่อนไขเหล่านี้</span>', key);
    H("p", "nx-key__hit", '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8,3 L15,10 L8,17 M4,10 H15" style="fill:none;stroke:var(--accent);stroke-width:2.2;stroke-linecap:round"/></svg><span>ผลเหล่านี้ช่วยระบุว่ากติกาใดควรทบทวน</span>', key).setAttribute("data-step", "2");
    H("p", "nx-key__def", '<svg viewBox="0 0 20 20" aria-hidden="true"></svg><span>' + ADEQ + "</span>", key).setAttribute("data-step", "2");
    var parts = [];
    for (var i = 0; i < 26; i++) {
      var a = i * 2.39996;
      parts.push({ x: box.x + 40 + (i * 37) % (box.w - 80), y: box.y + 100 + (i * 53) % (box.h - 150), vx: Math.cos(a) * 0.09, vy: Math.sin(a) * 0.09,
        el: S("circle", { r: 4, style: "fill:var(--p1)" }, svg) });
    }
    U.loop(svg, function (dt) {
      parts.forEach(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < box.x + 6 || p.x > box.x + box.w - 6) { p.vx = -p.vx; p.x = Math.max(box.x + 6, Math.min(box.x + box.w - 6, p.x)); }
        if (p.y < box.y + 94 || p.y > box.y + box.h - 8) { p.vy = -p.vy; p.y = Math.max(box.y + 94, Math.min(box.y + box.h - 8, p.y)); }
        p.el.setAttribute("cx", p.x); p.el.setAttribute("cy", p.y);
      });
    });
    if (U.isStatic()) parts.forEach(function (p) { p.el.setAttribute("cx", p.x); p.el.setAttribute("cy", p.y); });
    var chips = [
      "กรอบเต็ม: ทุกสูตรได้ " + F("c5f_PR_F0_bq_P|pct") + "% ของเป้าหมาย",
      ["เพิ่มตามสัดส่วนใช้ตำแหน่ง " + F("c5f_prorata_equiv_ratio") + " เท่า", "ของการวางตามจำเป็น"],
      ["รพ.จ่าย " + F("c5f_PR_GDh5_bq_P|pct") + "%", "ส่วนกลางจ่ายและจัดตามจำเป็น " + F("c5f_PR_GDc5_bq_P|pct") + "%"],
      F("c46_dis_n_all_four") + " จังหวัดอยู่กลุ่มต่ำสุดทั้งสี่วิธีวัด",
      // c46_conc_top10_all1 counts specialists (people) among facilities that have any (owner wording, 23 Oct)
      ["แพทย์เฉพาะทาง " + F("c46_conc_top10_all1") + "% อยู่ในสถานพยาบาล", "กลุ่มบนหนึ่งในสิบ"],
      "ผู้ตอบ " + F("c77_pct_primary_carer") + "% เป็นผู้ดูแลหลักในครอบครัว"
    ].map(function (s, i) {
      var g = S("g", { style: "opacity:0" }, svg), y = 84 + i * 60, wy = box.y + 40 + i * 56, wx = box.x + box.w;
      S("path", { d: "M" + wx + "," + wy + " C" + (wx + 30) + "," + wy + " 320," + (y + 4) + " 342," + (y + 4), style: "fill:none;stroke:var(--accent);stroke-width:1.2;stroke-dasharray:3 4" }, g);
      S("path", { d: "M" + (wx - 7) + "," + (wy - 9) + " L" + wx + "," + wy + " L" + (wx - 7) + "," + (wy + 9) + " M" + (wx - 10) + "," + wy + " H" + wx, style: "fill:none;stroke:var(--accent);stroke-width:2;stroke-linecap:round" }, g);
      S("rect", { x: 342, y: y - 20, width: 296, height: 46, rx: 6, style: "fill:var(--card);stroke:var(--line-strong)" }, g);
      if (Array.isArray(s)) { txt(g, 354, y - 1, s[0], 12.5, "t-strong"); txt(g, 354, y + 16, s[1], 12.5, "t-strong"); }
      else txt(g, 354, y + 8, s, 12.5, "t-strong");
      return g;
    });
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) chips.forEach(function (c) { c.style.opacity = 0; });
      if (k === 2) chips.forEach(function (c, i) { fade(c, true, anim ? 380 : 0, jobs, 150 + i * 260); });
    });
  };

  /* ---------------- s04 the four boxes of knowledge ---------------- */
  FIGS.s04 = function (host) {
    var svg = U.svgHost(host, "0 0 640 424", "กรอบสี่ช่อง: การวินิจฉัยและการวิเคราะห์ปัญหาหรือการสังเคราะห์ข้อเสนอ ภายในกติกาเดิมหรือการเปลี่ยนแปลงโครงสร้าง"); U.defs(svg);
    var g = S("g", {}, svg);
    var q = quad(g, { x: 0, y: 0, w: 640, h: 420, lfs: 13.5, lw: 128 });   // same grid as s05
    var extra = S("g", { style: "opacity:0" }, svg);
    var r3 = q.rect(2), r4 = q.rect(3), my = r3.y + r3.h / 2, xa = r3.x + r3.w - 70, xb = r4.x + 70;
    S("rect", { x: xa - 8, y: my - 34, width: xb - xa + 16, height: 68, rx: 8, style: "fill:var(--bg);stroke:var(--accent);stroke-width:1" }, extra);
    S("path", { d: "M" + xa + "," + (my - 8) + " H" + (xb - 10), style: "fill:none;stroke:var(--accent);stroke-width:1.8" }, extra);
    S("path", { d: "M" + (xb - 12) + "," + (my - 14) + " L" + xb + "," + (my - 8) + " L" + (xb - 12) + "," + (my - 2) + "Z", style: "fill:var(--accent)" }, extra);
    S("path", { d: "M" + xb + "," + (my + 12) + " H" + (xa + 10), style: "fill:none;stroke:var(--accent);stroke-width:1.8" }, extra);
    S("path", { d: "M" + (xa + 12) + "," + (my + 6) + " L" + xa + "," + (my + 12) + " L" + (xa + 12) + "," + (my + 18) + "Z", style: "fill:var(--accent)" }, extra);
    txt(extra, (xa + xb) / 2, my - 18, "ใช้ความรู้ประกอบกัน", 12.5, "t-strong", "middle");
    // Lindblom and Etzioni sit at the foot of the text column (they arrive with click 2), so the map gets the figure.
    var col = host.closest(".slide").querySelector(".slide__text");
    H("div", "nx-names", '<p><b>Lindblom</b> · ค่อย ๆ ปรับจากทางเลือกที่ใกล้กัน</p>' +
      '<p class="nx-names__e"><b>Etzioni</b> · พิจารณาทางเลือกกว้างก่อน แล้วลงมือทีละขั้น</p>', col).setAttribute("data-step", "2");
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
    var svg = U.svgHost(host, "0 0 640 424", "งานของการศึกษาครั้งนี้ในสี่ช่อง"); U.defs(svg);
    var q = quad(svg, { x: 0, y: 0, w: 640, h: 420, lfs: 13.5, lw: 128 });   // same grid, viewBox and column split as s04
    // What the study did in each box, as actions (owner, 24 Oct); quadrant two follows chapter 11:
    // shortage as something defined, organised and shifted onto others. Retention = การธำรงคนในระบบ.
    var items = [
      [0, ["นับแพทย์และเทียบหลายวิธี", "ตรวจยอดคนเข้าออก", "สำรวจเหตุผลที่อยู่หรือคิดออก"], "var(--p1)"],
      [1, ["ใครนิยามว่าขาดแคลน", "วิชาชีพกำหนดจำนวนอย่างไร", "ใครรับภาระดูแล"], "var(--p2)"],
      [2, ["จำลองการจัดแพทย์ใหม่", "เสนอมาตรการการธำรงคนในระบบ"], "var(--p1)"],
      [3, ["เสนอให้ทบทวนกติกาทุกปี"], "var(--accent)"]
    ];
    var dots = [];
    items.forEach(function (it) {
      var r = q.rect(it[0]);
      it[1].forEach(function (lab, j) {
        var g = S("g", { style: "opacity:0" }, svg), x = r.x + 22, y = r.y + 64 + j * 34;
        S("circle", { cx: x, cy: y - 5, r: 7, style: "fill:" + it[2] }, g);
        txt(g, x + 14, y, lab, 14, "t-strong");
        dots.push(g);
      });
    });
    var r4 = q.rect(3);
    var empty = S("g", { style: "opacity:0" }, svg);
    S("rect", { x: r4.x + 6, y: r4.y + 6, width: r4.w - 12, height: r4.h - 12, rx: 6, style: "fill:none;stroke:var(--accent);stroke-width:1.5;stroke-dasharray:6 6" }, empty);
    txt(empty, r4.x + r4.w / 2, r4.y + 118, "ยังขาดงาน", 17, "t-accent glow", "middle");
    txt(empty, r4.x + r4.w / 2, r4.y + 142, "เปรียบเทียบทางเลือก", 17, "t-accent glow", "middle");
    var pulse = { stop: function () {} };
    return stepper(host, 1, function (k, anim, jobs) {
      if (k === 1) {
        dots.forEach(function (d, i) { fade(d, true, anim ? 300 : 0, jobs, 200 + i * 180); });
        fade(empty, true, anim ? 400 : 0, jobs, 200 + dots.length * 180);
        pulse.stop();
        if (!U.isStatic()) { var dash = 0; pulse = jobs.add(U.loop(empty, function (dt) { dash = (dash + dt * 0.02) % 12; empty.firstChild.style.strokeDashoffset = dash; })); }
      }
    });
  };

  /* ---------------- s06 why quadrant four first, and on what conditions ---------------- */
  FIGS.s06 = function (host) {
    // Reasons 1-3 fill the figure; the conditions (click 3) sit under their paragraph in the text column.
    var svg = U.svgHost(host, "0 0 640 480", "เหตุผลสามข้อที่ต้องศึกษาวิธีเปลี่ยนระบบ"); U.defs(svg);
    // reason 1: the findings point there
    var g1 = S("g", {}, svg);
    txt(g1, 0, 22, "เหตุผลที่หนึ่ง · ผลการศึกษาชี้ข้อจำกัดที่ต้องแก้", 15.5, "t-accent");
    [[["กรอบเต็ม", "ทุกสูตรได้ความเพียงพอ"], F("c5f_PR_F0_bq_P|pct") + "%"], [["ผลจำลอง: ไม่มีตำแหน่งรองรับ", "ในสิบห้าปี"], F("c5f_PR_pool2500_unplaced") + " คน*"], [["อยู่กลุ่มต่ำสุด", "ทั้งสี่วิธีวัด"], F("c46_dis_n_all_four") + " จังหวัด"]].forEach(function (c, i) {
      var x = i * 214;
      S("rect", { x: x, y: 37, width: 204, height: 98, rx: 6, style: "fill:var(--card);stroke:var(--line-strong)" }, g1);
      txt(g1, x + 14, 60, c[0][0], 14, "t-muted"); txt(g1, x + 14, 79, c[0][1], 14, "t-muted");
      txt(g1, x + 14, 119, c[1], 24, "t-strong");
    });
    txt(g1, 0, 154, ADEQ, 13, "t-muted");
    txt(g1, 0, 172, "* สมมติให้มีแพทย์พร้อมจัดสรรปีละสองพันห้าร้อยคน และเพิ่มตำแหน่งร้อยละห้าต่อรอบ", 13, "t-muted");
    // reasons 2 and 3: time and Thai history
    var g2 = S("g", { style: "opacity:0" }, svg);
    S("line", { x1: 0, y1: 188, x2: 640, y2: 188, style: "stroke:var(--line)" }, g2);
    txt(g2, 0, 220, "เหตุผลที่สอง · การตัดสินใจวันนี้มีผลอีกหลายปี", 15.5, "t-accent");
    S("line", { x1: 0, y1: 240, x2: 640, y2: 240, style: "stroke:var(--line)" }, g2);
    txt(g2, 0, 272, "เหตุผลที่สาม · ไทยเคยเปลี่ยนระบบเพื่อกระจายแพทย์", 15.5, "t-accent");
    var X0 = 20, X1 = 620, AY = 352;
    function xOf(y) { return X0 + (y - 2508) / (2531 - 2508) * (X1 - X0); }
    S("line", { x1: X0, y1: AY, x2: X1, y2: AY, class: "axis" }, g2);
    var marks = [[2510, "เริ่มสัญญาชดใช้ทุน"], [2515, "บังคับทุกคน"], [2519, "ขยาย รพ.ชนบท"], [2528, ""]];
    marks.forEach(function (m) { S("line", { x1: xOf(m[0]), y1: AY - 6, x2: xOf(m[0]), y2: AY + 6, class: "axis" }, g2); txt(g2, xOf(m[0]), AY + 28, String(m[0]), 13, "mono t-muted", "middle"); if (m[1]) txt(g2, xOf(m[0]), AY - 18, m[1], 13.5, "t-muted", "middle"); });
    var band = S("rect", { x: xOf(2519), y: AY - 4, width: 0, height: 8, rx: 3, style: "fill:var(--p1)" }, g2);
    var facts = S("g", { style: "opacity:0" }, g2);
    txt(facts, 0, 432, "รพ.ชนบท " + F("lit.rural_hosp_start") + " → " + F("lit.rural_hosp_end") + " แห่ง", 16, "t-strong");
    txt(facts, 212, 432, "แพทย์ชนบท " + F("lit.rural_md_start") + " → " + F("lit.rural_md_end") + " คน", 16, "t-strong");
    txt(facts, 640, 432, "อีสาน/กทม. " + F("lit.gap_1979") + " เท่า → " + F("lit.gap_1986") + " เท่า", 16, "t-need", "end");
    // conditions: three arrows into quadrant four, in the text column under the click-3 paragraph
    var side = U.sideHost(host, "0 0 640 262", "เงื่อนไขของข้อเสนอเปลี่ยนระบบ: งานจากช่องที่หนึ่งถึงสามส่งไปยังช่องที่สี่");
    side.closest(".fig-side").setAttribute("data-step", "3");
    var g3 = S("g", {}, side);
    txt(g3, 0, 24, "เงื่อนไขของข้อเสนอเปลี่ยนระบบ", 18.5, "t-accent");
    var mq = quad(g3, { x: 0, y: 46, w: 300, h: 214, labels: false, numSize: 20, gap: 6, rowLabel: false, colLabel: false });
    var q4 = mq.rect(3);
    var ends = [[q4.x + 3, q4.y + 3], [q4.x + q4.w * 0.5, q4.y + 3], [q4.x + 3, q4.y + q4.h * 0.5]];
    var n4 = mq.tiles[3].querySelector("text");                   // the 4 moves to the corner the arrows do not use
    n4.setAttribute("x", q4.x + q4.w - 10); n4.setAttribute("y", q4.y + q4.h - 10); n4.setAttribute("text-anchor", "end");
    // the paragraph above names the three conditions; the map shows them arriving in box 4 from boxes 1-3
    [0, 1, 2].forEach(function (from, i) {
      var ci = mq.center(from), e = ends[i], ang = Math.atan2(e[1] - ci[1], e[0] - ci[0]);
      S("path", { d: "M" + ci[0] + "," + ci[1] + " L" + e[0] + "," + e[1], style: "fill:none;stroke:var(--accent);stroke-width:2" }, g3);
      var hx = e[0] - 10 * Math.cos(ang), hy = e[1] - 10 * Math.sin(ang), px = 5.5 * Math.sin(ang), py = -5.5 * Math.cos(ang);
      S("path", { d: "M" + e[0] + "," + e[1] + " L" + (hx + px) + "," + (hy + py) + " L" + (hx - px) + "," + (hy - py) + "Z", style: "fill:var(--accent)" }, g3);
    });
    return stepper(host, 3, function (k, anim, jobs) {
      if (k === 1) { g2.style.opacity = 0; if (anim) { g1.style.opacity = 0; fade(g1, true, 400, jobs); } else g1.style.opacity = 1; }
      if (k === 2) {
        fade(g2, true, anim ? 350 : 0, jobs);
        jobs.add(U.tween(anim ? 1400 : 0, function (t) { band.setAttribute("width", (xOf(2528) - xOf(2519)) * t); }, { delay: 300 }));
        fade(facts, true, anim ? 400 : 0, jobs, 1500);
      }
    });
  };

  /* ---------------- s07 six research programmes ---------------- */
  // Wide layout: three cards a row, so each click (programmes 1-3, then 4-6) fills one row at the body size.
  // Titles are broken by hand at their phrase boundary; the level tag is neutral (its words say the level).
  FIGS.s07 = function (host) {
    var progs = [
      ["บริการสุขภาพในพื้นที่<br>หลังถ่ายโอนให้ท้องถิ่น", "ชุมชน", "ใครกำกับ ใครจัดงบ<br>ให้ทีมปฐมภูมิทำงานต่อและก้าวหน้าได้แม้เปลี่ยนนายจ้าง", "รพ.สต. ที่สำรวจ <b>" + F("c77_units_P_local") + "</b> จาก <b>" + F("c77_units_P") + "</b> แห่ง ถ่ายโอนให้ท้องถิ่นแล้ว"],
      ["รับคนจากพื้นที่<br>เชื่อมการฝึกกับงานและความก้าวหน้า", "ชุมชนและเศรษฐกิจ", "การรับคนในพื้นที่ ฝึกในภูมิภาค และมีทางก้าวหน้า ช่วยให้คนทำงานในพื้นที่ต่อได้เพียงใด", "ทำงานในจังหวัดภูมิลำเนา สัมพันธ์กับการคิดย้ายออกจากพื้นที่น้อยลง (อัตราส่วนออดส์ <b>" + F("c77_or_leave_areaB_home_province_match") + "</b>) แต่ไม่พบความสัมพันธ์ชัดเจนกับการคิดลาออกจากสังกัด"],
      ["ผู้จ้างและตำแหน่ง<br>ที่รองรับบริการที่ประชาชนควรได้รับ", "เศรษฐกิจและรัฐ", "ผู้จ้างและผู้จ่ายแบบใดช่วยกระจายคน ใครรับต้นทุน และคนทำงานมั่นคงเพียงใด", "ผลจำลองความเพียงพอ: รพ.จ่ายเอง <b>" + F("c5f_PR_GDh5_bq_P|pct") + "%</b>;<br>ส่วนกลางจ่ายและจัดตามความจำเป็น <b>" + F("c5f_PR_GDc5_bq_P|pct") + "%</b><br><span class=\"nx-src\">ร้อยละของเป้าหมายตัวอย่าง " + F("lit.target_ratio") + " ประชากร</span>"],
      ["ความรับผิดชอบของเอกชน<br>และแพทย์ที่ทำงานทั้งรัฐและเอกชน", "เศรษฐกิจ", "การจ่ายเงินและเงื่อนไขอนุญาตช่วยให้เอกชนร่วมดูแลพื้นที่ขาดบริการได้หรือไม่", "แพทย์เฉพาะทางทุกสังกัด <b>" + F("c46_conc_top10_all1") + "%</b> อยู่ในสถานพยาบาลกลุ่มที่มีมากที่สุดหนึ่งในสิบ"],
      ["การจัดงานดูแล<br>และสนับสนุนผู้ดูแล", "สังคมและเศรษฐกิจ", "การจ้างผู้ดูแลในชุมชน คนช่วยดูแลแทนชั่วคราว และบริการระยะยาว ลดภาระให้ใคร อย่างไร", "ผู้ตอบแบบสำรวจ\u00a0<b>" + F("c77_pct_primary_carer") + "%</b> เป็นผู้ดูแลหลักในครอบครัว"],
      ["ร่วมตัดสินว่าคนพอหรือไม่<br>และจะจัดสรรอย่างไร", "สังคม", "การให้ผู้เกี่ยวข้องใช้แบบจำลองร่วมกัน ช่วยเลือกเกณฑ์และยอมรับผลได้อย่างไร", "ผลจำลอง: ใช้ประชากรหรือปริมาณบริการ<br>แพทย์ใหม่สะสมสิบห้าปีในปทุมธานีต่าง <b>" + F("c54_maxcum_PR_vs_SR") + "</b> คน"]
    ];
    var grid = H("div", "nx-grid nx-progs", null, host);
    grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    var cards = progs.map(function (p, i) {
      var c = H("div", "nx-card hud-panel", null, grid);
      H("div", "nx-head", '<span class="nx-num">' + (i + 1) + "</span><h4>" + p[0] + "</h4>", c);
      H("span", "nx-tag", p[1], c);
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
    // Two rows: the lead sits beside the five gates, and the body (clicks 2-3) starts level with the
    // mixed-scanning half, under a rule level with the figure's divider (deck style #slide-8 .nx-row2: placed
    // from the top of the text column, so it stays level however many lines the lead takes).
    var body = host.closest(".slide").querySelector(".slide__text .body");
    if (body) { body.classList.add("nx-row2"); body.setAttribute("data-step", "2"); }
    var svg = U.svgHost(host, "0 0 640 556", "คำถามห้าข้อ และกล้องสองตัวของ Etzioni: กล้องมุมกว้างกับกล้องซูม"); U.defs(svg);
    // click 1: the proposal passes five gates on one track (Wright's three, then this study's two)
    var g1 = S("g", {}, svg);
    txt(g1, 0, 18, "คำถามห้าข้อที่ข้อเสนอเปลี่ยนระบบต้องตอบ", 14, "t-muted");
    S("line", { x1: 0, y1: 109, x2: 636, y2: 109, style: "stroke:var(--line-strong);stroke-width:1.2;stroke-dasharray:2 6" }, g1);
    var gates = [["ควรทำ", "หรือไม่", "wright"], ["ทำงานได้", "และยั่งยืนหรือไม่", "wright"], ["จะเริ่มได้อย่างไร", "ใครร่วมผลักดัน", "wright"], ["ใครรับต้นทุน", "และความเสี่ยง", "plus"], ["จะเรียนรู้ ปรับ", "หรือย้อนกลับได้หรือไม่", "plus"]].map(function (gt, i) {
      var x = 100 + i * 104, lx = x + (i === 4 ? 8 : 0), g = S("g", {}, g1);   // label 5 a little right of its bar, clear of label 4
      var bar = S("rect", { x: x - 3, y: 44, width: 6, height: 130, rx: 3, style: "fill:" + (gt[2] === "wright" ? "var(--line-strong)" : "var(--p2-soft)") }, g);
      txt(g, lx, 196, gt[0], 12.5, "t-strong", "middle"); if (gt[1]) txt(g, lx, 214, gt[1], 12.5, "t-strong", "middle");
      return { x: x, bar: bar, kind: gt[2] };
    });
    function bracket(x0, x1, label) {   // a thin bracket under a group of gates, the label centred on it
      S("path", { d: "M" + x0 + ",224 V230 H" + x1 + " V224", style: "fill:none;stroke:var(--muted);stroke-width:1.2" }, g1);
      txt(g1, (x0 + x1) / 2, 248, label, 12.5, "t-muted", "middle");
    }
    bracket(gates[0].x - 40, gates[2].x + 40, "Wright");
    bracket(gates[3].x - 46, gates[4].x + 46, "คณะผู้เขียนเพิ่ม");
    var card = S("g", {}, g1);
    S("rect", { x: 0, y: 92, width: 96, height: 34, rx: 6, style: "fill:var(--accent-soft);stroke:var(--accent)" }, card);
    txt(card, 48, 114, "ข้อเสนอ", 13, "t-accent", "middle");
    function moveCard(t) {
      var x = -10 + t * 548; card.setAttribute("transform", "translate(" + x + ",0)");
      gates.forEach(function (gt) { var lit = x + 48 >= gt.x; gt.bar.setAttribute("style", "fill:" + (lit ? (gt.kind === "wright" ? "var(--accent)" : "var(--p2)") : (gt.kind === "wright" ? "var(--line-strong)" : "var(--p2-soft)"))); });
    }
    // Mixed scanning as Etzioni (1967) pictures it: two cameras. Click 2: the wide-angle camera sees every
    // basic option coarsely, every five years, and one direction is chosen. Click 3: the zoom camera follows
    // that direction year by year; at every checkpoint the criteria announced in advance decide whether to
    // expand, adjust or stop; after five years the wide scan comes round again.
    var g2 = S("g", { style: "opacity:0" }, svg);
    S("line", { x1: 0, y1: 266, x2: 640, y2: 266, style: "stroke:var(--line)" }, g2);
    txt(g2, 0, 294, "Etzioni · กล้องสองตัวทำงานคู่กัน", 14, "t-muted");
    var wide = S("g", {}, g2);
    txt(wide, 0, 326, "กล้องมุมกว้าง", 14, "t-accent");
    txt(wide, 0, 346, "พิจารณาทางเลือกสำคัญทุกห้าปี", 12.5, "t-strong");
    txt(wide, 0, 364, "เห็นทางเลือกหกทาง แล้วเลือกหนึ่งทาง", 12, "t-muted");
    var A = [134, 530], R = 120, a0 = 220, a1 = 320, CHOSEN = 5;
    function pt(deg, r) { var t = deg * Math.PI / 180; return [A[0] + r * Math.cos(t), A[1] + r * Math.sin(t)]; }
    function angOf(i) { return a0 + i * (a1 - a0) / 5; }
    var fan = S("path", { d: "", style: "fill:var(--accent-soft);stroke:var(--accent);stroke-width:1;stroke-opacity:.55" }, wide);
    function fanTo(deg) {
      var r = R + 22, p0 = pt(a0 - 8, r), p1 = pt(Math.max(a0 - 7, deg), r);
      fan.setAttribute("d", "M" + A + " L" + p0 + " A" + r + "," + r + " 0 0 1 " + p1 + " Z");
    }
    var dots = [0, 1, 2, 3, 4, 5].map(function (i) { var p = pt(angOf(i), R); return S("circle", { cx: p[0], cy: p[1], r: 7, style: "fill:var(--p1)" }, wide); });
    var cp = pt(angOf(CHOSEN), R);
    var ring = S("circle", { cx: cp[0], cy: cp[1], r: 12, style: "fill:none;stroke:var(--accent);stroke-width:2" }, wide);
    // the camera: a body, a lens and the word, so the return arrow has a target
    S("rect", { x: A[0] - 22, y: A[1] - 13, width: 44, height: 26, rx: 5, style: "fill:var(--card-strong);stroke:var(--accent);stroke-width:1.2" }, wide);
    S("circle", { cx: A[0], cy: A[1], r: 8, style: "fill:none;stroke:var(--accent);stroke-width:1.6" }, wide);
    S("rect", { x: A[0] - 9, y: A[1] - 18, width: 12, height: 5, rx: 1.5, style: "fill:var(--accent)" }, wide);
    // click 3: the zoom camera on the chosen direction, five yearly legs with a checkpoint at the end of each
    var B = { x: 300, y: 330, w: 316, h: 156 };
    var zoomHead = txt(g2, B.x, 322, "กล้องซูม · ติดตามแนวทางที่เลือกทุกปี", 14, "t-accent");
    var zoom = S("g", {}, g2);
    S("path", { d: "M" + cp + " L" + B.x + "," + (B.y + 6) + " M" + cp + " L" + B.x + "," + (B.y + B.h - 6), style: "fill:none;stroke:var(--accent);stroke-width:1;stroke-dasharray:3 4" }, zoom);
    S("rect", { x: B.x, y: B.y, width: B.w, height: B.h, rx: 8, style: "fill:var(--card-strong);stroke:var(--accent);stroke-width:1.2" }, zoom);
    var py = B.y + 58, x0 = B.x + 18, step = 56;
    var legs = [0, 1, 2, 3, 4].map(function (k) {
      var a = x0 + k * step, b = a + step;
      var seg = S("line", { x1: a, y1: py, x2: b - 9, y2: py, style: "stroke:var(--p1);stroke-width:2.5;stroke-linecap:round" }, zoom);
      var lab = txt(zoom, a + step / 2 - 4, py - 16, "ปี " + (k + 1), 12, "t-muted", "middle");
      var m = S("path", { d: "M" + b + "," + (py - 9) + " L" + (b + 9) + "," + py + " L" + b + "," + (py + 9) + " L" + (b - 9) + "," + py + "Z", style: "fill:var(--card);stroke:var(--accent);stroke-width:1.5" }, zoom);
      return { seg: seg, lab: lab, mark: m, x1: a, x2: b - 9 };
    });
    // the rule at every checkpoint, said once: the same three outcomes, decided by criteria set in advance
    var rule = S("g", {}, zoom);
    txt(rule, x0, py + 38, "ทบทวนผลทุกปี ◇ ตามเกณฑ์ที่ประกาศก่อนเริ่ม", 12.5, "t-strong");
    [["ขยาย", "t-good"], ["ปรับ", "t-need"], ["หยุด", "t-bad"]].forEach(function (o, i) {
      txt(rule, x0 + 2 + i * 82, py + 70, o[0], 15, o[1]);
      if (i) txt(rule, x0 + 2 + i * 82 - 22, py + 70, "·", 15, "t-muted", "middle");
    });
    // back to the wide scan from the end of year five
    var end = [x0 + 5 * step + 9, py];
    var loopG = S("g", {}, g2);
    S("path", { d: "M" + end + " H" + (B.x + B.w + 14) + " V" + A[1] + " H" + (A[0] + 34), style: "fill:none;stroke:var(--muted);stroke-width:1.5;stroke-dasharray:4 4" }, loopG);
    S("path", { d: "M" + (A[0] + 24) + "," + A[1] + " L" + (A[0] + 35) + "," + (A[1] - 5) + " L" + (A[0] + 35) + "," + (A[1] + 5) + "Z", style: "fill:var(--muted)" }, loopG);
    txt(loopG, A[0] + 190, A[1] - 9, "ครบห้าปี ทบทวนทางเลือกใหญ่อีกครั้ง", 12.5, "t-muted", "middle");
    var wideParts = [fan, ring].concat(dots), zoomParts = [zoomHead, zoom, rule, loopG].concat(legs.map(function (l) { return l.mark; })).concat(legs.map(function (l) { return l.lab; }));
    function settleWide() { fanTo(a1 + 8); wideParts.forEach(function (p) { p.style.opacity = 1; }); dots[CHOSEN].style.fill = "var(--accent)"; }
    function settleZoom(on) { zoomParts.forEach(function (p) { p.style.opacity = on ? 1 : 0; }); legs.forEach(function (l) { l.seg.setAttribute("x2", on ? l.x2 : l.x1); }); }
    settleWide(); settleZoom(true);
    return stepper(host, 3, function (k, anim, jobs) {
      if (k === 1) {
        g2.style.opacity = 0;
        if (!anim) { moveCard(1); return; }
        moveCard(0);
        jobs.add(U.tween(3600, moveCard, { ease: U.ease.inOut, delay: 400 }));
      }
      if (k === 2) {
        settleZoom(false);
        if (!anim) { settleWide(); g2.style.opacity = 1; return; }
        // the wide camera sweeps every basic option, then one direction is chosen
        wideParts.forEach(function (p) { p.style.opacity = 0; });
        dots.forEach(function (d) { d.style.opacity = 0.25; d.style.fill = "var(--p1)"; });
        fanTo(a0 - 8); fan.style.opacity = 1;
        fade(g2, true, 400, jobs);
        jobs.add(U.tween(2400, function (t) {
          var deg = a0 - 8 + t * (a1 - a0 + 16); fanTo(deg);
          dots.forEach(function (d, i) { if (angOf(i) <= deg) d.style.opacity = 1; });
        }, { ease: U.ease.inOut, delay: 500 }));
        later(jobs, 3300, function () { dots[CHOSEN].style.fill = "var(--accent)"; });
        fade(ring, true, 400, jobs, 3300);
      }
      if (k === 3) {
        if (!anim) { settleZoom(true); return; }
        // the zoom opens on that direction, year by year, then the cycle returns to the wide scan
        fade(zoomHead, true, 400, jobs, 100);
        fade(zoom, true, 600, jobs, 100);
        legs.forEach(function (l, i) {
          var t0 = 900 + i * 700;
          jobs.add(U.tween(450, function (t) { l.seg.setAttribute("x2", l.x1 + (l.x2 - l.x1) * t); }, { delay: t0 }));
          fade(l.lab, true, 300, jobs, t0);
          fade(l.mark, true, 300, jobs, t0 + 400);
        });
        fade(rule, true, 500, jobs, 4600);
        fade(loopG, true, 700, jobs, 5600);
      }
    });
  };

  /* ---------------- s09 the immediate agenda in three quadrants ---------------- */
  FIGS.s09 = function (host) {
    // One grid, so a row is as tall as its tallest card in all three columns. Header colours follow the s05 map
    // (boxes 1 and 3 blue, box 2 purple); gold stays for box 4, the hand-off strip.
    var cols = [
      ["ช่องที่ 1", "วิเคราะห์ปัญหาภายในกติกาเดิม", "var(--p1-text)", ["ตรวจยอดแพทย์กับข้อมูลเข้าออก", "เชื่อมข้อมูลรายคนโดยไม่เปิดเผยตัวตน", "วัดเวลาทำงานจริง: ผู้ตอบ\u00a0<b>" + F("c77_early_retire_all") + "%</b> คิดเกษียณก่อนหรือลดเวลางาน", "ติดตามผู้ที่ออกแล้ว"]],
      ["ช่องที่ 2", "วิเคราะห์ปัญหาเชิงโครงสร้าง", "var(--p2-text)", ["ใครกำหนดตำแหน่ง ด้วยเหตุผลใด", "ใครนับว่าขาด เพื่อขอทรัพยากรอะไร", "งานเอกชนและงานดูแลมีผลต่อการย้ายหรือไม่ อย่างไร"]],
      ["ช่องที่ 3", "ข้อเสนอภายในกติกาเดิม", "var(--p1-text)", ["เปรียบเทียบหลายเกณฑ์จัดสรร", "เพิ่มตำแหน่งตามความจำเป็น", "ส่งแพทย์ตามตำแหน่งว่างจริง", "กำหนดกลุ่ม เวลา และผลที่จะวัดก่อนเริ่ม"]]
    ];
    var grid = H("div", "nx-grid nx-agenda", null, host);
    grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    var lis = [];
    cols.forEach(function (c, ci) {
      var h = H("h5", "", c[0] + "<br>" + c[1], grid);
      h.style.color = c[2]; h.style.gridColumn = String(ci + 1); h.style.gridRow = "1";
    });
    cols.forEach(function (c, ci) {
      c[3].forEach(function (t, ri) {
        var li = H("div", "nx-item", t, grid);
        li.style.gridColumn = String(ci + 1); li.style.gridRow = String(ri + 2);
        lis.push(li);
      });
    });
    var hand = H("div", "nx-card hud-panel nx-hand", '<div class="nx-head"><span class="nx-num">4</span><h4>ใช้หลักฐานจากทั้งสามช่องประเมินข้อเสนอเปลี่ยนกติกา</h4></div>', grid);
    hand.style.gridColumn = "1 / -1"; hand.style.gridRow = "6"; hand.style.borderColor = "var(--accent)";
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
    wrap.style.gridTemplateColumns = "minmax(0, 1.05fr) minmax(0, 2fr)";
    wrap.style.alignItems = "start";
    var left = H("div", "", null, wrap);
    var svgWrap = H("div", "fig__svg", null, left);
    var svg = S("svg", { viewBox: "0 0 430 410", role: "img", "aria-label": "งานสี่แบบของ Burawoy เทียบกับสี่ช่องโดยประมาณ และการใช้งานวิจัยของ Weiss" });
    svgWrap.appendChild(svg); U.defs(svg);
    var q = quad(svg, { x: 0, y: 0, w: 430, h: 330, labels: false, numSize: 20, fs: 14, lw: 122 });
    var bur = ["งานวิชาชีพ", "งานวิพากษ์", "งานนโยบาย", "งานสาธารณะ"];
    var what = [["สร้างความรู้ในสาขา"], ["ตั้งคำถาม", "ต่อสิ่งที่เชื่อ"], ["เสนอวิธีแก้ปัญหา"], ["เรียนรู้", "ร่วมกับผู้เกี่ยวข้อง"]];
    var labs = [0, 1, 2, 3].map(function (i) {
      var r = q.rect(i), g = S("g", { style: "opacity:0" }, svg);
      txt(g, r.x + 12, r.y + r.h / 2 + 6, bur[i], 17, i === 3 ? "t-accent" : "t-strong");
      what[i].forEach(function (s, j) { txt(g, r.x + 12, r.y + r.h - 12 - (what[i].length - 1 - j) * 20, s, 13.5, "t-muted"); });
      return g;
    });
    txt(svg, 0, 366, "Burawoy · งานสี่แบบ เทียบกับสี่ช่องโดยประมาณ", 13.5, "t-muted");
    txt(svg, 0, 392, "Weiss · ใช้งานวิจัยแก้ปัญหาเฉพาะหน้า และใช้ทำความเข้าใจปัญหาใหม่", 13.5, "t-muted");
    var right = H("div", "", null, wrap);
    var rows = [
      ["ผู้วิเคราะห์และผู้ดูแลข้อมูล", "ตัวเลขที่บอกว่านับใคร<br>เทียบอะไร<br>และยังไม่แน่ใจเรื่องใด", "คิดว่าข้อมูลที่หน่วยงานเก็บครอบคลุมปัญหาทั้งหมด", "บอกขอบเขต<br>ตรวจยอดกับข้อมูลเข้าออก<br>รายงานส่วนที่ยังอธิบายไม่ได้"],
      ["ผู้วิพากษ์", "ชี้ว่ากติกาจำกัดใคร เอื้อใคร และให้ใครรับภาระ", "อธิบายอย่างเดียว ยังไม่ตรวจด้วยหลักฐาน", "บอกว่าใครทำอะไร เกิดผลอย่างไร ยอมปรับคำอธิบายเมื่อหลักฐานไม่สนับสนุน"],
      ["ที่ปรึกษานโยบาย", "ทางเลือกที่ใช้ได้รอบหน้า พร้อมผลดีและภาระที่ต้องแลก", "ตอบตามโจทย์ผู้ว่าจ้าง<br>จนมองข้ามปัญหาของคนอื่น", "แยกผลจริง ผลจำลอง และข้อเสนอ<br>กำหนดเกณฑ์ก่อนเริ่ม<br>รายงานผลไม่ผ่านและแหล่งทุน"],
      ["ผู้ร่วมพัฒนาทางเลือกกับประชาชน", "ทางเลือกระยะยาวที่ประเมินได้ด้วยเกณฑ์เปิดเผย", "พูดแทนผู้อื่น<br>หรือทำให้ความเชื่อตน<br>ดูเหมือนข้อสรุปวิชาการ", "ตอบคำถามห้าข้อ ร่วมงานกับผู้ทำงาน <span style=\"white-space:nowrap\">ผู้ดูแล</span> ชุมชน และบันทึกความเห็นต่าง"]
    ];
    var table = H("table", "nx-table nx-roles", '<colgroup><col style="width:21%"><col style="width:24%"><col style="width:25%"><col style="width:30%"></colgroup><thead><tr><th>บทบาท</th><th>ช่วยเรื่องใด</th><th>สิ่งที่ต้องระวัง</th><th>สิ่งที่ควรทำ</th></tr></thead>', right);
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
    var wrap = H("div", "nx-grid nx-near", null, host);
    wrap.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    wrap.style.alignItems = "stretch";
    var a = H("div", "nx-card hud-panel", null, wrap);
    a.innerHTML = '<div class="nx-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:calc(var(--u)*1.2)">' +
      '<div><h4>Harris · เครือข่ายข้าราชการนักปฏิรูป</h4><p>ช่วยรวบรวมกำลังและทรัพยากร จนผลักดันหลักประกันสุขภาพถ้วนหน้าได้</p></div>' +
      '<div><h4>Selway · กติกาการเลือกตั้งและพรรค</h4><p>ขบวนการวิชาชีพสำคัญ<br>แต่ให้น้ำหนักกับกติกาการเลือกตั้ง<br>และพรรคการเมืองมากกว่า</p></div></div>' +
      '<p class="nx-label">สิ่งที่ต้องระวังเมื่อทำงานใกล้กัน</p>' +
      '<div class="nx-col"><ul><li>โจทย์วิจัยจำกัดอยู่แค่อำนาจของหน่วยงาน</li><li>คนในเครือข่ายตรวจสอบกันเอง</li><li>คนนอกไม่มีช่องทางโต้แย้งเกณฑ์</li></ul></div>';
    var b = H("div", "nx-card hud-panel", null, wrap);
    // the four A4R conditions are a plain list, the study's actions are checked rows: they are not paired one to one
    b.innerHTML = '<div class="nx-grid" style="grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:calc(var(--u)*1.4)">' +
      '<div><h4>ความรับผิดชอบต่อความสมเหตุสมผล (A4R)</h4><ul class="nx-plain"><li><b>เปิดเผย</b>เหตุผล</li><li>ใช้เหตุผลที่<b>เกี่ยวข้อง</b>และรับฟังกันได้</li><li>มี<b>ช่องทางคัดค้าน</b>และทบทวน</li><li>มี<b>ผู้กำกับ</b>ให้ทำตามหลัก</li></ul></div>' +
      '<div><h4>สิ่งที่การศึกษาครั้งนี้ทำแล้ว</h4><div class="nx-col nx-check"><ul><li>ประกาศเกณฑ์ก่อนคำนวณและรายงานผลไม่ผ่าน</li><li>กำหนดผลหลักของการสำรวจก่อนวิเคราะห์</li><li>ปรับข้อเสนอเรื่องภาระงานเมื่อข้อมูลไม่สนับสนุน</li><li>เปิดรหัสโปรแกรมและเครื่องมือให้ตรวจ</li><li>แยกข้อมูลรายคนออกจากผลเผยแพร่</li></ul></div></div></div>';
    return stepper(host, 2, function (k, anim, jobs) {
      if (k === 1) { b.style.opacity = 0; if (anim) { a.style.opacity = 0; later(jobs, 80, function () { a.style.opacity = 1; }); } else a.style.opacity = 1; }
      if (k === 2) { if (!anim) b.style.opacity = 1; else later(jobs, 80, function () { b.style.opacity = 1; }); }
    });
  };

  /* ---------------- s12 polycentric learning network (Ostrom) ---------------- */
  FIGS.s12 = function (host) {
    var svg = U.svgHost(host, "0 0 640 520", "เครือข่ายที่พื้นที่และส่วนกลางร่วมเรียนรู้ (Ostrom)"); U.defs(svg);
    var C = [320, 262], R1 = 170, R2 = 236;
    var under = S("g", {}, svg);
    var locals = [];
    var pAng = [0, 1, 2, 3, 4].map(function (i) { return -Math.PI / 2 + i * 2 * Math.PI / 5; });
    for (var i = 0; i < 14; i++) {
      var a = i * 2 * Math.PI / 14 + 0.2, x = C[0] + R2 * Math.cos(a), y = C[1] + R2 * Math.sin(a) * 0.9;
      if (pAng.some(function (pa) { var d = Math.abs(((a - pa) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); return d < 0.3; })) continue;
      var rim = [C[0] + (x - C[0]) * 70 / Math.hypot(x - C[0], y - C[1]), C[1] + (y - C[1]) * 70 / Math.hypot(x - C[0], y - C[1])];
      S("line", { x1: rim[0], y1: rim[1], x2: x, y2: y, style: "stroke:var(--line);stroke-dasharray:2 6" }, under);
      locals.push({ x: x, y: y, rim: rim, el: S("circle", { cx: x, cy: y, r: 6, style: "fill:var(--p1)" }, svg) });
    }
    var partners = [["สธ."], ["สถาบันพระบรมราชชนก", "และ สพพ."], ["สถาบันวิจัย/นักวิจัย"], ["กรรมาธิการ", "การสาธารณสุข"], ["สวรส."]];
    partners.forEach(function (p, i) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / partners.length, x = C[0] + R1 * Math.cos(ang), y = C[1] + R1 * Math.sin(ang) * 0.82;
      var k70 = 70 / Math.hypot(x - C[0], y - C[1]);
      S("line", { x1: C[0] + (x - C[0]) * k70, y1: C[1] + (y - C[1]) * k70, x2: x, y2: y, style: "stroke:var(--line-strong);stroke-width:1.2" }, under);
      var g = S("g", {}, svg);
      S("circle", { cx: x, cy: y, r: 13, style: "fill:var(--p2);stroke:var(--bg);stroke-width:2" }, g);
      var right = x >= C[0] - 1, dy = p.length > 1 ? -4 : 5;
      p.forEach(function (line, j) { txt(g, x + (right ? 20 : -20), y + dy + j * 18, line, 13.5, "t-strong", right ? "start" : "end"); });
    });
    var hubG = S("g", {}, svg);
    S("circle", { cx: C[0], cy: C[1], r: 66, style: "fill:var(--card-strong);stroke:var(--accent);stroke-width:1.6", class: "glow" }, hubG);
    S("circle", { cx: C[0], cy: C[1], r: 66, style: "fill:var(--accent-soft)" }, hubG);
    txt(hubG, C[0], C[1] - 6, "เวทีทบทวน", 15, "t-strong", "middle");
    txt(hubG, C[0], C[1] + 16, "กติกาของประเทศ", 13, "t-accent", "middle");
    txt(svg, 0, 514, "จุดฟ้า: นักวิเคราะห์ในเขตและจังหวัด · จุดทอง: ผลจากพื้นที่ที่ส่งกลับสู่เวทีทบทวน (Ostrom)", 12, "t-muted");
    var pulses = locals.map(function (l, i) { return { l: l, o: i / locals.length, el: S("circle", { r: 3, style: "fill:var(--accent)" }, under) }; });
    U.loop(svg, function (dt, ts) {
      pulses.forEach(function (p) {
        p.o = (p.o + dt / 3200) % 1;
        p.el.setAttribute("cx", p.l.x + (p.l.rim[0] - p.l.x) * p.o); p.el.setAttribute("cy", p.l.y + (p.l.rim[1] - p.l.y) * p.o);
        p.el.style.opacity = Math.sin(p.o * Math.PI);
      });
      locals.forEach(function (l, i) { l.el.style.opacity = 0.5 + 0.5 * Math.abs(Math.sin(ts / 700 + i)); });
    });
    // static views (print, Read): one gold dot half-way along each spoke, so the caption's "จุดทอง" is on the page
    if (U.isStatic()) pulses.forEach(function (p) { p.el.setAttribute("cx", (p.l.x + p.l.rim[0]) / 2); p.el.setAttribute("cy", (p.l.y + p.l.rim[1]) / 2); p.el.style.opacity = 1; });
    return { steps: 1, setStep: function () {} };
  };

  /* ---------------- s13 closing: quadrant four, lit ---------------- */
  FIGS.s13 = function (host) {
    var wrap = H("div", "fig__svg", null, host);
    wrap.style.perspective = "1300px";
    var svg = S("svg", { viewBox: "-60 -60 640 640", role: "img", "aria-label": "ช่องที่สี่ของกรอบความรู้" });
    svg.style.transform = "rotateX(14deg) rotateY(12deg)"; svg.style.transformOrigin = "50% 50%";
    wrap.appendChild(svg); U.defs(svg);
    var ring = S("g", { transform: "translate(260,280)" }, svg);    // behind the boxes, as on s01
    [300].forEach(function (r) { S("circle", { r: r, style: "fill:none;stroke:var(--line-strong);stroke-width:1;stroke-dasharray:60 18" }, ring); });
    var q = quad(svg, { x: 0, y: 60, w: 520, h: 420, labels: false, numSize: 54, gap: 14, fs: 17, lw: 152, top: 34, base: true, halo: true });
    q.tiles.slice(0, 3).forEach(function (t) { t.style.opacity = 0.45; });
    var q4 = q.tiles[3].querySelector("rect");
    var a = 0;
    U.loop(svg, function (dt, ts) { a = (a + dt * 0.004) % 360; ring.setAttribute("transform", "translate(260,280) rotate(" + a + ")"); q4.style.strokeOpacity = 0.55 + 0.45 * Math.abs(Math.sin(ts / 900)); });
    return { steps: 1, setStep: function () {} };
  };

  window.FIGS = FIGS;
})();
