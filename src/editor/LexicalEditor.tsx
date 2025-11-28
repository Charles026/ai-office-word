/**
 * Lexical Editor Component
 * 
 * 【职责】
 * - 前端富文本编辑内核
 * - 接收 initialHtml 并初始化编辑器状态
 * - 暴露 LexicalEditorContext 供外部控制
 * 
 * 【架构】
 * - 使用 @lexical/react 提供的 Composer, Plugin, ContentEditable
 * - 通过 htmlToLexicalState 实现 HTML 导入
 */

import React, { useCallback, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalEditor as LexicalEditorType } from 'lexical';

import { EditorTheme } from './EditorTheme';
import './EditorTheme.css';
import { htmlToLexicalState } from '../format/lexical';
import { executeEditorCommand } from '../core/commands/LexicalAdapter';
import { LexicalEditorContext } from './LexicalEditorContext';

// ==========================================
// Plugins
// ==========================================

/**
 * HTML State Loader Plugin
 * 
 * 监听 initialHtml 变化并重新初始化编辑器状态
 */
const HtmlStatePlugin: React.FC<{ initialHtml?: string }> = ({ initialHtml }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (initialHtml !== undefined) {
      const updateState = htmlToLexicalState(initialHtml || '');
      editor.update(() => {
        updateState(editor);
      });
    }
  }, [editor, initialHtml]);

  return null;
};

/**
 * Editor Ref Plugin
 */
const EditorRefPlugin: React.FC<{ setEditor: (editor: LexicalEditorType) => void }> = ({ setEditor }) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    setEditor(editor);
  }, [editor, setEditor]);
  return null;
};

// ==========================================
// Main Component
// ==========================================

export interface LexicalEditorProps {
  initialHtml?: string;
  onChange?: (editorState: any, editor: LexicalEditorType) => void;
}

export interface LexicalEditorRef {
  applyCommand: (commandId: string, payload?: any) => void;
  editor: LexicalEditorType | null;
}

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

export const LexicalEditor = forwardRef<LexicalEditorRef, LexicalEditorProps>(({ 
  initialHtml,
  onChange: _onChange
}, ref) => {
  const [editor, setEditor] = useState<LexicalEditorType | null>(null);

  const applyCommand = useCallback((commandId: string, payload?: any) => {
    if (editor) {
      executeEditorCommand(editor, commandId, payload);
    }
  }, [editor]);

  useImperativeHandle(ref, () => ({
    applyCommand,
    editor
  }));

  return (
    <LexicalEditorContext.Provider value={{ editor, applyCommand }}>
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
          
          <HtmlStatePlugin initialHtml={initialHtml} />
          <EditorRefPlugin setEditor={setEditor} />
          
          {/* OnChange Plugin can be added here if needed */}
        </div>
      </LexicalComposer>
    </LexicalEditorContext.Provider>
  );
});

LexicalEditor.displayName = 'LexicalEditor';

