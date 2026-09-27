// Present: one scene fills the viewport; the presenter moves with the keyboard.
// No autoplay. The stage element persists from scene to scene, so a province
// keeps its identity when the drawing changes (mosaic -> map, map -> map).
// Speaker notes live in a separate window (notes.html) fed by BroadcastChannel.

import { h, clear } from "../util/dom.js";
import { sceneFrame, setStepCaption, mountView, stepView } from "../engine.js";
import { hideTip } from "../charts/core.js";
import { t } from "../util/i18n.js";

const CHANNEL = "story-present";

export function initPresent(app) {
  const { R, main } = app;
  clear(main);
  const root = h("div", { class: "present" });
  const TOTAL = R.bundle.meta.total_seconds || R.scenes.reduce((a, sc) => a + sc.duration_seconds, 0);
  const progress = h("div", { class: "present__progress", role: "progressbar", "aria-label": t("present.progress"),
    "aria-valuemin": 0, "aria-valuemax": TOTAL }, h("span"));
  const nav = h("nav", { class: "present__nav", "aria-label": t("present.nav") },
    h("button", { class: "btn btn--nav", type: "button", "aria-label": t("present.prev"), onclick: () => move(-1), text: "‹" }),
    h("span", { class: "present__pos", "aria-live": "polite" }),
    h("button", { class: "btn btn--nav", type: "button", "aria-label": t("present.next"), onclick: () => move(1), text: "›" }));
  root.append(progress);
  main.append(root, nav);
  const stage = h("div", { class: "scene__stage present__stage" });
  let F = null;
  const bc = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;

  function render() {
    const st = app.state;
    let scene = R.scene(st.scene) || R.scenes[0];
    st.scene = scene.id;
    st.step = Math.min(Math.max(1, st.step), scene.steps.length);
    if (!F || F.scene.id !== scene.id) {
      hideTip();
      F = sceneFrame(R, scene, { mode: "present", onSources: app.openSources, onExplore: () => app.switchMode("explore"),
        onAppendix: app.openAppendix, onLab: () => app.enterLab({ scene: scene.id, step: app.state.step }) });
      F.frame.replaceChild(stage, F.stage);   // keep the same stage element across scenes
      F.stage = stage;
      clear(root); root.append(progress, F.frame);
      document.title = `${scene.id} ${scene.title} · ${R.bundle.meta.title}`;
    }
    setStepCaption(F, st.step);
    requestAnimationFrame(() => mountView(stage, stepView(scene, st.step), app.viewCtx()));
    nav.querySelector(".present__pos").textContent = t("present.pos", { id: scene.id, i: st.step, n: scene.steps.length });
    const pos = scene.start_seconds + (scene.duration_seconds * (st.step - 1)) / scene.steps.length;
    progress.firstChild.style.width = `${(pos / TOTAL) * 100}%`;
    progress.setAttribute("aria-valuenow", Math.round(pos));
    app.updateTopbar(scene, st.step);
    app.persist();
    bc?.postMessage({ type: "state", release: R.id, scene: scene.id, step: st.step, t: Date.now() });
  }

  function move(dir) {
    const st = app.state;
    const i = R.sceneIndex(st.scene);
    const sc = R.scenes[i];
    if (dir > 0) {
      if (st.step < sc.steps.length) st.step += 1;
      else if (i < R.scenes.length - 1) { st.scene = R.scenes[i + 1].id; st.step = 1; }
    } else {
      if (st.step > 1) st.step -= 1;
      else if (i > 0) { st.scene = R.scenes[i - 1].id; st.step = R.scenes[i - 1].steps.length; }
    }
    render();
  }

  function isTyping(e) {
    const el = e.target;
    return el.closest?.("input, select, textarea, summary, [contenteditable], dialog, .drawer") != null;
  }

  function onKey(e) {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " ") { e.preventDefault(); move(1); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); move(-1); }
    else if (k === "Home") { e.preventDefault(); app.state.scene = R.scenes[0].id; app.state.step = 1; render(); }
    else if (k === "End") { e.preventDefault(); app.state.scene = R.scenes[R.scenes.length - 1].id; app.state.step = 1; render(); }
    else if (k === "n" || k === "N") app.openNotes();
    else if (k === "f" || k === "F") app.toggleFullscreen();
    else if (k === "e" || k === "E") app.switchMode("explore");
    else if (k === "?") app.openHelp();
  }
  document.addEventListener("keydown", onKey);
  if (bc) bc.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === "nav") move(m.dir);
    if (m.type === "goto" && R.scene(m.scene)) { app.state.scene = m.scene; app.state.step = m.step || 1; render(); }
    if (m.type === "hello") render();
  };
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { mountView(stage, stepView(R.scene(app.state.scene), app.state.step), { ...app.viewCtx(), resized: true }); }, 120); };
  window.addEventListener("resize", onResize);
  document.addEventListener("fullscreenchange", onResize);
  const observer = new ResizeObserver(onResize);
  observer.observe(stage);

  render();
  return {
    render, goto(sceneId, step = 1) { app.state.scene = sceneId; app.state.step = step; render(); },
    destroy() { clearTimeout(rt); observer.disconnect(); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); document.removeEventListener("fullscreenchange", onResize); stage.__view?.obj.destroy?.(); bc?.close(); clear(main); },
  };
}
