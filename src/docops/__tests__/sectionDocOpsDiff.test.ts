/**
 * Section DocOps Diff Writer 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildSectionDocOpsDiff,
  buildSectionDocOpsDiffFromIntent,
  getDiffModeFromIntent,
  countDocOps,
  isDocOpsEmpty,
  SectionDiffError,
  LlmParagraph,
} from '../sectionDocOpsDiff';
import { SectionContext, ParagraphInfo } from '../../runtime/context/types';

// ==========================================
// 测试数据
// ==========================================

function createMockParagraph(
  index: number,
  text: string,
  nodeKey?: string
): ParagraphInfo {
  const key = nodeKey || `p${index}`;
  return {
    nodeKey: key,
    text,
    nodePath: ['root', 'section', key],
    nodeType: 'paragraph',
  };
}

function createMockSectionContext(
  paragraphs: ParagraphInfo[],
  overrides?: Partial<SectionContext>
): SectionContext {
  return {
    sectionId: 'test-section',
    titleText: '测试章节',
    titleNodePath: ['root', 'test-section'],
    level: 2,
    paragraphs,
    ownParagraphs: paragraphs,
    subtreeParagraphs: paragraphs,
    childSections: [],
    startIndex: 0,
    endIndex: paragraphs.length,
    ...overrides,
  };
}

function createLlmParagraphs(texts: string[]): LlmParagraph[] {
  return texts.map((text, index) => ({ index, text }));
}

// ==========================================
// getDiffModeFromIntent 测试
// ==========================================

describe('getDiffModeFromIntent', () => {
  it('rewrite_section 应该返回 rewrite', () => {
    expect(getDiffModeFromIntent('rewrite_section')).toBe('rewrite');
  });

  it('summarize_section 应该返回 summarize', () => {
    expect(getDiffModeFromIntent('summarize_section')).toBe('summarize');
  });

  it('expand_section 应该返回 expand', () => {
    expect(getDiffModeFromIntent('expand_section')).toBe('expand');
  });

  it('未知类型应该返回 rewrite', () => {
    expect(getDiffModeFromIntent('unknown' as any)).toBe('rewrite');
  });
});

// ==========================================
// rewrite 模式测试
// ==========================================

describe('buildSectionDocOpsDiff - rewrite 模式', () => {
  it('文本相同时不应该生成 DocOps', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
      createMockParagraph(1, '第二段'),
    ]);
    const newParagraphs = createLlmParagraphs(['第一段', '第二段']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });

    expect(ops).toHaveLength(0);
  });

  it('文本不同时应该生成 replace 操作', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '旧文本1'),
      createMockParagraph(1, '旧文本2'),
    ]);
    const newParagraphs = createLlmParagraphs(['新文本1', '新文本2']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });

    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe('replace_paragraph');
    expect((ops[0] as any).newText).toBe('新文本1');
    expect(ops[1].type).toBe('replace_paragraph');
    expect((ops[1] as any).newText).toBe('新文本2');
  });

  it('部分文本相同时只应该替换不同的段落', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '相同文本'),
      createMockParagraph(1, '旧文本'),
      createMockParagraph(2, '相同文本2'),
    ]);
    const newParagraphs = createLlmParagraphs(['相同文本', '新文本', '相同文本2']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });

    expect(ops).toHaveLength(1);
    expect((ops[0] as any).index).toBe(1);
    expect((ops[0] as any).newText).toBe('新文本');
  });

  it('段落数不一致时在 strict 模式下应该抛出错误', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
      createMockParagraph(1, '第二段'),
    ]);
    const newParagraphs = createLlmParagraphs(['只有一段']);

    // strict 模式下抛出错误
    expect(() => {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite', strict: true });
    }).toThrow(SectionDiffError);
  });

  it('段落数不一致时在非 strict 模式下应该记录错误但不抛出', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
      createMockParagraph(1, '第二段'),
    ]);
    const newParagraphs = createLlmParagraphs(['只有一段']);

    // 非 strict 模式下不抛出，但会记录错误
    // 注意：实际使用中应该先通过 repairRewriteSectionParagraphs 修复
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // 不应抛出错误
    expect(() => {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite', strict: false });
    }).not.toThrow();
    
    // 应该记录错误
    expect(consoleSpy).toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });

  it('应该使用正确的 nodePath', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '旧文本', 'custom-key'),
    ]);
    const newParagraphs = createLlmParagraphs(['新文本']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });

    expect(ops).toHaveLength(1);
    expect((ops[0] as any).targetPath).toEqual(['root', 'section', 'custom-key']);
    expect((ops[0] as any).targetKey).toBe('custom-key');
  });

  it('replace 操作应该设置 preserveStyle: true', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '旧文本'),
    ]);
    const newParagraphs = createLlmParagraphs(['新文本']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });

    expect((ops[0] as any).preserveStyle).toBe(true);
  });
});

// ==========================================
// summarize 模式测试
// ==========================================

describe('buildSectionDocOpsDiff - summarize 模式', () => {
  it('段落减少时应该生成 replace + delete 操作', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
      createMockParagraph(1, '第二段'),
      createMockParagraph(2, '第三段'),
    ]);
    const newParagraphs = createLlmParagraphs(['总结内容']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'summarize' });

    // 1 replace + 2 delete
    expect(ops).toHaveLength(3);
    
    // replace 应该在前面
    expect(ops[0].type).toBe('replace_paragraph');
    
    // delete 应该在后面，且倒序
    expect(ops[1].type).toBe('delete_paragraph');
    expect(ops[2].type).toBe('delete_paragraph');
    expect((ops[1] as any).index).toBe(2); // 先删 index 2
    expect((ops[2] as any).index).toBe(1); // 再删 index 1
  });

  it('段落数相同时应该只生成 replace 操作', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '旧文本'),
    ]);
    const newParagraphs = createLlmParagraphs(['新文本']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'summarize' });

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('replace_paragraph');
  });

  it('严格模式下 new > old 应该抛出错误', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
    ]);
    const newParagraphs = createLlmParagraphs(['第一段', '第二段']);

    expect(() => {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'summarize', strict: true });
    }).toThrow(SectionDiffError);
  });

  it('非严格模式下 new > old 应该警告但不抛错', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
    ]);
    const newParagraphs = createLlmParagraphs(['第一段', '第二段']);

    // 不应该抛出错误
    expect(() => {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'summarize', strict: false });
    }).not.toThrow();
  });
});

// ==========================================
// expand 模式测试
// ==========================================

describe('buildSectionDocOpsDiff - expand 模式', () => {
  it('段落增加时应该生成 replace + insert 操作', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
    ]);
    const newParagraphs = createLlmParagraphs(['新第一段', '新增段落']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'expand' });

    // 1 replace + 1 insert
    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe('replace_paragraph');
    expect(ops[1].type).toBe('insert_paragraph_after');
  });

  it('insert 操作应该使用最后一个旧段落作为参考', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段', 'p0'),
      createMockParagraph(1, '第二段', 'p1'),
    ]);
    const newParagraphs = createLlmParagraphs(['第一段', '第二段', '新增段落']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'expand' });

    // 只有 1 insert（前两段相同）
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('insert_paragraph_after');
    expect((ops[0] as any).referencePath).toEqual(['root', 'section', 'p1']);
    expect((ops[0] as any).referenceKey).toBe('p1');
  });

  it('多个新增段落应该按顺序插入', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '第一段'),
    ]);
    const newParagraphs = createLlmParagraphs(['第一段', '新段落1', '新段落2']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'expand' });

    // 2 insert
    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe('insert_paragraph_after');
    expect(ops[1].type).toBe('insert_paragraph_after');
    expect((ops[0] as any).index).toBe(1);
    expect((ops[1] as any).index).toBe(2);
  });
});

// ==========================================
// 输入验证测试
// ==========================================

describe('输入验证', () => {
  it('newParagraphs 不是数组时应该抛出错误（strict 模式）', () => {
    const context = createMockSectionContext([createMockParagraph(0, '段落')]);

    // 使用 strict: true 强制抛出错误
    expect(() => {
      buildSectionDocOpsDiff(context, 'not an array' as any, { mode: 'rewrite', strict: true });
    }).toThrow(SectionDiffError);
  });

  it('newParagraphs 不是数组时返回空数组（非 strict 模式）', () => {
    const context = createMockSectionContext([createMockParagraph(0, '段落')]);

    // 非 strict 模式下返回空数组
    const ops = buildSectionDocOpsDiff(context, 'not an array' as any, { mode: 'rewrite', strict: false });
    expect(ops).toEqual([]);
  });

  it('index 不从 0 开始时应该抛出错误', () => {
    const context = createMockSectionContext([createMockParagraph(0, '段落')]);
    const newParagraphs = [{ index: 1, text: '段落' }];

    expect(() => {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });
    }).toThrow(SectionDiffError);
  });

  it('index 不递增时应该抛出错误', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '段落1'),
      createMockParagraph(1, '段落2'),
    ]);
    const newParagraphs = [
      { index: 0, text: '段落1' },
      { index: 0, text: '段落2' }, // 应该是 1
    ];

    expect(() => {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });
    }).toThrow(SectionDiffError);
  });

  it('text 不是字符串时应该抛出错误', () => {
    const context = createMockSectionContext([createMockParagraph(0, '段落')]);
    const newParagraphs = [{ index: 0, text: 123 as any }];

    expect(() => {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });
    }).toThrow(SectionDiffError);
  });
});

// ==========================================
// DocOps 排序测试
// ==========================================

describe('DocOps 排序', () => {
  it('应该按 replace → insert → delete 顺序排列', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '段落0'),
      createMockParagraph(1, '段落1'),
      createMockParagraph(2, '段落2'),
    ]);
    // summarize: 只保留一段
    const newParagraphs = createLlmParagraphs(['新段落0']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'summarize' });

    // 应该是 1 replace + 2 delete
    expect(ops[0].type).toBe('replace_paragraph');
    expect(ops[1].type).toBe('delete_paragraph');
    expect(ops[2].type).toBe('delete_paragraph');
  });

  it('delete 操作应该按 index 倒序', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '段落0'),
      createMockParagraph(1, '段落1'),
      createMockParagraph(2, '段落2'),
      createMockParagraph(3, '段落3'),
    ]);
    const newParagraphs = createLlmParagraphs(['新段落0']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'summarize' });

    const deleteOps = ops.filter(op => op.type === 'delete_paragraph');
    expect(deleteOps).toHaveLength(3);
    expect((deleteOps[0] as any).index).toBe(3);
    expect((deleteOps[1] as any).index).toBe(2);
    expect((deleteOps[2] as any).index).toBe(1);
  });
});

// ==========================================
// 便捷方法测试
// ==========================================

describe('便捷方法', () => {
  describe('buildSectionDocOpsDiffFromIntent', () => {
    it('应该根据 intent kind 自动选择模式', () => {
      const context = createMockSectionContext([
        createMockParagraph(0, '旧文本'),
      ]);
      const newParagraphs = createLlmParagraphs(['新文本']);

      const ops = buildSectionDocOpsDiffFromIntent(
        context,
        newParagraphs,
        'rewrite_section'
      );

      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('replace_paragraph');
    });
  });

  describe('countDocOps', () => {
    it('应该正确统计各类型操作数量', () => {
      const context = createMockSectionContext([
        createMockParagraph(0, '段落0'),
        createMockParagraph(1, '段落1'),
        createMockParagraph(2, '段落2'),
      ]);
      const newParagraphs = createLlmParagraphs(['新段落0']);

      const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'summarize' });
      const counts = countDocOps(ops);

      expect(counts.replace).toBe(1);
      expect(counts.insert).toBe(0);
      expect(counts.delete).toBe(2);
      expect(counts.total).toBe(3);
    });
  });

  describe('isDocOpsEmpty', () => {
    it('空数组应该返回 true', () => {
      expect(isDocOpsEmpty([])).toBe(true);
    });

    it('非空数组应该返回 false', () => {
      const context = createMockSectionContext([
        createMockParagraph(0, '旧文本'),
      ]);
      const newParagraphs = createLlmParagraphs(['新文本']);

      const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });
      expect(isDocOpsEmpty(ops)).toBe(false);
    });
  });
});

// ==========================================
// 边界情况测试
// ==========================================

describe('边界情况', () => {
  it('空旧段落 + 空新段落应该返回空数组', () => {
    const context = createMockSectionContext([]);
    const newParagraphs: LlmParagraph[] = [];

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });

    expect(ops).toHaveLength(0);
  });

  it('空旧段落 + 非空新段落应该返回空数组（并警告）', () => {
    const context = createMockSectionContext([]);
    const newParagraphs = createLlmParagraphs(['新段落']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'expand' });

    // 由于没有旧段落作为参考，无法插入
    expect(ops).toHaveLength(0);
  });

  it('文本只有空白差异时应该视为相同', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '  文本  '),
    ]);
    const newParagraphs = createLlmParagraphs(['文本']);

    const ops = buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite' });

    expect(ops).toHaveLength(0);
  });
});

// ==========================================
// SectionDiffError 测试
// ==========================================

describe('SectionDiffError', () => {
  it('应该包含正确的元信息', () => {
    const context = createMockSectionContext([
      createMockParagraph(0, '段落1'),
      createMockParagraph(1, '段落2'),
    ]);
    const newParagraphs = createLlmParagraphs(['只有一段']);

    // 使用 strict: true 强制抛出错误
    try {
      buildSectionDocOpsDiff(context, newParagraphs, { mode: 'rewrite', strict: true });
      expect.fail('应该抛出错误');
    } catch (error) {
      expect(error).toBeInstanceOf(SectionDiffError);
      const diffError = error as SectionDiffError;
      expect(diffError.sectionId).toBe('test-section');
      expect(diffError.oldLength).toBe(2);
      expect(diffError.newLength).toBe(1);
      expect(diffError.mode).toBe('rewrite');
    }
  });
});

