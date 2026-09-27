// Explore: the same scene views with the filters opened up. One filter row sits
// above everything it scopes; the table under the chart is the exact rows the
// chart draws, and the CSV download is that table. Explore's choices are kept in
// the URL but never overwrite the presenter's prepared position.

import { h, clear } from "../util/dom.js";
import { mountView, stepView, applyOverrides, controlOptions, viewRows } from "../engine.js";
import { evidenceBadge, hideTip } from "../charts/core.js";
import { dataTable, toCSV, download } from "../ui/table.js";
import { loadPresenter } from "../state.js";
import { t } from "../util/i18n.js";

const CONTROL_KEY = { cadre: "explore.cadre", cadre_multi: "explore.cadre", scope: "explore.scope", denominator: "explore.denominator",
  denominator_pair: "explore.denominator_pair", year: "explore.year", window: "explore.window", tier: "explore.tier", workforce: "explore.workforce" };
const controlLabel = (c) => (CONTROL_KEY[c] ? t(CONTROL_KEY[c]) : c);
const OV_KEY = { cadre: "cadre", scope: "scope", denominator: "den", denominator_pair: "pair", year: "year", window: "window",
  tier: "tier", workforce: "wf" };

export function initExplore(app) {
  const { R, main } = app;
  clear(main);
  const root = h("div", { class: "explore" });
  const bar = h("div", { class: "explore__bar", role: "toolbar", "aria-label": t("explore.filters") });
  const stage = h("div", { class: "scene__stage explore__stage" });
  const side = h("aside", { class: "explore__side" });
  const tableBox = h("section", { class: "explore__table", "aria-label": t("table.region") });
  root.append(bar, h("div", { class: "explore__main" }, h("div", { class: "explore__chart" }, stage), side), tableBox);
  main.append(root);

  function scene() { return R.scene(app.state.scene) || R.scenes[0]; }

  function currentSpec() {
    const sc = scene();
    const extra = sc.explore.views || [];
    const base = app.state.step > sc.steps.length ? (extra[app.state.step - sc.steps.length - 1]?.view || sc.explore.view)
      : stepView(sc, app.state.step);
    return applyOverrides(base, app.state.ov, R);
  }

  function select(label, options, value, onchange, id) {
    const sel = h("select", { id, onchange: (e) => onchange(e.target.value) });
    for (const o of options) sel.append(h("option", { value: o.value, selected: String(o.value) === String(value) ? true : null, text: o.label }));
    return h("label", { class: "field" }, h("span", { text: label }), sel);
  }

  function renderBar() {
    clear(bar);
    const sc = scene();
    bar.append(select(t("explore.scene"), R.scenes.map((s) => ({ value: s.id, label: `${s.id} ${s.title}` })), sc.id, (v) => {
      app.state.scene = v; app.state.step = R.scene(v).steps.length; app.state.ov = {}; update();
    }, "x-scene"));
    const views = sc.steps.map((st, i) => ({ value: i + 1, label: st.caption }));
    (sc.explore.views || []).forEach((v, i) => views.push({ value: sc.steps.length + 1 + i, label: v.caption }));
    bar.append(select(t("explore.view"), views, app.state.step, (v) => { app.state.step = Number(v); update(); }, "x-step"));
    const spec = currentSpec();
    for (const c of sc.explore.controls || []) {
      if (c === "province") continue;
      if (c === "cadre_multi") {
        const opts = controlOptions(c, spec, R);
        const cur = new Set(spec.filter?.cadre || []);
        const fs = h("fieldset", { class: "field field--checks" }, h("legend", { text: controlLabel(c) }));
        for (const o of opts) fs.append(h("label", {}, h("input", { type: "checkbox", value: o.value, checked: cur.has(o.value) ? true : null,
          onchange: () => { const vals = [...fs.querySelectorAll("input:checked")].map((x) => x.value); app.state.ov.cadres = vals.join(","); update(); } }), o.label));
        bar.append(fs);
        continue;
      }
      const opts = controlOptions(c, spec, R);
      if (!opts.length) continue;
      const cur = c === "denominator" ? spec.denominator : c === "denominator_pair" ? spec.pair?.[1] : c === "year" ? (app.state.ov.year || "")
        : spec.filter?.[{ cadre: "cadre", scope: "scope", window: "window", tier: "tier", workforce: "workforce" }[c]];
      const options = c === "year" ? [{ value: "", label: t("explore.year_default") }, ...opts] : opts;
      bar.append(select(controlLabel(c), options, cur ?? "", (v) => { app.state.ov[OV_KEY[c]] = v; update(); }, `x-${c}`));
    }
    // province search: always available
    const dl = h("datalist", { id: "prov-list" }, ...[...R.provinces.values()].map((p) => h("option", { value: p.name_th })));
    const inp = h("input", { type: "search", list: "prov-list", placeholder: t("explore.province_placeholder"), "aria-label": t("explore.province"),
      value: app.state.ov.prov ? R.provinceName(app.state.ov.prov) : "",
      onchange: (e) => { const p = [...R.provinces.values()].find((x) => x.name_th === e.target.value.trim()); app.state.ov.prov = p ? p.prov_code : ""; update(); } });
    bar.append(h("label", { class: "field" }, h("span", { text: t("explore.province") }), inp, dl));
    bar.append(h("button", { class: "btn btn--ghost", type: "button", onclick: () => { app.state.ov = {}; update(); }, text: t("explore.reset") }));
    const snap = loadPresenter();
    if (snap?.scene) bar.append(h("button", { class: "btn btn--primary", type: "button", onclick: () => app.returnToPresenter(),
      text: t("explore.back", { id: snap.scene }) }));
  }

  function renderSide(spec) {
    clear(side);
    const sc = scene();
    const changed = Object.values(app.state.ov).some((v) => v);
    side.append(h("p", { class: "scene__kicker", text: `${sc.id} · ${R.chapter(sc.chapter).title}` }), h("h2", { class: "scene__title", text: sc.title }));
    side.append(h("p", { class: "explore__note", text: changed ? t("explore.changed_note") : t("explore.default_note") }));
    side.append(h("p", { class: "scene__headline", text: sc.headline.text }), h("p", { class: "scene__body", text: sc.body.text }));
    side.append(h("dl", { class: "kv" }, h("dt", { text: t("ribbon.time") }), h("dd", { text: sc.time }), h("dt", { text: t("ribbon.scope") }), h("dd", { text: sc.scope }),
      h("dt", { text: t("ribbon.den") }), h("dd", { text: sc.denominator })), evidenceBadge(R, spec.dataset ? R.ds(spec.dataset).meta.evidence : sc.evidence));
    side.append(h("div", { class: "explore__actions" },
      h("button", { class: "btn", type: "button", onclick: () => app.openSources(sc, spec), text: t("btn.sources") }),
      ...(R.capabilities.appendix ? sc.appendix || [] : []).map((a) => h("button", { class: "btn btn--ghost", type: "button", onclick: () => app.openAppendix(a), text: t("btn.appendix", { ids: a }) }))));
    if (sc.caveats.length) side.append(h("ul", { class: "scene__caveats" }, ...sc.caveats.map((c) => h("li", { text: c }))));
  }

  function renderTable(spec) {
    clear(tableBox);
    const tbl = viewRows(spec, R);
    const name = `${scene().id}_${spec.dataset || "table"}.csv`;
    const meta = [`release ${R.id}`, `scene ${scene().id}`, `dataset ${spec.dataset || "-"}`, `filter ${JSON.stringify(spec.filter || {})}`,
      ...(spec.dataset ? (R.ds(spec.dataset).sources || []).filter((s) => s.path || s.asset_id).map((s) =>
        `source ${s.path || s.asset_id}${s.sha256 ? ` sha256 ${s.sha256}` : ""}`) : []), t("explore.csv_missing"), t("explore.csv_years")];
    tableBox.append(h("div", { class: "explore__tablehead" }, h("h3", { text: t("explore.table_title", { n: tbl.rows.length }) }),
      h("button", { class: "btn", type: "button", onclick: () => download(name, toCSV(tbl, meta)), text: t("explore.download") })),
      dataTable(tbl, { caption: spec.dataset ? R.ds(spec.dataset).meta.title_th : scene().title, maxRows: 300 }));
  }

  function update() {
    hideTip();
    const spec = currentSpec();
    renderBar();
    renderSide(spec);
    requestAnimationFrame(() => mountView(stage, spec, app.viewCtx()));
    renderTable(spec);
    app.updateTopbar(scene(), Math.min(app.state.step, scene().steps.length));
    app.persist();
  }

  const onResize = () => { clearTimeout(onResize.t); onResize.t = setTimeout(() => mountView(stage, currentSpec(), app.viewCtx()), 150); };
  window.addEventListener("resize", onResize);
  update();
  return {
    render: update,
    goto(sceneId, step) { app.state.scene = sceneId; app.state.step = step || R.scene(sceneId).steps.length; app.state.ov = {}; update(); },
    destroy() {
      clearTimeout(onResize.t); window.removeEventListener("resize", onResize);
      stage.__view?.obj.destroy?.(); delete stage.__view;
      clear(main);
    },
  };
}
