import { describe, expect, it } from 'vitest';
import {
  disclaimerFor,
  extractDosages,
  isDosageGrounded,
  postCheck,
  preCheck,
} from '../src/agents/safety.js';
import type { RetrievalResult } from '../src/rag/retrieve.js';

function chunk(textEn: string): RetrievalResult {
  return {
    chunkId: 'c1',
    documentId: 'd1',
    section: null,
    textEn,
    textAr: null,
    title: 'Test doc',
    source: 'test',
    guidelineYear: 2020,
    url: null,
    license: 'test',
    specialty: 'ANESTHESIOLOGY',
    score: 0.5,
    vectorRank: 1,
    keywordRank: 1,
  };
}

describe('preCheck', () => {
  it('escalates Arabic emergencies with Arabic guidance', () => {
    const r = preCheck('المريض توقف عن التنفس', 'ar');
    expect(r.escalate).toBe(true);
    expect(r.emergency?.category).toBe('respiratory_arrest');
    expect(r.text).toContain('طوارئ');
  });
  it('escalates English emergencies with English guidance', () => {
    const r = preCheck('patient has no pulse, cardiac arrest', 'en');
    expect(r.escalate).toBe(true);
    expect(r.text).toContain('Emergency');
  });
  it('passes ordinary questions through', () => {
    const r = preCheck('ما هي جرعة الدانترولين؟', 'ar');
    expect(r.escalate).toBe(false);
  });
});

describe('extractDosages', () => {
  it('extracts EN doses incl. ranges and per-kg', () => {
    const ds = extractDosages('Give dantrolene 2.5 mg/kg IV, may repeat 1-2 mg.');
    expect(ds.map((d) => d.raw)).toEqual(['2.5 mg', '1-2 mg']);
    expect(ds[0]!.numbers).toEqual(['2.5']);
  });
  it('extracts AR doses', () => {
    const ds = extractDosages('أعط 5 ملغ من الدواء');
    expect(ds).toHaveLength(1);
    expect(ds[0]!.unit).toBe('ملغ');
  });
  it('finds nothing in dose-free text', () => {
    expect(extractDosages('Monitor the airway.')).toHaveLength(0);
  });
});

describe('isDosageGrounded', () => {
  const chunks = [chunk('Dantrolene dosing starts at 2.5 mg per kg intravenously.')];
  it('grounds a dose present in the chunks (EN)', () => {
    expect(isDosageGrounded({ raw: '2.5 mg', numbers: ['2.5'], unit: 'mg', index: 0 }, chunks)).toBe(true);
  });
  it('grounds across EN/AR unit spellings', () => {
    expect(isDosageGrounded({ raw: '2.5 ملغ', numbers: ['2.5'], unit: 'ملغ', index: 0 }, chunks)).toBe(true);
  });
  it('rejects a dose absent from the chunks', () => {
    expect(isDosageGrounded({ raw: '100 mg', numbers: ['100'], unit: 'mg', index: 0 }, chunks)).toBe(false);
  });
});

describe('postCheck', () => {
  const chunks = [chunk('Dantrolene dosing starts at 2.5 mg per kg intravenously and may be repeated.')];

  it('passes a fully grounded answer with valid citations', () => {
    const r = postCheck({
      draft: '## Documented knowledge\nGive dantrolene 2.5 mg/kg IV immediately [1].',
      chunks,
      lang: 'en',
    });
    expect(r.verdict).toBe('PASS');
    expect(r.text).toContain('2.5 mg/kg');
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.title).toBe('Test doc');
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it('removes fabricated citation markers and flags', () => {
    const r = postCheck({
      draft: 'Dantrolene works [1]. See also the famous study [9].',
      chunks,
      lang: 'en',
    });
    expect(r.verdict).toBe('FLAG');
    expect(r.text).not.toContain('[9]');
    expect(r.text).toContain('[1]');
    expect(r.checks.find((c) => c.name === 'citation_verification')!.passed).toBe(false);
  });

  it('accepts the CJK-bracket citation format LLMs emit', () => {
    const r = postCheck({
      draft: 'Give dantrolene 2.5 mg/kg IV immediately【1†L1-L3】.',
      chunks,
      lang: 'en',
    });
    expect(r.verdict).toBe('PASS');
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.title).toBe('Test doc');
  });

  it('removes fabricated CJK-bracket citation markers and flags', () => {
    const r = postCheck({
      draft: 'Dantrolene works【1†L1-L3】. See also the famous study【9†L1-L2】.',
      chunks,
      lang: 'en',
    });
    expect(r.verdict).toBe('FLAG');
    expect(r.text).not.toContain('【9');
    expect(r.text).toContain('【1†L1-L3】');
    expect(r.checks.find((c) => c.name === 'citation_verification')!.passed).toBe(false);
  });

  it('strips sentences with ungrounded doses but keeps grounded ones', () => {
    const r = postCheck({
      draft: 'Give dantrolene 2.5 mg/kg IV [1]. Also give 100 mg bolus now [1].',
      chunks,
      lang: 'en',
    });
    expect(r.verdict).toBe('FLAG');
    expect(r.text).toContain('2.5 mg/kg');
    expect(r.text).not.toContain('100 mg');
    expect(r.strippedDosages.length).toBeGreaterThan(0);
  });

  it('blocks a dose-centric answer with no grounded content left', () => {
    const r = postCheck({ draft: 'Give 100 mg now.', chunks, lang: 'en' });
    expect(r.verdict).toBe('BLOCK');
    expect(r.text).toContain('blocked');
  });

  it('provides the disclaimer in both languages', () => {
    expect(disclaimerFor('ar')).toContain('ليس بديلًا عن طبيب التخدير');
    expect(disclaimerFor('en')).toContain('not a substitute for an anesthesiologist');
  });
});

/**
 * Safety policy v2.0-draft — test-plan IDs.
 * E-09: escalation text must not invent an ambulance number (policy §4.2).
 */
describe('E-09 escalation text', () => {
  const PHONE_LIKE = /\+?\d[\d\s.\-()]{6,}\d/;
  it.each(['ar', 'en'] as const)('contains no phone-number pattern (%s)', (lang) => {
    const r = preCheck(lang === 'ar' ? 'قلبه وقف' : 'cardiac arrest now', lang);
    expect(r.escalate).toBe(true);
    expect(PHONE_LIKE.test(r.text)).toBe(false);
  });
  it('directs to the local emergency system without assuming a number', () => {
    const r = preCheck('قلبه وقف', 'ar');
    expect(r.text).toMatch(/الطوارئ المحلي|الإسعاف/);
  });
});

/**
 * Dosage extraction hardening (policy §7, tests D-01..D-12 unit-testable subset).
 */
describe('extractDosages — normalization (D-01..D-12 subset)', () => {
  it('detects Arabic-Indic digits: "٠٫٥ ملغ" → 0.5 ملغ', () => {
    const ds = extractDosages('أعط ٠٫٥ ملغ من الدواء');
    expect(ds).toHaveLength(1);
    expect(ds[0]!.numbers).toEqual(['0.5']);
    expect(ds[0]!.unit).toBe('ملغ');
  });
  it('accepts comma decimals: "2,5 mg" → 2.5 mg (not 5 mg)', () => {
    const ds = extractDosages('Give 2,5 mg IV');
    expect(ds).toHaveLength(1);
    expect(ds[0]!.numbers).toEqual(['2.5']);
    expect(ds[0]!.unit).toBe('mg');
  });
  it('handles comma decimals in ranges', () => {
    const ds = extractDosages('1,5-2,5 mg');
    expect(ds[0]!.numbers).toEqual(['1.5', '2.5']);
  });
});

describe('isDosageGrounded — route awareness (D-02)', () => {
  const ivChunk = chunk('Give dantrolene 2.5 mg per kg intravenously.');
  const dose = { raw: '2.5 mg', numbers: ['2.5'], unit: 'mg', index: 0 };
  it('D-02: a dose stated for a DIFFERENT route is NOT grounded by the chunk', () => {
    expect(isDosageGrounded(dose, [ivChunk], 'Give 2.5 mg IM now.')).toBe(false);
  });
  it('grounds when the route matches', () => {
    expect(isDosageGrounded(dose, [ivChunk], 'Give 2.5 mg IV now.')).toBe(true);
  });
  it('grounds when the draft states no route (permissive fallback)', () => {
    expect(isDosageGrounded(dose, [ivChunk])).toBe(true);
  });
  it('handles Arabic route terms', () => {
    const arChunk = chunk('أعط الدواء 2.5 ملغ وريديا.');
    expect(isDosageGrounded({ raw: '2.5 ملغ', numbers: ['2.5'], unit: 'ملغ', index: 0 }, [arChunk], 'أعط 2.5 ملغ وريدي.')).toBe(true);
    expect(isDosageGrounded({ raw: '2.5 ملغ', numbers: ['2.5'], unit: 'ملغ', index: 0 }, [arChunk], 'أعط 2.5 ملغ عضلي.')).toBe(false);
  });
});

describe('postCheck — D-07 multi-paragraph strip and re-verify', () => {
  const chunks = [chunk('Dantrolene dosing starts at 2.5 mg per kg intravenously.')];
  it('D-07: strips the ungrounded-dose sentence, keeps the rest, verdict FLAG', () => {
    const draft =
      'Malignant hyperthermia is a pharmacogenetic emergency. ' +
      'Give dantrolene 2.5 mg/kg IV immediately [1]. ' +
      'Also administer 999 mg of midazolam now for sedation.';
    const r = postCheck({ draft, chunks, lang: 'en' });
    expect(r.verdict).toBe('FLAG');
    expect(r.text).toContain('2.5 mg/kg');
    expect(r.text).not.toContain('999 mg');
    expect(r.text).toContain('pharmacogenetic emergency');
    // Re-verify: the sanitized output must itself pass cleanly (G-07).
    const r2 = postCheck({ draft: r.text, chunks, lang: 'en' });
    expect(r2.verdict).toBe('PASS');
  });
});

/**
 * Verdict taxonomy (policy §9.3, tests G-01..G-07).
 */
describe('SafetyVerdict taxonomy (G-01..G-07)', () => {
  it('G-01: clean grounded draft → PASS', async () => {
    const { SAFETY_VERDICTS } = await import('../src/agents/safety.js');
    expect(SAFETY_VERDICTS).toEqual(['PASS', 'FLAG', 'CLARIFY', 'ESCALATE', 'BLOCK', 'SAFE_FALLBACK']);
    const r = postCheck({
      draft: 'Give dantrolene 2.5 mg/kg IV [1].',
      chunks: [chunk('Dantrolene 2.5 mg per kg intravenously.')],
      lang: 'en',
    });
    expect(r.verdict).toBe('PASS');
  });
  it('G-02: corrected non-critical issue → FLAG', () => {
    const r = postCheck({
      draft: 'Dantrolene works [1]. See the famous study [9].',
      chunks: [chunk('Dantrolene 2.5 mg per kg intravenously.')],
      lang: 'en',
    });
    expect(r.verdict).toBe('FLAG');
    expect(r.checks.find((c) => c.name === 'citation_verification')!.passed).toBe(false);
  });
  it('G-04: emergency preCheck maps to ESCALATE verdict', () => {
    // Verdict assignment happens in pipeline.ts; the taxonomy carries it.
    const r = preCheck('قلبه وقف', 'ar');
    expect(r.escalate).toBe(true);
  });
  it('G-05: unsafe dose-centric content → BLOCK', () => {
    const r = postCheck({ draft: 'Give 100 mg now.', chunks: [], lang: 'en' });
    expect(r.verdict).toBe('BLOCK');
  });
  it('G-06: SAFE_FALLBACK message contains no medical claims or doses', async () => {
    const { safeFallbackText, extractDosages } = await import('../src/agents/safety.js');
    for (const lang of ['ar', 'en'] as const) {
      const t = safeFallbackText(lang);
      expect(extractDosages(t)).toHaveLength(0);
      expect(t).not.toMatch(/mg|ملغ|جرعة|dose/i);
    }
    expect(safeFallbackText('ar')).toContain('عطل فني');
  });
  it('G-07: postCheck output is stable under re-check (no new violations introduced)', () => {
    const draft = 'Give dantrolene 2.5 mg/kg IV [1]. Also give 100 mg bolus [1].';
    const chunks = [chunk('Dantrolene 2.5 mg per kg intravenously.')];
    const once = postCheck({ draft, chunks, lang: 'en' });
    const twice = postCheck({ draft: once.text, chunks, lang: 'en' });
    expect(twice.text).toBe(once.text);
    expect(twice.verdict).toBe('PASS');
  });
  it('policy version constant is 2.0-draft', async () => {
    const { POLICY_VERSION } = await import('../src/agents/safety.js');
    expect(POLICY_VERSION).toBe('2.0-draft');
  });
});
