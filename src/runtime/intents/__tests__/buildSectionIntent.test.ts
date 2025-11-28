/**
 * Section Intent Builder 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  buildRewriteSectionIntent,
  buildSummarizeSectionIntent,
  buildExpandSectionIntent,
} from '../buildSectionIntent';
import { SectionContext } from '../../context/types';
import { isSectionIntent, assignIntentId } from '../types';

// ==========================================
// 测试数据
// ==========================================

function createMockSectionContext(overrides?: Partial<SectionContext>): SectionContext {
  const paragraphs = [
    {
      nodeKey: 'p1',
      text: '这是测试段落',
      nodePath: ['root', 'test-section-id', 'p1'],
      nodeType: 'paragraph',
    },
  ];
  return {
    sectionId: 'test-section-id',
    titleText: '测试章节',
    titleNodePath: ['root', 'test-section-id'],
    level: 2,
    paragraphs,
    ownParagraphs: paragraphs,
    subtreeParagraphs: paragraphs,
    childSections: [],
    startIndex: 0,
    endIndex: 1,
    ...overrides,
  };
}

// ==========================================
// buildRewriteSectionIntent 测试
// ==========================================

describe('buildRewriteSectionIntent', () => {
  it('应该创建正确的 Intent 结构', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context);

    expect(intent.kind).toBe('rewrite_section');
    expect(intent.source).toBe('section');
    expect(intent.locale).toBe('auto');
    expect(intent.metadata?.sectionId).toBe('test-section-id');
    expect(intent.metadata?.sectionLevel).toBe(2);
  });

  it('应该正确映射 tone 选项', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context, { tone: 'formal' });

    expect(intent.options?.rewriteTone).toBe('formal');
  });

  it('应该正确映射 depth 选项', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context, { depth: 'heavy' });

    expect(intent.options?.rewriteDepth).toBe('heavy');
  });

  it('应该同时映射 tone 和 depth', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context, { 
      tone: 'concise', 
      depth: 'light' 
    });

    expect(intent.options?.rewriteTone).toBe('concise');
    expect(intent.options?.rewriteDepth).toBe('light');
  });

  it('没有选项时 options 应该只包含默认的 rewriteScope', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context);

    // 现在默认会有 rewriteScope: 'intro'
    expect(intent.options).toBeDefined();
    expect(intent.options?.rewriteScope).toBe('intro');
    expect(intent.options?.rewriteTone).toBeUndefined();
    expect(intent.options?.rewriteDepth).toBeUndefined();
  });

  it('指定 scope: chapter 时应该正确设置', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context, { scope: 'chapter' });

    expect(intent.options?.rewriteScope).toBe('chapter');
  });

  it('H3 级别应该正确记录', () => {
    const context = createMockSectionContext({ level: 3 });
    const intent = buildRewriteSectionIntent(context);

    expect(intent.metadata?.sectionLevel).toBe(3);
  });

  it('context.sectionId 为空时应该抛出错误', () => {
    const context = createMockSectionContext({ sectionId: '' });

    expect(() => {
      buildRewriteSectionIntent(context);
    }).toThrow('sectionId 不能为空');
  });

  it('context.level 不是 2 或 3 时应该抛出错误', () => {
    const context = createMockSectionContext({ level: 1 as any });

    expect(() => {
      buildRewriteSectionIntent(context);
    }).toThrow('level 必须是 2 或 3');
  });

  it('返回的 Intent 应该不包含 id', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context);

    expect((intent as any).id).toBeUndefined();
  });

  it('返回的 Intent 应该可以被 JSON 序列化', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context, { tone: 'formal' });

    expect(() => JSON.stringify(intent)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(intent));
    expect(parsed.kind).toBe('rewrite_section');
  });
});

// ==========================================
// buildSummarizeSectionIntent 测试
// ==========================================

describe('buildSummarizeSectionIntent', () => {
  it('应该创建正确的 Intent 结构', () => {
    const context = createMockSectionContext();
    const intent = buildSummarizeSectionIntent(context);

    expect(intent.kind).toBe('summarize_section');
    expect(intent.source).toBe('section');
    expect(intent.locale).toBe('auto');
    expect(intent.metadata?.sectionId).toBe('test-section-id');
    expect(intent.metadata?.sectionLevel).toBe(2);
  });

  it('应该正确映射 style 选项', () => {
    const context = createMockSectionContext();
    const intent = buildSummarizeSectionIntent(context, { style: 'bullet' });

    expect(intent.options?.summaryStyle).toBe('bullet');
  });

  it('style=short 应该正确映射', () => {
    const context = createMockSectionContext();
    const intent = buildSummarizeSectionIntent(context, { style: 'short' });

    expect(intent.options?.summaryStyle).toBe('short');
  });

  it('style=long 应该正确映射', () => {
    const context = createMockSectionContext();
    const intent = buildSummarizeSectionIntent(context, { style: 'long' });

    expect(intent.options?.summaryStyle).toBe('long');
  });

  it('没有选项时 options 应该为 undefined', () => {
    const context = createMockSectionContext();
    const intent = buildSummarizeSectionIntent(context);

    expect(intent.options).toBeUndefined();
  });

  it('context 无效时应该抛出错误', () => {
    expect(() => {
      buildSummarizeSectionIntent(null as any);
    }).toThrow('context 不能为空');
  });
});

// ==========================================
// buildExpandSectionIntent 测试
// ==========================================

describe('buildExpandSectionIntent', () => {
  it('应该创建正确的 Intent 结构', () => {
    const context = createMockSectionContext();
    const intent = buildExpandSectionIntent(context);

    expect(intent.kind).toBe('expand_section');
    expect(intent.source).toBe('section');
    expect(intent.locale).toBe('auto');
    expect(intent.metadata?.sectionId).toBe('test-section-id');
    expect(intent.metadata?.sectionLevel).toBe(2);
  });

  it('应该正确映射 length 选项', () => {
    const context = createMockSectionContext();
    const intent = buildExpandSectionIntent(context, { length: 'medium' });

    expect(intent.options?.expandLength).toBe('medium');
  });

  it('length=short 应该正确映射', () => {
    const context = createMockSectionContext();
    const intent = buildExpandSectionIntent(context, { length: 'short' });

    expect(intent.options?.expandLength).toBe('short');
  });

  it('length=long 应该正确映射', () => {
    const context = createMockSectionContext();
    const intent = buildExpandSectionIntent(context, { length: 'long' });

    expect(intent.options?.expandLength).toBe('long');
  });

  it('没有选项时 options 应该为 undefined', () => {
    const context = createMockSectionContext();
    const intent = buildExpandSectionIntent(context);

    expect(intent.options).toBeUndefined();
  });
});

// ==========================================
// 类型守卫测试
// ==========================================

describe('isSectionIntent', () => {
  it('Section Intent 应该返回 true', () => {
    const context = createMockSectionContext();
    const intent = buildRewriteSectionIntent(context);

    expect(isSectionIntent(intent)).toBe(true);
  });

  it('非 Section Intent 应该返回 false', () => {
    const intent = {
      kind: 'rewrite' as const,
      source: 'selection' as const,
    };

    expect(isSectionIntent(intent)).toBe(false);
  });
});

// ==========================================
// assignIntentId 测试
// ==========================================

describe('assignIntentId', () => {
  it('应该为 Intent 分配 ID', () => {
    const context = createMockSectionContext();
    const intentBody = buildRewriteSectionIntent(context);
    const fullIntent = assignIntentId(intentBody);

    expect(fullIntent.id).toBeDefined();
    expect(fullIntent.id).toMatch(/^intent_\d+_[a-z0-9]+$/);
    expect(fullIntent.kind).toBe('rewrite_section');
  });

  it('每次调用应该生成不同的 ID', () => {
    const context = createMockSectionContext();
    const intentBody = buildRewriteSectionIntent(context);
    
    const intent1 = assignIntentId(intentBody);
    const intent2 = assignIntentId(intentBody);

    expect(intent1.id).not.toBe(intent2.id);
  });
});

// ==========================================
// 纯函数验证
// ==========================================

describe('纯函数验证', () => {
  it('buildRewriteSectionIntent 不应该修改输入的 context', () => {
    const context = createMockSectionContext();
    const originalJson = JSON.stringify(context);

    buildRewriteSectionIntent(context, { tone: 'formal' });

    expect(JSON.stringify(context)).toBe(originalJson);
  });

  it('buildSummarizeSectionIntent 不应该修改输入的 context', () => {
    const context = createMockSectionContext();
    const originalJson = JSON.stringify(context);

    buildSummarizeSectionIntent(context, { style: 'bullet' });

    expect(JSON.stringify(context)).toBe(originalJson);
  });

  it('buildExpandSectionIntent 不应该修改输入的 context', () => {
    const context = createMockSectionContext();
    const originalJson = JSON.stringify(context);

    buildExpandSectionIntent(context, { length: 'long' });

    expect(JSON.stringify(context)).toBe(originalJson);
  });
});

