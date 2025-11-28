/**
 * DocOps Plan Schema (v1)
 *
 * - 对 LLM 生成的 DocOpsPlan 进行结构校验
 * - 提供 parse + validate，确保写回前清洗数据
 */

import { z } from 'zod';
import {
  DocOp,
  DocOpsPlan,
  DocOpsPlanValidationResult,
  ReplaceRangePayload,
} from './docOpsTypes';

export class DocOpsParseError extends Error {
  constructor(message: string, public readonly cause?: unknown, public readonly raw?: unknown) {
    super(message);
    this.name = 'DocOpsParseError';
  }
}

const docOpScopeObject = z.object({
  sectionId: z.string().min(1).optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
});

const paragraphPatchSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
});

const replaceRangePayloadSchema = z.object({
  paragraphs: z.array(paragraphPatchSchema).min(1),
}) as z.ZodType<ReplaceRangePayload>;

const applyMarkPayloadSchema = z.object({
  markType: z.enum(['highlight', 'bold', 'italic']),
});

const insertAfterSectionPayloadSchema = z.object({
  content: z.string().min(1),
});

const insertParagraphAfterPayloadSchema = z.object({
  referenceParagraphIndex: z.number().int().nonnegative().optional(),
  text: z.string(),
});

const addCommentPayloadSchema = z.object({
  comment: z.string().min(1),
});

const docOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replace_range'),
    scope: docOpScopeObject.extend({
      sectionId: z.string().min(1),
    }),
    payload: replaceRangePayloadSchema,
  }),
  z.object({
    type: z.literal('apply_mark'),
    scope: docOpScopeObject.extend({
      sectionId: z.string().min(1),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
    }),
    payload: applyMarkPayloadSchema,
  }),
  z.object({
    type: z.literal('insert_after_section'),
    scope: docOpScopeObject.extend({
      sectionId: z.string().min(1),
    }),
    payload: insertAfterSectionPayloadSchema,
  }),
  z.object({
    type: z.literal('insert_paragraph_after'),
    scope: docOpScopeObject.extend({
      sectionId: z.string().min(1),
    }),
    payload: insertParagraphAfterPayloadSchema,
  }),
  z.object({
    type: z.literal('add_comment'),
    scope: docOpScopeObject.extend({
      sectionId: z.string().min(1),
    }),
    payload: addCommentPayloadSchema,
  }),
]) as unknown as z.ZodType<DocOp>;

const docOpsPlanSchema = z.object({
  version: z.string().min(1),
  intentId: z.string().min(1),
  ops: z.array(docOpSchema).min(1),
}) as z.ZodType<DocOpsPlan>;

export function parseDocOpsPlan(json: unknown): DocOpsPlan {
  try {
    return docOpsPlanSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new DocOpsParseError('Failed to parse DocOpsPlan', error.flatten(), json);
    }
    throw new DocOpsParseError('Failed to parse DocOpsPlan', error, json);
  }
}

export function validateDocOpsPlan(plan: DocOpsPlan): DocOpsPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan.version) {
    errors.push('Missing plan.version');
  }

  if (!plan.intentId) {
    errors.push('Missing plan.intentId');
  }

  if (!plan.ops || plan.ops.length === 0) {
    errors.push('DocOps plan must include at least one op');
  }

  for (const [index, op] of (plan.ops || []).entries()) {
    if (op.type === 'replace_range') {
      if (!op.scope.sectionId) {
        errors.push(`op[${index}]: replace_range must specify scope.sectionId`);
      }
      if (!('paragraphs' in op.payload) || !(op.payload as ReplaceRangePayload).paragraphs?.length) {
        errors.push(`op[${index}]: replace_range payload must include paragraphs`);
      }
    }
    if (op.type === 'apply_mark') {
      if (
        op.scope.startOffset === undefined ||
        op.scope.endOffset === undefined ||
        op.scope.endOffset < op.scope.startOffset!
      ) {
        errors.push(`op[${index}]: apply_mark must include valid start/end offsets`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export { docOpsPlanSchema };


