/**
 * DocEditor - 基于 TipTap 的富文本编辑器组件
 * 
 * 功能：
 * - 从 HTML 初始化内容（LibreOffice 转换而来）
 * - 导出 HTML 用于保存（转回 docx）
 * - 简单工具栏：粗体/斜体/标题/列表
 * 
 * 注意：
 * - 这里是未来挂 LibreOffice 渲染的地方
 * - 当前使用 HTML 作为中间格式
 * - 未来可改用 LibreOfficeKit 实现更好的保真度
 */

import React, { useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import './DocEditor.css';

// ==========================================
// 工具栏按钮图标
// ==========================================

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
    <path d="M2 2h2v5h4V2h2v12H8V9H4v5H2V2zm10 0h2v10h2v2h-6v-2h2V4h-1l1-2z"/>
  </svg>
);

const H2Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 2h2v5h3V2h2v12H6V9H3v5H1V2zm7 10v2h7v-2h-4l4-4V6h-7v2h4l-4 4z"/>
  </svg>
);

const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 0h10v2H5V3zm-3 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 0h10v2H5V7zm-3 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 0h10v2H5v-2z"/>
  </svg>
);

const OrderedListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 3v1h1V3h1V1H2v2zm0 5h2V7H2v1zm0 4h2v-1H2v1zm0 2h2v-1H2v1zM5 3h10v2H5V3zm0 4h10v2H5V7zm0 4h10v2H5v-2z"/>
  </svg>
);

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 2v12h12V4l-2-2H2zm10 1v3H4V3h8zM4 14V9h8v5H4zm2-4h4v1H6v-1z"/>
  </svg>
);

// ==========================================
// 工具栏按钮组件
// ==========================================

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  isActive,
  disabled,
  title,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`toolbar-button ${isActive ? 'active' : ''}`}
  >
    {children}
  </button>
);

// ==========================================
// DocEditor 组件
// ==========================================

interface DocEditorProps {
  /** 文件路径 */
  filePath: string;
  /** 文件名 */
  fileName: string;
  /** 初始 HTML 内容 */
  initialHtml: string;
  /** 保存回调 */
  onSave: (html: string) => void;
  /** 是否正在保存 */
  saving?: boolean;
}

export const DocEditor: React.FC<DocEditorProps> = ({
  filePath: _filePath,
  fileName,
  initialHtml,
  onSave,
  saving = false,
}) => {
  // 处理 HTML 内容
  // LibreOffice 输出的 HTML 可能包含完整的 <html><body> 结构
  // 我们只需要 body 内部的内容
  const extractBodyContent = useCallback((html: string): string => {
    // 尝试提取 body 内容
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      return bodyMatch[1];
    }
    return html;
  }, []);

  // 初始化 TipTap 编辑器
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 配置 StarterKit
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: '开始输入内容...',
      }),
    ],
    content: extractBodyContent(initialHtml),
    editorProps: {
      attributes: {
        class: 'doc-editor-content',
      },
    },
  });

  // 当 initialHtml 变化时更新编辑器内容
  useEffect(() => {
    if (editor && initialHtml) {
      const content = extractBodyContent(initialHtml);
      editor.commands.setContent(content);
    }
  }, [editor, initialHtml, extractBodyContent]);

  // 保存处理
  const handleSave = useCallback(() => {
    if (editor && !saving) {
      const html = editor.getHTML();
      onSave(html);
    }
  }, [editor, onSave, saving]);

  // 快捷键：Cmd/Ctrl + S 保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (!editor) {
    return <div className="doc-editor-loading">加载编辑器...</div>;
  }

  return (
    <div className="doc-editor">
      {/* 工具栏 */}
      <div className="doc-editor-toolbar">
        <div className="toolbar-group">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title="粗体 (⌘B)"
          >
            <BoldIcon />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title="斜体 (⌘I)"
          >
            <ItalicIcon />
          </ToolbarButton>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive('heading', { level: 1 })}
            title="标题 1"
          >
            <H1Icon />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive('heading', { level: 2 })}
            title="标题 2"
          >
            <H2Icon />
          </ToolbarButton>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            title="无序列表"
          >
            <ListIcon />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            title="有序列表"
          >
            <OrderedListIcon />
          </ToolbarButton>
        </div>

        <div className="toolbar-spacer" />

        {/* 文件名显示 */}
        <span className="toolbar-filename">{fileName}</span>

        {/* 保存按钮 */}
        <ToolbarButton
          onClick={handleSave}
          disabled={saving}
          title="保存 (⌘S)"
        >
          <SaveIcon />
          <span className="toolbar-button-text">
            {saving ? '保存中...' : '保存'}
          </span>
        </ToolbarButton>
      </div>

      {/* 编辑器内容区 */}
      <div className="doc-editor-body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default DocEditor;

