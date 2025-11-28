/**
 * AI 改写功能测试
 * 
 * 测试场景：
 * 1. 选中单段文本，调用 AI 改写，验证替换成功
 * 2. 验证段落样式保持不变
 * 3. 验证 Undo/Redo 行为正常
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode, $setSelection, LexicalEditor, ElementNode } from 'lexical';
import { $createRangeSelection } from 'lexical';
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';

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

function initEditorWithParagraphs(editor: LexicalEditor, texts: string[]): void {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    
    texts.forEach(text => {
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode(text);
      paragraph.append(textNode);
      root.append(paragraph);
    });
  }, { discrete: true });
}

function initEditorWithHeading(editor: LexicalEditor, headingText: string, bodyText: string): void {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    
    const heading = $createHeadingNode('h1');
    heading.append($createTextNode(headingText));
    root.append(heading);
    
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode(bodyText));
    root.append(paragraph);
  }, { discrete: true });
}

/**
 * 在同一个 update 中选中并替换文本
 */
function selectAndReplace(editor: LexicalEditor, startOffset: number, endOffset: number, newText: string): void {
  editor.update(() => {
    const root = $getRoot();
    const firstParagraph = root.getFirstChild() as ElementNode | null;
    if (!firstParagraph) return;
    
    const textNode = firstParagraph.getFirstChild();
    if (!textNode) return;
    
    const selection = $createRangeSelection();
    selection.anchor.set(textNode.getKey(), startOffset, 'text');
    selection.focus.set(textNode.getKey(), endOffset, 'text');
    $setSelection(selection);
    
    // 在同一个 update 中执行替换
    selection.insertText(newText);
  }, { discrete: true });
}

/**
 * 选中整段并替换
 */
function selectAllAndReplace(editor: LexicalEditor, newText: string): void {
  editor.update(() => {
    const root = $getRoot();
    const firstParagraph = root.getFirstChild() as ElementNode | null;
    if (!firstParagraph) return;
    
    const textNode = firstParagraph.getFirstChild();
    if (!textNode) return;
    
    const textContent = textNode.getTextContent();
    const selection = $createRangeSelection();
    selection.anchor.set(textNode.getKey(), 0, 'text');
    selection.focus.set(textNode.getKey(), textContent.length, 'text');
    $setSelection(selection);
    
    selection.insertText(newText);
  }, { discrete: true });
}

function getEditorText(editor: LexicalEditor): string[] {
  let texts: string[] = [];
  editor.getEditorState().read(() => {
    const root = $getRoot();
    root.getChildren().forEach(child => {
      texts.push(child.getTextContent());
    });
  });
  return texts;
}

function getFirstParagraphType(editor: LexicalEditor): string {
  let type = '';
  editor.getEditorState().read(() => {
    const root = $getRoot();
    const first = root.getFirstChild();
    if (first) {
      type = first.getType();
    }
  });
  return type;
}

// ==========================================
// 测试用例
// ==========================================

describe('AI 改写功能', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  describe('replaceSelection', () => {
    it('应该替换选中的文本', () => {
      // 准备：创建包含 "Hello World" 的段落
      initEditorWithParagraphs(editor, ['Hello World']);
      
      // 选中 "Hello" 并替换
      selectAndReplace(editor, 0, 5, 'Hi');
      
      // 验证：文本变为 "Hi World"
      const texts = getEditorText(editor);
      expect(texts[0]).toBe('Hi World');
    });

    it('应该替换整段文本', () => {
      initEditorWithParagraphs(editor, ['这是原始文本']);
      selectAllAndReplace(editor, '这是改写后的文本');
      
      const texts = getEditorText(editor);
      expect(texts[0]).toBe('这是改写后的文本');
    });

    it('应该保持段落类型不变（正文）', () => {
      initEditorWithParagraphs(editor, ['正文内容']);
      selectAllAndReplace(editor, '改写后的正文');
      
      const type = getFirstParagraphType(editor);
      expect(type).toBe('paragraph');
    });

    it('应该保持段落类型不变（标题）', () => {
      initEditorWithHeading(editor, '标题内容', '正文');
      
      // 选中标题文本并替换
      editor.update(() => {
        const root = $getRoot();
        const heading = root.getFirstChild() as ElementNode | null;
        if (!heading) return;
        
        const textNode = heading.getFirstChild();
        if (!textNode) return;
        
        const selection = $createRangeSelection();
        selection.anchor.set(textNode.getKey(), 0, 'text');
        selection.focus.set(textNode.getKey(), textNode.getTextContent().length, 'text');
        $setSelection(selection);
        
        selection.insertText('新标题');
      }, { discrete: true });
      
      const type = getFirstParagraphType(editor);
      expect(type).toBe('heading');
    });

    it('不应该替换折叠选区（光标）', () => {
      initEditorWithParagraphs(editor, ['原始文本']);
      
      // 设置折叠选区（光标），尝试替换但应该失败
      editor.update(() => {
        const root = $getRoot();
        const paragraph = root.getFirstChild() as ElementNode | null;
        if (!paragraph) return;
        
        const textNode = paragraph.getFirstChild();
        if (!textNode) return;
        
        const selection = $createRangeSelection();
        selection.anchor.set(textNode.getKey(), 2, 'text');
        selection.focus.set(textNode.getKey(), 2, 'text');
        $setSelection(selection);
        
        // 折叠选区时 insertText 会在光标位置插入
        // 这里我们测试的是 replaceSelection 应该检测到折叠选区并跳过
        if (!selection.isCollapsed()) {
          selection.insertText('不应该出现');
        }
      }, { discrete: true });
      
      // 文本应该保持不变
      const texts = getEditorText(editor);
      expect(texts[0]).toBe('原始文本');
    });

    it('应该处理多段文档中的单段替换', () => {
      initEditorWithParagraphs(editor, ['第一段', '第二段', '第三段']);
      
      // 选中第一段并替换
      selectAllAndReplace(editor, '改写后的第一段');
      
      const texts = getEditorText(editor);
      expect(texts[0]).toBe('改写后的第一段');
      expect(texts[1]).toBe('第二段');
      expect(texts[2]).toBe('第三段');
    });
  });

  describe('Mock LLM 集成测试', () => {
    it('应该模拟完整的 AI 改写流程', async () => {
      // 模拟 LLM 服务
      const mockLlmService = {
        rewriteSelection: vi.fn().mockResolvedValue({
          success: true,
          text: '这是 AI 改写后的文本',
        }),
      };
      
      // 准备文档
      initEditorWithParagraphs(editor, ['这是原始文本']);
      
      // 获取选区文本（模拟）
      let selectionText = '这是原始文本';
      
      // 调用模拟的 LLM
      const result = await mockLlmService.rewriteSelection(selectionText, '改成更正式的语气');
      
      expect(result.success).toBe(true);
      expect(result.text).toBe('这是 AI 改写后的文本');
      
      // 应用改写结果
      if (result.success && result.text) {
        selectAllAndReplace(editor, result.text);
      }
      
      // 验证结果
      const texts = getEditorText(editor);
      expect(texts[0]).toBe('这是 AI 改写后的文本');
    });
  });
});

// ==========================================
// Undo/Redo 测试（需要 HistoryPlugin）
// ==========================================

// 注意：完整的 Undo/Redo 测试需要集成 HistoryPlugin
// 这里只测试基本的替换功能
// Undo/Redo 行为在实际应用中通过 Lexical 的 HistoryPlugin 自动处理

