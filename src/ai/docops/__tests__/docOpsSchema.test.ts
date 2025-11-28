import { describe, expect, it } from 'vitest';
import { parseDocOpsPlan, validateDocOpsPlan } from '../docOpsSchema';

describe('DocOps schema', () => {
  it('parses replace_range plan', () => {
    const plan = parseDocOpsPlan({
      version: '1.0',
      intentId: 'intent-123',
      ops: [
        {
          type: 'replace_range',
          scope: { sectionId: 'sec-1' },
          payload: {
            paragraphs: [
              { index: 0, text: 'Hello' },
            ],
          },
        },
      ],
    });

    const validation = validateDocOpsPlan(plan);
    expect(validation.valid).toBe(true);
  });

  it('rejects missing paragraphs', () => {
    const plan = {
      version: '1.0',
      intentId: 'intent-123',
      ops: [
        {
          type: 'replace_range',
          scope: { sectionId: 'sec-1' },
          payload: {},
        },
      ],
    };

    expect(() => parseDocOpsPlan(plan)).toThrowError();
  });
});


