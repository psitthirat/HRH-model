// Minimal scales. Every chart maps data to pixels through these, so domains are
// explicit and shared domains (two maps, two years) are easy to enforce.

export function linear(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => r0 + (v - d0) * k;
  f.domain = domain; f.range = range;
  f.invert = (p) => (k === 0 ? d0 : d0 + (p - r0) / k);
  f.ticks = (n = 5) => ticks(d0, d1, n);
  return f;
}

export function log(domain, range) {
  const l = linear(domain.map(Math.log), range);
  const f = (v) => l(Math.log(v));
  f.domain = domain; f.range = range;
  return f;
}

export function band(keys, range, padding = 0.2) {
  const [r0, r1] = range;
  const n = Math.max(1, keys.length);
  const step = (r1 - r0) / (n + padding);
  const bw = step * (1 - padding);
  const f = (k) => r0 + step * padding + keys.indexOf(k) * step;
  f.bandwidth = bw; f.step = step; f.keys = keys;
  return f;
}

export function tickStep(start, stop, count) {
  const step0 = Math.abs(stop - start) / Math.max(0, count);
  let step1 = Math.pow(10, Math.floor(Math.log10(step0 || 1)));
  const err = step0 / step1;
  if (err >= 7.07) step1 *= 10;
  else if (err >= 3.16) step1 *= 5;
  else if (err >= 1.41) step1 *= 2;
  return stop < start ? -step1 : step1;
}

export function ticks(a, b, n = 5) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const st = tickStep(lo, hi, n);
  if (!Number.isFinite(st) || st === 0) return [lo];
  const out = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(+v.toFixed(10));
  return out;
}

export function nice([a, b], n = 5) {
  const st = tickStep(a, b, n);
  if (!Number.isFinite(st) || st === 0) return [a, b];
  return [Math.floor(a / st) * st, Math.ceil(b / st) * st];
}

export function extent(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo === Infinity ? [0, 1] : [lo, hi];
}

// Quantize a value on a continuous domain into one of n colour steps.
export function quantize(domain, n) {
  const [a, b] = domain;
  return (v) => {
    if (v == null || !Number.isFinite(v)) return -1;
    const t = (v - a) / (b - a || 1);
    return Math.max(0, Math.min(n - 1, Math.floor(t * n)));
  };
}
