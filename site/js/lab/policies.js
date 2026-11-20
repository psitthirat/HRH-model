import { policyOptions, policyGroups, policyEvidence } from './policy-data.js';

const COPY = {
  th: {
    select: 'นโยบายที่ต้องการทดลอง', own: 'กำหนดสมมติฐานเอง',
    ownHint: 'ปรับค่าตัวแปรในแบบฟอร์มด้านล่าง แล้วคำนวณผลภายใต้สมมติฐานของคุณ',
    survey: 'ค่าจากผลสำรวจของโครงการ', cohort: 'ค่าจากงานวิจัยในไทย', study: 'ฉากทัศน์จากรายงานบทที่ 5',
    applied: 'Lab ตั้งค่าเหล่านี้ให้แล้ว (ค่าอื่นกลับเป็นค่าตั้งต้น) แก้ได้ในแท็บ "นโยบายนี้" แล้วกดคำนวณแผน',
    derivation: 'ค่าตั้งต้นมาจากไหน',
    disclaimer: 'ประสิทธิผล ประสิทธิภาพ และความคุ้มค่าในบริบทไทยยังต้องศึกษาเพิ่มเติม ผลจำลองเป็นผลภายใต้สมมติฐาน ไม่ใช่ผลของนโยบายที่ยืนยันแล้ว',
    assumption: 'ทดลองผลที่สมมติได้', extension: 'ยังไม่มีตัวควบคุมโดยตรง',
    extensionHint: 'นโยบายนี้ยังไม่มีตัวควบคุมที่แทนกลไกได้ตรง ต้องเพิ่มข้อมูลหรือโมดูลก่อนประเมินผลของนโยบาย',
    hoursHint: 'ชั่วโมงทำงานของแพทย์ไม่ใช่ค่านาทีที่ใช้เป็นน้ำหนักดัชนีบริการ จึงใช้แทนกันไม่ได้',
    details: 'เงื่อนไขและหลักฐานของนโยบาย',
    design: 'สิ่งที่ควรกำหนดในการทดลอง', mapping: 'Lab ตั้งค่าอะไร', limits: 'สิ่งที่ยังสรุปไม่ได้',
    evidence: n => `หลักฐานและแหล่งอ้างอิง · ${n} แหล่ง`, evidenceDesign: 'รูปแบบการศึกษา',
    evidenceFinding: 'สิ่งที่งานวิจัยรายงาน', evidenceCaution: 'ขอบเขตการนำไปใช้', source: 'อ่านต้นฉบับ',
    evidenceNote: 'OR ของการเลือกงาน HR ของการออก และผลต่อบริการต่อชั่วโมง เป็นคนละตัวชี้วัด และไม่ใช่ขนาดผลที่นำไปใส่แบบจำลองแทนกันได้โดยตรง',
    noEvidence: 'ยังไม่มีค่าประมาณที่ตรงกับนโยบายและกลุ่มเป้าหมายจากแหล่งที่ตรวจในรอบนี้',
    uncertain: 'หลักฐานไม่แน่นอน',
    uncertainHint: o => `OR ${o.value.toFixed(2)} (ช่วงความเชื่อมั่นร้อยละ 95 ${o.lo.toFixed(2)}–${o.hi.toFixed(2)}) คร่อม 1 ผลจริงอาจเป็นศูนย์หรือกลับทิศ ค่าตั้งต้นจึงเป็นการทดลองว่า "ถ้ามีผลขนาดนี้" ไม่ใช่ขนาดผลที่ยืนยันแล้ว`,
    shared: (others, value) => `ใช้ค่าเดียวกับ ${others} (สัดส่วนลดอัตราเสี่ยงลาออก ${value}) เพราะผลสำรวจวัดความพึงพอใจเป็นรายด้าน ไม่แยกตามมาตรการ ผลที่คำนวณได้จึงเท่ากัน และการเลือกนโยบายใหม่แทนที่ค่าเดิม ไม่บวกผลซ้อนกัน`,
    assumptionTitle: 'ข้อสมมติของ Lab',
    assumptionOR: 'Lab ถือว่า odds ratio (OR) ของความตั้งใจลาออกภายในสามปีจากผลสำรวจใกล้เคียง hazard ratio (HR) ของการลาออกจริง แล้วใช้ 1 − OR เป็นสัดส่วนลดอัตราเสี่ยงลาออก โดยไม่แปลง การประมาณนี้ทำให้ผลดูมากกว่าความเป็นจริง เพราะผู้ตอบราวร้อยละ 15 คิดลาออก ซึ่งไม่ใช่เหตุการณ์หายาก OR จึงห่างจาก 1 มากกว่าอัตราส่วนความเสี่ยง นอกจากนี้ ความตั้งใจกับการลาออกในทะเบียนต่างกัน 0.2–2.2 เท่าตามวิชาชีพ และค่าต่อ 1 ส่วนเบี่ยงเบนมาตรฐานสมมติว่านโยบายยกความพึงพอใจได้หนึ่งส่วนเบี่ยงเบนมาตรฐาน ซึ่งการศึกษาไม่ได้วัด',
    assumptionRR: 'ตั้งแต่ v6.0 นโยบายนี้แปลง OR เป็นอัตราส่วนความเสี่ยง (RR) ก่อน ด้วยสูตรของ Zhang และ Yu (1998) RR = OR ÷ ((1 − P0) + P0 × OR) เมื่อ P0 คือสัดส่วนผู้คิดลาออกในกลุ่มที่ไม่ได้รับผล แล้วจึงถือว่า RR ใกล้เคียง hazard ratio และนับความครอบคลุมตามส่วนของการลาออก ไม่ใช่ส่วนของจำนวนคน ความตั้งใจลาออกยังไม่ใช่การลาออกจริง (ต่างกัน 0.2–2.2 เท่าตามวิชาชีพ) และสูตรนี้เป็นการประมาณเมื่อ OR ปรับตัวแปรอื่นแล้ว',
  },
  en: {
    select: 'Policy to explore', own: 'Set your own assumptions',
    ownHint: 'Edit the controls below, then calculate outcomes under your assumptions.',
    survey: 'Default from the project survey', cohort: 'Default from Thai studies', study: 'Chapter 5 scenario',
    applied: 'The Lab has set these values (everything else back to the baseline). Edit them in the “This policy” tab, then calculate.',
    derivation: 'Where the default comes from',
    disclaimer: 'Effectiveness, efficiency and cost-effectiveness in Thailand require further study. Simulations show outcomes under stated assumptions, not established policy effects.',
    assumption: 'Explore an assumed effect', extension: 'No direct model control yet',
    extensionHint: 'The Lab has no control that directly represents this policy mechanism yet. Further data or a model extension are needed to assess its effects.',
    hoursHint: 'Physician working hours are not the minute weights used in the service index; these quantities are not interchangeable.',
    details: 'Policy conditions and evidence',
    design: 'What to specify in an experiment', mapping: 'What the Lab sets', limits: 'What cannot yet be concluded',
    evidence: n => `Evidence and sources · ${n}`, evidenceDesign: 'Study design',
    evidenceFinding: 'What the study reported', evidenceCaution: 'Limits to application', source: 'Read the source',
    evidenceNote: 'Odds ratios for job choice, hazard ratios for leaving, and consultations per hour measure different outcomes. They are not interchangeable model inputs.',
    noEvidence: 'The sources reviewed so far do not provide an estimate that directly matches this policy and target population.',
    uncertain: 'Uncertain evidence',
    uncertainHint: o => `OR ${o.value.toFixed(2)} (95% confidence interval ${o.lo.toFixed(2)}–${o.hi.toFixed(2)}) includes 1: the true effect may be zero or reversed. The default explores “if the effect were this large”; it is not an established effect size.`,
    shared: (others, value) => `Uses the same value as ${others} (resignation-hazard reduction ${value}): the survey measures satisfaction by domain, not by measure, so their results are equal; choosing another policy replaces the value, it does not add to it.`,
    assumptionTitle: 'The Lab’s assumption',
    assumptionOR: 'The Lab treats the survey odds ratio (OR) of intending to leave within three years as approximately the hazard ratio (HR) of actual resignation and uses 1 − OR as the resignation-hazard reduction, without conversion. This overstates effects: about 15% of respondents intend to leave, not a rare outcome, so the OR lies further from 1 than the risk ratio. Intention and registered resignation also differ 0.2–2.2-fold by profession, and a per-standard-deviation value assumes the policy raises satisfaction by one standard deviation, which the study did not measure.',
    assumptionRR: 'From v6.0 this policy first converts the OR to a risk ratio (RR) with the formula of Zhang and Yu (1998), RR = OR ÷ ((1 − P0) + P0 × OR), where P0 is the share intending to leave among those not covered; it then treats the RR as approximately a hazard ratio and counts coverage in resignations, not in people. Intention to leave is still not resignation (0.2–2.2-fold apart by profession), and the formula is an approximation for an adjusted OR.',
  },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/** Policy context only: the caller owns the controls, scenario and calculation. */
export function renderPolicyLibrary(host, { lang = 'th', selectedId = null, onSelect = () => {}, describe = () => [] } = {}) {
  const language = lang === 'en' ? 'en' : 'th';
  const copy = COPY[language];
  const localized = (item, key) => item?.[`${key}_${language}`] ?? item?.[`${key}_th`] ?? '';
  const root = element('section', 'lab-policy-picker');
  root.dataset.lang = language;
  root.setAttribute('aria-label', copy.select);

  const label = element('label', 'lab-policy-picker__label');
  label.append(element('span', '', copy.select));
  const select = element('select', 'lab-policy-picker__select');
  select.dataset.policySelect = '';
  const own = element('option', '', copy.own);
  own.value = '';
  select.append(own);
  for (const group of policyGroups) {
    const options = element('optgroup');
    options.label = localized(group, 'label');
    for (const policy of policyOptions.filter(policy => policy.group === group.id)) {
      const option = element('option', '', `${policy.id} · ${localized(policy, 'title')}`);
      option.value = policy.id;
      options.append(option);
    }
    select.append(options);
  }
  label.append(select);
  const selectedSummary = element('div', 'lab-policy-picker__summary');
  const disclaimer = element('p', 'lab-policy-picker__disclaimer', copy.disclaimer);
  disclaimer.dataset.policyDisclaimer = '';
  root.append(label, selectedSummary, disclaimer);
  host.replaceChildren(root);

  // Detached on purpose: the caller inserts optional reading after the controls.
  const details = element('details', 'lab-policy-details');
  details.dataset.lang = language;
  const detailsLabel = element('summary', '', copy.details);
  const detailsBody = element('div', 'lab-policy-details__body');
  details.append(detailsLabel, detailsBody);

  function section(title, text, className = '') {
    const node = element('section', `lab-policy-section ${className}`.trim());
    node.append(element('h3', '', title));
    if (text) node.append(element('p', '', text));
    return node;
  }

  function evidenceFor(policy) {
    const items = (policy.evidence_ids ?? []).map(id => policyEvidence[id]).filter(Boolean);
    const evidence = element('section', 'lab-policy-evidence');
    evidence.dataset.policyEvidence = '';
    evidence.append(element('h3', '', copy.evidence(items.length)));
    if (!items.length) {
      evidence.append(element('p', 'lab-policy-evidence__note', copy.noEvidence));
      return evidence;
    }
    evidence.append(element('p', 'lab-policy-evidence__note', copy.evidenceNote));
    for (const item of items) {
      const source = element('article', 'lab-policy-source');
      source.dataset.evidenceId = item.id;
      source.append(element('h4', '', `${item.id} · ${item.title}`));
      const facts = element('dl', 'lab-policy-source__facts');
      for (const [name, key] of [[copy.evidenceDesign, 'design'], [copy.evidenceFinding, 'finding'], [copy.evidenceCaution, 'caution']]) {
        const text = localized(item, key);
        if (text) facts.append(element('dt', '', name), element('dd', '', text));
      }
      source.append(facts);
      if (/^https?:\/\//i.test(item.url ?? '')) {
        const link = element('a', 'lab-policy-source__link', `${copy.source} ↗`);
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `${copy.source}: ${item.title}`);
        source.append(link);
      }
      evidence.append(source);
    }
    return evidence;
  }

  function renderDetails(policy) {
    detailsBody.replaceChildren();
    details.hidden = !policy;
    if (!policy) return;
    const article = element('article', 'lab-policy-detail');
    article.dataset.policyDetail = policy.id;
    const title = element('h2', '', `${policy.id} · ${localized(policy, 'title')}`);
    title.dataset.policyTitle = '';
    const design = section(copy.design);
    const variables = element('ul', 'lab-policy-variables');
    for (const variable of localized(policy, 'variables')) variables.append(element('li', '', variable));
    design.append(variables);
    const sections = element('div', 'lab-policy-detail__sections');
    sections.append(design, section(copy.derivation, localized(policy, 'derivation'), 'lab-policy-section--derivation'), section(copy.mapping, localized(policy, 'mapping')), section(copy.limits, localized(policy, 'limitation'), 'lab-policy-section--limits'));
    if (policy.conversion) {
      const assumption = section(copy.assumptionTitle, policy.conversion === 'rr' ? copy.assumptionRR : copy.assumptionOR, 'lab-policy-section--assumption');
      assumption.dataset.policyAssumption = policy.conversion;
      sections.append(assumption);
    }
    article.append(title, sections, evidenceFor(policy));
    detailsBody.append(article);
  }

  function choose(id, notify = false) {
    const policy = policyOptions.find(policy => policy.id === id) ?? null;
    select.value = policy?.id ?? '';
    selectedSummary.replaceChildren();
    selectedSummary.dataset.policySummary = policy?.id ?? '';
    if (policy) {
      const badge = element('span', `lab-policy-badge lab-policy-badge--${policy.readiness}`, copy[policy.readiness] ?? copy.extension);
      const lead = element('div', 'lab-policy-picker__lead');
      lead.append(badge);
      const or = policy.survey_or;
      if (or && or.lo < 1 && or.hi > 1) {
        // v6.0: a survey odds ratio whose 95% interval crosses 1 is uncertain evidence (D1 review board, methods 9)
        const flag = element('span', 'lab-policy-badge lab-policy-badge--uncertain', copy.uncertain);
        flag.dataset.policyUncertain = policy.id;
        flag.title = copy.uncertainHint(or);
        lead.append(flag);
      }
      lead.append(element('p', '', localized(policy, 'summary')));
      selectedSummary.append(lead);
      if (or && or.lo < 1 && or.hi > 1) selectedSummary.append(element('p', 'lab-policy-picker__uncertain', copy.uncertainHint(or)));
      const others = (policy.shared_with ?? []).filter(id => id !== policy.id);
      if (others.length) {
        const value = policy.defaults?.['retention.resignation_reduction'];
        const note = element('p', 'lab-policy-picker__shared', copy.shared(others.join(', '), value));
        note.dataset.policyShared = others.join(' ');
        selectedSummary.append(note);
      }
      const notice = localized(policy, 'notice');
      if (notice) {
        const node = element('p', 'lab-policy-picker__notice', notice);
        node.dataset.policyNotice = policy.id;
        selectedSummary.append(node);
      }
      if (!policy.route) selectedSummary.append(element('p', 'lab-policy-picker__missing', copy.extensionHint));
      const settings = describe(policy);
      if (settings.length) {
        const applied = element('div', 'lab-policy-picker__applied');
        applied.dataset.policyApplied = policy.id;
        const list = element('ul', '');
        for (const line of settings) list.append(element('li', '', line));
        applied.append(element('p', '', copy.applied), list);
        selectedSummary.append(applied);
      }
    } else {
      selectedSummary.append(element('p', 'lab-policy-picker__hint', copy.ownHint));
    }
    details.open = false;
    renderDetails(policy);
    if (notify) onSelect(policy);
  }

  select.addEventListener('change', () => choose(select.value, true));
  choose(selectedId);
  return {
    details,
    update(patch = {}) { choose(typeof patch === 'string' || patch === null ? patch : patch.selectedId); },
    destroy() { root.remove(); details.remove(); },
  };
}
