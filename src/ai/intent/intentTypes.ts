/**
 * Canonical Intent Types (v2)
 *
 * 【职责】
 * - 以结构化方式描述 Copilot 想要进行的文档操作
 * - 作为 LLM 输出与 DocOpsPlan 之间的桥梁
 *
 * 【约定】
 * - IntentScope 描述作用范围（选区 / 小节 / 整篇 / 大纲范围）
 * - IntentTask 描述要执行的任务（重写 / 总结 / 高亮等）
 * - CanonicalIntent 可被序列化为 JSON 并通过 schema 校验
 *
 * 【v2 新增：处事原则与不确定性协议】
 * - confidence: LLM 对自身理解意图的信心度 (0~1)
 * - uncertainties: LLM 自己觉得不确定的部分
 * - responseMode: Copilot 希望采用的响应模式
 */

export type IntentScopeTarget = 'selection' | 'section' | 'document' | 'outline_range';

export interface IntentScopeSelection {
  startOffset: number;
  endOffset: number;
}

export interface IntentScopeOutlineRange {
  fromSectionId: string;
  toSectionId: string;
}

export interface IntentScope {
  target: IntentScopeTarget;
  sectionId?: string;
  selection?: IntentScopeSelection;
  outlineRange?: IntentScopeOutlineRange;
}

export type IntentTaskType =
  | 'rewrite'
  | 'translate'
  | 'summarize'
  | 'highlight_terms'
  | 'insert_block'
  | 'add_comment';

export interface IntentTaskBase<TType extends IntentTaskType = IntentTaskType, TParams = Record<string, unknown>> {
  type: TType;
  params: TParams;
}

export interface RewriteTaskParams {
  tone?: string;
  depth?: 'light' | 'medium' | 'deep';
  preserveStructure?: boolean;
  highlightMode?: 'sentences' | 'terms' | 'mixed';
  includeSummary?: boolean;
}

export interface TranslateTaskParams {
  targetLanguage: string;
  style?: 'formal' | 'casual' | 'neutral';
}

export interface SummarizeTaskParams {
  style?: 'bullet' | 'short' | 'long';
  maxParagraphs?: number;
}

export interface HighlightTermsTaskParams {
  maxTerms?: number;
  mode?: 'sentences' | 'terms' | 'mixed';
}

export interface InsertBlockTaskParams {
  blockType: 'paragraph' | 'bullet_list' | 'quote';
  referenceSectionId?: string;
  content?: string;
}

export interface AddCommentTaskParams {
  comment: string;
  referenceSectionId?: string;
}

export type RewriteIntentTask = IntentTaskBase<'rewrite', RewriteTaskParams>;
export type TranslateIntentTask = IntentTaskBase<'translate', TranslateTaskParams>;
export type SummarizeIntentTask = IntentTaskBase<'summarize', SummarizeTaskParams>;
export type HighlightTermsIntentTask = IntentTaskBase<'highlight_terms', HighlightTermsTaskParams>;
export type InsertBlockIntentTask = IntentTaskBase<'insert_block', InsertBlockTaskParams>;
export type AddCommentIntentTask = IntentTaskBase<'add_comment', AddCommentTaskParams>;

export type IntentTask =
  | RewriteIntentTask
  | TranslateIntentTask
  | SummarizeIntentTask
  | HighlightTermsIntentTask
  | InsertBlockIntentTask
  | AddCommentIntentTask;

export interface IntentPreferences {
  preserveFormatting?: boolean;
  preserveStructure?: boolean;
  insertMode?: 'in_place' | 'append_after' | 'insert_comment';
  useUserHighlightHabit?: boolean;
}

/**
 * @deprecated 使用 CopilotResponseMode 替代
 */
export type IntentInteractionMode = 'apply_directly' | 'preview_then_apply' | 'ask_clarification';

// ==========================================
// v2 新增：响应模式与不确定性类型
// ==========================================

/**
 * Copilot 响应模式
 *
 * - auto_apply: 直接应用到文档
 * - preview: 在侧边栏预览 / diff，由用户确认
 * - clarify: 暂不改文档，只向用户发一条澄清问题
 */
export type CopilotResponseMode = 'auto_apply' | 'preview' | 'clarify';

/**
 * 意图不确定性描述
 *
 * LLM 用于标记自己不确定的部分，便于 UI 呈现澄清问题
 */
export interface IntentUncertainty {
  /**
   * 哪个字段存在不确定性（例如 'tasks[0].params.length'）
   */
  field: string;
  /**
   * LLM 自己对不确定原因的描述，便于调试
   * 例如："用户只说'精简一点'，没指明长度"
   */
  reason: string;
  /**
   * LLM 认为合理的几种候选方案
   * 例如：['short', 'medium']
   * UI 可以用来提供按钮
   */
  candidateOptions?: string[];
}

// ==========================================
// CanonicalIntent v2
// ==========================================

export interface CanonicalIntent {
  intentId: string;
  scope: IntentScope;
  tasks: IntentTask[];
  preferences?: IntentPreferences;
  /**
   * @deprecated 使用 responseMode 替代
   */
  interactionMode?: IntentInteractionMode;
  /**
   * LLM 对自身理解本意图的信心，0~1 之间。
   * 趋近 1 表示非常确信（几乎不需要澄清），
   * 接近 0.5 或以下时，结合 uncertainties 决定是否澄清或仅预览。
   */
  confidence?: number;
  /**
   * 记录哪些地方 LLM 自己觉得"不完全确定"。
   */
  uncertainties?: IntentUncertainty[];
  /**
   * Copilot 希望采用的响应模式：
   * - auto_apply: 直接写回文档
   * - preview: 给出预览 / diff，让用户确认
   * - clarify: 暂不改文档，而是向用户提出一个非常窄的问题进行澄清
   */
  responseMode?: CopilotResponseMode;
  meta?: {
    /** 从用户行为摘要中推断出的偏好 */
    inferredFromBehavior?: string[];
    /** 其他备注 */
    notes?: string;
  };
}


