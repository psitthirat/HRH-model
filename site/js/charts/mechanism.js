// Model definitions are diagrams, not additional research estimates. Numerical
// results come from release facts; cap arithmetic uses an explicitly labelled
// illustrative example supplied by the scene. No policy simulation runs here.
import { h, clear } from "../util/dom.js";
import { num } from "../util/format.js";
import { bindTip, tipHTML, hideTip } from "./core.js";

const shown = value => typeof value === "number" ? num(value, Math.abs(value - Math.round(value)) < 1e-9 ? 0 : 2) : String(value ?? "—");
const factValue = (R, key) => key ? R.fact(key)?.value : null;
const arrow = () => h("span", { class: "model-diagram__arrow", "aria-hidden": "true", text: "→" });
const paragraph = (text, className = "") => text ? h("p", { class: className, text }) : "";

function metric(label, value, { className = "", unit = "" } = {}) {
  return h("div", { class: `model-metric ${className}` }, h("span", { class: "model-metric__label", text: label }),
    h("strong", { text: shown(value) }), unit ? h("span", { class: "model-metric__unit", text: unit }) : "");
}

function info(label, text) {
  if (!text) return "";
  const button = h("button", { class: "model-diagram__info", type: "button", "aria-label": label, text: "ⓘ" });
  bindTip(button, () => tipHTML(label, [["", text]]));
  return button;
}

export class ModelDiagram {
  constructor(el) { this.el = el; }

  update(spec, ctx) {
    clear(this.el); hideTip();
    const box = h("div", { class: `model-diagram model-diagram--${spec.kind}` });
    this.el.append(box);
    if (spec.title) box.append(h("h3", { class: "model-diagram__title", text: spec.title }));
    if (spec.kind === "caps") this.caps(box, spec, ctx.release);
    else if (spec.kind === "feedback") this.feedback(box, spec, ctx.release);
    else if (spec.kind === "targets") this.targets(box, spec, ctx.release);
    else throw new Error(`Unknown model diagram: ${spec.kind}`);
    if (spec.note) box.append(paragraph(spec.note, "model-diagram__note"));
  }

  caps(box, spec, R) {
    const labels = spec.labels || {};
    const example = spec.example || {};
    const start = Number(example.start), departures = Number(example.departures);
    const cap = Number(factValue(R, spec.cap_fact || example.cap_fact) ?? example.cap_pct);
    if (![start, departures, cap].every(Number.isFinite) || start <= 0 || departures < 0 || departures > start || cap < 0) {
      throw new Error("Cap diagram requires a valid labelled illustrative example");
    }
    const retained = start - departures;
    const grossArrivals = start * cap / 100;
    const grossEnd = retained + grossArrivals;
    const netEnd = start * (1 + cap / 100);
    const netArrivals = netEnd - retained;
    const unit = labels.unit || "คน";
    box.append(paragraph(labels.example || "ตัวอย่างสมมติ เพื่อเปรียบเทียบข้อจำกัดเพียงข้อเดียว", "model-diagram__eyebrow"));
    const inputs = h("div", { class: "model-cap__inputs", "aria-label": labels.inputs || "เงื่อนไขร่วมของตัวอย่าง" },
      metric(labels.start || "แพทย์ต้นปี", start, { unit }),
      h("span", { class: "model-cap__minus", "aria-hidden": "true", text: "−" }),
      metric(labels.departures || "ออกระหว่างปี", departures, { unit, className: "model-metric--departure" }),
      arrow(), metric(labels.retained || "คงเหลือก่อนรับเข้า", retained, { unit }));
    box.append(inputs);
    const cards = h("div", { class: "model-cap__comparison" });
    for (const [key, title, formula, arrivals, end] of [
      ["gross", labels.gross_title || "จำกัดจำนวนรับเข้า", labels.gross_formula || `รับเข้า ≤ ${shown(cap)}% ของจำนวนต้นปี`, grossArrivals, grossEnd],
      ["net", labels.net_title || "จำกัดการเพิ่มสุทธิ", labels.net_formula || `จำนวนปลายปี ≤ ${shown(100 + cap)}% ของจำนวนต้นปี`, netArrivals, netEnd],
    ]) {
      const panel = h("section", { class: `model-cap__panel model-cap__panel--${key}` },
        h("h4", { text: title }), paragraph(formula, "model-cap__formula"),
        h("div", { class: "model-cap__result" },
          metric(labels.arrivals || "รับเข้าได้สูงสุด", arrivals, { unit }), arrow(),
          metric(labels.end || "จำนวนปลายปีสูงสุด", end, { unit, className: "model-metric--result" })),
        paragraph(`${shown(retained)} + ${shown(arrivals)} = ${shown(end)}`, "model-cap__arithmetic"));
      cards.append(panel);
    }
    box.append(cards);
    if (spec.definition) box.append(h("p", { class: "model-diagram__definition" }, spec.definition,
      info(labels.detail || "รายละเอียดข้อจำกัดในแบบจำลอง", spec.detail)));
    else if (spec.detail) box.append(info(labels.detail || "รายละเอียดข้อจำกัดในแบบจำลอง", spec.detail));
  }

  feedback(box, spec) {
    const labels = spec.labels || {};
    const nodes = spec.nodes || [];
    const flow = h("ol", { class: "model-feedback__flow", "aria-label": labels.process || "ลำดับการปรับตัวหารในแบบจำลอง" });
    nodes.forEach((node, i) => {
      flow.append(h("li", { class: "model-feedback__node" }, h("span", { class: "model-feedback__number", "aria-hidden": "true", text: i + 1 }),
        h("h4", { text: node.title }), paragraph(node.body)));
    });
    box.append(flow);
    if (spec.return_label) box.append(h("div", { class: "model-feedback__return" },
      h("span", { "aria-hidden": "true", text: "↶" }), paragraph(spec.return_label)));
    if (spec.anchor_title || spec.anchor_body) box.append(h("section", { class: "model-feedback__anchor" },
      h("h4", { text: spec.anchor_title || "จุดอ้างอิงเดียวกัน" }), paragraph(spec.anchor_body),
      spec.formula ? paragraph(spec.formula, "model-feedback__formula") : ""));
    const values = spec.variants || (spec.lambdas || []).map(value => ({ value }));
    if (values.length) {
      const variants = h("div", { class: "model-feedback__variants" });
      values.forEach((variant, i) => {
        variants.append(h("section", { class: `model-feedback__variant model-feedback__variant--${i}` },
          h("h4", {}, h("span", { text: variant.label || `λ = ${String(variant.value)}` })),
          paragraph(variant.body || labels[`lambda_${String(variant.value).replace(".", "_")}`] || "")));
      });
      box.append(variants);
    }
    if (spec.definition) box.append(paragraph(spec.definition, "model-diagram__definition"));
  }

  targets(box, spec, R) {
    const labels = spec.labels || {};
    const stock = factValue(R, spec.stock_fact);
    if (spec.example_title || stock != null) box.append(h("div", { class: "model-targets__example" },
      paragraph(spec.example_title), stock != null ? h("span", {}, labels.stock || "จำนวนแพทย์ปลายปี", " ",
        h("strong", { text: shown(stock) }), " ", labels.unit || "คน") : ""));
    const cards = h("div", { class: "model-targets__cards" });
    for (const plan of spec.plans || []) {
      const target = factValue(R, plan.target_fact);
      const shortfall = factValue(R, plan.shortfall_fact);
      const card = h("section", { class: "model-targets__plan", "data-plan": plan.key || "" },
        h("div", { class: "model-targets__heading" }, h("span", { class: "model-targets__code", text: plan.label || plan.key }),
          h("h4", { text: plan.title })), paragraph(plan.body), paragraph(plan.target, "model-targets__rule"));
      if (target != null || shortfall != null) {
        card.append(h("div", { class: "model-targets__numbers" },
          target != null ? metric(labels.target || "เป้าหมาย", target, { unit: labels.unit || "คน" }) : "",
          shortfall != null ? metric(labels.shortfall || "ส่วนขาดจากเป้าหมาย", shortfall, { unit: labels.unit || "คน" }) : ""));
      }
      cards.append(card);
    }
    box.append(cards);
    if (spec.formula) box.append(paragraph(spec.formula, "model-targets__formula"));
    if (spec.definition) box.append(paragraph(spec.definition, "model-diagram__definition"));
  }

  destroy() { hideTip(); clear(this.el); }
}
