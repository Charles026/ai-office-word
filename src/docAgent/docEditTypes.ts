/**
 * DocEdit 类型定义
 * 
 * 【设计思路 v3 - Primitive 重构】
 * 
 * 1. DocAgent Primitive（原子能力）
 *    - RewriteSection: 根据 LLM 输出重写 section 段落
 *    - HighlightKeyTerms: 在 section 中对词语应用 InlineMark 高亮
 *    - HighlightKeySentences: 在 section 中对句子应用高亮
 *    - AppendSummary: 在 section 末尾追加摘要
 * 
 * 2. DocEditIntent（高层业务意图）
 *    - 使用「一个主类型 + 多个能力开关」的结构化 schema
 *    - 由 Copilot/IntentRouter 产生
 * 
 * 3. DocEditPlan（可执行计划）
 *    - 由 Planner 根据 Intent 生成 primitive 组合
 *    - 每个 step 明确对应一个 primitive
 * 
 * 4. DocOps 输出
 *    - RewriteSection → replace_paragraph DocOps
 *    - HighlightKeyTerms → apply_inline_mark DocOps
 *    - 所有写操作必须通过 DocOps，禁止直接 Lexical 操作
 * 
 * 【重构历史】
 * - v1: 组合式 kind 枚举
 * - v2: 'section_edit' + 子对象开关
 * - v3: Primitive 抽象 + DocOps 统一
 */

import type { BehaviorContext } from '../interaction/behaviorSummaryV2';
import type { InlineMark } from '../document/inlineMark';

// Re-export for convenience
export type { BehaviorContext };

// ==========================================
// DocAgent Primitive - 原子能力定义
// ==========================================

/**
 * 高亮样式类型
 * 
 * - 'default': 由渲染层决定（通常是背景高亮）
 * - 'bold': 加粗显示
 * - 'underline': 下划线
 * - 'background': 背景高亮
 */
export type HighlightStyle = 'default' | 'bold' | 'underline' | 'background';

/**
 * DocAgent Primitive 枚举
 * 
 * 每个 primitive 代表一个可复用的原子能力，
 * 所有 DocEdit 命令都是这些 primitive 的组合。
 */
export enum DocAgentPrimitive {
  /** 重写 Section：根据 LLM 输出替换段落文本 */
  RewriteSection = 'RewriteSection',
  
  /** 
   * 通用高亮能力：对指定范围（词/句）应用高亮 
   * 替代 HighlightKeyTerms / HighlightKeySentences
   */
  HighlightSpans = 'HighlightSpans',

  /** @deprecated 使用 HighlightSpans */
  HighlightKeyTerms = 'HighlightKeyTerms',
  
  /** @deprecated 使用 HighlightSpans */
  HighlightKeySentences = 'HighlightKeySentences',
  
  /** 追加摘要：在 Section 末尾添加 bullet 摘要 */
  AppendSummary = 'AppendSummary',
}

/**
 * 高亮目标类型（与 Intent 层对齐）
 */
export type HighlightTarget = 'key_terms' | 'key_sentences' | 'risks' | 'metrics' | 'custom';

/**
 * HighlightSpans Primitive 输入
 */
export interface HighlightSpansInput {
  sectionId: string;
  target: HighlightTarget;
  style: HighlightStyle;
  /** 当 target='key_terms' 时必须提供 */
  terms?: TermHighlightTarget[];
  // sentences?: ... // 预留
}

/**
 * HighlightSpans Primitive 输出
 */
export interface HighlightSpansOutput {
  /** 成功创建的 InlineMark 列表 */
  marks: InlineMark[];
  /** 成功应用的 DocOps 数量 */
  appliedOpsCount: number;
  /** 未找到的目标 */
  notFoundTargets: string[];
}

/**
 * 词语高亮目标
 */
export interface TermHighlightTarget {
  /** 要高亮的短语（必须在 section 文本中存在） */
  phrase: string;
  /** 第几次出现（从 1 开始），默认 1 */
  occurrence?: number;
}

/**
 * HighlightKeyTerms Primitive 输入
 */
export interface HighlightKeyTermsInput {
  sectionId: string;
  /** 
   * 要高亮的词语列表
   * 必须由 CanonicalIntent LLM 提供，不做 fallback 
   */
  terms: TermHighlightTarget[];
  /** 高亮类型（语义分类） */
  markKind?: 'key_term' | 'important' | 'custom';
  /** 
   * 高亮样式（由 CanonicalIntent 根据用户意图决定）
   * 例如用户说「加粗」时为 'bold'
   */
  style?: HighlightStyle;
}

/**
 * HighlightKeyTerms Primitive 输出
 */
export interface HighlightKeyTermsOutput {
  /** 成功创建的 InlineMark 列表 */
  marks: InlineMark[];
  /** 成功应用的 DocOps 数量 */
  appliedOpsCount: number;
  /** 未找到的词语 */
  notFoundTerms: string[];
}

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
 * 
 * 对应 Primitive: RewriteSection
 * 输出: replace_paragraph DocOps
 */
export interface RewriteSectionStep {
  type: 'rewrite_section';
  /** 对应的 Primitive */
  primitive: DocAgentPrimitive.RewriteSection;
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
 * 
 * 对应 Primitive: HighlightKeySentences
 * 输出: apply_inline_mark DocOps（或 bold 格式 DocOps）
 */
export interface MarkKeySentencesStep {
  type: 'mark_key_sentences';
  /** 对应的 Primitive */
  primitive: DocAgentPrimitive.HighlightKeySentences;
  target: {
    sectionId: string;
  };
  options: {
    highlightCount: number;
    style?: HighlightStyle;
  };
}

/**
 * 标记关键词语/短语步骤
 * 
 * 对应 Primitive: HighlightKeyTerms
 * 输出: apply_inline_mark DocOps
 */
export interface MarkKeyTermsStep {
  type: 'mark_key_terms';
  /** 对应的 Primitive */
  primitive: DocAgentPrimitive.HighlightKeyTerms;
  target: {
    sectionId: string;
  };
  /** 
   * 来自 CanonicalIntent 的词语列表
   * 必须由 LLM 提供，不做 fallback
   */
  terms?: TermHighlightTarget[];
  options: {
    /** 高亮类型（语义分类） */
    markKind?: 'key_term' | 'important' | 'custom';
    /** 
     * 高亮样式（由 CanonicalIntent 根据用户意图决定）
     * 例如用户说「加粗」时为 'bold'
     */
    style?: HighlightStyle;
    /** 词语数量 */
    termCount?: number;
    /** 最大词语长度 */
    maxTermLength?: number;
  };
}

/**
 * 追加 Bullet 摘要步骤
 * 
 * 对应 Primitive: AppendSummary
 * 输出: insert_paragraph DocOps
 */
export interface AppendBulletSummaryStep {
  type: 'append_bullet_summary';
  /** 对应的 Primitive */
  primitive: DocAgentPrimitive.AppendSummary;
  target: {
    sectionId: string;
  };
  options: {
    bulletCount: number;
    style?: SummaryStyle;
  };
}

/**
 * 通用高亮步骤
 * 
 * 对应 Primitive: HighlightSpans
 * 替代 MarkKeyTermsStep / MarkKeySentencesStep
 */
export interface HighlightSpansStep {
  type: 'highlight_spans';
  primitive: DocAgentPrimitive.HighlightSpans;
  target: {
    sectionId: string;
  };
  options: {
    target: HighlightTarget;
    style: HighlightStyle;
    /** 当 target='key_terms' 时使用 */
    terms?: TermHighlightTarget[];
  };
}

/**
 * DocEdit Plan 步骤联合类型
 */
export type DocEditPlanStep =
  | RewriteSectionStep
  | MarkKeySentencesStep // @deprecated
  | MarkKeyTermsStep     // @deprecated
  | HighlightSpansStep   // 🆕 通用高亮步骤
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
