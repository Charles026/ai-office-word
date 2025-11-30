/**
 * extractSectionContext 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createEditor, LexicalEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import {
  extractSectionContext,
  getSectionPlainText,
  getSectionFullText,
  isSectionEmpty,
  getSectionStats,
} from '../extractSectionContext';
import { SectionContextError } from '../types';

// ==========================================
// 测试辅助函数
// ==========================================

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'test',
    nodes: [HeadingNode, ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });
  return editor;
}

function setupEditorWithContent(
  editor: LexicalEditor,
  setup: () => void
): void {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      setup();
    },
    { discrete: true }
  );
}

// ==========================================
// 测试用例
// ==========================================

describe('extractSectionContext', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  describe('基本功能', () => {
    it('应该正确提取 H2 section', () => {
      let h2Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('第一章'));
        h2Key = h2.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('这是第一段内容。'));
        
        const p2 = $createParagraphNode();
        p2.append($createTextNode('这是第二段内容。'));
        
        root.append(h2, p1, p2);
      });

      const context = extractSectionContext(editor, h2Key);

      expect(context.sectionId).toBe(h2Key);
      expect(context.titleText).toBe('第一章');
      expect(context.level).toBe(2);
      expect(context.paragraphs).toHaveLength(2);
      expect(context.paragraphs[0].text).toBe('这是第一段内容。');
      expect(context.paragraphs[1].text).toBe('这是第二段内容。');
      expect(context.startIndex).toBe(0);
      expect(context.endIndex).toBe(2);
    });

    it('应该正确提取 H3 section', () => {
      let h3Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('第一章'));
        
        const h3 = $createHeadingNode('h3');
        h3.append($createTextNode('第一节'));
        h3Key = h3.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('这是第一节的内容。'));
        
        root.append(h2, h3, p1);
      });

      const context = extractSectionContext(editor, h3Key);

      expect(context.sectionId).toBe(h3Key);
      expect(context.titleText).toBe('第一节');
      expect(context.level).toBe(3);
      expect(context.paragraphs).toHaveLength(1);
      expect(context.startIndex).toBe(1);
      expect(context.endIndex).toBe(2);
    });
  });

  describe('边界处理', () => {
    it('H2 遇到下一个 H2 时应该正确结束', () => {
      let h2Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2_1 = $createHeadingNode('h2');
        h2_1.append($createTextNode('第一章'));
        h2Key = h2_1.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('第一章内容'));
        
        const h2_2 = $createHeadingNode('h2');
        h2_2.append($createTextNode('第二章'));
        
        const p2 = $createParagraphNode();
        p2.append($createTextNode('第二章内容'));
        
        root.append(h2_1, p1, h2_2, p2);
      });

      const context = extractSectionContext(editor, h2Key);

      expect(context.paragraphs).toHaveLength(1);
      expect(context.paragraphs[0].text).toBe('第一章内容');
      expect(context.endIndex).toBe(1); // 不包含第二个 H2
    });

    it('H3 遇到同级 H3 时应该正确结束', () => {
      let h3Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('第一章'));
        
        const h3_1 = $createHeadingNode('h3');
        h3_1.append($createTextNode('第一节'));
        h3Key = h3_1.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('第一节内容'));
        
        const h3_2 = $createHeadingNode('h3');
        h3_2.append($createTextNode('第二节'));
        
        const p2 = $createParagraphNode();
        p2.append($createTextNode('第二节内容'));
        
        root.append(h2, h3_1, p1, h3_2, p2);
      });

      const context = extractSectionContext(editor, h3Key);

      expect(context.paragraphs).toHaveLength(1);
      expect(context.paragraphs[0].text).toBe('第一节内容');
      expect(context.endIndex).toBe(2);
    });

    it('H3 遇到更高级 H2 时应该正确结束', () => {
      let h3Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2_1 = $createHeadingNode('h2');
        h2_1.append($createTextNode('第一章'));
        
        const h3 = $createHeadingNode('h3');
        h3.append($createTextNode('第一节'));
        h3Key = h3.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('第一节内容'));
        
        const h2_2 = $createHeadingNode('h2');
        h2_2.append($createTextNode('第二章'));
        
        root.append(h2_1, h3, p1, h2_2);
      });

      const context = extractSectionContext(editor, h3Key);

      expect(context.paragraphs).toHaveLength(1);
      expect(context.endIndex).toBe(2);
    });

    it('section 在文档末尾时应该正确处理', () => {
      let h2Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('最后一章'));
        h2Key = h2.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('最后的内容'));
        
        root.append(h2, p1);
      });

      const context = extractSectionContext(editor, h2Key);

      expect(context.paragraphs).toHaveLength(1);
      expect(context.endIndex).toBe(1);
    });
  });

  describe('错误处理', () => {
    it('找不到 sectionId 时应该抛出错误', () => {
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createTextNode('普通段落'));
        root.append(p);
      });

      expect(() => {
        extractSectionContext(editor, 'non-existent-id');
      }).toThrow(SectionContextError);
    });

    it('sectionId 指向非标题节点时应该抛出错误', () => {
      let pKey = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createTextNode('普通段落'));
        pKey = p.getKey();
        root.append(p);
      });

      expect(() => {
        extractSectionContext(editor, pKey);
      }).toThrow(SectionContextError);
    });

    // v1.1: H1 现在被支持，不再抛出错误
    // 保留此测试但更改为验证 H1 正常工作
  });

  // ==========================================
  // v1.1: H1 支持测试
  // ==========================================
  
  describe('H1 支持 (v1.1)', () => {
    it('应该正确提取 H1 section', () => {
      let h1Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h1 = $createHeadingNode('h1');
        h1.append($createTextNode('文档标题'));
        h1Key = h1.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('这是文档的开头导语。'));
        
        const p2 = $createParagraphNode();
        p2.append($createTextNode('这是第二段。'));
        
        root.append(h1, p1, p2);
      });

      const context = extractSectionContext(editor, h1Key);

      expect(context.sectionId).toBe(h1Key);
      expect(context.titleText).toBe('文档标题');
      expect(context.level).toBe(1);
      expect(context.paragraphs).toHaveLength(2);
      expect(context.startIndex).toBe(0);
    });

    it('H1 遇到 H2 时应该将 H2 作为子章节', () => {
      let h1Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h1 = $createHeadingNode('h1');
        h1.append($createTextNode('文档标题'));
        h1Key = h1.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('导语内容'));
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('第一章'));
        
        const p2 = $createParagraphNode();
        p2.append($createTextNode('第一章内容'));
        
        root.append(h1, p1, h2, p2);
      });

      const context = extractSectionContext(editor, h1Key);

      // H1 的直属段落 (ownParagraphs) 只包含 H2 之前的段落
      expect(context.ownParagraphs).toHaveLength(1);
      expect(context.ownParagraphs[0].text).toBe('导语内容');
      
      // H1 会包含 H2 作为子章节，直到遇到下一个 H1 或文档结尾
      // endIndex 是 3 (最后一个节点 p2 的索引)
      expect(context.endIndex).toBe(3);
      
      // subtreeParagraphs 应该包含整个子树的段落
      expect(context.subtreeParagraphs.length).toBeGreaterThanOrEqual(1);
      
      // childSections 应该包含 H2
      expect(context.childSections).toHaveLength(1);
      expect(context.childSections[0].titleText).toBe('第一章');
    });

    it('H1 包含 H2/H3 子章节时应该正确提取 childSections', () => {
      let h1Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h1 = $createHeadingNode('h1');
        h1.append($createTextNode('文档标题'));
        h1Key = h1.getKey();
        
        const intro = $createParagraphNode();
        intro.append($createTextNode('导语'));
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('第一章'));
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('第一章内容'));
        
        root.append(h1, intro, h2, p1);
      });

      const context = extractSectionContext(editor, h1Key);

      // H1 的直属段落 (ownParagraphs) 只包含 H2 之前的导语
      expect(context.ownParagraphs).toHaveLength(1);
      expect(context.ownParagraphs[0].text).toBe('导语');
      
      // H2 是 H1 的子章节
      expect(context.childSections).toHaveLength(1);
      expect(context.childSections[0].titleText).toBe('第一章');
      expect(context.childSections[0].level).toBe(2);
      
      // subtreeParagraphs 包含整个子树的段落（包括 H2 子章节下的内容）
      // subtreeParagraphs 至少包含导语和第一章内容，以及 H2 标题本身作为结构标记
      expect(context.subtreeParagraphs.length).toBeGreaterThanOrEqual(2);
    });

    it('getSectionFullText 应该为 H1 生成正确的 markdown', () => {
      let h1Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h1 = $createHeadingNode('h1');
        h1.append($createTextNode('文档标题'));
        h1Key = h1.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('内容'));
        
        root.append(h1, p1);
      });

      const context = extractSectionContext(editor, h1Key);
      const text = getSectionFullText(context);

      expect(text).toBe('# 文档标题\n\n内容');
    });
  });

  describe('空 section', () => {
    it('只有标题没有内容时应该返回空段落列表', () => {
      let h2Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2_1 = $createHeadingNode('h2');
        h2_1.append($createTextNode('空章节'));
        h2Key = h2_1.getKey();
        
        const h2_2 = $createHeadingNode('h2');
        h2_2.append($createTextNode('下一章'));
        
        root.append(h2_1, h2_2);
      });

      const context = extractSectionContext(editor, h2Key);

      expect(context.paragraphs).toHaveLength(0);
      expect(isSectionEmpty(context)).toBe(true);
    });
  });
});

describe('辅助函数', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  describe('getSectionPlainText', () => {
    it('应该返回段落的纯文本', () => {
      let h2Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('标题'));
        h2Key = h2.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('第一段'));
        
        const p2 = $createParagraphNode();
        p2.append($createTextNode('第二段'));
        
        root.append(h2, p1, p2);
      });

      const context = extractSectionContext(editor, h2Key);
      const text = getSectionPlainText(context);

      expect(text).toBe('第一段\n\n第二段');
    });
  });

  describe('getSectionFullText', () => {
    it('应该返回包含标题的完整文本', () => {
      let h2Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('标题'));
        h2Key = h2.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('内容'));
        
        root.append(h2, p1);
      });

      const context = extractSectionContext(editor, h2Key);
      const text = getSectionFullText(context);

      expect(text).toBe('## 标题\n\n内容');
    });
  });

  describe('getSectionStats', () => {
    it('应该返回正确的统计信息', () => {
      let h2Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        
        const h2 = $createHeadingNode('h2');
        h2.append($createTextNode('标题'));
        h2Key = h2.getKey();
        
        const p1 = $createParagraphNode();
        p1.append($createTextNode('Hello 你好'));
        
        root.append(h2, p1);
      });

      const context = extractSectionContext(editor, h2Key);
      const stats = getSectionStats(context);

      expect(stats.paragraphCount).toBe(1);
      expect(stats.charCount).toBe(8); // "Hello 你好" = 8 chars
      expect(stats.wordCount).toBe(3); // 1 English word + 2 Chinese chars
    });
  });
});

