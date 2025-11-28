/**
 * Canonical Intent Types (v1)
 *
 * 【职责】
 * - 以结构化方式描述 Copilot 想要进行的文档操作
 * - 作为 LLM 输出与 DocOpsPlan 之间的桥梁
 *
 * 【约定】
 * - IntentScope 描述作用范围（选区 / 小节 / 整篇 / 大纲范围）
 * - IntentTask 描述要执行的任务（重写 / 总结 / 高亮等）
 * - CanonicalIntent 可被序列化为 JSON 并通过 schema 校验
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

export type IntentInteractionMode = 'apply_directly' | 'preview_then_apply' | 'ask_clarification';

export interface CanonicalIntent {
  intentId: string;
  scope: IntentScope;
  tasks: IntentTask[];
  preferences?: IntentPreferences;
  interactionMode?: IntentInteractionMode;
  meta?: {
    inferredFromBehavior?: string[];
    notes?: string;
  };
}


