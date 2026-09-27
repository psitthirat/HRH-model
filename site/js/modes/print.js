// Print: the whole story path on paper-sized pages, every chart rendered
// eagerly (no lazy rendering, so nothing prints blank), with scope, years,
// evidence type, caveats and sources under each figure. Uses the same release.

import { h, clear } from "../util/dom.js";
import { mountView, stepView } from "../engine.js";
import { evidenceBadge } from "../charts/core.js";
import { giniTable } from "../charts/plancompare.js";
import { releaseSummary } from "../ui/drawer.js";
import { t } from "../util/i18n.js";

export function initPrint(app) {
  const { R, main } = app;
  clear(main);
  document.documentElement.classList.add("reduce-motion");
  const meta = R.bundle.meta;
  const withNotes = R.capabilities.notes && new URLSearchParams(location.search).get("notes") === "1";
  const root = h("div", { class: "print" });
  root.append(h("header", { class: "print__cover" },
    h("h1", { text: meta.title }), h("p", { class: "story__question", text: meta.question }),
    h("p", { text: meta.take_home }), h("p", { class: "chart-note", text: t("story.source", { report: R.bundle.project?.report ?? "", title: meta.source_title }) }),
    releaseSummary(R),
    h("p", { class: "no-print" },
      h("button", { class: "btn btn--primary", type: "button", onclick: () => window.print(), text: t("print.print") }), " ",
      R.capabilities.notes ? h("a", { class: "btn btn--ghost", href: withNotes ? "?mode=print" : "?mode=print&notes=1", text: withNotes ? t("print.without_notes") : t("print.with_notes") }) : "", " ",
      h("a", { class: "btn btn--ghost", href: "?mode=story", text: t("print.back") }))));
  main.append(root);
  const stages = [];
  for (const sc of R.scenes) {
    const current = sc.steps.at(-1);
    const mm = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
    const stage = h("div", { class: "scene__stage print__stage" });
    const sec = h("section", { class: "print-scene", "data-scene": sc.id, "data-component": current.view.component },
      h("p", { class: "scene__kicker", text: t("print.scene_head", { id: sc.id, chapter: sc.chapter, title: R.chapter(sc.chapter).title, start: mm(sc.start_seconds), end: mm(sc.end_seconds) }) }),
      h("h2", { class: "scene__title", text: sc.title }), h("p", { class: "scene__headline", text: current.headline?.text || sc.headline.text }),
      h("p", { class: "scene__body", text: current.body?.text ?? sc.body.text }),
      current.view.side_items?.length ? h("ul", { class: "scene__agenda" }, ...current.view.side_items.map(text => h("li", { text }))) : "", stage,
      h("dl", { class: "kv" }, h("dt", { text: t("ribbon.time") }), h("dd", { text: current.time || sc.time }), h("dt", { text: t("ribbon.scope") }), h("dd", { text: current.scope || sc.scope }),
        h("dt", { text: t("ribbon.den") }), h("dd", { text: current.denominator || sc.denominator }), h("dt", { text: t("print.steps") }), h("dd", { text: sc.steps.map((s, i) => `${i + 1}. ${s.caption}`).join("  ") })),
      evidenceBadge(R, current.evidence || sc.evidence),
      sc.caveats.length ? h("ul", { class: "scene__caveats" }, ...sc.caveats.map((c) => h("li", { text: c }))) : "",
      sc.sources?.length ? h("p", { class: "meta-src" }, t("print.sources") + ": ", ...sc.sources.map((s) => h("span", {
        text: [s.report_number || s.asset_id, s.file ? `(${s.file})` : s.caption_th].filter(Boolean).join(" ") + "; " }))) : "",
      withNotes ? h("pre", { class: "print__notes", text: sc.notes }) : "");
    if (current.view.comparison_table) sec.append(giniTable(R));
    root.append(sec);
    stages.push([stage, sc]);
  }
  if (R.appendices.length) root.append(h("section", { class: "print-scene" }, h("h2", { text: t("print.appendix") }),
    h("ul", {}, ...R.appendices.map((a) => h("li", {}, h("strong", { text: `${a.id} ${a.title}` }), h("br"), a.text.join(" "))))));
  // render every figure now, at the printed width
  let disposed = false;
  document.fonts?.ready.then(() => {
    if (disposed) return;
    for (const [stage, sc] of stages) mountView(stage, stepView(sc, sc.steps.length), app.viewCtx({ mode: "print" }));
    document.body.dataset.printReady = "1";
  });
  return { render() {}, goto() {}, destroy() {
    disposed = true;
    for (const [stage] of stages) { stage.__view?.obj.destroy?.(); delete stage.__view; }
    clear(main); document.documentElement.classList.remove("reduce-motion");
  } };
}
