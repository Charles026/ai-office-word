/**
 * Lexical Format Bridge
 * 
 * 负责 HTML ↔ Lexical State 的转换。
 * 
 * 【支持的元素】
 * - 块级元素：p, h1-h6, ul/ol (多级嵌套), li
 * - 内联样式：bold, italic, underline, strikethrough
 * - 字体样式：font-family (通过 TextNode.style 属性)
 * 
 * 【多级列表映射】
 * - HTML 嵌套 ul/ol → Lexical ListItemNode.indent
 * - Lexical ListItemNode.indent → HTML 嵌套 ul/ol
 * 
 * 【字体映射】
 * - Editor → HTML：TextNode 的 style 属性会被序列化为 span style="font-family: ..."
 * - HTML → Editor：$generateNodesFromDOM 会自动解析 style 属性
 * 
 * 【限制】
 * - 复杂样式（表格、图片）暂不支持
 * - 列表样式（disc, circle, square）暂不区分
 */

import { LexicalEditor, $getRoot, $insertNodes, $isElementNode, LexicalNode } from 'lexical';
import { $generateNodesFromDOM, $generateHtmlFromNodes } from '@lexical/html';
import { $isListNode, $isListItemNode } from '@lexical/list';

/**
 * 将 HTML 转换为 Lexical 初始状态函数
 * 
 * @param html - HTML 字符串
 * @returns 这里的返回值可以直接传给 LexicalComposer 的 initialConfig.editorState
 */
export function htmlToLexicalState(html: string) {
  return (editor: LexicalEditor) => {
    const parser = new DOMParser();
    const dom = parser.parseFromString(html, 'text/html');
    const nodes = $generateNodesFromDOM(editor, dom);
    
    // 清空并插入新节点
    const root = $getRoot();
    root.clear();
    root.select();
    $insertNodes(nodes);
  };
}

/**
 * 将 Lexical 状态转换为 HTML
 * 
 * 【多级列表处理】
 * Lexical 的 $generateHtmlFromNodes 会自动处理 ListNode 嵌套，
 * 但我们需要确保 ListItemNode 的 indent 属性被正确转换为嵌套的 ul/ol。
 * 
 * @param editor - Lexical 编辑器实例
 * @returns HTML 字符串
 */
export function lexicalStateToHtml(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => {
    // 使用 Lexical 内置的 HTML 生成
    // 它会自动处理 ListNode 和 ListItemNode 的嵌套
    const html = $generateHtmlFromNodes(editor, null);
    return html;
  });
}

/**
 * 获取编辑器中的列表结构信息（用于调试）
 */
export function getListStructure(editor: LexicalEditor): string[] {
  const result: string[] = [];
  
  editor.getEditorState().read(() => {
    const root = $getRoot();
    
    function traverse(node: LexicalNode, depth: number = 0) {
      const indent = '  '.repeat(depth);
      
      if ($isListNode(node)) {
        result.push(`${indent}[List: ${node.getListType()}]`);
        node.getChildren().forEach(child => traverse(child, depth + 1));
      } else if ($isListItemNode(node)) {
        const text = node.getTextContent().slice(0, 20);
        result.push(`${indent}[ListItem indent=${node.getIndent()}] "${text}..."`);
        node.getChildren().forEach(child => {
          if ($isListNode(child)) {
            traverse(child, depth + 1);
          }
        });
      } else if ($isElementNode(node)) {
        const type = node.getType();
        const text = node.getTextContent().slice(0, 20);
        result.push(`${indent}[${type}] "${text}..."`);
        node.getChildren().forEach(child => traverse(child, depth + 1));
      }
    }
    
    root.getChildren().forEach(child => traverse(child, 0));
  });
  
  return result;
}

