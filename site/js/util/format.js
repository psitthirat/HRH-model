// Number and year formatting. Years are stored as Gregorian integers and shown
// in B.E. by one formatter; fiscal years carry a visible label (ui_text fmt.fiscal).

import { t } from "./i18n.js";

const nf = new Intl.NumberFormat("en-US");
const cache = new Map();
function fixed(d) {
  if (!cache.has(d)) cache.set(d, new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  return cache.get(d);
}

export const BE = 543;
export const be = (y) => (y == null ? "" : String(Math.round(y) + BE));
export function yearLabel(y, basis) {
  if (y == null) return "";
  return basis === "fiscal_year" ? t("fmt.fiscal", { y: be(y) }) : be(y);
}

export function num(v, digits = null) {
  if (v == null || !Number.isFinite(v)) return t("chart.no_data");
  if (digits == null) {
    const a = Math.abs(v);
    digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  }
  return digits === 0 ? nf.format(Math.round(v)) : fixed(digits).format(v);
}

export function signed(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return t("chart.no_data");
  const s = fixed(digits).format(Math.abs(v));
  return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
}

export function pct(v, digits = 1, withSign = false) {
  if (v == null || !Number.isFinite(v)) return t("chart.no_data");
  return (withSign ? signed(v, digits) : fixed(digits).format(v)) + "%";
}

export function compact(v) {
  if (v == null || !Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1e6) return fixed(a >= 1e7 ? 0 : 1).format(v / 1e6) + t("fmt.million");
  if (a >= 1e4) return fixed(0).format(v / 1e3) + t("fmt.thousand");
  return num(v);
}

// Axis tick formatting given the tick step.
export function tickFormat(step) {
  if (step >= 1e6) return (v) => fixed(step >= 1e7 ? 0 : 1).format(v / 1e6) + t("fmt.million");
  if (step >= 1) return (v) => nf.format(Math.round(v));
  const d = Math.min(3, Math.max(1, Math.ceil(-Math.log10(step))));
  return (v) => fixed(d).format(v);
}

export function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
