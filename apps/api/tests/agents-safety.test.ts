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
