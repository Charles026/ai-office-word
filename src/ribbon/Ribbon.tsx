/**
 * Ribbon 组件 - 单行工具栏风格
 * 
 * 【改动】
 * - 移除底部 Group Label
 * - 支持 icon-only, label-only, icon-label 变体
 * - 更加紧凑的布局
 * - 增加字体、字号、行距选择下拉
 */

import React, { useCallback } from 'react';
import type { RibbonProps, RibbonCommandId, RibbonTab, RibbonGroup, RibbonButton } from './types.tsx';
import { FontDropdown } from './FontDropdown';
import { FontSizeDropdown } from './FontSizeDropdown';
import { LineHeightDropdown } from './LineHeightDropdown';
import './Ribbon.css';

// ==========================================
// 按钮组件
// ==========================================

interface RibbonButtonProps {
  button: RibbonButton;
  isActive: boolean;
  isDisabled: boolean;
  onClick: () => void;
}

const RibbonButtonComponent: React.FC<RibbonButtonProps> = ({
  button,
  isActive,
  isDisabled,
  onClick,
}) => {
  const { variant = 'icon' } = button;
  
  const className = [
    'ribbon-button',
    `variant-${variant}`,
    isActive ? 'active' : '',
    isDisabled ? 'disabled' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      className={className}
      onClick={onClick}
      disabled={isDisabled}
      title={button.tooltip}
    >
      {(variant === 'icon' || variant === 'icon-label') && button.icon && (
        <span className="ribbon-button-icon">{button.icon}</span>
      )}
      
      {(variant === 'label' || variant === 'icon-label') && button.label && (
        <span className="ribbon-button-label">{button.label}</span>
      )}
    </button>
  );
};

// ==========================================
// 分组组件
// ==========================================

interface RibbonGroupProps {
  group: RibbonGroup;
  activeCommands: RibbonCommandId[];
  disabledCommands: RibbonCommandId[];
  onCommand: (id: RibbonCommandId) => void;
}

const RibbonGroupComponent: React.FC<RibbonGroupProps> = ({
  group,
  activeCommands,
  disabledCommands,
  onCommand,
}) => {
  return (
    <div className="ribbon-group" data-group-id={group.id}>
      {group.items.map(button => (
        <RibbonButtonComponent
          key={button.id}
          button={button}
          isActive={activeCommands.includes(button.id)}
          isDisabled={disabledCommands.includes(button.id)}
          onClick={() => onCommand(button.id)}
        />
      ))}
    </div>
  );
};

// ==========================================
// Tab 内容
// ==========================================

interface RibbonTabContentProps {
  tab: RibbonTab;
  activeCommands: RibbonCommandId[];
  disabledCommands: RibbonCommandId[];
  onCommand: (id: RibbonCommandId) => void;
  // 字体状态
  currentFontKey?: RibbonProps['currentFontKey'];
  isMixedFont?: boolean;
  onFontChange?: RibbonProps['onFontChange'];
  // 字号状态
  currentFontSize?: RibbonProps['currentFontSize'];
  isMixedFontSize?: boolean;
  onFontSizeChange?: RibbonProps['onFontSizeChange'];
  // 行距状态
  currentLineHeight?: RibbonProps['currentLineHeight'];
  isMixedLineHeight?: boolean;
  onLineHeightChange?: RibbonProps['onLineHeightChange'];
  // 对齐状态
  currentTextAlign?: RibbonProps['currentTextAlign'];
}

const RibbonTabContent: React.FC<RibbonTabContentProps> = ({
  tab,
  activeCommands,
  disabledCommands,
  onCommand,
  currentFontKey,
  isMixedFont,
  onFontChange,
  currentFontSize,
  isMixedFontSize,
  onFontSizeChange,
  currentLineHeight,
  isMixedLineHeight,
  onLineHeightChange,
}) => {
  return (
    <div className="ribbon-toolbar">
      {tab.groups.map((group, index) => (
        <React.Fragment key={group.id}>
          {/* 在 font 分组前插入字体和字号下拉 */}
          {group.id === 'font' && (
            <div className="ribbon-group ribbon-font-controls" data-group-id="font-dropdowns">
              {onFontChange && (
                <FontDropdown
                  currentFontKey={currentFontKey ?? null}
                  isMixed={isMixedFont}
                  onFontChange={onFontChange}
                />
              )}
              {onFontSizeChange && (
                <FontSizeDropdown
                  currentSize={currentFontSize ?? null}
                  isMixed={isMixedFontSize}
                  onSizeChange={onFontSizeChange}
                />
              )}
            </div>
          )}
          <RibbonGroupComponent
            group={group}
            activeCommands={activeCommands}
            disabledCommands={disabledCommands}
            onCommand={onCommand}
          />
          {/* 在 paragraph 分组后插入行距下拉 */}
          {group.id === 'paragraph' && onLineHeightChange && (
            <div className="ribbon-group" data-group-id="line-height">
              <LineHeightDropdown
                currentLineHeight={currentLineHeight ?? null}
                isMixed={isMixedLineHeight}
                onLineHeightChange={onLineHeightChange}
              />
            </div>
          )}
          {/* Add separator between groups, but not after the last one */}
          {index < tab.groups.length - 1 && <div className="ribbon-separator" />}
        </React.Fragment>
      ))}
    </div>
  );
};

// ==========================================
// Ribbon 主组件
// ==========================================

export const Ribbon: React.FC<RibbonProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onCommand,
  activeCommands = [],
  disabledCommands = [],
  currentFontKey,
  isMixedFont,
  onFontChange,
  currentFontSize,
  isMixedFontSize,
  onFontSizeChange,
  currentTextAlign,
  onTextAlignChange,
  currentLineHeight,
  isMixedLineHeight,
  onLineHeightChange,
  showOutline,
}) => {
  const activeTab = tabs.find(t => t.id === activeTabId);

  const handleTabClick = useCallback((tabId: string) => {
    onTabChange(tabId);
  }, [onTabChange]);

  // 处理对齐命令
  const handleCommand = useCallback((cmd: RibbonCommandId) => {
    // 对齐命令特殊处理
    if (cmd === 'paragraph:align-left' && onTextAlignChange) {
      onTextAlignChange('left');
      return;
    }
    if (cmd === 'paragraph:align-center' && onTextAlignChange) {
      onTextAlignChange('center');
      return;
    }
    if (cmd === 'paragraph:align-right' && onTextAlignChange) {
      onTextAlignChange('right');
      return;
    }
    onCommand(cmd);
  }, [onCommand, onTextAlignChange]);

  // 计算对齐按钮和大纲按钮的激活状态
  const computedActiveCommands = [...activeCommands];
  if (currentTextAlign === 'left') computedActiveCommands.push('paragraph:align-left');
  if (currentTextAlign === 'center') computedActiveCommands.push('paragraph:align-center');
  if (currentTextAlign === 'right') computedActiveCommands.push('paragraph:align-right');
  if (showOutline) computedActiveCommands.push('view:toggle-outline');

  return (
    <div className="ribbon">
      {/* Tab 栏 (保留) */}
      <div className="ribbon-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`ribbon-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 工具栏区域 */}
      {activeTab && (
        <div className="ribbon-body">
          <RibbonTabContent
            tab={activeTab}
            activeCommands={computedActiveCommands}
            disabledCommands={disabledCommands}
            onCommand={handleCommand}
            currentFontKey={currentFontKey}
            isMixedFont={isMixedFont}
            onFontChange={onFontChange}
            currentFontSize={currentFontSize}
            isMixedFontSize={isMixedFontSize}
            onFontSizeChange={onFontSizeChange}
            currentLineHeight={currentLineHeight}
            isMixedLineHeight={isMixedLineHeight}
            onLineHeightChange={onLineHeightChange}
            currentTextAlign={currentTextAlign}
          />
        </div>
      )}
    </div>
  );
};

export default Ribbon;
