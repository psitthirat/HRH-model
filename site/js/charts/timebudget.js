// Work time under stated assumptions (S08). The interactive view combines
// adjustable minutes per service unit with the exported service volumes;
// the static view retains the published assumption grid. These are calculated
// time requirements under assumptions, not measured working time.

import { h, s, clear } from "../util/dom.js";
import { num } from "../util/format.js";
import { linear, nice } from "../util/scale.js";
import { legend, bindTip, tipHTML, hideTip } from "./core.js";
import { t, pin, uiLoc } from "../util/i18n.js";

export class TimeBudget {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; this.choices = null; }

  update(spec, ctx) {
    const R = ctx.release;
    const rows = R.rows(spec.dataset || "time_budget");
    const meta = R.ds(spec.dataset || "time_budget").meta;
    const b = { ...meta.base, ...(spec.interactive ? this.choices : {}) };
    const observed = rows.find((r) => r.m_op === meta.base.m_op && r.m_adjrw === meta.base.m_adjrw) || rows[0];
    const hoursOP = observed.op_visits_per_physician * b.m_op / 60;
    const hoursIP = observed.adjrw_per_physician * b.m_adjrw / 60;
    const base = spec.interactive ? { ...observed, hours_op: hoursOP, hours_ip: hoursIP, hours_total: hoursOP + hoursIP } : observed;
    const allH = b.hours_per_day * b.working_days;
    const directH = allH * b.direct_share;
    clear(this.el); hideTip();
    const split = this.el.clientWidth >= 1000;
    const wrap = h("div", { class: "timebudget" + (split ? " timebudget--split" : "") + (spec.interactive ? " timebudget--interactive" : "") });
    this.el.append(wrap);
    wrap.append(pin(h("p", { class: "chart-banner", text: t("time.banner") }), uiLoc("time.banner")));

    let primary = wrap, secondary = wrap;
    if (spec.interactive) {
      const controls = h("fieldset", { class: "time-controls" });
      controls.append(h("legend", { text: t("time.controls") }));
      const more = h("details", { class: "time-controls__more" });
      const moreFields = h("div", { class: "time-controls__additional" });
      more.append(h("summary", { class: "btn btn--ghost", text: t("time.optional_controls") }), moreFields);
      const inputs = [
        ["m_op", "time.control_op", Math.min(...rows.map((r) => r.m_op)), Math.max(...rows.map((r) => r.m_op)), 1, b.m_op],
        ["m_adjrw", "time.control_adjrw", Math.min(...rows.map((r) => r.m_adjrw)), Math.max(...rows.map((r) => r.m_adjrw)), 1, b.m_adjrw],
        ["working_days", "time.control_days", 1, 366, 1, b.working_days],
        ["hours_per_day", "time.control_hours", .25, 24, .25, b.hours_per_day],
        ["direct_share", "time.control_direct", 1, 100, 1, b.direct_share * 100],
      ];
      for (const [key, label, min, max, step, val] of inputs) {
        const slider = key === "m_op" || key === "m_adjrw";
        // Set the range before its value: a range input otherwise clamps values
        // above the browser's default maximum (100) while it is being created.
        const input = h("input", { type: slider ? "range" : "number", name: key, min, max, step, value: val, "aria-label": t(label) });
        const output = h("output", { class: "time-control__value", text: num(val, slider ? 0 : 2) });
        input.addEventListener("input", () => {
          if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
          this.choices = { ...b, ...this.choices, [key]: input.valueAsNumber / (key === "direct_share" ? 100 : 1) };
          output.textContent = num(input.valueAsNumber, slider ? 0 : 2);
          // Keep the input mounted throughout a drag; update the prominent
          // arithmetic immediately and redraw the chart once the value commits.
          this.preview(observed, this.choices);
        });
        input.addEventListener("change", () => {
          if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
          this.choices = { ...b, ...this.choices, [key]: input.valueAsNumber / (key === "direct_share" ? 100 : 1) };
          const wasOpen = more.open;
          this.update(spec, ctx);
          if (wasOpen) this.el.querySelector(".time-controls__more").open = true;
          this.el.querySelector(`input[name="${key}"]`)?.focus({ preventScroll: true });
        });
        (slider ? controls : moreFields).append(h("label", { class: "time-control" }, h("span", {}, t(label), ...(slider ? [output] : [])), input));
      }
      const reset = h("button", { class: "btn btn--ghost", type: "button", text: t("time.reset") });
      reset.addEventListener("click", () => { this.choices = null; this.update(spec, ctx); });
      controls.append(more, reset);
      wrap.append(controls);
      primary = h("div", { class: "timebudget__primary" });
      secondary = h("div", { class: "timebudget__secondary" });
      wrap.append(primary, secondary);
      const pct = 100 * base.hours_total / allH;
      primary.append(h("div", { class: "time-result", "aria-live": "polite" },
        h("strong", { text: `${num(pct, 1)}%` }),
        h("span", { class: "time-result__label", text: t("time.workday_label") }),
        h("p", { text: `${t("time.daily_hours", { h: num(base.hours_total / b.working_days, 2) })} · ${t("time.direct_pct", { pct: num(100 * base.hours_total / directH, 1) })}` })));
      primary.append(h("p", { class: "time-formula", text: t("time.formula", {
        op: num(observed.op_visits_per_physician, 2), mop: num(b.m_op, 2), adj: num(observed.adjrw_per_physician, 2),
        madj: num(b.m_adjrw, 2), days: num(b.working_days, 0), hpd: num(b.hours_per_day, 2), pct: num(pct, 1),
      }) }), h("p", { class: "time-formula-note", text: t("time.formula_note") }));
    }

    // ---- selected assumptions (or the published base case)
    const barBox = h("div", { class: "timebudget__bar" });
    (spec.interactive ? secondary : primary).append(barBox);
    barBox.append(legend([{ label: t("time.hours_op"), color: "var(--c-physicians)", shape: "square" },
      { label: t("time.hours_ip"), color: "var(--n-2)", shape: "square" }]));
    const r0 = barBox.getBoundingClientRect();
    const W = Math.max(300, r0.width || 900), H = spec.interactive ? 204 : 186;
    // Separate the reference captions, total, ticks and axis title vertically;
    // at projector sizes their glyph bounds are taller than the old offsets.
    const m = { l: 20, r: 26, t: spec.interactive ? 100 : 80, b: spec.interactive ? 54 : 36 };
    const svg = s("svg", { class: "chart-svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${t("time.axis")}: ${t("time.total", { h: num(base.hours_total, 0) })}` });
    barBox.append(svg);
    const x = linear(nice([0, Math.max(base.hours_total, allH) * 1.05], 5), [m.l, W - m.r]);
    for (const tk of x.ticks(5)) {
      svg.append(s("line", { class: "grid", x1: x(tk), x2: x(tk), y1: m.t - 6, y2: H - m.b }));
      svg.append(s("text", { class: "tick", x: x(tk), y: H - m.b + 18, "text-anchor": "middle", text: num(tk, 0) }));
    }
    svg.append(s("text", { class: "axis-label", x: m.l, y: H - 4, text: t("time.axis") }));
    const bh = spec.interactive ? 28 : 34, by = m.t + (spec.interactive ? 6 : 10);
    const segs = [
      { v0: 0, v1: base.hours_op, col: "var(--c-physicians)", label: t("time.hours_op"), val: base.hours_op },
      { v0: base.hours_op, v1: base.hours_total, col: "var(--n-2)", label: t("time.hours_ip"), val: base.hours_ip },
    ];
    for (const sg of segs) {
      const rect = s("rect", { class: "bar", x: x(sg.v0), y: by, width: Math.max(1, x(sg.v1) - x(sg.v0) - 2), height: bh, rx: 3, style: `fill:${sg.col}`, tabindex: -1 });
      svg.append(rect);
      if (x(sg.v1) - x(sg.v0) > 90) svg.append(s("text", { class: "in-bar", x: x(sg.v0) + 8, y: by + bh / 2, "dominant-baseline": "middle",
        text: `${sg.label} ${num(sg.val, 0)}` }));
      bindTip(rect, () => tipHTML(sg.label, [[t("time.axis"), num(sg.val, 0)]]));
    }
    svg.append(s("text", { class: "bar-label", x: x(base.hours_total), y: by - 8, "text-anchor": "end",
      text: t("time.total", { h: num(base.hours_total, 0) }) }));
    // reference lines: direct-care budget and all working hours (labels above the bar, left/right aligned)
    for (const [v, text, anchor, ly] of [[directH, t("time.direct_hours", { pct: num(100 * b.direct_share, 0), h: num(directH, 0) }), "end", 24],
      [allH, t("time.all_hours", { h: num(allH, 0) }), "start", 52]]) {
      svg.append(s("line", { class: "ref-line", x1: x(v), x2: x(v), y1: ly + 8, y2: by + bh + 8 }));
      const lab = s("text", { class: "ref-label", x: x(v) + (anchor === "start" ? 6 : -6), y: ly, "text-anchor": anchor, text });
      svg.append(lab);
      // keep the label inside the drawing
      const bb = lab.getBBox();
      const shift = bb.x < m.l ? m.l - bb.x : Math.min(0, W - m.r - bb.x - bb.width);
      if (shift) lab.setAttribute("x", Number(lab.getAttribute("x")) + shift);
    }
    if (!spec.interactive) barBox.append(h("p", { class: "chart-note", text: t("time.assumption", { op: num(b.m_op, 0), adj: num(b.m_adjrw, 0), d: b.working_days, hpd: num(b.hours_per_day, 0) }) }));

    // The published grid remains available in static/read views; interactive
    // presentation replaces it with controls and the selected arithmetic.
    if (!spec.interactive) {
    // ---- assumption grid
    const ops = [...new Set(rows.map((r) => r.m_op))].sort((a, c) => a - c);
    const adjs = [...new Set(rows.map((r) => r.m_adjrw))].sort((a, c) => a - c);
    const grid = h("div", { class: "timebudget__grid" });
    secondary.append(grid);
    grid.append(h("h4", { text: t("time.grid_title") }));
    const table = h("table", { class: "tb-grid" });
    table.append(h("thead", {},
      h("tr", {}, h("th", { rowspan: 2, scope: "col", class: "tb-corner", text: t("time.grid_op") }),
        h("th", { colspan: adjs.length, scope: "colgroup", text: t("time.grid_adjrw") })),
      h("tr", {}, ...adjs.map((a) => h("th", { scope: "col", text: num(a, 0) })))));
    const tb = h("tbody");
    for (const o of ops) {
      const tr = h("tr", {}, h("th", { scope: "row", text: num(o, 0) }));
      for (const a of adjs) {
        const r = rows.find((q) => q.m_op === o && q.m_adjrw === a);
        const v = !r ? null : 100 * r.share_of_direct_care_budget;
        const isBase = o === meta.base.m_op && a === meta.base.m_adjrw;
        tr.append(h("td", { class: "num" + (v != null && v > 100 ? " over" : "") + (isBase ? " is-base" : ""),
          title: isBase ? t("time.grid_base") : "", text: v == null ? "—" : `${num(v, 0)}%` }));
      }
      tb.append(tr);
    }
    table.append(tb);
    grid.append(table);
    grid.append(h("p", { class: "chart-note" }, h("span", { class: "tb-key is-base" }), " ", t("time.grid_base"), "  ",
      h("span", { class: "tb-key over" }), " > 100%"));

    }

    // ---- other cadres
    const oc = meta.other_cadres || {};
    const other = [];
    if (oc.dental_visits) other.push(t("time.dental", { n: num(oc.dental_visits.per_day, 1), m: num(oc.dental_visits.minutes, 0), h: num(oc.dental_visits.hours_per_day, 1) }));
    if (oc.op_prescriptions) other.push(t("time.pharm", { n: num(oc.op_prescriptions.per_day, 1), m: num(oc.op_prescriptions.minutes, 0), h: num(oc.op_prescriptions.hours_per_day, 1) }));
    if (other.length) secondary.append(h("div", { class: "timebudget__other" }, h("h4", { text: t("time.other_title") }),
      h("ul", {}, ...other.map((x) => h("li", { text: x })))));
  }

  preview(observed, b) {
    const total = (observed.op_visits_per_physician * b.m_op + observed.adjrw_per_physician * b.m_adjrw) / 60;
    const allH = b.working_days * b.hours_per_day;
    const pct = 100 * total / allH;
    const result = this.el.querySelector(".time-result");
    if (!result) return;
    result.querySelector("strong").textContent = `${num(pct, 1)}%`;
    result.querySelector("p").textContent = `${t("time.daily_hours", { h: num(total / b.working_days, 2) })} · ${t("time.direct_pct", { pct: num(100 * total / (allH * b.direct_share), 1) })}`;
    this.el.querySelector(".time-formula").textContent = t("time.formula", {
      op: num(observed.op_visits_per_physician, 2), mop: num(b.m_op, 2), adj: num(observed.adjrw_per_physician, 2),
      madj: num(b.m_adjrw, 2), days: num(b.working_days, 0), hpd: num(b.hours_per_day, 2), pct: num(pct, 1),
    });
  }

  destroy() { hideTip(); clear(this.el); }
}
