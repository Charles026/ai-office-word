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

    it('H1 标题应该抛出不支持的错误', () => {
      let h1Key = '';
      
      setupEditorWithContent(editor, () => {
        const root = $getRoot();
        const h1 = $createHeadingNode('h1');
        h1.append($createTextNode('文档标题'));
        h1Key = h1.getKey();
        root.append(h1);
      });

      expect(() => {
        extractSectionContext(editor, h1Key);
      }).toThrow(SectionContextError);
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

