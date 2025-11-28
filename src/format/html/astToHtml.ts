/**
 * AST → HTML 转换器
 * 
 * 【职责】
 * 将 DocumentAst 序列化为 HTML 字符串。
 * 生成的 HTML 用于 LibreOffice CLI 转换为 docx。
 * 这是纯函数，不涉及任何 I/O 操作。
 * 
 * 【HTML 结构】
 * 生成完整的 HTML 文档结构：
 * <html>
 *   <head><meta charset="utf-8"></head>
 *   <body>...blocks...</body>
 * </html>
 * 
 * LibreOffice CLI 需要完整的 HTML 文档才能正确转换。
 * 
 * 【块级映射】
 * - ParagraphNode → <p>
 * - HeadingNode → <h1>~<h6>
 * - ListNode → <ul>/<ol> + <li>
 * - PlaceholderNode → 原样输出 rawHtml
 * 
 * 【内联映射】
 * - TextRunNode → 根据 marks 包裹 <strong>/<em>/<u> 等
 */

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
} from '../../document/types';

// ==========================================
// 选项
// ==========================================

export interface AstToHtmlOptions {
  /** 是否生成完整的 HTML 文档（包含 html/head/body） */
  fullDocument?: boolean;
  /** 文档标题 */
  title?: string;
  /** 是否添加基础样式 */
  includeBaseStyles?: boolean;
}

const DEFAULT_OPTIONS: AstToHtmlOptions = {
  fullDocument: true,
  includeBaseStyles: false,
};

// ==========================================
// 主函数
// ==========================================

/**
 * 将 DocumentAst 转换为 HTML 字符串
 * 
 * @param ast - 文档 AST
 * @param options - 转换选项
 * @returns HTML 字符串
 */
export function astToHtml(ast: DocumentAst, options: AstToHtmlOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // 渲染所有块级节点
  const bodyContent = ast.blocks.map(block => renderBlock(block)).join('\n');

  if (!opts.fullDocument) {
    return bodyContent;
  }

  // 生成完整 HTML 文档
  const title = opts.title || ast.metadata.title || 'Document';
  const styles = opts.includeBaseStyles ? getBaseStyles() : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${styles}
</head>
<body>
${bodyContent}
</body>
</html>`;
}

// ==========================================
// 块级渲染
// ==========================================

/**
 * 渲染块级节点
 */
function renderBlock(block: BlockNode): string {
  switch (block.type) {
    case 'paragraph':
      return renderParagraph(block);
    case 'heading':
      return renderHeading(block);
    case 'list':
      return renderList(block);
    case 'placeholder':
      return renderPlaceholder(block);
    default:
      // 类型安全：处理未知类型
      console.warn('[astToHtml] Unknown block type:', (block as any).type);
      return '';
  }
}

/**
 * 渲染段落
 */
function renderParagraph(node: ParagraphNode): string {
  const content = renderInlineNodes(node.children);
  // 空段落输出 &nbsp; 保持结构
  return `<p>${content || '&nbsp;'}</p>`;
}

/**
 * 渲染标题
 */
function renderHeading(node: HeadingNode): string {
  const content = renderInlineNodes(node.children);
  return `<h${node.level}>${content || '&nbsp;'}</h${node.level}>`;
}

/**
 * 渲染列表
 */
function renderList(node: ListNode): string {
  const tag = node.ordered ? 'ol' : 'ul';
  const items = node.items.map(item => renderListItem(item)).join('\n');
  return `<${tag}>\n${items}\n</${tag}>`;
}

/**
 * 渲染列表项
 */
function renderListItem(node: ListItemNode): string {
  const content = renderInlineNodes(node.children);
  return `<li>${content || '&nbsp;'}</li>`;
}

/**
 * 渲染占位符
 * 
 * 策略：原样输出 rawHtml 以保留复杂结构
 * 这样在 docx → AST → HTML → docx 的往返中不会丢失内容
 */
function renderPlaceholder(node: PlaceholderNode): string {
  // 如果 rawHtml 为空或只是注释，输出可见提示
  if (!node.rawHtml || node.rawHtml.trim().startsWith('<!--')) {
    return `<p>[Unsupported: ${escapeHtml(node.label)}]</p>`;
  }
  
  // 原样输出，保留结构
  return node.rawHtml;
}

// ==========================================
// 内联渲染
// ==========================================

/**
 * 渲染内联节点列表
 */
function renderInlineNodes(nodes: InlineNode[]): string {
  return nodes.map(node => renderInlineNode(node)).join('');
}

/**
 * 渲染单个内联节点
 */
function renderInlineNode(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return renderTextRun(node);
    case 'link':
      // TODO: 实现链接渲染
      return node.children.map(child => renderTextRun(child)).join('');
    default:
      return '';
  }
}

/**
 * 渲染文本运行
 * 
 * 根据 marks 包裹对应的 HTML 标签
 * 标签嵌套顺序：code > strikethrough > underline > italic > bold
 */
function renderTextRun(node: TextRunNode): string {
  let html = escapeHtml(node.text);

  // 空文本不需要包裹
  if (!html) return '';

  const { marks } = node;

  // 处理换行
  html = html.replace(/\n/g, '<br>');

  // 按顺序包裹标签（从内到外）
  if (marks.code) {
    html = `<code>${html}</code>`;
  }
  if (marks.strikethrough) {
    html = `<s>${html}</s>`;
  }
  if (marks.underline) {
    html = `<u>${html}</u>`;
  }
  if (marks.italic) {
    html = `<em>${html}</em>`;
  }
  if (marks.bold) {
    html = `<strong>${html}</strong>`;
  }

  return html;
}

// ==========================================
// 工具函数
// ==========================================

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 基础样式（可选）
 */
function getBaseStyles(): string {
  return `<style>
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12pt;
  line-height: 1.5;
  color: #000;
}
h1 { font-size: 24pt; margin: 12pt 0; }
h2 { font-size: 18pt; margin: 10pt 0; }
h3 { font-size: 14pt; margin: 8pt 0; }
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0; padding-left: 24pt; }
li { margin: 3pt 0; }
code { font-family: monospace; background: #f0f0f0; padding: 1pt 3pt; }
</style>`;
}

