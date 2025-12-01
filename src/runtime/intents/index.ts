/**
 * Intents 模块导出
 * 
 * 提供 Intent 类型定义和 Intent Builder 函数。
 */

// 类型
export * from './types';

// Section Intent Builders
export {
  buildRewriteSectionIntent,
  buildSummarizeSectionIntent,
  buildExpandSectionIntent,
  buildHighlightOnlyIntent,
  // 选项类型
  type RewriteSectionOptions,
  type SummarizeSectionOptions,
  type ExpandSectionOptions,
  type HighlightOnlyOptions,
} from './buildSectionIntent';

