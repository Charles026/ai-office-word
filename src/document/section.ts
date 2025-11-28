/**
 * Section 章节模块
 * 
 * 为 DocAgent 和 DocOps 提供章节级工具函数。
 * 
 * 【设计原则】
 * - 纯函数，可独立测试
 * - 不依赖 DOM，只依赖 AST
 * - 统一的类型定义
 */

// ==========================================
// 类型定义
// ==========================================

/**
 * 段落类型（统一定义）
 * 
 * 与 docx 内置样式对应：
 * - 'normal' → 正文
 * - 'heading-1' → Heading 1
 * - 'heading-2' → Heading 2
 * - 'heading-3' → Heading 3
 */
export type ParagraphType = 'normal' | 'heading-1' | 'heading-2' | 'heading-3';

/** 标题级别 */
export type HeadingLevel = 1 | 2 | 3;

/**
 * 大纲项
 */
export interface OutlineItem {
  /** 对应 AST 中该段落节点的唯一 id */
  id: string;
  /** 标题级别 */
  level: HeadingLevel;
  /** 标题纯文本 */
  text: string;
  /** 在整篇文档段落数组中的索引 */
  index: number;
}

/**
 * 章节
 */
export interface Section {
  /** 章节标题信息 */
  heading: OutlineItem;
  /** 本章节内容起始段落 index（通常是 heading 自己的 index） */
  startIndex: number;
  /** 本章节最后一个段落 index（闭区间） */
  endIndex: number;
  /** 包含的段落 ID 列表 */
  paragraphIds: string[];
}

/**
 * 段落节点（简化的 AST 节点）
 */
export interface ParagraphNode {
  /** 节点 ID */
  id: string;
  /** 段落类型 */
  paragraphType: ParagraphType;
  /** 文本内容 */
  text: string;
  /** 在文档中的索引 */
  index: number;
}

/**
 * 文档 AST（简化版，用于章节计算）
 */
export interface DocumentParagraphs {
  paragraphs: ParagraphNode[];
}

// ==========================================
// 类型转换辅助函数
// ==========================================

/**
 * 从 ParagraphType 获取 HeadingLevel
 */
export function getHeadingLevel(type: ParagraphType): HeadingLevel | null {
  switch (type) {
    case 'heading-1':
      return 1;
    case 'heading-2':
      return 2;
    case 'heading-3':
      return 3;
    default:
      return null;
  }
}

/**
 * 从 HeadingLevel 获取 ParagraphType
 */
export function getParagraphTypeFromLevel(level: HeadingLevel): ParagraphType {
  switch (level) {
    case 1:
      return 'heading-1';
    case 2:
      return 'heading-2';
    case 3:
      return 'heading-3';
  }
}

/**
 * 判断是否为标题类型
 */
export function isHeadingType(type: ParagraphType): boolean {
  return type === 'heading-1' || type === 'heading-2' || type === 'heading-3';
}

// ==========================================
// 核心函数：生成 Outline
// ==========================================

/**
 * 从文档段落生成 Outline
 * 
 * @param doc - 文档段落列表
 * @returns OutlineItem[] - 按文档顺序排序的大纲项数组
 */
export function buildOutline(doc: DocumentParagraphs): OutlineItem[] {
  const items: OutlineItem[] = [];

  for (const para of doc.paragraphs) {
    const level = getHeadingLevel(para.paragraphType);
    if (level !== null) {
      items.push({
        id: para.id,
        level,
        text: para.text,
        index: para.index,
      });
    }
  }

  return items;
}

// ==========================================
// 核心函数：计算章节范围
// ==========================================

/**
 * 根据 heading ID 推断章节范围
 * 
 * 规则：
 * 1. 找到对应 heading 的段落索引 i，当前 heading 的 level = L
 * 2. 从 i 开始向后扫描：
 *    - 遇到下一个 paragraphType 为 heading 且 level <= L，则停止
 *    - 否则继续直到文档末尾
 * 3. 返回 { startIndex: i, endIndex: lastIndex }
 *    - 包括 heading 行本身和其所有子内容段落（包含子 heading）
 * 
 * @param doc - 文档段落列表
 * @param headingId - 要查找的 heading ID
 * @returns Section | null - 章节信息，如果找不到 heading 则返回 null
 */
export function getSectionRange(
  doc: DocumentParagraphs,
  headingId: string
): Section | null {
  const { paragraphs } = doc;

  // 找到目标 heading 的索引
  const startIndex = paragraphs.findIndex(p => p.id === headingId);
  if (startIndex === -1) {
    return null;
  }

  const startPara = paragraphs[startIndex];
  const headingLevel = getHeadingLevel(startPara.paragraphType);
  if (headingLevel === null) {
    // 不是 heading 类型
    return null;
  }

  const paragraphIds: string[] = [headingId];

  // 向后扫描，找到章节结束位置
  let endIndex = paragraphs.length - 1; // 闭区间

  for (let i = startIndex + 1; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const level = getHeadingLevel(para.paragraphType);

    // 检查是否遇到同级或更高级别的 heading
    if (level !== null && level <= headingLevel) {
      endIndex = i - 1; // 闭区间，不包含这个 heading
      break;
    }

    paragraphIds.push(para.id);
  }

  const heading: OutlineItem = {
    id: startPara.id,
    level: headingLevel,
    text: startPara.text,
    index: startIndex,
  };

  return {
    heading,
    startIndex,
    endIndex,
    paragraphIds,
  };
}

/**
 * 获取章节的纯文本内容（不含标题）
 */
export function getSectionContent(
  doc: DocumentParagraphs,
  headingId: string
): string | null {
  const section = getSectionRange(doc, headingId);
  if (!section) {
    return null;
  }

  const { paragraphs } = doc;
  const contentParagraphs = paragraphs.slice(section.startIndex + 1, section.endIndex + 1);
  return contentParagraphs.map(p => p.text).join('\n\n');
}

/**
 * 获取所有章节
 */
export function getAllSections(doc: DocumentParagraphs): Section[] {
  const outline = buildOutline(doc);
  const sections: Section[] = [];

  for (const item of outline) {
    const section = getSectionRange(doc, item.id);
    if (section) {
      sections.push(section);
    }
  }

  return sections;
}

// ==========================================
// DocOps 接口（为未来 Agent 准备）
// ==========================================

/**
 * 获取文档大纲
 * 
 * 供 DocAgent 调用
 */
export function getOutline(doc: DocumentParagraphs): OutlineItem[] {
  return buildOutline(doc);
}

/**
 * 获取章节信息
 * 
 * 供 DocAgent 调用
 */
export function getSection(doc: DocumentParagraphs, headingId: string): Section | null {
  return getSectionRange(doc, headingId);
}

/**
 * 替换章节内容（预留接口）
 * 
 * 供 DocAgent 调用，用于章节级改写/总结
 * 
 * @param doc - 文档段落列表
 * @param section - 章节信息
 * @param newParagraphs - 新的段落列表（不含标题）
 * @returns 新的文档段落列表
 */
export function replaceSectionContent(
  doc: DocumentParagraphs,
  section: Section,
  newParagraphs: ParagraphNode[]
): DocumentParagraphs {
  const { paragraphs } = doc;
  
  // 保留标题
  const headingPara = paragraphs[section.startIndex];
  
  // 构建新的段落列表
  const before = paragraphs.slice(0, section.startIndex);
  const after = paragraphs.slice(section.endIndex + 1);
  
  // 重新计算索引
  const updatedNewParagraphs = newParagraphs.map((p, i) => ({
    ...p,
    index: section.startIndex + 1 + i,
  }));
  
  const updatedAfter = after.map((p, i) => ({
    ...p,
    index: section.startIndex + 1 + updatedNewParagraphs.length + i,
  }));

  return {
    paragraphs: [
      ...before,
      headingPara,
      ...updatedNewParagraphs,
      ...updatedAfter,
    ],
  };
}

