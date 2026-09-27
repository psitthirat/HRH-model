// Boot: choose a release, load it, and hand the same data to whichever mode the
// URL asks for. Story, Present, Explore and Print share the scene registry, the
// chart components and the release; only layout and navigation differ.

import { h, clear } from "./util/dom.js";
import { loadIndex, chooseRelease, loadRelease } from "./data.js";
import { readState, writeState, savePresenter, loadPresenter, saveLabReturn, loadLabReturn, MODES } from "./state.js";
import { initPresent } from "./modes/present.js";
import { initStory } from "./modes/story.js";
import { initExplore } from "./modes/explore.js";
import { initPrint } from "./modes/print.js";
import { openDrawer, sourcesContent, releaseContent, appendixContent, helpContent } from "./ui/drawer.js";
import { stepView } from "./engine.js";
import { initText, t, tp, pin, uiLoc } from "./util/i18n.js";

const MODE_INIT = { present: initPresent, story: initStory, explore: initExplore, print: initPrint };
const MODE_KEYS = ["story", "present", "explore", "lab"];

async function boot() {
  const main = document.getElementById("main");
  const st = readState();
  let index, R;
  try {
    index = await loadIndex();
    const entry = chooseRelease(index, st.release);
    R = await loadRelease(entry, index);
  } catch (err) {
    console.error(err);
    clear(main).append(h("div", { class: "fatal" }, h("h1", { text: "เปิดข้อมูลไม่ได้" }), h("p", { text: String(err.message || err) }),
      h("p", { text: "ตรวจว่ารันคำสั่ง make story-data แล้ว และเปิดผ่าน make story-serve (ไม่ใช่เปิดไฟล์โดยตรง)" })));
    return;
  }
  initText(R.bundle, { locate: new URLSearchParams(location.search).has("locate") });
  document.title = t("top.brand");
  if (!st.mode) st.mode = "story";
  if (!st.scene || !R.scene(st.scene)) st.scene = st.mode === "explore" ? R.scenes[2].id : st.mode === "present" ? R.scenes[0].id : null;
  const pinned = !!st.release;

  const app = {
    R, main, state: st, current: null,
    viewCtx(extra = {}) {
      return { release: R, mode: app.state.mode, selected: app.state.ov?.prov ? [app.state.ov.prov] : [],
        onSelect: (code) => { if (app.state.mode === "explore") { app.state.ov.prov = code; app.current.render(); } },
        goto: (sid) => app.goto(sid), ...extra };
    },
    persist() {
      const s = { ...app.state, release: pinned || ["present", "lab"].includes(app.state.mode) ? R.id : null };
      if (app.state.mode === "lab") s.ov = app.state.ov?.prov ? { prov: app.state.ov.prov } : {};
      else if (app.state.mode !== "explore") s.ov = {};
      writeState(s);
    },
    updateTopbar(scene, step) {
      const where = document.querySelector(".topbar__where");
      if (!where) return;
      clear(where);
      if (scene) where.append(h("span", { class: "topbar__chapter", text: t("scene.chapter", { id: scene.chapter, title: R.chapter(scene.chapter).title }) }),
        h("span", { class: "topbar__scene", text: t("scene.counter", { n: scene.order, total: R.scenes.length }) }));
    },
    switchMode(mode) {
      if (!MODES.includes(mode)) return;
      if (mode === "lab") return app.enterLab();
      if (app.state.mode === "present" && mode === "explore") savePresenter({ ...app.state, release: R.id });
      if (mode === "explore" && !app.state.scene) app.state.scene = R.scenes[2].id;
      if (mode === "present" && !app.state.scene) { app.state.scene = R.scenes[0].id; app.state.step = 1; }
      if (mode !== "explore") app.state.ov = {};
      app.state.mode = mode;
      writeState({ ...app.state, release: pinned || mode === "present" ? R.id : null }, { push: true });
      mount();
    },
    labEntry(sceneId) { return R.bundle.lab?.scene_map?.[sceneId]; },
    enterLab(context = null) {
      if (app.state.mode !== "lab") saveLabReturn({ ...app.state, release: R.id });
      app.labEntryContext = context || { kind: "main_menu" };
      app.state = { ...app.state, mode: "lab", labView: null,
        labPreset: context?.preset_id || (context?.scene ? `scene:${context.scene}` : null) };
      writeState({ ...app.state, release: R.id }, { push: true });
      mount();
    },
    returnFromLab() {
      app.state = loadLabReturn() || { mode: "present", scene: R.scenes[0].id, step: 1, ov: {}, lang: app.state.lang };
      writeState({ ...app.state, release: R.id }, { push: true });
      mount();
    },
    returnToPresenter() {
      const snap = loadPresenter();
      if (!snap) return app.switchMode("present");
      if (snap.release && snap.release !== R.id) { location.search = `?mode=present&scene=${snap.scene}&step=${snap.step}&release=${snap.release}`; return; }
      app.state = { ...app.state, mode: "present", scene: snap.scene, step: snap.step, ov: {} };
      writeState({ ...app.state, release: R.id }, { push: true });
      mount();
    },
    goto(sceneId, step = 1) {
      if (app.current?.goto) app.current.goto(sceneId, step);
    },
    remount() { mount(); },
    openSources(scene, spec) {
      openDrawer(t("drawer.sources_title"), sourcesContent(R, scene, spec || stepView(scene, Math.min(app.state.step || 1, scene.steps.length)),
        { onAppendix: app.openAppendix }));
    },
    async openAppendix(id) {
      if (!R.capabilities.appendix) return;
      const a = R.appendixEntry(id);
      const title = `${t("btn.appendix", { ids: id })}: ${a?.title ?? ""}`;
      openDrawer(title, h("p", { text: t("drawer.loading") }));
      const content = await appendixContent(R, id, { onGoto: (sid) => { app.goto(sid); } });
      openDrawer(title, content);
    },
    openRelease() { openDrawer(t("drawer.release_title"), releaseContent(R)); },
    openHelp() { openDrawer(t("drawer.help_title"), helpContent(R)); },
    openNotes() {
      if (!R.capabilities.notes) return;
      const url = `notes.html?release=${encodeURIComponent(R.id)}`;
      window.open(url, "story-notes", "width=760,height=900");
    },
    toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    },
  };

  buildTopbar(app, R, pinned);
  let mountGeneration = 0;
  async function mount() {
    const generation = ++mountGeneration;
    app.current?.destroy?.();
    app.current = null;
    initText(R.bundle, { locate: new URLSearchParams(location.search).has("locate") });
    document.documentElement.lang = app.state.mode === "lab" ? app.state.lang || "th" : "th";
    document.body.className = `mode-${app.state.mode}`;
    document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === app.state.mode)));
    if (app.state.mode === "lab") {
      clear(main).append(h("p", { class: "loading", text: "กำลังเปิด Workforce Lab…" }));
      try {
        const { initLab } = await import("./lab/main.js");
        if (generation !== mountGeneration) return;
        const controller = await initLab(app, { isCurrent: () => generation === mountGeneration });
        if (generation !== mountGeneration) controller?.destroy?.();
        else app.current = controller;
      } catch (error) {
        if (generation === mountGeneration) clear(main).append(h("div", { class: "fatal" },
          h("h1", { text: "เปิด Lab ไม่สำเร็จ" }), h("p", { text: error.message }),
          h("button", { class: "btn", text: "กลับไปยังสไลด์", onclick: app.returnFromLab })));
        console.error(error);
      }
    } else app.current = MODE_INIT[app.state.mode](app);
  }
  window.addEventListener("popstate", () => { app.state = readState(); if (!app.state.mode) app.state.mode = "story"; mount(); });
  // SVG margins are measured from text. Draw after the local font is ready.
  await document.fonts.ready;
  mount();
  window.__story = app; // for tests and debugging
}

function buildTopbar(app, R, pinned) {
  const bar = document.querySelector(".topbar");
  clear(bar);
  const f = R.manifest.freshness?.status || "unknown";
  const badge = pin(h("button", { class: `release-badge release-badge--${R.status} fresh--${f}`, type: "button", onclick: () => app.openRelease(),
    title: t("top.release_title") },
    h("span", { text: R.status === "promoted" ? t("top.release_promoted") : t("top.release_draft") }), " ", h("code", { text: R.id.slice(0, 15) }),
    f === "stale" ? h("strong", { text: t("top.fresh_stale") }) : f !== "fresh" ? h("span", { text: t("top.fresh_check") }) : "",
    pinned ? h("span", { text: t("top.pinned") }) : ""), uiLoc("top.release_draft"));
  bar.append(
    tp(h("a", { class: "topbar__brand", href: "?mode=story" }), "top.brand"),
    h("div", { class: "topbar__where", "aria-live": "polite" }),
    h("nav", { class: "modes", "aria-label": t("top.modes") }, ...MODE_KEYS.map((m) =>
      tp(h("button", { type: "button", "data-mode": m, "aria-pressed": "false", title: m === "lab" ? "ทดลองแผนจัดสรรกำลังคน" : null, onclick: () => app.switchMode(m) }), `mode.${m}`))),
    h("div", { class: "topbar__tools" },
      R.capabilities.notes ? tp(h("button", { class: "btn btn--ghost only-present", type: "button", onclick: () => app.openNotes() }), "top.notes") : "",
      tp(h("button", { class: "btn btn--ghost only-present", type: "button", onclick: () => app.toggleFullscreen() }), "top.fullscreen"),
      h("button", { class: "btn btn--ghost", type: "button", "aria-label": t("top.help"), onclick: () => app.openHelp(), text: "?" }),
      badge));
}

boot();
