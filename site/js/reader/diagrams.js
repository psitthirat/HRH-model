// Diagrams drawn as SVG on the Read page: the chapter 05 stock-and-flow /
// causal-loop diagram and the book's three conceptual diagrams. Words come from
// [diagrams.*] in config/web/reader.toml (numbers there are claim tokens,
// resolved at build time); positions and shapes are here.
//
// SD conventions in the chapter 05 diagram: stocks are boxes, flows are pipes
// with a valve, clouds are sources and sinks outside the system, auxiliaries
// are plain text, every causal link carries + or − at its arrowhead, and R
// marks a reinforcing loop. The line style is the evidence status.

import { s, h } from "../util/dom.js";
import { C, paint, text, textLines, wrap, textWidth, bindTip, showTip, hideTip } from "./viz.js";

const D_W = 1000;                       // design width; the drawing is scaled to the space available
const scaleGroup = (svg, W) => {
  const k = W / D_W;
  const g = s("g", { transform: `scale(${k.toFixed(4)})` });
  svg.append(g);
  return { g, k };
};

// ================================================================ chapter 05: stock and flow with loops
const NODE = {
  S1: { x: 315, y: 372, w: 190, h: 84 }, S2: { x: 725, y: 372, w: 190, h: 84 },
  F1: { x: 130, y: 372 }, F2: { x: 520, y: 372 }, F3: { x: 905, y: 372 },
  L: { x: 300, y: 196, w: 210 }, A: { x: 360, y: 612, w: 250 }, C: { x: 700, y: 152, w: 200 }, P: { x: 905, y: 262, w: 180 },
  bond: { x: 88, y: 520, w: 150 }, posts: { x: 190, y: 660, w: 170 }, rural: { x: 112, y: 78, w: 190 },
  local: { x: 650, y: 656, w: 250 }, private: { x: 870, y: 566, w: 170 },
};
const CLOUD_L = { x: 40, y: 372 }, CLOUD_R = { x: 968, y: 372 };
// bend: offset of the quadratic control point (design units, + = left of travel)
const BEND = { "S1>A": -15, "A>F2": -15, "S1>L": 0, "L>F2": -30, "L>F1": 30, "S2>C": 0, "C>P": -45, "P>F2": 0, "P>F3": 0, "C>L": 25,
  "bond>F1": 0, "posts>F1": -20, "rural>L": -20, "local>F2": 25, "private>F2": 30 };
// loop markers: where the ring sits and whether its name goes above or below it
const LOOP_AT = { R1: { x: 398, y: 500 }, R2: { x: 232, y: 300, above: true }, R3: { x: 795, y: 262 }, R4: { x: 612, y: 262 } };
const STATUS_STYLE = {
  evidence: { width: 3.4 }, hypothesis: { width: 2.2, dash: "8 6" }, concept: { width: 2.2, dash: "1.5 6", cap: "round" }, account: { width: 1.4 },
};

const FLOW_SUB = { F2: "ผลดูดกลับ (backwash)" };
function plate(id, ctx) {
  const n = NODE[id];
  const lines = wrap(ctx.label(id), 150, 13.5, 500), sub = FLOW_SUB[id];
  const w = Math.max(...lines.map((l) => textWidth(l, 13.5, 500)), sub ? textWidth(sub, 12) : 0) + 12;
  const h = lines.length * 17 + (sub ? 17 : 0) + 6;
  return { x: n.x, y: n.y + 20 + h / 2, w, h, lines, sub };
}
function nodeBox(id, ctx) {
  const n = NODE[id];
  if (id.startsWith("F")) return { ...n, r: 13, kind: "valve", plate: plate(id, ctx) };
  if (n.h) return { ...n, kind: "stock" };
  const lines = wrap(ctx.label(id), n.w - 8, 15, ctx.kind(id) === "lever" ? 500 : 400);
  return { ...n, h: lines.length * 19 + 14, lines, kind: ctx.kind(id) };
}

// Where a line from (px, py) towards the node centre meets the node's edge.
function edge(b, px, py, pad = 4) {
  if (b.kind === "valve" && py > b.y + 16) return edge({ ...b.plate, kind: "plate" }, px, py, pad);
  const dx = px - b.x, dy = py - b.y;
  if (b.kind === "valve") { const d = Math.hypot(dx, dy) || 1; return [b.x + (dx / d) * (b.r + pad), b.y + (dy / d) * (b.r + pad)]; }
  const hw = b.w / 2 + pad, hh = b.h / 2 + pad;
  const t = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
  return [b.x + dx * t, b.y + dy * t];
}

function linkGeom(a, b, bend) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bend, cy = my + (dx / len) * bend;
  const [x0, y0] = edge(a, cx, cy, 6), [x1, y1] = edge(b, cx, cy, 8);
  const tx = x1 - cx, ty = y1 - cy, tl = Math.hypot(tx, ty) || 1;
  return { d: `M${x0.toFixed(1)},${y0.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`, x1, y1, ux: tx / tl, uy: ty / tl };
}

// The arc that carries the pull of the advantaged area back to the outflow:
// over the top, clear of the label of the advantaged area's services.
function arcP2F2(P, F2) {
  const x0 = P.x - 22, y0 = P.y - P.h / 2 - 2, x1 = F2.x + 3, y1 = F2.y - F2.r - 8;
  const c1 = [x0, 26], c2 = [488, 26];
  const d = `M${x0},${y0}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x1},${y1}`;
  const tx = x1 - c2[0], ty = y1 - c2[1], tl = Math.hypot(tx, ty);
  return { d, x1, y1, ux: tx / tl, uy: ty / tl };
}

function arrowHead(g, x, y, ux, uy, col, size = 11) {
  const px = -uy, py = ux;
  const d = `M${x},${y}L${x - ux * size + px * size * 0.48},${y - uy * size + py * size * 0.48}L${x - ux * size - px * size * 0.48},${y - uy * size - py * size * 0.48}Z`;
  const a = paint(s("path", { d, class: "cld-head" }), { fill: col });
  g.append(a);
  return a;
}

function cloud(g, x, y) {
  const d = `M${x - 22},${y + 8}a10,10 0 0 1 4,-17a12,12 0 0 1 20,-6a11,11 0 0 1 18,6a9,9 0 0 1 2,17z`;
  g.append(paint(s("path", { d, class: "cld-cloud" }), { fill: C.surface, stroke: C.muted, width: 1.6 }));
}

function pipe(g, x0, x1, y, dir) {
  const grp = s("g", { class: "cld-pipe" });
  grp.append(paint(s("rect", { x: Math.min(x0, x1), y: y - 6, width: Math.abs(x1 - x0), height: 12 }), { fill: C.surface }));
  for (const yy of [y - 6, y + 6]) grp.append(paint(s("line", { x1: x0, x2: x1, y1: yy, y2: yy }), { stroke: C.ink2, width: 2 }));
  const tip = x1, back = x1 - dir * 16;
  grp.append(paint(s("path", { d: `M${tip},${y}L${back},${y - 13}L${back},${y + 13}Z` }), { fill: C.ink2 }));
  g.append(grp);
}

function valve(g, b) {
  const grp = s("g", { class: "cld-node cld-valve", "data-id": b.id });
  grp.append(paint(s("path", { d: `M${b.x - 11},${b.y - 11}L${b.x + 11},${b.y + 11}L${b.x + 11},${b.y - 11}L${b.x - 11},${b.y + 11}Z` }), { fill: C.surface, stroke: C.ink2, width: 1.8 }));
  grp.append(paint(s("circle", { cx: b.x, cy: b.y - 22, r: 7 }), { fill: C.surface, stroke: C.ink2, width: 1.6 }));
  const pl = b.plate;
  grp.append(paint(s("rect", { x: pl.x - pl.w / 2, y: pl.y - pl.h / 2, width: pl.w, height: pl.h, rx: 4, class: "cld-bg" }), { fill: C.surface, opacity: 0.92 }));
  textLines(grp, b.x, b.y + 34, pl.lines, "cld-flow", 17, { "text-anchor": "middle" });
  if (pl.sub) text(grp, b.x, b.y + 34 + pl.lines.length * 17, pl.sub, "cld-sub", { "text-anchor": "middle" });
  g.append(grp);
  return grp;
}

const SPATIAL = {
  wide: true,
  minWidth: 760,
  exportWidth: 1100,
  controls(D, ctx) {
    const dg = ctx.diagrams.spatial_accumulation;
    return [{ id: "era", label: dg.era_label, options: [{ v: "all", label: "ภาพรวม" }, ...dg.eras.map((e) => ({ v: e.id, label: e.label }))], value: "all" }];
  },
  legend(st, D, ctx) {
    const dg = ctx.diagrams.spatial_accumulation;
    const shape = { evidence: "line", hypothesis: "dash", concept: "dotted", account: "line" };
    return dg.status.map((x) => ({ key: x.id, label: x.label, color: C.ink, shape: shape[x.id], width: STATUS_STYLE[x.id].width }))
      .concat([{ key: "lever", label: dg.lever_label, color: C.s(1), shape: "rect" }]);
  },
  note(st, D, ctx) {
    const dg = ctx.diagrams.spatial_accumulation;
    const era = dg.eras.find((e) => e.id === st.era);
    const box = h("div", { class: "cld-notes" });
    if (era) box.append(h("p", { class: "cld-era" }, h("b", { text: era.label }), h("span", { text: ` ${era.text}` })));
    box.append(h("p", { class: "rv-note-text", text: dg.how }));
    return box;
  },
  draw(svg, W, st, D, ctx, env) {
    const dg = ctx.diagrams.spatial_accumulation;
    const nodes = new Map(dg.nodes.map((n) => [n.id, n]));
    const c2 = { label: (id) => nodes.get(id)?.label || id, kind: (id) => nodes.get(id)?.kind };
    const { g } = scaleGroup(svg, W);
    const era = dg.eras.find((e) => e.id === st.era);
    const litLevers = new Set(era ? era.levers : dg.nodes.filter((n) => n.kind === "lever").map((n) => n.id));
    const litLoops = new Set(era ? era.loops : []);
    const B = {};
    for (const id of Object.keys(NODE)) B[id] = { id, ...nodeBox(id, c2) };
    const linkLayer = s("g", { class: "cld-links" }), nodeLayer = s("g"), labelLayer = s("g"), loopLayer = s("g");
    // pipes and clouds
    cloud(nodeLayer, CLOUD_L.x, CLOUD_L.y);
    cloud(nodeLayer, CLOUD_R.x, CLOUD_R.y);
    pipe(nodeLayer, CLOUD_L.x + 22, B.S1.x - B.S1.w / 2 - 2, B.S1.y, 1);
    pipe(nodeLayer, B.S1.x + B.S1.w / 2 + 2, B.S2.x - B.S2.w / 2 - 2, B.S1.y, 1);
    pipe(nodeLayer, CLOUD_R.x - 22, B.S2.x + B.S2.w / 2 + 2, B.S2.y, -1);
    const els = new Map();
    for (const id of ["S1", "S2"]) {
      const b = B[id];
      const grp = s("g", { class: "cld-node cld-stock", "data-id": id });
      grp.append(paint(s("rect", { x: b.x - b.w / 2, y: b.y - b.h / 2, width: b.w, height: b.h, rx: 6 }), { fill: C.surface, stroke: C.ink, width: 2.2 }));
      textLines(grp, b.x, b.y - 4 - (wrap(c2.label(id), b.w - 20, 16, 500).length - 1) * 9, wrap(c2.label(id), b.w - 20, 16, 500), "cld-stocklab", 19, { "text-anchor": "middle" });
      text(grp, b.x, b.y + b.h / 2 - 9, "สต็อก", "cld-sub", { "text-anchor": "middle" });
      nodeLayer.append(grp);
      els.set(id, grp);
    }
    for (const id of ["F1", "F2", "F3"]) els.set(id, valve(nodeLayer, B[id]));
    for (const n of dg.nodes.filter((q) => q.kind === "aux" || q.kind === "lever")) {
      const b = B[n.id];
      const grp = s("g", { class: `cld-node cld-${n.kind}${n.kind === "lever" && !litLevers.has(n.id) ? " is-dim" : ""}`, "data-id": n.id });
      if (n.kind === "lever") grp.append(paint(s("rect", { x: b.x - b.w / 2, y: b.y - b.h / 2, width: b.w, height: b.h, rx: b.h / 2 }),
        { fill: era && litLevers.has(n.id) ? "var(--rv-lever-on)" : "var(--rv-lever)", stroke: C.s(1), width: era && litLevers.has(n.id) ? 2.6 : 1.4 }));
      if (n.kind === "aux") {
        const bw = Math.max(...b.lines.map((l) => textWidth(l, 15))) + 14;
        grp.append(paint(s("rect", { x: b.x - bw / 2, y: b.y - b.h / 2 + 2, width: bw, height: b.h - 4, rx: 6, class: "cld-bg" }), { fill: C.surface, opacity: 0.92 }));
      }
      textLines(grp, b.x, b.y - (b.lines.length - 1) * 9.5 + 5, b.lines, n.kind === "lever" ? "cld-lever" : "cld-aux", 19, { "text-anchor": "middle" });
      labelLayer.append(grp);
      els.set(n.id, grp);
    }
    // causal links
    const linkEls = [];
    for (const ln of dg.links) {
      const a = B[ln.from], b = B[ln.to];
      const key = `${ln.from}>${ln.to}`;
      const geo = key === "P>F2" ? arcP2F2(a, b) : linkGeom(a, b, BEND[key] ?? 0);
      const st2 = STATUS_STYLE[ln.status] || STATUS_STYLE.account;
      const grp = s("g", { class: `cld-link${nodes.get(ln.from)?.kind === "lever" && !litLevers.has(ln.from) ? " is-dim" : ""}`, "data-from": ln.from, "data-to": ln.to });
      grp.append(paint(s("path", { d: geo.d, class: "cld-line" }), { stroke: C.ink, width: st2.width, dash: st2.dash, fill: "none", cap: st2.cap || "butt" }));
      arrowHead(grp, geo.x1, geo.y1, geo.ux, geo.uy, C.ink, ln.status === "evidence" ? 16 : 14);
      const sx = geo.x1 - geo.ux * 26 - geo.uy * 15, sy = geo.y1 - geo.uy * 26 + geo.ux * 15;
      grp.append(paint(s("circle", { cx: sx, cy: sy, r: 12, class: "cld-signbg" }), { fill: C.surface, stroke: C.ink, width: 1.2 }));
      const arm = 6;
      grp.append(paint(s("path", { d: ln.sign === "-" ? `M${sx - arm},${sy}H${sx + arm}` : `M${sx - arm},${sy}H${sx + arm}M${sx},${sy - arm}V${sy + arm}`, class: "cld-sign" }),
        { stroke: C.ink, width: 2.4, fill: "none", cap: "round" }));
      if (!env?.export) {
        const hit = s("path", { d: geo.d, class: "cld-hit" });
        grp.append(hit);
        bindTip(hit, () => ({ title: `${c2.label(ln.from)} → ${c2.label(ln.to)}`, rows: [{ label: ln.say, value: ln.sign === "-" ? "−" : "+" }],
          note: `${dg.status.find((x) => x.id === ln.status)?.label || ""}. ${ln.note || ""}` }));
      }
      linkLayer.append(grp);
      linkEls.push({ ln, grp });
    }
    // loop markers
    for (const lp of dg.loops) {
      const at = LOOP_AT[lp.id];
      const grp = s("g", { class: `cld-loop${litLoops.has(lp.id) ? " is-lit" : ""}`, "data-loop": lp.id, tabindex: env?.export ? null : 0, role: env?.export ? null : "button",
        "aria-label": `${lp.id} ${lp.label}: ${lp.say}` });
      grp.append(paint(s("circle", { cx: at.x, cy: at.y, r: 21, class: "cld-loopdisc" }), { fill: C.surface }));
      grp.append(paint(s("path", { d: `M${at.x + 20},${at.y - 7}A21,21 0 1 0 ${at.x + 14},${at.y + 15}`, class: "cld-loopring" }), { fill: "none", stroke: C.s(1), width: 2.4 }));
      grp.append(paint(s("path", { d: `M${at.x + 14},${at.y + 15}l-1,-11l10,6z` }), { fill: C.s(1) }));
      text(grp, at.x, at.y + 6, lp.id, "cld-loopid", { "text-anchor": "middle" });
      const lw = wrap(lp.label, 130, 13.5, 500);
      const ly = at.above ? at.y - 30 - (lw.length - 1) * 16 : at.y + 40;
      const bw = Math.max(...lw.map((l) => textWidth(l, 13.5, 500))) + 10;
      grp.append(paint(s("rect", { x: at.x - bw / 2, y: ly - 14, width: bw, height: lw.length * 16 + 6, rx: 4, class: "cld-bg" }), { fill: C.surface, opacity: 0.92 }));
      textLines(grp, at.x, ly, lw, "cld-looplab", 16, { "text-anchor": "middle" });
      loopLayer.append(grp);
      if (!env?.export) {
        const path = new Set(lp.path);
        const on = (e) => {
          svg.classList.add("cld-focus");
          for (const { ln, grp: lg } of linkEls) {
            const inLoop = path.has(ln.from) && path.has(ln.to) && !(ln.from === "S1" && ln.to === "S1");
            lg.classList.toggle("is-hot", inLoop && nodes.get(ln.from)?.kind !== "lever");
          }
          for (const [id, el] of els) el.classList.toggle("is-hot", path.has(id));
          grp.classList.add("is-hot");
          showTip(e.type === "focus" ? { type: "focus", anchor: grp.getBoundingClientRect() } : e, `${lp.id} ${lp.label}`, [], lp.say);
        };
        const off = () => { svg.classList.remove("cld-focus"); for (const { grp: lg } of linkEls) lg.classList.remove("is-hot"); for (const el of els.values()) el.classList.remove("is-hot"); grp.classList.remove("is-hot"); hideTip(); };
        grp.addEventListener("pointerenter", on);
        grp.addEventListener("pointerleave", off);
        grp.addEventListener("focus", on);
        grp.addEventListener("blur", off);
      }
    }
    g.append(linkLayer, nodeLayer, labelLayer, loopLayer);
    return Math.ceil(700 * (W / D_W));
  },
  table(st, D, ctx) {
    const dg = ctx.diagrams.spatial_accumulation;
    const L = new Map(dg.nodes.map((n) => [n.id, n.label]));
    const S = new Map(dg.status.map((x) => [x.id, x.label]));
    return { caption: "ความสัมพันธ์ในแผนภาพ (ลูกศร เครื่องหมาย และสถานะของหลักฐาน)", columns: [{ key: "a", label: "จาก" }, { key: "b", label: "ไปยัง" }, { key: "s", label: "เครื่องหมาย" },
      { key: "say", label: "ความหมาย" }, { key: "st", label: "สถานะ" }, { key: "note", label: "หลักฐาน" }],
    rows: dg.links.map((l) => ({ a: L.get(l.from), b: L.get(l.to), s: l.sign === "-" ? "−" : "+", say: l.say, st: S.get(l.status), note: l.note })) };
  },
};

// ================================================================ chapter 14: three ways a gap closes
const GAP = {
  legend(st, D, ctx) {
    const dg = ctx.diagrams.gap_closure;
    const shape = { target: "outline", capacity: "rect", moved: "outline-dash" };
    return dg.legend.map((x) => ({ key: x.id, label: x.label, color: C.neutral2, shape: shape[x.id] }));
  },
  draw(svg, W, st, D, ctx, env) {
    const dg = ctx.diagrams.gap_closure;
    const g = s("g");
    svg.append(g);
    const narrow = W < 520;
    const labW = narrow ? 0 : Math.min(W * 0.4, Math.max(textWidth(dg.target, 14), textWidth(dg.capacity, 14)) + 10);
    const barX = labW + (narrow ? 0 : 16), barW = W - barX - 8;
    let y = 8;
    if (narrow) { text(g, 0, y + 12, dg.target, "gap-lab"); y += 18; }
    else text(g, labW, y + 20, dg.target, "gap-lab", { "text-anchor": "end" });
    g.append(paint(s("rect", { x: barX, y, width: barW, height: 26, rx: 3 }), { fill: C.surface, stroke: C.ink, width: 2 }));
    y += 38;
    if (narrow) { text(g, 0, y + 12, dg.capacity, "gap-lab"); y += 18; }
    else text(g, labW, y + 20, dg.capacity, "gap-lab", { "text-anchor": "end" });
    const capW = barW * 0.62;
    g.append(paint(s("rect", { x: barX, y, width: capW, height: 26, rx: 3 }), { fill: C.neutral2, stroke: C.muted, width: 1.4 }));
    y += 40;
    const bx0 = barX + capW, bx1 = barX + barW;
    g.append(paint(s("path", { d: `M${bx0},${y - 7}V${y + 7}M${bx0},${y}H${bx1}M${bx1},${y - 7}V${y + 7}` }), { stroke: C.s(8), width: 2.4, fill: "none" }));
    text(g, (bx0 + bx1) / 2, y + 24, dg.gap, "gap-gaplab", { "text-anchor": "middle" });
    y += 44;
    const cols = narrow ? 1 : 3, gapX = 18;
    const cw = (W - gapX * (cols - 1)) / cols;
    const cards = [];
    dg.paths.forEach((p, i) => {
      const cx = narrow ? 0 : i * (cw + gapX), cy = narrow ? y : y;
      const grp = s("g", { class: "gap-card", transform: `translate(${cx},${narrow ? y : cy})`, tabindex: env?.export ? null : 0 });
      const inner = cw - 36;
      let yy = 22;
      grp.append(paint(s("rect", { x: 14, y: yy - 16, width: 24, height: 22, rx: 3 }), { fill: C.surface, stroke: C.muted, width: 1.2 }));
      text(grp, 26, yy, p.tag, "gap-tag", { "text-anchor": "middle" });
      yy += 30;
      const tl = wrap(p.title, inner, 16, 500);
      textLines(grp, 18, yy, tl, "gap-title", 20);
      yy += tl.length * 20 + 12;
      const full = inner, tgtW = p.id === "b" ? full * 0.78 : full, cap = p.id === "a" ? full * 0.86 : full * 0.6;
      grp.append(paint(s("rect", { x: 18, y: yy, width: tgtW, height: 20, rx: 2 }), { fill: C.surface, stroke: C.ink, width: 1.8 }));
      if (p.id === "b") grp.append(paint(s("rect", { x: 18 + tgtW, y: yy, width: full - tgtW, height: 20, rx: 2 }), { fill: "none", stroke: C.muted, width: 1.4, dash: "4 3" }));
      yy += 28;
      grp.append(paint(s("rect", { x: 18, y: yy, width: cap, height: 20, rx: 2 }), { fill: C.neutral2, stroke: C.muted, width: 1.2 }));
      let gapFrom = 18 + cap;
      if (p.id === "c") { grp.append(paint(s("rect", { x: 18 + cap, y: yy, width: full * 0.92 - cap, height: 20, rx: 2 }), { fill: "none", stroke: C.muted, width: 1.4, dash: "4 3" })); gapFrom = 18 + full * 0.92; }
      yy += 34;
      const gx1 = 18 + tgtW;
      grp.append(paint(s("path", { d: `M${gapFrom},${yy - 6}V${yy + 6}M${gapFrom},${yy}H${Math.max(gapFrom + 6, gx1)}M${Math.max(gapFrom + 6, gx1)},${yy - 6}V${yy + 6}` }), { stroke: C.s(8), width: 2, fill: "none" }));
      yy += 30;
      const hl = wrap(p.head, inner, 14.5, 500);
      textLines(grp, 18, yy, hl, "gap-head", 19);
      yy += hl.length * 19 + 4;
      const bl = wrap(p.text, inner, 13.5);
      textLines(grp, 18, yy, bl, "gap-body", 19);
      yy += bl.length * 19 + 12;
      cards.push({ grp, h: yy, p });
      g.append(grp);
      if (narrow) y += yy + 14;
    });
    const ch = Math.max(...cards.map((c) => c.h));
    for (const c of cards) {
      const frame = paint(s("rect", { x: 0, y: 0, width: cw, height: narrow ? c.h : ch, rx: 8, class: "gap-frame" }), { fill: c.p.id === "b" ? "var(--rv-accent-wash)" : C.surface, stroke: c.p.id === "b" ? C.s(8) : C.ink, width: c.p.id === "b" ? 2 : 1.4 });
      c.grp.insertBefore(frame, c.grp.firstChild);
      if (!env?.export) {
        const on = () => { g.classList.add("gap-focus"); for (const o of cards) o.grp.classList.toggle("is-hot", o === c); };
        const off = () => { g.classList.remove("gap-focus"); for (const o of cards) o.grp.classList.remove("is-hot"); };
        c.grp.addEventListener("pointerenter", on); c.grp.addEventListener("pointerleave", off);
        c.grp.addEventListener("focus", on); c.grp.addEventListener("blur", off);
      }
    }
    if (!narrow) y += ch + 18;
    const fl = wrap(dg.footer, W, 14, 500);
    textLines(g, 0, y + 14, fl, "gap-foot", 19);
    return y + fl.length * 19 + 10;
  },
  table(st, D, ctx) {
    const dg = ctx.diagrams.gap_closure;
    return { caption: "สามทางที่ช่องว่างปิดลงได้", columns: [{ key: "tag", label: "ทาง" }, { key: "title", label: "ทำอะไร" }, { key: "head", label: "ช่องว่างปิดอย่างไร" }, { key: "text", label: "รายละเอียด" }], rows: dg.paths };
  },
};

// ================================================================ chapter 14: care pathway
const CARE = {
  minWidth: 540,
  legend(st, D, ctx) {
    const dg = ctx.diagrams.care_pathway;
    const col = { in: C.surface, out: C.neutral2, seam: "var(--rv-accent-wash)" };
    return dg.legend.map((x) => ({ key: x.id, label: x.label, color: col[x.id], shape: x.id === "in" ? "outline" : "rect" }));
  },
  draw(svg, W, st, D, ctx, env) {
    const dg = ctx.diagrams.care_pathway;
    const g = s("g");
    svg.append(g);
    const fs = 13, lh = 18;
    const rowW = Math.min(170, Math.max(104, W * 0.19)), gap = 10, colW = (W - rowW - gap * dg.columns.length) / dg.columns.length;
    const colX = (j) => rowW + gap + j * (colW + gap);
    let y = 4;
    const heads = dg.columns.map((c) => wrap(c.label, colW - 8, 15, 500));
    const hh = Math.max(...heads.map((l) => l.length)) * 19;
    heads.forEach((lines, j) => {
      textLines(g, colX(j) + colW / 2, y + 16 + (hh - lines.length * 19), lines, "care-col", 19, { "text-anchor": "middle" });
      g.append(paint(s("line", { x1: colX(j), x2: colX(j) + colW, y1: y + hh + 8, y2: y + hh + 8 }), { stroke: C.ink, width: 2 }));
    });
    y += hh + 22;
    dg.rows.forEach((r, i) => {
      if (i > 0 && dg.rows[i - 1].side === "in" && r.side === "out") {
        g.append(paint(s("line", { x1: 0, x2: W, y1: y + 4, y2: y + 4 }), { stroke: C.muted, width: 2.4 }));
        text(g, W, y + 24, `▲ ${dg.divider_in}   ▼ ${dg.divider_out}`, "care-div", { "text-anchor": "end" });
        y += 34;
      }
      const cells = r.cells.map((cell) => (cell ? cell.split("|").map((part) => wrap(part, colW - 16, fs)) : null));
      const nl = Math.max(2, ...cells.filter(Boolean).map((parts) => parts.reduce((a, l) => a + l.length, 0)));
      const rowH = nl * lh + 26;
      const rl = wrap(r.label, rowW - 8, 15, 500), sl = wrap(r.sub, rowW - 8, 13);
      textLines(g, rowW - 4, y + rowH / 2 - ((rl.length + sl.length) * 17) / 2 + 13, [...rl, ...sl], "care-row", 17, { "text-anchor": "end" });
      cells.forEach((parts, j) => {
        const x = colX(j);
        if (!parts) { g.append(paint(s("line", { x1: x + colW / 2 - 12, x2: x + colW / 2 + 12, y1: y + rowH / 2, y2: y + rowH / 2 }), { stroke: C.neutral2, width: 1.4 })); return; }
        const seam = r.seam === dg.columns[j].id;
        const grp = s("g", { class: "care-cell", tabindex: env?.export ? null : 0 });
        grp.append(paint(s("rect", { x, y: y + 4, width: colW, height: rowH - 8, rx: 7 }),
          { fill: seam ? "var(--rv-accent-wash)" : r.side === "out" ? C.neutral2 : C.surface, stroke: seam ? C.s(8) : r.side === "out" ? C.muted : C.ink, width: seam ? 2.2 : 1.6 }));
        const total = parts.reduce((a, l) => a + l.length, 0);
        let ty = y + rowH / 2 - (total * lh) / 2 + lh - 4;
        parts.forEach((lines, k) => {
          textLines(grp, x + colW / 2, ty, lines, seam && k === 1 ? "care-seam" : "care-txt", lh, { "text-anchor": "middle" });
          ty += lines.length * lh;
        });
        g.append(grp);
        if (!env?.export) bindTip(grp, () => ({ title: `${r.label} ${r.sub}`, rows: [{ label: dg.columns[j].label, value: "" }],
          note: `${r.cells[j].replace("|", " ")} · ${r.side === "in" ? dg.legend[0].label : dg.legend[1].label}` }));
      });
      y += rowH;
    });
    return y + 8;
  },
  table(st, D, ctx) {
    const dg = ctx.diagrams.care_pathway;
    return { caption: "ใครทำกิจกรรมใดในเส้นทางการดูแล", columns: [{ key: "who", label: "ผู้ทำ" }, ...dg.columns.map((c) => ({ key: c.id, label: c.label })), { key: "side", label: "บัญชีกำลังคน" }],
      rows: dg.rows.map((r) => ({ who: `${r.label} ${r.sub}`, side: r.side === "in" ? "ใน" : "นอก", ...Object.fromEntries(dg.columns.map((c, j) => [c.id, (r.cells[j] || "—").replace("|", " ")])) })) };
  },
};

// ================================================================ closing: the policy package
const POLICY = {
  minWidth: 520,
  legend(st, D, ctx) {
    const dg = ctx.diagrams.policy_package;
    return dg.legend.map((x) => ({ key: x.id, label: x.label, color: C.ink2, shape: x.id === "loop" ? "dash" : "line" }));
  },
  draw(svg, W, st, D, ctx, env) {
    const dg = ctx.diagrams.policy_package;
    const g = s("g");
    svg.append(g);
    const left = 34, inner = W - left;
    const boxes = [];
    const measure = (w, t, sub, num) => {
      const tl = wrap(num ? `${num}  ${t}` : t, w - 28, 15.5, 500), sl = wrap(sub, w - 28, 13.5);
      return { tl, sl, h: 22 + tl.length * 20 + sl.length * 18 + 12 };
    };
    const box = (x, y, w, hh, t, sub, cls, num) => {
      const { tl, sl } = measure(w, t, sub, num);
      const grp = s("g", { class: `pp-box ${cls || ""}`, tabindex: env?.export ? null : 0 });
      grp.append(paint(s("rect", { x, y, width: w, height: hh, rx: 8 }), cls === "pp-review" ? { fill: "var(--rv-accent-wash)", stroke: C.s(8), width: 2 } : { fill: C.surface, stroke: C.ink, width: 1.6 }));
      const mid = cls === "pp-review";
      textLines(grp, mid ? x + w / 2 : x + 14, y + 26, tl, mid ? "pp-title pp-title--accent" : "pp-title", 20, mid ? { "text-anchor": "middle" } : {});
      textLines(grp, mid ? x + w / 2 : x + 14, y + 28 + tl.length * 20, sl, "pp-sub", 18, mid ? { "text-anchor": "middle" } : {});
      g.append(grp);
      boxes.push(grp);
      return grp;
    };
    const arrow = (x1, y1, x2, y2, dashed) => {
      g.append(paint(s("line", { x1, y1, x2, y2: y2 - (y2 > y1 ? 9 : 0), class: "pp-arrow" }), { stroke: C.ink2, width: 1.8, dash: dashed ? "6 5" : null }));
      const ux = Math.sign(x2 - x1), uy = Math.sign(y2 - y1);
      const d = uy ? `M${x2},${y2}l-6,${-9 * uy}h12z` : `M${x2},${y2}l${-9 * ux},-6v12z`;
      g.append(paint(s("path", { d }), { fill: C.ink2 }));
    };
    text(g, left, 18, dg.sequence_label, "pp-label");
    const sw = (inner - 2 * 26) / 3, sy = 32;
    const sh = Math.max(...dg.steps.map((x, i) => measure(sw, x.title, x.sub, String(i + 1)).h));
    dg.steps.forEach((st2, i) => {
      const x = left + i * (sw + 26);
      box(x, sy, sw, sh, st2.title, st2.sub, "", String(i + 1));
      if (i) arrow(x - 26, sy + sh / 2, x, sy + sh / 2);
    });
    const cy = sy + sh + 46, pad = 16, cw2 = (inner - pad * 3) / 2;
    const chh = Math.max(...dg.conditions.map((x) => measure(cw2, x.title, x.sub).h));
    const ch = 48 + 2 * chh + pad;
    arrow(left + 2 * (sw + 26) + sw / 2, sy + sh, left + 2 * (sw + 26) + sw / 2, cy);
    g.append(paint(s("rect", { x: left, y: cy, width: inner, height: ch, rx: 10 }), { fill: "var(--rv-wash)", stroke: C.neutral2, width: 1.2 }));
    const cl = wrap(dg.conditions_label, inner - 40, 13.5, 500);
    textLines(g, left + 20, cy + 26, cl.slice(0, 2), "pp-label", 18);
    dg.conditions.forEach((c, i) => box(left + pad + (i % 2) * (cw2 + pad), cy + 44 + Math.floor(i / 2) * (chh + 10), cw2, chh, c.title, c.sub, ""));
    const ry = cy + ch + 44, rw = Math.min(420, inner * 0.6), rx = left + (inner - rw) / 2;
    const rh = measure(rw, dg.review.title, dg.review.sub).h;
    arrow(left + inner / 2, cy + ch, left + inner / 2, ry);
    box(rx, ry, rw, rh, dg.review.title, dg.review.sub, "pp-review");
    // the review loops back to step 1
    const ly = ry + rh / 2;
    g.append(paint(s("path", { d: `M${rx},${ly}H${8}V${sy + sh / 2}H${left - 9}`, class: "pp-arrow" }), { stroke: C.ink2, width: 1.8, dash: "6 5", fill: "none" }));
    g.append(paint(s("path", { d: `M${left},${sy + sh / 2}l-9,-6v12z` }), { fill: C.ink2 }));
    text(g, 16, ly + 22, dg.loop_label, "pp-sub");
    if (!env?.export) for (const b of boxes) {
      b.addEventListener("pointerenter", () => { g.classList.add("pp-focus"); b.classList.add("is-hot"); });
      b.addEventListener("pointerleave", () => { g.classList.remove("pp-focus"); b.classList.remove("is-hot"); });
      b.addEventListener("focus", () => { g.classList.add("pp-focus"); b.classList.add("is-hot"); });
      b.addEventListener("blur", () => { g.classList.remove("pp-focus"); b.classList.remove("is-hot"); });
    }
    return ry + rh + 30;
  },
  table(st, D, ctx) {
    const dg = ctx.diagrams.policy_package;
    const rows = [...dg.steps.map((x, i) => ({ part: `ลำดับที่ ${i + 1}`, title: x.title, sub: x.sub })), ...dg.conditions.map((x) => ({ part: "เงื่อนไขที่ต้องเสริมกัน", title: x.title, sub: x.sub })),
      { part: dg.loop_label, title: dg.review.title, sub: dg.review.sub }];
    return { caption: "ชุดนโยบายที่ต้องทำเงื่อนไขให้เสริมกัน", columns: [{ key: "part", label: "ส่วน" }, { key: "title", label: "ข้อเสนอ" }, { key: "sub", label: "รายละเอียด" }], rows };
  },
};

export const DIAGRAMS = { spatial_accumulation: SPATIAL, gap_closure: GAP, care_pathway: CARE, policy_package: POLICY };
