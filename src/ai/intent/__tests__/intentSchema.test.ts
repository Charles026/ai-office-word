import { describe, expect, it } from 'vitest';
import { parseCanonicalIntent } from '../intentSchema';

describe('parseCanonicalIntent', () => {
  it('parses minimal rewrite intent with defaults', () => {
    const result = parseCanonicalIntent({
      intentId: 'test-intent',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { type: 'rewrite', params: { tone: 'formal' } },
      ],
    });

    expect(result.intentId).toBe('test-intent');
    expect(result.scope.sectionId).toBe('sec-1');
    expect(result.tasks[0].type).toBe('rewrite');
    expect(result.interactionMode).toBe('apply_directly');
  });

  it('throws on invalid scope', () => {
    expect(() => parseCanonicalIntent({
      intentId: 'bad',
      scope: { target: 'selection' },
      tasks: [{ type: 'rewrite', params: {} }],
    })).toThrowError();
  });
});


