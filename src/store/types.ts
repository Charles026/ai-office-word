/**
 * 全局应用状态类型定义
 * 
 * 【数据模型】
 * - LocalDocMeta: 本地文档元信息
 * - ChatSession/ChatMessage: 会话数据
 * - OpenDocTab: 打开的文档 Tab
 * - AppView: 当前主视图
 */

import { DocumentAst } from '../document/types';

// ==========================================
// 视图类型
// ==========================================

/**
 * 主视图类型
 */
export type AppView = 
  | { type: 'new' }      // 新建文档
  | { type: 'open' }     // 打开文档
  | { type: 'files' }    // 文档列表
  | { type: 'doc'; docId: string }; // 文档编辑

// ==========================================
// 文档相关
// ==========================================

/**
 * 本地文档元信息
 */
export interface LocalDocMeta {
  /** 内部唯一 id，可用文件路径 hash */
  id: string;
  /** 显示名 */
  name: string;
  /** 本地文件路径 */
  fullPath: string;
  /** 文件扩展名 */
  ext: 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'txt' | 'md' | 'other';
  /** 更新时间戳 */
  updatedAt: number;
  /** 文件大小（字节） */
  sizeBytes?: number;
  /** 创建时间戳 */
  createdAt?: number;
}

/**
 * 打开的文档 Tab
 */
export interface OpenDocTab {
  /** Tab ID，同文档 ID */
  id: string;
  /** 文件路径 */
  filePath: string;
  /** 文件名 */
  fileName: string;
  /** 文档类型 */
  kind: 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'txt' | 'md';
  /** 文档 AST（docx 类型 - 已废弃，保留兼容） */
  ast?: DocumentAst;
  /** 文档 HTML 内容（docx 类型 - 新版编辑器使用） */
  html?: string;
  /** 是否有未保存的修改 */
  isDirty?: boolean;
}

// ==========================================
// 会话相关
// ==========================================

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 消息 ID */
  id: string;
  /** 角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 是否正在生成中 */
  isStreaming?: boolean;
}

/**
 * 聊天会话
 */
export interface ChatSession {
  /** 会话 ID */
  id: string;
  /** 会话标题 */
  title: string;
  /** 消息列表 */
  messages: ChatMessage[];
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

// ==========================================
// 全局应用状态
// ==========================================

/**
 * 应用状态
 */
export interface AppState {
  /** 当前视图 */
  currentView: AppView;
  
  // 文档管理
  /** 本地文档列表 */
  docs: LocalDocMeta[];
  /** 文档列表加载状态 */
  docsLoading: boolean;
  /** 文档列表错误 */
  docsError: string | null;
  
  // 文档编辑
  /** 打开的文档 Tab 列表 */
  openTabs: OpenDocTab[];
  /** 当前激活的文档 Tab ID */
  activeTabId: string | null;
  
  // 会话管理
  /** 会话列表 */
  chatSessions: ChatSession[];
  /** 当前会话 ID */
  currentChatId: string | null;
  /** 会话加载状态 */
  chatLoading: boolean;
}

/**
 * 初始状态
 */
export const initialAppState: AppState = {
  currentView: { type: 'new' },
  
  docs: [],
  docsLoading: false,
  docsError: null,
  
  openTabs: [],
  activeTabId: null,
  
  chatSessions: [],
  currentChatId: null,
  chatLoading: false,
};

// ==========================================
// 工具函数
// ==========================================

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 根据文件扩展名获取类型
 */
export function getFileExt(filename: string): LocalDocMeta['ext'] {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'docx':
    case 'doc':
      return 'docx';
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    case 'pptx':
    case 'ppt':
      return 'pptx';
    case 'pdf':
      return 'pdf';
    case 'txt':
      return 'txt';
    case 'md':
      return 'md';
    default:
      return 'other';
  }
}

/**
 * 从消息列表中提取会话标题
 */
export function extractChatTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (firstUserMessage) {
    const content = firstUserMessage.content.trim();
    return content.length > 30 ? content.slice(0, 30) + '...' : content;
  }
  return '新会话';
}

