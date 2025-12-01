/**
 * MinimalEditor.tsx
 * 
 * A basic Lexical editor setup to replace the "fake" editor.
 * Implements:
 * - Rich Text editing (Bold, Italic, Headings)
 * - History (Undo/Redo)
 * - Theme styling
 * - State reporting to parent
 */

import React, { useEffect, useCallback } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin as LexicalListPlugin } from '@lexical/react/LexicalListPlugin';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode, $isListNode, $isListItemNode } from '@lexical/list';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $generateNodesFromDOM } from '@lexical/html';
import { $getRoot, $insertNodes, LexicalEditor, $getSelection, $isRangeSelection, CAN_UNDO_COMMAND, CAN_REDO_COMMAND, LexicalNode } from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';

import { EditorTheme } from './EditorTheme';
import './EditorTheme.css';
import { ListPlugin } from './plugins/ListPlugin';
import { StylePlugin } from './plugins/StylePlugin';
import { CopilotEventPlugin } from './plugins/CopilotEventPlugin';
import { ParagraphStyle, getStyleFromBlockType } from './styles/paragraphStyles';
import { FontOptionKey, matchFontFamily } from '../config/fonts';
import { FontSizeKey, matchFontSize, LineHeightKey, TextAlignKey } from '../config/typography';
import { getEditorStateProvider } from '../core/commands/EditorStateProvider';
import { syncLexicalToRuntime } from '../core/commands/LexicalBridge';

// ==========================================
// Types
// ==========================================

export interface EditorStateReport {
  activeFormats: string[]; // 'bold', 'italic', 'heading1', etc.
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  // 列表状态
  isBulletList: boolean;
  isNumberedList: boolean;
  indentLevel: number;
  // 段落样式
  paragraphStyle: ParagraphStyle;
  /** 多选时样式是否混合 */
  isMixedStyle: boolean;
  // 字体状态
  currentFontKey: FontOptionKey | null;
  /** 多选时字体是否混合 */
  isMixedFont: boolean;
  // 字号状态
  currentFontSize: FontSizeKey | null;
  isMixedFontSize: boolean;
  // 对齐状态
  currentTextAlign: TextAlignKey | null;
  // 行距状态
  currentLineHeight: LineHeightKey | null;
  isMixedLineHeight: boolean;
}

// ==========================================
// Plugins
// ==========================================

/**
 * Plugin to initialize editor content from HTML
 * 
 * 🔴 重要：加载 HTML 后，必须同步 Lexical 状态到 DocumentRuntime
 * 这样 AST block IDs 才能与 Lexical nodeKeys 对齐，
 * 使得 SectionDocOps / HighlightSpans 的 nodeId 可以正确匹配 AST
 */
const HtmlLoaderPlugin: React.FC<{ initialHtml?: string }> = ({ initialHtml }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (initialHtml !== undefined) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        if (initialHtml) {
          const parser = new DOMParser();
          const dom = parser.parseFromString(initialHtml, 'text/html');
          const nodes = $generateNodesFromDOM(editor, dom);
          root.select();
          $insertNodes(nodes);
        }
      }, { discrete: true });
      
      // 🔴 关键：HTML 加载后，同步 Lexical 状态到 DocumentRuntime
      // 这会用 Lexical nodeKeys 更新 AST block IDs
      // 延迟执行确保 Lexical 状态已稳定
      setTimeout(() => {
        try {
          syncLexicalToRuntime(editor);
          if (process.env.NODE_ENV === 'development') {
            console.log('[HtmlLoaderPlugin] ✅ Synced Lexical state to DocumentRuntime');
          }
        } catch (e) {
          console.warn('[HtmlLoaderPlugin] Failed to sync to DocumentRuntime:', e);
        }
      }, 0);
    }
  }, [editor, initialHtml]);

  return null;
};

/**
 * Plugin to report state changes (selection, formats, history)
 */
const StateReporterPlugin: React.FC<{ onStateChange?: (state: EditorStateReport) => void }> = ({ onStateChange }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onStateChange) return;

    let canUndo = false;
    let canRedo = false;

    // ==========================================
    // 📖 只读监听：Lexical 内部历史状态
    // ==========================================
    // 
    // ⚠️ 重要说明：
    // 这里监听的是 Lexical 内部的 history 状态（CAN_UNDO_COMMAND/CAN_REDO_COMMAND），
    // 仅用于 UI 状态展示（如工具栏按钮的 enabled/disabled）。
    // 
    // 🚫 禁止行为：
    // UI 层的撤销/重做操作必须通过 CommandBus/DocumentRuntime 实现，
    // 而不是直接 dispatch UNDO_COMMAND/REDO_COMMAND 到 Lexical。
    // 
    // 📌 正确做法：
    // - 工具栏按钮 → executeEditorCommand(editor, 'undo') 
    // - executeEditorCommand → CommandBus.executeWithRuntime('undo')
    // - CommandBus → DocumentRuntime.undo()
    // 
    // TODO(docops-boundary): 当 useCommandBusForHistory=true 时，
    // 应该从 DocumentRuntime.canUndo/canRedo 获取状态，而非 Lexical。
    // 参见 EditorStateProvider 的实现。
    // ==========================================
    const unregisterHistory = mergeRegister(
      editor.registerCommand(CAN_UNDO_COMMAND, (payload) => {
        canUndo = payload;
        updateState();
        return false;
      }, 1),
      editor.registerCommand(CAN_REDO_COMMAND, (payload) => {
        canRedo = payload;
        updateState();
        return false;
      }, 1)
    );

    const updateState = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        const hasSelection = $isRangeSelection(selection);
        const activeFormats: string[] = [];
        let isBulletList = false;
        let isNumberedList = false;
        let indentLevel = 0;
        let paragraphStyle: ParagraphStyle = 'normal';
        let isMixedStyle = false;
        let currentFontKey: FontOptionKey | null = null;
        let isMixedFont = false;
        let currentFontSize: FontSizeKey | null = null;
        let isMixedFontSize = false;
        let currentTextAlign: TextAlignKey | null = null;
        let currentLineHeight: LineHeightKey | null = null;
        let isMixedLineHeight = false;

        if ($isRangeSelection(selection)) {
          // Text Formats
          if (selection.hasFormat('bold')) activeFormats.push('toggleBold');
          if (selection.hasFormat('italic')) activeFormats.push('toggleItalic');
          if (selection.hasFormat('underline')) activeFormats.push('toggleUnderline');
          if (selection.hasFormat('strikethrough')) activeFormats.push('toggleStrikethrough');

          // Block Type (simplistic check for anchors)
          const anchorNode = selection.anchor.getNode();
          const element = anchorNode.getKey() === 'root' 
            ? anchorNode 
            : anchorNode.getTopLevelElementOrThrow();
          
          if ($isHeadingNode(element)) {
            const tag = element.getTag();
            if (tag === 'h1') {
              activeFormats.push('setBlockTypeHeading1');
              paragraphStyle = 'heading1';
            }
            if (tag === 'h2') {
              activeFormats.push('setBlockTypeHeading2');
              paragraphStyle = 'heading2';
            }
            if (tag === 'h3') {
              activeFormats.push('setBlockTypeHeading3');
              paragraphStyle = 'heading3';
            }
          } else if (element.getType() === 'paragraph') {
            activeFormats.push('setBlockTypeParagraph');
            paragraphStyle = 'normal';
          }

          // 检查多选时是否有混合样式
          const nodes = selection.getNodes();
          const styles = new Set<ParagraphStyle>();
          const fonts = new Set<FontOptionKey | null>();
          
          for (const node of nodes) {
            const topLevel = node.getTopLevelElementOrThrow();
            if ($isHeadingNode(topLevel)) {
              const tag = topLevel.getTag();
              const level = parseInt(tag.replace('h', ''), 10);
              styles.add(getStyleFromBlockType('heading', level));
            } else if (topLevel.getType() === 'paragraph') {
              styles.add('normal');
            }
            
            // 检查字体和字号
            if (node.getType() === 'text') {
              const style = (node as any).getStyle?.() || '';
              if (style) {
                // 字体
                const fontMatch = style.match(/font-family:\s*([^;]+)/i);
                if (fontMatch) {
                  const fontKey = matchFontFamily(fontMatch[1]);
                  fonts.add(fontKey);
                } else {
                  fonts.add(null);
                }
              } else {
                fonts.add(null);
              }
            }
          }
          
          if (styles.size > 1) {
            isMixedStyle = true;
          }
          
          // 确定当前字体
          if (fonts.size === 1) {
            const firstFont = fonts.values().next().value;
            currentFontKey = firstFont ?? null;
          } else if (fonts.size > 1) {
            isMixedFont = true;
          }

          // 检查字号（从选区样式获取）
          const selectionStyle = selection.style || '';
          if (selectionStyle) {
            const sizeMatch = selectionStyle.match(/font-size:\s*([^;]+)/i);
            if (sizeMatch) {
              currentFontSize = matchFontSize(sizeMatch[1]);
            }
          }

          // 检查对齐（从块级元素获取）
          const formatValue = element.getFormat?.();
          if (formatValue) {
            currentTextAlign = String(formatValue) as TextAlignKey;
          } else {
            currentTextAlign = 'left'; // 默认左对齐
          }

          // 检查列表状态
          let current: LexicalNode | null = anchorNode;
          while (current !== null) {
            if ($isListItemNode(current)) {
              indentLevel = current.getIndent();
              const parent = current.getParent();
              if ($isListNode(parent)) {
                const listType = parent.getListType();
                if (listType === 'bullet') {
                  isBulletList = true;
                  activeFormats.push('toggleBulletList');
                } else if (listType === 'number') {
                  isNumberedList = true;
                  activeFormats.push('toggleNumberedList');
                }
              }
              break;
            }
            current = current.getParent();
          }
        }

        const stateReport = {
          activeFormats,
          canUndo,
          canRedo,
          hasSelection,
          isBulletList,
          isNumberedList,
          indentLevel,
          paragraphStyle,
          isMixedStyle,
          currentFontKey,
          isMixedFont,
          currentFontSize,
          isMixedFontSize,
          currentTextAlign,
          currentLineHeight,
          isMixedLineHeight,
        };

        // 🆕 同步到 EditorStateProvider（用于 DocumentRuntime 集成）
        try {
          getEditorStateProvider().updateLexicalState(stateReport);
        } catch (e) {
          // 静默处理，避免影响主流程
        }

        onStateChange(stateReport);
      });
    };

    // Register update listener
    const unregisterUpdate = editor.registerUpdateListener(() => {
      updateState();
    });

    // Initial check
    updateState();

    return () => {
      unregisterHistory();
      unregisterUpdate();
    };
  }, [editor, onStateChange]);

  return null;
};

/**
 * Expose Editor Instance
 */
const EditorRefPlugin: React.FC<{ onEditorReady?: (editor: LexicalEditor) => void }> = ({ onEditorReady }) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);
  return null;
};

// ==========================================
// Main Component
// ==========================================

const editorConfig = {
  namespace: 'AiOfficeEditor',
  theme: EditorTheme,
  onError(error: Error) {
    console.error('[Lexical Error]', error);
  },
  nodes: [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    LinkNode,
    AutoLinkNode
  ],
};

interface MinimalEditorProps {
  initialHtml?: string;
  onEditorReady?: (editor: LexicalEditor) => void;
  onStateChange?: (state: EditorStateReport) => void;
  onContentChange?: () => void;
  /** 文档 ID（用于 Copilot 事件） */
  documentId?: string;
}

export const MinimalEditor: React.FC<MinimalEditorProps> = ({ 
  initialHtml,
  onEditorReady,
  onStateChange,
  onContentChange,
  documentId,
}) => {
  const handleOnChange = useCallback(() => {
    if (onContentChange) {
      onContentChange();
    }
  }, [onContentChange]);

  return (
    <LexicalComposer initialConfig={editorConfig}>
      <div className="editor-container-inner" style={{ position: 'relative', minHeight: '100%' }}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="editor-input" />
          }
          placeholder={<div className="editor-placeholder">开始输入...</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <AutoFocusPlugin />
        <LexicalListPlugin />
        <ListPlugin />
        <StylePlugin />
        <OnChangePlugin onChange={handleOnChange} ignoreSelectionChange />
        
        <HtmlLoaderPlugin initialHtml={initialHtml} />
        <StateReporterPlugin onStateChange={onStateChange} />
        <EditorRefPlugin onEditorReady={onEditorReady} />
        <CopilotEventPlugin docId={documentId} />
      </div>
    </LexicalComposer>
  );
};
