/**
 * Copilot Runtime 类型定义
 * 
 * 【职责】
 * - 定义 CopilotRuntime 的会话状态
 * - 定义 Intent 协议（LLM 输出 → 文档操作）
 * - 定义 ModelOutput 格式
 * 
 * 【设计原则】
 * - 最小可用集合，只支持 2~3 个编辑动作
 * - Intent 类型只做"软协议"，解析失败时当纯聊天
 * - 不引入硬编码枚举判断用户自然语言
 */

// ==========================================
// Scope 类型
// ==========================================

/**
 * Copilot 作用范围
 * - 'document': 整篇文档级别
 * - 'section': 单个章节级别
 */
export type CopilotRuntimeScope = 'document' | 'section';

// ==========================================
// Session State 类型
// ==========================================

/**
 * 用户偏好设置
 */
export interface CopilotUserPrefs {
  /** 首选语言 */
  language: 'zh' | 'en' | 'mixed';
  /** 回复风格 */
  style: 'concise' | 'detailed';
}

/**
 * Copilot 会话状态
 * 
 * 维护单次 Copilot 会话的上下文信息。
 * 不包含持久化的用户历史，只维护当前会话。
 */
export interface CopilotSessionState {
  /** 当前文档 ID */
  docId: string;
  /** 当前聚焦范围 */
  scope: CopilotRuntimeScope;
  /** scope='section' 时必填，指向具体章节的 ID */
  focusSectionId?: string;
  /** 用户偏好（可选，有默认值） */
  userPrefs: CopilotUserPrefs;
  /** 最近一次任务类型，用于连续 refinement（可选） */
  lastTask?: string;
}

/**
 * 创建默认会话状态
 */
export function createDefaultSessionState(docId: string): CopilotSessionState {
  return {
    docId,
    scope: 'document',
    userPrefs: {
      language: 'zh',
      style: 'concise',
    },
  };
}

// ==========================================
// Intent 协议类型
// ==========================================

/**
 * Copilot 模式
 * - 'chat': 纯聊天，不改文档
 * - 'edit': 执行文档编辑操作
 */
export type CopilotMode = 'chat' | 'edit';

/**
 * Copilot 支持的动作类型（Phase 1 只支持这几个）
 * 
 * - rewrite_section: 重写章节
 * - rewrite_paragraph: 重写单个段落 (v1.1 新增)
 * - summarize_section: 总结章节
 * - summarize_document: 总结整篇文档
 * - highlight_terms: 标记关键词（暂未实现）
 */
export type CopilotAction =
  | 'rewrite_section'
  | 'rewrite_paragraph'
  | 'summarize_section'
  | 'summarize_document'
  | 'highlight_terms';

/**
 * 段落引用类型 (v1.1 新增)
 * 
 * - 'current': 当前光标所在段落
 * - 'previous': 上一段
 * - 'next': 下一段
 * - 'nth': 第 N 段（配合 paragraphIndex 使用）
 */
export type ParagraphRef = 'current' | 'previous' | 'next' | 'nth';

/**
 * Intent 参数扩展类型 (v1.1 新增)
 */
export interface CopilotIntentParams {
  /** 段落引用方式 */
  paragraphRef?: ParagraphRef;
  /** 段落索引（1-based，仅 paragraphRef='nth' 时使用） */
  paragraphIndex?: number;
  /** 其他自定义参数 */
  [key: string]: unknown;
}

/**
 * Intent 操作目标
 */
export interface CopilotIntentTarget {
  /** 作用范围 */
  scope: CopilotRuntimeScope;
  /** scope='section' 时必填，指向目标章节 */
  sectionId?: string;
}

/**
 * Copilot Intent 结构
 * 
 * 从 LLM 输出中解析出的结构化意图。
 * 告诉 Runtime 应该执行什么操作。
 */
export interface CopilotIntent {
  /** 模式：chat 或 edit */
  mode: CopilotMode;
  /** 动作类型 */
  action: CopilotAction;
  /** 操作目标 */
  target: CopilotIntentTarget;
  /** 附加参数（可选，用于扩展） */
  params?: CopilotIntentParams;
}

// ==========================================
// Model Output 类型
// ==========================================

/**
 * Intent 解析状态 (v1.1)
 */
export type IntentParseStatus = 
  | 'ok'              // 解析成功
  | 'missing'         // 没有 [INTENT] 块
  | 'json_error'      // JSON 解析失败
  | 'validation_error'; // 字段验证失败

/**
 * Copilot 模型输出
 * 
 * 从 LLM 原始响应中解析出的结构化结果。
 */
export interface CopilotModelOutput {
  /** 解析出的 Intent（可能为空，表示纯聊天） */
  intent?: CopilotIntent;
  /** 给用户看的自然语言回复 */
  replyText: string;
  /** 原始模型输出（便于调试） */
  rawText: string;
  
  // ========== v1.1 新增 ==========
  
  /** Intent 解析状态 */
  parseStatus?: IntentParseStatus;
  /** 解析错误详情（仅在解析失败时） */
  parseError?: string;
}

// ==========================================
// Guard 函数
// ==========================================

/**
 * 检查是否是有效的 CopilotAction
 */
export function isCopilotAction(value: unknown): value is CopilotAction {
  return (
    typeof value === 'string' &&
    ['rewrite_section', 'rewrite_paragraph', 'summarize_section', 'summarize_document', 'highlight_terms'].includes(value)
  );
}

/**
 * 检查是否是有效的 ParagraphRef
 */
export function isParagraphRef(value: unknown): value is ParagraphRef {
  return (
    typeof value === 'string' &&
    ['current', 'previous', 'next', 'nth'].includes(value)
  );
}

/**
 * 检查是否是有效的 CopilotMode
 */
export function isCopilotMode(value: unknown): value is CopilotMode {
  return value === 'chat' || value === 'edit';
}

/**
 * 检查是否是有效的 CopilotRuntimeScope
 */
export function isCopilotRuntimeScope(value: unknown): value is CopilotRuntimeScope {
  return value === 'document' || value === 'section';
}

/**
 * 检查 Intent 是否需要 sectionId
 */
export function intentRequiresSectionId(action: CopilotAction): boolean {
  return action === 'rewrite_section' || action === 'rewrite_paragraph' || action === 'summarize_section' || action === 'highlight_terms';
}

/**
 * 检查 Intent 是否是段落级操作
 */
export function isParagraphAction(action: CopilotAction): boolean {
  return action === 'rewrite_paragraph';
}

/**
 * 特殊的 sectionId 值
 * - 'current': 使用当前聚焦的章节
 * - 'auto': 由 runtime 自动推断
 */
export const SPECIAL_SECTION_IDS = ['current', 'auto'] as const;
export type SpecialSectionId = typeof SPECIAL_SECTION_IDS[number];

/**
 * 检查是否是特殊 sectionId
 */
export function isSpecialSectionId(value: unknown): value is SpecialSectionId {
  return typeof value === 'string' && SPECIAL_SECTION_IDS.includes(value as SpecialSectionId);
}

/**
 * 验证 CopilotIntent 结构
 * 
 * @returns 验证通过返回 true，否则返回 false
 */
export function validateCopilotIntent(intent: unknown): intent is CopilotIntent {
  if (!intent || typeof intent !== 'object') return false;
  
  const obj = intent as Record<string, unknown>;
  
  // 必须有 mode
  if (!isCopilotMode(obj.mode)) return false;
  
  // 必须有 action
  if (!isCopilotAction(obj.action)) return false;
  
  // 必须有 target
  if (!obj.target || typeof obj.target !== 'object') return false;
  
  const target = obj.target as Record<string, unknown>;
  
  // target.scope 必须有效
  if (!isCopilotRuntimeScope(target.scope)) return false;
  
  // 如果 action 需要 sectionId，则必须提供（允许特殊值 'current' / 'auto'）
  if (intentRequiresSectionId(obj.action as CopilotAction)) {
    if (target.scope !== 'section') return false;
    // 允许特殊 sectionId 或非空字符串
    if (typeof target.sectionId !== 'string' || target.sectionId.length === 0) return false;
  }
  
  return true;
}

/**
 * 安全地解析 Intent JSON
 * 
 * @returns 解析成功返回 CopilotIntent，失败返回 null
 */
export function parseCopilotIntentSafe(json: unknown): CopilotIntent | null {
  if (!validateCopilotIntent(json)) {
    return null;
  }
  return json as CopilotIntent;
}

// ==========================================
// 辅助类型
// ==========================================

/**
 * Intent 解析结果（内部使用）
 */
export interface IntentParseResult {
  /** 是否解析成功 */
  success: boolean;
  /** 解析出的 Intent */
  intent?: CopilotIntent;
  /** 回复文本 */
  replyText: string;
  /** 错误信息（如果解析失败） */
  error?: string;
}

