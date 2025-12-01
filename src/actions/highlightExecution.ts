/**
 * Highlight Execution - 高亮任务执行模块
 * 
 * 【职责】
 * - 执行 mark_key_terms / mark_key_sentences / mark_key_paragraphs 任务
 * - 将 CanonicalIntent 中的高亮任务转换为 InlineMark 并应用到文档
 * 
 * 【设计原则】
 * - 高亮任务通过 InlineMark / TextAnchor 实现，不修改文本内容
 * - 所有写操作通过 DocOps 通道
 * - 多种高亮粒度可以共存
 * 
 * @version 1.0.0
 */

import type { LexicalEditor } from 'lexical';
import type { IntentTask } from '../ai/intent/intentTypes';
import {
  createInlineMarkFromPhrase,
  createInlineMark,
  createTextAnchor,
  getSectionTextFromEditor,
  type InlineMark,
} from '../document/inlineMark';
import type { ApplyInlineMarkOp } from '../docops/types';

// ==========================================
// 类型定义
// ==========================================

/**
 * 高亮任务执行结果
 */
export interface HighlightExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 生成的 InlineMark 列表 */
  marks: InlineMark[];
  /** 生成的 DocOps 列表 */
  ops: ApplyInlineMarkOp[];
  /** 跳过的目标（找不到的短语等） */
  skipped: Array<{
    reason: string;
    target: unknown;
  }>;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * mark_key_terms 任务参数
 */
interface MarkKeyTermsParams {
  sectionId?: string;
  targets?: Array<{
    sectionId?: string;
    phrase: string;
    occurrence?: number;
  }>;
  terms?: Array<{
    phrase: string;
    occurrence?: number;
  }>;
  maxTerms?: number;
}

/**
 * mark_key_sentences 任务参数
 */
interface MarkKeySentencesParams {
  sectionId?: string;
  sentenceIndexes?: number[];
  sentences?: Array<{
    text: string;
    paragraphIndex?: number;
  }>;
  maxSentences?: number;
}

/**
 * mark_key_paragraphs 任务参数
 */
interface MarkKeyParagraphsParams {
  sectionId?: string;
  paragraphIndexes?: number[];
  maxParagraphs?: number;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 创建 ApplyInlineMarkOp
 */
function createApplyInlineMarkOp(mark: InlineMark): ApplyInlineMarkOp {
  return {
    type: 'ApplyInlineMark',
    payload: { mark },
    meta: {
      opId: `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      source: 'ai',
      timestamp: Date.now(),
    },
  };
}

/**
 * 在文本中查找句子并返回偏移量
 * 
 * @param sectionText - section 纯文本
 * @param sentenceText - 要查找的句子
 * @returns { startOffset, endOffset } 或 null
 */
function findSentenceOffsets(
  sectionText: string,
  sentenceText: string
): { startOffset: number; endOffset: number } | null {
  const index = sectionText.indexOf(sentenceText);
  if (index === -1) {
    return null;
  }
  return {
    startOffset: index,
    endOffset: index + sentenceText.length,
  };
}

/**
 * 根据句子索引获取句子范围
 * 
 * 简单实现：按句号/问号/感叹号分割
 * 
 * @param sectionText - section 纯文本
 * @param sentenceIndex - 句子索引（0-based）
 * @returns { startOffset, endOffset } 或 null
 */
function getSentenceOffsetsByIndex(
  sectionText: string,
  sentenceIndex: number
): { startOffset: number; endOffset: number } | null {
  // 简单的句子分割：按中英文句号、问号、感叹号
  const sentenceEndings = /[。！？.!?]/g;
  const sentences: Array<{ start: number; end: number }> = [];
  
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  
  while ((match = sentenceEndings.exec(sectionText)) !== null) {
    const end = match.index + 1;
    if (end > lastEnd) {
      sentences.push({
        start: lastEnd,
        end: end,
      });
      lastEnd = end;
    }
  }
  
  // 处理最后一个没有句号的句子
  if (lastEnd < sectionText.length) {
    sentences.push({
      start: lastEnd,
      end: sectionText.length,
    });
  }
  
  if (sentenceIndex < 0 || sentenceIndex >= sentences.length) {
    return null;
  }
  
  return {
    startOffset: sentences[sentenceIndex].start,
    endOffset: sentences[sentenceIndex].end,
  };
}

// ==========================================
// mark_key_terms 执行
// ==========================================

/**
 * 执行 mark_key_terms 任务
 * 
 * 将词语/短语级高亮任务转换为 InlineMark
 * 
 * @param editor - Lexical 编辑器实例
 * @param params - 任务参数
 * @param fallbackSectionId - 默认 section ID（如果参数中没有指定）
 * @returns 执行结果
 */
export function executeMarkKeyTerms(
  editor: LexicalEditor,
  params: MarkKeyTermsParams,
  fallbackSectionId?: string
): HighlightExecutionResult {
  const result: HighlightExecutionResult = {
    success: true,
    marks: [],
    ops: [],
    skipped: [],
  };

  const defaultSectionId = params.sectionId || fallbackSectionId;
  
  // 收集所有要标记的 term
  const termsToMark: Array<{
    sectionId: string;
    phrase: string;
    occurrence: number;
  }> = [];

  // 从 targets 格式收集
  if (params.targets && Array.isArray(params.targets)) {
    for (const target of params.targets) {
      if (target.phrase) {
        termsToMark.push({
          sectionId: target.sectionId || defaultSectionId || '',
          phrase: target.phrase,
          occurrence: target.occurrence || 1,
        });
      }
    }
  }

  // 从 terms 格式收集（使用 defaultSectionId）
  if (params.terms && Array.isArray(params.terms)) {
    for (const term of params.terms) {
      if (term.phrase && defaultSectionId) {
        termsToMark.push({
          sectionId: defaultSectionId,
          phrase: term.phrase,
          occurrence: term.occurrence || 1,
        });
      }
    }
  }

  // 限制最大标记数量
  const maxTerms = params.maxTerms || 20;
  const limitedTerms = termsToMark.slice(0, maxTerms);

  console.log('[HighlightExec] executeMarkKeyTerms:', {
    termsCount: limitedTerms.length,
    maxTerms,
    defaultSectionId,
  });

  for (const term of limitedTerms) {
    if (!term.sectionId) {
      result.skipped.push({
        reason: 'Missing sectionId',
        target: term,
      });
      continue;
    }

    // 获取 section 文本
    const sectionText = getSectionTextFromEditor(editor, term.sectionId);
    if (!sectionText) {
      result.skipped.push({
        reason: `Section not found: ${term.sectionId}`,
        target: term,
      });
      continue;
    }

    // 创建 InlineMark
    const mark = createInlineMarkFromPhrase(
      term.sectionId,
      sectionText,
      term.phrase,
      term.occurrence,
      'key_term',
      'highlight'
    );

    if (mark) {
      result.marks.push(mark);
      result.ops.push(createApplyInlineMarkOp(mark));
    } else {
      result.skipped.push({
        reason: `Phrase not found: "${term.phrase}"`,
        target: term,
      });
    }
  }

  console.log('[HighlightExec] executeMarkKeyTerms result:', {
    marksCreated: result.marks.length,
    skipped: result.skipped.length,
  });

  return result;
}

// ==========================================
// mark_key_sentences 执行
// ==========================================

/**
 * 执行 mark_key_sentences 任务
 * 
 * 将句子级高亮任务转换为 InlineMark
 * 
 * @param editor - Lexical 编辑器实例
 * @param params - 任务参数
 * @param fallbackSectionId - 默认 section ID
 * @returns 执行结果
 */
export function executeMarkKeySentences(
  editor: LexicalEditor,
  params: MarkKeySentencesParams,
  fallbackSectionId?: string
): HighlightExecutionResult {
  const result: HighlightExecutionResult = {
    success: true,
    marks: [],
    ops: [],
    skipped: [],
  };

  const sectionId = params.sectionId || fallbackSectionId;
  if (!sectionId) {
    result.success = false;
    result.error = 'Missing sectionId';
    return result;
  }

  const sectionText = getSectionTextFromEditor(editor, sectionId);
  if (!sectionText) {
    result.success = false;
    result.error = `Section not found: ${sectionId}`;
    return result;
  }

  const maxSentences = params.maxSentences || 10;
  let processedCount = 0;

  // 处理 sentenceIndexes
  if (params.sentenceIndexes && Array.isArray(params.sentenceIndexes)) {
    for (const index of params.sentenceIndexes) {
      if (processedCount >= maxSentences) break;

      const offsets = getSentenceOffsetsByIndex(sectionText, index);
      if (offsets) {
        const anchor = createTextAnchor(
          sectionId,
          offsets.startOffset,
          offsets.endOffset
        );
        const mark = createInlineMark(
          anchor,
          'key_term', // 句子级也用 key_term，通过 style 区分
          'background', // 句子用更淡的背景色
          'ai'
        );
        result.marks.push(mark);
        result.ops.push(createApplyInlineMarkOp(mark));
        processedCount++;
      } else {
        result.skipped.push({
          reason: `Sentence index out of range: ${index}`,
          target: { sentenceIndex: index },
        });
      }
    }
  }

  // 处理 sentences（按文本匹配）
  if (params.sentences && Array.isArray(params.sentences)) {
    for (const sentence of params.sentences) {
      if (processedCount >= maxSentences) break;

      const offsets = findSentenceOffsets(sectionText, sentence.text);
      if (offsets) {
        const anchor = createTextAnchor(
          sectionId,
          offsets.startOffset,
          offsets.endOffset
        );
        const mark = createInlineMark(
          anchor,
          'key_term',
          'background',
          'ai'
        );
        result.marks.push(mark);
        result.ops.push(createApplyInlineMarkOp(mark));
        processedCount++;
      } else {
        result.skipped.push({
          reason: `Sentence not found: "${sentence.text.slice(0, 30)}..."`,
          target: sentence,
        });
      }
    }
  }

  console.log('[HighlightExec] executeMarkKeySentences result:', {
    marksCreated: result.marks.length,
    skipped: result.skipped.length,
  });

  return result;
}

// ==========================================
// mark_key_paragraphs 执行
// ==========================================

/**
 * 执行 mark_key_paragraphs 任务
 * 
 * 将段落级高亮任务转换为 InlineMark
 * 
 * 注意：这是一个预留功能，当前实现较为简化
 * 
 * @param editor - Lexical 编辑器实例
 * @param params - 任务参数
 * @param fallbackSectionId - 默认 section ID
 * @returns 执行结果
 */
export function executeMarkKeyParagraphs(
  _editor: LexicalEditor,
  params: MarkKeyParagraphsParams,
  fallbackSectionId?: string
): HighlightExecutionResult {
  const result: HighlightExecutionResult = {
    success: true,
    marks: [],
    ops: [],
    skipped: [],
  };

  const sectionId = params.sectionId || fallbackSectionId;
  if (!sectionId) {
    result.success = false;
    result.error = 'Missing sectionId';
    return result;
  }

  // TODO: 实现段落级高亮
  // 当前仅记录日志，不实际执行
  console.log('[HighlightExec] executeMarkKeyParagraphs: Not yet implemented', {
    sectionId,
    paragraphIndexes: params.paragraphIndexes,
  });

  if (params.paragraphIndexes && Array.isArray(params.paragraphIndexes)) {
    for (const index of params.paragraphIndexes) {
      result.skipped.push({
        reason: 'Paragraph-level highlighting not yet implemented',
        target: { paragraphIndex: index },
      });
    }
  }

  return result;
}

// ==========================================
// 统一执行入口
// ==========================================

/**
 * 执行高亮任务
 * 
 * 根据任务类型分发到具体的执行函数
 * 
 * @param editor - Lexical 编辑器实例
 * @param tasks - 任务列表（从 CanonicalIntent.tasks 过滤出的高亮任务）
 * @param fallbackSectionId - 默认 section ID
 * @returns 所有任务的执行结果
 */
export function executeHighlightTasks(
  editor: LexicalEditor,
  tasks: IntentTask[],
  fallbackSectionId?: string
): HighlightExecutionResult {
  const result: HighlightExecutionResult = {
    success: true,
    marks: [],
    ops: [],
    skipped: [],
  };

  // 按优先级排序：paragraphs → sentences → terms
  const sortedTasks = [...tasks].sort((a, b) => {
    const priority: Record<string, number> = {
      mark_key_paragraphs: 0,
      mark_key_sentences: 1,
      mark_key_terms: 2,
    };
    return (priority[a.type] ?? 99) - (priority[b.type] ?? 99);
  });

  for (const task of sortedTasks) {
    let taskResult: HighlightExecutionResult;

    switch (task.type) {
      case 'mark_key_terms':
        taskResult = executeMarkKeyTerms(
          editor,
          task.params as MarkKeyTermsParams,
          fallbackSectionId
        );
        break;

      case 'mark_key_sentences':
        taskResult = executeMarkKeySentences(
          editor,
          task.params as MarkKeySentencesParams,
          fallbackSectionId
        );
        break;

      case 'mark_key_paragraphs':
        taskResult = executeMarkKeyParagraphs(
          editor,
          task.params as MarkKeyParagraphsParams,
          fallbackSectionId
        );
        break;

      default:
        // 非高亮任务，跳过
        continue;
    }

    // 合并结果
    result.marks.push(...taskResult.marks);
    result.ops.push(...taskResult.ops);
    result.skipped.push(...taskResult.skipped);

    if (!taskResult.success) {
      result.success = false;
      if (taskResult.error) {
        result.error = (result.error || '') + taskResult.error + '; ';
      }
    }
  }

  console.log('[HighlightExec] executeHighlightTasks total result:', {
    tasksProcessed: sortedTasks.length,
    marksCreated: result.marks.length,
    skipped: result.skipped.length,
    success: result.success,
  });

  return result;
}

/**
 * 判断任务列表中是否包含高亮任务
 */
export function hasHighlightTasks(tasks: IntentTask[]): boolean {
  return tasks.some(
    (t) =>
      t.type === 'mark_key_terms' ||
      t.type === 'mark_key_sentences' ||
      t.type === 'mark_key_paragraphs'
  );
}

/**
 * 从任务列表中过滤出高亮任务
 */
export function filterHighlightTasks(tasks: IntentTask[]): IntentTask[] {
  return tasks.filter(
    (t) =>
      t.type === 'mark_key_terms' ||
      t.type === 'mark_key_sentences' ||
      t.type === 'mark_key_paragraphs'
  );
}

