/**
 * Section 模块单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  buildOutline,
  getSectionRange,
  getSectionContent,
  getAllSections,
  replaceSectionContent,
  getHeadingLevel,
  getParagraphTypeFromLevel,
  isHeadingType,
  DocumentParagraphs,
  ParagraphNode,
} from '../section';

// ==========================================
// 测试数据
// ==========================================

/**
 * 创建测试段落
 */
function createParagraph(
  id: string,
  type: 'normal' | 'heading-1' | 'heading-2' | 'heading-3',
  text: string,
  index: number
): ParagraphNode {
  return { id, paragraphType: type, text, index };
}

/**
 * 情况 1：H1 → 多段正文 → H1
 */
const doc1: DocumentParagraphs = {
  paragraphs: [
    createParagraph('h1-1', 'heading-1', '第一章', 0),
    createParagraph('p1', 'normal', '第一章内容1', 1),
    createParagraph('p2', 'normal', '第一章内容2', 2),
    createParagraph('p3', 'normal', '第一章内容3', 3),
    createParagraph('h1-2', 'heading-1', '第二章', 4),
    createParagraph('p4', 'normal', '第二章内容', 5),
  ],
};

/**
 * 情况 2：H1 → H2 → H2 → H1
 */
const doc2: DocumentParagraphs = {
  paragraphs: [
    createParagraph('h1-1', 'heading-1', '第一章', 0),
    createParagraph('h2-1', 'heading-2', '1.1 小节', 1),
    createParagraph('p1', 'normal', '1.1 内容', 2),
    createParagraph('h2-2', 'heading-2', '1.2 小节', 3),
    createParagraph('p2', 'normal', '1.2 内容', 4),
    createParagraph('h1-2', 'heading-1', '第二章', 5),
    createParagraph('p3', 'normal', '第二章内容', 6),
  ],
};

/**
 * 情况 3：H1 → H2 → H3 → 文档结尾
 */
const doc3: DocumentParagraphs = {
  paragraphs: [
    createParagraph('h1-1', 'heading-1', '第一章', 0),
    createParagraph('p1', 'normal', '第一章简介', 1),
    createParagraph('h2-1', 'heading-2', '1.1 小节', 2),
    createParagraph('p2', 'normal', '1.1 内容', 3),
    createParagraph('h3-1', 'heading-3', '1.1.1 子小节', 4),
    createParagraph('p3', 'normal', '1.1.1 内容', 5),
  ],
};

/**
 * 空文档
 */
const emptyDoc: DocumentParagraphs = {
  paragraphs: [],
};

/**
 * 只有正文的文档
 */
const noHeadingsDoc: DocumentParagraphs = {
  paragraphs: [
    createParagraph('p1', 'normal', '段落1', 0),
    createParagraph('p2', 'normal', '段落2', 1),
  ],
};

// ==========================================
// 辅助函数测试
// ==========================================

describe('辅助函数', () => {
  describe('getHeadingLevel', () => {
    it('应该正确返回标题级别', () => {
      expect(getHeadingLevel('heading-1')).toBe(1);
      expect(getHeadingLevel('heading-2')).toBe(2);
      expect(getHeadingLevel('heading-3')).toBe(3);
    });

    it('应该对非标题类型返回 null', () => {
      expect(getHeadingLevel('normal')).toBeNull();
    });
  });

  describe('getParagraphTypeFromLevel', () => {
    it('应该正确返回段落类型', () => {
      expect(getParagraphTypeFromLevel(1)).toBe('heading-1');
      expect(getParagraphTypeFromLevel(2)).toBe('heading-2');
      expect(getParagraphTypeFromLevel(3)).toBe('heading-3');
    });
  });

  describe('isHeadingType', () => {
    it('应该正确判断标题类型', () => {
      expect(isHeadingType('heading-1')).toBe(true);
      expect(isHeadingType('heading-2')).toBe(true);
      expect(isHeadingType('heading-3')).toBe(true);
      expect(isHeadingType('normal')).toBe(false);
    });
  });
});

// ==========================================
// buildOutline 测试
// ==========================================

describe('buildOutline', () => {
  it('应该从文档生成正确的大纲', () => {
    const outline = buildOutline(doc1);
    
    expect(outline).toHaveLength(2);
    expect(outline[0]).toEqual({
      id: 'h1-1',
      level: 1,
      text: '第一章',
      index: 0,
    });
    expect(outline[1]).toEqual({
      id: 'h1-2',
      level: 1,
      text: '第二章',
      index: 4,
    });
  });

  it('应该处理多级标题', () => {
    const outline = buildOutline(doc2);
    
    expect(outline).toHaveLength(4);
    expect(outline.map(o => o.level)).toEqual([1, 2, 2, 1]);
  });

  it('应该处理嵌套标题', () => {
    const outline = buildOutline(doc3);
    
    expect(outline).toHaveLength(3);
    expect(outline.map(o => o.level)).toEqual([1, 2, 3]);
  });

  it('应该处理空文档', () => {
    const outline = buildOutline(emptyDoc);
    expect(outline).toHaveLength(0);
  });

  it('应该处理没有标题的文档', () => {
    const outline = buildOutline(noHeadingsDoc);
    expect(outline).toHaveLength(0);
  });
});

// ==========================================
// getSectionRange 测试
// ==========================================

describe('getSectionRange', () => {
  describe('情况 1：H1 → 多段正文 → H1', () => {
    it('应该正确计算第一个 H1 的范围', () => {
      const section = getSectionRange(doc1, 'h1-1');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(0);
      expect(section!.endIndex).toBe(3); // 闭区间，包含 p3
      expect(section!.paragraphIds).toEqual(['h1-1', 'p1', 'p2', 'p3']);
    });

    it('应该正确计算第二个 H1 的范围（文档末尾）', () => {
      const section = getSectionRange(doc1, 'h1-2');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(4);
      expect(section!.endIndex).toBe(5); // 文档末尾
      expect(section!.paragraphIds).toEqual(['h1-2', 'p4']);
    });
  });

  describe('情况 2：H1 → H2 → H2 → H1', () => {
    it('H1 应该包含所有子 H2', () => {
      const section = getSectionRange(doc2, 'h1-1');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(0);
      expect(section!.endIndex).toBe(4); // 包含到 p2
      expect(section!.paragraphIds).toHaveLength(5);
    });

    it('第一个 H2 应该在遇到同级 H2 时停止', () => {
      const section = getSectionRange(doc2, 'h2-1');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(1);
      expect(section!.endIndex).toBe(2); // 只包含 p1
      expect(section!.paragraphIds).toEqual(['h2-1', 'p1']);
    });

    it('第二个 H2 应该在遇到 H1 时停止', () => {
      const section = getSectionRange(doc2, 'h2-2');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(3);
      expect(section!.endIndex).toBe(4);
      expect(section!.paragraphIds).toEqual(['h2-2', 'p2']);
    });
  });

  describe('情况 3：H1 → H2 → H3 → 文档结尾', () => {
    it('H1 应该包含到文档末尾', () => {
      const section = getSectionRange(doc3, 'h1-1');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(0);
      expect(section!.endIndex).toBe(5); // 文档末尾
      expect(section!.paragraphIds).toHaveLength(6);
    });

    it('H2 应该包含子 H3', () => {
      const section = getSectionRange(doc3, 'h2-1');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(2);
      expect(section!.endIndex).toBe(5); // 包含 H3 及其内容
      expect(section!.paragraphIds).toHaveLength(4);
    });

    it('H3 应该包含到文档末尾', () => {
      const section = getSectionRange(doc3, 'h3-1');
      
      expect(section).not.toBeNull();
      expect(section!.startIndex).toBe(4);
      expect(section!.endIndex).toBe(5);
      expect(section!.paragraphIds).toEqual(['h3-1', 'p3']);
    });
  });

  describe('边界情况', () => {
    it('应该返回 null 如果找不到 heading', () => {
      const section = getSectionRange(doc1, 'not-exist');
      expect(section).toBeNull();
    });

    it('应该返回 null 如果 ID 对应的不是 heading', () => {
      const section = getSectionRange(doc1, 'p1');
      expect(section).toBeNull();
    });

    it('应该处理空文档', () => {
      const section = getSectionRange(emptyDoc, 'any');
      expect(section).toBeNull();
    });
  });
});

// ==========================================
// getSectionContent 测试
// ==========================================

describe('getSectionContent', () => {
  it('应该返回章节内容（不含标题）', () => {
    const content = getSectionContent(doc1, 'h1-1');
    
    expect(content).not.toBeNull();
    expect(content).toBe('第一章内容1\n\n第一章内容2\n\n第一章内容3');
  });

  it('应该返回 null 如果找不到 heading', () => {
    const content = getSectionContent(doc1, 'not-exist');
    expect(content).toBeNull();
  });
});

// ==========================================
// getAllSections 测试
// ==========================================

describe('getAllSections', () => {
  it('应该返回所有章节', () => {
    const sections = getAllSections(doc2);
    
    expect(sections).toHaveLength(4);
    expect(sections.map(s => s.heading.id)).toEqual(['h1-1', 'h2-1', 'h2-2', 'h1-2']);
  });

  it('应该处理空文档', () => {
    const sections = getAllSections(emptyDoc);
    expect(sections).toHaveLength(0);
  });
});

// ==========================================
// replaceSectionContent 测试
// ==========================================

describe('replaceSectionContent', () => {
  it('应该正确替换章节内容', () => {
    const section = getSectionRange(doc1, 'h1-1')!;
    
    const newParagraphs: ParagraphNode[] = [
      createParagraph('new-p1', 'normal', '新内容', 0),
    ];
    
    const newDoc = replaceSectionContent(doc1, section, newParagraphs);
    
    // 验证结构
    expect(newDoc.paragraphs).toHaveLength(4); // h1-1 + new-p1 + h1-2 + p4
    expect(newDoc.paragraphs[0].id).toBe('h1-1'); // 标题保留
    expect(newDoc.paragraphs[1].id).toBe('new-p1'); // 新内容
    expect(newDoc.paragraphs[2].id).toBe('h1-2'); // 后续章节
  });

  it('应该正确更新索引', () => {
    const section = getSectionRange(doc1, 'h1-1')!;
    
    const newParagraphs: ParagraphNode[] = [
      createParagraph('new-p1', 'normal', '新内容1', 0),
      createParagraph('new-p2', 'normal', '新内容2', 0),
    ];
    
    const newDoc = replaceSectionContent(doc1, section, newParagraphs);
    
    // 验证索引
    expect(newDoc.paragraphs[0].index).toBe(0);
    expect(newDoc.paragraphs[1].index).toBe(1);
    expect(newDoc.paragraphs[2].index).toBe(2);
    expect(newDoc.paragraphs[3].index).toBe(3);
    expect(newDoc.paragraphs[4].index).toBe(4);
  });
});

