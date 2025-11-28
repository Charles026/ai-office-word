/**
 * LineHeightDropdown.tsx
 * 
 * 行距选择下拉组件
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LineChart } from 'lucide-react';
import {
  LineHeightKey,
  LINE_HEIGHT_OPTIONS,
} from '../config/typography';
import './LineHeightDropdown.css';

interface LineHeightDropdownProps {
  currentLineHeight: LineHeightKey | null;
  isMixed?: boolean;
  onLineHeightChange: (lineHeight: LineHeightKey) => void;
  disabled?: boolean;
}

export const LineHeightDropdown: React.FC<LineHeightDropdownProps> = ({
  currentLineHeight,
  isMixed: _isMixed = false,
  onLineHeightChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const updateMenuPosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateMenuPosition();
      window.addEventListener('scroll', updateMenuPosition, true);
      window.addEventListener('resize', updateMenuPosition);
    }
    return () => {
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [isOpen, updateMenuPosition]);

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
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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

  const handleOptionClick = (lineHeight: LineHeightKey) => {
    onLineHeightChange(lineHeight);
    setIsOpen(false);
  };

  const renderMenu = () => {
    if (!isOpen) return null;

    return createPortal(
      <div
        ref={menuRef}
        className="line-height-dropdown-menu"
        style={{
          position: 'fixed',
          top: menuPosition.top,
          left: menuPosition.left,
        }}
      >
        <div className="line-height-dropdown-header">行距</div>
        {LINE_HEIGHT_OPTIONS.map(option => (
          <button
            key={option.key}
            className={`line-height-dropdown-option ${currentLineHeight === option.key ? 'active' : ''}`}
            onClick={() => handleOptionClick(option.key)}
          >
            <span className="line-height-option-label">{option.label}</span>
            {currentLineHeight === option.key && (
              <span className="line-height-option-check">✓</span>
            )}
          </button>
        ))}
      </div>,
      document.body
    );
  };

  return (
    <div className={`line-height-dropdown ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      <button
        ref={triggerRef}
        className="line-height-dropdown-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        title="行距"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <LineChart size={16} />
        <ChevronDown size={10} className="line-height-dropdown-arrow" />
      </button>
      {renderMenu()}
    </div>
  );
};

export default LineHeightDropdown;

