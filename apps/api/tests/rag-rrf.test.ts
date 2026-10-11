import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion, RRF_K } from '../src/rag/retrieve.js';

describe('reciprocalRankFusion', () => {
  it('ranks an item first in both lists above items first in one list', () => {
    const scores = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['a', 'c', 'b'],
    ]);
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(ranked[0]).toBe('a');
  });

  it('uses 1/(k+rank) with 1-based ranks and default k=60', () => {
    const scores = reciprocalRankFusion([['a', 'b']]);
    expect(scores.get('a')).toBeCloseTo(1 / (RRF_K + 1), 10);
    expect(scores.get('b')).toBeCloseTo(1 / (RRF_K + 2), 10);
  });

  it('sums contributions across lists', () => {
    const scores = reciprocalRankFusion([['a'], ['a']]);
    expect(scores.get('a')).toBeCloseTo(2 / (RRF_K + 1), 10);
  });

  it('handles empty input', () => {
    expect(reciprocalRankFusion([]).size).toBe(0);
    expect(reciprocalRankFusion([[], []]).size).toBe(0);
  });
});
