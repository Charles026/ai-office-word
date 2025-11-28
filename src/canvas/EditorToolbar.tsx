/**
 * EditorToolbar - 编辑器工具栏
 */

import React, { useCallback } from 'react';
import { DocOp, createOpMeta } from '../docops/types';
import { DocumentAst } from '../document/types';
import './EditorToolbar.css';

// Icons
const BoldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 2h5a3 3 0 0 1 2.1 5.1A3.5 3.5 0 0 1 9.5 14H4V2zm2 5h3a1 1 0 0 0 0-2H6v2zm0 5h3.5a1.5 1.5 0 0 0 0-3H6v3z"/>
  </svg>
);

const ItalicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 2h6v2h-2l-2 8h2v2H4v-2h2l2-8H6V2z"/>
  </svg>
);

const H1Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3h2v4h4V3h2v10H7V9H3v4H1V3zm9 0h3l2 3v7h-2V6.5L11.5 9H11V7l2-4z"/>
  </svg>
);

const H2Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3h2v4h3V3h2v10H6V9H3v4H1V3zm8 8v2h6v-2h-3l3-3V6h-6v2h3l-3 3z"/>
  </svg>
);

const ParagraphIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 1h8v2h-2v11h-2V3H8v11H6V8a4 4 0 1 1 0-7z"/>
  </svg>
);

const AddIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
  </svg>
);

const UndoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 7h6a3 3 0 1 1 0 6H8v-2h2a1 1 0 0 0 0-2H4l2-2L4 5l2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const RedoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ transform: 'scaleX(-1)' }}>
    <path d="M4 7h6a3 3 0 1 1 0 6H8v-2h2a1 1 0 0 0 0-2H4l2-2L4 5l2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2v12h12V4l-2-2H2zm10 1v3H4V3h8zM4 14V9h8v5H4zm2-4h4v1H6v-1z"/>
  </svg>
);

const AiIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z"/>
    <path d="M3 11l.75 1.75L5.5 13.5l-1.75.75L3 16l-.75-1.75L.5 13.5l1.75-.75L3 11z" opacity="0.7"/>
    <path d="M12 10l.5 1.17 1.17.5-1.17.5-.5 1.16-.5-1.16-1.17-.5 1.17-.5.5-1.17z" opacity="0.5"/>
  </svg>
);

interface InlineFormattingState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

interface EditorToolbarProps {
  ast: DocumentAst;
  selectedNodeId: string | null;
  onOps: (ops: DocOp[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saving?: boolean;
  /** 是否有有效选区（可以进行 AI 改写） */
  hasSelection?: boolean;
  /** AI 改写按钮点击 */
  onAiRewrite?: () => void;
  /** AI 是否正在处理 */
  aiLoading?: boolean;
  /** 切换粗体 */
  onToggleBold?: () => void;
  /** 切换斜体 */
  onToggleItalic?: () => void;
  /** 当前输入格式状态（用于按钮高亮） */
  inlineFormatting?: InlineFormattingState;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  ast,
  selectedNodeId,
  onOps,
  onUndo,
  onRedo,
  onSave,
  canUndo,
  canRedo,
  saving,
  hasSelection = false,
  onAiRewrite,
  aiLoading = false,
  onToggleBold,
  onToggleItalic,
  inlineFormatting,
}) => {
  const meta = createOpMeta('user');

  const handleAddParagraph = useCallback(() => {
    const lastBlock = ast.blocks[ast.blocks.length - 1];
    onOps([{
      type: 'InsertParagraph',
      payload: { afterNodeId: lastBlock?.id ?? null },
      meta,
    }]);
  }, [ast, onOps, meta]);

  const handleSetHeading = useCallback((level: 0 | 1 | 2) => {
    if (!selectedNodeId) return;
    onOps([{
      type: 'SetHeadingLevel',
      payload: { nodeId: selectedNodeId, level },
      meta,
    }]);
  }, [selectedNodeId, onOps, meta]);

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销 (⌘Z)"
        >
          <UndoIcon />
        </button>
        <button
          className="toolbar-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (⌘⇧Z)"
        >
          <RedoIcon />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={handleAddParagraph}
          title="添加段落"
        >
          <AddIcon />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={() => handleSetHeading(0)}
          disabled={!selectedNodeId}
          title="普通段落"
        >
          <ParagraphIcon />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => handleSetHeading(1)}
          disabled={!selectedNodeId}
          title="标题 1"
        >
          <H1Icon />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => handleSetHeading(2)}
          disabled={!selectedNodeId}
          title="标题 2"
        >
          <H2Icon />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${inlineFormatting?.bold ? 'active' : ''}`}
          onClick={onToggleBold}
          disabled={!selectedNodeId}
          title="粗体 (⌘B)"
        >
          <BoldIcon />
        </button>
        <button
          className={`toolbar-btn ${inlineFormatting?.italic ? 'active' : ''}`}
          onClick={onToggleItalic}
          disabled={!selectedNodeId}
          title="斜体 (⌘I)"
        >
          <ItalicIcon />
        </button>
      </div>

      {/* AI 功能区 */}
      {onAiRewrite && (
        <>
          <div className="toolbar-divider" />
          <div className="toolbar-group">
            <button
              className={`toolbar-btn ai-btn ${aiLoading ? 'loading' : ''}`}
              onClick={onAiRewrite}
              disabled={!hasSelection || aiLoading}
              title="AI 改写选区"
            >
              <AiIcon />
              <span className="toolbar-btn-text">AI 改写</span>
            </button>
          </div>
        </>
      )}

      {onSave && (
        <>
          <div className="toolbar-spacer" />
          <button
            className="toolbar-btn save-btn"
            onClick={onSave}
            disabled={saving}
            title="保存 (⌘S)"
          >
            <SaveIcon />
            <span className="toolbar-btn-text">
              {saving ? '保存中...' : '保存'}
            </span>
          </button>
        </>
      )}
    </div>
  );
};

export default EditorToolbar;
