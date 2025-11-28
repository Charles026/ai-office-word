/**
 * 选区模型定义
 * 
 * 【设计目标】
 * - 选区是 Editor State，不依赖浏览器原生 selection
 * - 弹窗和失焦不会打断选区
 * - 所有 AI 改写通过 AST + DocOps 完成替换
 * 
 * 【与 Word 对齐】
 * - Selection 保持在编辑器状态中，不受 focus 影响
 * - 可以在选区基础上执行各种操作（改写、格式化等）
 */

import { DocNodeId } from '../docops/types';
import { DocumentAst, getBlockText, getBlockIndex } from './types';

// ==========================================
// 选区类型定义
// ==========================================

/**
 * 文档位置点
 * 
 * 表示 AST 中的一个精确位置
 */
export interface DocPoint {
  /** 所属 block 的 ID */
  blockId: DocNodeId;
  /** 在该 block 纯文本中的字符偏移 */
  offset: number;
}

/**
 * 文档选区
 * 
 * 由两个点组成：anchor（起点）和 focus（终点）
 * anchor 是用户开始选择的位置，focus 是当前位置
 * 两者可以相同（光标/折叠选区）或不同（范围选区）
 */
export interface DocSelection {
  /** 选区起点（用户开始拖拽的位置） */
  anchor: DocPoint;
  /** 选区终点（当前位置） */
  focus: DocPoint;
}

/**
 * 选区快照
 * 
 * 包含选区位置和选中的文本内容
 * 用于 AI 改写等需要保存选区状态的场景
 */
export interface SelectionSnapshot extends DocSelection {
  /** 选中的文本内容 */
  text: string;
  /** 是否折叠（光标状态） */
  isCollapsed: boolean;
  /** 是否跨 block */
  isCrossBlock: boolean;
}

// ==========================================
// 选区工具函数
// ==========================================

/**
 * 创建折叠选区（光标）
 */
export function createCollapsedSelection(blockId: DocNodeId, offset: number): DocSelection {
  return {
    anchor: { blockId, offset },
    focus: { blockId, offset },
  };
}

/**
 * 创建范围选区
 */
export function createRangeSelection(
  anchorBlockId: DocNodeId,
  anchorOffset: number,
  focusBlockId: DocNodeId,
  focusOffset: number
): DocSelection {
  return {
    anchor: { blockId: anchorBlockId, offset: anchorOffset },
    focus: { blockId: focusBlockId, offset: focusOffset },
  };
}

/**
 * 判断选区是否折叠（光标状态）
 */
export function isCollapsedSelection(sel: DocSelection): boolean {
  return sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
}

/**
 * 判断选区是否跨 block
 */
export function isCrossBlockSelection(sel: DocSelection): boolean {
  return sel.anchor.blockId !== sel.focus.blockId;
}

/**
 * 判断选区是否有效（非空选区）
 */
export function isValidRangeSelection(sel: DocSelection | null): boolean {
  if (!sel) return false;
  return !isCollapsedSelection(sel);
}

/**
 * 获取选区的规范化范围（确保 start <= end）
 */
export function normalizeSelection(
  ast: DocumentAst,
  sel: DocSelection
): { startBlockId: DocNodeId; startOffset: number; endBlockId: DocNodeId; endOffset: number } {
  const anchorIndex = getBlockIndex(ast, sel.anchor.blockId);
  const focusIndex = getBlockIndex(ast, sel.focus.blockId);

  if (anchorIndex === -1 || focusIndex === -1) {
    // 无效选区，返回 anchor
    return {
      startBlockId: sel.anchor.blockId,
      startOffset: sel.anchor.offset,
      endBlockId: sel.anchor.blockId,
      endOffset: sel.anchor.offset,
    };
  }

  // 比较位置
  if (anchorIndex < focusIndex) {
    return {
      startBlockId: sel.anchor.blockId,
      startOffset: sel.anchor.offset,
      endBlockId: sel.focus.blockId,
      endOffset: sel.focus.offset,
    };
  } else if (anchorIndex > focusIndex) {
    return {
      startBlockId: sel.focus.blockId,
      startOffset: sel.focus.offset,
      endBlockId: sel.anchor.blockId,
      endOffset: sel.anchor.offset,
    };
  } else {
    // 同一 block
    const start = Math.min(sel.anchor.offset, sel.focus.offset);
    const end = Math.max(sel.anchor.offset, sel.focus.offset);
    return {
      startBlockId: sel.anchor.blockId,
      startOffset: start,
      endBlockId: sel.anchor.blockId,
      endOffset: end,
    };
  }
}

/**
 * 从 AST 和选区生成快照
 * 
 * 【策略】
 * - 同一 block 内：直接截取文本
 * - 跨 block：串联各 block 文本，中间加换行
 */
export function snapshotSelection(ast: DocumentAst, sel: DocSelection): SelectionSnapshot {
  const isCollapsed = isCollapsedSelection(sel);

  if (isCollapsed) {
    return {
      ...sel,
      text: '',
      isCollapsed: true,
      isCrossBlock: false,
    };
  }

  const { startBlockId, startOffset, endBlockId, endOffset } = normalizeSelection(ast, sel);
  const startIndex = getBlockIndex(ast, startBlockId);
  const endIndex = getBlockIndex(ast, endBlockId);

  if (startIndex === -1 || endIndex === -1) {
    return {
      ...sel,
      text: '',
      isCollapsed: true,
      isCrossBlock: false,
    };
  }

  // 同一 block
  if (startIndex === endIndex) {
    const block = ast.blocks[startIndex];
    const blockText = getBlockText(block);
    const text = blockText.slice(startOffset, endOffset);
    return {
      ...sel,
      text,
      isCollapsed: false,
      isCrossBlock: false,
    };
  }

  // 跨 block
  const parts: string[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const block = ast.blocks[i];
    const blockText = getBlockText(block);

    if (i === startIndex) {
      parts.push(blockText.slice(startOffset));
    } else if (i === endIndex) {
      parts.push(blockText.slice(0, endOffset));
    } else {
      parts.push(blockText);
    }
  }

  return {
    ...sel,
    text: parts.join('\n'),
    isCollapsed: false,
    isCrossBlock: true,
  };
}

/**
 * 根据 block 文本长度约束 offset
 */
export function clampOffset(ast: DocumentAst, blockId: DocNodeId, offset: number): number {
  const block = ast.blocks.find(b => b.id === blockId);
  if (!block) return 0;
  const len = getBlockText(block).length;
  return Math.max(0, Math.min(offset, len));
}

/**
 * 移动光标到指定位置
 */
export function moveCaret(blockId: DocNodeId, offset: number): DocSelection {
  return createCollapsedSelection(blockId, offset);
}

/**
 * 扩展选区（用于 Shift+方向键）
 */
export function extendSelection(
  sel: DocSelection,
  newFocusBlockId: DocNodeId,
  newFocusOffset: number
): DocSelection {
  return {
    anchor: sel.anchor,
    focus: { blockId: newFocusBlockId, offset: newFocusOffset },
  };
}

/**
 * 计算 AI 改写后光标应该移动到的位置
 */
export function getCaretAfterRewrite(
  ast: DocumentAst,
  sel: DocSelection,
  newText: string
): DocPoint {
  const { startBlockId, startOffset } = normalizeSelection(ast, sel);
  
  // 新文本可能包含换行，这里简化处理：光标移到第一个 block 的新文本末尾
  // TODO: 如果 newText 包含多段，需要更复杂的处理
  const firstLineEnd = newText.indexOf('\n');
  const insertLength = firstLineEnd === -1 ? newText.length : firstLineEnd;

  return {
    blockId: startBlockId,
    offset: startOffset + insertLength,
  };
}

// ==========================================
// 选区与 DOM 的转换（用于渲染层）
// ==========================================

/**
 * 判断某个 block 的某个范围是否在选区内
 * 
 * 用于渲染高亮
 */
export function isRangeInSelection(
  ast: DocumentAst,
  sel: DocSelection,
  blockId: DocNodeId,
  rangeStart: number,
  rangeEnd: number
): { inSelection: boolean; selectedStart: number; selectedEnd: number } {
  if (isCollapsedSelection(sel)) {
    return { inSelection: false, selectedStart: 0, selectedEnd: 0 };
  }

  const { startBlockId, startOffset, endBlockId, endOffset } = normalizeSelection(ast, sel);
  const selStartIndex = getBlockIndex(ast, startBlockId);
  const selEndIndex = getBlockIndex(ast, endBlockId);
  const blockIndex = getBlockIndex(ast, blockId);

  if (blockIndex === -1 || selStartIndex === -1 || selEndIndex === -1) {
    return { inSelection: false, selectedStart: 0, selectedEnd: 0 };
  }

  // block 在选区范围外
  if (blockIndex < selStartIndex || blockIndex > selEndIndex) {
    return { inSelection: false, selectedStart: 0, selectedEnd: 0 };
  }

  // 计算该 block 中被选中的范围
  let blockSelStart = 0;
  let blockSelEnd = Infinity;

  if (blockIndex === selStartIndex) {
    blockSelStart = startOffset;
  }
  if (blockIndex === selEndIndex) {
    blockSelEnd = endOffset;
  }

  // 检查 rangeStart-rangeEnd 是否与 blockSelStart-blockSelEnd 有交集
  const overlapStart = Math.max(rangeStart, blockSelStart);
  const overlapEnd = Math.min(rangeEnd, blockSelEnd);

  if (overlapStart < overlapEnd) {
    return {
      inSelection: true,
      selectedStart: overlapStart - rangeStart,
      selectedEnd: overlapEnd - rangeStart,
    };
  }

  return { inSelection: false, selectedStart: 0, selectedEnd: 0 };
}

