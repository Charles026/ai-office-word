/**
 * rewrite_section 段落修复模块
 * 
 * 用于在调用 buildSectionDocOpsDiff 之前，对 LLM 返回的 newParagraphs 进行容错修复，
 * 确保返回的数组长度与原始段落数量一致。
 * 
 * @module docops/rewriteSectionRepair
 */

import type { SectionContext } from '../runtime/context/types';
import type { LlmParagraph } from './sectionDocOpsDiff';

// Re-export for backwards compatibility
export type { LlmParagraph };

/**
 * 修复结果
 */
export interface RepairResult {
  /** 修复后的段落数组 */
  paragraphs: LlmParagraph[];
  /** 是否进行了修复 */
  wasRepaired: boolean;
  /** 修复详情 */
  repairDetails?: {
    /** 原始输入类型 */
    inputType: 'array' | 'invalid';
    /** 原始段落数 */
    originalCount: number;
    /** 目标段落数 */
    targetCount: number;
    /** 有效的新段落数 */
    validNewCount: number;
    /** 使用原文回退的段落索引 */
    fallbackIndices: number[];
  };
}

// ==========================================
// 常量
// ==========================================

const __DEV__ = process.env.NODE_ENV === 'development';
const LOG_PREFIX = '[rewrite_section][repair]';

// ==========================================
// 主函数
// ==========================================

/**
 * 修复 rewrite_section 的段落数组
 * 
 * 确保返回的数组长度与 context.paragraphs.length 完全一致。
 * 
 * 修复策略：
 * 1. 如果 newParagraphs 无效（不是数组）→ 使用原文作为每个段落的文本
 * 2. 如果 newParagraphs 是数组 → 按 index 匹配，缺失或无效的位置使用原文回退
 * 
 * @param context - Section 上下文
 * @param newParagraphs - LLM 返回的段落数组（可能无效或长度不一致）
 * @returns 修复后的段落数组，长度保证等于 context.paragraphs.length
 * 
 * @example
 * ```ts
 * const repaired = repairRewriteSectionParagraphs(context, parsed?.paragraphs);
 * const docOps = buildSectionDocOpsDiff(context, repaired, { mode: 'rewrite' });
 * ```
 */
export function repairRewriteSectionParagraphs(
  context: SectionContext,
  newParagraphs: LlmParagraph[] | undefined | null
): LlmParagraph[] {
  const result = repairRewriteSectionParagraphsWithDetails(context, newParagraphs);
  return result.paragraphs;
}

/**
 * 修复 rewrite_section 的段落数组（带详细信息）
 * 
 * @param context - Section 上下文
 * @param newParagraphs - LLM 返回的段落数组
 * @returns 修复结果，包含修复后的段落和详细信息
 */
export function repairRewriteSectionParagraphsWithDetails(
  context: SectionContext,
  newParagraphs: LlmParagraph[] | undefined | null
): RepairResult {
  const oldParagraphs = context.paragraphs;
  const oldCount = oldParagraphs.length;

  // 情况 1：newParagraphs 无效（不是数组）
  if (!Array.isArray(newParagraphs)) {
    if (__DEV__) {
      console.warn(
        `${LOG_PREFIX} newParagraphs invalid (type: ${typeof newParagraphs}), fallback to original text only`
      );
    }

    const fallbackParagraphs = oldParagraphs.map((p, i) => ({
      index: i,
      text: p.text,
    }));

    return {
      paragraphs: fallbackParagraphs,
      wasRepaired: true,
      repairDetails: {
        inputType: 'invalid',
        originalCount: 0,
        targetCount: oldCount,
        validNewCount: 0,
        fallbackIndices: Array.from({ length: oldCount }, (_, i) => i),
      },
    };
  }

  // 情况 2：newParagraphs 是数组
  // 构建 index → text 映射，只保留有效项
  const byIndex = new Map<number, string>();
  let validCount = 0;

  for (const item of newParagraphs) {
    // 验证 item 结构
    if (!item || typeof item !== 'object') {
      continue;
    }

    const { index, text } = item;

    // 验证 index 和 text
    if (typeof index !== 'number' || typeof text !== 'string') {
      continue;
    }

    // 只保留在有效范围内的 index
    if (index < 0 || index >= oldCount) {
      if (__DEV__) {
        console.warn(
          `${LOG_PREFIX} ignoring out-of-range index: ${index} (valid range: 0-${oldCount - 1})`
        );
      }
      continue;
    }

    // 只保留非空文本
    const trimmedText = text.trim();
    if (trimmedText.length > 0) {
      byIndex.set(index, text); // 保留原始文本，不是 trimmed 的
      validCount++;
    }
  }

  // 构建修复后的数组
  const repairedParagraphs: LlmParagraph[] = [];
  const fallbackIndices: number[] = [];

  for (let i = 0; i < oldCount; i++) {
    const newText = byIndex.get(i);
    
    if (newText !== undefined) {
      // 使用 LLM 返回的新文本
      repairedParagraphs.push({
        index: i,
        text: newText,
      });
    } else {
      // 使用原文回退
      repairedParagraphs.push({
        index: i,
        text: oldParagraphs[i].text,
      });
      fallbackIndices.push(i);
    }
  }

  // 判断是否进行了修复
  const wasRepaired = 
    newParagraphs.length !== oldCount || 
    fallbackIndices.length > 0;

  // 记录日志
  if (wasRepaired && __DEV__) {
    console.warn(
      `${LOG_PREFIX} mismatch paragraphs: old=${oldCount}, new=${newParagraphs.length}, ` +
      `valid=${validCount}, fallback=${fallbackIndices.length}, repaired with fallback.`
    );
    
    if (fallbackIndices.length > 0) {
      console.debug(
        `${LOG_PREFIX} fallback indices:`,
        fallbackIndices
      );
    }
  }

  return {
    paragraphs: repairedParagraphs,
    wasRepaired,
    repairDetails: {
      inputType: 'array',
      originalCount: newParagraphs.length,
      targetCount: oldCount,
      validNewCount: validCount,
      fallbackIndices,
    },
  };
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 检查是否需要修复
 * 
 * @param context - Section 上下文
 * @param newParagraphs - LLM 返回的段落数组
 * @returns 是否需要修复
 */
export function needsRepair(
  context: SectionContext,
  newParagraphs: LlmParagraph[] | undefined | null
): boolean {
  if (!Array.isArray(newParagraphs)) {
    return true;
  }

  const oldCount = context.paragraphs.length;

  if (newParagraphs.length !== oldCount) {
    return true;
  }

  // 检查每个段落是否有效
  for (let i = 0; i < oldCount; i++) {
    const p = newParagraphs[i];
    
    if (!p || typeof p !== 'object') {
      return true;
    }

    if (typeof p.index !== 'number' || p.index !== i) {
      return true;
    }

    if (typeof p.text !== 'string' || p.text.trim().length === 0) {
      return true;
    }
  }

  return false;
}

