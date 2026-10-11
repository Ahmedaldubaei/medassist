import { describe, expect, it } from 'vitest';
import { parseMessageSections } from '../src/lib/parseMessage';

describe('parseMessageSections', () => {
  it('splits documented knowledge and model inference sections', () => {
    const raw = [
      '## Documented knowledge',
      '- Dantrolene 2.5 mg/kg IV [1].',
      '## Model inference',
      'Consider monitoring in PACU.',
    ].join('\n');
    const sections = parseMessageSections(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.kind).toBe('documented');
    expect(sections[0]!.body).toContain('Dantrolene');
    expect(sections[1]!.kind).toBe('inference');
    expect(sections[1]!.body).toContain('PACU');
  });

  it('normalizes LLM-wrapped headers like ** ## ... **', () => {
    const raw = '** ## Documented knowledge **\n- Fact [1].';
    const sections = parseMessageSections(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.kind).toBe('documented');
    expect(sections[0]!.body).toContain('Fact');
  });

  it('returns a single plain section when there are no headers', () => {
    const sections = parseMessageSections('Just a plain answer.');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.kind).toBe('plain');
    expect(sections[0]!.body).toBe('Just a plain answer.');
  });

  it('keeps unknown ## headers as content', () => {
    const raw = '## Summary\nSome text.';
    const sections = parseMessageSections(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.kind).toBe('plain');
    expect(sections[0]!.body).toContain('## Summary');
  });

  it('handles empty input', () => {
    expect(parseMessageSections('   ')).toHaveLength(1);
  });
});
