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

  // ==========================================
  // v2 新增测试：confidence / uncertainties / responseMode
  // ==========================================

  it('parses v2 intent with confidence and responseMode', () => {
    const result = parseCanonicalIntent({
      intentId: 'v2-intent',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{ type: 'rewrite', params: {} }],
      confidence: 0.85,
      responseMode: 'auto_apply',
    });

    expect(result.confidence).toBe(0.85);
    expect(result.responseMode).toBe('auto_apply');
  });

  it('parses v2 intent with uncertainties', () => {
    const result = parseCanonicalIntent({
      intentId: 'uncertain-intent',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{ type: 'rewrite', params: {} }],
      confidence: 0.45,
      uncertainties: [
        {
          field: 'tasks[0].params.tone',
          reason: '用户没指定语气',
          candidateOptions: ['formal', 'casual'],
        },
      ],
      responseMode: 'clarify',
    });

    expect(result.uncertainties).toHaveLength(1);
    expect(result.uncertainties![0].field).toBe('tasks[0].params.tone');
    expect(result.uncertainties![0].candidateOptions).toEqual(['formal', 'casual']);
    expect(result.responseMode).toBe('clarify');
  });

  it('defaults responseMode to preview when confidence is low', () => {
    const result = parseCanonicalIntent({
      intentId: 'low-conf',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{ type: 'rewrite', params: {} }],
      confidence: 0.3,
      // responseMode not specified
    });

    // 当 confidence < 0.5 且未指定 responseMode 时，默认为 preview
    expect(result.responseMode).toBe('preview');
  });

  it('defaults responseMode to auto_apply when confidence is high', () => {
    const result = parseCanonicalIntent({
      intentId: 'high-conf',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{ type: 'rewrite', params: {} }],
      confidence: 0.9,
      // responseMode not specified
    });

    expect(result.responseMode).toBe('auto_apply');
  });

  it('rejects invalid confidence values', () => {
    expect(() => parseCanonicalIntent({
      intentId: 'bad-conf',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{ type: 'rewrite', params: {} }],
      confidence: 1.5, // > 1
    })).toThrowError();

    expect(() => parseCanonicalIntent({
      intentId: 'bad-conf-2',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{ type: 'rewrite', params: {} }],
      confidence: -0.1, // < 0
    })).toThrowError();
  });

  it('rejects invalid responseMode', () => {
    expect(() => parseCanonicalIntent({
      intentId: 'bad-mode',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{ type: 'rewrite', params: {} }],
      responseMode: 'invalid_mode' as any,
    })).toThrowError();
  });

  // 测试 passthrough：允许 LLM 返回额外字段
  it('accepts extra fields from LLM (passthrough)', () => {
    const result = parseCanonicalIntent({
      intentId: 'with-extras',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [{
        type: 'rewrite',
        params: {
          tone: 'formal',
          // LLM 可能返回的额外字段
          preserveParagraphCount: true,
          preserveSemantics: true,
        },
      }],
      // 顶层额外字段
      extraField: 'should be allowed',
    });

    expect(result.intentId).toBe('with-extras');
    expect(result.tasks[0].type).toBe('rewrite');
  });

  // 测试 scope 容错：当 LLM 只返回 sectionId 但缺少 target 时
  it('infers target=section when only sectionId is provided', () => {
    const result = parseCanonicalIntent({
      intentId: 'infer-scope-target',
      scope: { sectionId: 'sec-123' }, // missing target: 'section'
      tasks: [{ type: 'rewrite', params: {} }],
    });

    expect(result.scope.target).toBe('section');
    expect(result.scope.sectionId).toBe('sec-123');
  });
});


