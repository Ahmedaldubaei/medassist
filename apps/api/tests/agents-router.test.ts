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
  it.each([
    'اريد مساعدتكم في حاله تحتاج تخدير موضعي',
    'ما هي مضاعفات التخدير الموضعي؟',
    'التخدير الشوكي لعملية قيصرية',
    'حصار العصب الفخذي بعد جراحة الركبة',
    'التخدير فوق الجافية أثناء الولادة',
    'الحصار العصبي في جراحة الكتف',
  ])('routes regional-anesthesia Arabic terms to anesthesiology: %s', (q) => {
    const d = route(q);
    expect(d.agentId).toBe('anesthesiology');
    expect(d.emergency).toBeNull();
  });
  it.each([
    'local anesthesia for hand surgery',
    'neuraxial techniques compared',
    'peripheral nerve block complications',
    'spinal anesthesia in elderly',
    'epidural anesthesia for labor',
  ])('routes regional-anesthesia English terms to anesthesiology: %s', (q) => {
    const d = route(q);
    expect(d.agentId).toBe('anesthesiology');
    expect(d.emergency).toBeNull();
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

/**
 * Safety policy v2.0-draft §4.1 — emergency detection test-plan IDs.
 * E-01: clear acute reports → ESCALATE (via detectEmergency hit).
 * E-02: dialectal / misspelled Arabic life-threats must be caught.
 * E-03: mixed Arabic/English reports.
 * E-04: explicit educational questions must NOT escalate.
 * E-05: MH / LAST suspicion in a current patient → escalate.
 * E-09: escalation text must not invent an ambulance number.
 */
describe('detectEmergency — policy v2.0 test plan', () => {
  // E-01: clear acute reports
  it.each([
    ['المريض توقف قلبه', 'cardiac_arrest'],
    ['لا يوجد نبض عند المريض', 'cardiac_arrest'],
    ['المريض توقف عن التنفس', 'respiratory_arrest'],
    ['نزيف حاد لا يتوقف', 'severe_bleeding'],
  ])('E-01 hits acute report: %s', (phrase, category) => {
    const hit = detectEmergency(phrase);
    expect(hit).not.toBeNull();
    expect(hit!.category).toBe(category);
  });

  // E-02: Yemeni/Gulf dialect variants (policy §4.1)
  it.each([
    ['قلبه وقف', 'cardiac_arrest'],
    ['المريض توقف قلبه', 'cardiac_arrest'],
    ['ما يتنفس', 'respiratory_arrest'],
    ['مب قادر يتنفس', 'respiratory_arrest'],
    ['مو قادر يتنفس', 'respiratory_arrest'],
    ['نزيف قوي', 'severe_bleeding'],
    ['ينزف بقوة', 'severe_bleeding'],
    ['ضغطه نازل 70/40', 'shock'],
    ['عنده حساسيه من البنج', 'anaphylaxis'],
    ['عنده حساسية من البنج', 'anaphylaxis'], // orthographic variant ة/ه
    ['يتشنج المريض', 'seizure'],
  ])('E-02 hits dialect emergency: %s', (phrase, category) => {
    const hit = detectEmergency(phrase);
    expect(hit).not.toBeNull();
    expect(hit!.category).toBe(category);
  });

  // E-03: mixed Arabic/English
  it.each([
    'patient قلبه وقف',
    'المريض cardiac arrest',
    'عنده anaphylaxis بعد البنج',
  ])('E-03 hits mixed-language report: %s', (phrase) => {
    expect(detectEmergency(phrase)).not.toBeNull();
  });

  // E-04: educational questions must NOT escalate
  it.each([
    'ما هو تعريف توقف القلب؟',
    'ما تعريف الصدمة التحسسية؟',
    'عرف لي توقف التنفس',
    'اشرح لي أسباب توقف القلب',
    'what is the definition of cardiac arrest?',
  ])('E-04 does not escalate educational question: %s', (phrase) => {
    expect(detectEmergency(phrase)).toBeNull();
  });

  it('E-04 still escalates when acute markers accompany the question', () => {
    // Conservative: a real report wins over the educational phrasing.
    expect(detectEmergency('ما هو تعريف توقف القلب؟ المريض قلبه وقف الآن')).not.toBeNull();
  });

  // E-05: MH / LAST suspicion in a current patient
  it.each([
    'اشتباه فرط حرارة خبيث عند المريض',
    'المريض حرارته ترتفع بعد البنج اشتباه فرط حرارة خبيث',
    'المريض عنده تسمم بالمخدر الموضعي',
    'اشتباه سمية مخدر موضعي، المريض يتدهور',
  ])('E-05 escalates MH/LAST suspicion: %s', (phrase) => {
    expect(detectEmergency(phrase)).not.toBeNull();
  });

  it('E-05 does not escalate pure knowledge questions about MH/LAST', () => {
    expect(detectEmergency('ما هو علاج فرط الحرارة الخبيث؟')).toBeNull();
    expect(detectEmergency('dantrolene dose for malignant hyperthermia')).toBeNull();
  });
});

describe('normalizeArabic', () => {
  it('maps أ/إ/آ→ا، ة→ه، ى→ي', async () => {
    const { normalizeArabic } = await import('../src/agents/router.js');
    expect(normalizeArabic('أحمد إسلام آية حساسية منى')).toBe('احمد اسلام ايه حساسيه مني');
  });
});
