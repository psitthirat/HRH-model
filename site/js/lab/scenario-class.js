// Study Lab (Tier 1) label of a configuration, decided from its parameters alone:
// baseline = the study's published configuration; sensitivity = a published preset, or
// only predefined choices (select/boolean controls); user = any value typed by the user.
import { same, registryEntries } from './fields.js';

const LABELS = {
  baseline: ['baseline · ค่าตามรายงาน', 'Baseline · study configuration',
    'ทุกค่าตรงกับชุดตั้งต้นของรายงานบทที่ 5', 'Every value equals the Chapter 5 study configuration.'],
  sensitivity: ['sensitivity · ตัวเลือกที่เผยแพร่', 'Sensitivity · published options',
    'ต่างจากชุดตั้งต้นเฉพาะตัวเลือกที่กำหนดไว้ล่วงหน้า หรือเป็นแผนที่เผยแพร่ในรายงาน', 'Differs from the study configuration only through predefined choices, or is a published plan.'],
  user: ['user scenario · ค่าที่ผู้ใช้กำหนด', 'User scenario · user-defined values',
    'มีค่าที่ผู้ใช้กรอกเอง ผลขึ้นกับสมมติฐานนั้น ไม่ใช่ผลของรายงาน', 'Contains values entered by the user; results depend on them and are not study results.'],
};

export function scenarioClass(config, lab) {
  const params = config?.parameters || {};
  const base = lab?.baseline_config?.parameters || lab?.default_config?.parameters || {};
  const changed = Object.keys({ ...base, ...params }).filter(k => !same(params[k] ?? base[k], base[k]));
  if (!changed.length) return 'baseline';
  const presets = Array.isArray(lab?.presets) ? lab.presets : Object.values(lab?.presets || {});
  if (presets.some(p => same({ ...base, ...(p.config?.parameters || {}) }, { ...base, ...params }))) return 'sensitivity';
  const byId = new Map(registryEntries(lab?.parameter_registry).map(p => [p.id, p]));
  const predefined = id => { const p = byId.get(id); return !!p && ['select', 'boolean'].includes(p.type) && p.tier1 !== 'fixed'; };
  return changed.every(predefined) ? 'sensitivity' : 'user';
}

export const scenarioLabel = (cls, lang = 'th') => LABELS[cls]?.[lang === 'en' ? 1 : 0] || cls;
export const scenarioHelp = (cls, lang = 'th') => LABELS[cls]?.[lang === 'en' ? 3 : 2] || '';
