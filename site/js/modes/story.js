// Story: native scrolling. On wide screens the text scrolls past a sticky stage
// that updates as each step card crosses the middle of the viewport (no scroll
// hijacking). On narrow screens each scene shows its text followed by its own
// chart, rendered when it approaches the viewport.

import { h, clear } from "../util/dom.js";
import { sceneFrame, setStepCaption, mountView, stepView } from "../engine.js";
import { evidenceBadge, hideTip } from "../charts/core.js";
import { t, tp, pin, uiLoc, metaLoc, sceneLoc } from "../util/i18n.js";

export function initStory(app) {
  const { R, main } = app;
  clear(main);
  const narrow = matchMedia("(max-width: 820px)").matches;
  const meta = R.bundle.meta;
  const root = h("div", { class: "story" + (narrow ? " story--narrow" : "") });
  const project = R.bundle.project || {};
  const intro = h("header", { class: "story__intro" },
    pin(h("p", { class: "eyebrow", text: t("story.eyebrow", { name: project.name ?? "" }) }), uiLoc("story.eyebrow")),
    pin(h("h1", { text: meta.title }), metaLoc("title")), pin(h("p", { class: "story__question", text: meta.question }), metaLoc("question")),
    pin(h("p", { class: "story__take", text: meta.take_home }), metaLoc("take_home")),
    h("div", { class: "story__cta" },
      tp(h("button", { class: "btn btn--primary", type: "button", onclick: () => app.switchMode("present") }), "story.cta_present"),
      tp(h("button", { class: "btn", type: "button", onclick: () => app.switchMode("explore") }), "story.cta_explore"),
      tp(h("a", { class: "btn btn--ghost", href: "?mode=print" }), "story.cta_print")),
    pin(h("p", { class: "chart-note", text: t("story.source", { report: project.report ?? "", title: meta.source_title }) }), metaLoc("source_title")),
    tp(h("p", { class: "chart-note" }), "story.release_note"));
  root.append(intro);
  main.append(root);

  const textCol = h("div", { class: "story__text" });
  const blocks = [];
  const frames = new Map();
  let stickyStage, stageHead, stageRibbon;
  if (!narrow) {
    stickyStage = h("div", { class: "scene__stage story__stage" });
    stageHead = h("p", { class: "story__stagehead", "aria-live": "polite" });
    stageRibbon = h("div", { class: "story__ribbon" });
    root.append(h("div", { class: "story__grid" }, textCol, h("div", { class: "story__sticky" }, stageHead, stickyStage, stageRibbon)));
  } else root.append(textCol);

  for (const sc of R.scenes) {
    const F = sceneFrame(R, sc, { mode: "story", onSources: app.openSources, onAppendix: app.openAppendix,
      onExplore: () => { app.state.scene = sc.id; app.state.step = sc.steps.length; app.switchMode("explore"); } });
    frames.set(sc.id, F);
    setStepCaption(F, narrow ? sc.steps.length : 1);
    const block = h("article", { class: "story-scene", id: `scene-${sc.id}`, "data-scene": sc.id }, F.text, F.ribbon);
    textCol.append(block);
    if (narrow) {
      const inline = h("div", { class: "scene__stage story__inline", "data-scene": sc.id });
      block.insertBefore(inline, F.ribbon);
      blocks.push({ sc, inline, rendered: false });
      block.append(h("ol", { class: "story-steps" }, ...sc.steps.map((st, i) => h("li", { text: st.caption }))));
    } else {
      sc.steps.forEach((st, i) => {
        const card = h("div", { class: "story-step", "data-scene": sc.id, "data-step": i + 1, id: `step-${sc.id}-${i + 1}` },
          pin(h("p", {}, h("span", { class: "scene__stepno", text: t("scene.step", { i: i + 1, n: sc.steps.length }) }), " ", st.caption), sceneLoc(sc.id, `step:${st.id}`)));
        block.append(card);
      });
    }
  }
  textCol.append(h("footer", { class: "story__end" }, tp(h("p"), "story.end"),
    R.appendices.length ? h("div", { class: "story__cta" }, ...R.appendices.map((a) => h("button", { class: "linkbtn", type: "button", onclick: () => app.openAppendix(a.id), text: `${a.id} ${a.title}` }))) : ""));

  let active = null;
  function activate(sceneId, step) {
    if (active && active.scene === sceneId && active.step === step) return;
    active = { scene: sceneId, step };
    const sc = R.scene(sceneId);
    const current = sc.steps[step - 1];
    setStepCaption(frames.get(sceneId), step);
    app.state.scene = sceneId; app.state.step = step;
    if (!narrow) {
      hideTip();
      clear(stageHead);
      stageHead.append(h("strong", { text: `${sc.id} ` }), sc.title, h("span", { class: "scene__stepno", text: ` · ${t("scene.step", { i: step, n: sc.steps.length })}` }));
      clear(stageRibbon);
      stageRibbon.append(h("span", { text: current.time || sc.time }), h("span", { text: current.scope || sc.scope }), evidenceBadge(R, current.evidence || sc.evidence));
      mountView(stickyStage, stepView(sc, step), app.viewCtx());
    }
    app.updateTopbar(sc, step);
    app.persist();
  }

  let io;
  if (!narrow) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) activate(e.target.dataset.scene, Number(e.target.dataset.step));
    }, { rootMargin: "-48% 0px -48% 0px", threshold: 0 });
    textCol.querySelectorAll(".story-step").forEach((el) => io.observe(el));
  } else {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const b = blocks.find((x) => x.inline === e.target);
        if (b && !b.rendered) { b.rendered = true; mountView(b.inline, stepView(b.sc, b.sc.steps.length), app.viewCtx()); }
        if (b) activate(b.sc.id, b.sc.steps.length);
      }
    }, { rootMargin: "200px 0px 200px 0px" });
    blocks.forEach((b) => io.observe(b.inline));
  }

  // direct link: land on the requested scene/step with the stage already correct
  const want = R.scene(app.state.scene) ? app.state : null;
  if (want) {
    const target = document.getElementById(narrow ? `scene-${want.scene}` : `step-${want.scene}-${Math.min(want.step, R.scene(want.scene).steps.length)}`);
    if (target) requestAnimationFrame(() => { target.scrollIntoView({ block: "center" }); activate(want.scene, narrow ? R.scene(want.scene).steps.length : Math.min(want.step, R.scene(want.scene).steps.length)); });
  } else if (!narrow) activate(R.scenes[0].id, 1);

  let rt;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const nowNarrow = matchMedia("(max-width: 820px)").matches;
      if (nowNarrow !== narrow) { app.remount(); return; }
      if (!narrow && active) mountView(stickyStage, stepView(R.scene(active.scene), active.step), app.viewCtx());
      if (narrow) blocks.filter((b) => b.rendered).forEach((b) => mountView(b.inline, stepView(b.sc, b.sc.steps.length), app.viewCtx()));
    }, 150);
  };
  window.addEventListener("resize", onResize);

  return {
    render() { if (active) { const a = active; active = null; activate(a.scene, a.step); } },
    goto(sceneId, step = 1) {
      const el = document.getElementById(narrow ? `scene-${sceneId}` : `step-${sceneId}-${step}`);
      el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    },
    destroy() {
      clearTimeout(rt); io?.disconnect(); window.removeEventListener("resize", onResize);
      for (const stage of [stickyStage, ...blocks.map((b) => b.inline)]) {
        stage?.__view?.obj.destroy?.();
        if (stage) delete stage.__view;
      }
      clear(main);
    },
  };
}
