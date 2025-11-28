/**
 * Outline 工具函数
 * 
 * 提供从编辑器状态生成 Outline 的核心逻辑。
 * 
 * 【设计原则】
 * - 纯函数，可独立测试
 * - 不依赖 DOM，只依赖 Lexical AST
 * - 不包含 UI 逻辑
 */

import { LexicalEditor, $getRoot, LexicalNode, $isElementNode } from 'lexical';
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { OutlineItem, HeadingLevel, SectionRange, SectionContent } from './types';

// ==========================================
// 文档段落信息
// ==========================================

/** 段落信息（用于内部处理） */
interface ParagraphInfo {
  id: string;
  type: 'paragraph' | 'heading' | 'list' | 'other';
  headingLevel?: HeadingLevel;
  text: string;
  index: number;
}

/**
 * 从 Lexical 编辑器获取所有段落信息
 */
export function getParagraphsFromEditor(editor: LexicalEditor): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  
  editor.getEditorState().read(() => {
    const root = $getRoot();
    const children = root.getChildren();
    
    children.forEach((node, index) => {
      const info = extractParagraphInfo(node, index);
      if (info) {
        paragraphs.push(info);
      }
    });
  });
  
  return paragraphs;
}

/**
 * 从 Lexical 节点提取段落信息
 */
function extractParagraphInfo(node: LexicalNode, index: number): ParagraphInfo | null {
  if (!$isElementNode(node)) {
    return null;
  }

  const id = node.getKey();
  const text = node.getTextContent();

  if ($isHeadingNode(node)) {
    const tag = (node as HeadingNode).getTag();
    const level = getHeadingLevelFromTag(tag);
    if (level) {
      return {
        id,
        type: 'heading',
        headingLevel: level,
        text,
        index,
      };
    }
  }

  const nodeType = node.getType();
  if (nodeType === 'paragraph') {
    return {
      id,
      type: 'paragraph',
      text,
      index,
    };
  }

  if (nodeType === 'list') {
    return {
      id,
      type: 'list',
      text,
      index,
    };
  }

  return {
    id,
    type: 'other',
    text,
    index,
  };
}

/**
 * 从 HTML 标签获取标题级别
 */
function getHeadingLevelFromTag(tag: string): HeadingLevel | null {
  switch (tag) {
    case 'h1':
      return 1;
    case 'h2':
      return 2;
    case 'h3':
      return 3;
    default:
      return null;
  }
}

// ==========================================
// Outline 生成
// ==========================================

/**
 * 从编辑器生成 Outline 项列表
 * 
 * @param editor - Lexical 编辑器实例
 * @returns OutlineItem[] - 扁平的大纲项列表
 */
export function generateOutlineFromEditor(editor: LexicalEditor): OutlineItem[] {
  const paragraphs = getParagraphsFromEditor(editor);
  return generateOutlineFromParagraphs(paragraphs);
}

/**
 * 从段落信息生成 Outline 项列表
 * 
 * @param paragraphs - 段落信息列表
 * @returns OutlineItem[] - 扁平的大纲项列表
 */
export function generateOutlineFromParagraphs(paragraphs: ParagraphInfo[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  let position = 0;

  for (const para of paragraphs) {
    if (para.type === 'heading' && para.headingLevel) {
      items.push({
        id: para.id,
        level: para.headingLevel,
        text: para.text,
        position,
      });
      position++;
    }
  }

  return items;
}

/**
 * 将扁平的 Outline 列表转换为树形结构
 * 
 * @param items - 扁平的大纲项列表
 * @returns OutlineItem[] - 树形的大纲项列表
 */
export function buildOutlineTree(items: OutlineItem[]): OutlineItem[] {
  if (items.length === 0) return [];

  const result: OutlineItem[] = [];
  const stack: OutlineItem[] = [];

  for (const item of items) {
    const newItem: OutlineItem = { ...item, children: [] };

    // 找到合适的父节点
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // 没有父节点，添加到根级别
      result.push(newItem);
    } else {
      // 添加到父节点的 children
      const parent = stack[stack.length - 1];
      if (!parent.children) {
        parent.children = [];
      }
      parent.children.push(newItem);
    }

    stack.push(newItem);
  }

  return result;
}

// ==========================================
// 章节范围计算
// ==========================================

/**
 * 根据 heading 计算章节范围
 * 
 * 规则：
 * 1. 从给定 heading 开始
 * 2. 向后扫描文档段落，直到遇到：
 *    - 下一个 level <= 当前 level 的 heading（同级或更高层级）
 *    - 或文档结束
 * 3. 中间的所有段落（包括子级 heading 及内容）都属于此章节
 * 
 * @param paragraphs - 所有段落信息
 * @param headingId - 要查找的 heading ID
 * @returns SectionRange | null - 章节范围，如果找不到 heading 则返回 null
 */
export function getSectionRange(
  paragraphs: ParagraphInfo[],
  headingId: string
): SectionRange | null {
  // 找到目标 heading 的索引
  const startIndex = paragraphs.findIndex(p => p.id === headingId);
  if (startIndex === -1) {
    return null;
  }

  const startPara = paragraphs[startIndex];
  if (startPara.type !== 'heading' || !startPara.headingLevel) {
    return null;
  }

  const headingLevel = startPara.headingLevel;
  const paragraphIds: string[] = [headingId];

  // 向后扫描，找到章节结束位置
  let endIndex = paragraphs.length;
  let endId: string | null = null;

  for (let i = startIndex + 1; i < paragraphs.length; i++) {
    const para = paragraphs[i];

    // 检查是否遇到同级或更高级别的 heading
    if (para.type === 'heading' && para.headingLevel && para.headingLevel <= headingLevel) {
      endIndex = i;
      endId = para.id;
      break;
    }

    paragraphIds.push(para.id);
  }

  return {
    startId: headingId,
    endId,
    startIndex,
    endIndex,
    paragraphIds,
  };
}

/**
 * 从编辑器获取章节范围
 */
export function getSectionRangeFromEditor(
  editor: LexicalEditor,
  headingId: string
): SectionRange | null {
  const paragraphs = getParagraphsFromEditor(editor);
  return getSectionRange(paragraphs, headingId);
}

/**
 * 获取章节内容
 * 
 * @param editor - Lexical 编辑器实例
 * @param headingId - heading ID
 * @returns SectionContent | null
 */
export function getSectionContent(
  editor: LexicalEditor,
  headingId: string
): SectionContent | null {
  const paragraphs = getParagraphsFromEditor(editor);
  const range = getSectionRange(paragraphs, headingId);
  
  if (!range) {
    return null;
  }

  // 找到 heading 信息
  const headingPara = paragraphs.find(p => p.id === headingId);
  if (!headingPara || headingPara.type !== 'heading' || !headingPara.headingLevel) {
    return null;
  }

  const heading: OutlineItem = {
    id: headingPara.id,
    level: headingPara.headingLevel,
    text: headingPara.text,
    position: headingPara.index,
  };

  // 提取章节内容（不含标题）
  const contentParagraphs = paragraphs.slice(range.startIndex + 1, range.endIndex);
  const plainText = contentParagraphs.map(p => p.text).join('\n\n');

  return {
    heading,
    range,
    plainText,
  };
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 查找当前视口中的活跃 heading
 * 
 * 这个函数需要在有 DOM 的环境中使用
 * 
 * @param items - 大纲项列表
 * @param containerElement - 编辑器容器元素
 * @returns 当前活跃的 heading ID，如果没有则返回 null
 */
export function findActiveHeading(
  items: OutlineItem[],
  containerElement: HTMLElement
): string | null {
  if (items.length === 0) return null;

  const containerRect = containerElement.getBoundingClientRect();
  const viewportTop = containerRect.top;
  const viewportMiddle = viewportTop + containerRect.height / 3;

  let activeId: string | null = null;
  let minDistance = Infinity;

  for (const item of items) {
    const element = containerElement.querySelector(`[data-lexical-node-key="${item.id}"]`);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    const distance = Math.abs(rect.top - viewportMiddle);

    // 只考虑在视口上半部分的 heading
    if (rect.top <= viewportMiddle && distance < minDistance) {
      minDistance = distance;
      activeId = item.id;
    }
  }

  // 如果没有找到，返回第一个
  if (!activeId && items.length > 0) {
    activeId = items[0].id;
  }

  return activeId;
}

/**
 * 滚动到指定的 heading
 * 
 * @param headingId - heading ID
 * @param containerElement - 编辑器容器元素
 */
export function scrollToHeading(
  headingId: string,
  containerElement: HTMLElement
): void {
  const element = containerElement.querySelector(`[data-lexical-node-key="${headingId}"]`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

