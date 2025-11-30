/**
 * Copilot Intent 解析器测试
 * 
 * 覆盖场景：
 * - 正常 INTENT + REPLY
 * - Intent JSON 缺失
 * - 标签缺失
 * - JSON 解析失败
 * - Markdown 代码块包装
 */

import { describe, it, expect } from 'vitest';
import {
  parseCopilotModelOutput,
  buildCopilotSystemPrompt,
  isIntentExecutable,
  describeIntent,
} from '../copilotIntentParser';
import type { CopilotSessionState, CopilotIntent } from '../copilotRuntimeTypes';
import type { DocContextEnvelope, DocScope } from '../../docContext';

// ==========================================
// 测试数据
// ==========================================

function createMockSessionState(overrides?: Partial<CopilotSessionState>): CopilotSessionState {
  return {
    docId: 'test-doc-001',
    scope: 'document',
    userPrefs: {
      language: 'zh',
      style: 'concise',
    },
    ...overrides,
  };
}

function createMockEnvelope(scope: DocScope = 'document'): DocContextEnvelope {
  return {
    docId: 'test-doc-001',
    scope,
    focus: {
      sectionId: scope === 'section' ? 'sec-001' : null,
      sectionTitle: scope === 'section' ? '第一章 引言' : null,
      text: scope === 'section' ? '这是第一章的内容...' : '',
      charCount: scope === 'section' ? 100 : 0,
      approxTokenCount: scope === 'section' ? 33 : 0,
    },
    neighborhood: {},
    global: {
      title: '测试文档',
      outline: [
        { sectionId: 'sec-001', title: '第一章 引言', level: 2 },
        { sectionId: 'sec-002', title: '第二章 背景', level: 2 },
      ],
      totalCharCount: 1000,
      approxTotalTokenCount: 333,
      sectionsPreview: [
        { sectionId: 'sec-001', title: '第一章 引言', level: 2, snippet: '这是引言...', charCount: 500 },
        { sectionId: 'sec-002', title: '第二章 背景', level: 2, snippet: '这是背景...', charCount: 500 },
      ],
    },
    budget: {
      maxTokens: 4096,
      estimatedTokens: 333,
    },
  };
}

// ==========================================
// parseCopilotModelOutput 测试
// ==========================================

describe('parseCopilotModelOutput', () => {
  describe('正常解析', () => {
    it('should parse valid INTENT + REPLY blocks', () => {
      const raw = `[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section","sectionId":"sec-001"}}
[/INTENT]

[REPLY]
好的，我来帮你重写这个章节。
[/REPLY]`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent).toBeDefined();
      expect(result.intent?.mode).toBe('edit');
      expect(result.intent?.action).toBe('rewrite_section');
      expect(result.intent?.target.scope).toBe('section');
      expect(result.intent?.target.sectionId).toBe('sec-001');
      expect(result.replyText).toBe('好的，我来帮你重写这个章节。');
      expect(result.rawText).toBe(raw);
    });

    it('should parse chat mode intent', () => {
      const raw = `[INTENT]
{"mode":"chat","action":"summarize_document","target":{"scope":"document"}}
[/INTENT]

[REPLY]
这篇文档主要讨论了产品需求管理。
[/REPLY]`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent?.mode).toBe('chat');
      expect(result.intent?.action).toBe('summarize_document');
      expect(result.replyText).toContain('产品需求管理');
    });

    it('should handle intent with params', () => {
      const raw = `[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section","sectionId":"sec-002"},"params":{"tone":"formal","length":"shorter"}}
[/INTENT]

[REPLY]
我会用更正式的语气重写这个章节。
[/REPLY]`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent?.params).toEqual({ tone: 'formal', length: 'shorter' });
    });
  });

  describe('JSON 解析容错', () => {
    it('should return undefined intent when JSON is invalid', () => {
      const raw = `[INTENT]
{invalid json here}
[/INTENT]

[REPLY]
抱歉，这是我的回复。
[/REPLY]`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent).toBeUndefined();
      expect(result.replyText).toBe('抱歉，这是我的回复。');
    });

    it('should handle markdown code block wrapped JSON', () => {
      const raw = `[INTENT]
\`\`\`json
{"mode":"edit","action":"summarize_section","target":{"scope":"section","sectionId":"sec-001"}}
\`\`\`
[/INTENT]

[REPLY]
我来总结这个章节。
[/REPLY]`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent?.mode).toBe('edit');
      expect(result.intent?.action).toBe('summarize_section');
    });

    it('should return undefined for invalid intent structure', () => {
      const raw = `[INTENT]
{"mode":"edit","action":"invalid_action","target":{"scope":"section"}}
[/INTENT]

[REPLY]
这是回复。
[/REPLY]`;

      const result = parseCopilotModelOutput(raw);

      // action 无效，验证失败
      expect(result.intent).toBeUndefined();
      expect(result.replyText).toBe('这是回复。');
    });

    it('should return undefined for section action without sectionId', () => {
      const raw = `[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section"}}
[/INTENT]

[REPLY]
这是回复。
[/REPLY]`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent).toBeUndefined();
    });
  });

  describe('标签缺失处理', () => {
    it('should handle missing INTENT block', () => {
      const raw = `这是一个没有 INTENT 块的普通回复。`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent).toBeUndefined();
      expect(result.replyText).toBe('这是一个没有 INTENT 块的普通回复。');
    });

    it('should handle missing REPLY block', () => {
      const raw = `[INTENT]
{"mode":"chat","action":"summarize_document","target":{"scope":"document"}}
[/INTENT]

这是没有 REPLY 标签的内容。`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent?.mode).toBe('chat');
      expect(result.replyText).toContain('这是没有 REPLY 标签的内容');
    });

    it('should handle both blocks missing', () => {
      const raw = `我是一个普通的回复，没有任何特殊标签。`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent).toBeUndefined();
      expect(result.replyText).toBe('我是一个普通的回复，没有任何特殊标签。');
    });
  });

  describe('边界情况', () => {
    it('should handle empty string', () => {
      const result = parseCopilotModelOutput('');

      expect(result.intent).toBeUndefined();
      expect(result.replyText).toBe('抱歉，我无法理解您的请求。');
    });

    it('should handle null/undefined', () => {
      const result = parseCopilotModelOutput(null as any);

      expect(result.intent).toBeUndefined();
      expect(result.replyText).toBe('抱歉，我无法理解您的请求。');
    });

    it('should handle case-insensitive tags', () => {
      const raw = `[intent]
{"mode":"chat","action":"summarize_document","target":{"scope":"document"}}
[/intent]

[reply]
大小写不敏感测试。
[/reply]`;

      const result = parseCopilotModelOutput(raw);

      expect(result.intent?.mode).toBe('chat');
      expect(result.replyText).toBe('大小写不敏感测试。');
    });
  });
});

// ==========================================
// buildCopilotSystemPrompt 测试
// ==========================================

describe('buildCopilotSystemPrompt', () => {
  it('should build prompt with document scope envelope', () => {
    const state = createMockSessionState();
    const envelope = createMockEnvelope('document');

    const prompt = buildCopilotSystemPrompt(state, envelope);

    expect(prompt).toContain('AI Office Copilot');
    expect(prompt).toContain('rewrite_section');
    expect(prompt).toContain('summarize_section');
    expect(prompt).toContain('[INTENT]');
    expect(prompt).toContain('[REPLY]');
    expect(prompt).toContain('测试文档');
    expect(prompt).toContain('中文');
    expect(prompt).toContain('简洁');
  });

  it('should build prompt with section scope envelope', () => {
    const state = createMockSessionState({ scope: 'section', focusSectionId: 'sec-001' });
    const envelope = createMockEnvelope('section');

    const prompt = buildCopilotSystemPrompt(state, envelope);

    expect(prompt).toContain('当前章节');
    expect(prompt).toContain('第一章 引言');
    expect(prompt).toContain('这是第一章的内容');
  });

  it('should include behavior summary when provided', () => {
    const state = createMockSessionState();
    const envelope = createMockEnvelope('document');
    const behaviorSummary = {
      summaryText: '用户最近编辑了"引言"章节，进行了2次重写操作。',
      bullets: ['编辑了引言', '重写了2次'],
      stats: {
        eventCount: 5,
        sectionCount: 2,
        aiOperationCount: 2,
        undoCount: 0,
      },
    };

    const prompt = buildCopilotSystemPrompt(state, envelope, behaviorSummary);

    expect(prompt).toContain('用户最近的操作');
    expect(prompt).toContain('重写操作');
  });
});

// ==========================================
// 辅助函数测试
// ==========================================

describe('isIntentExecutable', () => {
  it('should return true for executable intents', () => {
    const intent: CopilotIntent = {
      mode: 'edit',
      action: 'rewrite_section',
      target: { scope: 'section', sectionId: 'sec-001' },
    };

    expect(isIntentExecutable(intent)).toBe(true);
  });

  it('should return false for chat mode', () => {
    const intent: CopilotIntent = {
      mode: 'chat',
      action: 'summarize_document',
      target: { scope: 'document' },
    };

    expect(isIntentExecutable(intent)).toBe(false);
  });

  it('should return false for undefined intent', () => {
    expect(isIntentExecutable(undefined)).toBe(false);
  });

  it('should return false for unsupported actions', () => {
    const intent: CopilotIntent = {
      mode: 'edit',
      action: 'highlight_terms',
      target: { scope: 'section', sectionId: 'sec-001' },
    };

    expect(isIntentExecutable(intent)).toBe(false);
  });
});

describe('describeIntent', () => {
  it('should describe edit intent correctly', () => {
    const intent: CopilotIntent = {
      mode: 'edit',
      action: 'rewrite_section',
      target: { scope: 'section', sectionId: 'sec-001' },
    };

    expect(describeIntent(intent)).toBe('重写章节');
  });

  it('should describe chat intent correctly', () => {
    const intent: CopilotIntent = {
      mode: 'chat',
      action: 'summarize_document',
      target: { scope: 'document' },
    };

    expect(describeIntent(intent)).toBe('聊天（总结文档）');
  });
});

