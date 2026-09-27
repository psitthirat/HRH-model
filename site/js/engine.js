// Scene engine shared by Story, Present, Explore and Print.
//
// renderScene() builds everything a scene shows from (release, scene, step,
// overrides) alone; the previous state is used only to let a component animate
// from where it was. Jumping to any scene/step, a direct link, a resize or a
// reduced-motion setting therefore all produce the same final picture.

import { h, clear } from "./util/dom.js";
import { be, num } from "./util/format.js";
import { evidenceBadge, bindTip, tipHTML } from "./charts/core.js";
import { ProvinceStage } from "./charts/provinces.js";
import { Lines } from "./charts/lines.js";
import { Bars } from "./charts/bars.js";
import { Dots } from "./charts/dots.js";
import { Dumbbell } from "./charts/dumbbell.js";
import { Bridge } from "./charts/bridge.js";
import { Stack } from "./charts/stack.js";
import { Cards } from "./charts/cards.js";
import { TextPanel } from "./charts/text.js";
import { TitleCard } from "./charts/titlecard.js";
import { Scatter } from "./charts/scatter.js";
import { TimeBudget } from "./charts/timebudget.js";
import { HalfLife } from "./charts/halflife.js";
import { Waterfall } from "./charts/waterfall.js";
import { Alloc } from "./charts/alloc.js";
import { t, pin, uiLoc, sceneLoc, chapterLoc } from "./util/i18n.js";

const REGISTRY = { provinces: ProvinceStage, lines: Lines, bars: Bars, dots: Dots, dumbbell: Dumbbell,
  bridge: Bridge, stack: Stack, cards: Cards, text: TextPanel, scatter: Scatter, timebudget: TimeBudget,
  halflife: HalfLife, waterfall: Waterfall, alloc: Alloc, titlecard: TitleCard };
const WIDE = new Set(["text"]);

export function stepView(scene, stepIdx) {
  const i = Math.min(Math.max(1, stepIdx), scene.steps.length) - 1;
  return scene.steps[i].view;
}

// Mount (or update) a view in a stage element. The instance is reused when the
// component type is unchanged, which is what gives provinces their identity.
export function mountView(stageEl, spec, ctx) {
  let inst = stageEl.__view;
  if (!inst || inst.type !== spec.component) {
    inst?.obj.destroy?.();
    clear(stageEl);
    const C = REGISTRY[spec.component];
    if (!C) { stageEl.append(h("p", { class: "empty", text: t("view.unknown", { name: spec.component }) })); return null; }
    inst = { type: spec.component, obj: new C(stageEl, ctx) };
    stageEl.__view = inst;
  }
  stageEl.dataset.component = spec.component;
  try {
    inst.obj.update(spec, ctx);
  } catch (err) {
    console.error(err);
    clear(stageEl);
    stageEl.__view = null;
    stageEl.append(h("p", { class: "empty", text: t("view.error") }));
  }
  return inst.obj;
}

// ---------------------------------------------------------------- explore overrides
export function applyOverrides(spec, ov = {}, R) {
  const v = structuredClone(spec);
  v.filter = { ...(v.filter || {}) };
  const set = (k, val) => { if (val != null && val !== "") v.filter[k] = val; };
  if (ov.cadre && "cadre" in (spec.filter || {})) set("cadre", ov.cadre);
  if (ov.cadres) v.filter.cadre = ov.cadres.split(",");
  if (ov.scope && ("scope" in (spec.filter || {}))) set("scope", ov.scope);
  if (ov.window) set("window", ov.window);
  if (ov.tier) set("tier", ov.tier);
  if (ov.wf) set("workforce", ov.wf);
  if (ov.den && v.component === "provinces" && v.fill === "membership") v.denominator = ov.den;
  if (ov.pair && v.component === "provinces" && v.fill === "relative") v.pair = ["population", ov.pair];
  if (ov.year && v.component === "provinces" && v.fill === "density") v.years = ov.year.split(",");
  return v;
}

// Options for a control, read from the data (never hard-coded lists).
export function controlOptions(control, spec, R) {
  const ds = spec.dataset;
  const others = (col) => Object.fromEntries(Object.entries(spec.filter || {}).filter(([k]) => k !== col));
  const col = { cadre: "cadre", cadre_multi: "cadre", scope: "scope", window: "window", tier: "tier", workforce: "workforce" }[control];
  if (col && ds) {
    let vals = R.distinct(ds, col, others(col));
    if (col === "cadre") vals.sort((a, b) => R.vocab.cadres[a].order - R.vocab.cadres[b].order);
    const kind = { cadre: "cadre", scope: "workforce", window: "window", tier: "tier", workforce: "workforce" }[col];
    return vals.filter((x) => x != null).map((x) => ({ value: x, label: R.label(kind, x) }));
  }
  if (control === "denominator") return [...R.vocab.core_six, "intersection", ...Object.keys(R.vocab.denominators).filter((d) => !R.vocab.core_six.includes(d))]
    .map((d) => ({ value: d, label: d === "intersection" ? t("explore.intersection") : R.label("denominator", d) }));
  if (control === "denominator_pair") return Object.keys(R.vocab.denominators).filter((d) => d !== "population")
    .map((d) => ({ value: d, label: `${t("explore.pair_prefix")} ${R.label("denominator", d)}` }));
  if (control === "year" && ds) {
    const ys = R.distinct(ds, "year", spec.filter).sort((a, b) => a - b);
    return ys.map((y) => ({ value: String(y), label: t("chart.year_be", { y: be(y) }) }));
  }
  return [];
}

// The rows a view shows, for the table view and the CSV download.
export function viewRows(spec, R) {
  if (!spec.dataset) {
    if (spec.rows) return { columns: spec.headers.map((x, i) => ({ key: i, label: x })), rows: spec.rows.map((r) => ({ ...r })) };
    return { columns: [], rows: [] };
  }
  let rows = R.select(spec.dataset, spec.filter);
  if (spec.component === "provinces") {
    if (spec.fill === "sequential") { /* rows as filtered */ }
    else if (spec.fill === "density") {
      const ys = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
      const want = (spec.years || ["last"]).map((y) => (y === "first" ? ys[0] : y === "last" ? ys[ys.length - 1] : Number(y)));
      rows = rows.filter((r) => want.includes(r.year));
    } else if (spec.fill === "membership") rows = rows.filter((r) => (spec.denominators || R.vocab.core_six).includes(r.denominator));
    else if (spec.fill === "relative") rows = rows.filter((r) => (spec.pair || []).includes(r.denominator));
  }
  if (spec.reveal && spec.component === "lines" && spec.series) rows = rows.filter((r) => spec.reveal.includes(r[spec.series]));
  const meta = R.ds(spec.dataset);
  let columns = meta.columns.map((c) => ({ key: c, label: c }));
  if (columns.some((c) => c.key === "prov_code")) {
    rows = rows.map((r) => ({ province: R.provinceName(r.prov_code), ...r }));
    columns = [{ key: "province", label: t("chart.province") }, ...columns];
  }
  return { columns, rows, dataset: spec.dataset };
}

// ---------------------------------------------------------------- scene frame
export function sceneFrame(R, scene, { mode, onSources, onExplore, onAppendix } = {}) {
  const ch = R.chapter(scene.chapter);
  const wide = WIDE.has(scene.steps[0].view.component);
  const frame = h("section", { class: `scene scene--${scene.evidence}${wide ? " scene--wide" : ""}`, "data-scene": scene.id,
    "aria-labelledby": `t-${scene.id}` });
  const stage = h("div", { class: "scene__stage" });
  const kicker = h("p", { class: "scene__kicker" },
    pin(h("span", { text: t("scene.chapter", { id: ch.id, title: ch.title }) }), chapterLoc(ch.id)),
    h("span", { class: "scene__num", text: t("scene.counter", { n: scene.order, total: R.scenes.length }) }));
  const title = pin(h("h2", { class: "scene__title", id: `t-${scene.id}`, text: scene.title }), sceneLoc(scene.id, "title"));
  const headline = pin(h("p", { class: "scene__headline", text: scene.headline.text }), sceneLoc(scene.id, "headline"));
  const body = pin(h("p", { class: "scene__body", text: scene.body.text }), sceneLoc(scene.id, "body"));
  const detailTable = h("div", { class: "scene__data-summary" });
  const step = h("p", { class: "scene__step", "aria-live": "polite" });
  const caveats = pin(h("ul", { class: "scene__caveats" }, ...scene.caveats.map((c) => h("li", { text: c }))), sceneLoc(scene.id, "caveats"));
  const bodyContent = mode === "present" && scene.id === "S24"
    ? h("div", { class: "scene__body" }, h("button", { class: "btn btn--ghost", type: "button", text: t("btn.result_details"), onclick: () => onSources?.(scene) }))
    : body;
  const text = h("div", { class: "scene__text" }, kicker, title, headline, bodyContent, detailTable, step, scene.caveats.length ? caveats : "");
  const info = h("button", { class: "btn scene__info", type: "button", text: "ⓘ", "aria-label": t("scene.interpretation"),
    onclick: () => onSources?.(scene) });
  bindTip(info, () => tipHTML(t("scene.interpretation"), scene.caveats.map(c => ["", c])));
  const item = (k, label, field) => pin(h("span", { class: "ribbon__item", "data-k": k }, h("b", { text: t(label) + " " }), scene[field]),
    sceneLoc(scene.id, field));
  const ribbon = h("footer", { class: "ribbon" },
    item("time", "ribbon.time", "time"), item("scope", "ribbon.scope", "scope"), item("den", "ribbon.den", "denominator"),
    evidenceBadge(R, scene.evidence),
    h("span", { class: "ribbon__actions" },
      scene.caveats.length ? info : "",
      h("button", { class: "btn btn--ghost", type: "button", onclick: () => onSources?.(scene), text: t("btn.sources") }),
      R.capabilities.appendix && scene.appendix?.length ? h("button", { class: "btn btn--ghost", type: "button", onclick: () => onAppendix?.(scene.appendix[0]), text: t("btn.appendix", { ids: scene.appendix.join(", ") }) }) : "",
      mode !== "explore" && mode !== "print" ? h("button", { class: "btn btn--ghost", type: "button", onclick: () => onExplore?.(scene), text: t("btn.explore") }) : ""));
  frame.append(text, stage, ribbon);
  return { frame, stage, step, text, ribbon, scene, title, headline, body, detailTable, R };
}

export function setStepCaption(F, stepIdx) {
  const sc = F.scene;
  const i = Math.min(Math.max(1, stepIdx), sc.steps.length);
  const view = sc.steps[i - 1].view;
  const current = sc.steps[i - 1];
  F.headline.textContent = current.headline?.text || sc.headline.text;
  F.body.textContent = current.body?.text ?? sc.body.text;
  for (const [key, field] of [["time", "time"], ["scope", "scope"], ["den", "denominator"]]) {
    const item = F.ribbon.querySelector(`[data-k="${key}"]`);
    if (item?.lastChild) item.lastChild.textContent = current[field] ?? sc[field];
  }
  F.ribbon.querySelector('.badge')?.replaceWith(evidenceBadge(F.R, current.evidence || sc.evidence));
  renderEndpointSummary(F.detailTable, view.endpoint_table, F.R);
  if (view.side_items?.length) F.detailTable.append(h("ul", { class: "scene__agenda" },
    ...view.side_items.map(text => h("li", { text }))));
  // Layout follows the current view, including scenes that change chart type.
  const overview = ["S02", "S16", "S17", "S17V", "S18", "S24"].includes(sc.id) || view.component === "timebudget" || (sc.id === "S04" && view.component === "bars");
  F.frame.dataset.layout = view.side_placement === "narrative" ? "map-ranking" : view.component === "text" ? "overview" : overview ? "overview" :
    ["S04", "S14", "S20"].includes(sc.id) && ["bars", "dumbbell"].includes(view.component) ? "compact" : "chart";
  F.frame.dataset.component = view.component;
  F.step.textContent = "";
  F.step.append(h("span", { class: "scene__stepno", text: t("scene.step", { i, n: sc.steps.length }) }), " ", sc.steps[i - 1].caption);
  pin(F.step, sceneLoc(sc.id, `step:${sc.steps[i - 1].id}`));
}

// Raw values accompany indexed charts without becoming fixed prose constants.
function renderEndpointSummary(container, spec, R) {
  clear(container);
  if (!spec?.dataset) return;
  const rows = R.select(spec.dataset, spec.filter || {});
  const years = [...new Set(rows.map(r => r.year))].sort((a, b) => a - b);
  if (!years.length) return;
  const first = years[0], last = years.at(-1);
  const fields = spec.group_by || ["cadre"];
  const groups = new Map();
  for (const r of rows) {
    const key = fields.map(f => r[f]).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const table = h("table", { class: "endpoint-table" },
    h("caption", { text: spec.title || t("scene.raw_data") }),
    h("thead", {}, h("tr", {}, h("th", { scope: "col", text: spec.label || t("explore.cadre") }),
      h("th", { scope: "col", text: spec.per_row_years ? t("scene.first_available") : be(first) }),
      h("th", { scope: "col", text: spec.per_row_years ? t("scene.last_available") : be(last) }))));
  const tbody = h("tbody");
  for (const rs of groups.values()) {
    const r = rs[0];
    const label = fields.map(f => R.label(f, r[f])).join(" · ");
    const valid = rs.filter(x => x[spec.value] != null).sort((a, b) => a.year - b.year);
    const val = (year, endpoint) => {
      const row = spec.per_row_years ? (endpoint === "start" ? valid[0] : valid.at(-1)) : rs.find(x => x.year === year);
      const value = row?.[spec.value];
      return value == null ? "—" : num(value, spec.digits ?? 0) + (spec.per_row_years ? ` (${be(row.year)})` : "");
    };
    tbody.append(h("tr", {}, h("th", { scope: "row", text: label }), h("td", { text: val(first, "start") }), h("td", { text: val(last, "end") })));
  }
  table.append(tbody); container.append(table);
}
