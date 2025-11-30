/**
 * CopilotRuntime 测试
 * 
 * 使用 mock LLM 响应测试：
 * - Intent 被正确解析
 * - mode=edit 时调用编辑操作
 * - mode=chat 时不执行编辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopilotRuntime, type CopilotRuntimeDeps } from '../CopilotRuntime';

// ==========================================
// Mock 数据
// ==========================================

// Mock LLM 响应：编辑模式
const MOCK_LLM_RESPONSE_EDIT = `[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section","sectionId":"sec-001"}}
[/INTENT]

[REPLY]
好的，我来帮你重写这个章节，使语言更加流畅。
[/REPLY]`;

// Mock LLM 响应：聊天模式
const MOCK_LLM_RESPONSE_CHAT = `[INTENT]
{"mode":"chat","action":"summarize_document","target":{"scope":"document"}}
[/INTENT]

[REPLY]
这篇文档主要讨论了产品需求管理的最佳实践，包括需求收集、优先级排序和迭代规划等方面。
[/REPLY]`;

// Mock LLM 响应：无 Intent 块（纯聊天）
const MOCK_LLM_RESPONSE_NO_INTENT = `这是一个普通的回复，不包含任何结构化的 Intent 信息。`;

// Mock Editor
function createMockEditor() {
  return {
    getEditorState: vi.fn(),
    registerUpdateListener: vi.fn(() => () => {}),
    update: vi.fn(),
  } as any;
}

// Mock buildDocContextEnvelope
vi.mock('../../docContext', () => ({
  buildDocContextEnvelope: vi.fn(async () => ({
    docId: 'test-doc',
    scope: 'document',
    focus: {
      sectionId: null,
      sectionTitle: null,
      text: '',
      charCount: 0,
      approxTokenCount: 0,
    },
    neighborhood: {},
    global: {
      title: '测试文档',
      outline: [
        { sectionId: 'sec-001', title: '第一章', level: 2 },
      ],
      totalCharCount: 1000,
      approxTotalTokenCount: 333,
      sectionsPreview: [],
    },
    budget: { maxTokens: 4096, estimatedTokens: 333 },
  })),
}));

// Mock buildRecentBehaviorSummary
vi.mock('../../interaction', () => ({
  buildRecentBehaviorSummary: vi.fn(() => ({
    summaryText: '',
    bullets: [],
    stats: { eventCount: 0, sectionCount: 0, aiOperationCount: 0, undoCount: 0 },
  })),
}));

// Mock runSectionAiAction
vi.mock('../../actions/sectionAiActions', () => ({
  runSectionAiAction: vi.fn(async () => ({
    success: true,
    applied: true,
    responseMode: 'auto_apply',
  })),
}));

// Mock copilotDebugStore
vi.mock('../copilotDebugStore', () => ({
  copilotDebugStore: {
    setSnapshot: vi.fn(),
  },
}));

// ==========================================
// 测试
// ==========================================

describe('CopilotRuntime', () => {
  let runtime: CopilotRuntime;
  let mockDeps: CopilotRuntimeDeps;
  let mockEditor: any;
  let mockChatWithLLM: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockEditor = createMockEditor();
    mockChatWithLLM = vi.fn();

    mockDeps = {
      chatWithLLM: mockChatWithLLM,
      getEditor: () => mockEditor,
      toast: {
        addToast: vi.fn(() => 'toast-id'),
        dismissToast: vi.fn(),
      },
    };

    runtime = new CopilotRuntime(mockDeps, 'test-doc');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // State 管理测试
  // ==========================================

  describe('State Management', () => {
    it('should initialize with default state', () => {
      const state = runtime.getSessionState();

      expect(state.docId).toBe('test-doc');
      expect(state.scope).toBe('document');
      expect(state.userPrefs.language).toBe('zh');
      expect(state.userPrefs.style).toBe('concise');
    });

    it('should update state correctly', () => {
      runtime.updateSessionState({
        scope: 'section',
        focusSectionId: 'sec-001',
      });

      const state = runtime.getSessionState();
      expect(state.scope).toBe('section');
      expect(state.focusSectionId).toBe('sec-001');
    });

    it('should set scope correctly', () => {
      runtime.setScope('section', 'sec-002');

      const state = runtime.getSessionState();
      expect(state.scope).toBe('section');
      expect(state.focusSectionId).toBe('sec-002');
    });

    it('should reset focusSectionId when switching to document scope', () => {
      runtime.setScope('section', 'sec-001');
      runtime.setScope('document');

      const state = runtime.getSessionState();
      expect(state.scope).toBe('document');
      expect(state.focusSectionId).toBeUndefined();
    });

    it('should set user prefs correctly', () => {
      runtime.setUserPrefs({ language: 'en', style: 'detailed' });

      const state = runtime.getSessionState();
      expect(state.userPrefs.language).toBe('en');
      expect(state.userPrefs.style).toBe('detailed');
    });
  });

  // ==========================================
  // runTurn 测试
  // ==========================================

  describe('runTurn', () => {
    it('should return error when no docId', async () => {
      const emptyRuntime = new CopilotRuntime(mockDeps, '');
      const result = await emptyRuntime.runTurn('测试');

      expect(result.executed).toBe(false);
      expect(result.error).toContain('No document');
      // v1.1: 验证新的错误状态字段
      expect(result.intentStatus).toBe('invalid');
      expect(result.errorCode).toBe('no_document');
      expect(result.errorMessage).toBeDefined();
    });

    it('should return error when editor not ready', async () => {
      mockDeps.getEditor = () => null;
      const result = await runtime.runTurn('测试');

      expect(result.executed).toBe(false);
      expect(result.error).toContain('Editor not ready');
      // v1.1: 验证新的错误状态字段
      expect(result.intentStatus).toBe('invalid');
      expect(result.errorCode).toBe('editor_not_ready');
    });

    it('should handle LLM failure', async () => {
      mockChatWithLLM.mockResolvedValue({
        success: false,
        error: 'API Error',
      });

      const result = await runtime.runTurn('帮我重写');

      expect(result.executed).toBe(false);
      expect(result.error).toContain('API Error');
      // v1.1: 验证新的错误状态字段
      expect(result.intentStatus).toBe('invalid');
      expect(result.errorCode).toBe('llm_call_failed');
    });

    it('should parse edit intent and execute', async () => {
      mockChatWithLLM.mockResolvedValue({
        success: true,
        content: MOCK_LLM_RESPONSE_EDIT,
      });

      const result = await runtime.runTurn('帮我重写这个章节');

      expect(result.intent).toBeDefined();
      expect(result.intent?.mode).toBe('edit');
      expect(result.intent?.action).toBe('rewrite_section');
      expect(result.executed).toBe(true);
      expect(result.replyText).toContain('重写');
      // v1.1: 验证 intentStatus
      expect(result.intentStatus).toBe('ok');
      expect(result.errorCode).toBeUndefined();

      // 验证 runSectionAiAction 被调用
      const { runSectionAiAction } = await import('../../actions/sectionAiActions');
      expect(runSectionAiAction).toHaveBeenCalled();
    });

    it('should parse chat intent and not execute edit', async () => {
      mockChatWithLLM.mockResolvedValue({
        success: true,
        content: MOCK_LLM_RESPONSE_CHAT,
      });

      const result = await runtime.runTurn('这篇文档讲了什么？');

      expect(result.intent).toBeDefined();
      expect(result.intent?.mode).toBe('chat');
      expect(result.executed).toBe(false);
      expect(result.replyText).toContain('产品需求管理');
      // v1.1: 验证 intentStatus
      expect(result.intentStatus).toBe('ok');

      // 验证 runSectionAiAction 没有被调用
      const { runSectionAiAction } = await import('../../actions/sectionAiActions');
      expect(runSectionAiAction).not.toHaveBeenCalled();
    });

    it('should handle response without Intent block', async () => {
      mockChatWithLLM.mockResolvedValue({
        success: true,
        content: MOCK_LLM_RESPONSE_NO_INTENT,
      });

      const result = await runtime.runTurn('你好');

      expect(result.intent).toBeUndefined();
      expect(result.executed).toBe(false);
      expect(result.replyText).toContain('普通的回复');
      // v1.1: 验证 intentStatus 为 missing
      expect(result.intentStatus).toBe('missing');
      expect(result.errorCode).toBe('intent_missing');
    });

    it('should update lastTask after edit execution', async () => {
      mockChatWithLLM.mockResolvedValue({
        success: true,
        content: MOCK_LLM_RESPONSE_EDIT,
      });

      await runtime.runTurn('帮我重写');

      const state = runtime.getSessionState();
      expect(state.lastTask).toBe('rewrite_section');
    });
  });

  // ==========================================
  // 边界情况测试
  // ==========================================

  describe('Edge Cases', () => {
    it('should handle malformed JSON in intent', async () => {
      mockChatWithLLM.mockResolvedValue({
        success: true,
        content: `[INTENT]
{invalid json}
[/INTENT]

[REPLY]
这是回复。
[/REPLY]`,
      });

      const result = await runtime.runTurn('测试');

      expect(result.intent).toBeUndefined();
      expect(result.executed).toBe(false);
      expect(result.replyText).toBe('这是回复。');
    });

    it('should handle missing sectionId for section action', async () => {
      mockChatWithLLM.mockResolvedValue({
        success: true,
        content: `[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section"}}
[/INTENT]

[REPLY]
测试回复。
[/REPLY]`,
      });

      const result = await runtime.runTurn('重写');

      // Intent 验证失败，降级为聊天
      expect(result.intent).toBeUndefined();
      expect(result.executed).toBe(false);
    });

    it('should use focusSectionId when target.sectionId is missing', async () => {
      // 先设置 focusSectionId
      runtime.setScope('section', 'sec-fallback');

      mockChatWithLLM.mockResolvedValue({
        success: true,
        content: `[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section","sectionId":"sec-fallback"}}
[/INTENT]

[REPLY]
好的，重写中。
[/REPLY]`,
      });

      const result = await runtime.runTurn('重写这个章节');

      expect(result.executed).toBe(true);

      const { runSectionAiAction } = await import('../../actions/sectionAiActions');
      expect(runSectionAiAction).toHaveBeenCalledWith(
        'rewrite',
        'sec-fallback',
        expect.any(Object)
      );
    });
  });
});

