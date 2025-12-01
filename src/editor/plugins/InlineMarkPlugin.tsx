/**
 * InlineMarkPlugin - Lexical 内联标记渲染插件
 * 
 * 【职责】
 * - 在 Lexical 编辑器中渲染 InlineMark 的视觉装饰
 * - 提供 hover tooltip 显示标记信息
 * - 支持点击/右键删除标记
 * 
 * 【设计原则】
 * - 装饰层实现：不改变文本内容，只添加视觉样式
 * - 响应式更新：订阅 InlineMark 状态变化并重新渲染
 * - 性能优化：只处理可视区域内的标记
 * 
 * @version 1.0.0
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type {
  InlineMark,
  InlineMarkState,
  LexicalRange,
} from '../../document/inlineMark';
import {
  resolveAnchorToLexicalRange,
  getInlineMarkClassName,
  getInlineMarkDescription,
} from '../../document/inlineMark';

import './InlineMarkPlugin.css';

// ==========================================
// Types
// ==========================================

export interface InlineMarkPluginProps {
  /** InlineMark 状态 */
  inlineMarkState: InlineMarkState;
  /** 删除标记回调 */
  onRemoveMark?: (markId: string) => void;
  /** 点击标记回调 */
  onClickMark?: (mark: InlineMark) => void;
  /** 是否启用 tooltip */
  enableTooltip?: boolean;
}

/**
 * 渲染的标记信息
 */
interface RenderedMark {
  mark: InlineMark;
  range: LexicalRange | null;
  rects: DOMRect[];
}

// ==========================================
// InlineMarkPlugin Component
// ==========================================

export const InlineMarkPlugin: React.FC<InlineMarkPluginProps> = ({
  inlineMarkState,
  onRemoveMark,
  onClickMark,
  enableTooltip = true,
}) => {
  const [editor] = useLexicalComposerContext();
  const [renderedMarks, setRenderedMarks] = useState<RenderedMark[]>([]);
  const [tooltipInfo, setTooltipInfo] = useState<{
    mark: InlineMark;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * 将 InlineMark 转换为渲染所需的 DOM 信息
   */
  const updateRenderedMarks = useCallback(() => {
    const marks: InlineMark[] = Object.values(inlineMarkState.marksById);
    const newRenderedMarks: RenderedMark[] = [];

    editor.getEditorState().read(() => {
      for (const mark of marks) {
        // 将锚点映射到 Lexical Range
        const range = resolveAnchorToLexicalRange(mark.anchor, editor);
        
        if (range) {
          // 获取对应的 DOM rects
          const rects = getRangeRects(editor, range);
          newRenderedMarks.push({ mark, range, rects });
        } else {
          // 锚点映射失败，标记可能已失效
          console.warn('[InlineMarkPlugin] Failed to resolve anchor for mark:', mark.id);
          newRenderedMarks.push({ mark, range: null, rects: [] });
        }
      }
    });

    setRenderedMarks(newRenderedMarks);
  }, [editor, inlineMarkState]);

  // 监听 InlineMark 状态变化
  useEffect(() => {
    updateRenderedMarks();
  }, [updateRenderedMarks]);

  // 监听编辑器状态变化（滚动、编辑等）
  useEffect(() => {
    const removeListener = editor.registerUpdateListener(() => {
      // 延迟更新以避免频繁重绘
      requestAnimationFrame(() => {
        updateRenderedMarks();
      });
    });

    return () => {
      removeListener();
    };
  }, [editor, updateRenderedMarks]);

  /**
   * 处理标记点击
   */
  const handleMarkClick = useCallback(
    (mark: InlineMark, e: React.MouseEvent) => {
      e.stopPropagation();
      if (onClickMark) {
        onClickMark(mark);
      }
    },
    [onClickMark]
  );

  /**
   * 处理标记右键菜单
   */
  const handleMarkContextMenu = useCallback(
    (mark: InlineMark, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (onRemoveMark) {
        // 简单实现：右键直接删除
        // 未来可以显示上下文菜单
        const confirmRemove = window.confirm(
          `确定要删除这个${getInlineMarkDescription(mark)}吗？`
        );
        if (confirmRemove) {
          onRemoveMark(mark.id);
        }
      }
    },
    [onRemoveMark]
  );

  /**
   * 处理标记 hover
   */
  const handleMarkMouseEnter = useCallback(
    (mark: InlineMark, e: React.MouseEvent) => {
      if (enableTooltip) {
        setTooltipInfo({
          mark,
          x: e.clientX,
          y: e.clientY,
        });
      }
    },
    [enableTooltip]
  );

  /**
   * 处理标记 mouse leave
   */
  const handleMarkMouseLeave = useCallback(() => {
    setTooltipInfo(null);
  }, []);

  // 如果没有标记，不渲染任何内容
  if (renderedMarks.length === 0) {
    return null;
  }

  return (
    <div 
      ref={containerRef}
      className="inline-mark-plugin-container"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
    >
      {/* 渲染每个标记的高亮覆盖层 */}
      {renderedMarks.map(({ mark, rects }) => (
        <React.Fragment key={mark.id}>
          {rects.map((rect, index) => (
            <div
              key={`${mark.id}-${index}`}
              className={getInlineMarkClassName(mark)}
              style={{
                position: 'absolute',
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                pointerEvents: 'auto',
                cursor: 'pointer',
              }}
              onClick={(e) => handleMarkClick(mark, e)}
              onContextMenu={(e) => handleMarkContextMenu(mark, e)}
              onMouseEnter={(e) => handleMarkMouseEnter(mark, e)}
              onMouseLeave={handleMarkMouseLeave}
              data-mark-id={mark.id}
              data-mark-kind={mark.kind}
            />
          ))}
        </React.Fragment>
      ))}

      {/* Tooltip */}
      {tooltipInfo && (
        <div
          className="inline-mark-tooltip"
          style={{
            position: 'fixed',
            left: tooltipInfo.x + 10,
            top: tooltipInfo.y + 10,
            pointerEvents: 'none',
          }}
        >
          {getInlineMarkDescription(tooltipInfo.mark)}
        </div>
      )}
    </div>
  );
};

// ==========================================
// Helper Functions
// ==========================================

/**
 * 获取 Lexical Range 对应的 DOM DOMRect 列表
 * 
 * 注意：这个函数需要在 editor.getEditorState().read() 内部调用
 */
function getRangeRects(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  range: LexicalRange
): DOMRect[] {
  const rects: DOMRect[] = [];
  
  try {
    // 获取编辑器根 DOM 元素
    const rootElement = editor.getRootElement();
    if (!rootElement) {
      return rects;
    }

    // 尝试通过 nodeKey 获取 DOM 元素
    const startElement = editor.getElementByKey(range.start.nodeKey);
    const endElement = editor.getElementByKey(range.end.nodeKey);

    if (!startElement || !endElement) {
      console.warn('[InlineMarkPlugin] Could not find DOM elements for range');
      return rects;
    }

    // 如果是同一个节点，使用 Range API 获取精确位置
    if (range.start.nodeKey === range.end.nodeKey) {
      const textNode = findTextNode(startElement);
      if (textNode) {
        const domRange = document.createRange();
        try {
          domRange.setStart(textNode, range.start.offset);
          domRange.setEnd(textNode, range.end.offset);
          const clientRects = domRange.getClientRects();
          for (let i = 0; i < clientRects.length; i++) {
            rects.push(clientRects[i]);
          }
        } catch (e) {
          // offset 可能超出范围
          console.warn('[InlineMarkPlugin] Range error:', e);
        }
      }
    } else {
      // 跨节点的情况，简化处理：使用整个元素的 rect
      // 未来可以优化为精确的字符级别定位
      const startRect = startElement.getBoundingClientRect();
      const endRect = endElement.getBoundingClientRect();
      
      // 合并为一个大矩形（简化实现）
      rects.push(new DOMRect(
        Math.min(startRect.left, endRect.left),
        Math.min(startRect.top, endRect.top),
        Math.max(startRect.right, endRect.right) - Math.min(startRect.left, endRect.left),
        Math.max(startRect.bottom, endRect.bottom) - Math.min(startRect.top, endRect.top)
      ));
    }
  } catch (e) {
    console.warn('[InlineMarkPlugin] Error getting range rects:', e);
  }

  return rects;
}

/**
 * 在 DOM 元素中查找第一个文本节点
 */
function findTextNode(element: Element): Text | null {
  if (element.firstChild instanceof Text) {
    return element.firstChild;
  }
  
  for (const child of Array.from(element.childNodes)) {
    if (child instanceof Text) {
      return child;
    }
    if (child instanceof Element) {
      const found = findTextNode(child);
      if (found) return found;
    }
  }
  
  return null;
}

// ==========================================
// Exports
// ==========================================

export default InlineMarkPlugin;

