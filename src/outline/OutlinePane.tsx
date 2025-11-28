/**
 * OutlinePane - 大纲面板组件
 * 
 * 【功能】
 * - 展示文档中的所有 Heading（H1/H2/H3）
 * - 支持点击跳转到对应位置
 * - 当前视口所在的标题高亮
 * - 支持折叠/展开子节点
 * - 章节级 AI 操作菜单
 * 
 * 【设计风格】
 * - 简洁、偏 Notion / VS Code Outline 感
 * - 保持与液态玻璃风格一致
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { OutlineItem, HeadingLevel } from './types';
import './OutlinePane.css';

// ==========================================
// 图标组件
// ==========================================

const ChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg
    className={`outline-chevron ${expanded ? 'expanded' : ''}`}
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
  >
    <path
      d="M4 3L8 6L4 9"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const HeadingIcon: React.FC<{ level: HeadingLevel }> = ({ level }) => {
  const labels = { 1: 'H1', 2: 'H2', 3: 'H3' };
  return (
    <span className={`outline-heading-icon level-${level}`}>
      {labels[level]}
    </span>
  );
};

const MoreIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="4" r="1" fill="currentColor" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <circle cx="8" cy="12" r="1" fill="currentColor" />
  </svg>
);

// ==========================================
// 章节菜单组件
// ==========================================

interface SectionMenuProps {
  headingId: string;
  onAction: (action: string, headingId: string) => void;
  onClose: () => void;
}

const SectionMenu: React.FC<SectionMenuProps> = ({ headingId, onAction, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const menuItems = [
    { id: 'summarize', label: '✨ 总结本节', icon: '📝' },
    { id: 'rewrite-formal', label: '✨ 润色（更正式）', icon: '✍️' },
    { id: 'rewrite-concise', label: '✨ 精简本节', icon: '✂️' },
    { id: 'translate-en', label: '✨ 翻译成英文', icon: '🌐' },
    { id: 'translate-zh', label: '✨ 翻译成中文', icon: '🇨🇳' },
  ];

  return (
    <div className="section-menu" ref={menuRef}>
      {menuItems.map(item => (
        <button
          key={item.id}
          className="section-menu-item"
          onClick={() => {
            onAction(item.id, headingId);
            onClose();
          }}
        >
          <span className="section-menu-icon">{item.icon}</span>
          <span className="section-menu-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
};

// ==========================================
// 大纲项组件
// ==========================================

interface OutlineItemRowProps {
  item: OutlineItem;
  isActive: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  onItemClick: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onSectionAction: (action: string, headingId: string) => void;
}

const OutlineItemRow: React.FC<OutlineItemRowProps> = ({
  item,
  isActive,
  isCollapsed,
  hasChildren,
  onItemClick,
  onToggleCollapse,
  onSectionAction,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onItemClick(item.id);
  }, [item.id, onItemClick]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse(item.id);
  }, [item.id, onToggleCollapse]);

  const handleMenuClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(prev => !prev);
  }, []);

  return (
    <div
      className={`outline-item level-${item.level} ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`outline-item-${item.id}`}
    >
      <div className="outline-item-content">
        {/* 折叠按钮 */}
        <button
          className={`outline-toggle ${hasChildren ? 'visible' : 'hidden'}`}
          onClick={handleToggle}
          aria-label={isCollapsed ? '展开' : '折叠'}
        >
          {hasChildren && <ChevronIcon expanded={!isCollapsed} />}
        </button>

        {/* 标题图标 */}
        <HeadingIcon level={item.level} />

        {/* 标题文本 */}
        <span className="outline-item-text" title={item.text}>
          {item.text || '(无标题)'}
        </span>

        {/* 更多按钮 */}
        {isHovered && (
          <button
            className="outline-more-btn"
            onClick={handleMenuClick}
            aria-label="章节操作"
          >
            <MoreIcon />
          </button>
        )}
      </div>

      {/* 章节菜单 */}
      {showMenu && (
        <SectionMenu
          headingId={item.id}
          onAction={onSectionAction}
          onClose={() => setShowMenu(false)}
        />
      )}
    </div>
  );
};

// ==========================================
// 主组件
// ==========================================

export interface OutlinePaneProps {
  /** 大纲项列表（扁平） */
  items: OutlineItem[];
  /** 当前活跃项 ID */
  activeItemId: string | null;
  /** 点击项时的回调 */
  onItemClick: (id: string) => void;
  /** 章节 AI 操作回调 */
  onSectionAction?: (action: string, headingId: string) => void;
  /** 逐节总结回调 */
  onSummarizeAll?: () => void;
  /** 是否显示 */
  visible?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
}

export const OutlinePane: React.FC<OutlinePaneProps> = ({
  items,
  activeItemId,
  onItemClick,
  onSectionAction,
  onSummarizeAll,
  visible = true,
  onClose,
}) => {
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});

  // 构建树形结构用于判断是否有子节点
  const itemsWithChildren = React.useMemo(() => {
    const hasChildrenMap: Record<string, boolean> = {};
    
    for (let i = 0; i < items.length; i++) {
      const current = items[i];
      const next = items[i + 1];
      
      // 如果下一个项的 level 比当前大，说明当前项有子节点
      if (next && next.level > current.level) {
        hasChildrenMap[current.id] = true;
      }
    }
    
    return hasChildrenMap;
  }, [items]);

  // 计算可见项（考虑折叠状态）
  const visibleItems = React.useMemo(() => {
    const result: OutlineItem[] = [];
    let skipUntilLevel: number | null = null;

    for (const item of items) {
      // 如果正在跳过，检查是否应该停止跳过
      if (skipUntilLevel !== null) {
        if (item.level <= skipUntilLevel) {
          skipUntilLevel = null;
        } else {
          continue;
        }
      }

      result.push(item);

      // 如果当前项被折叠，开始跳过子项
      if (collapsedItems[item.id]) {
        skipUntilLevel = item.level;
      }
    }

    return result;
  }, [items, collapsedItems]);

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedItems(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  const handleSectionAction = useCallback((action: string, headingId: string) => {
    onSectionAction?.(action, headingId);
  }, [onSectionAction]);

  if (!visible) return null;

  const hasEnoughSections = items.filter(i => i.level >= 2).length >= 1;

  return (
    <div className="outline-pane">
      <div className="outline-header">
        <span className="outline-title">大纲</span>
        {onClose && (
          <button className="outline-close-btn" onClick={onClose} aria-label="关闭大纲">
            ×
          </button>
        )}
      </div>

      {/* 逐节总结按钮 */}
      {onSummarizeAll && hasEnoughSections && (
        <div className="outline-actions">
          <button 
            className="outline-summarize-all-btn"
            onClick={onSummarizeAll}
            title="为每个二级/三级标题下的内容生成摘要"
          >
            <span className="summarize-icon">✦</span>
            <span>为整篇文档生成逐节总结</span>
          </button>
        </div>
      )}

      <div className="outline-content">
        {visibleItems.length === 0 ? (
          <div className="outline-empty">
            <p>暂无标题</p>
            <p className="outline-empty-hint">使用 H1/H2/H3 样式创建文档结构</p>
          </div>
        ) : (
          visibleItems.map(item => (
            <OutlineItemRow
              key={item.id}
              item={item}
              isActive={item.id === activeItemId}
              isCollapsed={!!collapsedItems[item.id]}
              hasChildren={!!itemsWithChildren[item.id]}
              onItemClick={onItemClick}
              onToggleCollapse={handleToggleCollapse}
              onSectionAction={handleSectionAction}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default OutlinePane;

