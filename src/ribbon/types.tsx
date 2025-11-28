/**
 * Ribbon 类型定义
 */

import React from 'react';
import { Icon } from '../components/Icon';
import { FontOptionKey } from '../config/fonts';
import { FontSizeKey, LineHeightKey, TextAlignKey } from '../config/typography';

// ==========================================
// 命令 ID
// ==========================================

export type RibbonCommandId =
  // 剪贴板 (Hidden for now)
  | 'clipboard:cut'
  | 'clipboard:copy'
  | 'clipboard:paste'
  | 'clipboard:format-painter'
  // 撤销/重做
  | 'edit:undo'
  | 'edit:redo'
  // 字体
  | 'font:bold'
  | 'font:italic'
  | 'font:underline'
  | 'font:strikethrough'
  | 'font:clear-format'
  // 段落
  | 'paragraph:align-left'
  | 'paragraph:align-center'
  | 'paragraph:align-right'
  | 'paragraph:list-bullet'
  | 'paragraph:list-number'
  | 'paragraph:indent-increase'
  | 'paragraph:indent-decrease'
  // 样式 (Headings)
  | 'style:heading-1'
  | 'style:heading-2'
  | 'style:heading-3'
  | 'style:paragraph'
  // 工具
  | 'tools:show-paragraph-marks'
  // AI
  | 'ai:rewrite'
  | 'ai:translate-doc-zh'   // 整篇翻译为中文
  | 'ai:translate-doc-en'   // 整篇翻译为英文
  | 'ai:summarize-doc'      // 逐节总结
  // 视图
  | 'view:toggle-outline'
  | 'view:toggle-copilot'
  // 文件操作
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:save-as';

// ==========================================
// 按钮配置
// ==========================================

export interface RibbonButton {
  id: RibbonCommandId;
  label?: string; // Optional for icon-only buttons
  icon?: React.ReactNode;
  tooltip?: string;
  disabled?: boolean;
  active?: boolean;
  variant?: 'icon' | 'icon-label' | 'label'; // Display mode
}

export interface RibbonGroup {
  id: string;
  items: RibbonButton[]; // Renamed from buttons to items for generality
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

// ==========================================
// Ribbon Props
// ==========================================

export interface RibbonProps {
  tabs: RibbonTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onCommand: (commandId: RibbonCommandId) => void;
  /** 用于按钮高亮的状态 */
  activeCommands?: RibbonCommandId[];
  /** 禁用的命令 */
  disabledCommands?: RibbonCommandId[];
  /** 字体状态 */
  currentFontKey?: FontOptionKey | null;
  isMixedFont?: boolean;
  onFontChange?: (fontKey: FontOptionKey) => void;
  /** 字号状态 */
  currentFontSize?: FontSizeKey | null;
  isMixedFontSize?: boolean;
  onFontSizeChange?: (size: FontSizeKey) => void;
  /** 对齐状态 */
  currentTextAlign?: TextAlignKey | null;
  onTextAlignChange?: (align: TextAlignKey) => void;
  /** 行距状态 */
  currentLineHeight?: LineHeightKey | null;
  isMixedLineHeight?: boolean;
  onLineHeightChange?: (lineHeight: LineHeightKey) => void;
  /** 大纲面板状态 */
  showOutline?: boolean;
}

// ==========================================
// 默认 Tab 配置 (Notion-like Single Line)
// ==========================================

export const DEFAULT_TABS: RibbonTab[] = [
  {
    id: 'file',
    label: '文件',
    groups: [
      {
        id: 'file-ops',
        items: [
          { id: 'file:new', icon: <Icon name="Plus" />, tooltip: '新建 (⌘N)', variant: 'icon' },
          { id: 'file:open', icon: <Icon name="FolderOpen" />, tooltip: '打开 (⌘O)', variant: 'icon' },
          { id: 'file:save', icon: <Icon name="Save" />, tooltip: '保存 (⌘S)', variant: 'icon' },
        ],
      },
    ],
  },
  {
    id: 'home',
    label: '开始',
    groups: [
      {
        id: 'history',
        items: [
          { id: 'edit:undo', icon: <Icon name="Undo" />, tooltip: '撤销 (⌘Z)', variant: 'icon' },
          { id: 'edit:redo', icon: <Icon name="Redo" />, tooltip: '重做 (⌘⇧Z)', variant: 'icon' },
        ],
      },
      {
        id: 'font',
        items: [
          { id: 'font:bold', icon: <Icon name="Bold" />, tooltip: '加粗 (⌘B)', variant: 'icon' },
          { id: 'font:italic', icon: <Icon name="Italic" />, tooltip: '斜体 (⌘I)', variant: 'icon' },
          { id: 'font:underline', icon: <Icon name="Underline" />, tooltip: '下划线 (⌘U)', variant: 'icon' },
          { id: 'font:strikethrough', icon: <Icon name="Strikethrough" />, tooltip: '删除线', variant: 'icon' },
          { id: 'font:clear-format', icon: <Icon name="Eraser" />, label: '清除', tooltip: '清除格式', variant: 'icon-label' },
        ],
      },
      {
        id: 'styles',
        items: [
          // Simplified headings for single line
          { id: 'style:paragraph', label: '正文', tooltip: '正文', variant: 'label' },
          { id: 'style:heading-1', label: 'H1', tooltip: '标题 1', variant: 'label' },
          { id: 'style:heading-2', label: 'H2', tooltip: '标题 2', variant: 'label' },
          { id: 'style:heading-3', label: 'H3', tooltip: '标题 3', variant: 'label' },
        ],
      },
      {
        id: 'paragraph',
        items: [
          { id: 'paragraph:list-bullet', icon: <Icon name="List" />, tooltip: '项目符号 (⌘⇧8)', variant: 'icon' },
          { id: 'paragraph:list-number', icon: <Icon name="ListOrdered" />, tooltip: '编号列表 (⌘⇧7)', variant: 'icon' },
          { id: 'paragraph:indent-decrease', icon: <Icon name="IndentDecrease" />, tooltip: '减少缩进 (⇧Tab)', variant: 'icon' },
          { id: 'paragraph:indent-increase', icon: <Icon name="IndentIncrease" />, tooltip: '增加缩进 (Tab)', variant: 'icon' },
          { id: 'paragraph:align-left', icon: <Icon name="AlignLeft" />, tooltip: '左对齐', variant: 'icon' },
          { id: 'paragraph:align-center', icon: <Icon name="AlignCenter" />, tooltip: '居中', variant: 'icon' },
          { id: 'paragraph:align-right', icon: <Icon name="AlignRight" />, tooltip: '右对齐', variant: 'icon' },
        ],
      },
      {
        id: 'tools',
        items: [
          { id: 'tools:show-paragraph-marks', icon: <Icon name="Pilcrow" />, tooltip: '显示/隐藏段落标记', variant: 'icon' },
          { id: 'view:toggle-outline', icon: <Icon name="Sidebar" />, tooltip: '显示/隐藏大纲 (⌘⇧O)', variant: 'icon' },
        ],
      },
      {
        id: 'ai',
        items: [
          { id: 'ai:rewrite', icon: <Icon name="Sparkles" />, label: 'AI 改写', tooltip: 'AI 智能改写选区', variant: 'icon-label' },
          { id: 'ai:translate-doc-zh', icon: <Icon name="Languages" />, label: '译中', tooltip: '整篇翻译为中文', variant: 'icon-label' },
          { id: 'ai:translate-doc-en', icon: <Icon name="Languages" />, label: '译英', tooltip: '整篇翻译为英文', variant: 'icon-label' },
          { id: 'ai:summarize-doc', icon: <Icon name="Wand2" />, label: '逐节总结', tooltip: '为每节生成总结', variant: 'icon-label' },
        ],
      },
    ],
  },
];
