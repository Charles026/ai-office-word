/**
 * InlineMark - 内联标记模块
 * 
 * 【职责】
 * - 定义词语粒度的锚点表示（TextAnchor）
 * - 定义内联标记类型（InlineMark）
 * - 提供锚点与标记的管理能力
 * - 提供 TextAnchor → Lexical Range 的映射能力
 * 
 * 【设计原则】
 * - 锚点以 UTF-16 offset 为准（与 JS 字符串一致）
 * - 标记不改变文本内容，只影响展示样式
 * - 所有写操作必须通过 DocOps → DocumentEngine
 * 
 * @version 1.0.0
 */

import type { LexicalEditor, LexicalNode } from 'lexical';

// ==========================================
// TextAnchor - 词语级锚点
// ==========================================

/**
 * 文本锚点
 * 
 * 表示某个 Section 内的一段字符范围（逻辑空间）。
 * 不关心具体 Lexical Node 结构，由 resolveAnchorToLexicalRange 进行映射。
 * 
 * 注意：
 * - offset 以 UTF-16 为准（与 JS 字符串一致）
 * - sectionId 使用当前文档结构里的 Section Id
 */
export interface TextAnchor {
  /** 所属 section（章节 ID，对应 SectionNode.titleBlockId） */
  sectionId: string;
  /** 相对该 section 纯文本的 UTF-16 起始偏移（含） */
  startOffset: number;
  /** 相对该 section 纯文本的 UTF-16 结束偏移（不含） */
  endOffset: number;
  /** 可选：锚点前若干字符，用于容错和验证 */
  contextBefore?: string;
  /** 可选：锚点后若干字符，用于容错和验证 */
  contextAfter?: string;
}

// ==========================================
// InlineMark 类型定义
// ==========================================

/**
 * 内联标记类型（语义）
 * 
 * - key_term: 关键词/重点词
 * - ai_suggestion: AI 建议
 * - comment_anchor: 评论/批注锚点
 * - custom: 留给未来扩展
 */
export type InlineMarkKind =
  | 'key_term'
  | 'ai_suggestion'
  | 'comment_anchor'
  | 'custom';

/**
 * 内联标记样式（渲染方式）
 * 
 * - underline: 下划线
 * - highlight: 高亮背景
 * - dotted: 点状下划线
 * - background: 纯背景色（比 highlight 更淡）
 * - none: 仅逻辑标记，不渲染样式
 */
export type InlineMarkStyle =
  | 'underline'
  | 'highlight'
  | 'dotted'
  | 'background'
  | 'none';

/**
 * 内联标记创建者
 */
export type InlineMarkCreator = 'system' | 'ai' | 'user' | string;

/**
 * 内联标记
 * 
 * 描述在一个 TextAnchor 上挂载的标注，例如「重点词」「AI 建议」「批注锚点」等。
 * 
 * 设计要点：
 * - 高亮只是 UI 层行为，原始文本 Node 不插入额外字符
 * - 复制/粘贴时可忽略 InlineMark 样式
 */
export interface InlineMark {
  /** 唯一 ID（UUID 格式） */
  id: string;
  /** 锚点范围 */
  anchor: TextAnchor;
  /** 标记类型语义 */
  kind: InlineMarkKind;
  /** 渲染样式（UI 层解释） */
  style: InlineMarkStyle;
  /** 创建时间（ISO 时间字符串） */
  createdAt: string;
  /** 创建者 */
  createdBy?: InlineMarkCreator;
  /** 预留元数据 */
  meta?: Record<string, unknown>;
}

// ==========================================
// InlineMarkState - 状态管理
// ==========================================

/**
 * 内联标记状态
 * 
 * 存储文档所有内联标记的聚合结构。
 * 提供按 ID 和按 Section 两种索引方式。
 */
export interface InlineMarkState {
  /** 按 ID 索引的标记映射 */
  marksById: Record<string, InlineMark>;
  /** 按 Section 索引的标记 ID 列表 */
  marksBySection: Record<string, string[]>;
}

/**
 * 创建空的 InlineMarkState
 */
export function createEmptyInlineMarkState(): InlineMarkState {
  return {
    marksById: {},
    marksBySection: {},
  };
}

// ==========================================
// 工具函数
// ==========================================

/**
 * 生成唯一的 InlineMark ID
 */
export function generateInlineMarkId(): string {
  return `mark_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 创建 InlineMark
 * 
 * @param anchor - 文本锚点
 * @param kind - 标记类型
 * @param style - 渲染样式
 * @param createdBy - 创建者
 * @param meta - 可选元数据
 */
export function createInlineMark(
  anchor: TextAnchor,
  kind: InlineMarkKind,
  style: InlineMarkStyle = 'highlight',
  createdBy: InlineMarkCreator = 'system',
  meta?: Record<string, unknown>
): InlineMark {
  return {
    id: generateInlineMarkId(),
    anchor,
    kind,
    style,
    createdAt: new Date().toISOString(),
    createdBy,
    meta,
  };
}

/**
 * 创建 TextAnchor
 * 
 * @param sectionId - 所属 section ID
 * @param startOffset - 起始偏移
 * @param endOffset - 结束偏移
 * @param contextBefore - 可选：锚点前文本
 * @param contextAfter - 可选：锚点后文本
 */
export function createTextAnchor(
  sectionId: string,
  startOffset: number,
  endOffset: number,
  contextBefore?: string,
  contextAfter?: string
): TextAnchor {
  return {
    sectionId,
    startOffset,
    endOffset,
    contextBefore,
    contextAfter,
  };
}

/**
 * 验证 TextAnchor 是否有效
 */
export function isValidTextAnchor(anchor: TextAnchor): boolean {
  return (
    typeof anchor.sectionId === 'string' &&
    anchor.sectionId.length > 0 &&
    typeof anchor.startOffset === 'number' &&
    typeof anchor.endOffset === 'number' &&
    anchor.startOffset >= 0 &&
    anchor.endOffset > anchor.startOffset
  );
}

/**
 * 验证 InlineMark 是否有效
 */
export function isValidInlineMark(mark: InlineMark): boolean {
  return (
    typeof mark.id === 'string' &&
    mark.id.length > 0 &&
    isValidTextAnchor(mark.anchor) &&
    typeof mark.kind === 'string' &&
    typeof mark.style === 'string'
  );
}

/**
 * 获取 InlineMark 的 CSS 类名
 * 
 * 用于 Lexical 渲染时添加到标记范围的元素上
 */
export function getInlineMarkClassName(mark: InlineMark): string {
  const kindClass = `inline-mark-${mark.kind.replace(/_/g, '-')}`;
  const styleClass = `inline-mark-style-${mark.style}`;
  return `inline-mark ${kindClass} ${styleClass}`;
}

/**
 * 获取 InlineMark 的描述文本（用于 tooltip）
 */
export function getInlineMarkDescription(mark: InlineMark): string {
  switch (mark.kind) {
    case 'key_term':
      return 'AI 标记的关键词';
    case 'ai_suggestion':
      return 'AI 建议';
    case 'comment_anchor':
      return '批注锚点';
    case 'custom':
      return (mark.meta?.description as string) || '自定义标记';
    default:
      return '内联标记';
  }
}

// ==========================================
// InlineMarkState 操作函数
// ==========================================

/**
 * 添加 InlineMark 到 state
 * 
 * 返回新的 state（不可变更新）
 */
export function addInlineMarkToState(
  state: InlineMarkState,
  mark: InlineMark
): InlineMarkState {
  const { sectionId } = mark.anchor;
  
  const newMarksById = {
    ...state.marksById,
    [mark.id]: mark,
  };
  
  const existingIds = state.marksBySection[sectionId] || [];
  const newMarksBySection = {
    ...state.marksBySection,
    [sectionId]: [...existingIds, mark.id],
  };
  
  return {
    marksById: newMarksById,
    marksBySection: newMarksBySection,
  };
}

/**
 * 从 state 中移除 InlineMark
 * 
 * 返回新的 state（不可变更新）
 */
export function removeInlineMarkFromState(
  state: InlineMarkState,
  markId: string
): InlineMarkState {
  const mark = state.marksById[markId];
  if (!mark) {
    return state;
  }
  
  const { sectionId } = mark.anchor;
  
  // 移除 marksById 中的条目
  const { [markId]: _removed, ...newMarksById } = state.marksById;
  
  // 移除 marksBySection 中的引用
  const existingIds = state.marksBySection[sectionId] || [];
  const filteredIds = existingIds.filter(id => id !== markId);
  
  const newMarksBySection = { ...state.marksBySection };
  if (filteredIds.length > 0) {
    newMarksBySection[sectionId] = filteredIds;
  } else {
    delete newMarksBySection[sectionId];
  }
  
  return {
    marksById: newMarksById,
    marksBySection: newMarksBySection,
  };
}

/**
 * 清除指定范围的 InlineMark
 * 
 * @param state - 当前状态
 * @param scope - 清除范围
 */
export function clearInlineMarksFromState(
  state: InlineMarkState,
  scope:
    | { type: 'document' }
    | { type: 'section'; sectionId: string }
    | { type: 'kind'; kind: InlineMarkKind }
): InlineMarkState {
  if (scope.type === 'document') {
    // 清除整个文档
    return createEmptyInlineMarkState();
  }
  
  if (scope.type === 'section') {
    // 清除指定 section
    const markIds = state.marksBySection[scope.sectionId] || [];
    let newState = state;
    for (const markId of markIds) {
      newState = removeInlineMarkFromState(newState, markId);
    }
    return newState;
  }
  
  if (scope.type === 'kind') {
    // 清除指定类型
    const markIdsToRemove = Object.values(state.marksById)
      .filter(mark => mark.kind === scope.kind)
      .map(mark => mark.id);
    
    let newState = state;
    for (const markId of markIdsToRemove) {
      newState = removeInlineMarkFromState(newState, markId);
    }
    return newState;
  }
  
  return state;
}

/**
 * 获取指定 section 的所有 InlineMark
 */
export function getMarksForSection(
  state: InlineMarkState,
  sectionId: string
): InlineMark[] {
  const markIds = state.marksBySection[sectionId] || [];
  return markIds
    .map(id => state.marksById[id])
    .filter((mark): mark is InlineMark => mark !== undefined);
}

/**
 * 获取所有 InlineMark（扁平列表）
 */
export function getAllMarks(state: InlineMarkState): InlineMark[] {
  return Object.values(state.marksById);
}

// ==========================================
// 短语匹配辅助函数（用于 Copilot 接口）
// ==========================================

/**
 * 在文本中查找短语并创建 TextAnchor
 * 
 * @param sectionId - section ID
 * @param sectionText - section 的纯文本内容
 * @param phrase - 要查找的短语
 * @param occurrence - 第几次出现（1-based），默认为 1
 * @returns TextAnchor 或 null（如果未找到）
 */
export function findPhraseAnchor(
  sectionId: string,
  sectionText: string,
  phrase: string,
  occurrence: number = 1
): TextAnchor | null {
  if (!phrase || occurrence < 1) {
    return null;
  }
  
  let currentIndex = 0;
  let foundCount = 0;
  
  while (currentIndex < sectionText.length) {
    const foundIndex = sectionText.indexOf(phrase, currentIndex);
    if (foundIndex === -1) {
      break;
    }
    
    foundCount++;
    if (foundCount === occurrence) {
      // 找到了目标位置
      const startOffset = foundIndex;
      const endOffset = foundIndex + phrase.length;
      
      // 提取上下文（各取 10 个字符）
      const contextLength = 10;
      const contextBefore = sectionText.slice(
        Math.max(0, startOffset - contextLength),
        startOffset
      );
      const contextAfter = sectionText.slice(
        endOffset,
        Math.min(sectionText.length, endOffset + contextLength)
      );
      
      return createTextAnchor(
        sectionId,
        startOffset,
        endOffset,
        contextBefore,
        contextAfter
      );
    }
    
    currentIndex = foundIndex + 1;
  }
  
  // 未找到指定次数的出现
  return null;
}

/**
 * 从短语创建 InlineMark
 * 
 * 这是 Copilot 预留的接口，用于将 LLM 输出的短语转换为 InlineMark。
 * 
 * @param sectionId - section ID
 * @param sectionText - section 的纯文本内容
 * @param phrase - 要标记的短语
 * @param occurrence - 第几次出现（1-based），默认为 1
 * @param kind - 标记类型，默认为 'key_term'
 * @param style - 渲染样式，默认为 'highlight'
 * @returns InlineMark 或 null（如果短语未找到）
 */
export function createInlineMarkFromPhrase(
  sectionId: string,
  sectionText: string,
  phrase: string,
  occurrence: number = 1,
  kind: InlineMarkKind = 'key_term',
  style: InlineMarkStyle = 'highlight'
): InlineMark | null {
  const anchor = findPhraseAnchor(sectionId, sectionText, phrase, occurrence);
  if (!anchor) {
    return null;
  }
  
  return createInlineMark(anchor, kind, style, 'ai');
}

// ==========================================
// LLM 意图类型预留（供 Copilot 使用）
// ==========================================

/**
 * 标记重点词的意图结构
 * 
 * LLM 输出的"标记重点词"意图示例。
 * 后续 Copilot 将解析这个意图并调用 createInlineMarkFromPhrase。
 */
export interface MarkKeyTermsIntent {
  type: 'mark_key_terms';
  scope: 'section' | 'document';
  targets: Array<{
    sectionId: string;
    phrase: string;
    occurrence?: number;
  }>;
}

/**
 * 处理 MarkKeyTermsIntent
 * 
 * 将意图转换为 InlineMark 列表。
 * 
 * @param intent - 标记意图
 * @param getSectionText - 获取 section 文本的函数
 * @returns 成功创建的 InlineMark 列表
 */
export function processMarkKeyTermsIntent(
  intent: MarkKeyTermsIntent,
  getSectionText: (sectionId: string) => string | null
): InlineMark[] {
  const marks: InlineMark[] = [];
  
  for (const target of intent.targets) {
    const sectionText = getSectionText(target.sectionId);
    if (!sectionText) {
      console.warn(`[InlineMark] Section not found: ${target.sectionId}`);
      continue;
    }
    
    const mark = createInlineMarkFromPhrase(
      target.sectionId,
      sectionText,
      target.phrase,
      target.occurrence || 1,
      'key_term',
      'highlight'
    );
    
    if (mark) {
      marks.push(mark);
    } else {
      console.warn(
        `[InlineMark] Phrase not found: "${target.phrase}" in section ${target.sectionId}`
      );
    }
  }
  
  return marks;
}

// ==========================================
// Lexical Range 映射
// ==========================================

/**
 * Lexical Range 表示
 * 
 * 表示 Lexical 编辑器中的一个文本范围
 */
export interface LexicalRange {
  /** 起始位置 */
  start: {
    /** Lexical 节点的 key */
    nodeKey: string;
    /** 在节点内的偏移 */
    offset: number;
  };
  /** 结束位置 */
  end: {
    /** Lexical 节点的 key */
    nodeKey: string;
    /** 在节点内的偏移 */
    offset: number;
  };
}

/**
 * 节点偏移映射项
 * 
 * 用于在 section 纯文本和 Lexical 节点之间建立映射
 */
interface NodeOffsetEntry {
  /** 节点的 key */
  nodeKey: string;
  /** 该节点在 section 纯文本中的起始偏移 */
  startOffset: number;
  /** 该节点在 section 纯文本中的结束偏移 */
  endOffset: number;
  /** 节点内的文本长度 */
  textLength: number;
}

/**
 * 从 Lexical 编辑器中获取指定 section 的纯文本内容
 * 
 * @param editor - Lexical 编辑器实例
 * @param sectionId - section ID（对应 Lexical 中的 node key）
 * @returns 纯文本内容，如果 section 不存在则返回 null
 */
export function getSectionTextFromEditor(
  editor: LexicalEditor,
  sectionId: string
): string | null {
  let result: string | null = null;
  
  editor.getEditorState().read(() => {
    const lexical = require('lexical');
    const $getRoot = lexical.$getRoot;
    
    const root = $getRoot();
    const children = root.getChildren() as LexicalNode[];
    
    // 查找 section 对应的 block
    const sectionBlock = children.find(
      (node: LexicalNode) => node.getKey() === sectionId
    );
    
    if (sectionBlock) {
      result = sectionBlock.getTextContent();
    } else {
      // 如果直接匹配不到，可能需要在 section 树中查找
      // 这里先简单返回 null，后续可以扩展
      console.warn(`[InlineMark] Section block not found: ${sectionId}`);
    }
  });
  
  return result;
}

/**
 * 构建 section 内的节点偏移映射
 * 
 * 遍历 section 下的所有文本节点，记录每个节点在纯文本中的位置
 * 
 * @param editor - Lexical 编辑器实例
 * @param sectionId - section ID
 * @returns 节点偏移映射列表
 */
export function buildNodeOffsetMap(
  editor: LexicalEditor,
  sectionId: string
): NodeOffsetEntry[] {
  const entries: NodeOffsetEntry[] = [];
  
  editor.getEditorState().read(() => {
    // 使用动态导入以避免 TypeScript 类型问题
    const lexical = require('lexical');
    const $getRoot = lexical.$getRoot;
    const $isElementNode = lexical.$isElementNode;
    const $isTextNode = lexical.$isTextNode;
    
    const root = $getRoot();
    const children = root.getChildren() as LexicalNode[];
    
    // 查找 section 对应的 block
    const sectionBlock = children.find(
      (node: LexicalNode) => node.getKey() === sectionId
    );
    
    if (!sectionBlock) {
      return;
    }
    
    // 递归遍历所有文本节点
    let currentOffset = 0;
    
    function traverseNode(node: LexicalNode): void {
      if ($isTextNode(node)) {
        const text = node.getTextContent();
        entries.push({
          nodeKey: node.getKey(),
          startOffset: currentOffset,
          endOffset: currentOffset + text.length,
          textLength: text.length,
        });
        currentOffset += text.length;
      } else if ($isElementNode(node)) {
        // ElementNode 有 getChildren 方法
        const elementNode = node as LexicalNode & { getChildren: () => LexicalNode[] };
        const childNodes = elementNode.getChildren();
        for (const child of childNodes) {
          traverseNode(child);
        }
      }
    }
    
    // 如果 sectionBlock 是 ElementNode，遍历其子节点
    if ($isElementNode(sectionBlock)) {
      const elementBlock = sectionBlock as LexicalNode & { getChildren: () => LexicalNode[] };
      const childNodes = elementBlock.getChildren();
      for (const child of childNodes) {
        traverseNode(child);
      }
    } else if ($isTextNode(sectionBlock)) {
      // 如果 sectionBlock 本身是文本节点（不太可能）
      const text = sectionBlock.getTextContent();
      entries.push({
        nodeKey: sectionBlock.getKey(),
        startOffset: 0,
        endOffset: text.length,
        textLength: text.length,
      });
    }
  });
  
  return entries;
}

/**
 * 将逻辑 offset 映射到 Lexical 节点位置
 * 
 * @param offset - 在 section 纯文本中的偏移
 * @param nodeMap - 节点偏移映射
 * @returns {nodeKey, offset} 或 null
 */
function offsetToNodePosition(
  offset: number,
  nodeMap: NodeOffsetEntry[]
): { nodeKey: string; offset: number } | null {
  for (const entry of nodeMap) {
    if (offset >= entry.startOffset && offset <= entry.endOffset) {
      return {
        nodeKey: entry.nodeKey,
        offset: offset - entry.startOffset,
      };
    }
  }
  
  // 如果 offset 超出范围，尝试返回最后一个节点的末尾
  if (nodeMap.length > 0) {
    const lastEntry = nodeMap[nodeMap.length - 1];
    if (offset >= lastEntry.endOffset) {
      return {
        nodeKey: lastEntry.nodeKey,
        offset: lastEntry.textLength,
      };
    }
  }
  
  return null;
}

/**
 * 将 TextAnchor 映射到 Lexical Range
 * 
 * 这是核心映射函数，将逻辑锚点转换为 Lexical 编辑器中的具体位置。
 * 
 * 【映射策略】
 * 1. 根据 sectionId 找到对应的 Lexical subtree
 * 2. 在该 subtree 中重建"纯文本 + offset → node & offset"的映射
 * 3. 把 anchor.startOffset / anchor.endOffset 映射成 Lexical 中的起止位置
 * 4. 映射失败时返回 null（例如内容被完全改写）
 * 
 * @param anchor - 文本锚点
 * @param editor - Lexical 编辑器实例
 * @returns LexicalRange 或 null（如果映射失败）
 */
export function resolveAnchorToLexicalRange(
  anchor: TextAnchor,
  editor: LexicalEditor
): LexicalRange | null {
  // 验证锚点有效性
  if (!isValidTextAnchor(anchor)) {
    console.warn('[InlineMark] Invalid anchor:', anchor);
    return null;
  }
  
  // 构建节点偏移映射
  const nodeMap = buildNodeOffsetMap(editor, anchor.sectionId);
  
  if (nodeMap.length === 0) {
    console.warn('[InlineMark] No text nodes found in section:', anchor.sectionId);
    return null;
  }
  
  // 映射起始位置
  const startPos = offsetToNodePosition(anchor.startOffset, nodeMap);
  if (!startPos) {
    console.warn('[InlineMark] Failed to map startOffset:', anchor.startOffset);
    return null;
  }
  
  // 映射结束位置
  const endPos = offsetToNodePosition(anchor.endOffset, nodeMap);
  if (!endPos) {
    console.warn('[InlineMark] Failed to map endOffset:', anchor.endOffset);
    return null;
  }
  
  return {
    start: startPos,
    end: endPos,
  };
}

/**
 * 验证锚点的上下文是否仍然匹配
 * 
 * 当文档被编辑后，可以使用此函数检查锚点是否仍然有效。
 * 如果上下文不匹配，说明锚点可能已经失效。
 * 
 * @param anchor - 文本锚点
 * @param editor - Lexical 编辑器实例
 * @returns true 如果上下文匹配或无上下文，false 如果不匹配
 */
export function verifyAnchorContext(
  anchor: TextAnchor,
  editor: LexicalEditor
): boolean {
  const sectionText = getSectionTextFromEditor(editor, anchor.sectionId);
  if (!sectionText) {
    return false;
  }
  
  // 如果没有上下文信息，无法验证，默认返回 true
  if (!anchor.contextBefore && !anchor.contextAfter) {
    return true;
  }
  
  // 检查上下文是否匹配
  if (anchor.contextBefore) {
    const expectedBefore = sectionText.slice(
      Math.max(0, anchor.startOffset - anchor.contextBefore.length),
      anchor.startOffset
    );
    if (expectedBefore !== anchor.contextBefore) {
      console.warn('[InlineMark] Context before mismatch:', {
        expected: anchor.contextBefore,
        actual: expectedBefore,
      });
      return false;
    }
  }
  
  if (anchor.contextAfter) {
    const expectedAfter = sectionText.slice(
      anchor.endOffset,
      Math.min(sectionText.length, anchor.endOffset + anchor.contextAfter.length)
    );
    if (expectedAfter !== anchor.contextAfter) {
      console.warn('[InlineMark] Context after mismatch:', {
        expected: anchor.contextAfter,
        actual: expectedAfter,
      });
      return false;
    }
  }
  
  return true;
}

/**
 * 获取锚点指向的实际文本
 * 
 * @param anchor - 文本锚点
 * @param editor - Lexical 编辑器实例
 * @returns 锚点指向的文本，或 null 如果无法获取
 */
export function getAnchorText(
  anchor: TextAnchor,
  editor: LexicalEditor
): string | null {
  const sectionText = getSectionTextFromEditor(editor, anchor.sectionId);
  if (!sectionText) {
    return null;
  }
  
  if (anchor.startOffset >= sectionText.length) {
    return null;
  }
  
  return sectionText.slice(anchor.startOffset, anchor.endOffset);
}

