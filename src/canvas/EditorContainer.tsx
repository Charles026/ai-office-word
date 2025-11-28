/**
 * EditorContainer - Lexical Editor Wrapper
 * 
 * Replaces the old "fake" editor with a real Lexical editor.
 * Connects the Ribbon (Command Layer) to Lexical.
 * Integrates with DocAgent for AI operations.
 */

import { useState, useCallback, useImperativeHandle, forwardRef, useEffect } from 'react';
import { LexicalEditor, $getSelection } from 'lexical';
import { MinimalEditor, EditorStateReport } from '../editor/MinimalEditor';
export type { EditorStateReport };
import { executeEditorCommand } from '../core/commands/LexicalAdapter';
import { lexicalStateToHtml } from '../format/lexical';
import { AiRewriteDialog } from './AiRewriteDialog';
import type { RibbonCommandId } from '../ribbon/types.tsx';
import { ParagraphStyle } from '../editor/styles/paragraphStyles';
import { FontOptionKey } from '../config/fonts';
import { FontSizeKey, LineHeightKey, TextAlignKey } from '../config/typography';
import { OutlineItem, generateOutlineFromEditor, getSectionContent } from '../outline';
import { isSectionCommandRunning } from '../copilot/copilotRuntimeBridge';
import './EditorContainer.css';

// ==========================================
// DocAgent 类型（与 window.d.ts 保持一致）
// ==========================================

type RewriteTone = 'formal' | 'concise' | 'friendly';
type TranslateTargetLang = 'en' | 'zh';
type DocAgentAction = 'replace' | 'insertAfter';

interface DocAgentIntent {
  type: 'rewrite' | 'summarize' | 'translate' | 'custom';
  tone?: RewriteTone;
  targetLang?: TranslateTargetLang;
  customPrompt?: string;
}

interface DocAgentResponse {
  success: boolean;
  text?: string;
  action: DocAgentAction;
  error?: string;
  latencyMs?: number;
}

// ==========================================
// Command Mapping
// ==========================================

const RIBBON_TO_LEXICAL: Record<string, string> = {
  // 文本格式
  'font:bold': 'toggleBold',
  'font:italic': 'toggleItalic',
  'font:underline': 'toggleUnderline',
  'font:strikethrough': 'toggleStrikethrough',
  'font:clear-format': 'clearFormat',
  // 块类型
  'style:heading-1': 'setBlockTypeHeading1',
  'style:heading-2': 'setBlockTypeHeading2',
  'style:heading-3': 'setBlockTypeHeading3',
  'style:paragraph': 'setBlockTypeParagraph',
  // 历史
  'edit:undo': 'undo',
  'edit:redo': 'redo',
  // 列表
  'paragraph:list-bullet': 'toggleBulletList',
  'paragraph:list-number': 'toggleNumberedList',
  // 缩进
  'paragraph:indent-increase': 'indentIncrease',
  'paragraph:indent-decrease': 'indentDecrease',
};

const LEXICAL_TO_RIBBON: Record<string, RibbonCommandId> = {
  'toggleBold': 'font:bold',
  'toggleItalic': 'font:italic',
  'toggleUnderline': 'font:underline',
  'setBlockTypeHeading1': 'style:heading-1',
  'setBlockTypeHeading2': 'style:heading-2',
  'setBlockTypeHeading3': 'style:heading-3',
  'setBlockTypeParagraph': 'style:paragraph',
  // 列表状态
  'toggleBulletList': 'paragraph:list-bullet',
  'toggleNumberedList': 'paragraph:list-number',
};

// ==========================================
// Types
// ==========================================

export interface EditorContainerProps {
  initialHtml?: string;
  initialAst?: any; // Deprecated, kept for compatibility
  onSave?: (content: string, isSaveAs?: boolean) => Promise<void>;
  onDirty?: () => void; // New prop for dirty tracking
  onStateChange?: (state: {
    activeCommands: RibbonCommandId[];
    canUndo: boolean;
    canRedo: boolean;
    hasSelection: boolean;
    paragraphStyle: ParagraphStyle;
    isMixedStyle: boolean;
    currentFontKey: FontOptionKey | null;
    isMixedFont: boolean;
    currentFontSize: FontSizeKey | null;
    isMixedFontSize: boolean;
    currentTextAlign: TextAlignKey | null;
    currentLineHeight: LineHeightKey | null;
    isMixedLineHeight: boolean;
  }) => void;
  documentId?: string;
  readOnly?: boolean;
  /** 编辑器就绪回调 */
  onEditorReady?: (editor: LexicalEditor) => void;
  /** Outline 更新回调 */
  onOutlineUpdate?: (items: OutlineItem[], docId?: string) => void;
}

export interface EditorContainerRef {
  executeCommand: (cmd: RibbonCommandId) => void;
  applyFont: (fontKey: FontOptionKey) => void;
  applyFontSize: (size: FontSizeKey) => void;
  applyTextAlign: (align: TextAlignKey) => void;
  applyLineHeight: (lineHeight: LineHeightKey) => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  activeFormats: RibbonCommandId[];
  /** 执行章节 AI 操作 */
  executeSectionAiAction: (action: string, headingId: string) => void;
}

// ==========================================
// Component
// ==========================================

export const EditorContainer = forwardRef<EditorContainerRef, EditorContainerProps>(({
  initialHtml,
  onSave,
  onDirty,
  onStateChange,
  onEditorReady,
  onOutlineUpdate,
  documentId,
  // readOnly = false, // TODO: Implement read-only mode
}, ref) => {
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  
  // State
  const [activeFormats, setActiveFormats] = useState<RibbonCommandId[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  // AI Dialog
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [selectionText, setSelectionText] = useState('');
  
  // Section AI Dialog
  const [_showSectionAiDialog, _setShowSectionAiDialog] = useState(false);
  void _showSectionAiDialog; void _setShowSectionAiDialog;
  const [, setSectionAiAction] = useState<string>('');
  const [, setSectionHeadingId] = useState<string>('');
  const [, setSectionAiLoading] = useState(false);
  const [, setSectionAiError] = useState<string | null>(null);

  // ==========================================
  // Editor State Handling
  // ==========================================

  const handleEditorReady = useCallback((instance: LexicalEditor) => {
    setEditor(instance);
    onEditorReady?.(instance);
  }, [onEditorReady]);

  const handleStateChange = useCallback((state: EditorStateReport) => {
    const ribbonFormats = state.activeFormats
      .map(f => LEXICAL_TO_RIBBON[f])
      .filter(Boolean);
    
    setActiveFormats(ribbonFormats);
    setCanUndo(state.canUndo);
    setCanRedo(state.canRedo);
    setHasSelection(state.hasSelection);

    onStateChange?.({
      activeCommands: ribbonFormats,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      hasSelection: state.hasSelection,
      paragraphStyle: state.paragraphStyle,
      isMixedStyle: state.isMixedStyle,
      currentFontKey: state.currentFontKey,
      isMixedFont: state.isMixedFont,
      currentFontSize: state.currentFontSize,
      isMixedFontSize: state.isMixedFontSize,
      currentTextAlign: state.currentTextAlign,
      currentLineHeight: state.currentLineHeight,
      isMixedLineHeight: state.isMixedLineHeight,
    });
  }, [onStateChange]);

  // ==========================================
  // Command Execution
  // ==========================================

  const executeCommand = useCallback((cmd: RibbonCommandId) => {
    if (!editor) return;

    console.log('[EditorContainer] Execute:', cmd);

    if (cmd === 'file:save' || cmd === 'file:save-as') {
      // Save logic
      const html = lexicalStateToHtml(editor);
      console.log('[EditorContainer] Saving HTML:', html.slice(0, 50) + '...');
      onSave?.(html, cmd === 'file:save-as');
      return;
    }

    if (cmd.startsWith('ai:')) {
      handleAiCommand(cmd);
      return;
    }

    const lexicalCmd = RIBBON_TO_LEXICAL[cmd];
    if (lexicalCmd) {
      executeEditorCommand(editor, lexicalCmd);
    }
  }, [editor]);

  // ==========================================
  // AI Handling with DocAgent
  // ==========================================

  const handleAiCommand = useCallback((_cmd: RibbonCommandId) => {
    if (!editor) return;

    // 🆕 如果正在执行 Section 命令，跳过 selection 流，避免重复执行
    if (isSectionCommandRunning()) {
      console.log('[EditorContainer] Skipping AI command - Section command is running');
      return;
    }

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (selection) {
        const text = selection.getTextContent();
        if (text.trim()) {
          setSelectionText(text);
          setShowAiDialog(true);
        } else {
          // 静默返回，不打印警告（避免噪音日志）
          // console.warn('[EditorContainer] AI command: No text selected');
        }
      }
    });
  }, [editor]);

  /**
   * 执行 DocAgent 意图
   * 
   * 通过 IPC 调用主进程的 DocAgent，
   * 根据返回的 action 决定是替换选区还是插入新段落
   */
  const handleDocAgentExecute = useCallback(async (intent: DocAgentIntent): Promise<DocAgentResponse> => {
    if (!editor) {
      return { success: false, action: 'replace', error: '编辑器未就绪' };
    }

    console.log('[EditorContainer] DocAgent execute:', { intent, textLength: selectionText.length });

    try {
      // 调用 DocAgent（通过 IPC）
      const response = await window.aiDoc?.handleSelection({
        selectionText,
        intent,
      });

      if (!response) {
        return { success: false, action: 'replace', error: 'AI 服务不可用' };
      }

      return response;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'AI 请求失败';
      console.error('[EditorContainer] DocAgent exception:', e);
      return { success: false, action: 'replace', error: errorMsg };
    }
  }, [editor, selectionText]);

  /**
   * DocAgent 操作成功后的回调
   * 
   * 根据 action 类型执行不同的编辑器操作：
   * - replace: 替换选区内容
   * - insertAfter: 在选区后插入新段落
   */
  const handleDocAgentSuccess = useCallback((response: DocAgentResponse) => {
    if (!editor || !response.text) return;

    console.log('[EditorContainer] DocAgent success:', { 
      action: response.action, 
      textLength: response.text.length 
    });

    if (response.action === 'replace') {
      // 替换选区内容（改写、翻译）
      executeEditorCommand(editor, 'replaceSelection', response.text);
    } else if (response.action === 'insertAfter') {
      // 在选区后插入新段落（总结）
      executeEditorCommand(editor, 'insertAfterSelection', response.text);
    }
  }, [editor]);

  // ==========================================
  // Typography Commands
  // ==========================================

  const applyFont = useCallback((fontKey: FontOptionKey) => {
    if (!editor) return;
    executeEditorCommand(editor, 'setFont', fontKey);
  }, [editor]);

  const applyFontSize = useCallback((size: FontSizeKey) => {
    if (!editor) return;
    executeEditorCommand(editor, 'setFontSize', size);
  }, [editor]);

  const applyTextAlign = useCallback((align: TextAlignKey) => {
    if (!editor) return;
    executeEditorCommand(editor, 'setTextAlign', align);
  }, [editor]);

  const applyLineHeight = useCallback((lineHeight: LineHeightKey) => {
    if (!editor) return;
    executeEditorCommand(editor, 'setLineHeight', lineHeight);
  }, [editor]);

  // ==========================================
  // Outline 更新
  // ==========================================

  useEffect(() => {
    if (!editor || !documentId) return;

    // 初始生成 Outline
    const items = generateOutlineFromEditor(editor);
    onOutlineUpdate?.(items, documentId);

    // 监听编辑器更新
    const unregister = editor.registerUpdateListener(() => {
      // 使用 setTimeout 避免频繁更新
      setTimeout(() => {
        const newItems = generateOutlineFromEditor(editor);
        onOutlineUpdate?.(newItems, documentId);
      }, 100);
    });

    return () => unregister();
  }, [editor, documentId, onOutlineUpdate]);

  // ==========================================
  // 章节 AI 操作
  // ==========================================

  const executeSectionAiAction = useCallback(async (action: string, headingId: string) => {
    if (!editor) return;

    console.log('[EditorContainer] Section AI action:', { action, headingId });

    // 获取章节内容
    const sectionContent = getSectionContent(editor, headingId);
    if (!sectionContent) {
      console.error('[EditorContainer] Failed to get section content for heading:', headingId);
      return;
    }

    console.log('[EditorContainer] Section content:', {
      title: sectionContent.heading.text,
      contentLength: sectionContent.plainText.length,
      range: sectionContent.range,
      plainText: sectionContent.plainText.slice(0, 100), // 前 100 字符
    });

    // 如果章节内容为空，提示用户
    if (sectionContent.plainText.length === 0) {
      console.warn('[EditorContainer] Section has no content (only heading)');
      // 仍然继续，让 AI 处理空内容情况
    }

    setSectionAiAction(action);
    setSectionHeadingId(headingId);
    setSectionAiLoading(true);
    setSectionAiError(null);

    try {
      // 构建章节级意图
      let intent: any;
      switch (action) {
        case 'summarize':
          intent = { type: 'summarizeSection' };
          break;
        case 'rewrite-formal':
          intent = { type: 'rewriteSection', tone: 'formal' };
          break;
        case 'rewrite-concise':
          intent = { type: 'rewriteSection', tone: 'concise' };
          break;
        case 'translate-en':
          intent = { type: 'translateSection', targetLang: 'en' };
          break;
        case 'translate-zh':
          intent = { type: 'translateSection', targetLang: 'zh' };
          break;
        default:
          console.warn('[EditorContainer] Unknown section action:', action);
          return;
      }

      // 把标题和内容一起发送给 AI（用于翻译/改写时能同时处理标题）
      // 格式：[TITLE]标题内容[/TITLE]\n\n正文内容
      const fullContent = sectionContent.plainText 
        ? `[TITLE]${sectionContent.heading.text}[/TITLE]\n\n${sectionContent.plainText}`
        : `[TITLE]${sectionContent.heading.text}[/TITLE]`;

      // 调用 DocAgent（通过 IPC）
      const response = await window.aiDoc?.handleSection({
        intent,
        section: {
          title: sectionContent.heading.text,
          content: fullContent,
        },
      });

      if (!response) {
        setSectionAiError('AI 服务不可用');
        return;
      }

      if (!response.success || !response.text) {
        setSectionAiError(response.error || 'AI 处理失败');
        return;
      }

      console.log('[EditorContainer] Section AI success:', {
        action: response.action,
        textLength: response.text.length,
        text: response.text.slice(0, 100),
      });

      // 解析返回的内容，提取标题和正文
      let newHeadingText: string | undefined;
      let newContent = response.text;
      
      const titleMatch = response.text.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/);
      if (titleMatch) {
        newHeadingText = titleMatch[1].trim();
        newContent = response.text.replace(/\[TITLE\][\s\S]*?\[\/TITLE\]\s*/, '').trim();
      }

      // 应用结果
      if (response.action === 'replace') {
        // 替换章节内容（包括标题如果有的话）
        executeEditorCommand(editor, 'replaceSectionContent', {
          headingId,
          newContent,
          newHeadingText,
          replaceHeading: !!newHeadingText,
          range: sectionContent.range,
        });
      } else if (response.action === 'insertAfter') {
        // 在章节末尾插入摘要
        executeEditorCommand(editor, 'insertAfterSection', {
          headingId,
          text: response.text,
        });
      }

    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'AI 请求失败';
      console.error('[EditorContainer] Section AI exception:', e);
      setSectionAiError(errorMsg);
    } finally {
      setSectionAiLoading(false);
    }
  }, [editor]);

  // ==========================================
  // Expose Ref
  // ==========================================

  useImperativeHandle(ref, () => ({
    executeCommand,
    applyFont,
    applyFontSize,
    applyTextAlign,
    applyLineHeight,
    canUndo,
    canRedo,
    hasSelection,
    activeFormats,
    executeSectionAiAction,
  }));

  return (
    <div className="editor-container">
      <MinimalEditor
        initialHtml={initialHtml}
        onEditorReady={handleEditorReady}
        onStateChange={handleStateChange}
        onContentChange={onDirty}
        documentId={documentId}
      />

      {showAiDialog && (
        <AiRewriteDialog
          selectionText={selectionText}
          onExecute={handleDocAgentExecute}
          onSuccess={handleDocAgentSuccess}
          onCancel={() => setShowAiDialog(false)}
        />
      )}
    </div>
  );
});

EditorContainer.displayName = 'EditorContainer';
export default EditorContainer; // Export default for lazy loading if needed
