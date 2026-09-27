import { policyOptions, policyGroups, policyEvidence } from './policy-data.js';

const COPY = {
  th: {
    select: 'นโยบายที่ต้องการทดลอง', own: 'กำหนดสมมติฐานเอง',
    ownHint: 'ปรับค่าตัวแปรในแบบฟอร์มด้านล่าง แล้วคำนวณผลภายใต้สมมติฐานของคุณ',
    disclaimer: 'ประสิทธิผล ประสิทธิภาพ และความคุ้มค่าในบริบทไทยยังต้องศึกษาเพิ่มเติม ผลจำลองเป็นผลภายใต้สมมติฐาน ไม่ใช่ผลของนโยบายที่ยืนยันแล้ว',
    assumption: 'ทดลองผลที่สมมติได้', extension: 'ยังไม่มีตัวควบคุมโดยตรง',
    extensionHint: 'นโยบายนี้ยังไม่มีตัวควบคุมที่แทนกลไกได้ตรง ต้องเพิ่มข้อมูลหรือโมดูลก่อนประเมินผลของนโยบาย',
    hoursHint: 'ชั่วโมงทำงานของแพทย์ไม่ใช่ค่านาทีที่ใช้เป็นน้ำหนักดัชนีบริการ จึงใช้แทนกันไม่ได้',
    details: 'เงื่อนไขและหลักฐานของนโยบาย',
    design: 'สิ่งที่ควรกำหนดในการทดลอง', mapping: 'เชื่อมกับ Lab อย่างไร', limits: 'สิ่งที่ยังสรุปไม่ได้',
    evidence: n => `หลักฐานและแหล่งอ้างอิง · ${n} แหล่ง`, evidenceDesign: 'รูปแบบการศึกษา',
    evidenceFinding: 'สิ่งที่งานวิจัยรายงาน', evidenceCaution: 'ขอบเขตการนำไปใช้', source: 'อ่านต้นฉบับ',
    evidenceNote: 'OR ของการเลือกงาน HR ของการออก และผลต่อบริการต่อชั่วโมง เป็นคนละตัวชี้วัด และไม่ใช่ขนาดผลที่นำไปใส่แบบจำลองแทนกันได้โดยตรง',
    noEvidence: 'ยังไม่มีค่าประมาณที่ตรงกับนโยบายและกลุ่มเป้าหมายจากแหล่งที่ตรวจในรอบนี้',
  },
  en: {
    select: 'Policy to explore', own: 'Set your own assumptions',
    ownHint: 'Edit the controls below, then calculate outcomes under your assumptions.',
    disclaimer: 'Effectiveness, efficiency and cost-effectiveness in Thailand require further study. Simulations show outcomes under stated assumptions, not established policy effects.',
    assumption: 'Explore an assumed effect', extension: 'No direct model control yet',
    extensionHint: 'The Lab has no control that directly represents this policy mechanism yet. Further data or a model extension are needed to assess its effects.',
    hoursHint: 'Physician working hours are not the minute weights used in the service index; these quantities are not interchangeable.',
    details: 'Policy conditions and evidence',
    design: 'What to specify in an experiment', mapping: 'How this connects to the Lab', limits: 'What cannot yet be concluded',
    evidence: n => `Evidence and sources · ${n}`, evidenceDesign: 'Study design',
    evidenceFinding: 'What the study reported', evidenceCaution: 'Limits to application', source: 'Read the source',
    evidenceNote: 'Odds ratios for job choice, hazard ratios for leaving, and consultations per hour measure different outcomes. They are not interchangeable model inputs.',
    noEvidence: 'The sources reviewed so far do not provide an estimate that directly matches this policy and target population.',
  },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/** Policy context only: the caller owns the controls, scenario and calculation. */
export function renderPolicyLibrary(host, { lang = 'th', selectedId = null, onSelect = () => {} } = {}) {
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
    sections.append(design, section(copy.mapping, localized(policy, 'mapping')), section(copy.limits, localized(policy, 'limitation'), 'lab-policy-section--limits'));
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
      lead.append(badge, element('p', '', localized(policy, 'summary')));
      selectedSummary.append(lead);
      if (!policy.route) selectedSummary.append(element('p', 'lab-policy-picker__missing', copy.extensionHint));
      if (['P01', 'P02'].includes(policy.id)) selectedSummary.append(element('p', 'lab-policy-picker__hint', copy.hoursHint));
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
