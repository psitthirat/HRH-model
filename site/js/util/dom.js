// Tiny DOM/SVG helpers and a tween that respects prefers-reduced-motion.

export const SVGNS = "http://www.w3.org/2000/svg";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const reducedMotion = () =>
  document.documentElement.classList.contains("reduce-motion") ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function duration() {
  return reducedMotion() ? 0 : 560;
}

// Interpolate numbers inside two strings of identical structure (paths, transforms).
function numberInterp(a, b) {
  const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  const na = a.match(re) || [], nb = b.match(re) || [];
  const sa = a.split(re), sb = b.split(re);
  if (na.length !== nb.length || sa.join("|") !== sb.join("|")) return null;
  const va = na.map(Number), vb = nb.map(Number);
  return (t) => {
    let out = sb[0];
    for (let i = 0; i < vb.length; i++) out += (va[i] + (vb[i] - va[i]) * t).toFixed(2) + sb[i + 1];
    return out;
  };
}

const running = new WeakMap();

// Animate attributes (and opacity) towards targets. The final values are always
// written, so correctness never depends on the animation having run.
export function tween(el, targets, dur = duration()) {
  const prev = running.get(el);
  if (prev) cancelAnimationFrame(prev);
  const plan = [];
  for (const [k, to] of Object.entries(targets)) {
    const toStr = String(to);
    const fromStr = k === "opacity" ? (el.style.opacity || el.getAttribute("opacity") || "1") : el.getAttribute(k);
    if (fromStr == null || dur === 0 || fromStr === toStr) {
      if (k === "opacity") el.style.opacity = toStr; else el.setAttribute(k, toStr);
      continue;
    }
    const a = Number(fromStr), b = Number(toStr);
    if (Number.isFinite(a) && Number.isFinite(b)) plan.push([k, (t) => String(a + (b - a) * t)]);
    else {
      const f = numberInterp(fromStr, toStr);
      if (f) plan.push([k, f]);
      else { if (k === "opacity") el.style.opacity = toStr; else el.setAttribute(k, toStr); }
    }
  }
  if (!plan.length) return;
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = ease(t);
    for (const [k, f] of plan) {
      const v = f(e);
      if (k === "opacity") el.style.opacity = v; else el.setAttribute(k, v);
    }
    if (t < 1) running.set(el, requestAnimationFrame(step));
    else {
      running.delete(el);
      for (const [k] of plan) {
        const v = String(targets[k]);
        if (k === "opacity") el.style.opacity = v; else el.setAttribute(k, v);
      }
    }
  };
  running.set(el, requestAnimationFrame(step));
}

export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function visuallyHidden(text) {
  return h("span", { class: "vh", text });
}

export function uid(prefix = "u") {
  uid.n = (uid.n || 0) + 1;
  return `${prefix}${uid.n}`;
}
