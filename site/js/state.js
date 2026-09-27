// Shareable state lives in the query string (no hash routing, so the two never
// disagree). Example: ?mode=present&scene=S14&step=2&release=<id>
// Explore adds temporary overrides (cadre, scope, den, year, ...) that are never
// written back into the presenter's prepared state.

export const MODES = ["story", "present", "explore", "print"];
const OVERRIDES = ["cadre", "scope", "den", "pair", "year", "window", "tier", "wf", "prov", "cadres", "view"];

export function readState(search = location.search) {
  const q = new URLSearchParams(search);
  const st = {
    mode: MODES.includes(q.get("mode")) ? q.get("mode") : null,
    release: q.get("release") || null,
    scene: (q.get("scene") || "").toUpperCase() || null,
    step: Math.max(1, parseInt(q.get("step") || "1", 10) || 1),
    ov: {},
  };
  for (const k of OVERRIDES) if (q.get(k)) st.ov[k] = q.get(k);
  return st;
}

export function toQuery(st, { includeOverrides = true } = {}) {
  const q = new URLSearchParams();
  if (st.mode) q.set("mode", st.mode);
  if (st.scene) q.set("scene", st.scene);
  if (st.step && st.step > 1) q.set("step", String(st.step));
  if (st.release) q.set("release", st.release);
  if (includeOverrides) for (const [k, v] of Object.entries(st.ov || {})) if (v != null && v !== "") q.set(k, v);
  return "?" + q.toString();
}

export function writeState(st, { push = false } = {}) {
  const url = location.pathname + toQuery(st);
  if (url === location.pathname + location.search) return;
  (push ? history.pushState : history.replaceState).call(history, null, "", url);
}

// The presenter's prepared position, kept apart from Explore's experiments.
const KEY = "story.presenter";
export function savePresenter(st) {
  const snap = { scene: st.scene, step: st.step, release: st.release, mode: st.mode };
  try { sessionStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* storage may be blocked */ }
  savePresenter.mem = snap;
}
export function loadPresenter() {
  if (savePresenter.mem) return savePresenter.mem;
  try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; }
}
