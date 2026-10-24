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
// One row of pipes carries the doctors; the disadvantaged area's loops sit on
// the left of the advantaged area's, levers in a band above and below.
// w is the widest a label may run before it takes a second line; a valve's
// name sits next to it (name), on the side no arrow reaches.
const ROW = 380;
const NODE = {
  S1: { x: 305, y: ROW, w: 190, h: 84 }, S2: { x: 775, y: ROW, w: 190, h: 84 },
  F1: { x: 122, y: ROW, pw: 110, name: "left" }, F2: { x: 530, y: ROW, pw: 130, name: "above-right" },
  F3: { x: 928, y: ROW, pw: 110, name: "below" },
  rural: { x: 305, y: 46, w: 260 }, L: { x: 305, y: 196, w: 230 },
  C: { x: 775, y: 196, w: 240 }, P: { x: 895, y: 100, w: 140 },
  A: { x: 382, y: 552, w: 190 },
  bond: { x: 122, y: 612, w: 200 }, posts: { x: 282, y: 612, w: 220 }, local: { x: 540, y: 612, w: 300 }, private: { x: 790, y: 612, w: 220 },
};
const CLOUD_L = { x: 38, y: ROW }, CLOUD_R = { x: 970, y: ROW };
// bend: offset of the quadratic control point (design units, + = left of travel)
const BEND = { "S1>A": 30, "A>F2": 0, "S1>L": 0, "L>F2": -40, "L>F1": 18, "S2>C": 0, "C>P": 0, "P>F2": 110, "P>F3": 0, "C>L": 0,
  "bond>F1": 0, "posts>F1": 0, "rural>L": 0, "local>F2": 0, "private>F2": -30 };
// where a link leaves its source, as an offset from the source's centre
const FROM = { "A>F2": [54, 0] };
// a fixed control point, for a curve that must end at a given angle
const CTRL = { "P>F2": [530, 120] };
// arrows from below end on the bowtie's lower edge, each at its own point
// (an offset from the valve's centre) so their heads do not meet
const LAND = { "A>F2": [-18, 13], "local>F2": [0, 11], "private>F2": [22, 13], "bond>F1": [0, 11], "posts>F1": [24, 13] };
// sign badge beside the arrowhead: side 1 = right of travel, -1 = left; back
// is how far from the tip and off how far from the line
const BADGE = { "A>F2": { side: -1 }, "local>F2": { side: 1, back: 55, off: 15 }, "private>F2": { side: 1 }, "bond>F1": { side: 1 },
  "P>F2": { side: -1, back: 35 }, "P>F3": { side: -1 }, "rural>L": { back: 22 } };
// loop markers: ring centre, travel direction on screen (cw or ccw, checked
// against the loop's path including the pipe that closes it), label wrap
const LOOP_AT = {
  R1: { x: 412, y: 446, dir: "ccw", lw: 57 },
  R2: { x: 398, y: 268, dir: "cw" },
  R3: { x: 848, y: 262, dir: "cw", lw: 100 },
  R4: { x: 665, y: 262, dir: "ccw" },
};
const STATUS_STYLE = {
  evidence: { width: 2.5, head: 12 }, hypothesis: { width: 1.8, dash: "7 5", head: 11 }, concept: { width: 1.9, dash: "1.5 5", cap: "round", head: 11 },
  account: { width: 1.3, head: 10 },
};

// Lines broken at a space or before a word that starts a phrase, never after
// one (a Thai line must not end on ใน, และ, จาก...); two lines are balanced.
const STARTS = ["ใน", "จาก", "ของ", "และ", "ต่อ", "กับ", "พื้นที่"];
const STARTS_TIGHT = [...STARTS, "เสียเปรียบ", "ได้เปรียบ"];       // only when two lines will not do
const WEAK_END = ["ใน", "จาก", "ของ", "และ", "ต่อ", "กับ", "การ", "ความ"];
function cutsOf(str, starts = STARTS) {
  const cuts = [];
  for (let i = 1; i < str.length; i++) {
    if (str[i] === " ") cuts.push(i);
    else if (starts.some((w) => str.startsWith(w, i)) && !WEAK_END.some((w) => str.slice(0, i).endsWith(w))) cuts.push(i);
  }
  return cuts;
}
function lines2(str, maxW, size, weight = 400) {
  if (textWidth(str, size, weight) <= maxW) return [str];
  let best = null;
  for (const i of cutsOf(str)) {
    const a = str.slice(0, i).trim(), b = str.slice(i).trim();
    const m = Math.max(textWidth(a, size, weight), textWidth(b, size, weight));
    if (m <= maxW && (!best || m < best.m)) best = { m, lines: [a, b] };
  }
  if (best) return best.lines;
  // more than two lines: take the longest piece that fits, then the rest
  const cuts = cutsOf(str, STARTS_TIGHT);
  const lines = [];
  let from = 0;
  while (textWidth(str.slice(from).trim(), size, weight) > maxW) {
    const fit = cuts.filter((i) => i > from && textWidth(str.slice(from, i).trim(), size, weight) <= maxW);
    if (!fit.length) break;
    const i = fit[fit.length - 1];
    lines.push(str.slice(from, i).trim());
    from = i;
  }
  lines.push(str.slice(from).trim());
  return lines.length > 1 ? lines : wrap(str, maxW, size, weight);
}

// A valve's name: beside the valve when arrows also arrive from below.
function plate(id, ctx) {
  const n = NODE[id];
  const lines = lines2(ctx.label(id), n.pw, 14, 400);
  const w = Math.max(...lines.map((l) => textWidth(l, 14, 400))) + 10;
  const h = lines.length * 17 + 6;
  const top = n.name === "below" ? n.y + 14 : n.name === "above-right" ? n.y - 14 - h : n.y + 18;
  const left = n.name === "left", right = n.name === "above-right";
  const x = left ? n.x - 12 - w / 2 : right ? n.x + 13 + w / 2 : n.x;
  return { x, y: top + h / 2, w, h, lines, anchor: left ? "end" : right ? "start" : "middle" };
}
function nodeBox(id, ctx) {
  const n = NODE[id];
  if (id.startsWith("F")) return { ...n, r: 13, kind: "valve", plate: plate(id, ctx) };
  if (n.h) return { ...n, kind: "stock" };
  const lever = ctx.kind(id) === "lever";
  const size = 15, weight = lever ? 500 : 400;
  const lines = lines2(ctx.label(id), n.w, size, weight);
  const tw = Math.max(...lines.map((l) => textWidth(l, size, weight)));
  // the box a line meets: the pill for a lever, the words for an auxiliary
  return { ...n, w: tw + (lever ? 34 : 12), h: lines.length * 19 + (lever ? 14 : 8), lines, kind: ctx.kind(id) };
}

// A valve's regulators: the small circles on its stem, above and (when arrows
// arrive from below) below it. Information arrives there.
const REG = 22;
const regulator = (b, fromY) => (fromY < b.y - 16 ? { x: b.x, y: b.y - REG } : null);

// Where a line from (px, py) towards the node centre meets the node's edge.
function edge(b, px, py, pad = 4) {
  if (b.kind === "valve") {
    const rg = regulator(b, py);
    const cx = rg ? rg.x : b.x, cy = rg ? rg.y : b.y, r = rg ? 7 : b.r, dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1;
    return [cx + (dx / d) * (r + pad), cy + (dy / d) * (r + pad)];
  }
  const dx = px - b.x, dy = py - b.y;
  const hw = b.w / 2 + pad, hh = b.h / 2 + pad;
  const t = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
  return [b.x + dx * t, b.y + dy * t];
}
// Where the segment from (px, py) to (ax, ay) enters the box, padded.
function entry(b, px, py, ax, ay, pad) {
  const dx = ax - px, dy = ay - py;
  let t0 = 0;
  for (const [p, q] of [[-dx, px - (b.x - b.w / 2 - pad)], [dx, b.x + b.w / 2 + pad - px], [-dy, py - (b.y - b.h / 2 - pad)], [dy, b.y + b.h / 2 + pad - py]])
    if (p < 0) t0 = Math.max(t0, q / p);
  return [px + dx * t0, py + dy * t0];
}
// The point a link aims at: a valve's regulator, any other node's centre.
const aim = (b, from) => (b.kind === "valve" ? regulator(b, from.y) || b : b);

function linkGeom(a, b, bend, from = [0, 0], ctrl = null, land = null) {
  const pa = { x: aim(a, b).x + from[0], y: aim(a, b).y + from[1] }, pb = land ? { x: b.x + land[0], y: b.y + land[1] } : aim(b, a);
  const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
  const [cx, cy] = ctrl || [mx + (-dy / len) * bend, my + (dx / len) * bend];
  const [x0, y0] = entry(a, cx, cy, pa.x, pa.y, 6), [x1, y1] = land ? [pb.x, pb.y] : b.kind === "valve" ? edge(b, cx, cy, 6) : entry(b, cx, cy, pb.x, pb.y, 6);
  const tx = x1 - cx, ty = y1 - cy, tl = Math.hypot(tx, ty) || 1;
  return { d: `M${x0.toFixed(1)},${y0.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`, x1, y1, ux: tx / tl, uy: ty / tl };
}

function arrowHead(g, x, y, ux, uy, col, size = 11) {
  const px = -uy, py = ux;
  const d = `M${x},${y}L${x - ux * size + px * size * 0.45},${y - uy * size + py * size * 0.45}L${x - ux * size - px * size * 0.45},${y - uy * size - py * size * 0.45}Z`;
  const a = paint(s("path", { d, class: "cld-head" }), { fill: col });
  g.append(a);
  return a;
}

// A + or − in a disc; `small` is the sign a flow gives its stock, on the pipe.
function sign(g, x, y, minus, small) {
  const r = small ? 8.5 : 10, arm = small ? 4 : 5;
  g.append(paint(s("circle", { cx: x, cy: y, r, class: small ? "cld-signbg cld-pipesign" : "cld-signbg" }), { fill: C.surface, stroke: C.ink, width: small ? 1.4 : 1.2 }));
  g.append(paint(s("path", { d: minus ? `M${x - arm},${y}H${x + arm}` : `M${x - arm},${y}H${x + arm}M${x},${y - arm}V${y + arm}`, class: "cld-sign" }),
    { stroke: C.ink, width: 2, fill: "none", cap: "round" }));
}

function cloud(g, x, y) {
  const d = `M${x - 22},${y + 8}a10,10 0 0 1 4,-17a12,12 0 0 1 20,-6a11,11 0 0 1 18,6a9,9 0 0 1 2,17z`;
  g.append(paint(s("path", { d, class: "cld-cloud" }), { fill: C.surface, stroke: C.muted, width: 1.6 }));
}

// One stretch of pipe from x0 to x1; `head` draws the arrowhead at x1. The
// pipe is tinted and outlined darker than any influence line, so it reads first.
const PIPE_R = 7;
function pipe(g, x0, x1, y, head) {
  const dir = Math.sign(x1 - x0);
  g.append(s("rect", { x: Math.min(x0, x1), y: y - PIPE_R, width: Math.abs(x1 - x0), height: PIPE_R * 2, class: "cld-pipefill" }));
  for (const yy of [y - PIPE_R, y + PIPE_R]) g.append(paint(s("line", { x1: x0, x2: x1, y1: yy, y2: yy, class: "cld-pipewall" }), { stroke: C.ink, width: 2.4 }));
  if (head) {
    const back = x1 - dir * 16;
    g.append(paint(s("path", { d: `M${x1},${y}L${back},${y - 14}L${back},${y + 14}Z`, class: "cld-pipehead" }), { fill: C.ink }));
  }
}

function valve(g, b) {
  const grp = s("g", { class: "cld-node cld-valve", "data-id": b.id });
  grp.append(paint(s("path", { d: `M${b.x - 11},${b.y - 11}L${b.x + 11},${b.y + 11}L${b.x + 11},${b.y - 11}L${b.x - 11},${b.y + 11}Z` }), { fill: C.surface, stroke: C.ink, width: 1.8 }));
  grp.append(paint(s("line", { x1: b.x, x2: b.x, y1: b.y - REG + 7, y2: b.y }), { stroke: C.ink, width: 1.6 }));
  grp.append(paint(s("circle", { cx: b.x, cy: b.y - REG, r: 7 }), { fill: C.surface, stroke: C.ink, width: 1.6 }));
  const pl = b.plate;
  grp.append(paint(s("rect", { x: pl.x - pl.w / 2, y: pl.y - pl.h / 2, width: pl.w, height: pl.h, rx: 4, class: "cld-bg" }), { fill: C.surface, opacity: 0.92 }));
  const tx = pl.anchor === "end" ? pl.x + pl.w / 2 - 5 : pl.anchor === "start" ? pl.x - pl.w / 2 + 5 : pl.x;
  textLines(grp, tx, pl.y - pl.h / 2 + 16, pl.lines, "cld-flow", 17, { "text-anchor": pl.anchor });
  g.append(grp);
  return grp;
}

// A loop marker: a ring that turns the way the loop travels, its id inside.
function ring(grp, x, y, dir) {
  const r = 20, cw = dir === "cw" ? 1 : -1, rad = Math.PI / 180;
  const t0 = (cw > 0 ? 200 : -20) * rad, t1 = t0 + cw * 296 * rad;
  const p0 = [x + r * Math.cos(t0), y + r * Math.sin(t0)], p1 = [x + r * Math.cos(t1), y + r * Math.sin(t1)];
  grp.append(paint(s("path", { d: `M${p0[0].toFixed(1)},${p0[1].toFixed(1)}A${r},${r} 0 1 ${cw > 0 ? 1 : 0} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`, class: "cld-loopring" }),
    { fill: "none", stroke: C.s(1), width: 2.4 }));
  const ux = -Math.sin(t1) * cw, uy = Math.cos(t1) * cw;
  arrowHead(grp, p1[0] + ux * 5, p1[1] + uy * 5, ux, uy, C.s(1), 9).classList.add("cld-loophead");
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
    const { g, k } = scaleGroup(svg, W);
    const era = dg.eras.find((e) => e.id === st.era);
    const litLevers = new Set(era ? era.levers : dg.nodes.filter((n) => n.kind === "lever").map((n) => n.id));
    const litLoops = new Set(era ? era.loops : []);
    const B = {};
    for (const id of Object.keys(NODE)) B[id] = { id, ...nodeBox(id, c2) };
    const linkLayer = s("g", { class: "cld-links" }), nodeLayer = s("g"), labelLayer = s("g"), loopLayer = s("g");
    const tip = (el, ln) => {
      if (env?.export) return;
      // the evidence status on its own row, under the meaning; the note below
      bindTip(el, () => ({ title: `${c2.label(ln.from)} → ${c2.label(ln.to)}`,
        rows: [{ label: ln.say, value: ln.sign === "-" ? "−" : "+" }, { label: dg.status.find((x) => x.id === ln.status)?.label || "", value: "" }],
        note: ln.note || "" }));
    };
    // the pipe: each stretch between a valve and a stock belongs to the link
    // that says how that flow changes that stock (drawn below); the stretches
    // to the clouds belong to nothing
    const edgeOf = (id, side) => B[id].x + side * (B[id].w / 2 + 2);
    const PIPE = {
      "F1>S1": [B.F1.x, edgeOf("S1", -1), true], "F2>S1": [B.F2.x, edgeOf("S1", 1), false],
      "F2>S2": [B.F2.x, edgeOf("S2", -1), true], "F3>S2": [B.F3.x, edgeOf("S2", 1), true],
    };
    const ends = s("g", { class: "cld-link cld-pipeend" });
    pipe(ends, CLOUD_L.x + 22, B.F1.x, ROW, false);
    pipe(ends, CLOUD_R.x - 22, B.F3.x, ROW, false);
    linkLayer.append(ends);
    cloud(nodeLayer, CLOUD_L.x, CLOUD_L.y);
    cloud(nodeLayer, CLOUD_R.x, CLOUD_R.y);
    const els = new Map();
    for (const id of ["S1", "S2"]) {
      const b = B[id];
      const grp = s("g", { class: "cld-node cld-stock", "data-id": id });
      grp.append(paint(s("rect", { x: b.x - b.w / 2, y: b.y - b.h / 2, width: b.w, height: b.h, rx: 6 }), { fill: C.surface, stroke: C.ink, width: 2.6 }));
      const sl = lines2(c2.label(id), b.w - 20, 16, 500);
      textLines(grp, b.x, b.y - 2 - (sl.length - 1) * 10, sl, "cld-stocklab", 20, { "text-anchor": "middle" });
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
      else grp.append(paint(s("rect", { x: b.x - b.w / 2, y: b.y - b.h / 2 + 2, width: b.w, height: b.h - 4, rx: 6, class: "cld-bg" }), { fill: C.surface, opacity: 0.92 }));
      textLines(grp, b.x, b.y - (b.lines.length - 1) * 9.5 + 5, b.lines, n.kind === "lever" ? "cld-lever" : "cld-aux", 19, { "text-anchor": "middle" });
      labelLayer.append(grp);
      els.set(n.id, grp);
    }
    // causal links, and the signs the flows give their stocks
    const linkEls = [];
    for (const ln of dg.links) {
      const key = `${ln.from}>${ln.to}`;
      const st2 = STATUS_STYLE[ln.status] || STATUS_STYLE.account;
      const grp = s("g", { class: `cld-link${nodes.get(ln.from)?.kind === "lever" && !litLevers.has(ln.from) ? " is-dim" : ""}`, "data-from": ln.from, "data-to": ln.to });
      if (ln.pipe) {
        const [x0, x1, head] = PIPE[key];
        pipe(grp, x0, x1, ROW, head);
        // the sign sits on the pipe, clear of the arrowhead at the stock
        const sx = x1 - Math.sign(x1 - x0) * (head ? 30 : 20);
        sign(grp, sx, ROW, ln.sign === "-", true);
        if (!env?.export) {
          const hit = paint(s("rect", { x: Math.min(x0, x1), y: ROW - 12, width: Math.abs(x1 - x0), height: 24, class: "cld-hitbox" }), {});
          grp.append(hit);
          tip(hit, ln);
        }
      } else {
        const a = B[ln.from], b = B[ln.to];
        const geo = linkGeom(a, b, BEND[key] ?? 0, FROM[key], CTRL[key], LAND[key]);
        grp.append(paint(s("path", { d: geo.d, class: "cld-line" }), { stroke: C.ink, width: st2.width, dash: st2.dash, fill: "none", cap: st2.cap || "butt" }));
        arrowHead(grp, geo.x1, geo.y1, geo.ux, geo.uy, C.ink, st2.head);
        const side = BADGE[key]?.side ?? 1, back = BADGE[key]?.back ?? st2.head + 13, off = (BADGE[key]?.off ?? 16) * side;
        sign(grp, geo.x1 - geo.ux * back - geo.uy * off, geo.y1 - geo.uy * back + geo.ux * off, ln.sign === "-", false);
        if (!env?.export) {
          const hit = s("path", { d: geo.d, class: "cld-hit" });
          grp.append(hit);
          tip(hit, ln);
        }
      }
      linkLayer.append(grp);
      linkEls.push({ ln, grp });
    }
    // loop markers
    for (const lp of dg.loops) {
      const at = LOOP_AT[lp.id];
      const grp = s("g", { class: `cld-loop${litLoops.has(lp.id) ? " is-lit" : ""}`, "data-loop": lp.id, tabindex: env?.export ? null : 0, role: env?.export ? null : "button",
        "aria-label": `${lp.id} ${lp.label}: ${lp.say}` });
      grp.append(paint(s("circle", { cx: at.x, cy: at.y, r: 24, class: "cld-loopdisc" }), { fill: C.surface }));
      ring(grp, at.x, at.y, at.dir);
      text(grp, at.x, at.y + 6, lp.id, "cld-loopid", { "text-anchor": "middle" });
      const lw = lines2(lp.label, at.lw || 150, 13.5, 500);
      const ly = at.y + 44;
      const bw = Math.max(...lw.map((l) => textWidth(l, 13.5, 500))) + 8;
      grp.append(paint(s("rect", { x: at.x - bw / 2, y: ly - 14, width: bw, height: lw.length * 16 + 6, rx: 4, class: "cld-bg" }), { fill: C.surface, opacity: 0.92 }));
      textLines(grp, at.x, ly, lw, "cld-looplab", 16, { "text-anchor": "middle" });
      loopLayer.append(grp);
      if (!env?.export) {
        const path = new Set(lp.path);
        const on = (e) => {
          svg.classList.add("cld-focus");
          for (const { ln, grp: lg } of linkEls) lg.classList.toggle("is-hot", path.has(ln.from) && path.has(ln.to) && nodes.get(ln.from)?.kind !== "lever");
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
    const bottom = Math.max(...Object.values(B).map((b) => b.y + (b.h || 0) / 2));
    return Math.ceil((bottom + 14) * k);
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
