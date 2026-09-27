// Every reader-facing string that is not scene content comes from
// config/web/ui_text.toml (shipped in the release as bundle.ui). t("key", {vars})
// fills {name} placeholders. With ?locate=1 in the URL, pin() tags elements with
// the file and line their text comes from, so wording can be found and edited.

let UI = {};
let LOC = null;
let LOCATE = false;

export function initText(bundle, { locate = false } = {}) {
  UI = bundle.ui || {};
  const authoring = bundle.publication?.capabilities?.authoring !== false;
  LOC = authoring ? bundle.loc || null : null;
  LOCATE = authoring && !!locate;
  document.documentElement.classList.toggle("locate", LOCATE);
}

export function t(key, vars = {}) {
  const s = UI[key];
  if (s == null) {
    console.warn("ui_text.toml has no key", key);
    return key;
  }
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export const locating = () => LOCATE;

// "config/web/ui_text.toml:123"
export function uiLoc(key) {
  const n = LOC?.ui?.ui?.[key];
  return n ? `${LOC.ui.file}:${n}` : null;
}

export function labelLoc(group, key) {
  const n = LOC?.ui?.label?.[`${group}.${key}`];
  return n ? `${LOC.ui.file}:${n}` : null;
}

// "config/web/scenes.toml:456" for a scene field ("title", "headline", "step:<id>", ...)
export function sceneLoc(sceneId, field) {
  if (field === "notes" && LOC?.speaker?.scene?.[sceneId]) return `${LOC.speaker.file}:${LOC.speaker.scene[sceneId]}`;
  const sc = LOC?.scenes?.scene?.[sceneId];
  const n = sc?.[field] ?? (field.startsWith("step:") ? null : sc?.id);
  return n ? `${LOC.scenes.file}:${n}` : null;
}

export function caseLoc(key) {
  const n = LOC?.scenes?.case_study?.[key];
  return n ? `${LOC.scenes.file}:${n}` : null;
}

export function chapterLoc(id) {
  const n = LOC?.scenes?.chapter?.[id];
  return n ? `${LOC.scenes.file}:${n}` : null;
}

export function appendixLoc(id) {
  const n = LOC?.scenes?.appendix?.[id];
  return n ? `${LOC.scenes.file}:${n}` : null;
}

export function metaLoc(key) {
  const n = LOC?.scenes?.meta?.[key];
  return n ? `${LOC.scenes.file}:${n}` : null;
}

// Tag an element with where its text lives (shown only in locate mode).
export function pin(el, where) {
  if (LOCATE && where && el) {
    el.dataset.loc = where.replace(/^config\/web\//, "");
    el.classList.add("has-loc");
  }
  return el;
}

// t() and pin() together for a plain HTML element's text.
export function tp(el, key, vars) {
  el.textContent = t(key, vars);
  return pin(el, uiLoc(key));
}
