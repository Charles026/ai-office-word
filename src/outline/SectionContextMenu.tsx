/**
 * SectionContextMenu - 大纲节点右键菜单
 * 
 * 【职责】
 * - 为 H2/H3 节点提供右键菜单
 * - 调用统一的 Section AI 动作
 * - H2 额外提供"重写整章"选项
 * 
 * 【设计原则】
 * - 不在此处构造 Intent
 * - 不直接调用 Runtime
 * - 所有操作通过 runSectionAiAction
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { SectionAiAction } from '../actions/sectionAiActions';
import type { SectionScope } from '../runtime/intents/types';
import './SectionContextMenu.css';

// ==========================================
// 类型定义
// ==========================================

/** 扩展的操作类型，支持 scope */
export type ExtendedSectionAction = SectionAiAction | 'rewrite_chapter';

export interface SectionContextMenuProps {
  /** 菜单位置 */
  position: { x: number; y: number };
  /** 目标 Section ID */
  sectionId: string;
  /** Section 层级（2=H2, 3=H3） */
  sectionLevel: number;
  /** 是否有子章节（仅 H2 有效） */
  hasChildSections?: boolean;
  /** 是否正在处理 AI 任务 */
  isProcessing?: boolean;
  /** 执行 AI 操作 */
  onAction: (action: SectionAiAction, sectionId: string, options?: { scope?: SectionScope }) => void;
  /** 关闭菜单 */
  onClose: () => void;
}

// ==========================================
// 菜单项配置
// ==========================================

interface MenuItem {
  id: ExtendedSectionAction;
  label: string;
  icon: string;
  description?: string;
  /** 是否仅 H2 显示 */
  h2Only?: boolean;
  /** 是否需要子章节 */
  requiresChildSections?: boolean;
  /** 是否为实验性功能 */
  experimental?: boolean;
}

const BASE_MENU_ITEMS: MenuItem[] = [
  {
    id: 'rewrite',
    label: '重写导语',
    icon: '✍️',
    description: '优化导语文字',
  },
  {
    id: 'rewrite_chapter',
    label: '重写整章',
    icon: '📄',
    description: '重写整章内容（实验）',
    h2Only: true,
    requiresChildSections: true,
    experimental: true,
  },
  {
    id: 'summarize',
    label: '总结章节',
    icon: '📝',
    description: '生成简洁摘要',
  },
  {
    id: 'expand',
    label: '扩写章节',
    icon: '📖',
    description: '添加更多细节',
  },
];

// ==========================================
// 组件实现
// ==========================================

export const SectionContextMenu: React.FC<SectionContextMenuProps> = ({
  position,
  sectionId,
  sectionLevel,
  hasChildSections = false,
  isProcessing = false,
  onAction,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // 根据 sectionLevel 和 hasChildSections 过滤菜单项
  const menuItems = useMemo(() => {
    return BASE_MENU_ITEMS.filter(item => {
      // H2 only 项只在 H2 显示
      if (item.h2Only && sectionLevel !== 2) {
        return false;
      }
      // 需要子章节的项，只在有子章节时显示
      if (item.requiresChildSections && !hasChildSections) {
        return false;
      }
      return true;
    });
  }, [sectionLevel, hasChildSections]);

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

  // 调整菜单位置，避免超出视口
  const adjustedPosition = useMemo(() => {
    const menuWidth = 200;
    const menuHeight = menuItems.length * 44 + 16;
    
    let x = position.x;
    let y = position.y;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }
    
    return { x, y };
  }, [position, menuItems.length]);

  const handleItemClick = (item: MenuItem) => {
    if (isProcessing) return;
    
    // 根据 action 类型决定 scope
    if (item.id === 'rewrite_chapter') {
      // 重写整章：scope = 'chapter'
      onAction('rewrite', sectionId, { scope: 'chapter' });
    } else if (item.id === 'rewrite') {
      // 重写导语：scope = 'intro'
      onAction('rewrite', sectionId, { scope: 'intro' });
    } else {
      // 其他操作
      onAction(item.id as SectionAiAction, sectionId);
    }
    
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="section-context-menu"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <div className="section-context-menu-header">
        <span className="section-context-menu-title">
          H{sectionLevel} 章节操作
        </span>
      </div>
      
      <div className="section-context-menu-items">
        {menuItems.map(item => (
          <button
            key={item.id}
            className={`section-context-menu-item ${isProcessing ? 'disabled' : ''} ${item.experimental ? 'experimental' : ''}`}
            onClick={() => handleItemClick(item)}
            disabled={isProcessing}
          >
            <span className="section-context-menu-icon">{item.icon}</span>
            <div className="section-context-menu-text">
              <span className="section-context-menu-label">
                {item.label}
                {item.experimental && <span className="experimental-badge">实验</span>}
              </span>
              {item.description && (
                <span className="section-context-menu-desc">{item.description}</span>
              )}
            </div>
          </button>
        ))}
      </div>
      
      {isProcessing && (
        <div className="section-context-menu-loading">
          <span className="section-context-menu-spinner">⟳</span>
          <span>处理中...</span>
        </div>
      )}
    </div>
  );
};

export default SectionContextMenu;

