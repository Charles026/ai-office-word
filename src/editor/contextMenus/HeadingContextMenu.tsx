/**
 * HeadingContextMenu - 编辑器中标题的右键菜单
 * 
 * 【职责】
 * - 当用户在编辑器中右键点击 H1/H2/H3 标题时显示菜单
 * - 调用统一的 Section AI 动作
 * 
 * 【设计原则】
 * - 不在此处构造 Intent
 * - 不直接调用 Runtime
 * - 所有操作通过 runSectionAiAction
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { LexicalEditor, $getNodeByKey } from 'lexical';
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { SectionAiAction } from '../../actions/sectionAiActions';
import './HeadingContextMenu.css';

// ==========================================
// 类型定义
// ==========================================

export interface HeadingContextMenuProps {
  /** 菜单位置 */
  position: { x: number; y: number };
  /** 目标 Heading 节点的 Key */
  headingKey: string;
  /** Lexical 编辑器实例 */
  editor: LexicalEditor;
  /** 是否正在处理 AI 任务 */
  isProcessing?: boolean;
  /** 执行 AI 操作 */
  onAction: (action: SectionAiAction, sectionId: string) => void;
  /** 关闭菜单 */
  onClose: () => void;
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
 * 获取 Heading 节点的层级
 */
function getHeadingLevel(editor: LexicalEditor, headingKey: string): number | null {
  let level: number | null = null;

  editor.getEditorState().read(() => {
    const node = $getNodeByKey(headingKey);
    if (node && $isHeadingNode(node)) {
      const tag = (node as HeadingNode).getTag();
      level = parseInt(tag.replace('h', ''), 10);
    }
  });

  return level;
}

// ==========================================
// 组件实现
// ==========================================

export const HeadingContextMenu: React.FC<HeadingContextMenuProps> = ({
  position,
  headingKey,
  editor,
  isProcessing = false,
  onAction,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const level = getHeadingLevel(editor, headingKey);

  // v1.1: 支持 H1/H2/H3，其他层级不显示菜单
  if (level === null || level < 1 || level > 3) {
    return null;
  }

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // 调整菜单位置
  const adjustedPosition = React.useMemo(() => {
    const menuWidth = 180;
    const menuHeight = MENU_ITEMS.length * 40 + 16;
    
    let x = position.x;
    let y = position.y;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }
    
    return { x, y };
  }, [position]);

  const handleItemClick = useCallback((action: SectionAiAction) => {
    if (isProcessing) return;
    onAction(action, headingKey);
    onClose();
  }, [headingKey, isProcessing, onAction, onClose]);

  return (
    <div
      ref={menuRef}
      className="heading-context-menu"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <div className="heading-context-menu-header">
        <span className="heading-context-menu-badge">H{level}</span>
        <span className="heading-context-menu-title">章节操作</span>
      </div>
      
      <div className="heading-context-menu-items">
        {MENU_ITEMS.map(item => (
          <button
            key={item.id}
            className={`heading-context-menu-item ${isProcessing ? 'disabled' : ''}`}
            onClick={() => handleItemClick(item.id)}
            disabled={isProcessing}
          >
            <span className="heading-context-menu-icon">{item.icon}</span>
            <span className="heading-context-menu-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default HeadingContextMenu;

