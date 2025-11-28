/**
 * Document AST 类型定义
 * 
 * 【层级职责】
 * Document AST 层是文档的 Source of Truth：
 * - 维护结构化的文档模型
 * - 提供 AST 的不可变更新操作
 * - 管理版本和历史
 * 
 * 【禁止事项】
 * - 不允许在 React 组件中直接修改 AST 字段
 * - 所有修改必须通过 DocumentEngine.applyOps()
 * - 不允许在此层处理文件 I/O 或格式转换
 * 
 * 【设计说明】
 * AST 是语义化的文档模型，不包含 HTML 细节。
 * HTML 只是 Import/Export 的中间格式。
 */

import { DocNodeId } from '../docops/types';

// ==========================================
// 基础类型
// ==========================================

/**
 * 生成唯一节点 ID
 */
export function generateNodeId(): DocNodeId {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ==========================================
// 文本样式（Marks）
// ==========================================

/**
 * 文本标记（内联样式）
 */
export interface TextMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}

/**
 * 默认文本标记
 */
export const DEFAULT_MARKS: TextMarks = {};

// ==========================================
// 内联节点（InlineNode）
// ==========================================

/**
 * 文本运行节点
 */
export interface TextRunNode {
  id: DocNodeId;
  type: 'text';
  text: string;
  marks: TextMarks;
}

/**
 * 链接节点（预留）
 */
export interface LinkNode {
  id: DocNodeId;
  type: 'link';
  href: string;
  children: TextRunNode[];
}

/**
 * 内联节点联合类型
 */
export type InlineNode = TextRunNode | LinkNode;

// ==========================================
// 块级节点（BlockNode）
// ==========================================

/**
 * 段落节点
 */
export interface ParagraphNode {
  id: DocNodeId;
  type: 'paragraph';
  children: InlineNode[];
}

/**
 * 标题节点
 */
export interface HeadingNode {
  id: DocNodeId;
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineNode[];
}

/**
 * 列表项节点
 */
export interface ListItemNode {
  id: DocNodeId;
  type: 'list-item';
  children: InlineNode[];
}

/**
 * 列表节点
 */
export interface ListNode {
  id: DocNodeId;
  type: 'list';
  ordered: boolean;
  items: ListItemNode[];
}

/**
 * 占位符节点（用于不支持的复杂元素）
 * 
 * 策略：保留原始 HTML 以便往返时不丢失内容
 */
export interface PlaceholderNode {
  id: DocNodeId;
  type: 'placeholder';
  /** 原始 HTML 片段 */
  rawHtml: string;
  /** 人类可读的标签（如 "table", "image"） */
  label: string;
}

/**
 * 块级节点联合类型
 */
export type BlockNode = 
  | ParagraphNode 
  | HeadingNode 
  | ListNode
  | PlaceholderNode;

// ==========================================
// 文档 AST
// ==========================================

/**
 * 文档元数据
 */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  createdAt?: number;
  modifiedAt?: number;
}

/**
 * 文档 AST 结构
 * 
 * 这是整个文档的 Source of Truth
 */
export interface DocumentAst {
  /** 文档版本号（每次修改自增） */
  version: number;
  /** 块级节点列表 */
  blocks: BlockNode[];
  /** 文档元数据 */
  metadata: DocumentMetadata;
}

// ==========================================
// 工厂函数
// ==========================================

/**
 * 创建文本节点
 */
export function createTextRun(text: string = '', marks: TextMarks = {}): TextRunNode {
  return {
    id: generateNodeId(),
    type: 'text',
    text,
    marks,
  };
}

/**
 * 创建段落节点
 */
export function createParagraph(text: string = ''): ParagraphNode {
  return {
    id: generateNodeId(),
    type: 'paragraph',
    children: text ? [createTextRun(text)] : [],
  };
}

/**
 * 创建标题节点
 */
export function createHeading(level: HeadingNode['level'], text: string = ''): HeadingNode {
  return {
    id: generateNodeId(),
    type: 'heading',
    level,
    children: text ? [createTextRun(text)] : [],
  };
}

/**
 * 创建列表节点
 */
export function createList(ordered: boolean, items: string[] = []): ListNode {
  return {
    id: generateNodeId(),
    type: 'list',
    ordered,
    items: items.map(text => createListItem(text)),
  };
}

/**
 * 创建列表项节点
 */
export function createListItem(text: string = ''): ListItemNode {
  return {
    id: generateNodeId(),
    type: 'list-item',
    children: text ? [createTextRun(text)] : [],
  };
}

/**
 * 创建占位符节点
 */
export function createPlaceholder(rawHtml: string, label: string): PlaceholderNode {
  return {
    id: generateNodeId(),
    type: 'placeholder',
    rawHtml,
    label,
  };
}

/**
 * 创建空文档
 */
export function createEmptyDocument(): DocumentAst {
  return {
    version: 0,
    blocks: [createParagraph()],
    metadata: {
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    },
  };
}

// ==========================================
// 工具函数
// ==========================================

/**
 * 获取块节点的纯文本内容
 */
export function getBlockText(node: BlockNode): string {
  if (node.type === 'placeholder') {
    return `[${node.label}]`;
  }
  if (node.type === 'list') {
    return node.items.map(item => getInlineText(item.children)).join('\n');
  }
  return getInlineText(node.children);
}

/**
 * 获取内联节点的纯文本
 */
export function getInlineText(nodes: InlineNode[]): string {
  return nodes.map(node => {
    if (node.type === 'text') return node.text;
    if (node.type === 'link') return getInlineText(node.children);
    return '';
  }).join('');
}

/**
 * 在 AST 中查找块节点
 */
export function findBlockById(ast: DocumentAst, nodeId: DocNodeId): BlockNode | null {
  return ast.blocks.find(block => block.id === nodeId) ?? null;
}

/**
 * 获取块节点索引
 */
export function getBlockIndex(ast: DocumentAst, nodeId: DocNodeId): number {
  return ast.blocks.findIndex(block => block.id === nodeId);
}

/**
 * 判断节点是否有内联子节点
 */
export function hasInlineChildren(node: BlockNode): node is ParagraphNode | HeadingNode {
  return node.type === 'paragraph' || node.type === 'heading';
}

// ==========================================
// 类型守卫
// ==========================================

export function isParagraph(node: BlockNode): node is ParagraphNode {
  return node.type === 'paragraph';
}

export function isHeading(node: BlockNode): node is HeadingNode {
  return node.type === 'heading';
}

export function isList(node: BlockNode): node is ListNode {
  return node.type === 'list';
}

export function isPlaceholder(node: BlockNode): node is PlaceholderNode {
  return node.type === 'placeholder';
}

export function isTextRun(node: InlineNode): node is TextRunNode {
  return node.type === 'text';
}

// ==========================================
// 选区工具函数
// ==========================================

import { DocSelection } from '../docops/types';

/**
 * 从 AST 和选区中提取选中的文本
 * 
 * 【策略】
 * - 同一 block 内：直接截取文本
 * - 跨 block：串联各 block 文本，中间加换行
 * 
 * @param ast - 文档 AST
 * @param selection - 选区
 * @returns 选中的纯文本
 */
export function getTextInSelection(ast: DocumentAst, selection: DocSelection): string {
  if (selection.isCollapsed) {
    return '';
  }

  const startBlockIndex = getBlockIndex(ast, selection.anchorNodeId);
  const endBlockIndex = getBlockIndex(ast, selection.focusNodeId);

  if (startBlockIndex === -1 || endBlockIndex === -1) {
    console.warn('[getTextInSelection] Block not found');
    return '';
  }

  // 确保 start <= end
  const [fromIndex, toIndex] = startBlockIndex <= endBlockIndex 
    ? [startBlockIndex, endBlockIndex]
    : [endBlockIndex, startBlockIndex];
  const [fromOffset, toOffset] = startBlockIndex <= endBlockIndex
    ? [selection.anchorOffset, selection.focusOffset]
    : [selection.focusOffset, selection.anchorOffset];

  // 同一 block 内选区
  if (fromIndex === toIndex) {
    const block = ast.blocks[fromIndex];
    const blockText = getBlockText(block);
    const start = Math.min(fromOffset, toOffset);
    const end = Math.max(fromOffset, toOffset);
    return blockText.slice(start, end);
  }

  // 跨 block 选区
  const parts: string[] = [];

  for (let i = fromIndex; i <= toIndex; i++) {
    const block = ast.blocks[i];
    const blockText = getBlockText(block);

    if (i === fromIndex) {
      // 起始 block：从 offset 到末尾
      parts.push(blockText.slice(fromOffset));
    } else if (i === toIndex) {
      // 结束 block：从开头到 offset
      parts.push(blockText.slice(0, toOffset));
    } else {
      // 中间 block：全部文本
      parts.push(blockText);
    }
  }

  return parts.join('\n');
}

/**
 * 判断选区是否有效（非空选区）
 */
export function isValidSelection(selection: DocSelection | null): boolean {
  if (!selection) return false;
  if (selection.isCollapsed) return false;
  return true;
}

/**
 * 判断选区是否在同一 block 内
 */
export function isSameBlockSelection(selection: DocSelection): boolean {
  return selection.anchorNodeId === selection.focusNodeId;
}
