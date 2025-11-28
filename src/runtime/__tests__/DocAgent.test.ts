/**
 * DocAgent 单元测试
 * 
 * 测试场景：
 * 1. 改写（更正式/更简洁/更友好）
 * 2. 翻译（中→英 / 英→中）
 * 3. 总结
 * 4. 结构化（列表/编号/分段/加标题）
 * 5. 自定义提示词
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocAgent, mapPresetToIntent, inferIntentFromPrompt } from '../DocAgent';
import { LlmService, LlmResponse } from '../LlmService';

// ==========================================
// Mock LlmService
// ==========================================

function createMockLlmService(mockResponse: Partial<LlmResponse> = {}): LlmService {
  const defaultResponse: LlmResponse = {
    success: true,
    text: 'MOCK_RESPONSE',
    latencyMs: 100,
  };

  const service = {
    chat: vi.fn().mockResolvedValue({ ...defaultResponse, ...mockResponse }),
    isAvailable: vi.fn().mockReturnValue(true),
    rewriteSelection: vi.fn().mockResolvedValue({ ...defaultResponse, ...mockResponse }),
    updateConfig: vi.fn(),
  } as unknown as LlmService;

  return service;
}

// ==========================================
// 测试用例
// ==========================================

describe('DocAgent', () => {
  let mockLlmService: LlmService;
  let docAgent: DocAgent;

  beforeEach(() => {
    mockLlmService = createMockLlmService();
    docAgent = new DocAgent(mockLlmService);
  });

  describe('handleSelection', () => {
    it('应该处理空选区', async () => {
      const result = await docAgent.handleSelection(
        { type: 'rewrite', tone: 'formal' },
        ''
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('选区为空');
    });

    it('应该处理只有空格的选区', async () => {
      const result = await docAgent.handleSelection(
        { type: 'rewrite', tone: 'formal' },
        '   '
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('选区只包含空白字符');
    });

    it('应该处理过长的选区', async () => {
      const longText = 'a'.repeat(6000);
      const result = await docAgent.handleSelection(
        { type: 'rewrite', tone: 'formal' },
        longText
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('选区文本过长');
    });
  });

  describe('rewriteSelection', () => {
    it('应该使用 formal 语气改写', async () => {
      const result = await docAgent.handleSelection(
        { type: 'rewrite', tone: 'formal' },
        '这是一段测试文本'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
      expect(result.text).toBe('MOCK_RESPONSE');
      expect(mockLlmService.chat).toHaveBeenCalled();
    });

    it('应该使用 concise 语气改写', async () => {
      const result = await docAgent.handleSelection(
        { type: 'rewrite', tone: 'concise' },
        '这是一段测试文本'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });

    it('应该使用 friendly 语气改写', async () => {
      const result = await docAgent.handleSelection(
        { type: 'rewrite', tone: 'friendly' },
        '这是一段测试文本'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });
  });

  describe('summarizeSelection', () => {
    it('应该返回 insertAfter action', async () => {
      const result = await docAgent.handleSelection(
        { type: 'summarize' },
        '这是一段很长的文本，需要被总结成简短的摘要。'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('insertAfter');
      expect(result.text).toBe('MOCK_RESPONSE');
    });
  });

  describe('translateSelection', () => {
    it('应该翻译成英文', async () => {
      const result = await docAgent.handleSelection(
        { type: 'translate', targetLang: 'en' },
        '你好，世界'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });

    it('应该翻译成中文', async () => {
      const result = await docAgent.handleSelection(
        { type: 'translate', targetLang: 'zh' },
        'Hello, World'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });
  });

  describe('structureSelection', () => {
    it('应该改成列表格式', async () => {
      const result = await docAgent.handleSelection(
        { type: 'structure', format: 'bullets' },
        '第一点内容。第二点内容。第三点内容。'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });

    it('应该改成编号格式', async () => {
      const result = await docAgent.handleSelection(
        { type: 'structure', format: 'numbered' },
        '第一点内容。第二点内容。第三点内容。'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });

    it('应该分段', async () => {
      const result = await docAgent.handleSelection(
        { type: 'structure', format: 'paragraphs' },
        '这是一大段文本需要被分成多个段落。'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });

    it('应该加小标题', async () => {
      const result = await docAgent.handleSelection(
        { type: 'structure', format: 'headings' },
        '这是一大段文本需要添加小标题。'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });
  });

  describe('customRewrite', () => {
    it('应该处理自定义提示词', async () => {
      const result = await docAgent.handleSelection(
        { type: 'custom', customPrompt: '改成诗歌形式' },
        '春天来了，花儿开了'
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('replace');
    });
  });

  describe('错误处理', () => {
    it('应该处理 LLM 服务错误', async () => {
      const errorService = createMockLlmService({
        success: false,
        error: 'LLM 服务不可用',
      });
      const errorAgent = new DocAgent(errorService);

      const result = await errorAgent.handleSelection(
        { type: 'rewrite', tone: 'formal' },
        '测试文本'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('LLM 服务不可用');
    });

    it('应该处理未知的意图类型', async () => {
      const result = await docAgent.handleSelection(
        { type: 'unknown' as any },
        '测试文本'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('未知的意图类型');
    });

    it('应该处理 LLM 服务不可用', async () => {
      const unavailableService = {
        chat: vi.fn(),
        isAvailable: vi.fn().mockReturnValue(false),
        rewriteSelection: vi.fn(),
        updateConfig: vi.fn(),
      } as unknown as LlmService;
      const unavailableAgent = new DocAgent(unavailableService);

      const result = await unavailableAgent.handleSelection(
        { type: 'rewrite', tone: 'formal' },
        '测试文本'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('AI 服务未配置');
    });
  });
});

describe('mapPresetToIntent', () => {
  it('应该正确映射"更正式"', () => {
    const intent = mapPresetToIntent('更正式');
    expect(intent).toEqual({ type: 'rewrite', tone: 'formal' });
  });

  it('应该正确映射"更简洁"', () => {
    const intent = mapPresetToIntent('更简洁');
    expect(intent).toEqual({ type: 'rewrite', tone: 'concise' });
  });

  it('应该正确映射"更友好"', () => {
    const intent = mapPresetToIntent('更友好');
    expect(intent).toEqual({ type: 'rewrite', tone: 'friendly' });
  });

  it('应该正确映射"翻译英文"', () => {
    const intent = mapPresetToIntent('翻译英文');
    expect(intent).toEqual({ type: 'translate', targetLang: 'en' });
  });

  it('应该正确映射"翻译中文"', () => {
    const intent = mapPresetToIntent('翻译中文');
    expect(intent).toEqual({ type: 'translate', targetLang: 'zh' });
  });

  it('应该正确映射"总结"', () => {
    const intent = mapPresetToIntent('总结');
    expect(intent).toEqual({ type: 'summarize' });
  });

  it('应该正确映射"改成列表"', () => {
    const intent = mapPresetToIntent('改成列表');
    expect(intent).toEqual({ type: 'structure', format: 'bullets' });
  });

  it('应该正确映射"改成编号"', () => {
    const intent = mapPresetToIntent('改成编号');
    expect(intent).toEqual({ type: 'structure', format: 'numbered' });
  });

  it('应该对未知标签返回 null', () => {
    const intent = mapPresetToIntent('未知按钮');
    expect(intent).toBeNull();
  });
});

describe('inferIntentFromPrompt', () => {
  it('应该推断"正式"为 formal 改写', () => {
    const intent = inferIntentFromPrompt('改成更正式的语气');
    expect(intent).toEqual({ type: 'rewrite', tone: 'formal' });
  });

  it('应该推断"简洁"为 concise 改写', () => {
    const intent = inferIntentFromPrompt('改得更简洁');
    expect(intent).toEqual({ type: 'rewrite', tone: 'concise' });
  });

  it('应该推断"友好"为 friendly 改写', () => {
    const intent = inferIntentFromPrompt('改成更友好的语气');
    expect(intent).toEqual({ type: 'rewrite', tone: 'friendly' });
  });

  it('应该推断"翻译成英文"为英文翻译', () => {
    const intent = inferIntentFromPrompt('翻译成英文');
    expect(intent).toEqual({ type: 'translate', targetLang: 'en' });
  });

  it('应该推断"翻译成中文"为中文翻译', () => {
    const intent = inferIntentFromPrompt('翻译成中文');
    expect(intent).toEqual({ type: 'translate', targetLang: 'zh' });
  });

  it('应该推断"总结"为摘要', () => {
    const intent = inferIntentFromPrompt('请总结一下');
    expect(intent).toEqual({ type: 'summarize' });
  });

  it('应该推断"列表"为结构化', () => {
    const intent = inferIntentFromPrompt('改成列表形式');
    expect(intent).toEqual({ type: 'structure', format: 'bullets' });
  });

  it('应该推断"编号"为结构化', () => {
    const intent = inferIntentFromPrompt('改成编号列表');
    expect(intent).toEqual({ type: 'structure', format: 'numbered' });
  });

  it('应该对无法识别的提示词返回 custom', () => {
    const intent = inferIntentFromPrompt('改成诗歌形式');
    expect(intent).toEqual({ type: 'custom', customPrompt: '改成诗歌形式' });
  });
});
