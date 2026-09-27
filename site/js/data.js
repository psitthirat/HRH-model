// Loads one immutable release and exposes its tables, facts, scenes and labels.
// Nothing here computes a research quantity: it filters and looks up.

const BASE = new URL("../data/", import.meta.url);

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`โหลดไม่สำเร็จ: ${url} (${r.status})`);
  return r.json();
}

export async function loadIndex() {
  return getJSON(new URL("releases.json", BASE));
}

// Which release to show: an explicit ?release= wins; otherwise the promoted
// "current" release; otherwise the latest draft (labelled as a draft in the UI).
export function chooseRelease(index, requested) {
  if (requested) {
    const r = index.releases.find((x) => x.id === requested);
    if (!r) throw new Error(`ไม่พบ release ${requested}`);
    return r;
  }
  const id = index.current || index.latest;
  const r = index.releases.find((x) => x.id === id);
  if (!r) throw new Error("ยังไม่มี release: รัน make story-data");
  return r;
}

export class Release {
  constructor(entry, bundle, manifest, geo, index) {
    this.entry = entry;
    this.id = entry.id;
    this.bundle = bundle;
    // Publication packages remove private content before it reaches the browser.
    // Capabilities only keep the corresponding controls out of that package's UI.
    const allowed = bundle.publication?.capabilities || {};
    this.capabilities = Object.freeze(Object.fromEntries(
      ["notes", "appendix", "authoring"].map((key) => [key, allowed[key] !== false])));
    this.manifest = manifest;
    this.geo = geo;
    this.index = index;
    this.vocab = bundle.vocab;
    this._rows = new Map();
    this._appendix = null;
    this.scenes = bundle.scenes;
    this.cases = bundle.case_studies || [];                 // [{key, code, name, role, role_type, role_ok}]
    this.caseStudies = this.cases.map((c) => c.code);
    this.caseByCode = new Map(this.cases.map((c) => [c.code, c]));
    this.provinces = new Map(this.rows("provinces").map((r) => [r.prov_code, r]));
    this.geoByCode = new Map(geo.provinces.map((p) => [p.code, p]));
  }

  get isPinnedCurrent() { return this.index.current === this.id; }
  get status() { return this.index.current === this.id ? "promoted" : this.entry.status; }

  ds(id) {
    const d = this.bundle.datasets[id];
    if (!d) throw new Error(`dataset ${id} not in release ${this.id}`);
    return d;
  }

  rows(id) {
    if (!this._rows.has(id)) {
      const d = this.ds(id);
      const cols = d.columns;
      this._rows.set(id, d.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))));
    }
    return this._rows.get(id);
  }

  select(id, filter = {}) {
    let rows = this.rows(id);
    for (const [k, v] of Object.entries(filter || {})) {
      const vals = Array.isArray(v) ? v : [v];
      rows = rows.filter((r) => vals.includes(r[k]));
    }
    return rows;
  }

  distinct(id, col, filter = {}) {
    const out = [];
    for (const r of this.select(id, filter)) if (!out.includes(r[col])) out.push(r[col]);
    return out;
  }

  fact(id) { return this.bundle.facts[id]; }
  scene(id) { return this.scenes.find((s) => s.id === id); }
  sceneIndex(id) { return this.scenes.findIndex((s) => s.id === id); }
  chapter(id) { return this.bundle.chapters.find((c) => c.id === id); }
  get appendices() { return this.capabilities.appendix ? this.bundle.appendix || [] : []; }
  appendixEntry(id) { return this.appendices.find((a) => a.id === id); }

  async appendixTables() {
    if (!this.capabilities.appendix) return { tables: {} };
    if (!this._appendix) this._appendix = getJSON(new URL(`releases/${this.id}/appendix.json`, BASE));
    return this._appendix;
  }

  // highlight: "case_studies" = all of them; a list = codes resolved by the exporter from case-study keys
  highlightCodes(spec) {
    if (spec.highlight === "case_studies") return this.caseStudies;
    return Array.isArray(spec.highlight) ? spec.highlight : [];
  }

  provinceName(code) { return this.provinces.get(String(code))?.name_th ?? String(code); }

  label(kind, id) {
    const V = this.vocab;
    const table = {
      cadre: V.cadres, scope: V.workforce_scopes, denominator: V.denominators,
      comparison_denominators: V.comparison_denominators, metric: V.service_metrics,
      outcome: V.model_outcomes, scenario: V.scenarios, evidence: V.evidence, geo: V.geo_sets,
    }[kind];
    if (kind === "exit_type") return V.exit_types[id] ?? id;
    if (kind === "step") return V.model_steps[id] ?? id;
    if (kind === "tier") return { moph_service: V.service_scopes.moph_service.th, all_reporting: V.service_scopes.all_reporting.th }[id] ?? id;
    if (kind === "window") return V.windows?.[id] ?? id;
    if (kind === "variant") return V.variants?.[id] ?? id;
    if (kind === "quartile") return V.quartiles?.[id] ?? id;
    if (kind === "workforce") return V.workforce_scopes[id]?.short ?? V.workforce_scopes[id]?.th ?? id;
    const e = table?.[id];
    if (!e) return String(id);
    return e.short && kind !== "denominator" ? e.short : e.th ?? e;
  }

  shortLabel(kind, id) {
    const e = { denominator: this.vocab.denominators, scope: this.vocab.workforce_scopes }[kind]?.[id];
    return e?.short ?? this.label(kind, id);
  }
}

export async function loadRelease(entry, index) {
  const root = new URL(`releases/${entry.id}/`, BASE);
  const [bundle, manifest, geo] = await Promise.all([
    getJSON(new URL("bundle.json", root)), getJSON(new URL("manifest.json", root)), getJSON(new URL("geo.json", root)),
  ]);
  if (bundle.release_id !== entry.id) throw new Error("release files do not match the index (mixed versions)");
  return new Release(entry, bundle, manifest, geo, index);
}
