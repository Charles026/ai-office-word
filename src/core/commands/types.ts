/**
 * 命令系统类型定义
 * 
 * 【设计原则】
 * - 所有编辑操作都通过命令执行
 * - Ribbon / 快捷键 / AI 改写 共用同一套命令
 * - 命令只操作 AST 和 SelectionState，不碰 DOM
 * 
 * 【命令分类】
 * - 文本格式：toggleBold, toggleItalic, toggleUnderline, toggleStrike
 * - 段落格式：setBlockType, setAlignment, toggleList
 * - 编辑：insertText, deleteRange, replaceRange, splitBlock
 * - 历史：undo, redo
 * - 文件：save（由 UI 层处理）
 */

import { DocumentAst } from '../../document/types';
import { DocSelection } from '../../document/selection';

// ==========================================
// 命令 ID 枚举
// ==========================================

/**
 * 所有支持的命令 ID
 */
export type CommandId =
  // 文本格式
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  | 'toggleStrike'
  
  // 段落/块级格式
  | 'setBlockTypeParagraph'
  | 'setBlockTypeHeading1'
  | 'setBlockTypeHeading2'
  | 'setBlockTypeHeading3'
  | 'toggleBulletList'
  | 'toggleNumberList'
  
  // 对齐
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  
  // 编辑操作
  | 'insertText'
  | 'deleteRange'
  | 'replaceRange'
  | 'splitBlock'
  | 'insertLineBreak'
  
  // 历史
  | 'undo'
  | 'redo'
  
  // 剪贴板
  | 'cut'
  | 'copy'
  | 'paste'
  
  // AI 相关
  | 'aiRewrite';

// ==========================================
// 命令 Payload 类型
// ==========================================

/**
 * 命令 Payload 映射
 */
export interface CommandPayloadMap {
  // 文本格式（无 payload 或 force）
  toggleBold: { force?: boolean };
  toggleItalic: { force?: boolean };
  toggleUnderline: { force?: boolean };
  toggleStrike: { force?: boolean };
  
  // 段落格式（无 payload）
  setBlockTypeParagraph: undefined;
  setBlockTypeHeading1: undefined;
  setBlockTypeHeading2: undefined;
  setBlockTypeHeading3: undefined;
  toggleBulletList: undefined;
  toggleNumberList: undefined;
  
  // 对齐（无 payload）
  alignLeft: undefined;
  alignCenter: undefined;
  alignRight: undefined;
  alignJustify: undefined;
  
  // 编辑操作
  insertText: { text: string };
  deleteRange: undefined;
  replaceRange: { newText: string };
  splitBlock: undefined;
  insertLineBreak: undefined;
  
  // 历史（无 payload）
  undo: undefined;
  redo: undefined;
  
  // 剪贴板
  cut: undefined;
  copy: undefined;
  paste: { text?: string; html?: string };
  
  // AI 改写
  aiRewrite: { newText: string };
}

// ==========================================
// 命令执行上下文
// ==========================================

/**
 * 命令执行时的上下文
 */
export interface CommandContext {
  /** 当前文档 AST */
  ast: DocumentAst;
  /** 当前选区 */
  selection: DocSelection | null;
}

/**
 * 命令执行结果
 */
export interface CommandResult {
  /** 是否执行成功 */
  success: boolean;
  /** 新的文档 AST */
  nextAst: DocumentAst;
  /** 新的选区 */
  nextSelection: DocSelection | null;
  /** 错误消息（如果失败） */
  error?: string;
}

// ==========================================
// 命令状态
// ==========================================

/**
 * 命令的当前状态（用于 UI 反馈）
 */
export interface CommandState {
  /** 命令是否可用 */
  enabled: boolean;
  /** 命令是否处于激活状态（如：当前选区已加粗） */
  active: boolean;
}

/**
 * 所有命令的状态映射
 */
export type CommandStates = Partial<Record<CommandId, CommandState>>;

// ==========================================
// 命令处理器
// ==========================================

/**
 * 命令处理器函数类型
 */
export type CommandHandler<T extends CommandId> = (
  context: CommandContext,
  payload: CommandPayloadMap[T]
) => CommandResult;

/**
 * 命令注册表
 */
export type CommandRegistry = {
  [K in CommandId]?: CommandHandler<K>;
};

// ==========================================
// Ribbon 命令 ID 映射
// ==========================================

/**
 * Ribbon 命令 ID 到 Command ID 的映射
 */
export const RIBBON_TO_COMMAND: Record<string, CommandId> = {
  // 编辑
  'edit:undo': 'undo',
  'edit:redo': 'redo',
  
  // 剪贴板
  'clipboard:cut': 'cut',
  'clipboard:copy': 'copy',
  'clipboard:paste': 'paste',
  
  // 字体
  'font:bold': 'toggleBold',
  'font:italic': 'toggleItalic',
  'font:underline': 'toggleUnderline',
  'font:strikethrough': 'toggleStrike',
  
  // 段落
  'paragraph:align-left': 'alignLeft',
  'paragraph:align-center': 'alignCenter',
  'paragraph:align-right': 'alignRight',
  'paragraph:list-bullet': 'toggleBulletList',
  'paragraph:list-number': 'toggleNumberList',
  
  // 样式
  'style:heading-1': 'setBlockTypeHeading1',
  'style:heading-2': 'setBlockTypeHeading2',
  'style:heading-3': 'setBlockTypeHeading3',
  'style:paragraph': 'setBlockTypeParagraph',
};

