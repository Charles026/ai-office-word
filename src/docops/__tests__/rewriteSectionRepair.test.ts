/**
 * rewriteSectionRepair 测试
 */

import { describe, it, expect } from 'vitest';
import {
  repairRewriteSectionParagraphs,
  repairRewriteSectionParagraphsWithDetails,
  needsRepair,
} from '../rewriteSectionRepair';
import type { SectionContext } from '../../runtime/context/types';

// ==========================================
// 测试辅助函数
// ==========================================

function createMockSectionContext(
  paragraphs: Array<{ text: string }>
): SectionContext {
  const paragraphInfos = paragraphs.map((p, i) => ({
    nodeKey: `p-${i}`,
    text: p.text,
    nodePath: ['root', String(i + 1)],
    nodeType: 'paragraph',
  }));
  return {
    sectionId: 'test-section',
    titleText: '测试标题',
    titleNodePath: ['root', '0'],
    paragraphs: paragraphInfos,
    ownParagraphs: paragraphInfos,
    subtreeParagraphs: paragraphInfos,
    childSections: [],
    startIndex: 0,
    endIndex: paragraphs.length,
    level: 2,
  };
}

// ==========================================
// 测试用例
// ==========================================

describe('repairRewriteSectionParagraphs', () => {
  describe('当 newParagraphs 无效时', () => {
    it('undefined 应该返回原文', () => {
      const context = createMockSectionContext([
        { text: '段落1' },
        { text: '段落2' },
      ]);

      const result = repairRewriteSectionParagraphs(context, undefined);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ index: 0, text: '段落1' });
      expect(result[1]).toEqual({ index: 1, text: '段落2' });
    });

    it('null 应该返回原文', () => {
      const context = createMockSectionContext([
        { text: '段落1' },
        { text: '段落2' },
      ]);

      const result = repairRewriteSectionParagraphs(context, null);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ index: 0, text: '段落1' });
      expect(result[1]).toEqual({ index: 1, text: '段落2' });
    });

    it('字符串应该返回原文', () => {
      const context = createMockSectionContext([
        { text: '段落1' },
      ]);

      const result = repairRewriteSectionParagraphs(context, 'not an array' as any);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ index: 0, text: '段落1' });
    });
  });

  describe('当 newParagraphs 长度不一致时', () => {
    it('新段落少于旧段落时，缺失位置使用原文', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
        { text: '原文2' },
        { text: '原文3' },
      ]);

      const newParagraphs = [
        { index: 0, text: '新文1' },
        { index: 1, text: '新文2' },
        // 缺少 index: 2
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('新文1');
      expect(result[1].text).toBe('新文2');
      expect(result[2].text).toBe('原文3'); // 使用原文回退
    });

    it('新段落多于旧段落时，忽略超出的段落', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
        { text: '原文2' },
      ]);

      const newParagraphs = [
        { index: 0, text: '新文1' },
        { index: 1, text: '新文2' },
        { index: 2, text: '新文3' }, // 超出范围
        { index: 3, text: '新文4' }, // 超出范围
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('新文1');
      expect(result[1].text).toBe('新文2');
    });
  });

  describe('当 newParagraphs 有无效项时', () => {
    it('缺少 index 字段的项应该被忽略', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
        { text: '原文2' },
      ]);

      const newParagraphs = [
        { index: 0, text: '新文1' },
        { text: '新文2' } as any, // 缺少 index
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('新文1');
      expect(result[1].text).toBe('原文2'); // 使用原文回退
    });

    it('缺少 text 字段的项应该被忽略', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
        { text: '原文2' },
      ]);

      const newParagraphs = [
        { index: 0 } as any, // 缺少 text
        { index: 1, text: '新文2' },
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('原文1'); // 使用原文回退
      expect(result[1].text).toBe('新文2');
    });

    it('空文本应该使用原文回退', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
        { text: '原文2' },
      ]);

      const newParagraphs = [
        { index: 0, text: '' }, // 空文本
        { index: 1, text: '   ' }, // 只有空白
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('原文1'); // 使用原文回退
      expect(result[1].text).toBe('原文2'); // 使用原文回退
    });

    it('index 为负数的项应该被忽略', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
      ]);

      const newParagraphs = [
        { index: -1, text: '新文' },
        { index: 0, text: '新文1' },
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('新文1');
    });
  });

  describe('正常情况', () => {
    it('长度一致且所有项有效时，直接使用新文本', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
        { text: '原文2' },
        { text: '原文3' },
      ]);

      const newParagraphs = [
        { index: 0, text: '新文1' },
        { index: 1, text: '新文2' },
        { index: 2, text: '新文3' },
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('新文1');
      expect(result[1].text).toBe('新文2');
      expect(result[2].text).toBe('新文3');
    });

    it('index 顺序乱序时，应该按 index 正确映射', () => {
      const context = createMockSectionContext([
        { text: '原文1' },
        { text: '原文2' },
        { text: '原文3' },
      ]);

      // 乱序的新段落
      const newParagraphs = [
        { index: 2, text: '新文3' },
        { index: 0, text: '新文1' },
        { index: 1, text: '新文2' },
      ];

      const result = repairRewriteSectionParagraphs(context, newParagraphs);

      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('新文1');
      expect(result[1].text).toBe('新文2');
      expect(result[2].text).toBe('新文3');
    });
  });
});

describe('repairRewriteSectionParagraphsWithDetails', () => {
  it('应该返回修复详情', () => {
    const context = createMockSectionContext([
      { text: '原文1' },
      { text: '原文2' },
      { text: '原文3' },
    ]);

    const newParagraphs = [
      { index: 0, text: '新文1' },
      // 缺少 index 1
      { index: 2, text: '新文3' },
    ];

    const result = repairRewriteSectionParagraphsWithDetails(context, newParagraphs);

    expect(result.wasRepaired).toBe(true);
    expect(result.repairDetails).toBeDefined();
    expect(result.repairDetails?.inputType).toBe('array');
    expect(result.repairDetails?.originalCount).toBe(2);
    expect(result.repairDetails?.targetCount).toBe(3);
    expect(result.repairDetails?.validNewCount).toBe(2);
    expect(result.repairDetails?.fallbackIndices).toEqual([1]);
  });

  it('无效输入时应该返回 invalid 类型', () => {
    const context = createMockSectionContext([
      { text: '原文1' },
    ]);

    const result = repairRewriteSectionParagraphsWithDetails(context, null);

    expect(result.wasRepaired).toBe(true);
    expect(result.repairDetails?.inputType).toBe('invalid');
    expect(result.repairDetails?.fallbackIndices).toEqual([0]);
  });

  it('完全匹配时 wasRepaired 应该为 false', () => {
    const context = createMockSectionContext([
      { text: '原文1' },
      { text: '原文2' },
    ]);

    const newParagraphs = [
      { index: 0, text: '新文1' },
      { index: 1, text: '新文2' },
    ];

    const result = repairRewriteSectionParagraphsWithDetails(context, newParagraphs);

    expect(result.wasRepaired).toBe(false);
    expect(result.repairDetails?.fallbackIndices).toEqual([]);
  });
});

describe('needsRepair', () => {
  it('undefined 需要修复', () => {
    const context = createMockSectionContext([{ text: '段落' }]);
    expect(needsRepair(context, undefined)).toBe(true);
  });

  it('null 需要修复', () => {
    const context = createMockSectionContext([{ text: '段落' }]);
    expect(needsRepair(context, null)).toBe(true);
  });

  it('长度不一致需要修复', () => {
    const context = createMockSectionContext([
      { text: '段落1' },
      { text: '段落2' },
    ]);
    const newParagraphs = [{ index: 0, text: '新文' }];
    expect(needsRepair(context, newParagraphs)).toBe(true);
  });

  it('index 不正确需要修复', () => {
    const context = createMockSectionContext([
      { text: '段落1' },
      { text: '段落2' },
    ]);
    const newParagraphs = [
      { index: 0, text: '新文1' },
      { index: 0, text: '新文2' }, // 应该是 1
    ];
    expect(needsRepair(context, newParagraphs)).toBe(true);
  });

  it('空文本需要修复', () => {
    const context = createMockSectionContext([{ text: '段落' }]);
    const newParagraphs = [{ index: 0, text: '' }];
    expect(needsRepair(context, newParagraphs)).toBe(true);
  });

  it('完全有效不需要修复', () => {
    const context = createMockSectionContext([
      { text: '段落1' },
      { text: '段落2' },
    ]);
    const newParagraphs = [
      { index: 0, text: '新文1' },
      { index: 1, text: '新文2' },
    ];
    expect(needsRepair(context, newParagraphs)).toBe(false);
  });
});

