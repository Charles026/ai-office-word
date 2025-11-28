/**
 * HTML → AST 转换器
 * 
 * 【职责】
 * 将 LibreOffice 输出的 HTML 解析为 DocumentAst。
 * 这是纯函数，不涉及任何 I/O 操作。
 * 
 * 【支持的 HTML 子集（白名单）】
 * 块级：
 * - <p> → ParagraphNode
 * - <h1>~<h6> → HeadingNode
 * - <ul> + <li> → ListNode (ordered: false)
 * - <ol> + <li> → ListNode (ordered: true)
 * 
 * 内联：
 * - 文本节点 → TextRunNode
 * - <strong>, <b> → marks.bold = true
 * - <em>, <i> → marks.italic = true
 * - <u> → marks.underline = true
 * - <s>, <del>, <strike> → marks.strikethrough = true
 * - <code> → marks.code = true
 * - <br> → 换行（保留在文本中）
 * 
 * 【降级策略】
 * - 不认识的块级标签：提取纯文本，转为 ParagraphNode
 * - 不认识的内联标签：递归提取子节点文本
 * - 复杂元素（table/img）：转为 PlaceholderNode，保留原始 HTML
 */

import * as htmlparser2 from 'htmlparser2';
import type { Document, Element, Text, ChildNode } from 'domhandler';
import {
  DocumentAst,
  BlockNode,
  InlineNode,
  TextRunNode,
  ParagraphNode,
  HeadingNode,
  ListNode,
  ListItemNode,
  PlaceholderNode,
  TextMarks,
  createParagraph,
  createTextRun,
  createPlaceholder,
  generateNodeId,
} from '../../document/types';

// ==========================================
// 类型定义
// ==========================================

export interface HtmlToAstResult {
  ast: DocumentAst;
  warnings: string[];
}

interface ParseContext {
  warnings: string[];
  blockIndex: number;
}

// ==========================================
// 主函数
// ==========================================

/**
 * 将 HTML 字符串转换为 DocumentAst
 * 
 * @param html - HTML 字符串（可以是完整文档或片段）
 * @returns { ast, warnings }
 */
export function htmlToAst(html: string): HtmlToAstResult {
  const context: ParseContext = {
    warnings: [],
    blockIndex: 0,
  };

  // 解析 HTML
  const dom = htmlparser2.parseDocument(html);

  // 提取 body 内容（如果有）
  const bodyContent = extractBodyContent(dom);

  // 转换为 AST blocks
  const blocks = parseBlocks(bodyContent, context);

  // 确保至少有一个段落
  if (blocks.length === 0) {
    blocks.push(createParagraph());
  }

  const ast: DocumentAst = {
    version: 0,
    blocks,
    metadata: {
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    },
  };

  return {
    ast,
    warnings: context.warnings,
  };
}

// ==========================================
// DOM 遍历
// ==========================================

/**
 * 提取 body 内容
 */
function extractBodyContent(dom: Document): ChildNode[] {
  // 查找 body 元素
  const body = findElement(dom.children, 'body');
  if (body) {
    return body.children;
  }

  // 查找 html > body
  const html = findElement(dom.children, 'html');
  if (html) {
    const bodyInHtml = findElement(html.children, 'body');
    if (bodyInHtml) {
      return bodyInHtml.children;
    }
  }

  // 没有 body，直接返回所有子节点
  return dom.children;
}

/**
 * 查找指定标签的元素
 */
function findElement(nodes: ChildNode[], tagName: string): Element | null {
  for (const node of nodes) {
    if (isElement(node) && node.name.toLowerCase() === tagName) {
      return node;
    }
  }
  return null;
}

// ==========================================
// 块级解析
// ==========================================

/**
 * 解析块级节点列表
 */
function parseBlocks(nodes: ChildNode[], context: ParseContext): BlockNode[] {
  const blocks: BlockNode[] = [];

  for (const node of nodes) {
    const parsed = parseBlockNode(node, context);
    if (parsed) {
      if (Array.isArray(parsed)) {
        blocks.push(...parsed);
      } else {
        blocks.push(parsed);
      }
    }
    context.blockIndex++;
  }

  return blocks;
}

/**
 * 解析单个块级节点
 */
function parseBlockNode(node: ChildNode, context: ParseContext): BlockNode | BlockNode[] | null {
  // 忽略纯空白文本节点
  if (isText(node)) {
    const text = node.data.trim();
    if (!text) return null;
    
    // 顶层文本节点转为段落
    return {
      id: generateNodeId(),
      type: 'paragraph',
      children: [createTextRun(text)],
    };
  }

  if (!isElement(node)) {
    return null;
  }

  const tagName = node.name.toLowerCase();

  switch (tagName) {
    // 段落
    case 'p':
    case 'div': // div 当作段落处理
      return parseParagraph(node, context);

    // 标题
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return parseHeading(node, parseInt(tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6, context);

    // 无序列表
    case 'ul':
      return parseList(node, false, context);

    // 有序列表
    case 'ol':
      return parseList(node, true, context);

    // 复杂元素 → 占位符
    case 'table':
    case 'figure':
    case 'iframe':
    case 'video':
    case 'audio':
    case 'canvas':
    case 'svg':
      return parsePlaceholder(node, tagName, context);

    // 图片 → 占位符
    case 'img':
      return parsePlaceholder(node, 'image', context);

    // 换行 → 空段落
    case 'br':
      return createParagraph();

    // 水平线 → 占位符
    case 'hr':
      return createPlaceholder('<hr/>', 'horizontal-rule');

    // 块级引用
    case 'blockquote':
      // 简化处理：提取内容作为段落
      context.warnings.push(
        `Blockquote at block #${context.blockIndex}: treated as paragraph`
      );
      return parseParagraph(node, context);

    // 预格式化文本
    case 'pre':
      return parsePreformatted(node, context);

    // 其他未知块级元素
    default:
      // 检查是否可能是内联元素被误放到顶层
      if (isInlineTag(tagName)) {
        // 将内联内容包装为段落
        const children = parseInlineNodes(node.children, context);
        if (children.length > 0) {
          return {
            id: generateNodeId(),
            type: 'paragraph',
            children,
          };
        }
        return null;
      }

      // 未知块级元素：降级为段落
      context.warnings.push(
        `Unsupported block <${tagName}> at block #${context.blockIndex}: downgraded to paragraph`
      );
      return parseParagraph(node, context);
  }
}

/**
 * 解析段落
 */
function parseParagraph(element: Element, context: ParseContext): ParagraphNode {
  const children = parseInlineNodes(element.children, context);
  
  return {
    id: generateNodeId(),
    type: 'paragraph',
    children: children.length > 0 ? children : [],
  };
}

/**
 * 解析标题
 */
function parseHeading(
  element: Element,
  level: 1 | 2 | 3 | 4 | 5 | 6,
  context: ParseContext
): HeadingNode {
  const children = parseInlineNodes(element.children, context);
  
  return {
    id: generateNodeId(),
    type: 'heading',
    level,
    children: children.length > 0 ? children : [],
  };
}

/**
 * 解析列表
 */
function parseList(element: Element, ordered: boolean, context: ParseContext): ListNode {
  const items: ListItemNode[] = [];

  for (const child of element.children) {
    if (isElement(child) && child.name.toLowerCase() === 'li') {
      items.push(parseListItem(child, context));
    }
  }

  return {
    id: generateNodeId(),
    type: 'list',
    ordered,
    items,
  };
}

/**
 * 解析列表项
 */
function parseListItem(element: Element, context: ParseContext): ListItemNode {
  const children = parseInlineNodes(element.children, context);
  
  return {
    id: generateNodeId(),
    type: 'list-item',
    children,
  };
}

/**
 * 解析预格式化文本
 */
function parsePreformatted(element: Element, _context: ParseContext): ParagraphNode {
  // 获取纯文本，保留空白
  const text = getTextContent(element);
  
  return {
    id: generateNodeId(),
    type: 'paragraph',
    children: [createTextRun(text, { code: true })],
  };
}

/**
 * 解析占位符（复杂元素）
 */
function parsePlaceholder(element: Element, label: string, context: ParseContext): PlaceholderNode {
  const rawHtml = getOuterHtml(element);
  
  context.warnings.push(
    `${label} found at block #${context.blockIndex}: represented as placeholder`
  );

  return {
    id: generateNodeId(),
    type: 'placeholder',
    rawHtml,
    label,
  };
}

// ==========================================
// 内联解析
// ==========================================

/**
 * 解析内联节点列表
 */
function parseInlineNodes(nodes: ChildNode[], context: ParseContext, inheritedMarks: TextMarks = {}): InlineNode[] {
  const result: InlineNode[] = [];

  for (const node of nodes) {
    const parsed = parseInlineNode(node, context, inheritedMarks);
    result.push(...parsed);
  }

  // 合并相邻的相同样式文本节点
  return mergeTextRuns(result);
}

/**
 * 解析单个内联节点
 */
function parseInlineNode(node: ChildNode, context: ParseContext, inheritedMarks: TextMarks): InlineNode[] {
  // 文本节点
  if (isText(node)) {
    const text = node.data;
    if (!text) return [];
    
    return [{
      id: generateNodeId(),
      type: 'text',
      text,
      marks: { ...inheritedMarks },
    }];
  }

  if (!isElement(node)) {
    return [];
  }

  const tagName = node.name.toLowerCase();

  // 根据标签确定新的 marks
  const newMarks = { ...inheritedMarks };

  switch (tagName) {
    case 'strong':
    case 'b':
      newMarks.bold = true;
      break;
    case 'em':
    case 'i':
      newMarks.italic = true;
      break;
    case 'u':
      newMarks.underline = true;
      break;
    case 's':
    case 'del':
    case 'strike':
      newMarks.strikethrough = true;
      break;
    case 'code':
      newMarks.code = true;
      break;
    case 'br':
      // 换行转为换行符
      return [{
        id: generateNodeId(),
        type: 'text',
        text: '\n',
        marks: { ...inheritedMarks },
      }];
    case 'span':
      // 检查 style 属性
      Object.assign(newMarks, parseStyleAttribute(node.attribs?.style || ''));
      break;
    case 'a':
      // 链接暂时提取文本
      // TODO: 实现 LinkNode
      break;
  }

  // 递归解析子节点
  return parseInlineNodes(node.children, context, newMarks);
}

/**
 * 解析 style 属性中的样式
 */
function parseStyleAttribute(style: string): TextMarks {
  const marks: TextMarks = {};

  if (/font-weight\s*:\s*(bold|700|800|900)/i.test(style)) {
    marks.bold = true;
  }
  if (/font-style\s*:\s*italic/i.test(style)) {
    marks.italic = true;
  }
  if (/text-decoration[^;]*underline/i.test(style)) {
    marks.underline = true;
  }
  if (/text-decoration[^;]*line-through/i.test(style)) {
    marks.strikethrough = true;
  }

  return marks;
}

/**
 * 合并相邻的相同样式文本节点
 */
function mergeTextRuns(nodes: InlineNode[]): InlineNode[] {
  if (nodes.length === 0) return nodes;

  const result: InlineNode[] = [];
  let current: TextRunNode | null = null;

  for (const node of nodes) {
    if (node.type !== 'text') {
      if (current) {
        result.push(current);
        current = null;
      }
      result.push(node);
      continue;
    }

    if (current && marksEqual(current.marks, node.marks)) {
      // 合并
      current.text += node.text;
    } else {
      if (current) {
        result.push(current);
      }
      current = { ...node };
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}

/**
 * 比较两个 marks 是否相等
 */
function marksEqual(a: TextMarks, b: TextMarks): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strikethrough === !!b.strikethrough &&
    !!a.code === !!b.code
  );
}

// ==========================================
// 工具函数
// ==========================================

/**
 * 判断是否为 Element 节点
 */
function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

/**
 * 判断是否为 Text 节点
 */
function isText(node: ChildNode): node is Text {
  return node.type === 'text';
}

/**
 * 判断是否为内联标签
 */
function isInlineTag(tagName: string): boolean {
  const inlineTags = [
    'a', 'abbr', 'b', 'bdo', 'br', 'cite', 'code', 'dfn', 'em', 'i',
    'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub',
    'sup', 'time', 'u', 'var', 'del', 'ins', 'strike'
  ];
  return inlineTags.includes(tagName.toLowerCase());
}

/**
 * 获取元素的纯文本内容
 */
function getTextContent(element: Element): string {
  let text = '';
  for (const child of element.children) {
    if (isText(child)) {
      text += child.data;
    } else if (isElement(child)) {
      if (child.name.toLowerCase() === 'br') {
        text += '\n';
      } else {
        text += getTextContent(child);
      }
    }
  }
  return text;
}

/**
 * 获取元素的外部 HTML
 */
function getOuterHtml(element: Element): string {
  // 简单实现：使用 htmlparser2 的 render 功能
  const { render } = require('dom-serializer');
  return render(element);
}

