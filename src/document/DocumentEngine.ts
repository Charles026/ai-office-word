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
  ReplaceBlockTextOp,
  ApplyInlineMarkOp,
  RemoveInlineMarkOp,
  ClearInlineMarksOp,
} from '../docops/types';

import {
  InlineMarkState,
  createEmptyInlineMarkState,
  addInlineMarkToState,
  removeInlineMarkFromState,
  clearInlineMarksFromState,
} from './inlineMark';

import {
  DocumentAst,
  ParagraphNode,
  HeadingNode,
  InlineNode,
  TextMarks,
  createParagraph,
  createTextRun,
  createEmptyDocument,
  findBlockById,
  getBlockIndex,
  getInlineText,
  hasInlineChildren,
  generateNodeId,
} from './types';

// ==========================================
// 操作结果类型
// ==========================================

export interface ApplyOpsResult {
  nextAst: DocumentAst;
  changed: boolean;
  inverseOps?: DocOp[];
  /** 更新后的内联标记状态（仅当操作涉及 InlineMark 时返回） */
  nextInlineMarks?: InlineMarkState;
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
  private inlineMarks: InlineMarkState;

  constructor() {
    this.history = new HistoryManager();
    this.inlineMarks = createEmptyInlineMarkState();
  }

  createEmptyDocument(): DocumentAst {
    return createEmptyDocument();
  }

  /**
   * 获取当前内联标记状态
   */
  getInlineMarks(): InlineMarkState {
    return this.inlineMarks;
  }

  /**
   * 设置内联标记状态（用于恢复/初始化）
   */
  setInlineMarks(state: InlineMarkState): void {
    this.inlineMarks = state;
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
    let inlineMarksChanged = false;

    for (const op of ops) {
      const result = this.applySingleOp(nextAst, op);
      if (result.changed) {
        nextAst = result.nextAst;
        changed = true;
      }
      if (result.nextInlineMarks) {
        this.inlineMarks = result.nextInlineMarks;
        inlineMarksChanged = true;
      }
    }

    if (changed) {
      nextAst.version += 1;
      nextAst.metadata.modifiedAt = Date.now();
    }

    const result: ApplyOpsResult = { nextAst, changed };
    if (inlineMarksChanged) {
      result.nextInlineMarks = this.inlineMarks;
    }
    return result;
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
      case 'ReplaceBlockText':
        return this.handleReplaceBlockText(ast, op);
      case 'ApplyInlineMark':
        return this.handleApplyInlineMark(ast, op);
      case 'RemoveInlineMark':
        return this.handleRemoveInlineMark(ast, op);
      case 'ClearInlineMarks':
        return this.handleClearInlineMarks(ast, op);
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
    const { nodeId, startOffset, endOffset, force } = op.payload;
    
    // 🔍 调试日志：确认 ToggleBold 被执行
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DocumentEngine] Applying ToggleBold: nodeId="${nodeId}", startOffset=${startOffset}, endOffset=${endOffset}, force=${force}`);
      
      // 检查 block 是否存在
      const block = findBlockById(ast, nodeId);
      if (!block) {
        console.warn(`[DocumentEngine] ⚠️ ToggleBold target block NOT FOUND: nodeId="${nodeId}"`);
        console.warn(`[DocumentEngine] Available block IDs:`, ast.blocks.map(b => b.id));
      }
    }
    
    return this.applyInlineMark(ast, nodeId, startOffset, endOffset, 'bold', force);
  }

  /**
   * 在指定范围内切换 inline mark
   * 
   * 【策略】
   * 1. 将文本按选区边界拆分成多个 TextRunNode
   * 2. 只对选区内的部分切换 mark
   * 3. 选区外的部分保持不变
   */
  private applyInlineMark(
    ast: DocumentAst,
    nodeId: string,
    startOffset: number,
    endOffset: number,
    markType: 'bold' | 'italic' | 'underline' | 'strikethrough',
    force?: boolean
  ): ApplyOpsResult {
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[DocumentEngine] ⚠️ applyInlineMark failed: block not found or no inline children`);
        console.warn(`[DocumentEngine] Requested nodeId: "${nodeId}"`);
        console.warn(`[DocumentEngine] Block found: ${!!block}, hasInlineChildren: ${block ? hasInlineChildren(block) : 'N/A'}`);
      }
      return { nextAst: ast, changed: false };
    }

    // 获取当前文本和位置信息
    const { runs, selectedRuns, beforeText, selectedText, afterText } = 
      this.splitTextAtRange(block.children, startOffset, endOffset);

    // 如果没有选中任何文本，不做任何改变
    if (!selectedText) {
      return { nextAst: ast, changed: false };
    }

    // 检查选区内是否已有该 mark
    const hasMarkInSelection = selectedRuns.some(run => 
      run.type === 'text' && run.marks?.[markType]
    );

    // 决定新的 mark 值
    const newMarkValue = force !== undefined ? force : !hasMarkInSelection;

    // 重建 children 数组
    const newChildren: InlineNode[] = [];

    // 添加选区前的内容（保持原样）
    if (beforeText) {
      const beforeRuns = this.extractRunsForRange(block.children, 0, startOffset);
      newChildren.push(...beforeRuns);
    }

    // 添加选区内的内容（切换 mark）
    if (selectedText) {
      const selectedRunsWithNewMark = selectedRuns.map(run => {
        if (run.type === 'text') {
        return {
            ...run,
            id: generateNodeId(), // 新 ID
            marks: { ...run.marks, [markType]: newMarkValue },
        };
      }
        return run;
    });
      newChildren.push(...selectedRunsWithNewMark);
    }

    // 添加选区后的内容（保持原样）
    if (afterText) {
      const afterRuns = this.extractRunsForRange(block.children, endOffset, Infinity);
      newChildren.push(...afterRuns);
    }

    // 合并相邻的相同格式的文本节点
    block.children = this.mergeAdjacentTextRuns(newChildren);

    return { nextAst: ast, changed: true };
  }

  /**
   * 根据偏移范围拆分文本节点
   */
  private splitTextAtRange(
    children: InlineNode[],
    startOffset: number,
    endOffset: number
  ): {
    runs: InlineNode[];
    selectedRuns: InlineNode[];
    beforeText: string;
    selectedText: string;
    afterText: string;
  } {
    const fullText = getInlineText(children);
    const beforeText = fullText.slice(0, startOffset);
    const selectedText = fullText.slice(startOffset, endOffset);
    const afterText = fullText.slice(endOffset);

    // 提取选区内的文本节点
    const selectedRuns = this.extractRunsForRange(children, startOffset, endOffset);

    return {
      runs: children,
      selectedRuns,
      beforeText,
      selectedText,
      afterText,
    };
  }

  /**
   * 提取指定范围内的文本节点（可能需要拆分）
   */
  private extractRunsForRange(
    children: InlineNode[],
    rangeStart: number,
    rangeEnd: number
  ): InlineNode[] {
    const result: InlineNode[] = [];
    let currentOffset = 0;

    for (const node of children) {
      if (node.type !== 'text') {
        continue;
      }

      const nodeStart = currentOffset;
      const nodeEnd = currentOffset + node.text.length;

      // 检查是否与范围相交
      if (nodeEnd <= rangeStart || nodeStart >= rangeEnd) {
        // 不相交，跳过
        currentOffset = nodeEnd;
        continue;
      }

      // 计算在此节点内的有效范围
      const effectiveStart = Math.max(0, rangeStart - nodeStart);
      const effectiveEnd = Math.min(node.text.length, rangeEnd - nodeStart);

      // 提取该范围内的文本
      const extractedText = node.text.slice(effectiveStart, effectiveEnd);

      if (extractedText) {
        result.push({
          id: generateNodeId(),
          type: 'text',
          text: extractedText,
          marks: { ...node.marks },
        });
      }

      currentOffset = nodeEnd;
    }

    return result;
  }

  /**
   * 合并相邻的具有相同格式的文本节点
   */
  private mergeAdjacentTextRuns(children: InlineNode[]): InlineNode[] {
    if (children.length <= 1) return children;

    const result: InlineNode[] = [];

    for (const node of children) {
      if (node.type !== 'text') {
        result.push(node);
        continue;
      }

      const lastNode = result[result.length - 1];
      if (lastNode?.type === 'text' && this.marksEqual(lastNode.marks, node.marks)) {
        // 合并相邻的相同格式文本
        result[result.length - 1] = {
          ...lastNode,
          text: lastNode.text + node.text,
        };
      } else {
        result.push(node);
      }
    }

    return result;
  }

  /**
   * 比较两个 marks 是否相等
   */
  private marksEqual(a: TextMarks, b: TextMarks): boolean {
    return (
      !!a.bold === !!b.bold &&
      !!a.italic === !!b.italic &&
      !!a.underline === !!b.underline &&
      !!a.strikethrough === !!b.strikethrough &&
      !!a.code === !!b.code
    );
  }

  private handleToggleItalic(ast: DocumentAst, op: ToggleItalicOp): ApplyOpsResult {
    const { nodeId, startOffset, endOffset, force } = op.payload;
    return this.applyInlineMark(ast, nodeId, startOffset, endOffset, 'italic', force);
  }

  private handleToggleUnderline(ast: DocumentAst, op: ToggleUnderlineOp): ApplyOpsResult {
    const { nodeId, startOffset, endOffset, force } = op.payload;
    return this.applyInlineMark(ast, nodeId, startOffset, endOffset, 'underline', force);
  }

  private handleToggleStrike(ast: DocumentAst, op: ToggleStrikeOp): ApplyOpsResult {
    const { nodeId, startOffset, endOffset, force } = op.payload;
    return this.applyInlineMark(ast, nodeId, startOffset, endOffset, 'strikethrough', force);
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

  /**
   * 处理替换块文本
   */
  private handleReplaceBlockText(ast: DocumentAst, op: ReplaceBlockTextOp): ApplyOpsResult {
    const { nodeId, text } = op.payload;
    
    const block = findBlockById(ast, nodeId);
    if (!block || !hasInlineChildren(block)) {
      return { nextAst: ast, changed: false };
    }

    // 替换内容：清空并插入新文本
    block.children = [createTextRun(text)];

    return { nextAst: ast, changed: true };
  }

  // ==========================================
  // InlineMark 操作处理器
  // ==========================================

  /**
   * 处理应用内联标记
   * 
   * 将 InlineMark 添加到内部状态中。
   * 不修改 AST，只更新 inlineMarks 状态。
   */
  private handleApplyInlineMark(_ast: DocumentAst, op: ApplyInlineMarkOp): ApplyOpsResult {
    const { mark } = op.payload;
    
    // 验证标记有效性
    if (!mark.id || !mark.anchor || !mark.anchor.sectionId) {
      console.warn('[DocumentEngine] Invalid InlineMark:', mark);
      return { nextAst: _ast, changed: false };
    }
    
    // 添加到状态
    const nextInlineMarks = addInlineMarkToState(this.inlineMarks, mark);
    
    console.log(`[DocumentEngine] Applied InlineMark: ${mark.id} (${mark.kind})`);
    
    // AST 不变，但标记状态变化
    return { 
      nextAst: _ast, 
      changed: true,
      nextInlineMarks,
    };
  }

  /**
   * 处理移除内联标记
   */
  private handleRemoveInlineMark(_ast: DocumentAst, op: RemoveInlineMarkOp): ApplyOpsResult {
    const { markId } = op.payload;
    
    // 检查标记是否存在
    if (!this.inlineMarks.marksById[markId]) {
      console.warn('[DocumentEngine] InlineMark not found:', markId);
      return { nextAst: _ast, changed: false };
    }
    
    // 从状态中移除
    const nextInlineMarks = removeInlineMarkFromState(this.inlineMarks, markId);
    
    console.log(`[DocumentEngine] Removed InlineMark: ${markId}`);
    
    return { 
      nextAst: _ast, 
      changed: true,
      nextInlineMarks,
    };
  }

  /**
   * 处理清除内联标记
   */
  private handleClearInlineMarks(_ast: DocumentAst, op: ClearInlineMarksOp): ApplyOpsResult {
    const { scope } = op.payload;
    
    // 清除指定范围的标记
    const nextInlineMarks = clearInlineMarksFromState(this.inlineMarks, scope);
    
    console.log(`[DocumentEngine] Cleared InlineMarks with scope:`, scope);
    
    return { 
      nextAst: _ast, 
      changed: true,
      nextInlineMarks,
    };
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
