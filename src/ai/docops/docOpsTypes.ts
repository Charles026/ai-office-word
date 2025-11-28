/**
 * DocOps Plan Types (v1)
 *
 * 【职责】
 * - 描述 LLM 规划出的文档操作序列
 * - 作为 DocOps 引擎执行的输入
 */

export type DocOpType =
  | 'replace_range'
  | 'apply_mark'
  | 'insert_after_section'
  | 'insert_paragraph_after'
  | 'add_comment';

export interface DocOpScope {
  sectionId?: string;
  startOffset?: number;
  endOffset?: number;
}

export interface ParagraphPatch {
  index: number;
  text: string;
}

export interface DocOpBase<TType extends DocOpType = DocOpType, TPayload = Record<string, unknown>> {
  type: TType;
  scope: DocOpScope;
  payload: TPayload;
}

export interface ReplaceRangePayload {
  paragraphs: ParagraphPatch[];
}

export interface ApplyMarkPayload {
  markType: 'highlight' | 'bold' | 'italic';
}

export interface InsertAfterSectionPayload {
  content: string;
}

export interface InsertParagraphAfterPayload {
  referenceParagraphIndex?: number;
  text: string;
}

export interface AddCommentPayload {
  comment: string;
}

export type ReplaceRangeDocOp = DocOpBase<'replace_range', ReplaceRangePayload>;
export type ApplyMarkDocOp = DocOpBase<'apply_mark', ApplyMarkPayload>;
export type InsertAfterSectionDocOp = DocOpBase<'insert_after_section', InsertAfterSectionPayload>;
export type InsertParagraphAfterDocOp = DocOpBase<'insert_paragraph_after', InsertParagraphAfterPayload>;
export type AddCommentDocOp = DocOpBase<'add_comment', AddCommentPayload>;

export type DocOp =
  | ReplaceRangeDocOp
  | ApplyMarkDocOp
  | InsertAfterSectionDocOp
  | InsertParagraphAfterDocOp
  | AddCommentDocOp;

export interface DocOpsPlan {
  version: string;
  intentId: string;
  ops: DocOp[];
}

export interface DocOpsPlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}


