/**
 * Section Prompt Builder 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  buildRewriteSectionPrompt,
  buildSummarizeSectionPrompt,
  buildExpandSectionPrompt,
  buildSectionPrompt,
  __internal,
} from '../buildSectionPrompt';
import { SectionPromptInput } from '../sectionPromptTypes';
import { SectionContext } from '../../context/types';
import { AgentIntent } from '../../intents/types';

// ==========================================
// 测试数据
// ==========================================

function createMockSectionContext(overrides?: Partial<SectionContext>): SectionContext {
  const paragraphs = [
    {
      nodeKey: 'p1',
      text: '这是第一段内容，包含一些测试文本。',
      nodePath: ['root', 'test-section-id', 'p1'],
      nodeType: 'paragraph',
    },
    {
      nodeKey: 'p2',
      text: '这是第二段内容，也包含一些测试文本。',
      nodePath: ['root', 'test-section-id', 'p2'],
      nodeType: 'paragraph',
    },
  ];
  return {
    sectionId: 'test-section-id',
    titleText: '测试章节标题',
    titleNodePath: ['root', 'test-section-id'],
    level: 2,
    paragraphs,
    ownParagraphs: paragraphs,
    subtreeParagraphs: paragraphs,
    childSections: [],
    startIndex: 0,
    endIndex: 2,
    ...overrides,
  };
}

function createMockIntent(kind: string, options?: Record<string, unknown>): AgentIntent {
  return {
    id: 'test-intent-id',
    kind: kind as AgentIntent['kind'],
    source: 'section',
    locale: 'auto',
    options,
    metadata: {
      sectionId: 'test-section-id',
      sectionLevel: 2,
    },
  };
}

function createMockInput(
  intentKind: string,
  intentOptions?: Record<string, unknown>,
  contextOverrides?: Partial<SectionContext>
): SectionPromptInput {
  return {
    intent: createMockIntent(intentKind, intentOptions),
    context: createMockSectionContext(contextOverrides),
  };
}

// ==========================================
// buildRewriteSectionPrompt 测试
// ==========================================

describe('buildRewriteSectionPrompt', () => {
  it('应该返回包含 system 和 user 的 BuiltPrompt', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.system).toBeDefined();
    expect(prompt.user).toBeDefined();
    expect(prompt.system.length).toBeGreaterThan(0);
    expect(prompt.user.length).toBeGreaterThan(0);
  });

  it('system prompt 应该包含基础规则', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.system).toContain('AI writing assistant');
    expect(prompt.system).toContain('JSON');
    expect(prompt.system).toContain('NOT omit any paragraph');
    expect(prompt.system).toContain('NOT merge or split');
  });

  it('system prompt 应该包含 rewrite 模式规则', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.system).toContain('REWRITE mode');
    expect(prompt.system).toContain('same number of paragraphs');
  });

  it('user prompt 应该包含 section 数据', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.user).toContain('测试章节标题');
    expect(prompt.user).toContain('第一段内容');
    expect(prompt.user).toContain('第二段内容');
    expect(prompt.user).toContain('"level": 2');
  });

  it('user prompt 应该包含任务指令', () => {
    const input = createMockInput('rewrite_section', { rewriteTone: 'formal' });
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.user).toContain('TASK: Rewrite');
    expect(prompt.user).toContain('Tone: formal');
    expect(prompt.user).toContain('KEEP paragraph count');
  });

  it('user prompt 应该包含输出格式要求', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.user).toContain('OUTPUT FORMAT');
    expect(prompt.user).toContain('"paragraphs"');
    // Updated format no longer uses "Do NOT wrap with markdown"
    // Instead it uses structured blocks: [assistant], [intent], [docops]
    expect(prompt.user).toContain('[docops]');
  });

  it('应该正确映射 rewriteTone 选项', () => {
    const input = createMockInput('rewrite_section', { rewriteTone: 'concise' });
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.user).toContain('Tone: concise');
  });

  it('应该正确映射 rewriteDepth 选项', () => {
    const input = createMockInput('rewrite_section', { rewriteDepth: 'heavy' });
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.user).toContain('Depth: heavy');
  });

  it('metadata 应该包含正确的信息', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.metadata?.sectionId).toBe('test-section-id');
    expect(prompt.metadata?.sectionLevel).toBe(2);
    expect(prompt.metadata?.paragraphCount).toBe(2);
    expect(prompt.metadata?.estimatedTokens).toBeGreaterThan(0);
    expect(prompt.metadata?.intentKind).toBe('rewrite_section');
  });
});

// ==========================================
// buildSummarizeSectionPrompt 测试
// ==========================================

describe('buildSummarizeSectionPrompt', () => {
  it('应该返回包含 system 和 user 的 BuiltPrompt', () => {
    const input = createMockInput('summarize_section');
    const prompt = buildSummarizeSectionPrompt(input);

    expect(prompt.system).toBeDefined();
    expect(prompt.user).toBeDefined();
  });

  it('system prompt 应该包含 summarize 模式规则', () => {
    const input = createMockInput('summarize_section');
    const prompt = buildSummarizeSectionPrompt(input);

    expect(prompt.system).toContain('SUMMARIZE mode');
    expect(prompt.system).toContain('Condense');
  });

  it('user prompt 应该包含总结任务指令', () => {
    const input = createMockInput('summarize_section');
    const prompt = buildSummarizeSectionPrompt(input);

    expect(prompt.user).toContain('TASK: Summarize');
    expect(prompt.user).toContain('Style:');
  });

  it('应该正确映射 summaryStyle=bullet', () => {
    const input = createMockInput('summarize_section', { summaryStyle: 'bullet' });
    const prompt = buildSummarizeSectionPrompt(input);

    expect(prompt.user).toContain('Style: bullet');
    expect(prompt.user).toContain('bullet points');
  });

  it('应该正确映射 summaryStyle=short', () => {
    const input = createMockInput('summarize_section', { summaryStyle: 'short' });
    const prompt = buildSummarizeSectionPrompt(input);

    expect(prompt.user).toContain('Style: short');
    expect(prompt.user).toContain('1-2 concise paragraphs');
  });

  it('应该正确映射 summaryStyle=long', () => {
    const input = createMockInput('summarize_section', { summaryStyle: 'long' });
    const prompt = buildSummarizeSectionPrompt(input);

    expect(prompt.user).toContain('Style: long');
    expect(prompt.user).toContain('3-5 detailed paragraphs');
  });
});

// ==========================================
// buildExpandSectionPrompt 测试
// ==========================================

describe('buildExpandSectionPrompt', () => {
  it('应该返回包含 system 和 user 的 BuiltPrompt', () => {
    const input = createMockInput('expand_section');
    const prompt = buildExpandSectionPrompt(input);

    expect(prompt.system).toBeDefined();
    expect(prompt.user).toBeDefined();
  });

  it('system prompt 应该包含 expand 模式规则', () => {
    const input = createMockInput('expand_section');
    const prompt = buildExpandSectionPrompt(input);

    expect(prompt.system).toContain('EXPAND mode');
    expect(prompt.system).toContain('MAY add new paragraphs');
  });

  it('user prompt 应该包含扩写任务指令', () => {
    const input = createMockInput('expand_section');
    const prompt = buildExpandSectionPrompt(input);

    expect(prompt.user).toContain('TASK: Expand');
    expect(prompt.user).toContain('Expansion level');
  });

  it('应该正确映射 expandLength=short', () => {
    const input = createMockInput('expand_section', { expandLength: 'short' });
    const prompt = buildExpandSectionPrompt(input);

    expect(prompt.user).toContain('Expansion level: short');
    expect(prompt.user).toContain('1-2 sentences');
  });

  it('应该正确映射 expandLength=medium', () => {
    const input = createMockInput('expand_section', { expandLength: 'medium' });
    const prompt = buildExpandSectionPrompt(input);

    expect(prompt.user).toContain('Expansion level: medium');
    expect(prompt.user).toContain('2-4 sentences');
  });

  it('应该正确映射 expandLength=long', () => {
    const input = createMockInput('expand_section', { expandLength: 'long' });
    const prompt = buildExpandSectionPrompt(input);

    expect(prompt.user).toContain('Expansion level: long');
    expect(prompt.user).toContain('Significantly expand');
  });
});

// ==========================================
// buildSectionPrompt（自动选择）测试
// ==========================================

describe('buildSectionPrompt', () => {
  it('rewrite_section intent 应该使用 rewrite 模式', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildSectionPrompt(input);

    expect(prompt.system).toContain('REWRITE mode');
  });

  it('summarize_section intent 应该使用 summarize 模式', () => {
    const input = createMockInput('summarize_section');
    const prompt = buildSectionPrompt(input);

    expect(prompt.system).toContain('SUMMARIZE mode');
  });

  it('expand_section intent 应该使用 expand 模式', () => {
    const input = createMockInput('expand_section');
    const prompt = buildSectionPrompt(input);

    expect(prompt.system).toContain('EXPAND mode');
  });
});

// ==========================================
// 内部函数测试
// ==========================================

describe('__internal', () => {
  describe('escapeJsonString', () => {
    it('应该转义双引号', () => {
      expect(__internal.escapeJsonString('He said "hello"')).toBe('He said \\"hello\\"');
    });

    it('应该转义换行符', () => {
      expect(__internal.escapeJsonString('line1\nline2')).toBe('line1\\nline2');
    });

    it('应该转义反斜杠', () => {
      expect(__internal.escapeJsonString('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('应该转义制表符', () => {
      expect(__internal.escapeJsonString('col1\tcol2')).toBe('col1\\tcol2');
    });
  });

  describe('estimateTokens', () => {
    it('应该返回字符数除以4', () => {
      expect(__internal.estimateTokens('1234')).toBe(1);
      expect(__internal.estimateTokens('12345678')).toBe(2);
      expect(__internal.estimateTokens('123')).toBe(1); // ceil(3/4)
    });
  });

  describe('getModeFromIntent', () => {
    it('rewrite_section 应该返回 rewrite', () => {
      const intent = createMockIntent('rewrite_section');
      expect(__internal.getModeFromIntent(intent)).toBe('rewrite');
    });

    it('summarize_section 应该返回 summarize', () => {
      const intent = createMockIntent('summarize_section');
      expect(__internal.getModeFromIntent(intent)).toBe('summarize');
    });

    it('expand_section 应该返回 expand', () => {
      const intent = createMockIntent('expand_section');
      expect(__internal.getModeFromIntent(intent)).toBe('expand');
    });

    it('未知类型应该返回 rewrite', () => {
      const intent = createMockIntent('unknown');
      expect(__internal.getModeFromIntent(intent)).toBe('rewrite');
    });
  });

  describe('simplifySection', () => {
    it('应该只保留必要字段', () => {
      const context = createMockSectionContext();
      const simplified = __internal.simplifySection(context);

      expect(simplified.title).toBe('测试章节标题');
      expect(simplified.level).toBe(2);
      expect(simplified.paragraphs).toHaveLength(2);
      expect(simplified.paragraphs[0].index).toBe(0);
      expect(simplified.paragraphs[0].text).toBe('这是第一段内容，包含一些测试文本。');
      // 不应该包含 nodePath、nodeKey 等
      expect((simplified.paragraphs[0] as any).nodeKey).toBeUndefined();
      expect((simplified.paragraphs[0] as any).nodePath).toBeUndefined();
    });
  });

  describe('formatSectionAsJson', () => {
    it('应该生成有效的 JSON 结构', () => {
      const context = createMockSectionContext();
      const simplified = __internal.simplifySection(context);
      const json = __internal.formatSectionAsJson(simplified);

      // 应该可以被解析
      expect(() => JSON.parse(json)).not.toThrow();
      
      const parsed = JSON.parse(json);
      expect(parsed.section.title).toBe('测试章节标题');
      expect(parsed.section.level).toBe(2);
      expect(parsed.section.paragraphs).toHaveLength(2);
    });
  });
});

// ==========================================
// H2/H3 支持测试
// ==========================================

describe('H2/H3 支持', () => {
  it('H2 section 应该正确显示 level: 2', () => {
    const input = createMockInput('rewrite_section', {}, { level: 2 });
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.user).toContain('"level": 2');
    expect(prompt.metadata?.sectionLevel).toBe(2);
  });

  it('H3 section 应该正确显示 level: 3', () => {
    const input = createMockInput('rewrite_section', {}, { level: 3 });
    const prompt = buildRewriteSectionPrompt(input);

    expect(prompt.user).toContain('"level": 3');
    expect(prompt.metadata?.sectionLevel).toBe(3);
  });
});

// ==========================================
// 纯函数验证
// ==========================================

describe('纯函数验证', () => {
  it('不应该修改输入的 context', () => {
    const input = createMockInput('rewrite_section');
    const originalJson = JSON.stringify(input.context);

    buildRewriteSectionPrompt(input);

    expect(JSON.stringify(input.context)).toBe(originalJson);
  });

  it('不应该修改输入的 intent', () => {
    const input = createMockInput('rewrite_section');
    const originalJson = JSON.stringify(input.intent);

    buildRewriteSectionPrompt(input);

    expect(JSON.stringify(input.intent)).toBe(originalJson);
  });

  it('返回值应该可以被 JSON 序列化', () => {
    const input = createMockInput('rewrite_section');
    const prompt = buildRewriteSectionPrompt(input);

    expect(() => JSON.stringify(prompt)).not.toThrow();
  });
});

