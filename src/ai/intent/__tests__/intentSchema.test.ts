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

  // ==========================================
  // mark_key_terms 任务类型测试
  // ==========================================

  it('parses pure rewrite_section task (backward compatibility)', () => {
    const result = parseCanonicalIntent({
      intentId: 'pure-rewrite',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { type: 'rewrite', params: { tone: 'formal' } },
      ],
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe('rewrite');
  });

  it('parses rewrite + mark_key_terms composite intent', () => {
    const result = parseCanonicalIntent({
      intentId: 'composite-intent',
      scope: { target: 'section', sectionId: 'sec-1609' },
      tasks: [
        { type: 'rewrite', params: { tone: 'default' } },
        {
          type: 'mark_key_terms',
          params: {
            targets: [
              { sectionId: 'sec-1609', phrase: 'Requirements vs. Design' },
              { sectionId: 'sec-1609', phrase: '关键概念', occurrence: 1 },
            ],
          },
        },
      ],
      confidence: 0.85,
      responseMode: 'auto_apply',
    });

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].type).toBe('rewrite');
    expect(result.tasks[1].type).toBe('mark_key_terms');
    
    // 验证 mark_key_terms 的 params
    const markTask = result.tasks[1];
    expect(markTask.params).toBeDefined();
  });

  it('parses mark_key_terms task with targets', () => {
    const result = parseCanonicalIntent({
      intentId: 'mark-terms-only',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        {
          type: 'mark_key_terms',
          params: {
            targets: [
              { sectionId: 'sec-1', phrase: '核心概念' },
              { sectionId: 'sec-1', phrase: '重要术语', occurrence: 2 },
            ],
            maxTerms: 5,
          },
        },
      ],
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe('mark_key_terms');
  });

  it('rejects unknown task type', () => {
    expect(() => parseCanonicalIntent({
      intentId: 'bad-task',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { type: 'mark_keywords' as any, params: {} }, // 错误的类型名
      ],
    })).toThrowError();
  });

  it('rejects task with kind instead of type', () => {
    expect(() => parseCanonicalIntent({
      intentId: 'wrong-field',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { kind: 'rewrite', params: {} } as any, // 使用 kind 而非 type
      ],
    })).toThrowError();
  });

  // ==========================================
  // mark_key_sentences 任务类型测试
  // ==========================================

  it('parses mark_key_sentences task with sentenceIndexes', () => {
    const result = parseCanonicalIntent({
      intentId: 'mark-sentences',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        {
          type: 'mark_key_sentences',
          params: {
            sectionId: 'sec-1',
            sentenceIndexes: [0, 2, 5],
          },
        },
      ],
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe('mark_key_sentences');
  });

  it('parses mark_key_sentences task with sentences array', () => {
    const result = parseCanonicalIntent({
      intentId: 'mark-sentences-text',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        {
          type: 'mark_key_sentences',
          params: {
            sectionId: 'sec-1',
            sentences: [
              { text: '这是核心观点句。' },
              { text: '另一个重要的句子。', paragraphIndex: 2 },
            ],
          },
        },
      ],
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe('mark_key_sentences');
  });

  // ==========================================
  // mark_key_paragraphs 任务类型测试
  // ==========================================

  it('parses mark_key_paragraphs task', () => {
    const result = parseCanonicalIntent({
      intentId: 'mark-paragraphs',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        {
          type: 'mark_key_paragraphs',
          params: {
            sectionId: 'sec-1',
            paragraphIndexes: [0, 3],
          },
        },
      ],
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe('mark_key_paragraphs');
  });

  // ==========================================
  // 复合高亮任务测试
  // ==========================================

  it('parses rewrite + mark_key_terms + mark_key_sentences composite intent', () => {
    const result = parseCanonicalIntent({
      intentId: 'full-composite',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { type: 'rewrite', params: { tone: 'formal' } },
        {
          type: 'mark_key_terms',
          params: {
            sectionId: 'sec-1',
            terms: [
              { phrase: '关键概念' },
              { phrase: '核心术语', occurrence: 1 },
            ],
          },
        },
        {
          type: 'mark_key_sentences',
          params: {
            sectionId: 'sec-1',
            sentenceIndexes: [0],
          },
        },
      ],
      confidence: 0.9,
      responseMode: 'auto_apply',
    });

    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[0].type).toBe('rewrite');
    expect(result.tasks[1].type).toBe('mark_key_terms');
    expect(result.tasks[2].type).toBe('mark_key_sentences');
  });

  it('parses mark_key_terms with simplified terms format', () => {
    const result = parseCanonicalIntent({
      intentId: 'simplified-terms',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        {
          type: 'mark_key_terms',
          params: {
            sectionId: 'sec-1',
            terms: [
              { phrase: '词语一' },
              { phrase: '词语二', occurrence: 2 },
            ],
          },
        },
      ],
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe('mark_key_terms');
  });

  // ==========================================
  // highlightMode 参数测试（通过 tasks 验证）
  // ==========================================

  it('accepts intent with only terms task (highlightMode=terms)', () => {
    const result = parseCanonicalIntent({
      intentId: 'terms-only',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { type: 'rewrite', params: {} },
        {
          type: 'mark_key_terms',
          params: {
            terms: [{ phrase: '关键词' }],
          },
        },
      ],
    });

    const highlightTasks = result.tasks.filter(
      t => t.type === 'mark_key_terms' || t.type === 'mark_key_sentences' || t.type === 'mark_key_paragraphs'
    );
    expect(highlightTasks).toHaveLength(1);
    expect(highlightTasks[0].type).toBe('mark_key_terms');
  });

  it('accepts intent with only sentences task (highlightMode=sentences)', () => {
    const result = parseCanonicalIntent({
      intentId: 'sentences-only',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { type: 'rewrite', params: {} },
        {
          type: 'mark_key_sentences',
          params: {
            sentenceIndexes: [0, 1],
          },
        },
      ],
    });

    const highlightTasks = result.tasks.filter(
      t => t.type === 'mark_key_terms' || t.type === 'mark_key_sentences' || t.type === 'mark_key_paragraphs'
    );
    expect(highlightTasks).toHaveLength(1);
    expect(highlightTasks[0].type).toBe('mark_key_sentences');
  });

  it('accepts intent with multiple highlight tasks (highlightMode=auto)', () => {
    const result = parseCanonicalIntent({
      intentId: 'auto-highlight',
      scope: { target: 'section', sectionId: 'sec-1' },
      tasks: [
        { type: 'rewrite', params: {} },
        {
          type: 'mark_key_terms',
          params: { terms: [{ phrase: '概念' }] },
        },
        {
          type: 'mark_key_sentences',
          params: { sentenceIndexes: [0] },
        },
        {
          type: 'mark_key_paragraphs',
          params: { paragraphIndexes: [0] },
        },
      ],
    });

    const highlightTasks = result.tasks.filter(
      t => t.type === 'mark_key_terms' || t.type === 'mark_key_sentences' || t.type === 'mark_key_paragraphs'
    );
    expect(highlightTasks).toHaveLength(3);
  });
});


