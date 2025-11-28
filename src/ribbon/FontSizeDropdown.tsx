/**
 * FontSizeDropdown.tsx
 * 
 * 字号选择下拉组件
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import {
  FontSizeKey,
  FONT_SIZE_OPTIONS,
} from '../config/typography';
import './FontSizeDropdown.css';

interface FontSizeDropdownProps {
  currentSize: FontSizeKey | null;
  isMixed?: boolean;
  onSizeChange: (size: FontSizeKey) => void;
  disabled?: boolean;
}

export const FontSizeDropdown: React.FC<FontSizeDropdownProps> = ({
  currentSize,
  isMixed = false,
  onSizeChange,
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

  const getDisplayText = (): string => {
    if (isMixed) return '—';
    if (!currentSize) return '16';
    return currentSize;
  };

  const handleOptionClick = (size: FontSizeKey) => {
    onSizeChange(size);
    setIsOpen(false);
  };

  const renderMenu = () => {
    if (!isOpen) return null;

    return createPortal(
      <div
        ref={menuRef}
        className="font-size-dropdown-menu"
        style={{
          position: 'fixed',
          top: menuPosition.top,
          left: menuPosition.left,
        }}
      >
        {FONT_SIZE_OPTIONS.map(option => (
          <button
            key={option.key}
            className={`font-size-dropdown-option ${currentSize === option.key ? 'active' : ''}`}
            onClick={() => handleOptionClick(option.key)}
          >
            <span className="font-size-option-label">{option.label}</span>
            {currentSize === option.key && (
              <span className="font-size-option-check">✓</span>
            )}
          </button>
        ))}
      </div>,
      document.body
    );
  };

  return (
    <div className={`font-size-dropdown ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
      <button
        ref={triggerRef}
        className="font-size-dropdown-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        title="字号"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="font-size-dropdown-text">{getDisplayText()}</span>
        <ChevronDown size={12} className="font-size-dropdown-arrow" />
      </button>
      {renderMenu()}
    </div>
  );
};

export default FontSizeDropdown;

