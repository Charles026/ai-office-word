/**
 * Canonical Intent Schema (v1)
 *
 * - 使用 zod 对 CanonicalIntent 进行严格校验
 * - 暴露 parseCanonicalIntent，供 Section AI / Runtime 使用
 */

import { z } from 'zod';
import {
  CanonicalIntent,
  IntentScope,
  IntentScopeOutlineRange,
  IntentScopeSelection,
  IntentTask,
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
}).refine(data => data.endOffset >= data.startOffset, {
  message: 'endOffset must be greater than or equal to startOffset',
});

const scopeOutlineRangeSchema: z.ZodType<IntentScopeOutlineRange> = z.object({
  fromSectionId: z.string().min(1),
  toSectionId: z.string().min(1),
});

const intentScopeSchema: z.ZodType<IntentScope> = z.object({
  target: z.enum(['selection', 'section', 'document', 'outline_range']) as z.ZodType<IntentScope['target']>,
  sectionId: z.string().min(1).optional(),
  selection: scopeSelectionSchema.optional(),
  outlineRange: scopeOutlineRangeSchema.optional(),
}).refine(scope => {
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
});

const rewriteTaskSchema = z.object({
  type: z.literal('rewrite'),
  params: z.object({
    tone: z.string().optional(),
    depth: z.enum(['light', 'medium', 'deep']).optional(),
    preserveStructure: z.boolean().optional(),
    highlightMode: z.enum(['sentences', 'terms', 'mixed']).optional(),
    includeSummary: z.boolean().optional(),
  }).default({}),
});

const translateTaskSchema = z.object({
  type: z.literal('translate'),
  params: z.object({
    targetLanguage: z.string().min(2),
    style: z.enum(['formal', 'casual', 'neutral']).optional(),
  }),
});

const summarizeTaskSchema = z.object({
  type: z.literal('summarize'),
  params: z.object({
    style: z.enum(['bullet', 'short', 'long']).optional(),
    maxParagraphs: z.number().int().positive().optional(),
  }).default({}),
});

const highlightTermsTaskSchema = z.object({
  type: z.literal('highlight_terms'),
  params: z.object({
    maxTerms: z.number().int().positive().optional(),
    mode: z.enum(['sentences', 'terms', 'mixed']).optional(),
  }).default({}),
});

const insertBlockTaskSchema = z.object({
  type: z.literal('insert_block'),
  params: z.object({
    blockType: z.enum(['paragraph', 'bullet_list', 'quote']),
    referenceSectionId: z.string().min(1).optional(),
    content: z.string().optional(),
  }),
});

const addCommentTaskSchema = z.object({
  type: z.literal('add_comment'),
  params: z.object({
    comment: z.string().min(1),
    referenceSectionId: z.string().min(1).optional(),
  }),
});

const intentTaskSchema = z.discriminatedUnion('type', [
  rewriteTaskSchema,
  translateTaskSchema,
  summarizeTaskSchema,
  highlightTermsTaskSchema,
  insertBlockTaskSchema,
  addCommentTaskSchema,
]) as z.ZodType<IntentTask>;

const intentPreferencesSchema = z.object({
  preserveFormatting: z.boolean().optional(),
  preserveStructure: z.boolean().optional(),
  insertMode: z.enum(['in_place', 'append_after', 'insert_comment']).optional(),
  useUserHighlightHabit: z.boolean().optional(),
});

const canonicalIntentSchema = z.object({
  intentId: z.string().min(1),
  scope: intentScopeSchema,
  tasks: z.array(intentTaskSchema).min(1),
  preferences: intentPreferencesSchema.optional(),
  interactionMode: z.enum(['apply_directly', 'preview_then_apply', 'ask_clarification']).optional(),
  meta: z.object({
    inferredFromBehavior: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }).optional(),
}).transform(value => ({
  ...value,
  interactionMode: value.interactionMode ?? 'apply_directly',
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

export { canonicalIntentSchema };


