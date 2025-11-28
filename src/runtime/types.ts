/**
 * AI Runtime 类型定义
 * 
 * 【层级职责】
 * AI Runtime / Copilot 层负责：
 * - 解析自然语言为 Intent
 * - 协调 AI 模型调用
 * - 管理上下文和会话
 * 
 * 【禁止事项】
 * - 不允许在此层直接修改 DocumentAst
 * - 不允许在此层调用文件系统
 * - 当前阶段只定义类型，不实现 LLM 调用逻辑
 * 
 * 【未来扩展】
 * - 接入 OpenAI / Claude / 本地模型
 * - 支持流式输出
 * - 支持多轮对话上下文
 */

import { DocSelection } from '../docops/types';

// ==========================================
// Intent 类型
// ==========================================

/**
 * AI Intent 类型枚举
 * 
 * 表示用户或 AI 想要执行的高层意图
 */
export type AiIntentType =
  // 内容生成
  | 'insert_text'
  | 'insert_section'
  | 'insert_table'
  | 'insert_list'
  // 内容修改
  | 'rewrite'
  | 'summarize'
  | 'expand'
  | 'translate'
  | 'fix_grammar'
  | 'change_tone'
  // 选区 AI 操作（新增）
  | 'rewrite_selection'
  | 'translate_selection'
  | 'summarize_selection'
  | 'expand_selection'
  // 格式化
  | 'format_heading'
  | 'format_bold'
  | 'format_italic'
  | 'format_list'
  // 结构操作
  | 'delete_selection'
  | 'move_block'
  | 'merge_paragraphs'
  | 'split_paragraph'
  // 自定义
  | 'custom';

/**
 * AI Intent
 * 
 * 表示一个高层操作意图
 */
export interface AiIntent {
  /** 意图类型 */
  type: AiIntentType;
  /** 当前选区（操作作用范围） */
  selection?: DocSelection;
  /** 意图参数 */
  payload: AiIntentPayload;
  /** 自然语言原文（可选） */
  rawInput?: string;
}

/**
 * Intent 参数类型
 */
export interface AiIntentPayload {
  /** 目标文本（用于 rewrite/translate 等） */
  targetText?: string;
  /** 选区文本（用于 rewrite_selection 等） */
  selectionText?: string;
  /** 提示词（用于 AI 生成） */
  prompt?: string;
  /** 目标语言（用于 translate） */
  targetLanguage?: string;
  /** 目标语气（用于 change_tone） */
  targetTone?: 'formal' | 'casual' | 'professional' | 'friendly';
  /** 标题级别（用于 format_heading） */
  headingLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 列表类型（用于 format_list） */
  listType?: 'bullet' | 'ordered';
  /** 自定义数据 */
  custom?: Record<string, unknown>;
}

// ==========================================
// 选区 AI 改写专用类型
// ==========================================

/**
 * 选区改写请求参数
 */
export interface RewriteSelectionRequest {
  /** 当前文档 AST */
  ast: import('../document/types').DocumentAst;
  /** 当前选区 */
  selection: DocSelection;
  /** 用户意图描述 */
  userPrompt: string;
}

/**
 * 选区改写响应
 */
export interface RewriteSelectionResponse {
  /** 是否成功 */
  success: boolean;
  /** 生成的新文本 */
  newText?: string;
  /** 生成的 DocOps */
  ops?: import('../docops/types').DocOp[];
  /** 错误信息 */
  error?: string;
  /** 处理耗时 */
  latencyMs?: number;
}

// ==========================================
// AI 会话上下文
// ==========================================

/**
 * AI 会话消息
 */
export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * AI 会话上下文
 * 
 * 用于多轮对话场景（预留）
 */
export interface AiContext {
  /** 会话 ID */
  sessionId: string;
  /** 消息历史 */
  messages: AiMessage[];
  /** 文档上下文（当前选区附近的文本） */
  documentContext?: {
    beforeSelection: string;
    selection: string;
    afterSelection: string;
  };
}

// ==========================================
// AI 响应
// ==========================================

/**
 * AI Runtime 的响应
 */
export interface AiRuntimeResponse {
  /** 是否成功 */
  success: boolean;
  /** 生成的文本（如果是内容生成类 intent） */
  generatedText?: string;
  /** 错误信息 */
  error?: string;
  /** 处理耗时（毫秒） */
  latencyMs?: number;
  /** 模型信息 */
  model?: string;
}

// ==========================================
// 工具函数
// ==========================================

/**
 * 创建简单 Intent
 */
export function createIntent(
  type: AiIntentType,
  payload: AiIntentPayload = {},
  selection?: DocSelection
): AiIntent {
  return {
    type,
    selection,
    payload,
  };
}

