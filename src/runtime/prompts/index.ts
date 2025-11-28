/**
 * Prompts 模块导出
 * 
 * 提供 Section 级别的 Prompt 构建函数。
 */

// 类型
export * from './sectionPromptTypes';

// Prompt Builders
export {
  buildRewriteSectionPrompt,
  buildSummarizeSectionPrompt,
  buildExpandSectionPrompt,
  buildSectionPrompt,
} from './buildSectionPrompt';

