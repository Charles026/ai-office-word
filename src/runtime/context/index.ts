/**
 * Context 模块导出
 * 
 * 提供从 Document AST 中抽取结构化上下文的能力。
 */

// 类型
export * from './types';

// 主函数
export {
  extractSectionContext,
  getSectionPlainText,
  getSectionFullText,
  isSectionEmpty,
  getSectionStats,
} from './extractSectionContext';

// Scope helpers
export {
  getParagraphsForScope,
  getScopeLabel,
  supportsChapterScope,
  isOwnEqualToSubtree,
  getChildSectionsSummary,
  getSubtreeParagraphRanges,
} from './sectionScopeHelpers';

