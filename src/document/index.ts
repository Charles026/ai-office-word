/**
 * Document 层导出
 * 
 * 此层是文档的 Source of Truth，管理 AST 和操作
 */

// 从 types 导出类型
export type {
  DocumentAst,
  BlockNode,
  HeadingNode,
  ListNode,
  ParagraphNode,
  TextMarks,
  TextRunNode,
  LinkNode,
  InlineNode,
  ListItemNode,
  PlaceholderNode,
  DocumentMetadata,
} from './types';

// 从 types 导出常量和函数
export {
  DEFAULT_MARKS,
  generateNodeId,
  createTextRun,
  createParagraph,
  createHeading,
  createList,
  createListItem,
  createPlaceholder,
  createEmptyDocument,
  getBlockText,
  getInlineText,
  findBlockById,
  getBlockIndex,
  hasInlineChildren,
  isParagraph,
  isHeading,
  isList,
  isPlaceholder,
  isTextRun,
  getTextInSelection,
  isValidSelection,
  isSameBlockSelection,
} from './types';

export * from './DocumentEngine';

// 从 section 导出
export type {
  ParagraphType,
  HeadingLevel,
  OutlineItem,
  Section,
  DocumentParagraphs,
  ParagraphNode as SectionParagraphNode,
} from './section';

export {
  getHeadingLevel,
  getParagraphTypeFromLevel,
  isHeadingType,
  buildOutline,
  getSectionRange,
  getSectionContent,
  getAllSections,
  getOutline,
  getSection,
  replaceSectionContent,
} from './section';

