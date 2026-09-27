// Accessible data tables (the table twin of every chart) and CSV downloads of
// exactly the rows a view shows. Missing stays missing: null is written as an
// empty CSV field and shown with the "table.missing" text.

import { h } from "../util/dom.js";
import { num, csvCell } from "../util/format.js";
import { t as tr } from "../util/i18n.js";

export function dataTable(tbl, { caption, maxRows = 400, labels = {} } = {}) {
  const { columns, rows } = tbl;
  const t = h("table", { class: "data-table" });
  if (caption) t.append(h("caption", { text: caption }));
  t.append(h("thead", {}, h("tr", {}, ...columns.map((c) => h("th", { scope: "col", text: labels[c.key] || c.label })))));
  const tb = h("tbody");
  for (const r of rows.slice(0, maxRows)) {
    tb.append(h("tr", {}, ...columns.map((c) => {
      const v = r[c.key];
      if (v == null || v === "") return h("td", { class: "missing", text: tr("table.missing") });
      if (typeof v === "number") return h("td", { class: "num", text: Number.isInteger(v) && Math.abs(v) < 3000 && /year/.test(c.key) ? String(v + 543) : num(v, Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : 4) });
      if (typeof v === "boolean") return h("td", { text: v ? "✓" : "—" });
      return h("td", { text: String(v) });
    })));
  }
  t.append(tb);
  const wrap = h("div", { class: "table-wrap", tabindex: 0, role: "region", "aria-label": caption || tr("table.region") }, t);
  if (rows.length > maxRows) wrap.append(h("p", { class: "chart-note", text: tr("table.more", { shown: maxRows, total: rows.length }) }));
  return wrap;
}

export function toCSV(tbl, metaLines = []) {
  const head = tbl.columns.map((c) => csvCell(c.key)).join(",");
  const body = tbl.rows.map((r) => tbl.columns.map((c) => csvCell(r[c.key])).join(",")).join("\n");
  return "﻿" + metaLines.map((l) => "# " + l).join("\n") + (metaLines.length ? "\n" : "") + head + "\n" + body + "\n";
}

export function download(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
