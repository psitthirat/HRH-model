// Text panels for the discussion scenes: two columns, a mission table, the policy
// matrix revealed row by row, and the closing questions with links back to the
// evidence. Content is authored in config/web/scenes.toml, not computed.

import { h, clear } from "../util/dom.js";
import { evidenceBadge, hideTip } from "./core.js";
import { t } from "../util/i18n.js";

export class TextPanel {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; }

  update(spec, ctx) {
    const R = ctx.release;
    clear(this.el); hideTip();
    const wrap = h("div", { class: `textpanel textpanel--${spec.layout}` + ((spec.columns || []).length === 3 ? " textpanel--three" : "") });
    this.el.append(wrap);
    if (spec.layout === "columns") {
      for (const c of spec.columns || []) {
        const col = h("section", { class: `tp-col tp-col--${c.evidence}` }, evidenceBadge(R, c.evidence), h("h3", { text: c.title }));
        const ul = h("ul");
        for (const it of c.items || []) ul.append(h("li", { text: it }));
        col.append(ul);
        wrap.append(col);
      }
    } else if (spec.layout === "table" || spec.layout === "matrix") {
      const n = spec.reveal_rows ?? (spec.rows || []).length;
      const table = h("table", { class: "tp-table" + (spec.layout === "matrix" ? " tp-matrix" : "") });
      table.append(h("thead", {}, h("tr", {}, ...(spec.headers || []).map((x) => h("th", { scope: "col", text: x })))));
      const tb = h("tbody");
      (spec.rows || []).forEach((row, i) => {
        const tr = h("tr", { class: i < n ? "shown" : "pending", "aria-hidden": i < n ? null : "true" });
        row.forEach((cell, j) => tr.append(j === 0 ? h("th", { scope: "row", text: cell }) : h("td", { text: cell })));
        tb.append(tr);
      });
      table.append(tb);
      wrap.append(h("div", { class: "tp-scroll" }, table));
      if (spec.layout === "matrix") wrap.append(h("p", { class: "chart-note", text: t("text.matrix_note") }));
    } else if (spec.layout === "questions") {
      const ol = h("ol", { class: "tp-questions" });
      (spec.questions || []).forEach((q) => {
        const links = h("span", { class: "tp-links" }, t("text.back_to"),
          ...(q.evidence_scenes || []).map((sid) => h("button", { class: "linkbtn", type: "button", "data-goto": sid,
            onclick: () => ctx.goto?.(sid), text: `${sid} ${R.scene(sid)?.title ?? ""}` })));
        ol.append(h("li", {}, h("p", { text: q.text }), links));
      });
      wrap.append(ol);
    }
    if (spec.definition) wrap.append(h("p", { class: "tp-definition", text: spec.definition }));
  }
  destroy() { hideTip(); clear(this.el); }
}
