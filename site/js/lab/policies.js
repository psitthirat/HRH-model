import { policyOptions, policyGroups, policyEvidence } from './policy-data.js';

const COPY = {
  th: {
    eyebrow: 'WORKFORCE LAB · POLICY OPTIONS', title: 'ทางเลือกนโยบายกำลังคน',
    intro: 'เริ่มจากสิ่งที่นโยบายจัดให้ แล้วแยกผลต่อการทำงานและการคงอยู่ที่ยังต้องศึกษา',
    disclaimer: 'ประสิทธิผล ประสิทธิภาพ และความคุ้มค่าในบริบทไทยยังต้องศึกษาเพิ่มเติม ผลจำลองเป็นผลภายใต้สมมติฐาน ไม่ใช่ผลของนโยบายที่ยืนยันแล้ว',
    search: 'ค้นหานโยบาย', placeholder: 'เช่น ชั่วโมงทำงาน ค่าตอบแทน บ้านพัก',
    group: 'กลุ่มนโยบาย', allGroups: 'ทุกกลุ่ม', readiness: 'การทดลองใน Lab', allReadiness: 'ทุกทางเลือก',
    assumption: 'ทดลองสมมติฐานได้', extension: 'ต้องเพิ่มโมดูลหรือข้อมูล',
    count: (n, total) => `แสดง ${n} จาก ${total} ทางเลือก`,
    empty: 'ไม่พบนโยบายที่ตรงกับการค้นหา', emptyHint: 'ลองคำอื่น หรือเลือกทุกกลุ่มและทุกทางเลือก',
    reset: 'ล้างการค้นหาและตัวกรอง', choose: 'เลือกนโยบายเพื่ออ่านรายละเอียด',
    design: 'สิ่งที่ควรกำหนดในการทดลอง', mapping: 'เชื่อมกับ Lab อย่างไร', limits: 'สิ่งที่ยังสรุปไม่ได้',
    evidence: n => `หลักฐานและแหล่งอ้างอิง · ${n} แหล่ง`, evidenceDesign: 'รูปแบบการศึกษา',
    evidenceFinding: 'สิ่งที่งานวิจัยรายงาน', evidenceCaution: 'ขอบเขตการนำไปใช้', source: 'อ่านต้นฉบับ',
    evidenceNote: 'OR ของการเลือกงาน HR ของการออก และผลต่อบริการต่อชั่วโมง เป็นคนละตัวชี้วัด และไม่ใช่ขนาดผลที่นำไปใส่แบบจำลองแทนกันได้โดยตรง',
    noEvidence: 'ยังไม่มีค่าประมาณที่ตรงกับนโยบายและกลุ่มเป้าหมายจากแหล่งที่ตรวจในรอบนี้',
    use: 'ตั้งสมมติฐานที่เกี่ยวข้อง', useHint: 'เลือกขนาดผลที่จะทดลองเอง โดยแยกจากค่าที่รายงานในงานวิจัย',
    missing: 'ทางเลือกนี้ยังไม่มีตัวควบคุมที่แทนกลไกนโยบายได้ตรง ต้องเพิ่มข้อมูลหรือโมดูลตามรายละเอียดข้างต้น',
    backToList: 'กลับไปเลือกนโยบาย',
  },
  en: {
    eyebrow: 'WORKFORCE LAB · POLICY OPTIONS', title: 'Workforce policy options',
    intro: 'Define what a policy provides, then examine the effects on work and retention that still need evidence.',
    disclaimer: 'Effectiveness, efficiency and cost-effectiveness in Thailand require further study. Simulations show outcomes under stated assumptions, not established policy effects.',
    search: 'Search policies', placeholder: 'For example: working hours, pay, housing',
    group: 'Policy group', allGroups: 'All groups', readiness: 'Exploring in the Lab', allReadiness: 'All options',
    assumption: 'Explore an assumed effect', extension: 'Needs a module or data',
    count: (n, total) => `Showing ${n} of ${total} options`,
    empty: 'No policies match your search', emptyHint: 'Try another term, or select all groups and all options.',
    reset: 'Clear search and filters', choose: 'Select a policy to read its details',
    design: 'What to specify in an experiment', mapping: 'How this connects to the Lab', limits: 'What cannot yet be concluded',
    evidence: n => `Evidence and sources · ${n}`, evidenceDesign: 'Study design',
    evidenceFinding: 'What the study reported', evidenceCaution: 'Limits to application', source: 'Read the source',
    evidenceNote: 'Odds ratios for job choice, hazard ratios for leaving, and consultations per hour measure different outcomes. They are not interchangeable model inputs.',
    noEvidence: 'The sources reviewed so far do not provide an estimate that directly matches this policy and target population.',
    use: 'Set related assumptions', useHint: 'Choose the effect to explore separately from the estimates reported in the literature.',
    missing: 'The Lab has no control that directly represents this policy mechanism yet. It needs the data or module described above.',
    backToList: 'Back to the policy list',
  },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/** Read-only policy browsing. onUse requests navigation; it never changes model inputs. */
export function renderPolicyLibrary(host, { lang = 'th', state = {}, compactHeader = false, onState = () => {}, onUse = () => {} } = {}) {
  const language = lang === 'en' ? 'en' : 'th';
  const copy = COPY[language];
  const current = { query: '', group: 'all', readiness: 'all', selectedId: 'P07', ...state };
  const localized = (item, key) => item?.[`${key}_${language}`] ?? item?.[`${key}_th`] ?? '';
  const groupLabel = id => localized(policyGroups.find(group => group.id === id), 'label');
  const root = element('section', 'lab-policy-library');
  root.classList.toggle('lab-policy-library--compact', compactHeader);
  root.dataset.lang = language;
  root.setAttribute('aria-label', copy.title);

  const heading = element('header', 'lab-policy-library__header');
  heading.append(element('p', 'lab-policy-library__eyebrow', copy.eyebrow), element('h2', '', copy.title), element('p', 'lab-policy-library__intro', copy.intro));
  const disclaimer = element('p', 'lab-policy-library__disclaimer', copy.disclaimer);
  disclaimer.dataset.policyDisclaimer = '';

  const filters = element('div', 'lab-policy-filters');
  const searchLabel = element('label', 'lab-policy-search');
  searchLabel.append(element('span', '', copy.search));
  const search = element('input');
  search.type = 'search';
  search.dataset.policySearch = '';
  search.placeholder = copy.placeholder;
  search.value = current.query;
  search.autocomplete = 'off';
  searchLabel.append(search);
  const readinessLabel = element('label', 'lab-policy-readiness');
  readinessLabel.append(element('span', '', copy.readiness));
  const readiness = element('select');
  readiness.dataset.policyReadiness = '';
  for (const [value, label] of [['all', copy.allReadiness], ['assumption', copy.assumption], ['extension', copy.extension]]) {
    const option = element('option', '', label);
    option.value = value;
    readiness.append(option);
  }
  readiness.value = current.readiness;
  readinessLabel.append(readiness);
  filters.append(searchLabel, readinessLabel);

  const groups = element('div', 'lab-policy-groups');
  groups.setAttribute('role', 'group');
  groups.setAttribute('aria-label', copy.group);
  for (const group of [{ id: 'all', label_th: copy.allGroups, label_en: copy.allGroups }, ...policyGroups]) {
    const button = element('button', 'lab-policy-group', localized(group, 'label'));
    button.type = 'button';
    button.dataset.policyGroup = group.id;
    button.addEventListener('click', () => change({ group: group.id }));
    groups.append(button);
  }

  const count = element('p', 'lab-policy-count');
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  const layout = element('div', 'lab-policy-layout');
  const list = element('nav', 'lab-policy-list');
  list.setAttribute('aria-label', copy.group);
  list.tabIndex = -1;
  const detailHost = element('div', 'lab-policy-detail-host');
  layout.append(list, detailHost);
  if (!compactHeader) root.append(heading);
  root.append(disclaimer, filters, groups, count, layout);
  host.replaceChildren(root);

  function badge(policy) {
    const node = element('span', `lab-policy-badge lab-policy-badge--${policy.readiness}`, copy[policy.readiness] ?? copy.extension);
    return node;
  }

  function change(patch, focusDetail = false) {
    Object.assign(current, patch);
    const previousId = current.selectedId;
    paint({ resetScroll: ['query', 'group', 'readiness'].some(key => key in patch) });
    if (previousId !== current.selectedId) patch = { ...patch, selectedId: current.selectedId };
    onState({ ...patch });
    if (focusDetail) {
      const title = detailHost.querySelector('[data-policy-title]');
      title?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 760px)').matches) {
        detailHost.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }
  }

  function matchingPolicies() {
    const query = String(current.query).trim().toLocaleLowerCase(language);
    return policyOptions.filter(policy => {
      if (current.group !== 'all' && policy.group !== current.group) return false;
      if (current.readiness !== 'all' && policy.readiness !== current.readiness) return false;
      const terms = [policy.id, localized(policy, 'title'), localized(policy, 'summary'), groupLabel(policy.group), ...localized(policy, 'variables'), ...(policy.evidence_ids ?? [])].join(' ').toLocaleLowerCase(language);
      return !query || terms.includes(query);
    });
  }

  function detailSection(title, text, className = '') {
    const section = element('section', `lab-policy-section ${className}`.trim());
    section.append(element('h4', '', title));
    if (text) section.append(element('p', '', text));
    return section;
  }

  function paintEvidence(policy) {
    const items = (policy.evidence_ids ?? []).map(id => policyEvidence[id]).filter(Boolean);
    if (!items.length) return element('p', 'lab-policy-no-evidence', copy.noEvidence);
    const details = element('details', 'lab-policy-evidence');
    details.dataset.policyEvidence = '';
    details.append(element('summary', '', copy.evidence(items.length)));
    const body = element('div', 'lab-policy-evidence__body');
    body.append(element('p', 'lab-policy-evidence__note', copy.evidenceNote));
    for (const evidence of items) {
      const article = element('article', 'lab-policy-source');
      article.dataset.evidenceId = evidence.id;
      article.append(element('h5', '', `${evidence.id} · ${evidence.title}`));
      const descriptions = element('dl', 'lab-policy-source__facts');
      for (const [label, key] of [[copy.evidenceDesign, 'design'], [copy.evidenceFinding, 'finding'], [copy.evidenceCaution, 'caution']]) {
        const text = localized(evidence, key);
        if (text) descriptions.append(element('dt', '', label), element('dd', '', text));
      }
      article.append(descriptions);
      if (/^https?:\/\//i.test(evidence.url ?? '')) {
        const source = element('a', 'lab-policy-source__link', `${copy.source} ↗`);
        source.href = evidence.url;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.setAttribute('aria-label', `${copy.source}: ${evidence.title}`);
        article.append(source);
      }
      body.append(article);
    }
    details.append(body);
    return details;
  }

  function paintDetail(policy) {
    if (!policy) {
      detailHost.replaceChildren();
      return;
    }
    const article = element('article', 'lab-policy-detail');
    article.dataset.policyDetail = policy.id;
    const meta = element('div', 'lab-policy-detail__meta');
    meta.append(element('span', 'lab-policy-id', policy.id), element('span', '', groupLabel(policy.group)), badge(policy));
    const title = element(compactHeader ? 'h2' : 'h3', '', localized(policy, 'title'));
    title.dataset.policyTitle = '';
    title.tabIndex = -1;
    const summary = element('p', 'lab-policy-detail__summary', localized(policy, 'summary'));
    const design = detailSection(copy.design);
    const variables = element('ul', 'lab-policy-variables');
    for (const variable of localized(policy, 'variables')) variables.append(element('li', '', variable));
    design.append(variables);
    const mapping = detailSection(copy.mapping, localized(policy, 'mapping'), 'lab-policy-section--mapping');
    const limits = detailSection(copy.limits, localized(policy, 'limitation'), 'lab-policy-section--limits');
    article.append(meta, title, summary, design, mapping, limits, paintEvidence(policy));
    const actions = element('div', 'lab-policy-detail__actions');
    if (policy.route) {
      const use = element('button', 'btn btn--primary lab-policy-use', copy.use);
      use.type = 'button';
      use.dataset.action = 'policy-use';
      use.addEventListener('click', () => onUse(policy));
      actions.append(use, element('p', '', copy.useHint));
    } else {
      actions.append(element('p', 'lab-policy-extension-note', copy.missing));
    }
    const back = element('button', 'lab-policy-back', copy.backToList);
    back.type = 'button';
    back.addEventListener('click', () => {
      list.querySelector(`[data-policy-id="${policy.id}"]`)?.focus({ preventScroll: true });
      list.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    actions.append(back);
    article.append(actions);
    detailHost.replaceChildren(article);
  }

  function revealSelection() {
    const selected = list.querySelector('[aria-pressed="true"]');
    if (!selected || !list.clientHeight) return;
    // Move only the independently scrolling list; never scroll the whole page.
    const listBox = list.getBoundingClientRect();
    const cardBox = selected.getBoundingClientRect();
    if (cardBox.top < listBox.top + 3) list.scrollTop -= listBox.top + 3 - cardBox.top;
    else if (cardBox.bottom > listBox.bottom - 3) list.scrollTop += cardBox.bottom - listBox.bottom + 3;
  }

  function paint({ resetScroll = false } = {}) {
    const previousScroll = resetScroll ? 0 : list.scrollTop;
    const policies = matchingPolicies();
    if (policies.length && !policies.some(policy => policy.id === current.selectedId)) current.selectedId = policies[0].id;
    for (const button of groups.children) button.setAttribute('aria-pressed', String(button.dataset.policyGroup === current.group));
    count.textContent = copy.count(policies.length, policyOptions.length);
    list.replaceChildren();
    for (const policy of policies) {
      const button = element('button', 'lab-policy-card');
      button.type = 'button';
      button.dataset.policyId = policy.id;
      button.setAttribute('aria-pressed', String(policy.id === current.selectedId));
      const top = element('span', 'lab-policy-card__meta');
      top.append(element('span', 'lab-policy-id', policy.id), badge(policy));
      button.append(top, element('span', 'lab-policy-card__title', localized(policy, 'title')), element('span', 'lab-policy-card__group', groupLabel(policy.group)));
      button.addEventListener('click', () => change({ selectedId: policy.id }, true));
      list.append(button);
    }
    if (!policies.length) {
      const empty = element('div', 'lab-policy-empty');
      empty.append(element('h3', '', copy.empty), element('p', '', copy.emptyHint));
      const reset = element('button', 'btn', copy.reset);
      reset.type = 'button';
      reset.dataset.action = 'policy-clear';
      reset.addEventListener('click', () => {
        search.value = '';
        readiness.value = 'all';
        change({ query: '', group: 'all', readiness: 'all' });
        search.focus();
      });
      empty.append(reset);
      list.append(empty);
    }
    paintDetail(policies.find(policy => policy.id === current.selectedId));
    layout.classList.toggle('lab-policy-layout--empty', !policies.length);
    list.scrollTop = previousScroll;
    revealSelection();
  }

  search.addEventListener('input', () => change({ query: search.value }));
  readiness.addEventListener('change', () => change({ readiness: readiness.value }));
  paint();
  return {
    update(patch = {}) {
      Object.assign(current, patch);
      search.value = current.query;
      readiness.value = current.readiness;
      paint();
    },
    destroy() { root.remove(); },
  };
}
