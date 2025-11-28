/**
 * DocOps 层导出
 * 
 * 提供文档操作的统一接口
 */

export * from './SectionDocOps';

// Section DocOps Diff Writer
export * from './sectionDocOpsDiff';

// Rewrite Section Repair (LlmParagraph 从 sectionDocOpsDiff 导出，这里只导出修复函数)
export type { RepairResult } from './rewriteSectionRepair';
export {
  repairRewriteSectionParagraphs,
  repairRewriteSectionParagraphsWithDetails,
  needsRepair,
} from './rewriteSectionRepair';
