// One interactive figure on the Read page: controls in a row above the chart,
// the legend above the plot (never on it), the chart, an optional explanation,
// a table view, and PNG/SVG/CSV downloads. The figure's definition comes from
// figures.js (charts) or diagrams.js (diagrams); its data is the figure's CSV.

import { h, s, clear } from "../util/dom.js";
import { loadCSV, loadJSON, legendHTML, tableView, composeSVG, svgToPNG, download, hideTip, defs as svgDefs } from "./viz.js";
import { CHARTS } from "./figures.js";
import { DIAGRAMS } from "./diagrams.js";

const ICON_DL = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_TABLE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

export function definition(fig) {
  return fig.kind === "diagram" ? DIAGRAMS[fig.id] : CHARTS[fig.id];
}

async function loadData(fig, def, content) {
  const D = {};
  const byId = new Map();
  for (const ch of [...content.chapters, content.closing]) for (const f of ch.figures || []) byId.set(f.id, f);
  const jobs = [];
  if (fig.files?.csv) jobs.push(loadCSV(fig.files.csv.href).then((r) => { D.main = r; }));
  for (const [k, m] of Object.entries(fig.extra || {})) jobs.push(loadCSV(m.href).then((r) => { D[k] = r; }));
  for (const need of def.needs || []) {
    if (need === "geo") jobs.push(loadJSON(content.geo).then((g) => { D.geo = g; }));
    else if (byId.get(need)?.files?.csv) jobs.push(loadCSV(byId.get(need).files.csv.href).then((r) => { D[need] = r; }));
  }
  await Promise.all(jobs);
  return D;
}

// Mount a figure into `host`. Returns {ready, exportFile(kind), toggleTable(), destroy()}.
export function mountFigure(host, fig, content, { compact = false, state: initState = null } = {}) {
  const def = definition(fig);
  const ctx = { fig, content, labels: content.labels || {}, diagrams: content.diagrams || {}, text: fig.chart_text || {} };
  const root = h("div", { class: `rv${compact ? " rv--compact" : ""}` });
  const controls = h("div", { class: "rv-controls" });
  const legendBox = h("div", { class: "rv-legend-box" });
  const scroller = h("div", { class: "rv-scroll" });
  const plot = h("div", { class: "rv-plot" });
  scroller.append(plot);
  const below = h("div", { class: "rv-below" });
  const tableBox = h("div", { class: "rv-tablebox", hidden: true });
  root.append(controls, legendBox, scroller, below, tableBox);
  clear(host).append(root);
  if (!def) {
    plot.append(h("p", { class: "rv-empty", text: "ยังไม่มีกราฟโต้ตอบสำหรับภาพนี้" }));
    return { ready: Promise.resolve(), state: {}, exportFile: async () => {}, toggleTable() {}, destroy() {} };
  }
  plot.append(h("p", { class: "rv-loading", text: "กำลังวาดกราฟ…" }));
  let D = null, state = {}, alive = true, lastW = 0;
  const hidden = new Set();

  function controlList() {
    return (def.controls ? def.controls(D, ctx) : []).filter((c) => !c.when || c.when(state, D));
  }

  function renderControls() {
    clear(controls);
    for (const c of controlList()) {
      const group = h("div", { class: "rv-seg", role: "group", "aria-label": c.label });
      if (c.label) group.append(h("span", { class: "rv-seg__label", text: c.label }));
      for (const o of c.options) {
        group.append(h("button", { type: "button", class: "rv-seg__btn", "aria-pressed": String(state[c.id] === o.v),
          onclick: () => { if (state[c.id] === o.v) return; state[c.id] = o.v; if (c.reset) hidden.clear(); update(); }, text: o.label }));
      }
      controls.append(group);
    }
    controls.hidden = !controls.childNodes.length;
  }

  function renderLegend() {
    clear(legendBox);
    const items = def.legend ? def.legend(state, D, { ...ctx, hidden }) : [];
    if (items.length) legendBox.append(legendHTML(items, hidden, (k) => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); update(); }));
    legendBox.hidden = !items.length;
  }

  function renderPlot() {
    const minW = def.minWidth || 0;
    const avail = Math.floor(scroller.clientWidth || host.clientWidth || 640);
    const W = Math.max(minW, avail);
    scroller.classList.toggle("is-scrolling", W > avail + 1);
    lastW = avail;
    hideTip();
    clear(plot);
    const svg = s("svg", { class: "rv-svg", width: W, viewBox: `0 0 ${W} 10`, role: "img", "aria-label": `${fig.title} (ดูค่าทั้งหมดได้ในตาราง)` });
    plot.append(svg);
    svgDefs(svg);
    const H = def.draw(svg, W, state, D, { ...ctx, hidden }, { export: false });
    svg.setAttribute("viewBox", `0 0 ${W} ${Math.ceil(H)}`);
    svg.setAttribute("height", Math.ceil(H));
  }

  function renderBelow() {
    clear(below);
    const note = def.note ? def.note(state, D, { ...ctx, hidden }) : null;
    if (note) below.append(note instanceof Node ? note : h("p", { class: "rv-note-text", text: note }));
    if (fig.explain) below.append(h("p", { class: "rv-explain", text: fig.explain }));
    below.hidden = !below.childNodes.length;
  }

  function renderTable() {
    if (tableBox.hidden) return;
    clear(tableBox);
    const spec = def.table ? def.table(state, D, { ...ctx, hidden }) : null;
    if (spec) tableBox.append(h("div", { class: "rv-tablewrap", tabindex: 0, role: "region", "aria-label": `ตารางข้อมูล: ${fig.title}` }, tableView(spec)));
  }

  function update() {
    if (!alive || !D) return;
    renderControls();
    renderLegend();
    renderPlot();
    renderBelow();
    renderTable();
  }

  const ready = loadData(fig, def, content).then((data) => {
    if (!alive) return;
    D = data;
    for (const c of def.controls ? def.controls(D, ctx) : []) state[c.id] = c.value ?? c.options[0].v;
    if (initState) { Object.assign(state, initState.state || {}); (initState.hidden || []).forEach((k) => hidden.add(k)); }
    else (def.initialHidden || []).forEach((k) => hidden.add(k));
    update();
    if (document.fonts?.ready) document.fonts.ready.then(() => { if (alive) renderPlot(); });
  }).catch((e) => {
    console.error(e);
    if (alive) clear(plot).append(h("p", { class: "rv-empty", text: `วาดกราฟไม่สำเร็จ: ${e.message || e}` }));
  });

  const ro = new ResizeObserver(() => {
    if (!D) return;
    const w = Math.floor(scroller.clientWidth);
    if (Math.abs(w - lastW) > 2) requestAnimationFrame(() => alive && renderPlot());
  });
  ro.observe(scroller);

  async function exportFile(kind) {
    await ready;
    if (!D) return;
    const credit = content.credit || {};
    const legend = def.legend ? def.legend(state, D, { ...ctx, hidden }).filter((it) => !hidden.has(it.key)) : [];
    const width = def.exportWidth || 1000;
    const out = await composeSVG({
      width,
      legend,
      credit: { title: fig.title, project: credit.project, funder: credit.funder, data: [fig.credit, credit.url].filter(Boolean).join(" · ") },
      draw: (svg, W, env) => def.draw(svg, W, state, D, { ...ctx, hidden }, env),
    });
    const name = `${fig.id}_${credit.file_tag || "HRH-model"}`;
    if (kind === "svg") download(new Blob([out.svg], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
    else download(await svgToPNG(out.svg, out.width, out.height, 2), `${name}.png`);
    return out;
  }

  return {
    ready,
    get state() { return { state: { ...state }, hidden: [...hidden] }; },
    exportFile,
    exportSVGText: async () => {
      await ready;
      const credit = content.credit || {};
      const legend = def.legend ? def.legend(state, D, { ...ctx, hidden }).filter((it) => !hidden.has(it.key)) : [];
      return composeSVG({ width: def.exportWidth || 1000, legend,
        credit: { title: fig.title, project: credit.project, funder: credit.funder, data: [fig.credit, credit.url].filter(Boolean).join(" · ") },
        draw: (svg, W, env) => def.draw(svg, W, state, D, { ...ctx, hidden }, env) });
    },
    toggleTable() {
      tableBox.hidden = !tableBox.hidden;
      renderTable();
      return !tableBox.hidden;
    },
    destroy() { alive = false; ro.disconnect(); hideTip(); },
  };
}

// The action row under a figure: table view and the three downloads.
export function actions(fig, content, api) {
  const credit = content.credit || {};
  const tag = credit.file_tag || "HRH-model";
  const title = [credit.project, credit.funder].filter(Boolean).join(" ");
  const tableBtn = h("button", { type: "button", class: "rd-act", "aria-expanded": "false", html: `${ICON_TABLE} ดูตาราง` });
  tableBtn.addEventListener("click", () => { const open = api().toggleTable(); tableBtn.setAttribute("aria-expanded", String(open)); });
  const busy = async (btn, kind) => {
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = `${ICON_DL} กำลังสร้าง…`;
    try { await api().exportFile(kind); } catch (e) { console.error(e); alert(`สร้างไฟล์ไม่สำเร็จ: ${e.message || e}`); }
    finally { btn.disabled = false; btn.innerHTML = old; }
  };
  const png = h("button", { type: "button", class: "rd-act", title: `ภาพ PNG พร้อมเครดิต: ${title}`, html: `${ICON_DL} PNG` });
  png.addEventListener("click", () => busy(png, "png"));
  const svg = h("button", { type: "button", class: "rd-act", title: `ภาพ SVG พร้อมเครดิต: ${title}`, html: `${ICON_DL} SVG` });
  svg.addEventListener("click", () => busy(svg, "svg"));
  const files = h("span", { class: "rd-fig__files" }, png, svg);
  if (fig.files?.csv) files.append(h("a", { href: fig.files.csv.href, download: `${fig.id}_${tag}.csv`, title: `ข้อมูลของภาพ (CSV, UTF-8) ${title}`, html: `${ICON_DL} CSV` }));
  return h("div", { class: "rd-fig__dl" }, tableBtn, files);
}
