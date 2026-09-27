// Case-study profile cards: the fixed provinces on one set of rows, each with the
// role it plays in the story (config/web/scenes.toml [[case_study]]). OP per person
// is shown directly (not two per-physician ratios that share a denominator), and
// the open explanations are questions, never ticks.

import { h, s, clear } from "../util/dom.js";
import { num, be } from "../util/format.js";
import { provinceGroups } from "./provinces.js";
import { hideTip, bindTip, tipHTML } from "./core.js";
import { t, pin, caseLoc, uiLoc } from "../util/i18n.js";

export class Cards {
  constructor(el, ctx) { this.el = el; this.ctx = ctx; }

  update(spec, ctx) {
    const R = ctx.release;
    const pv = new Map(R.rows(spec.dataset).map((r) => [r.prov_code, r]));
    const pri = R.select("priority", { cadre: "physicians", scope: "moph" });
    const dens = new Map(R.select("province_density", { cadre: "physicians", scope: "all_sectors" }).map((r) => [`${r.prov_code}|${r.year}`, r]));
    const years = R.distinct("province_density", "year").sort((a, b) => a - b);
    const y0 = years[0], y1 = years[years.length - 1];
    const core = R.vocab.core_six;
    const grouping = provinceGroups(R);
    const med = R.fact("w_op_pp_median");
    const allOp = R.rows(spec.dataset).map((r) => r.op_per_person).filter((v) => v != null);
    const maxOp = Math.max(...allOp, med?.value || 0);
    clear(this.el); hideTip();
    const wrap = h("div", { class: "cards" + (spec.show_questions ? " with-questions" : "") });
    this.el.append(wrap);
    const base = Array.isArray(spec.highlight) && spec.highlight.length ? spec.highlight : R.caseStudies;
    const codes = ctx.selected?.length && ctx.mode === "explore" ? [...new Set([...base, ...ctx.selected])].slice(0, 9) : base;
    const grid = h("div", { class: `cards__grid cards__grid--n${Math.min(codes.length, 9)}` });
    if (!spec.show_questions) wrap.append(h("p", { class: "cards__caption", text: t("cards.comparison_note", { a: be(y0), b: be(y1), m: med?.display ?? "—" }) }));
    wrap.append(grid);
    for (const code of codes) {
      const r = pv.get(code);
      const g = R.geoByCode.get(code);
      const cs = R.caseByCode.get(code);
      const card = h("article", { class: "card" + (cs ? " is-case" : ""), "aria-label": R.provinceName(code) });
      const context = h("details", { class: "card__context", open: spec.show_questions },
        h("summary", { class: "card__head" }, h("h3", { text: R.provinceName(code) }),
          h("span", { class: "card__region", text: t("cards.region", { n: g?.health_region ?? "—" }) })));
      card.append(context);
      const group = grouping.byCode.get(code)?.group;
      if (group) {
        const badge = h("details", { class: "card__group", title: group.label }, h("summary", { text: group.short }));
        badge.style.setProperty("--group-color", group.color); card.append(badge);
        bindTip(badge.querySelector("summary"), () => tipHTML(group.label, [["", t("group.definitionTooltip")]]));
        badge.append(h("p", { class: "card__group-peers", text: t("group.peers", { names: group.codes.map((c) => R.provinceName(c)).join(" · ") }) }));
      }
      if (cs?.role) {
        context.append(pin(h("p", { class: "card__role" + (cs.role_ok ? "" : " is-off") }, cs.role), caseLoc(cs.key)));
        if (!cs.role_ok) card.append(h("p", { class: "card__warn", text: t("cards.role_off") }));
      }
      if (!r) { card.append(h("p", { text: t("chart.no_data") })); grid.append(card); continue; }
      const member = core.filter((d) => pri.find((p) => p.prov_code === code && p.denominator === d)?.priority);
      const dl = h("dl", { class: "card__facts" });
      const add = (k, v) => dl.append(h("dt", { text: k }), h("dd", { text: v }));
      const a = dens.get(`${code}|${y0}`)?.density_per_100k, b = dens.get(`${code}|${y1}`)?.density_per_100k;
      if (a != null && b != null) add(t("cards.density_short"), `${num(a, 1)} → ${num(b, 1)}`);
      add(t("cards.op_pp"), num(r.op_per_person, 2));
      card.append(dl);
      // OP per person against the provincial median, one shared scale
      const w = 260, hh = 26, x = (v) => 8 + (v / maxOp) * (w - 16);
      const svg = s("svg", { class: "card__bar", viewBox: `0 0 ${w} ${hh}`, width: "100%", height: hh, preserveAspectRatio: "none", role: "img",
        "aria-label": t("cards.op_aria", { v: num(r.op_per_person, 2), m: med?.display }) });
      svg.append(s("line", { class: "grid", x1: 8, x2: w - 8, y1: 9, y2: 9 }));
      svg.append(s("rect", { class: "card__val", x: 8, y: 4, width: Math.max(1, x(r.op_per_person) - 8), height: 10, rx: 3 }));
      if (med) {
        svg.append(s("line", { class: "card__med", x1: x(med.value), x2: x(med.value), y1: 0, y2: 18 }));
      }
      card.append(svg);
      const ul = h("ul", { class: "card__members", "aria-label": t("cards.members") });
      for (const d of core) ul.append(h("li", { class: member.includes(d) ? "on" : "off" },
        h("span", { class: "dotmark", "aria-hidden": "true" }), R.shortLabel("denominator", d), member.includes(d) ? "" : h("span", { class: "vh", text: t("cards.not_member") })));
      card.append(h("p", { class: "card__sub", text: t("cards.member_count", { n: member.length, k: core.length }) }), ul);
      grid.append(card);
    }
    if (spec.show_questions && spec.questions) {
      const q = h("div", { class: "open-questions" }, pin(h("h4", { text: t("cards.questions") }), uiLoc("cards.questions")));
      const ol = h("ul");
      for (const qq of spec.questions) ol.append(h("li", { text: qq }));
      q.append(ol);
      wrap.append(q);
    }
  }
  destroy() { hideTip(); clear(this.el); }
}
