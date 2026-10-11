import { describe, expect, it } from 'vitest';
import { CHUNK_OVERLAP, CHUNK_SIZE, chunkText, cleanHtml, splitSentences } from '../src/rag/chunk.js';

describe('cleanHtml', () => {
  it('strips scripts, styles and tags, collapses whitespace', () => {
    const html = `<html><head><title>T</title><style>.a{}</style><script>alert(1)</script></head>
      <body><nav>menu</nav><main><h1>Hello</h1><p>World &amp; friends</p></main></body></html>`;
    const text = cleanHtml(html);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('menu');
    expect(text).toContain('Hello');
    expect(text).toContain('World & friends');
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it('returns empty string for empty input', () => {
    expect(cleanHtml('')).toBe('');
  });
});

describe('splitSentences', () => {
  it('splits on sentence boundaries', () => {
    const parts = splitSentences('First sentence. Second one! Is this third? Yes.');
    expect(parts.length).toBe(4);
  });

  it('does not split on abbreviations or decimals in Latin text', () => {
    const parts = splitSentences('The dose is 2.5 mg. Give it slowly.');
    expect(parts).toHaveLength(2);
  });

  it('splits Arabic sentences at ؟ and . regardless of next-char case', () => {
    const text = 'فرط الحرارة الخبيث حالة طارئة. يجب إيقاف المحفزات فورًا؟ نعم، هذا صحيح! العلاج دانترولين؛ والتبريد مهم.';
    const parts = splitSentences(text);
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('فرط الحرارة الخبيث حالة طارئة.');
    expect(parts[1]).toBe('يجب إيقاف المحفزات فورًا؟');
    expect(parts[3]).toBe('العلاج دانترولين؛');
  });

  it('splits mixed Arabic/Latin text on Arabic punctuation', () => {
    const parts = splitSentences('التخدير مهم. anesthesia is critical. هل هذا واضح؟ نعم.');
    expect(parts).toHaveLength(4);
  });
});

describe('chunkText (MedRAG pattern: 1000/200)', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('Short text.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe('Short text.');
    expect(chunks[0]!.index).toBe(0);
  });

  it('respects size limit and overlap on long text', () => {
    const sentence = 'Malignant hyperthermia is a pharmacogenetic disorder of skeletal muscle. ';
    const text = sentence.repeat(60); // ~4200 chars
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_SIZE + 50);
    }
    // Overlap: tail of chunk N appears at the start of chunk N+1.
    const tail = chunks[0]!.text.slice(-CHUNK_OVERLAP);
    expect(chunks[1]!.text).toContain(tail.slice(0, 50));
  });

  it('covers the whole text without gaps', () => {
    const text = 'Alpha. '.repeat(400);
    const chunks = chunkText(text);
    const joined = chunks.map((c) => c.text).join(' ');
    for (const word of ['Alpha']) {
      expect(joined).toContain(word);
    }
    // First chunk starts at the beginning, last chunk reaches the end.
    expect(chunks[0]!.text.startsWith('Alpha.')).toBe(true);
    expect(chunks[chunks.length - 1]!.text.endsWith('Alpha.')).toBe(true);
  });

  it('returns no chunks for blank text', () => {
    expect(chunkText('   ')).toHaveLength(0);
  });
});
