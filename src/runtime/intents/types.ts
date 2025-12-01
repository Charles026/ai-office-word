/**
 * Intent 类型定义
 * 
 * 【职责】
 * 定义 DocAgentRuntime 使用的所有 Intent 相关类型。
 * Intent 是"用户想做什么"的结构化描述，不包含具体内容。
 * 
 * 【设计原则】
 * - Intent 只描述"意图"，不包含大段文本
 * - 所有类型必须可 JSON 序列化
 * - 保持可扩展性，预留未来 action 位置
 */

// ==========================================
// AgentKind - 操作类型枚举
// ==========================================

/**
 * Agent 操作类型
 * 
 * 命名规则：
 * - 选区级操作：不带后缀（rewrite, translate, summarize）
 * - Section 级操作：带 '_section' 后缀
 * - 文档级操作：带 '_document' 后缀（预留）
 */
export type AgentKind =
  // ========== Section 级操作（当前任务核心） ==========
  | 'rewrite_section'      // 重写 section
  | 'summarize_section'    // 总结 section
  | 'expand_section'       // 扩写 section
  | 'highlight_section'    // 🆕 只高亮 section（不改写）
  
  // ========== 选区级操作 ==========
  | 'rewrite'              // 重写选区
  | 'translate'            // 翻译选区
  | 'summarize'            // 总结选区
  
  // ========== 文档级操作 ==========
  | 'generate_outline'     // 生成大纲
  | 'translate_document'   // 翻译整篇文档（预留）
  | 'summarize_document'   // 总结整篇文档（预留）
  
  // ========== 版本/对比操作（预留） ==========
  | 'compare_versions'     // 版本对比
  
  // ========== 语义 Section 操作（预留） ==========
  // TODO: 未来可扩展
  // | 'identify_requirements'  // 自动识别需求段
  // | 'identify_features'      // 自动识别功能段
  // | 'semantic_section'       // 语义 section 分析
  
  // ========== Outline 级操作（预留） ==========
  // TODO: 未来可扩展
  // | 'restructure_outline'    // 重构大纲
  // | 'optimize_outline'       // 优化大纲结构
  
  // ========== Agent 工具链（预留） ==========
  // TODO: 未来可扩展
  // | 'agent_chain'            // Agent 工具链调用
  // | 'multi_step_edit'        // 多步编辑
  ;

// ==========================================
// AgentSource - 操作来源
// ==========================================

/**
 * Agent 操作来源
 * 
 * 描述 Intent 作用的范围/来源
 */
export type AgentSource =
  | 'selection'   // 选区操作
  | 'heading'     // H2/H3 上的单点操作
  | 'section'     // Section 级操作（当前任务新增）
  | 'document';   // 全文级操作

// ==========================================
// AgentIntentOptions - 操作选项
// ==========================================

/**
 * 重写语气
 */
export type RewriteTone = 'formal' | 'casual' | 'concise' | 'friendly' | 'default';

/**
 * 重写深度
 */
export type RewriteDepth = 'light' | 'medium' | 'heavy';

/**
 * 总结风格
 */
export type SummaryStyle = 'bullet' | 'short' | 'long';

/**
 * 扩写长度
 */
export type ExpandLength = 'short' | 'medium' | 'long';

/**
 * 翻译方向
 */
export type TranslateDirection = 'en_to_zh' | 'zh_to_en';

/**
 * Section 重写范围
 * 
 * - 'intro': 只重写导语部分（ownParagraphs）
 * - 'chapter': 重写整章内容（subtreeParagraphs，包含子 H3）
 */
export type SectionScope = 'intro' | 'chapter';

/**
 * 高亮模式
 * 
 * 控制 Section AI 使用哪种粒度的高亮
 * - 'none': 不高亮
 * - 'terms': 只高亮词语/短语
 * - 'sentences': 只高亮句子
 * - 'paragraphs': 只高亮段落（预留）
 * - 'auto': 让模型根据内容选择（可同时用多种）
 */
export type HighlightMode = 'none' | 'terms' | 'sentences' | 'paragraphs' | 'auto';

/**
 * Agent 操作选项
 * 
 * 包含各种 action 的可选参数
 */
export interface AgentIntentOptions {
  // ========== rewrite_section 参数 ==========
  /** 重写语气 */
  rewriteTone?: RewriteTone;
  /** 重写深度 */
  rewriteDepth?: RewriteDepth;
  /** 
   * 重写范围（仅 rewrite_section 有效）
   * 
   * - 'intro': 只重写导语部分（ownParagraphs）
   * - 'chapter': 重写整章内容（subtreeParagraphs，包含子 H3）
   * 
   * 默认为 'intro'
   */
  rewriteScope?: SectionScope;
  
  // ========== summarize_section 参数 ==========
  /** 总结风格 */
  summaryStyle?: SummaryStyle;
  
  // ========== expand_section 参数 ==========
  /** 扩写长度 */
  expandLength?: ExpandLength;
  
  // ========== translate 参数 ==========
  /** 翻译方向 */
  translateDirection?: TranslateDirection;
  /** 目标语言 */
  targetLang?: 'en' | 'zh';
  
  // ========== 高亮参数 ==========
  /**
   * 高亮模式
   * 
   * - 'none': 不高亮（默认）
   * - 'terms': 只高亮词语/短语
   * - 'sentences': 只高亮句子
   * - 'paragraphs': 只高亮段落（预留）
   * - 'auto': 让模型根据内容选择（可同时用多种）
   */
  highlightMode?: HighlightMode;
  
  // ========== 通用参数 ==========
  /** 自定义提示词 */
  customPrompt?: string;
  
  // ========== 预留：Agent 工具链 hint ==========
  // TODO: 未来可扩展
  // agentHints?: {
  //   domainKnowledge?: string[];
  //   styleGuide?: string;
  //   constraints?: string[];
  // };
  
  // ========== 预留：Outline pattern ==========
  // TODO: 未来可扩展
  // outlinePattern?: 'hierarchical' | 'flat' | 'custom';
  
  /** 允许扩展字段 */
  [key: string]: unknown;
}

// ==========================================
// AgentIntent - 核心 Intent 结构
// ==========================================

/**
 * Intent 元数据
 */
export interface AgentIntentMetadata {
  /** Section ID（Section 级操作必填） */
  sectionId?: string;
  /** Section 层级（2=H2, 3=H3） */
  sectionLevel?: number;
  /** 文档 ID */
  docId?: string;
  /** 创建时间戳 */
  createdAt?: number;
  /** 是否只高亮（不改写） */
  highlightOnly?: boolean;
}

/**
 * Agent Intent（完整版，包含 ID）
 * 
 * 这是 Runtime 使用的最终类型
 */
export interface AgentIntent {
  /** 唯一标识（由 Runtime 生成） */
  id: string;
  /** 操作类型 */
  kind: AgentKind;
  /** 操作来源 */
  source: AgentSource;
  /** 语言设置 */
  locale?: 'en' | 'zh' | 'auto';
  /** 操作选项 */
  options?: AgentIntentOptions;
  /** 元数据 */
  metadata?: AgentIntentMetadata;
}

/**
 * Intent Body（不含 ID）
 * 
 * Intent Builder 返回此类型，由 Runtime 注入 ID
 */
export interface IntentWithoutId {
  /** 操作类型 */
  kind: AgentKind;
  /** 操作来源 */
  source: AgentSource;
  /** 语言设置 */
  locale?: 'en' | 'zh' | 'auto';
  /** 操作选项 */
  options?: AgentIntentOptions;
  /** 元数据 */
  metadata?: AgentIntentMetadata;
}

// ==========================================
// 类型守卫
// ==========================================

/**
 * 检查是否为 Section 级 Intent
 */
export function isSectionIntent(intent: AgentIntent | IntentWithoutId): boolean {
  return intent.source === 'section' && intent.kind.endsWith('_section');
}

/**
 * 检查是否为选区级 Intent
 */
export function isSelectionIntent(intent: AgentIntent | IntentWithoutId): boolean {
  return intent.source === 'selection';
}

/**
 * 检查是否为文档级 Intent
 */
export function isDocumentIntent(intent: AgentIntent | IntentWithoutId): boolean {
  return intent.source === 'document';
}

// ==========================================
// 工具函数
// ==========================================

/**
 * 生成 Intent ID（供 Runtime 使用）
 */
export function generateIntentId(): string {
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 将 IntentWithoutId 转换为完整的 AgentIntent
 */
export function assignIntentId(body: IntentWithoutId): AgentIntent {
  return {
    id: generateIntentId(),
    ...body,
  };
}

