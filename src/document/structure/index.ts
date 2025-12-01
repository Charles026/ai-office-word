/**
 * DocStructureEngine 模块导出
 */

export {
  // 核心类型
  type SectionNode,
  type ParagraphRole,
  type DocStructureSnapshot,
  type DocStructureMeta,
  type BuildDocStructureOptions,
  
  // DocSkeleton 类型（LLM 友好的结构抽象）
  type SectionRole,
  type DocSectionSkeleton,
  type DocSkeletonMeta,
  type DocSkeleton,
  
  // 核心函数
  buildDocStructureFromEditor,
  buildDocStructureFromAst,
  
  // DocSkeleton 构建函数
  buildDocSkeletonFromEditor,
  buildDocSkeletonFromAst,
  buildDocSkeletonFromSnapshot,
  
  // 辅助查询函数
  findSectionById,
  findSectionByBlockId,
  findSectionContainingBlock,
  getOutlineFromSnapshot,
  
  // DocSkeleton 查询函数
  flattenDocSkeleton,
  findSkeletonSectionById,
  findSkeletonSectionByTitle,
  findSkeletonSectionByIndex,
} from './DocStructureEngine';

