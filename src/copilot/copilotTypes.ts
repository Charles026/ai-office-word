/**
 * Copilot 类型定义
 * 
 * 【职责】
 * - 定义 Copilot 会话模型的所有类型
 * - 定义上下文快照类型
 * - 定义 GUI 事件类型
 * 
 * 【世界观】
 * Copilot 不是一个小插件，而是「文档语义层 + 操作层」之间的中枢。
 * 它能：
 * 1. 像 ChatGPT 一样回答知识问题
 * 2. 长期稳定地"盯着"用户在 Word 里的 GUI 行为
 * 3. 接受自然语言命令，生成精确的文档操作
 * 4. 记住最近几轮对话和文档操作，支持连续 refinement
 */

// ==========================================
// 消息角色
// ==========================================

/**
 * Copilot 消息角色
 * - user: 用户输入
 * - assistant: AI 回复
 * - system: 系统消息（提示、警告等）
 * - action: 文档操作消息（改写、总结等）
 */
export type CopilotRole = 'user' | 'assistant' | 'system' | 'action';

// ==========================================
// 上下文作用范围
// ==========================================

/**
 * Copilot 上下文作用范围
 * - none: 不绑定文档（纯闲聊）
 * - selection: 当前选区
 * - section: 当前 H2/H3 章节
 * - document: 整篇文档
 */
export type CopilotScope = 'none' | 'selection' | 'section' | 'document';

// ==========================================
// 消息类型
// ==========================================

/**
 * Copilot 消息
 */
export interface CopilotMessage {
  /** 唯一 ID */
  id: string;
  /** 消息角色 */
  role: CopilotRole;
  /** 主体文本内容（Markdown/纯文本） */
  content: string;
  /** 创建时间戳 (Date.now()) */
  createdAt: number;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 元数据（用于 action / 文档相关消息） */
  meta?: CopilotMessageMeta;
}

/**
 * 消息元数据
 */
export interface CopilotMessageMeta {
  /** 关联的文档 ID */
  docId?: string;
  /** 作用范围 */
  scope?: CopilotScope;
  /** 章节 ID */
  sectionId?: string;
  /** 章节标题 */
  sectionTitle?: string;
  /** 操作类型（例如 'rewrite_section', 'summarize_section' 等） */
  actionType?: string;
  /** 操作状态 */
  status?: 'pending' | 'applied' | 'failed' | 'reverted';
  /** 错误信息 */
  error?: string;
  /** 是否支持撤销 */
  undoable?: boolean;
  /** 撤销快照 ID */
  undoSnapshotId?: string;
}

// ==========================================
// 上下文快照
// ==========================================

/**
 * 操作元信息（用于 lastActions 记录）
 */
export interface CopilotActionMeta {
  /** 唯一 ID */
  id: string;
  /** 操作类型 */
  type: string;
  /** 作用范围 */
  scope: CopilotScope;
  /** 关联文档 ID */
  docId: string;
  /** 章节 ID */
  sectionId?: string;
  /** 章节标题 */
  sectionTitle?: string;
  /** 创建时间 */
  createdAt: number;
  /** 状态 */
  status?: 'applied' | 'reverted';
  /** 撤销快照 ID */
  undoSnapshotId?: string;
}

/**
 * Copilot 上下文快照
 * 
 * 实时反映用户当前在文档里的位置和行为
 */
export interface CopilotContext {
  /** 当前激活文档的 ID/path，如果没有则为 null */
  docId: string | null;
  /** 当前语义范围 */
  scope: CopilotScope;
  /** 当前聚焦的 H2/H3 nodeKey */
  sectionId: string | null;
  /** 当前聚焦标题文本 */
  sectionTitle: string | null;
  /** 选区前后若干字的片段（可为空） */
  selectionSnippet: string | null;
  /** 最近一次上下文变更时间 */
  lastUpdatedAt: number;
  /** 最近发生的一些动作，用于将来做连续对话（Phase5 会用） */
  lastActions: CopilotActionMeta[];
}

// ==========================================
// 会话类型
// ==========================================

/**
 * Copilot 会话（按文档维度）
 */
export interface CopilotSession {
  /** 对应文档 ID */
  docId: string;
  /** 该文档下的所有对话消息 */
  messages: CopilotMessage[];
  /** 会话创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
}

// ==========================================
// 编辑器事件类型（Phase 2 的 GUI 事件总线）
// ==========================================

/**
 * 编辑器事件类型
 */
export type EditorEventType =
  | 'document_opened'
  | 'document_closed'
  | 'cursor_moved'
  | 'selection_changed'
  | 'heading_focused'
  | 'heading_blurred'
  | 'section_ai_action';

/**
 * 编辑器事件载荷
 */
export interface EditorEventPayload {
  /** 章节 ID */
  sectionId?: string;
  /** 章节标题 */
  sectionTitle?: string;
  /** 选区文本 */
  selectionText?: string;
  /** 章节层级 */
  headingLevel?: number;
  /** AI 操作类型 */
  actionType?: string;
  /** 后续可扩展其它字段 */
  [key: string]: unknown;
}

/**
 * 编辑器事件
 */
export interface EditorEvent {
  /** 事件类型 */
  type: EditorEventType;
  /** 关联文档 ID */
  docId: string;
  /** 事件载荷 */
  payload?: EditorEventPayload;
  /** 创建时间 */
  createdAt: number;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 生成唯一 ID
 */
export function generateCopilotId(prefix = 'copilot'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 创建默认上下文
 */
export function createDefaultContext(): CopilotContext {
  return {
    docId: null,
    scope: 'none',
    sectionId: null,
    sectionTitle: null,
    selectionSnippet: null,
    lastUpdatedAt: Date.now(),
    lastActions: [],
  };
}

/**
 * 创建用户消息
 */
export function createUserMessage(content: string, meta?: CopilotMessageMeta): CopilotMessage {
  return {
    id: generateCopilotId('msg'),
    role: 'user',
    content,
    createdAt: Date.now(),
    meta,
  };
}

/**
 * 创建助手消息
 */
export function createAssistantMessage(
  content: string,
  isStreaming = false,
  meta?: CopilotMessageMeta
): CopilotMessage {
  return {
    id: generateCopilotId('msg'),
    role: 'assistant',
    content,
    createdAt: Date.now(),
    isStreaming,
    meta,
  };
}

/**
 * 创建操作消息
 */
export function createActionMessage(
  content: string,
  meta: CopilotMessageMeta
): CopilotMessage {
  return {
    id: generateCopilotId('action'),
    role: 'action',
    content,
    createdAt: Date.now(),
    meta,
  };
}

/**
 * 创建新会话
 */
export function createSession(docId: string): CopilotSession {
  const now = Date.now();
  return {
    docId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

