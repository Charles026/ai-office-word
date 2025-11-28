/**
 * FontDropdown.tsx
 * 
 * 字体选择下拉组件，用于 Ribbon 工具栏。
 * 使用 Portal 将菜单渲染到 body，避免被父容器 overflow 裁剪。
 * 
 * 【功能】
 * - 显示当前选中的字体
 * - 下拉菜单按分组显示字体选项
 * - 点击选项应用字体到选区
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import {
  FontOptionKey,
  getFontOptionsByGroup,
  getGroupLabel,
  getFontOption,
  FontGroup,
} from '../config/fonts';
import './FontDropdown.css';

// ==========================================
// 类型定义
// ==========================================

interface FontDropdownProps {
  /** 当前选中的字体键 */
  currentFontKey: FontOptionKey | null;
  /** 是否为混合字体状态 */
  isMixed?: boolean;
  /** 字体变更回调 */
  onFontChange: (fontKey: FontOptionKey) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

// ==========================================
// 组件
// ==========================================

export const FontDropdown: React.FC<FontDropdownProps> = ({
  currentFontKey,
  isMixed = false,
  onFontChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  // 计算菜单位置
  const updateMenuPosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, []);

  // 打开时计算位置
  useEffect(() => {
    if (isOpen) {
      updateMenuPosition();
      // 监听滚动和 resize
      window.addEventListener('scroll', updateMenuPosition, true);
      window.addEventListener('resize', updateMenuPosition);
    }
    return () => {
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [isOpen, updateMenuPosition]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      // 使用 mousedown 而不是 click，响应更快
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // 获取显示文本
  const getDisplayText = (): string => {
    if (isMixed) return '字体';
    if (!currentFontKey || currentFontKey === 'default') return '默认';
    const option = getFontOption(currentFontKey);
    return option?.label || '默认';
  };

  // 处理选项点击
  const handleOptionClick = (fontKey: FontOptionKey) => {
    onFontChange(fontKey);
    setIsOpen(false);
  };

  // 按分组获取选项
  const groupedOptions = getFontOptionsByGroup();
  const groupOrder: FontGroup[] = ['System', 'CN', 'EN', 'Mono'];

  // 渲染菜单（通过 Portal）
  const renderMenu = () => {
    if (!isOpen) return null;

    return createPortal(
      <div 
        ref={menuRef}
        className="font-dropdown-menu"
        style={{
          position: 'fixed',
          top: menuPosition.top,
          left: menuPosition.left,
        }}
      >
        {groupOrder.map(group => {
          const options = groupedOptions[group];
          if (options.length === 0) return null;

          return (
            <div key={group} className="font-dropdown-group">
              <div className="font-dropdown-group-label">
                {getGroupLabel(group)}
              </div>
              {options.map(option => (
                <button
                  key={option.key}
                  className={`font-dropdown-option ${
                    currentFontKey === option.key ? 'active' : ''
                  }`}
                  onClick={() => handleOptionClick(option.key)}
                >
                  <span className="font-option-label">{option.label}</span>
                  {currentFontKey === option.key && (
                    <span className="font-option-check">✓</span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>,
      document.body
    );
  };

  return (
    <div className={`font-dropdown ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      {/* 触发按钮 */}
      <button
        ref={triggerRef}
        className="font-dropdown-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        title="选择字体"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="font-dropdown-text">{getDisplayText()}</span>
        <ChevronDown size={14} className="font-dropdown-arrow" />
      </button>

      {/* 下拉菜单（Portal 到 body） */}
      {renderMenu()}
    </div>
  );
};

export default FontDropdown;
