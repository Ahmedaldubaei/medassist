import { describe, expect, it } from 'vitest';
import { detectEmergency, detectLanguage, route } from '../src/agents/router.js';

describe('detectLanguage', () => {
  it('detects Arabic', () => {
    expect(detectLanguage('ما هو علاج فرط الحرارة الخبيث؟')).toBe('ar');
  });
  it('detects English', () => {
    expect(detectLanguage('What is the dantrolene dose?')).toBe('en');
  });
  it('defaults to Arabic on empty/neutral input', () => {
    expect(detectLanguage('123')).toBe('ar');
  });
});

/**
 * Emergency detection: 0% failure required. Every phrase below MUST hit.
 * False positives are acceptable; false negatives are not.
 */
const EMERGENCY_PHRASES_AR = [
  'المريض توقف عن التنفس',
  'توقف القلب والنبض متوقف',
  'يوجد نزيف حاد لا يتوقف',
  'المريض في صدمة تحسسية',
  'نوبة صرع مستمرة',
  'ألم شديد في الصدر',
  'اشتباه سكتة دماغية',
];

const EMERGENCY_PHRASES_EN = [
  'the patient is not breathing',
  'cardiac arrest in the OR',
  'severe bleeding, uncontrolled',
  'anaphylaxis after induction',
  'patient having a seizure',
  'crushing chest pain',
  'signs of stroke, facial droop',
];

describe('detectEmergency (0% failure required)', () => {
  for (const phrase of EMERGENCY_PHRASES_AR) {
    it(`AR hits: "${phrase.slice(0, 30)}"`, () => {
      expect(detectEmergency(phrase)).not.toBeNull();
    });
  }
  for (const phrase of EMERGENCY_PHRASES_EN) {
    it(`EN hits: "${phrase.slice(0, 30)}"`, () => {
      expect(detectEmergency(phrase)).not.toBeNull();
    });
  }
  it('does not fire on ordinary medical questions', () => {
    expect(detectEmergency('ما هو علاج فرط الحرارة الخبيث؟')).toBeNull();
    expect(detectEmergency('What is the dantrolene dose for malignant hyperthermia?')).toBeNull();
    expect(detectEmergency('مرحبا')).toBeNull();
  });
});

describe('route', () => {
  it('routes anesthesia questions to the anesthesiology agent', () => {
    const d = route('ما هو بروتوكول علاج فرط الحرارة الخبيث أثناء التخدير؟');
    expect(d.agentId).toBe('anesthesiology');
    expect(d.lang).toBe('ar');
    expect(d.emergency).toBeNull();
  });
  it('routes English anesthesia questions to the anesthesiology agent', () => {
    const d = route('dantrolene dose malignant hyperthermia');
    expect(d.agentId).toBe('anesthesiology');
    expect(d.lang).toBe('en');
  });
  it('routes greetings to the assistant agent', () => {
    expect(route('مرحبا').agentId).toBe('assistant');
    expect(route('hello').agentId).toBe('assistant');
  });
  it('routes general medical questions to the knowledge agent', () => {
    const d = route('What are the symptoms of diabetes?');
    expect(d.agentId).toBe('knowledge');
  });
  it('flags emergencies before any agent selection', () => {
    const d = route('المريض توقف عن التنفس');
    expect(d.emergency).not.toBeNull();
    expect(d.emergency!.category).toBe('respiratory_arrest');
  });
});
