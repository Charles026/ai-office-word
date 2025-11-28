/**
 * Section Scope Helpers
 * 
 * 根据 scope 选择使用 ownParagraphs 或 subtreeParagraphs
 */

import type { SectionContext, ParagraphInfo } from './types';
import type { SectionScope } from '../intents/types';

// ==========================================
// 段落选择
// ==========================================

/**
 * 根据 scope 获取要处理的段落数组
 * 
 * @param context - Section 上下文
 * @param scope - 重写范围（'intro' = 导语，'chapter' = 整章）
 * @returns 对应的段落数组
 * 
 * @example
 * ```ts
 * const paragraphs = getParagraphsForScope(context, 'intro');
 * // 返回 context.ownParagraphs
 * 
 * const paragraphs = getParagraphsForScope(context, 'chapter');
 * // 返回 context.subtreeParagraphs
 * ```
 */
export function getParagraphsForScope(
  context: SectionContext,
  scope: SectionScope
): ParagraphInfo[] {
  return scope === 'chapter'
    ? context.subtreeParagraphs
    : context.ownParagraphs;
}

/**
 * 获取 scope 的中文描述
 */
export function getScopeLabel(scope: SectionScope): string {
  return scope === 'chapter' ? '整章' : '导语';
}

// ==========================================
// Scope 判断
// ==========================================

/**
 * 判断当前 section 是否支持 chapter scope
 * 
 * 只有 H2 且有子 section 时才支持 chapter scope
 */
export function supportsChapterScope(context: SectionContext): boolean {
  return context.level === 2 && context.childSections.length > 0;
}

/**
 * 判断当前 section 的 own 和 subtree 是否相同
 * 
 * 对于 H3 或没有子 section 的 H2，own === subtree
 */
export function isOwnEqualToSubtree(context: SectionContext): boolean {
  return context.ownParagraphs.length === context.subtreeParagraphs.length;
}

// ==========================================
// 子 Section 信息
// ==========================================

/**
 * 获取子 section 的简要信息（用于 Prompt）
 */
export function getChildSectionsSummary(
  context: SectionContext
): Array<{ title: string; level: number; paragraphCount: number }> {
  return context.childSections.map(child => ({
    title: child.titleText,
    level: child.level,
    paragraphCount: child.ownParagraphCount,
  }));
}

/**
 * 计算 subtree 中各子 section 的段落范围
 * 
 * 用于在 chapter scope 下定位段落属于哪个子 section
 */
export function getSubtreeParagraphRanges(
  context: SectionContext
): Array<{
  sectionId: string;
  title: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
}> {
  const ranges: Array<{
    sectionId: string;
    title: string;
    startParagraphIndex: number;
    endParagraphIndex: number;
  }> = [];

  // 导语部分
  if (context.ownParagraphs.length > 0) {
    ranges.push({
      sectionId: context.sectionId,
      title: context.titleText,
      startParagraphIndex: 0,
      endParagraphIndex: context.ownParagraphs.length - 1,
    });
  }

  // 子 section 部分
  let currentIndex = context.ownParagraphs.length;
  
  for (const child of context.childSections) {
    // 跳过子标题本身（它在 subtreeParagraphs 中占一个位置）
    currentIndex++; // 子标题
    
    if (child.ownParagraphCount > 0) {
      ranges.push({
        sectionId: child.sectionId,
        title: child.titleText,
        startParagraphIndex: currentIndex,
        endParagraphIndex: currentIndex + child.ownParagraphCount - 1,
      });
      currentIndex += child.ownParagraphCount;
    }
  }

  return ranges;
}

// ==========================================
// 导出
// ==========================================

export type { SectionScope };

