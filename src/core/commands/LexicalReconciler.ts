/**
 * Lexical Reconciler - AST 到 Lexical 的同步器
 * 
 * 【职责】
 * - 将 DocumentAst 的变更同步到 Lexical 编辑器
 * - 将 DocSelection 同步到 Lexical 选区
 * 
 * 【策略】
 * v1: 粗暴重渲染 - 每次变更后用 AST 全量重建 Lexical 内容
 * v2: 增量更新 - 只更新变化的部分（性能优化）
 * 
 * 【设计原则】
 * - Lexical 只是渲染器，不是 Source of Truth
 * - 所有状态变更都来自 DocumentRuntime
 */

import { LexicalEditor, $getRoot, $createParagraphNode, $createTextNode, $setSelection, $createRangeSelection, $isElementNode } from 'lexical';
import { $createHeadingNode, HeadingTagType } from '@lexical/rich-text';
import { DocumentAst, BlockNode, InlineNode, hasInlineChildren } from '../../document/types';
import { DocSelection } from '../../document/selection';

// ==========================================
// Reconciler 接口
// ==========================================

export interface ReconcileOptions {
  /**
   * 是否保留焦点
   */
  preserveFocus?: boolean;
  
  /**
   * 同步后的选区
   */
  selection?: DocSelection | null;
}

// ==========================================
// AST 到 Lexical 的同步
// ==========================================

/**
 * 将 DocumentAst 同步到 Lexical 编辑器
 * 
 * v1 实现：全量重建
 * 
 * 🔴 重要：处理空 AST 的情况，确保 Lexical 至少有一个段落节点
 * 
 * @param editor - Lexical 编辑器实例
 * @param ast - 目标 DocumentAst
 * @param options - 同步选项
 */
export function reconcileAstToLexical(
  editor: LexicalEditor,
  ast: DocumentAst,
  options: ReconcileOptions = {}
): void {
  const { selection } = options;

  editor.update(() => {
    const root = $getRoot();
    
    // 清空现有内容
    root.clear();

    // 🔴 空 AST 保护：确保至少有一个段落
    if (!ast.blocks || ast.blocks.length === 0) {
      const emptyParagraph = $createParagraphNode();
      root.append(emptyParagraph);
      return;
    }

    // 重建每个 block
    for (const block of ast.blocks) {
      const lexicalNode = createLexicalNodeFromBlock(block);
      if (lexicalNode) {
        root.append(lexicalNode);
      }
    }

    // 🔴 确保至少有一个节点（防止 createLexicalNodeFromBlock 全部返回 null）
    if (root.getChildrenSize() === 0) {
      const emptyParagraph = $createParagraphNode();
      root.append(emptyParagraph);
    }

    // 设置选区
    if (selection) {
      reconcileSelectionToLexical(editor, ast, selection);
    }
  }, { 
    tag: 'reconcile',
    discrete: true, // 同步执行，避免批处理延迟
  });
}

/**
 * 从 BlockNode 创建对应的 Lexical 节点
 * 
 * 🔴 重要：必须保留每个 TextRunNode 的 marks，不能合并成单个纯文本节点
 */
function createLexicalNodeFromBlock(block: BlockNode) {
  switch (block.type) {
    case 'paragraph': {
      const paragraph = $createParagraphNode();
      if (hasInlineChildren(block)) {
        // 为每个 InlineNode 创建对应的 Lexical TextNode，保留 marks
        appendInlineNodesToLexical(paragraph, block.children);
      }
      return paragraph;
    }

    case 'heading': {
      const tag = `h${block.level}` as HeadingTagType;
      const heading = $createHeadingNode(tag);
      if (hasInlineChildren(block)) {
        // 为每个 InlineNode 创建对应的 Lexical TextNode，保留 marks
        appendInlineNodesToLexical(heading, block.children);
      }
      return heading;
    }

    // TODO: 支持更多 block 类型
    // case 'list':
    // case 'code':
    // case 'quote':

    default:
      console.warn(`[Reconciler] Unsupported block type: ${block.type}`);
      return null;
  }
}

/**
 * 将 InlineNode 数组转换为 Lexical TextNode 并添加到父节点
 * 
 * 🔴 关键：每个 TextRunNode 保留自己的 marks（bold/italic/underline 等）
 */
function appendInlineNodesToLexical(
  parent: ReturnType<typeof $createParagraphNode> | ReturnType<typeof $createHeadingNode>,
  children: InlineNode[]
): void {
  for (const child of children) {
    if (child.type === 'text') {
      const textNode = $createTextNode(child.text);
      
      // 应用 marks
      if (child.marks) {
        if (child.marks.bold) textNode.toggleFormat('bold');
        if (child.marks.italic) textNode.toggleFormat('italic');
        if (child.marks.underline) textNode.toggleFormat('underline');
        if (child.marks.strikethrough) textNode.toggleFormat('strikethrough');
        if (child.marks.code) textNode.toggleFormat('code');
      }
      
      parent.append(textNode);
    } else if (child.type === 'link') {
      // TODO: 支持 LinkNode
      // 暂时将 link 内容作为普通文本处理
      for (const linkChild of child.children) {
        if (linkChild.type === 'text') {
          const textNode = $createTextNode(linkChild.text);
          if (linkChild.marks) {
            if (linkChild.marks.bold) textNode.toggleFormat('bold');
            if (linkChild.marks.italic) textNode.toggleFormat('italic');
            if (linkChild.marks.underline) textNode.toggleFormat('underline');
            if (linkChild.marks.strikethrough) textNode.toggleFormat('strikethrough');
          }
          parent.append(textNode);
        }
      }
    }
  }
}

// ==========================================
// 选区同步
// ==========================================

/**
 * 将 DocSelection 同步到 Lexical 选区
 * 
 * 注意：这需要在 editor.update() 内部调用
 * 
 * 🔴 重要：处理空 AST 和选区不匹配的情况
 */
function reconcileSelectionToLexical(
  _editor: LexicalEditor,
  ast: DocumentAst,
  selection: DocSelection
): void {
  // 🔴 空 AST 保护
  if (!ast.blocks || ast.blocks.length === 0) {
    console.warn('[Reconciler] Cannot set selection on empty AST');
    return;
  }

  // 找到对应的 Lexical 节点
  // v1: 简化实现 - 通过 block index 定位
  
  const root = $getRoot();
  const children = root.getChildren();

  // 🔴 空 Lexical 树保护
  if (children.length === 0) {
    console.warn('[Reconciler] Cannot set selection on empty Lexical tree');
    return;
  }

  const anchorBlockIndex = ast.blocks.findIndex(b => b.id === selection.anchor.blockId);
  const focusBlockIndex = ast.blocks.findIndex(b => b.id === selection.focus.blockId);

  if (anchorBlockIndex === -1 || focusBlockIndex === -1) {
    console.warn('[Reconciler] Selection block not found, falling back to first block');
    // 🔴 回退到第一个 block
    const firstChild = children[0];
    if (firstChild && $isElementNode(firstChild)) {
      const lexicalSelection = $createRangeSelection();
      lexicalSelection.anchor.set(firstChild.getKey(), 0, 'element');
      lexicalSelection.focus.set(firstChild.getKey(), 0, 'element');
      $setSelection(lexicalSelection);
    }
    return;
  }

  const anchorNode = children[anchorBlockIndex];
  const focusNode = children[focusBlockIndex];

  if (!anchorNode || !focusNode) {
    console.warn('[Reconciler] Lexical node not found for selection');
    return;
  }

  // 创建 Lexical 选区
  const lexicalSelection = $createRangeSelection();
  
  // 获取文本节点（需要检查是否是 ElementNode）
  const anchorTextNode = $isElementNode(anchorNode) ? anchorNode.getFirstChild() : null;
  const focusTextNode = $isElementNode(focusNode) ? focusNode.getFirstChild() : null;

  if (anchorTextNode && focusTextNode) {
    // 需要找到正确的文本节点和偏移量
    // v1: 简化实现 - 假设选区在第一个文本节点内
    // TODO: v2 需要根据 offset 找到正确的文本节点
    const { textNode: anchorTarget, offset: anchorOffset } = findTextNodeAtOffset(
      anchorNode,
      selection.anchor.offset
    );
    const { textNode: focusTarget, offset: focusOffset } = findTextNodeAtOffset(
      focusNode,
      selection.focus.offset
    );

    if (anchorTarget && focusTarget) {
      lexicalSelection.anchor.set(
        anchorTarget.getKey(),
        anchorOffset,
        'text'
      );
      lexicalSelection.focus.set(
        focusTarget.getKey(),
        focusOffset,
        'text'
      );
      
      $setSelection(lexicalSelection);
    }
  } else {
    // 如果没有文本节点，选中 element
    lexicalSelection.anchor.set(
      anchorNode.getKey(),
      selection.anchor.offset,
      'element'
    );
    lexicalSelection.focus.set(
      focusNode.getKey(),
      selection.focus.offset,
      'element'
    );
    
    $setSelection(lexicalSelection);
  }
}

/**
 * 在 ElementNode 中根据字符偏移量找到对应的 TextNode
 * 
 * @returns 目标 TextNode 和在该节点内的偏移量
 */
function findTextNodeAtOffset(
  elementNode: any, // LexicalNode
  globalOffset: number
): { textNode: any | null; offset: number } {
  if (!$isElementNode(elementNode)) {
    return { textNode: null, offset: 0 };
  }

  const children = elementNode.getChildren();
  let currentOffset = 0;

  for (const child of children) {
    const textContent = child.getTextContent();
    const childLength = textContent.length;

    if (currentOffset + childLength >= globalOffset) {
      // 找到了目标节点
      return {
        textNode: child,
        offset: globalOffset - currentOffset,
      };
    }

    currentOffset += childLength;
  }

  // 如果偏移量超出范围，返回最后一个节点的末尾
  const lastChild = children[children.length - 1];
  if (lastChild) {
    return {
      textNode: lastChild,
      offset: lastChild.getTextContent().length,
    };
  }

  return { textNode: null, offset: 0 };
}

// ==========================================
// 增量更新（v2 预留）
// ==========================================

/**
 * 增量更新 Lexical（v2 实现）
 * 
 * TODO: 实现基于 diff 的增量更新
 * - 比较新旧 AST
 * - 只更新变化的节点
 * - 保持未变化节点的 Lexical key，避免不必要的重渲染
 */
export function reconcileAstToLexicalIncremental(
  _editor: LexicalEditor,
  _prevAst: DocumentAst,
  _nextAst: DocumentAst,
  _options: ReconcileOptions = {}
): void {
  // TODO: v2 实现
  console.warn('[Reconciler] Incremental reconcile not yet implemented');
}

