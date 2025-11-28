/**
 * DocumentCanvas - AST 驱动的文档渲染组件
 * 
 * 【层级职责】
 * Web Canvas 层负责：
 * - 根据 DocumentAst 渲染 UI
 * - 管理选区状态（不依赖浏览器原生 selection）
 * - 生成 DocOps 响应用户操作
 * 
 * 【选区模型】
 * - 使用 DocSelection 作为选区状态
 * - 选区保存在 Editor State 中，不受 focus 影响
 * - 使用 AST + SelectionSnapshot 在 Canvas 内绘制高亮
 * 
 * 【禁止事项】
 * - 不允许直接修改 DocumentAst
 * - 不允许调用文件系统或 LibreOffice
 * - 所有修改必须通过 onOps 回调发出 DocOps
 */

import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import {
  DocumentAst,
  BlockNode,
  InlineNode,
  TextRunNode,
  getInlineText,
  getBlockText,
  hasInlineChildren,
  getBlockIndex,
} from '../document/types';
import {
  DocSelection,
  SelectionSnapshot,
  isCollapsedSelection,
  normalizeSelection,
  isRangeInSelection,
} from '../document/selection';
import {
  DocOp,
  DocNodeId,
  createOpMeta,
} from '../docops/types';
import './DocumentCanvas.css';

// ==========================================
// Props
// ==========================================

interface DocumentCanvasProps {
  ast: DocumentAst;
  onOps: (ops: DocOp[]) => void;
  readOnly?: boolean;
  /** 当前选区（由上层管理） */
  selection: DocSelection | null;
  /** 选区快照（包含文本，用于高亮） */
  selectionSnapshot: SelectionSnapshot | null;
  /** 选区变化回调 */
  onSelectionChange: (selection: DocSelection | null) => void;
}

// ==========================================
// 内联节点渲染（带选区高亮）
// ==========================================

interface InlineRendererProps {
  nodes: InlineNode[];
  blockId: DocNodeId;
  ast: DocumentAst;
  selection: DocSelection | null;
}

const InlineRenderer: React.FC<InlineRendererProps> = ({
  nodes,
  blockId,
  ast,
  selection,
}) => {
  if (nodes.length === 0) {
    return <span className="empty-line">{'\u200B'}</span>;
  }

  let charOffset = 0;

  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'text') {
          const startOffset = charOffset;
          charOffset += node.text.length;
          
          return (
            <TextRunWithHighlight
              key={node.id || index}
              run={node}
              blockId={blockId}
              startOffset={startOffset}
              ast={ast}
              selection={selection}
            />
          );
        }
        if (node.type === 'link') {
          const linkText = getInlineText(node.children);
          const startOffset = charOffset;
          charOffset += linkText.length;
          
          return (
            <a key={node.id || index} href={node.href} className="doc-link">
              {node.children.map((child, i) => (
                <TextRunWithHighlight
                  key={child.id || i}
                  run={child}
                  blockId={blockId}
                  startOffset={startOffset}
                  ast={ast}
                  selection={selection}
                />
              ))}
            </a>
          );
        }
        return null;
      })}
    </>
  );
};

interface TextRunWithHighlightProps {
  run: TextRunNode;
  blockId: DocNodeId;
  startOffset: number;
  ast: DocumentAst;
  selection: DocSelection | null;
}

/**
 * 带选区高亮的 TextRun 渲染
 */
const TextRunWithHighlight: React.FC<TextRunWithHighlightProps> = ({
  run,
  blockId,
  startOffset,
  ast,
  selection,
}) => {
  let className = 'text-run';
  if (run.marks.bold) className += ' bold';
  if (run.marks.italic) className += ' italic';
  if (run.marks.underline) className += ' underline';
  if (run.marks.strikethrough) className += ' strikethrough';
  if (run.marks.code) className += ' code';

  const text = run.text || '\u200B';
  const endOffset = startOffset + text.length;

  // 检查是否有选区覆盖
  if (selection && !isCollapsedSelection(selection)) {
    const { inSelection, selectedStart, selectedEnd } = isRangeInSelection(
      ast,
      selection,
      blockId,
      startOffset,
      endOffset
    );

    if (inSelection) {
      // 需要拆分渲染：选中部分 + 未选中部分
      const beforeText = text.slice(0, selectedStart);
      const selectedText = text.slice(selectedStart, selectedEnd);
      const afterText = text.slice(selectedEnd);

      return (
        <span className={className} data-run-id={run.id}>
          {beforeText && <span>{beforeText}</span>}
          {selectedText && <span className="selection-highlight">{selectedText}</span>}
          {afterText && <span>{afterText}</span>}
        </span>
      );
    }
  }

  // 处理换行
  const parts = text.split('\n');
  if (parts.length === 1) {
    return (
      <span className={className} data-run-id={run.id}>
        {text}
      </span>
    );
  }

  return (
    <span className={className} data-run-id={run.id}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && <br />}
        </React.Fragment>
      ))}
    </span>
  );
};

// ==========================================
// 块节点渲染
// ==========================================

interface BlockRendererProps {
  block: BlockNode;
  isActiveBlock: boolean;
  ast: DocumentAst;
  selection: DocSelection | null;
  onBlockClick: (blockId: DocNodeId, offset: number) => void;
  readOnly?: boolean;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({
  block,
  isActiveBlock,
  ast,
  selection,
  onBlockClick,
  readOnly,
}) => {
  const blockRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!blockRef.current) return;
    
    // 计算点击位置对应的 offset
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range) {
      const tempRange = document.createRange();
      tempRange.setStart(blockRef.current, 0);
      tempRange.setEnd(range.startContainer, range.startOffset);
      const offset = tempRange.toString().length;
      onBlockClick(block.id, offset);
    } else {
      onBlockClick(block.id, 0);
    }
  }, [block.id, onBlockClick]);

  const getClassName = () => {
    const base = 'doc-block';
    const active = isActiveBlock ? 'active' : '';
    return `${base} ${block.type} ${active}`.trim();
  };

  // 渲染占位符
  if (block.type === 'placeholder') {
    return (
      <div
        ref={blockRef}
        className={getClassName()}
        data-node-id={block.id}
        onClick={handleClick}
      >
        <div className="placeholder-content">
          [{block.label}]
        </div>
      </div>
    );
  }

  // 渲染列表
  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag
        className={getClassName()}
        data-node-id={block.id}
        onClick={handleClick}
      >
        {block.items.map(item => (
          <li key={item.id} data-node-id={item.id}>
            <InlineRenderer
              nodes={item.children}
              blockId={item.id}
              ast={ast}
              selection={selection}
            />
          </li>
        ))}
      </Tag>
    );
  }

  // 渲染段落或标题
  const content = hasInlineChildren(block) ? (
    <InlineRenderer
      nodes={block.children}
      blockId={block.id}
      ast={ast}
      selection={selection}
    />
  ) : null;

  if (block.type === 'heading') {
    const Tag = `h${block.level}` as keyof JSX.IntrinsicElements;
    return (
      <Tag
        className={getClassName()}
        data-node-id={block.id}
        onClick={handleClick}
      >
        <div
          ref={blockRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          className="block-content"
        >
          {content || <span className="block-placeholder">输入内容...</span>}
        </div>
      </Tag>
    );
  }

  // 段落
  return (
    <div
      className={getClassName()}
      data-node-id={block.id}
      onClick={handleClick}
    >
      <div
        ref={blockRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        className="block-content"
      >
        {content || <span className="block-placeholder">输入内容...</span>}
      </div>
    </div>
  );
};

// ==========================================
// DocumentCanvas 主组件
// ==========================================

export const DocumentCanvas: React.FC<DocumentCanvasProps> = ({
  ast,
  onOps,
  readOnly = false,
  selection,
  selectionSnapshot: _selectionSnapshot,
  onSelectionChange,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const isMouseDownRef = useRef(false);
  const anchorPointRef = useRef<{ blockId: DocNodeId; offset: number } | null>(null);

  // 当前活跃的 block（用于显示光标）
  const activeBlockId = useMemo(() => {
    return selection?.focus.blockId ?? null;
  }, [selection]);

  /**
   * 从 DOM 位置计算 AST 中的 offset
   */
  const computeAstOffset = useCallback((container: Node, offset: number, blockElement: HTMLElement): number => {
    try {
      const tempRange = document.createRange();
      tempRange.setStart(blockElement, 0);
      tempRange.setEnd(container, offset);
      return tempRange.toString().length;
    } catch {
      return 0;
    }
  }, []);

  /**
   * 从 DOM 节点查找所属的 block ID
   */
  const findBlockId = useCallback((node: Node): DocNodeId | null => {
    let current: Node | null = node;
    while (current && current !== canvasRef.current) {
      if (current instanceof HTMLElement) {
        const nodeId = current.getAttribute('data-node-id');
        if (nodeId && getBlockIndex(ast, nodeId) !== -1) {
          return nodeId;
        }
      }
      current = current.parentNode;
    }
    return null;
  }, [ast]);

  /**
   * 处理 block 点击
   */
  const handleBlockClick = useCallback((blockId: DocNodeId, offset: number) => {
    onSelectionChange({
      anchor: { blockId, offset },
      focus: { blockId, offset },
    });
  }, [onSelectionChange]);

  /**
   * 处理鼠标按下：开始选区
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly) return;
    
    isMouseDownRef.current = true;

    const blockId = findBlockId(e.target as Node);
    if (!blockId) return;

    const blockEl = canvasRef.current?.querySelector(`[data-node-id="${blockId}"] .block-content`) as HTMLElement;
    if (!blockEl) return;

    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    const offset = computeAstOffset(range.startContainer, range.startOffset, blockEl);
    anchorPointRef.current = { blockId, offset };

    // 如果没有按住 Shift，开始新选区
    if (!e.shiftKey) {
      onSelectionChange({
        anchor: { blockId, offset },
        focus: { blockId, offset },
      });
    } else if (selection) {
      // Shift+Click：扩展选区
      onSelectionChange({
        anchor: selection.anchor,
        focus: { blockId, offset },
      });
    }
  }, [readOnly, findBlockId, computeAstOffset, onSelectionChange, selection]);

  /**
   * 处理鼠标移动：更新选区
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isMouseDownRef.current || !anchorPointRef.current || readOnly) return;

    const blockId = findBlockId(e.target as Node);
    if (!blockId) return;

    const blockEl = canvasRef.current?.querySelector(`[data-node-id="${blockId}"] .block-content`) as HTMLElement;
    if (!blockEl) return;

    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    const offset = computeAstOffset(range.startContainer, range.startOffset, blockEl);

    onSelectionChange({
      anchor: anchorPointRef.current,
      focus: { blockId, offset },
    });
  }, [readOnly, findBlockId, computeAstOffset, onSelectionChange]);

  /**
   * 处理鼠标释放：结束选区
   */
  const handleMouseUp = useCallback(() => {
    isMouseDownRef.current = false;
  }, []);

  /**
   * 处理键盘输入
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (readOnly || !selection) return;

    const meta = createOpMeta('user');
    const { startBlockId, startOffset, endBlockId, endOffset } = normalizeSelection(ast, selection);
    const isCollapsed = isCollapsedSelection(selection);

    // Enter：拆分段落
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      // 如果有选区，先删除
      if (!isCollapsed) {
        onOps([{
          type: 'DeleteRange',
          payload: { startNodeId: startBlockId, startOffset, endNodeId: endBlockId, endOffset },
          meta,
        }]);
      }

      onOps([{
        type: 'SplitBlock',
        payload: { nodeId: startBlockId, offset: isCollapsed ? selection.focus.offset : startOffset },
        meta,
      }]);
      return;
    }

    // Shift+Enter：软换行
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();

      if (!isCollapsed) {
        onOps([{
          type: 'DeleteRange',
          payload: { startNodeId: startBlockId, startOffset, endNodeId: endBlockId, endOffset },
          meta,
        }]);
      }

      onOps([{
        type: 'InsertLineBreak',
        payload: { nodeId: startBlockId, offset: isCollapsed ? selection.focus.offset : startOffset },
        meta,
      }]);
      return;
    }

    // Backspace
    if (e.key === 'Backspace') {
      if (!isCollapsed) {
        e.preventDefault();
        onOps([{
          type: 'DeleteRange',
          payload: { startNodeId: startBlockId, startOffset, endNodeId: endBlockId, endOffset },
          meta,
        }]);
        // 光标移到删除起点
        onSelectionChange({
          anchor: { blockId: startBlockId, offset: startOffset },
          focus: { blockId: startBlockId, offset: startOffset },
        });
        return;
      }

      // 光标在段首，需要合并段落
      if (selection.focus.offset === 0) {
        const blockIndex = getBlockIndex(ast, selection.focus.blockId);
        if (blockIndex > 0) {
          e.preventDefault();
          const prevBlock = ast.blocks[blockIndex - 1];
          const prevBlockText = getBlockText(prevBlock);
          // 删除当前 block，合并到上一个
          onOps([{
            type: 'DeleteNode',
            payload: { nodeId: selection.focus.blockId },
            meta,
          }]);
          // 光标移到上一段末尾
          onSelectionChange({
            anchor: { blockId: prevBlock.id, offset: prevBlockText.length },
            focus: { blockId: prevBlock.id, offset: prevBlockText.length },
          });
        }
        return;
      }
    }

    // 方向键处理
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const direction = e.key === 'ArrowLeft' ? -1 : 1;
      const currentBlock = ast.blocks.find(b => b.id === selection.focus.blockId);
      if (!currentBlock) return;

      const blockText = getBlockText(currentBlock);
      let newOffset = selection.focus.offset + direction;
      let newBlockId = selection.focus.blockId;

      // 边界处理
      if (newOffset < 0) {
        const blockIndex = getBlockIndex(ast, selection.focus.blockId);
        if (blockIndex > 0) {
          const prevBlock = ast.blocks[blockIndex - 1];
          newBlockId = prevBlock.id;
          newOffset = getBlockText(prevBlock).length;
        } else {
          newOffset = 0;
        }
      } else if (newOffset > blockText.length) {
        const blockIndex = getBlockIndex(ast, selection.focus.blockId);
        if (blockIndex < ast.blocks.length - 1) {
          const nextBlock = ast.blocks[blockIndex + 1];
          newBlockId = nextBlock.id;
          newOffset = 0;
        } else {
          newOffset = blockText.length;
        }
      }

      e.preventDefault();

      if (e.shiftKey) {
        // Shift+方向键：扩展选区
        onSelectionChange({
          anchor: selection.anchor,
          focus: { blockId: newBlockId, offset: newOffset },
        });
      } else {
        // 普通方向键：移动光标
        onSelectionChange({
          anchor: { blockId: newBlockId, offset: newOffset },
          focus: { blockId: newBlockId, offset: newOffset },
        });
      }
      return;
    }

    // 上下方向键
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const direction = e.key === 'ArrowUp' ? -1 : 1;
      const blockIndex = getBlockIndex(ast, selection.focus.blockId);
      const newBlockIndex = blockIndex + direction;

      if (newBlockIndex >= 0 && newBlockIndex < ast.blocks.length) {
        e.preventDefault();
        const newBlock = ast.blocks[newBlockIndex];
        const newBlockText = getBlockText(newBlock);
        const newOffset = Math.min(selection.focus.offset, newBlockText.length);

        if (e.shiftKey) {
          onSelectionChange({
            anchor: selection.anchor,
            focus: { blockId: newBlock.id, offset: newOffset },
          });
        } else {
          onSelectionChange({
            anchor: { blockId: newBlock.id, offset: newOffset },
            focus: { blockId: newBlock.id, offset: newOffset },
          });
        }
      }
      return;
    }

    // Cmd/Ctrl+A：全选
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      if (ast.blocks.length > 0) {
        const firstBlock = ast.blocks[0];
        const lastBlock = ast.blocks[ast.blocks.length - 1];
        const lastBlockText = getBlockText(lastBlock);
        onSelectionChange({
          anchor: { blockId: firstBlock.id, offset: 0 },
          focus: { blockId: lastBlock.id, offset: lastBlockText.length },
        });
      }
      return;
    }
  }, [readOnly, selection, ast, onOps, onSelectionChange]);

  /**
   * 处理文本输入（通过 beforeinput 事件）
   */
  const handleBeforeInput = useCallback((e: InputEvent) => {
    if (readOnly || !selection) return;

    const inputType = e.inputType;
    const data = e.data;

    // 只处理普通文本输入
    if (inputType === 'insertText' && data) {
      e.preventDefault();

      const meta = createOpMeta('user');
      const { startBlockId, startOffset, endBlockId, endOffset } = normalizeSelection(ast, selection);
      const isCollapsed = isCollapsedSelection(selection);

      // 如果有选区，先删除
      if (!isCollapsed) {
        onOps([{
          type: 'DeleteRange',
          payload: { startNodeId: startBlockId, startOffset, endNodeId: endBlockId, endOffset },
          meta,
        }]);
      }

      // 插入文本
      onOps([{
        type: 'InsertText',
        payload: {
          nodeId: startBlockId,
          offset: isCollapsed ? selection.focus.offset : startOffset,
          text: data,
        },
        meta,
      }]);

      // 移动光标
      const newOffset = (isCollapsed ? selection.focus.offset : startOffset) + data.length;
      onSelectionChange({
        anchor: { blockId: startBlockId, offset: newOffset },
        focus: { blockId: startBlockId, offset: newOffset },
      });
    }
  }, [readOnly, selection, ast, onOps, onSelectionChange]);

  // 监听 beforeinput
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handler = (e: Event) => handleBeforeInput(e as InputEvent);
    canvas.addEventListener('beforeinput', handler);
    return () => canvas.removeEventListener('beforeinput', handler);
  }, [handleBeforeInput]);

  // 全局鼠标释放
  useEffect(() => {
    const handler = () => {
      isMouseDownRef.current = false;
    };
    document.addEventListener('mouseup', handler);
    return () => document.removeEventListener('mouseup', handler);
  }, []);

  return (
    <div
      className="document-canvas"
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="document-content">
        {ast.blocks.map(block => (
          <BlockRenderer
            key={block.id}
            block={block}
            isActiveBlock={block.id === activeBlockId}
            ast={ast}
            selection={selection}
            onBlockClick={handleBlockClick}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
};

export default DocumentCanvas;
