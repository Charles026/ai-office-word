/**
 * DocAgent 统一类型定义
 * 
 * 【职责】
 * 定义 Agent 的 Intent/Context/Result 等核心类型，
 * 供 DocAgentRuntime 和所有 AI 调用点使用。
 * 
 * 【设计原则】
 * - 类型定义与业务逻辑分离
 * - 支持扩展但保持向后兼容
 * - 不引入 UI 或编辑器相关类型
 */

// ==========================================
// AgentKind - Agent 类型枚举
// ==========================================

/**
 * Agent 类型
 * 
 * 定义所有支持的 AI 操作类型
 */
export type AgentKind =
  // 核心操作
  | 'rewrite'           // 改写（支持多种语气）
  | 'translate'         // 翻译
  | 'summarize'         // 总结
  | 'generate_outline'  // 生成大纲
  // 扩展操作
  | 'structure'         // 结构化（列表、标题等）
  | 'expand'            // 扩写
  | 'polish'            // 润色
  // TODO: 未来扩展
  // | 'compare_versions' // 版本对比
  // | 'extract_keywords' // 关键词提取
  // | 'generate_toc'     // 生成目录
  | 'custom';           // 自定义操作

/**
 * Agent 操作来源
 */
export type AgentSource = 
  | 'selection'        // 选区操作
  | 'heading'          // 基于标题/章节
  | 'document'         // 整篇文档
  | 'version-compare'; // 版本对比（预留）

/**
 * 语言/区域设置
 */
export type AgentLocale = 'en' | 'zh' | 'auto';

// ==========================================
// AgentIntent - 操作意图
// ==========================================

/**
 * Agent 操作意图
 * 
 * 描述用户想要执行的 AI 操作
 */
export interface AgentIntent {
  /** 唯一标识（由调用方或 Runtime 生成） */
  id: string;
  
  /** 操作类型 */
  kind: AgentKind;
  
  /** 操作来源 */
  source: AgentSource;
  
  /** 语言设置（可选） */
  locale?: AgentLocale;
  
  /** 操作选项（根据 kind 不同而不同） */
  options?: AgentIntentOptions;
  
  /** 创建时间戳 */
  createdAt?: number;
}

/**
 * Intent 选项
 */
export interface AgentIntentOptions {
  /** 改写语气 */
  tone?: 'formal' | 'concise' | 'friendly' | 'professional';
  
  /** 翻译目标语言 */
  targetLang?: 'en' | 'zh';
  
  /** 结构化格式 */
  structureFormat?: 'bullets' | 'numbered' | 'paragraphs' | 'headings';
  
  /** 自定义提示词 */
  customPrompt?: string;
  
  /** 长度偏好 */
  lengthPreference?: 'shorter' | 'same' | 'longer';
  
  /** 其他自定义选项 */
  [key: string]: unknown;
}

// ==========================================
// AgentContext - 操作上下文
// ==========================================

/**
 * Agent 操作上下文
 * 
 * 提供 AI 操作所需的结构化上下文信息
 * 注意：不包含 UI 对象、编辑器实例等
 */
export interface AgentContext {
  /** 选区文本（用于选区操作） */
  selectionText?: string;
  
  /** 标题 ID（用于章节操作） */
  headingId?: string;
  
  /** 标题文本 */
  headingText?: string;
  
  /** 章节内容（用于章节操作） */
  sectionContent?: string;
  
  /** 章节 HTML（用于保格式操作） */
  sectionHtml?: string;
  
  /** 文档元信息 */
  documentMeta?: DocumentMeta;
  
  /** 上下文文本（选区前后的内容，用于提供语境） */
  surroundingContext?: {
    before?: string;
    after?: string;
  };
  
  // TODO: 未来扩展
  // nodeIds?: string[];     // 涉及的节点 ID 列表
  // versionInfo?: {...}     // 版本信息
}

/**
 * 文档元信息
 */
export interface DocumentMeta {
  /** 文档标题 */
  title?: string;
  
  /** 文档字数 */
  wordCount?: number;
  
  /** 文档 ID */
  docId?: string;
  
  /** 文件路径 */
  filePath?: string;
}

// ==========================================
// AgentResult - 操作结果
// ==========================================

/**
 * Agent 操作结果
 */
export interface AgentResult {
  /** 对应的 Intent ID */
  intentId: string;
  
  /** 是否成功 */
  success: boolean;
  
  /** 错误信息（失败时） */
  error?: string;
  
  /** 生成的 DocOps（由调用方应用到 AST） */
  // TODO: 后续收紧为具体的 DocOps 类型
  docOps: DocOpItem[];
  
  /** 额外信息 */
  payload?: AgentResultPayload;
}

/**
 * DocOps 项（宽类型，后续收紧）
 */
export interface DocOpItem {
  /** 操作类型 */
  type: 'replace' | 'insert' | 'delete' | 'insertAfter';
  
  /** 目标位置/ID */
  target?: string;
  
  /** 新内容 */
  content?: string;
  
  /** 其他数据 */
  [key: string]: unknown;
}

/**
 * 结果额外信息
 */
export interface AgentResultPayload {
  /** 处理耗时（毫秒） */
  latencyMs?: number;
  
  /** Token 消耗 */
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  
  /** 使用的模型 */
  model?: string;
  
  /** 原始 LLM 响应（调试用） */
  rawResponse?: string;
  
  /** 其他调试信息 */
  [key: string]: unknown;
}

// ==========================================
// 工具函数
// ==========================================

/**
 * 生成唯一 Intent ID
 */
export function generateIntentId(): string {
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 创建 AgentIntent
 */
export function createAgentIntent(
  kind: AgentKind,
  source: AgentSource,
  options?: AgentIntentOptions,
  locale?: AgentLocale
): AgentIntent {
  return {
    id: generateIntentId(),
    kind,
    source,
    locale,
    options,
    createdAt: Date.now(),
  };
}

/**
 * 创建成功的 AgentResult
 */
export function createSuccessResult(
  intentId: string,
  docOps: DocOpItem[],
  payload?: AgentResultPayload
): AgentResult {
  return {
    intentId,
    success: true,
    docOps,
    payload,
  };
}

/**
 * 创建失败的 AgentResult
 */
export function createErrorResult(
  intentId: string,
  error: string,
  payload?: AgentResultPayload
): AgentResult {
  return {
    intentId,
    success: false,
    error,
    docOps: [],
    payload,
  };
}

