// The "sources and method" drawer: sources, dataset metadata, the facts a
// scene's sentences use, appendix tables and release provenance. Non-modal:
// Esc or the close button returns focus to where the reader was.

import { h, clear } from "../util/dom.js";
import { be } from "../util/format.js";
import { dataTable, toCSV, download } from "./table.js";
import { t, pin, appendixLoc } from "../util/i18n.js";

let opener = null;

export function openDrawer(title, content) {
  const d = document.getElementById("drawer");
  opener = document.activeElement;
  clear(d);
  const close = h("button", { class: "btn btn--icon drawer__close", type: "button", "aria-label": t("drawer.close"), text: "✕", onclick: closeDrawer });
  const head = h("h2", { class: "drawer__title", tabindex: -1, text: title });
  d.append(h("div", { class: "drawer__head" }, head, close), h("div", { class: "drawer__body" }, content));
  d.hidden = false;
  document.body.classList.add("drawer-open");
  head.focus();
}

export function closeDrawer() {
  const d = document.getElementById("drawer");
  if (d.hidden) return;
  d.hidden = true;
  document.body.classList.remove("drawer-open");
  if (opener && document.contains(opener)) opener.focus();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

const short = (x) => (x ? String(x).slice(0, 12) : "");

function kv(pairs) {
  const dl = h("dl", { class: "kv" });
  for (const [k, v] of pairs) if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) dl.append(h("dt", { text: k }), h("dd", {}, v));
  return dl;
}

export function datasetMeta(R, id) {
  const d = R.ds(id);
  const m = d.meta;
  const sources = (d.sources || []).filter((s) => s.path || s.asset_id);
  const years = m.years ? `${be(m.years[0])}–${be(m.years[1])}` : "";
  return h("section", { class: "meta-block" },
    h("h4", { text: m.title_th }), h("p", { class: "meta-id", text: t("drawer.rows", { id, n: d.row_count, sum: short(d.checksum) }) }),
    kv([[t("drawer.evidence"), R.label("evidence", m.evidence)], [t("drawer.geo"), m.geo_set ? R.label("geo", m.geo_set) : ""],
      [t("drawer.years"), years], [t("drawer.year_basis"), m.year_basis ? (R.vocab.year_basis[m.year_basis] || m.year_basis) : ""], [t("drawer.scope"), m.scope],
      [t("drawer.unit"), m.unit], [t("drawer.numerator"), m.numerator], [t("drawer.denominator"), m.denominator], [t("drawer.multiplier"), m.multiplier ? String(m.multiplier) : ""],
      [t("drawer.aggregation"), m.aggregation], [t("drawer.uncertainty"), m.uncertainty || R.vocab.evidence[m.evidence]?.uncertainty],
      [t("drawer.missing"), m.missing], [t("drawer.keys"), (m.keys || []).join(", ")]]),
    m.notes?.length ? h("ul", { class: "notes" }, ...m.notes.map((n) => h("li", { text: n }))) : "",
    sources.length ? h("p", { class: "meta-src" }, t("drawer.upstream"), ...sources.map((s) => h("code", {
      title: s.sha256 ? `sha256 ${s.sha256}` : null,
      text: `${s.path || s.asset_id}${s.path && s.asset_id ? " (" + s.asset_id + ")" : ""} ` }))) : "");
}

export function sourcesContent(R, scene, spec, { onAppendix } = {}) {
  const wrap = h("div", { class: "sources" });
  wrap.append(h("p", { class: "lead", text: `${scene.id} ${scene.title}` }));
  wrap.append(h("p", { text: scene.headline.text }), h("p", { text: scene.body.text }));
  if (scene.caveats.length) wrap.append(h("h3", { text: t("scene.interpretation") }),
    h("ul", {}, ...scene.caveats.map(text => h("li", { text }))));
  wrap.append(kv([[t("ribbon.time"), scene.time], [t("ribbon.scope"), scene.scope], [t("ribbon.den"), scene.denominator],
    [t("drawer.report_section"), scene.report_section], [t("drawer.evidence"), R.label("evidence", scene.evidence)]]));
  if (scene.sources?.length) {
    wrap.append(h("h3", { text: t("drawer.assets") }));
    wrap.append(h("ul", { class: "src-list" }, ...scene.sources.map((s) => h("li", {},
      h("strong", { text: `${s.report_number || s.asset_id || ""} ` }), s.caption_th || "",
      s.file || s.data_file ? h("br") : "",
      s.file ? h("code", { text: s.file }) : "", s.data_file ? h("code", { text: s.data_file }) : ""))));
  }
  const dsIds = [...new Set(scene.steps.map((st) => st.view.dataset).concat(spec?.dataset).filter(Boolean))];
  if (dsIds.length) {
    wrap.append(h("h3", { text: t("drawer.datasets") }));
    for (const id of dsIds) wrap.append(datasetMeta(R, id));
  }
  if (scene.facts?.length) {
    wrap.append(h("h3", { text: t("drawer.facts") }));
    const tb = h("table", { class: "data-table facts-table" }, h("thead", {}, h("tr", {}, h("th", { text: t("drawer.fact") }), h("th", { text: t("drawer.value") }), h("th", { text: t("drawer.origin") }))));
    const body = h("tbody");
    for (const k of scene.facts) {
      const f = R.fact(k);
      if (!f) continue;
      const src = f.kind === "claim" && f.source?.claim_id ? t("drawer.from_claim", { id: f.source.claim_id + (f.source.table ? " · " + f.source.table : "") })
        : t("drawer.from_data", { ds: (f.datasets || []).join(", "), how: f.derivation || "" });
      body.append(h("tr", {}, h("td", {}, h("code", { text: k })), h("td", { text: `${f.display} ${f.unit || ""}` }), h("td", { text: src })));
    }
    tb.append(body);
    wrap.append(h("div", { class: "table-wrap" }, tb));
  }
  if (R.capabilities.appendix && scene.appendix?.length) {
    wrap.append(h("h3", { text: t("drawer.appendix") }));
    wrap.append(h("p", {}, ...scene.appendix.map((a) => h("button", { class: "linkbtn", type: "button", onclick: () => onAppendix?.(a),
      text: `${a} ${R.appendixEntry(a)?.title ?? ""}` }))));
  }
  wrap.append(h("h3", { text: t("drawer.release") }), releaseSummary(R));
  return wrap;
}

export function releaseSummary(R) {
  const m = R.manifest;
  const f = m.freshness || { status: "unknown" };
  const validation = m.validation;
  const status = ["fresh", "code_changed", "stale", "unknown"].includes(f.status) ? t(`drawer.fresh.${f.status}`) : f.status;
  return h("div", { class: "release-summary" }, kv([
    [t("drawer.release_id"), h("code", { text: R.id })], [t("drawer.status"), R.status === "promoted" ? t("drawer.status_promoted") : t("drawer.status_draft")],
    [t("drawer.generated"), m.generated_at], [t("drawer.analysed"), m.data_as_of], [t("drawer.commit"), m.analysis_commit],
    [t("drawer.freshness"), status], [t("drawer.reasons"), (f.reasons || []).join("; ")],
    [t("drawer.checks"), validation?.n_checks != null ? t("drawer.checks_value", {
      n: validation.n_checks, e: (validation.errors || []).length, w: (validation.warnings || []).length }) : null],
    [t("drawer.schema"), m.schema_version]]));
}

export function releaseContent(R) {
  const m = R.manifest;
  const wrap = h("div", {}, releaseSummary(R));
  if (m.validation?.warnings?.length) wrap.append(h("h3", { text: t("drawer.warnings") }), h("ul", {}, ...m.validation.warnings.map((w) => h("li", { text: w }))));
  const rec = R.bundle.reconciliation || [];
  if (rec.length) wrap.append(h("h3", { text: t("drawer.reconciled", { ok: rec.filter((r) => r.ok).length, n: rec.length }) }));
  if (m.source_checksums?.length) wrap.append(h("h3", { text: t("drawer.checksums") }),
    h("div", { class: "table-wrap" }, dataTable({ columns: [{ key: "path", label: t("drawer.file") }, { key: "sha256", label: "sha256" }],
      rows: m.source_checksums.map((x) => ({ path: x.path, sha256: short(x.sha256) })) }, { maxRows: 200 })));
  return wrap;
}

export async function appendixContent(R, id, { onGoto } = {}) {
  const a = R.appendixEntry(id);
  const wrap = h("div", { class: "appendix" });
  if (!a) { wrap.append(h("p", { text: id })); return wrap; }
  wrap.append(h("p", { class: "chart-note", text: t("drawer.appendix_note") }));
  for (const para of a.text) wrap.append(pin(h("p", { text: para }), appendixLoc(id)));
  wrap.append(h("p", {}, t("drawer.opened_from"), ...a.scenes.map((sid) => h("button", { class: "linkbtn", type: "button", onclick: () => onGoto?.(sid), text: sid }))));
  const tables = await R.appendixTables();
  for (const tab of a.tables) {
    const d = tables.tables[tab.asset_id];
    if (!d) continue;
    const tbl = { columns: d.columns.map((c) => ({ key: c, label: c })), rows: d.rows.map((r) => Object.fromEntries(d.columns.map((c, i) => [c, r[i]]))) };
    wrap.append(h("h3", {}, tab.report_number ? `${tab.report_number} ` : "", tab.caption_th),
      tab.file ? h("p", { class: "meta-src" }, h("code", { text: tab.file })) : "",
      dataTable(tbl, { maxRows: 60 }),
      h("button", { class: "btn btn--ghost", type: "button", text: t("explore.download"),
        onclick: () => download(`${tab.asset_id}.csv`, toCSV(tbl, [`release ${R.id}`, `source ${tab.file || tab.report_number || tab.asset_id}`])) }));
  }
  return wrap;
}

export function helpContent(R) {
  const rows = [["→ / Space / PageDown", t("help.next")], ["← / PageUp", t("help.prev")], ["Home / End", t("help.ends")],
    ...(R?.capabilities.notes !== false ? [["N", t("help.notes")]] : []),
    ["F", t("help.fullscreen")], ["E", t("help.explore")], ["Esc", t("help.close")], ["?", t("help.help")]];
  return h("div", {}, h("table", { class: "data-table" }, h("tbody", {}, ...rows.map(([k, v]) => h("tr", {}, h("th", { scope: "row" }, h("kbd", { text: k })), h("td", { text: v }))))),
    h("p", { class: "chart-note", text: t("drawer.help_note") }));
}
