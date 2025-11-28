/**
 * DocEdit 类型定义
 * 
 * 【设计思路 v2】
 * 
 * 1. DocEditIntent（高层业务意图）
 *    - 使用「一个主类型 + 多个能力开关」的结构化 schema
 *    - 不再为每个组合定义独立 kind
 *    - 由 Copilot/IntentRouter 产生
 * 
 * 2. DocEditPlan（可执行计划）
 *    - 由 Planner 根据 Intent 的开关组合生成
 *    - 包含有序的步骤列表，每步可映射到 DocOps
 * 
 * 3. DocEditPlanStep（原子操作步骤）
 *    - 每一种 type 对应一类可映射到 DocOps 的原子操作
 *    - rewrite_section / mark_key_sentences / mark_key_terms / append_bullet_summary
 * 
 * 【重构说明】
 * - v1 使用组合式 kind 枚举（如 'rewrite_section_with_highlight_and_summary'）
 * - v2 改用 'section_edit' + rewrite/highlight/summary 子对象开关
 * - 旧的 kind 值保留用于向后兼容（标记为 @deprecated）
 * - v2.1 增加 BehaviorContext 支持（只包含事实数据，不做偏好推断）
 */

import type { BehaviorContext } from '../interaction/behaviorSummaryV2';

// Re-export for convenience
export type { BehaviorContext };

// ==========================================
// Intent Kind 枚举（v2 新版）
// ==========================================

/**
 * DocEdit 意图主类型（v2）
 * 
 * 新版设计：使用少数大类 + 多个能力开关
 * - 'section_edit': 章节编辑类意图（改写/高亮/摘要等组合）
 * - 'section_analysis': 章节分析类意图（未来扩展）
 * - 'document_edit': 文档级编辑意图（未来扩展）
 * - 'custom': 自定义复杂操作
 */
export type DocEditIntentKind =
  // v2 新枚举
  | 'section_edit'
  | 'section_analysis'
  | 'document_edit'
  | 'custom'
  // v1 旧枚举（@deprecated，保留用于向后兼容）
  | 'rewrite_section_with_highlight_and_summary'
  | 'rewrite_section_plain'
  | 'summarize_section_plain';

/**
 * 检查是否为旧版 kind（用于兼容层）
 */
export function isLegacyIntentKind(kind: DocEditIntentKind): boolean {
  return [
    'rewrite_section_with_highlight_and_summary',
    'rewrite_section_plain',
    'summarize_section_plain',
  ].includes(kind);
}

// ==========================================
// 通用选项类型
// ==========================================

/**
 * 语气类型
 */
export type ToneType = 'default' | 'formal' | 'casual' | 'neutral' | 'polished';

/**
 * 长度控制类型
 */
export type LengthType = 'shorter' | 'same' | 'longer' | 'keep'; // 'keep' = 'same'（向后兼容）

/**
 * 高亮样式类型
 */
export type HighlightStyle = 'bold' | 'marker';

/**
 * 摘要样式类型
 */
export type SummaryStyle = 'bullet' | 'paragraph';

// ==========================================
// Intent 子对象类型（v2 新版）
// ==========================================

/**
 * 改写配置
 */
export interface RewriteConfig {
  /** 是否启用改写（默认 true） */
  enabled: boolean;
  /** 语气 */
  tone?: ToneType;
  /** 长度控制 */
  length?: LengthType;
  /** 是否保持段落结构 */
  keepStructure?: boolean;
}

/**
 * 高亮模式
 */
export type HighlightMode = 'sentences' | 'terms' | 'mixed';

/**
 * 高亮配置
 */
export interface HighlightConfig {
  /** 是否启用高亮关键句 */
  enabled: boolean;
  /** 高亮模式：sentences(句子)、terms(词语)、mixed(混合) */
  mode?: HighlightMode;
  /** 要标记的关键句数量（默认 3） */
  highlightCount?: number;
  /** 要标记的关键词语数量（默认 5，仅 mode='terms' 或 'mixed' 时有效） */
  termCount?: number;
  /** 高亮样式（未来扩展，默认 bold） */
  style?: HighlightStyle;
}

/**
 * 摘要配置
 */
export interface SummaryConfig {
  /** 是否启用摘要 */
  enabled: boolean;
  /** bullet 数量（默认 3） */
  bulletCount?: number;
  /** 摘要样式（未来扩展，默认 bullet） */
  style?: SummaryStyle;
}

// ==========================================
// DocEditIntent - 高层业务意图（v2 新版）
// ==========================================

/**
 * DocEdit 意图目标
 */
export interface DocEditTarget {
  /** 文档 ID */
  docId: string;
  /** 章节 ID */
  sectionId: string;
}

/**
 * DocEdit 意图（v2）
 * 
 * 新版设计：使用子对象开关代替组合式 kind
 * 
 * @example
 * ```ts
 * // 纯改写
 * const intent: DocEditIntent = {
 *   kind: 'section_edit',
 *   target: { docId: 'doc-1', sectionId: 'sec-7' },
 *   rewrite: { enabled: true, tone: 'formal' },
 * };
 * 
 * // 改写 + 高亮
 * const intent: DocEditIntent = {
 *   kind: 'section_edit',
 *   target: { docId: 'doc-1', sectionId: 'sec-7' },
 *   rewrite: { enabled: true, tone: 'formal' },
 *   highlight: { enabled: true, highlightCount: 3 },
 * };
 * 
 * // 改写 + 高亮 + 摘要
 * const intent: DocEditIntent = {
 *   kind: 'section_edit',
 *   target: { docId: 'doc-1', sectionId: 'sec-7' },
 *   rewrite: { enabled: true, tone: 'formal' },
 *   highlight: { enabled: true, highlightCount: 3 },
 *   summary: { enabled: true, bulletCount: 3 },
 * };
 * ```
 */
export interface DocEditIntent {
  /** 意图主类型 */
  kind: DocEditIntentKind;
  
  /** 操作目标 */
  target: DocEditTarget;
  
  /** 改写配置 */
  rewrite?: RewriteConfig;
  
  /** 高亮配置 */
  highlight?: HighlightConfig;
  
  /** 摘要配置 */
  summary?: SummaryConfig;
  
  /** 额外参数（预留扩展） */
  extra?: Record<string, unknown>;
  
  /** 
   * 用户行为上下文（v2.1）
   * 由 BehaviorSummaryV2 生成，只包含事实数据
   * 不做偏好推断，让 LLM 自己判断
   */
  behavior?: BehaviorContext;
  
  // ==========================================
  // @deprecated 旧版字段（保留用于向后兼容）
  // ==========================================
  
  /**
   * @deprecated 使用 rewrite.tone 和 rewrite.length 代替
   */
  semantic?: {
    tone: ToneType;
    length: LengthType;
  };
  
  /**
   * @deprecated 使用 highlight.enabled 和 highlight.highlightCount 代替
   */
  formatting?: {
    highlightKeySentences: boolean;
    highlightCount?: number;
  };
}

// ==========================================
// 归一化后的 Intent（内部使用）
// ==========================================

/**
 * 归一化后的长度类型（不含 'keep'）
 */
export type NormalizedLengthType = 'shorter' | 'same' | 'longer';

/**
 * 归一化后的改写配置
 */
export interface NormalizedRewriteConfig {
  enabled: boolean;
  tone: ToneType;
  length: NormalizedLengthType;
  keepStructure: boolean;
}

/**
 * 归一化后的 Intent
 * 
 * 所有字段都有确定的值，由 normalizeDocEditIntent 生成
 */
export interface NormalizedDocEditIntent {
  kind: 'section_edit';
  target: DocEditTarget;
  rewrite: NormalizedRewriteConfig;
  highlight: Required<HighlightConfig>;
  summary: Required<SummaryConfig>;
}

// ==========================================
// PlanStep 类型 - 原子操作步骤（保持不变）
// ==========================================

/**
 * 改写小节步骤
 */
export interface RewriteSectionStep {
  type: 'rewrite_section';
  target: {
    sectionId: string;
  };
  options: {
    tone: ToneType;
    length: LengthType;
    keepStructure: boolean;
  };
}

/**
 * 标记关键句步骤
 */
export interface MarkKeySentencesStep {
  type: 'mark_key_sentences';
  target: {
    sectionId: string;
  };
  options: {
    highlightCount: number;
    style?: HighlightStyle;
  };
}

/**
 * 🆕 标记关键词语/短语步骤
 */
export interface MarkKeyTermsStep {
  type: 'mark_key_terms';
  target: {
    sectionId: string;
  };
  options: {
    /** 要标记的词语数量 */
    termCount: number;
    /** 每个词语的最大长度（字符数） */
    maxTermLength?: number;
    style?: HighlightStyle;
  };
}

/**
 * 追加 Bullet 摘要步骤
 */
export interface AppendBulletSummaryStep {
  type: 'append_bullet_summary';
  target: {
    sectionId: string;
  };
  options: {
    bulletCount: number;
    style?: SummaryStyle;
  };
}

/**
 * DocEdit Plan 步骤联合类型
 */
export type DocEditPlanStep =
  | RewriteSectionStep
  | MarkKeySentencesStep
  | MarkKeyTermsStep
  | AppendBulletSummaryStep;

// ==========================================
// DocEditPlan - 可执行计划（保持兼容）
// ==========================================

/**
 * Plan 来源
 */
export type PlanSource = 'copilot' | 'outline' | 'editor';

/**
 * DocEdit 计划
 */
export interface DocEditPlan {
  /** 计划 ID */
  intentId: string;
  
  /** 
   * 意图类型
   * 新版统一为 'section_edit'，旧版保留原值
   */
  intentKind: DocEditIntentKind;
  
  /** 文档 ID */
  docId: string;
  
  /** 章节 ID */
  sectionId: string;
  
  /** 执行步骤序列（顺序重要） */
  steps: DocEditPlanStep[];
  
  /** 元信息 */
  meta?: {
    createdAt?: number;
    source?: PlanSource;
    /** 能力开关摘要（调试用） */
    enabledFeatures?: {
      rewrite: boolean;
      highlight: boolean;
      summary: boolean;
    };
  };
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 生成 Intent ID
 */
export function generateIntentId(): string {
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 检查 Plan 是否有效
 */
export function isValidPlan(plan: DocEditPlan): boolean {
  return !!(
    plan.intentId &&
    plan.intentKind &&
    plan.docId &&
    plan.sectionId &&
    Array.isArray(plan.steps) &&
    plan.steps.length > 0
  );
}

/**
 * 获取 Plan 步骤类型列表
 */
export function getPlanStepTypes(plan: DocEditPlan): string[] {
  return plan.steps.map(step => step.type);
}

// ==========================================
// Intent 创建辅助函数
// ==========================================

/**
 * 创建一个 section_edit 类型的 Intent
 * 
 * @param target - 目标（docId + sectionId）
 * @param options - 能力开关选项
 */
export function createSectionEditIntent(
  target: DocEditTarget,
  options: {
    rewrite?: Partial<RewriteConfig>;
    highlight?: Partial<HighlightConfig>;
    summary?: Partial<SummaryConfig>;
  } = {}
): DocEditIntent {
  return {
    kind: 'section_edit',
    target,
    rewrite: options.rewrite ? { enabled: true, ...options.rewrite } : undefined,
    highlight: options.highlight ? { enabled: true, ...options.highlight } : undefined,
    summary: options.summary ? { enabled: true, ...options.summary } : undefined,
  };
}

/**
 * 默认值常量
 */
export const INTENT_DEFAULTS = {
  rewrite: {
    enabled: true,
    tone: 'default' as ToneType,
    length: 'same' as LengthType,
    keepStructure: true,
  },
  highlight: {
    enabled: false,
    mode: 'sentences' as HighlightMode,
    highlightCount: 3,
    termCount: 5,
    style: 'bold' as HighlightStyle,
  },
  summary: {
    enabled: false,
    bulletCount: 3,
    style: 'bullet' as SummaryStyle,
  },
};
