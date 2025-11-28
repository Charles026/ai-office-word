/**
 * DocumentEngine - AST 更新器
 * 
 * 【层级职责】
 * 这是文档操作的核心引擎，所有对文档的修改都必须通过此模块：
 * - 接收 DocOp[] 并应用到 AST
 * - 维护版本号和历史记录
 * - 提供 undo/redo 能力
 * 
 * 【禁止事项】
 * - 不允许在此层处理 UI 逻辑
 * - 不允许在此层调用文件系统或 AI
 * - 不允许绕过此模块直接修改 AST
 * 
 * 【设计原则】
 * - 所有操作都是不可变的（返回新 AST，不修改原对象）
 * - 操作必须是可逆的（用于 undo/redo）
 * - 操作必须是确定性的（相同输入 → 相同输出）
 */

import {
  DocOp,
  InsertParagraphOp,
  InsertTextOp,
  DeleteRangeOp,
  ToggleBoldOp,
  ToggleItalicOp,
  ToggleUnderlineOp,
  ToggleStrikeOp,
  DeleteNodeOp,
  SetHeadingLevelOp,
  SplitBlockOp,
  InsertLineBreakOp,
} from '../docops/types';

import {
  DocumentAst,
  ParagraphNode,
  HeadingNode,
  InlineNode,
  createParagraph,
  createTextRun,
  createEmptyDocument,
  findBlockById,
  getBlockIndex,
  getInlineText,
  hasInlineChildren,
} from './types';

// ==========================================
// 操作结果类型
// ==========================================

export interface ApplyOpsResult {
  nextAst: DocumentAst;
  changed: boolean;
  inverseOps?: DocOp[];
}

// ==========================================
// 历史记录
// ==========================================

interface HistoryEntry {
  ast: DocumentAst;
  ops: DocOp[];
  timestamp: number;
}

export class HistoryManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistory = 100;

  push(ast: DocumentAst, ops: DocOp[]): void {
    this.undoStack.push({
      ast: this.cloneAst(ast),
      ops,
      timestamp: Date.now(),
    });

    this.redoStack = [];

    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
  }

  undo(currentAst: DocumentAst): DocumentAst | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    this.redoStack.push({
      ast: this.cloneAst(currentAst),
      ops: entry.ops,
      timestamp: Date.now(),
    });

    return entry.ast;
  }

  redo(currentAst: DocumentAst): DocumentAst | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    this.undoStack.push({
      ast: this.cloneAst(currentAst),
      ops: entry.ops,
      timestamp: Date.now(),
    });

    return entry.ast;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private cloneAst(ast: DocumentAst): DocumentAst {
    return JSON.parse(JSON.stringify(ast));
  }
}

// ==========================================
// DocumentEngine 实现
// ==========================================

export class DocumentEngine {
  private history: HistoryManager;

  constructor() {
    this.history = new HistoryManager();
  }

  createEmptyDocument(): DocumentAst {
    return createEmptyDocument();
  }

  applyOp(ast: DocumentAst, op: DocOp): ApplyOpsResult {
    return this.applyOps(ast, [op]);
  }

  applyOps(ast: DocumentAst, ops: DocOp[]): ApplyOpsResult {
    if (ops.length === 0) {
      return { nextAst: ast, changed: false };
    }

    this.history.push(ast, ops);

    let nextAst: DocumentAst = JSON.parse(JSON.stringify(ast));
    let changed = false;

    for (const op of ops) {
      const result = this.applySingleOp(nextAst, op);
      if (result.changed) {
        nextAst = result.nextAst;
        changed = true;
      }
    }

    if (changed) {
      nextAst.version += 1;
      nextAst.metadata.modifiedAt = Date.now();
    }

    return { nextAst, changed };
  }

  private applySingleOp(ast: DocumentAst, op: DocOp): ApplyOpsResult {
    switch (op.type) {
      case 'InsertParagraph':
        return this.handleInsertParagraph(ast, op);
      case 'InsertText':
        return this.handleInsertText(ast, op);
      case 'DeleteRange':
        return this.handleDeleteRange(ast, op);
      case 'ToggleBold':
        return this.handleToggleBold(ast, op);
      case 'ToggleItalic':
        return this.handleToggleItalic(ast, op);
      case 'ToggleUnderline':
        return this.handleToggleUnderline(ast, op);
      case 'ToggleStrike':
        return this.handleToggleStrike(ast, op);
      case 'DeleteNode':
        return this.handleDeleteNode(ast, op);
      case 'SetHeadingLevel':
        return this.handleSetHeadingLevel(ast, op);
      case 'SplitBlock':
        return this.handleSplitBlock(ast, op);
      case 'InsertLineBreak':
        return this.handleInsertLineBreak(ast, op);
      case 'Custom':
        console.warn('[DocumentEngine] Custom op not implemented:', op.payload.customType);
        return { nextAst: ast, changed: false };
      default:
        console.warn('[DocumentEngine] Unknown op type:', (op as any).type);
        return { nextAst: ast, changed: false };
    }
  }

  // ==========================================
  // 操作处理器
  // ==========================================

  private handleInsertParagraph(ast: DocumentAst, op: InsertParagraphOp): ApplyOpsResult {
    const { afterNodeId, text } = op.payload;
    const newParagraph = createParagraph(text ?? '');

    if (afterNodeId === null) {
      ast.blocks.unshift(newParagraph);
    } else {
      const index = getBlockIndex(ast, afterNodeId);
      if (index >= 0) {
        ast.blocks.splice(index + 1, 0, newParagraph);
      } else {
        ast.blocks.push(newParagraph);
      }
    }

    return { nextAst: ast, changed: true };
  }

  private handleInsertText(ast: DocumentAst, op: InsertTextOp): ApplyOpsResult {
    const { nodeId, offset, text } = op.payload;
    
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      return { nextAst: ast, changed: false };
    }

    let fullText = getInlineText(block.children);
    const newText = fullText.slice(0, offset) + text + fullText.slice(offset);

    if (block.children.length === 0) {
      block.children = [createTextRun(newText)];
    } else {
      const firstRun = block.children[0];
      if (firstRun.type === 'text') {
        block.children = [{ ...firstRun, text: newText }];
      }
    }

    return { nextAst: ast, changed: true };
  }

  private handleDeleteRange(ast: DocumentAst, op: DeleteRangeOp): ApplyOpsResult {
    const { startNodeId, startOffset, endNodeId, endOffset } = op.payload;

    if (startNodeId === endNodeId) {
      const block = findBlockById(ast, startNodeId);
      if (!block || !hasInlineChildren(block)) {
        return { nextAst: ast, changed: false };
      }

      let fullText = getInlineText(block.children);
      const newText = fullText.slice(0, startOffset) + fullText.slice(endOffset);

      if (block.children.length > 0) {
        const firstRun = block.children[0];
        if (firstRun.type === 'text') {
          block.children = [{ ...firstRun, text: newText }];
        }
      }

      return { nextAst: ast, changed: true };
    }

    const startIndex = getBlockIndex(ast, startNodeId);
    const endIndex = getBlockIndex(ast, endNodeId);

    if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
      return { nextAst: ast, changed: false };
    }

    const startBlock = ast.blocks[startIndex];
    const endBlock = ast.blocks[endIndex];

    if (!hasInlineChildren(startBlock) || !hasInlineChildren(endBlock)) {
      return { nextAst: ast, changed: false };
    }

    const startText = getInlineText(startBlock.children).slice(0, startOffset);
    const endText = getInlineText(endBlock.children).slice(endOffset);

    if (startBlock.children.length > 0) {
      const firstRun = startBlock.children[0];
      if (firstRun.type === 'text') {
        startBlock.children = [{ ...firstRun, text: startText + endText }];
      }
    }

    ast.blocks.splice(startIndex + 1, endIndex - startIndex);

    return { nextAst: ast, changed: true };
  }

  private handleToggleBold(ast: DocumentAst, op: ToggleBoldOp): ApplyOpsResult {
    const { nodeId, force } = op.payload;
    
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      return { nextAst: ast, changed: false };
    }

    const currentBold = block.children[0]?.type === 'text' ? block.children[0].marks?.bold : false;
    const newBold = force !== undefined ? force : !currentBold;

    block.children = block.children.map(node => {
      if (node.type === 'text') {
        return {
          ...node,
          marks: { ...node.marks, bold: newBold },
        };
      }
      return node;
    });

    return { nextAst: ast, changed: true };
  }

  private handleToggleItalic(ast: DocumentAst, op: ToggleItalicOp): ApplyOpsResult {
    const { nodeId, force } = op.payload;
    
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      return { nextAst: ast, changed: false };
    }

    const currentItalic = block.children[0]?.type === 'text' ? block.children[0].marks?.italic : false;
    const newItalic = force !== undefined ? force : !currentItalic;

    block.children = block.children.map(node => {
      if (node.type === 'text') {
        return {
          ...node,
          marks: { ...node.marks, italic: newItalic },
        };
      }
      return node;
    });

    return { nextAst: ast, changed: true };
  }

  private handleToggleUnderline(ast: DocumentAst, op: ToggleUnderlineOp): ApplyOpsResult {
    const { nodeId, force } = op.payload;
    
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      return { nextAst: ast, changed: false };
    }

    const currentUnderline = block.children[0]?.type === 'text' ? block.children[0].marks?.underline : false;
    const newUnderline = force !== undefined ? force : !currentUnderline;

    block.children = block.children.map(node => {
      if (node.type === 'text') {
        return {
          ...node,
          marks: { ...node.marks, underline: newUnderline },
        };
      }
      return node;
    });

    return { nextAst: ast, changed: true };
  }

  private handleToggleStrike(ast: DocumentAst, op: ToggleStrikeOp): ApplyOpsResult {
    const { nodeId, force } = op.payload;
    
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      return { nextAst: ast, changed: false };
    }

    const currentStrike = block.children[0]?.type === 'text' ? block.children[0].marks?.strikethrough : false;
    const newStrike = force !== undefined ? force : !currentStrike;

    block.children = block.children.map(node => {
      if (node.type === 'text') {
        return {
          ...node,
          marks: { ...node.marks, strikethrough: newStrike },
        };
      }
      return node;
    });

    return { nextAst: ast, changed: true };
  }

  private handleDeleteNode(ast: DocumentAst, op: DeleteNodeOp): ApplyOpsResult {
    const { nodeId } = op.payload;
    const index = getBlockIndex(ast, nodeId);

    if (index < 0) {
      return { nextAst: ast, changed: false };
    }

    ast.blocks.splice(index, 1);

    if (ast.blocks.length === 0) {
      ast.blocks.push(createParagraph());
    }

    return { nextAst: ast, changed: true };
  }

  private handleSetHeadingLevel(ast: DocumentAst, op: SetHeadingLevelOp): ApplyOpsResult {
    const { nodeId, level } = op.payload;
    const index = getBlockIndex(ast, nodeId);

    if (index < 0) {
      return { nextAst: ast, changed: false };
    }

    const block = ast.blocks[index];
    
    // 获取 children
    let children: InlineNode[] = [];
    if (hasInlineChildren(block)) {
      children = block.children;
    }

    if (level === 0) {
      const paragraph: ParagraphNode = {
        id: block.id,
        type: 'paragraph',
        children,
      };
      ast.blocks[index] = paragraph;
    } else {
      const heading: HeadingNode = {
        id: block.id,
        type: 'heading',
        level,
        children,
      };
      ast.blocks[index] = heading;
    }

    return { nextAst: ast, changed: true };
  }

  /**
   * 处理拆分段落（Enter 键）
   * 
   * 在指定位置将 block 拆分为两个：
   * - 第一个 block 保留 offset 之前的内容
   * - 新 block 包含 offset 之后的内容
   */
  private handleSplitBlock(ast: DocumentAst, op: SplitBlockOp): ApplyOpsResult {
    const { nodeId, offset } = op.payload;
    const index = getBlockIndex(ast, nodeId);

    if (index < 0) {
      return { nextAst: ast, changed: false };
    }

    const block = ast.blocks[index];
    if (!hasInlineChildren(block)) {
      // 对于不支持分割的 block（如 list），简单插入新段落
      const newParagraph = createParagraph();
      ast.blocks.splice(index + 1, 0, newParagraph);
      return { nextAst: ast, changed: true };
    }

    const fullText = getInlineText(block.children);
    const beforeText = fullText.slice(0, offset);
    const afterText = fullText.slice(offset);

    // 更新当前 block 的内容
    if (block.children.length > 0 && block.children[0].type === 'text') {
      block.children = [{ ...block.children[0], text: beforeText }];
    } else {
      block.children = [createTextRun(beforeText)];
    }

    // 创建新 block（与原 block 类型相同）
    const newBlock = block.type === 'heading'
      ? {
          ...createParagraph(afterText),
          type: 'heading' as const,
          level: block.level,
        }
      : createParagraph(afterText);

    ast.blocks.splice(index + 1, 0, newBlock);

    return { nextAst: ast, changed: true };
  }

  /**
   * 处理软换行（Shift+Enter）
   * 
   * 在文本中插入换行符 \n
   */
  private handleInsertLineBreak(ast: DocumentAst, op: InsertLineBreakOp): ApplyOpsResult {
    const { nodeId, offset } = op.payload;
    
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      return { nextAst: ast, changed: false };
    }

    const fullText = getInlineText(block.children);
    const newText = fullText.slice(0, offset) + '\n' + fullText.slice(offset);

    if (block.children.length > 0 && block.children[0].type === 'text') {
      block.children = [{ ...block.children[0], text: newText }];
    } else {
      block.children = [createTextRun(newText)];
    }

    return { nextAst: ast, changed: true };
  }

  // ==========================================
  // Undo / Redo
  // ==========================================

  undo(currentAst: DocumentAst): DocumentAst | null {
    return this.history.undo(currentAst);
  }

  redo(currentAst: DocumentAst): DocumentAst | null {
    return this.history.redo(currentAst);
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  clearHistory(): void {
    this.history.clear();
  }
}

export const documentEngine = new DocumentEngine();
