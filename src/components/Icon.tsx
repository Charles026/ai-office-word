/**
 * 统一图标组件
 * 
 * 基于 lucide-react 封装，提供统一的图标管理。
 */

import React from 'react';
import {
  Plus,
  Sparkles,
  FolderOpen,
  FileText,
  File,
  Undo,
  Redo,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Pilcrow,
  Save,
  Eraser,
  MessageSquare,
  Type,
  ChevronDown,
  IndentDecrease,
  IndentIncrease,
  Sidebar,
  Languages,
  Wand2,
  Zap,
  Send,
  Heading,
  Trash2,
  X,
  TextSelect,
  MessageCircle,
  Info,
  Bug,
  Search,
  Copy,
  Check,
} from 'lucide-react';

export type IconName = 
  | 'Plus'
  | 'Sparkles'
  | 'FolderOpen'
  | 'FileText'
  | 'File'
  | 'Undo'
  | 'Redo'
  | 'Bold'
  | 'Italic'
  | 'Underline'
  | 'Strikethrough'
  | 'List'
  | 'ListOrdered'
  | 'AlignLeft'
  | 'AlignCenter'
  | 'AlignRight'
  | 'Pilcrow'
  | 'Save'
  | 'Eraser'
  | 'MessageSquare'
  | 'Type'
  | 'ChevronDown'
  | 'IndentDecrease'
  | 'IndentIncrease'
  | 'Sidebar'
  | 'Languages'
  | 'Wand2'
  | 'Zap'
  | 'Send'
  | 'Heading'
  | 'Trash2'
  | 'X'
  | 'TextSelect'
  | 'MessageCircle'
  | 'Info'
  | 'Bug'
  | 'Search'
  | 'Copy'
  | 'Check';

const ICONS: Record<IconName, React.ElementType> = {
  Plus,
  Sparkles,
  FolderOpen,
  FileText,
  File,
  Undo,
  Redo,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Pilcrow,
  Save,
  Eraser,
  MessageSquare,
  Type,
  ChevronDown,
  IndentDecrease,
  IndentIncrease,
  Sidebar,
  Languages,
  Wand2,
  Zap,
  Send,
  Heading,
  Trash2,
  X,
  TextSelect,
  MessageCircle,
  Info,
  Bug,
  Search,
  Copy,
  Check,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const Icon: React.FC<IconProps> = ({ name, size = 18, className, style }) => {
  const LucideIcon = ICONS[name];
  
  if (!LucideIcon) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }

  return <LucideIcon size={size} className={className} style={style} />;
};

