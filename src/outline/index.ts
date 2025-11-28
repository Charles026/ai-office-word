/**
 * Outline 模块导出
 */

// 类型
export * from './types';

// 工具函数
export {
  generateOutlineFromEditor,
  generateOutlineFromParagraphs,
  buildOutlineTree,
  getSectionRange,
  getSectionRangeFromEditor,
  getSectionContent,
  findActiveHeading,
  scrollToHeading,
  getParagraphsFromEditor,
} from './outlineUtils';

// 组件
export { OutlinePane } from './OutlinePane';
export type { OutlinePaneProps } from './OutlinePane';
export { SectionContextMenu } from './SectionContextMenu';
export type { SectionContextMenuProps } from './SectionContextMenu';

// Hooks
export { useOutline } from './useOutline';
export type { UseOutlineOptions, UseOutlineReturn } from './useOutline';

