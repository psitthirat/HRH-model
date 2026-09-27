// Opening and section-divider cards share one composition. Content comes from
// the scene specification; the galaxy is decorative, not research data.
import { h, s, clear, reducedMotion } from "../util/dom.js";
import { t } from "../util/i18n.js";

const LOGOS = [
  ["01_rama-hpsr.png", "logo_hpsr"],
  ["02_rama.png", "logo_rama"],
  ["03_moph.svg", "logo_moph"],
  ["04_WHO.png", "logo_who"],
  ["05_HSRI.svg", "logo_hsri"],
];

let galaxyId = 0;

function galaxy() {
  // Fixed seed keeps the composition stable on resize and on returning here.
  // Unique gradient IDs also allow both title cards in reading/print modes.
  let seed = 73021;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const prefix = `titlecard-galaxy-${++galaxyId}`;
  const glow = (name, colour) => s("radialGradient", { id: `${prefix}-${name}` },
    s("stop", { offset: "0", "stop-color": colour, "stop-opacity": .7 }),
    s("stop", { offset: ".35", "stop-color": colour, "stop-opacity": .24 }),
    s("stop", { offset: "1", "stop-color": colour, "stop-opacity": 0 }));
  const fill = (name) => `url(#${prefix}-${name})`;
  const svg = s("svg", { class: "titlecard__galaxy", viewBox: "0 0 1600 900", preserveAspectRatio: "xMidYMid slice", "aria-hidden": "true", focusable: "false" },
    s("defs", {}, glow("blue", "#78b6f2"), glow("violet", "#a798ef"), glow("core", "#d8eaff")));

  // The foreground travels faster than the distant stars, giving gentle depth.
  for (const [layer, count] of [["far", 150], ["near", 54]]) {
    const field = s("g", { class: `titlecard__stars titlecard__stars--${layer} titlecard__animated` });
    for (let i = 0; i < count; i++) {
      const x = random() * 1800 - 100, y = random() * 1100 - 100;
      const r = layer === "near" ? .9 + random() * 1.1 : .35 + random() * .7;
      if (layer === "near" && i % 3 === 0) field.append(s("circle", { cx: x, cy: y, r: r * 6, fill: fill("blue"), opacity: .5 }));
      field.append(s("circle", { cx: x, cy: y, r, fill: i % 5 ? "#c8def4" : "#a99bdf", opacity: .25 + random() * .55 }));
    }
    svg.append(field);
  }

  // Project a rotating spiral onto a tilted plane; keep its perspective intact.
  const plane = s("g", { transform: "translate(1260 440) rotate(-26) scale(1 .52)" });
  const orbit = s("g", { class: "titlecard__orbit titlecard__animated" });
  plane.append(s("ellipse", { rx: 650, ry: 580, fill: fill("blue"), opacity: .18 }));
  const clouds = s("g", { opacity: .52 });
  const stars = s("g");
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 34; i++) {
      const radius = 90 + i * 16, angle = arm * Math.PI * 2 / 3 + radius * .007;
      clouds.append(s("ellipse", { cx: Math.cos(angle) * radius, cy: Math.sin(angle) * radius,
        rx: 84 + radius * .09, ry: 66 + radius * .055,
        fill: fill(arm === 1 ? "violet" : "blue"), opacity: .12 + (1 - i / 34) * .18 }));
    }
    for (let i = 0; i < 220; i++) {
      const radius = 45 + Math.pow(random(), .7) * 590;
      const angle = arm * Math.PI * 2 / 3 + radius * .007 + (random() - .5) * .48;
      const spread = (random() - .5) * 48;
      stars.append(s("circle", { cx: Math.cos(angle) * (radius + spread), cy: Math.sin(angle) * (radius + spread),
        r: .45 + random() * 1.45, fill: i % 4 ? "#bad9f7" : "#b6a5ea", opacity: .18 + random() * .62 }));
    }
  }
  orbit.append(clouds, stars);
  plane.append(orbit, s("ellipse", { rx: 170, ry: 140, fill: fill("core"), opacity: .72 }));
  // A dense, softly lit core joins the spiral arms without a hard boundary.
  for (let i = 0; i < 120; i++) {
    const radius = Math.pow(random(), 1.5) * 145, angle = random() * Math.PI * 2;
    plane.append(s("circle", { cx: Math.cos(angle) * radius, cy: Math.sin(angle) * radius,
      r: .35 + random(), fill: "#dceaff", opacity: .2 + random() * .35 }));
  }
  svg.append(plane);
  return svg;
}

export class TitleCard {
  constructor(el) { this.el = el; this.userPaused = null; }

  update(spec, ctx) {
    const key = JSON.stringify(spec);
    if (this.card?.isConnected && this.specKey === key && this.mode === ctx.mode) return;
    this.dispose(); clear(this.el);
    this.specKey = key; this.mode = ctx.mode;
    this.abort = new AbortController();
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.visible = true;
    const variant = spec.variant === "divider" ? "divider" : "cover";
    const title = spec.title || (spec.title_lines || []).join(" ");
    const card = this.card = h("section", { class: `titlecard titlecard--${variant}`, "aria-label": title });
    const backdrop = h("div", { class: "titlecard__backdrop", "aria-hidden": "true" }, galaxy());
    if (spec.video_src && ctx.mode !== "print") {
      const video = this.video = h("video", { class: "titlecard__video", loop: true, muted: true, playsinline: true,
        preload: "metadata", poster: spec.video_poster || null, tabindex: -1, "aria-hidden": "true" });
      video.muted = true;
      video.src = spec.video_src;
      video.addEventListener("loadeddata", () => card.classList.add("has-video"), { signal: this.abort.signal });
      video.addEventListener("error", () => card.classList.remove("has-video"), { signal: this.abort.signal });
      backdrop.prepend(video);
    }
    card.append(backdrop);
    const content = h("div", { class: "titlecard__content" });
    if (spec.eyebrow) content.append(h("p", { class: "titlecard__eyebrow", text: spec.eyebrow }));
    const heading = h("h2", { class: "titlecard__title" });
    if (spec.title_lines?.length) {
      for (const line of spec.title_lines) heading.append(h("span", { class: "titlecard__title-line", text: line }));
    } else heading.textContent = title;
    content.append(heading);
    const project = spec.project_title || (variant === "cover" ? ctx.release?.bundle?.project?.name : null);
    if (project) content.append(h("p", { class: "titlecard__project", text: project }));
    if (spec.subtitle) content.append(h("p", { class: "titlecard__subtitle", text: spec.subtitle }));
    if (spec.author || spec.affiliation || spec.email) {
      const speaker = h("div", { class: "titlecard__speaker" });
      if (spec.author) speaker.append(h("p", { class: "titlecard__author", text: spec.author }));
      if (spec.affiliation) speaker.append(h("p", { class: "titlecard__affiliation", text: spec.affiliation }));
      if (spec.email) speaker.append(h("a", { class: "titlecard__email", href: `mailto:${spec.email}`, text: spec.email }));
      content.append(speaker);
    }
    if (spec.topics?.length) content.append(h("ul", { class: "titlecard__topics" }, ...spec.topics.map((topic) => h("li", { text: topic }))));
    card.append(content);
    if (spec.logos === true || (variant === "cover" && spec.logos !== false)) {
      const logos = h("div", { class: "titlecard__logos", role: "group", "aria-label": t("titlecard.logos") });
      for (const [file, key] of LOGOS) logos.append(h("div", { class: `titlecard__logo titlecard__logo--${key}` },
        h("img", { src: `assets/logos/${file}`, alt: t(`titlecard.${key}`), decoding: "async" })));
      card.append(logos);
    }
    if (ctx.mode !== "print" && spec.motion !== false) {
      this.button = h("button", { class: "titlecard__motion", type: "button", onkeydown: (event) => {
        // Space activates this native button instead of advancing the slide.
        if (event.key === " ") event.stopPropagation();
      }, onclick: () => {
        this.userPaused = !this.isPaused(); this.syncMotion();
      } });
      card.append(this.button);
    }
    if (spec.video_credit && spec.video_src) card.append(h("a", { class: "titlecard__credit", href: spec.video_credit_url || spec.video_src,
      target: "_blank", rel: "noopener", text: `${t("titlecard.video_credit")}: ${spec.video_credit}` }));
    this.el.append(card);
    this.motionDisabled = spec.motion === false || ctx.mode === "print";
    this.motionQuery.addEventListener("change", () => { this.userPaused = null; this.syncMotion(); }, { signal: this.abort.signal });
    document.addEventListener("visibilitychange", () => this.syncMotion(), { signal: this.abort.signal });
    if (ctx.mode !== "print") {
      this.observer = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; this.syncMotion(); });
      this.observer.observe(card);
    }
    this.syncMotion();
  }

  isPaused() { return this.motionDisabled || (this.userPaused ?? reducedMotion()); }

  syncMotion() {
    if (!this.card) return;
    const paused = this.isPaused();
    const inactive = paused || !this.visible || document.hidden;
    this.card.classList.toggle("is-paused", inactive);
    this.card.classList.toggle("has-motion-override", this.userPaused === false);
    if (this.button) {
      this.button.textContent = t(paused ? "titlecard.play" : "titlecard.pause");
      this.button.setAttribute("aria-pressed", String(!paused));
    }
    if (this.video) {
      if (inactive) this.video.pause();
      else this.video.play().catch(() => { /* The CSS background remains available if autoplay is blocked. */ });
    }
  }

  dispose() {
    this.video?.pause(); this.video = null; this.button = null;
    this.observer?.disconnect(); this.observer = null;
    this.abort?.abort(); this.abort = null;
  }

  destroy() { this.dispose(); this.card = null; clear(this.el); }
}
