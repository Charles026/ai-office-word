/**
 * CopilotEventPlugin - Copilot 事件插件
 * 
 * 【职责】
 * - 监听编辑器选区变化
 * - 检测标题聚焦/失焦
 * - 发出 EditorEvent 给 Copilot
 */

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection } from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import {
  emitHeadingFocused,
  emitHeadingBlurred,
  emitSelectionChanged,
} from '../events';

// ==========================================
// 常量
// ==========================================

/** 选区文本最小长度（超过才发送事件） */
const MIN_SELECTION_LENGTH = 10;

/** 选区文本最大截取长度 */
const MAX_SELECTION_SNIPPET = 100;

/** 防抖延迟（毫秒） */
const DEBOUNCE_DELAY = 150;

// ==========================================
// Props
// ==========================================

interface CopilotEventPluginProps {
  /** 当前文档 ID */
  docId?: string;
}

// ==========================================
// 组件
// ==========================================

export const CopilotEventPlugin: React.FC<CopilotEventPluginProps> = ({ docId }) => {
  const [editor] = useLexicalComposerContext();
  
  // 追踪上一次的状态
  const lastHeadingRef = useRef<{ id: string; text: string; level: number } | null>(null);
  const lastSelectionTextRef = useRef<string>('');
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!docId) return;

    const unregister = editor.registerUpdateListener(({ editorState }) => {
      // 清除之前的防抖计时器
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }

      // 防抖处理
      debounceTimerRef.current = window.setTimeout(() => {
        editorState.read(() => {
          const selection = $getSelection();
          
          if (!$isRangeSelection(selection)) {
            // 没有选区，检查是否需要发送 heading_blurred
            if (lastHeadingRef.current) {
              emitHeadingBlurred(docId);
              lastHeadingRef.current = null;
            }
            return;
          }

          // 检查选区文本
          const selectionText = selection.getTextContent();
          
          // 选区变化检测
          if (selectionText !== lastSelectionTextRef.current) {
            lastSelectionTextRef.current = selectionText;

            if (selectionText.length > MIN_SELECTION_LENGTH) {
              // 截取选区文本
              const snippet = selectionText.length > MAX_SELECTION_SNIPPET
                ? selectionText.slice(0, MAX_SELECTION_SNIPPET)
                : selectionText;
              emitSelectionChanged(docId, snippet);
            }
          }

          // 检查是否在标题内
          const anchorNode = selection.anchor.getNode();
          const element = anchorNode.getKey() === 'root'
            ? anchorNode
            : anchorNode.getTopLevelElementOrThrow();

          if ($isHeadingNode(element)) {
            const tag = element.getTag();
            const level = parseInt(tag.replace('h', ''), 10);
            const text = element.getTextContent();
            const id = element.getKey();

            // 检查是否是新的标题
            if (
              !lastHeadingRef.current ||
              lastHeadingRef.current.id !== id ||
              lastHeadingRef.current.text !== text
            ) {
              lastHeadingRef.current = { id, text, level };
              emitHeadingFocused(docId, id, text, level);
            }
          } else {
            // 不在标题内
            if (lastHeadingRef.current) {
              emitHeadingBlurred(docId);
              lastHeadingRef.current = null;
            }
          }
        });
      }, DEBOUNCE_DELAY);
    });

    return () => {
      unregister();
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [editor, docId]);

  return null;
};

export default CopilotEventPlugin;

