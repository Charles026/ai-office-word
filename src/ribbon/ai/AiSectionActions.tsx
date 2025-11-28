/**
 * AiSectionActions - Ribbon 中的 Section AI 下拉菜单
 * 
 * 【职责】
 * - 提供 Section 级 AI 操作的 Ribbon 入口
 * - 自动检测当前光标所在的 heading 节点
 * - 调用统一的 Section AI 动作
 * 
 * 【设计原则】
 * - 不在此处构造 Intent
 * - 不直接调用 Runtime
 * - 所有操作通过 runSectionAiAction
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LexicalEditor, $getSelection, $isRangeSelection } from 'lexical';
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { SectionAiAction } from '../../actions/sectionAiActions';
import './AiSectionActions.css';

// ==========================================
// 类型定义
// ==========================================

export interface AiSectionActionsProps {
  /** Lexical 编辑器实例 */
  editor: LexicalEditor | null;
  /** 是否正在处理 AI 任务 */
  isProcessing?: boolean;
  /** 执行 AI 操作 */
  onAction: (action: SectionAiAction, sectionId: string) => void;
  /** 显示提示消息 */
  onShowMessage?: (message: string) => void;
}

// ==========================================
// 菜单项配置
// ==========================================

interface MenuItem {
  id: SectionAiAction;
  label: string;
  icon: string;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'rewrite', label: '重写章节', icon: '✍️' },
  { id: 'summarize', label: '总结章节', icon: '📝' },
  { id: 'expand', label: '扩写章节', icon: '📖' },
];

// ==========================================
// 辅助函数
// ==========================================

/**
 * 获取当前光标所在的 Heading 节点
 */
function getCurrentHeadingNode(editor: LexicalEditor): { id: string; level: number } | null {
  let result: { id: string; level: number } | null = null;

  editor.getEditorState().read(() => {
    const selection = $getSelection();
    
    if (!$isRangeSelection(selection)) {
      return;
    }

    // 获取选区的锚点节点
    const anchorNode = selection.anchor.getNode();
    
    // 向上查找 Heading 节点
    let currentNode = anchorNode;
    while (currentNode) {
      const parent = currentNode.getParent();
      
      if ($isHeadingNode(currentNode)) {
        const tag = (currentNode as HeadingNode).getTag();
        const level = parseInt(tag.replace('h', ''), 10);
        
        // 只支持 H2 和 H3
        if (level === 2 || level === 3) {
          result = {
            id: currentNode.getKey(),
            level,
          };
        }
        return;
      }
      
      // 检查父节点是否是 Heading
      if (parent && $isHeadingNode(parent)) {
        const tag = (parent as HeadingNode).getTag();
        const level = parseInt(tag.replace('h', ''), 10);
        
        if (level === 2 || level === 3) {
          result = {
            id: parent.getKey(),
            level,
          };
        }
        return;
      }
      
      if (!parent) {
        return;
      }
      currentNode = parent;
    }
  });

  return result;
}

// ==========================================
// 组件实现
// ==========================================

export const AiSectionActions: React.FC<AiSectionActionsProps> = ({
  editor,
  isProcessing = false,
  onAction,
  onShowMessage,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    if (isProcessing) return;
    setIsOpen(prev => !prev);
  }, [isProcessing]);

  const handleItemClick = useCallback((action: SectionAiAction) => {
    if (!editor) {
      onShowMessage?.('编辑器未就绪');
      setIsOpen(false);
      return;
    }

    // 获取当前光标所在的 Heading
    const heading = getCurrentHeadingNode(editor);
    
    if (!heading) {
      onShowMessage?.('请将光标放在 H2 或 H3 标题上');
      setIsOpen(false);
      return;
    }

    // 执行操作
    onAction(action, heading.id);
    setIsOpen(false);
  }, [editor, onAction, onShowMessage]);

  return (
    <div className="ai-section-actions" ref={dropdownRef}>
      <button
        className={`ai-section-actions-trigger ${isOpen ? 'active' : ''} ${isProcessing ? 'processing' : ''}`}
        onClick={handleToggle}
        disabled={isProcessing}
        title="章节 AI 操作"
      >
        <span className="ai-section-actions-icon">✨</span>
        <span className="ai-section-actions-label">章节 AI</span>
        <span className="ai-section-actions-arrow">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="ai-section-actions-dropdown">
          {MENU_ITEMS.map(item => (
            <button
              key={item.id}
              className="ai-section-actions-item"
              onClick={() => handleItemClick(item.id)}
            >
              <span className="ai-section-actions-item-icon">{item.icon}</span>
              <span className="ai-section-actions-item-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AiSectionActions;

