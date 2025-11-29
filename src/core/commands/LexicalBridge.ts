/**
 * Lexical Bridge - Lexical 与 DocumentRuntime 的桥接层
 * 
 * 【职责】
 * - 从 Lexical 选区转换为 DocSelection
 * - 从 Lexical 状态同步到 DocumentRuntime
 * - 提供命令执行的桥接方法
 * 
 * 【设计原则】
 * - 这是迁移期的过渡层
 * - 最终目标是让 Lexical 完全受 DocumentRuntime 驱动
 */

import { LexicalEditor, $getSelection, $isRangeSelection, $getRoot, $isTextNode, $isElementNode, TextNode, ElementNode } from 'lexical';
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { DocSelection, createCollapsedSelection, createRangeSelection } from '../../document/selection';
import { DocumentAst, createEmptyDocument, createParagraph, createHeading, createTextRun, BlockNode, InlineNode, TextMarks, generateNodeId } from '../../document/types';
import { documentRuntime, DocumentRuntime } from '../../document/DocumentRuntime';

// ==========================================
// Lexical Selection → DocSelection
// ==========================================

/**
 * 从 Lexical 选区转换为 DocSelection
 * 
 * 注意：这需要在 editor.getEditorState().read() 或 editor.update() 内部调用
 * 
 * @param editor - Lexical 编辑器实例
 * @param blockIdMap - Lexical key 到 block ID 的映射
 * @returns DocSelection 或 null
 */
export function lexicalSelectionToDocSelection(
  _editor: LexicalEditor,
  blockIdMap: Map<string, string>
): DocSelection | null {
  const selection = $getSelection();
  
  if (!$isRangeSelection(selection)) {
    return null;
  }

  const anchor = selection.anchor;
  const focus = selection.focus;

  // 获取 anchor 所在的顶级块
  let anchorNode = anchor.getNode();
  while (anchorNode && anchorNode.getParent() !== $getRoot()) {
    anchorNode = anchorNode.getParent()!;
  }

  // 获取 focus 所在的顶级块
  let focusNode = focus.getNode();
  while (focusNode && focusNode.getParent() !== $getRoot()) {
    focusNode = focusNode.getParent()!;
  }

  if (!anchorNode || !focusNode) {
    return null;
  }

  const anchorBlockId = blockIdMap.get(anchorNode.getKey());
  const focusBlockId = blockIdMap.get(focusNode.getKey());

  if (!anchorBlockId || !focusBlockId) {
    console.warn('[LexicalBridge] Block ID not found for selection');
    return null;
  }

  if (selection.isCollapsed()) {
    return createCollapsedSelection(anchorBlockId, anchor.offset);
  }

  return createRangeSelection(
    anchorBlockId,
    anchor.offset,
    focusBlockId,
    focus.offset
  );
}

// ==========================================
// Lexical State → DocumentAst
// ==========================================

/**
 * 从 Lexical 状态构建 DocumentAst
 * 
 * 注意：这需要在 editor.getEditorState().read() 或 editor.update() 内部调用
 * 
 * 🔴 重要：只处理 root 的直接子节点（top-level elements），
 *    不会把 TextNode 或其他内联节点当作 block
 * 
 * @returns DocumentAst 和 key 映射
 */
export function lexicalStateToAst(): { ast: DocumentAst; keyToIdMap: Map<string, string> } {
  const root = $getRoot();
  const children = root.getChildren();
  
  const blocks: BlockNode[] = [];
  const keyToIdMap = new Map<string, string>();

  for (const child of children) {
    // 🔴 只处理 ElementNode（Paragraph/Heading/List 等），跳过 TextNode 和其他非顶层节点
    if (!$isElementNode(child)) {
      console.warn('[LexicalBridge] Skipping non-element node:', child.getType());
      continue;
    }
    
    const block = lexicalNodeToBlock(child as ElementNode);
    if (block) {
      blocks.push(block);
      keyToIdMap.set(child.getKey(), block.id);
    }
  }

  // 🔴 空文档保护：确保至少有一个空段落
  if (blocks.length === 0) {
    const emptyParagraph = createParagraph('');
    blocks.push(emptyParagraph);
    // 注意：这种情况下没有对应的 Lexical key，keyToIdMap 不会有这个 block 的映射
  }

  const ast: DocumentAst = {
    ...createEmptyDocument(),
    blocks,
  };

  return { ast, keyToIdMap };
}

/**
 * 从 Lexical 节点创建 BlockNode
 * 
 * 🔴 重要：
 * 1. 只接受 ElementNode（Paragraph/Heading/List），不接受 TextNode
 * 2. 必须保留每个 TextNode 的 inline marks（bold/italic/underline 等）
 */
function lexicalNodeToBlock(node: ElementNode): BlockNode | null {
  // 🔴 防御式编程：确保是 ElementNode
  if (!$isElementNode(node)) {
    console.warn('[LexicalBridge] lexicalNodeToBlock called with non-element node:', node.getType());
    return null;
  }

  const key = node.getKey();

  // 提取子节点的 inline marks
  const children = extractInlineNodesFromLexical(node);

  if ($isHeadingNode(node)) {
    const headingNode = node as HeadingNode;
    const tag = headingNode.getTag();
    const level = parseInt(tag.replace('h', ''), 10) as 1 | 2 | 3 | 4 | 5 | 6;
    
    return {
      id: `lexical-${key}`,
      type: 'heading',
      level,
      children,
    };
  }

  // 默认为段落
  return {
    id: `lexical-${key}`,
    type: 'paragraph',
    children,
  };
}

/**
 * 从 Lexical 元素节点提取 InlineNode 数组，保留 marks
 */
function extractInlineNodesFromLexical(elementNode: any): InlineNode[] {
  const result: InlineNode[] = [];
  
  // 获取所有子节点
  const children = elementNode.getChildren ? elementNode.getChildren() : [];
  
  for (const child of children) {
    if ($isTextNode(child)) {
      const textNode = child as TextNode;
      const text = textNode.getTextContent();
      
      if (text) {
        // 从 Lexical TextNode 提取 marks
        const marks = extractMarksFromLexicalTextNode(textNode);
        
        result.push({
          id: generateNodeId(),
          type: 'text',
          text,
          marks,
        });
      }
    } else {
      // 对于非文本节点（如 LineBreakNode），暂时用纯文本处理
      const textContent = child.getTextContent ? child.getTextContent() : '';
      if (textContent) {
        result.push({
          id: generateNodeId(),
          type: 'text',
          text: textContent,
          marks: {},
        });
      }
    }
  }
  
  // 如果没有任何子节点，创建一个空的文本节点
  if (result.length === 0) {
    result.push({
      id: generateNodeId(),
      type: 'text',
      text: '',
      marks: {},
    });
  }
  
  return result;
}

/**
 * 从 Lexical TextNode 提取 marks
 */
function extractMarksFromLexicalTextNode(textNode: TextNode): TextMarks {
  const format = textNode.getFormat();
  
  return {
    bold: (format & 1) !== 0,           // IS_BOLD = 1
    italic: (format & 2) !== 0,         // IS_ITALIC = 2
    underline: (format & 8) !== 0,      // IS_UNDERLINE = 8
    strikethrough: (format & 4) !== 0,  // IS_STRIKETHROUGH = 4
    code: (format & 16) !== 0,          // IS_CODE = 16
  };
}

// ==========================================
// 同步 Lexical 到 Runtime
// ==========================================

export interface SyncOptions {
  /**
   * 是否保留历史记录
   * 
   * - false（默认）: 调用 runtime.reset()，清空历史
   * - true: 只更新 AST 和选区，保留历史
   */
  preserveHistory?: boolean;
}

/**
 * 将当前 Lexical 状态同步到 DocumentRuntime
 * 
 * 用于初始化或需要从 Lexical 恢复状态时
 * 
 * @param editor - Lexical 编辑器实例
 * @param runtime - DocumentRuntime 实例
 * @param options - 同步选项
 */
export function syncLexicalToRuntime(
  editor: LexicalEditor,
  runtime: DocumentRuntime = documentRuntime,
  options: SyncOptions = {}
): void {
  const { preserveHistory = false } = options;
  
  editor.getEditorState().read(() => {
    const { ast, keyToIdMap } = lexicalStateToAst();
    const selection = lexicalSelectionToDocSelection(editor, keyToIdMap);
    
    if (preserveHistory) {
      // 只更新选区，不修改 AST 和历史
      // 注意：这假设 AST 已经是同步的
      if (selection) {
        runtime.setSelection(selection);
      }
    } else {
      // 完全重置（会清空历史）
      runtime.reset(ast);
      if (selection) {
        runtime.setSelection(selection);
      }
    }
  });
}

// ==========================================
// 命令执行桥接
// ==========================================

/**
 * 通过 CommandBus 执行命令并同步结果到 Lexical
 * 
 * @param editor - Lexical 编辑器实例
 * @param commandId - 命令 ID
 * @param payload - 命令参数
 * @param runtime - DocumentRuntime 实例
 * @returns 是否执行成功
 */
export function executeCommandViaRuntime(
  editor: LexicalEditor,
  commandId: string,
  payload?: any,
  runtime: DocumentRuntime = documentRuntime
): boolean {
  // 在执行前，先从 Lexical 同步当前选区到 runtime
  editor.getEditorState().read(() => {
    const { keyToIdMap } = lexicalStateToAst();
    const selection = lexicalSelectionToDocSelection(editor, keyToIdMap);
    if (selection) {
      runtime.setSelection(selection);
    }
  });

  // 通过 CommandBus 执行命令
  const { commandBus } = require('./CommandBus');
  const result = commandBus.executeWithRuntime(commandId, payload);

  if (result.success) {
    // 将结果同步回 Lexical
    const { reconcileAstToLexical } = require('./LexicalReconciler');
    reconcileAstToLexical(editor, result.nextAst, {
      selection: result.nextSelection,
    });
    
    return true;
  }

  return false;
}

// ==========================================
// Block ID 映射管理
// ==========================================

/**
 * 维护 Lexical key 到 DocumentAst block ID 的映射
 * 
 * 这个映射在以下情况需要更新：
 * 1. 从 HTML/docx 加载文档时
 * 2. DocumentRuntime 应用 DocOps 后
 * 3. 新建/删除 block 时
 */
export class BlockIdMapper {
  private keyToId = new Map<string, string>();
  private idToKey = new Map<string, string>();

  /**
   * 设置映射
   */
  set(lexicalKey: string, blockId: string): void {
    this.keyToId.set(lexicalKey, blockId);
    this.idToKey.set(blockId, lexicalKey);
  }

  /**
   * 通过 Lexical key 获取 block ID
   */
  getBlockId(lexicalKey: string): string | undefined {
    return this.keyToId.get(lexicalKey);
  }

  /**
   * 通过 block ID 获取 Lexical key
   */
  getLexicalKey(blockId: string): string | undefined {
    return this.idToKey.get(blockId);
  }

  /**
   * 清空映射
   */
  clear(): void {
    this.keyToId.clear();
    this.idToKey.clear();
  }

  /**
   * 从 Lexical 状态重建映射
   */
  rebuildFromLexical(editor: LexicalEditor, ast: DocumentAst): void {
    this.clear();
    
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      
      // 假设 Lexical 节点顺序与 AST blocks 顺序一致
      for (let i = 0; i < Math.min(children.length, ast.blocks.length); i++) {
        this.set(children[i].getKey(), ast.blocks[i].id);
      }
    });
  }
}

// 全局映射实例
export const blockIdMapper = new BlockIdMapper();

