/**
 * Canonical Intent Schema (v2)
 *
 * - 使用 zod 对 CanonicalIntent 进行严格校验
 * - 暴露 parseCanonicalIntent，供 Section AI / Runtime 使用
 *
 * 【v2 新增】
 * - confidence: 0~1 之间的信心度
 * - uncertainties: 不确定性列表
 * - responseMode: auto_apply / preview / clarify
 */

import { z } from 'zod';
import {
  CanonicalIntent,
  IntentScope,
  IntentScopeOutlineRange,
  IntentScopeSelection,
  IntentTask,
  IntentUncertainty,
  CopilotResponseMode,
} from './intentTypes';

export class IntentParseError extends Error {
  constructor(message: string, public readonly cause?: unknown, public readonly raw?: unknown) {
    super(message);
    this.name = 'IntentParseError';
  }
}

const scopeSelectionSchema: z.ZodType<IntentScopeSelection> = z.object({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
}).passthrough().refine(data => data.endOffset >= data.startOffset, {
  message: 'endOffset must be greater than or equal to startOffset',
});

const scopeOutlineRangeSchema: z.ZodType<IntentScopeOutlineRange> = z.object({
  fromSectionId: z.string().min(1),
  toSectionId: z.string().min(1),
}).passthrough();

const intentScopeSchema: z.ZodType<IntentScope> = z.object({
  target: z.enum(['selection', 'section', 'document', 'outline_range']).optional(), // 允许 target 为空
  sectionId: z.string().min(1).optional(),
  selection: scopeSelectionSchema.optional(),
  outlineRange: scopeOutlineRangeSchema.optional(),
}).passthrough() // 允许 LLM 返回额外字段
.transform(scope => {
  // 容错逻辑：如果没有 target，根据其他字段推断
  if (!scope.target) {
    if (scope.sectionId) {
      return { ...scope, target: 'section' as const };
    }
    if (scope.selection) {
      return { ...scope, target: 'selection' as const };
    }
    if (scope.outlineRange) {
      return { ...scope, target: 'outline_range' as const };
    }
    // 兜底：如果没有足够信息，默认 'document'（风险较低）
    return { ...scope, target: 'document' as const };
  }
  return scope;
})
.refine(scope => {
  if (scope.target === 'selection') {
    return !!scope.selection;
  }
  if (scope.target === 'section') {
    return !!scope.sectionId;
  }
  if (scope.target === 'outline_range') {
    return !!scope.outlineRange;
  }
  return true;
}, {
  message: 'scope is missing required detail for the specified target',
}) as z.ZodType<IntentScope>;

const rewriteTaskSchema = z.object({
  type: z.literal('rewrite'),
  params: z.object({
    tone: z.string().optional(),
    depth: z.enum(['light', 'medium', 'deep']).optional(),
    preserveStructure: z.boolean().optional(),
    highlightMode: z.enum(['sentences', 'terms', 'mixed']).optional(),
    includeSummary: z.boolean().optional(),
  }).passthrough().default({}), // 允许 LLM 返回额外字段
}).passthrough(); // 允许 task 顶层有额外字段

const translateTaskSchema = z.object({
  type: z.literal('translate'),
  params: z.object({
    targetLanguage: z.string().min(2),
    style: z.enum(['formal', 'casual', 'neutral']).optional(),
  }).passthrough(),
}).passthrough();

const summarizeTaskSchema = z.object({
  type: z.literal('summarize'),
  params: z.object({
    style: z.enum(['bullet', 'short', 'long']).optional(),
    maxParagraphs: z.number().int().positive().optional(),
  }).passthrough().default({}),
}).passthrough();

const highlightTermsTaskSchema = z.object({
  type: z.literal('highlight_terms'),
  params: z.object({
    maxTerms: z.number().int().positive().optional(),
    mode: z.enum(['sentences', 'terms', 'mixed']).optional(),
  }).passthrough().default({}),
}).passthrough();

/**
 * mark_key_terms 任务 schema
 * 
 * 用于 InlineMark 流程的词语级标注
 * 
 * 【设计原则】
 * - LLM 必须提供 terms 列表
 * - style 由 LLM 根据用户意图决定（如「加粗」→ 'bold'）
 */
const markKeyTermsTaskSchema = z.object({
  type: z.literal('mark_key_terms'),
  params: z.object({
    sectionId: z.string().min(1).optional(),
    targets: z.array(
      z.object({
        sectionId: z.string().min(1).optional(),
        phrase: z.string().min(1),
        occurrence: z.number().int().positive().optional(),
      }).passthrough()
    ).optional(),
    terms: z.array(
      z.object({
        phrase: z.string().min(1),
        occurrence: z.number().int().positive().optional(),
      }).passthrough()
    ).optional(),
    maxTerms: z.number().int().positive().optional(),
    // 高亮样式（由 LLM 根据用户意图决定）
    style: z.enum(['default', 'bold', 'underline', 'background']).optional(),
  }).passthrough().default({}),
}).passthrough();

/**
 * mark_key_sentences 任务 schema
 * 
 * 用于句子级高亮
 */
const markKeySentencesTaskSchema = z.object({
  type: z.literal('mark_key_sentences'),
  params: z.object({
    sectionId: z.string().min(1).optional(),
    sentenceIndexes: z.array(z.number().int().nonnegative()).optional(),
    sentences: z.array(
      z.object({
        text: z.string().min(1),
        paragraphIndex: z.number().int().nonnegative().optional(),
      }).passthrough()
    ).optional(),
    maxSentences: z.number().int().positive().optional(),
  }).passthrough().default({}),
}).passthrough();

/**
 * mark_key_paragraphs 任务 schema
 * 
 * 用于段落级高亮（预留）
 */
const markKeyParagraphsTaskSchema = z.object({
  type: z.literal('mark_key_paragraphs'),
  params: z.object({
    sectionId: z.string().min(1).optional(),
    paragraphIndexes: z.array(z.number().int().nonnegative()).optional(),
    maxParagraphs: z.number().int().positive().optional(),
  }).passthrough().default({}),
}).passthrough();

/**
 * highlight_spans 任务 schema
 * 
 * 🆕 通用高亮任务，替代 mark_key_terms / mark_key_sentences
 * Runtime 会将旧格式 normalize 为此格式
 */
const highlightSpansTaskSchema = z.object({
  type: z.literal('highlight_spans'),
  params: z.object({
    sectionId: z.string().min(1).optional(),
    target: z.enum(['key_terms', 'key_sentences', 'risks', 'metrics', 'custom']),
    style: z.enum(['default', 'bold', 'underline', 'background']).optional(),
    terms: z.array(
      z.object({
        phrase: z.string().min(1),
        occurrence: z.number().int().positive().optional(),
      }).passthrough()
    ).optional(),
    sentences: z.array(
      z.object({
        text: z.string().min(1),
        paragraphIndex: z.number().int().nonnegative().optional(),
      }).passthrough()
    ).optional(),
  }).passthrough(),
}).passthrough();

const insertBlockTaskSchema = z.object({
  type: z.literal('insert_block'),
  params: z.object({
    blockType: z.enum(['paragraph', 'bullet_list', 'quote']),
    referenceSectionId: z.string().min(1).optional(),
    content: z.string().optional(),
  }).passthrough(),
}).passthrough();

const addCommentTaskSchema = z.object({
  type: z.literal('add_comment'),
  params: z.object({
    comment: z.string().min(1),
    referenceSectionId: z.string().min(1).optional(),
  }).passthrough(),
}).passthrough();

const intentTaskSchema = z.discriminatedUnion('type', [
  rewriteTaskSchema,
  translateTaskSchema,
  summarizeTaskSchema,
  highlightTermsTaskSchema,
  markKeyTermsTaskSchema,
  markKeySentencesTaskSchema,
  markKeyParagraphsTaskSchema,
  highlightSpansTaskSchema,  // 🆕 通用高亮任务
  insertBlockTaskSchema,
  addCommentTaskSchema,
]) as z.ZodType<IntentTask>;

const intentPreferencesSchema = z.object({
  preserveFormatting: z.boolean().optional(),
  preserveStructure: z.boolean().optional(),
  insertMode: z.enum(['in_place', 'append_after', 'insert_comment']).optional(),
  useUserHighlightHabit: z.boolean().optional(),
}).passthrough(); // 允许 LLM 返回额外字段

// ==========================================
// v2 新增：不确定性和响应模式 schema
// ==========================================

/**
 * 不确定性描述 schema
 */
const intentUncertaintySchema: z.ZodType<IntentUncertainty> = z.object({
  field: z.string().min(1),
  reason: z.string().min(1),
  candidateOptions: z.array(z.string()).optional(),
}).passthrough(); // 允许额外字段

/**
 * 响应模式 schema
 */
const copilotResponseModeSchema: z.ZodType<CopilotResponseMode> = z.enum([
  'auto_apply',
  'preview',
  'clarify',
]);

const canonicalIntentSchema = z.object({
  intentId: z.string().min(1),
  scope: intentScopeSchema,
  tasks: z.array(intentTaskSchema).min(1),
  preferences: intentPreferencesSchema.optional(),
  // 向后兼容：保留旧字段
  interactionMode: z.enum(['apply_directly', 'preview_then_apply', 'ask_clarification']).optional(),
  // v2 新增字段
  confidence: z.number().min(0).max(1).optional(),
  uncertainties: z.array(intentUncertaintySchema).optional(),
  responseMode: copilotResponseModeSchema.optional(),
  meta: z.object({
    inferredFromBehavior: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }).passthrough().optional(),
}).passthrough() // 允许 LLM 返回额外字段
.transform(value => ({
  ...value,
  // 向后兼容：旧字段默认值
  interactionMode: value.interactionMode ?? 'apply_directly',
  // v2 默认值：如果没有指定 responseMode，根据 confidence 推断
  responseMode: value.responseMode ?? (
    value.confidence !== undefined && value.confidence < 0.5 ? 'preview' : 'auto_apply'
  ),
})) as z.ZodType<CanonicalIntent>;

export function parseCanonicalIntent(json: unknown): CanonicalIntent {
  try {
    return canonicalIntentSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new IntentParseError('Failed to parse CanonicalIntent', error.flatten(), json);
    }
    throw new IntentParseError('Failed to parse CanonicalIntent', error, json);
  }
}

export {
  canonicalIntentSchema,
  intentUncertaintySchema,
  copilotResponseModeSchema,
};


