/**
 * DocStructureEngine - 文档结构引擎
 * 
 * 【职责】
 * - 理解文档章节结构（H1/H2/H3）和段落角色
 * - 为 Section AI / Copilot 提供稳定的"结构真相"
 * - 独立于 DocumentEngine / DocOps，不修改文档内容
 * 
 * 【层级定位】
 * - DocumentAst: 内容真相（文本 + 基础样式）
 * - DocStructureEngine: 结构真相（章节树 + 段落角色）
 * - DocContextEnvelope: 上下文快照（传给 LLM）
 * 
 * 【设计原则】
 * - 纯函数，不修改输入
 * - 支持 Lexical AST 作为输入（主要）
 * - 支持 DocumentAst 作为输入（备用）
 * - 确定性算法，不依赖 AI
 * 
 * @version 1.0.0
 */

import { LexicalEditor, $getRoot, LexicalNode } from 'lexical';
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import type { DocumentAst, BlockNode } from '../types';
import { getBlockText, isHeading as isAstHeading } from '../types';

// ==========================================
// 常量
// ==========================================

/** 标题判定阈值：得分 >= 此值的 block 被认为是标题 */
const HEADING_THRESHOLD = 3;

/** 默认正文字号（当无法推断时） */
const DEFAULT_BODY_FONT_SIZE = 12;

/** 文档主标题的最小字号优势（比正文大多少才算主标题） */
const DOC_TITLE_FONT_SIZE_ADVANTAGE = 4;

// ==========================================
// 核心类型定义
// ==========================================

/**
 * 逻辑章节节点
 * 
 * 表示文档中的一个章节（H1/H2/H3）
 */
export interface SectionNode {
  /** 内部 sectionId（通常复用 block 的 key/id） */
  id: string;
  /** 归一化后的逻辑层级（1/2/3） */
  level: 1 | 2 | 3;
  /** 标题所在 block 的 ID */
  titleBlockId: string;
  /** 标题纯文本 */
  titleText: string;
  
  /** 在 blocks 中的起始索引（标题所在 index） */
  startBlockIndex: number;
  /** 在 blocks 中的结束索引（左闭右开：[start, end)） */
  endBlockIndex: number;
  
  /** 直接属于该 section 的正文段落 block IDs（不含子 section） */
  ownParagraphBlockIds: string[];
  
  /** 子章节 */
  children: SectionNode[];
}

/**
 * 段落角色
 * 
 * 描述一个 block 在文档中的语义角色
 */
export type ParagraphRole =
  | 'doc_title'      // 文档主标题（整个文档只应有一个）
  | 'section_title'  // 章节标题（任何层级的 H1/H2/H3）
  | 'body'           // 正文段落
  | 'list_item'      // 列表项
  | 'quote'          // 引用
  | 'meta'           // 元信息（作者、日期、页脚等）
  | 'unknown';       // 无法识别

/**
 * 文档结构快照
 * 
 * 这是 DocStructureEngine 的核心输出，提供稳定的结构信息
 */
export interface DocStructureSnapshot {
  /** 章节树（根级别的 sections） */
  sections: SectionNode[];
  /** 段落角色映射（blockId → role） */
  paragraphRoles: Record<string, ParagraphRole>;
  /** 元信息 */
  meta: DocStructureMeta;
}

/**
 * 文档结构元信息
 */
export interface DocStructureMeta {
  /** 总 block 数 */
  totalBlocks: number;
  /** 总章节数（含子章节） */
  totalSections: number;
  /** 文档主标题 block ID（如果存在） */
  docTitleBlockId?: string;
  /** 生成时间戳 */
  generatedAt: number;
  /** 引擎版本 */
  engineVersion: string;
}

/**
 * 构建选项
 */
export interface BuildDocStructureOptions {
  /** 是否输出调试日志 */
  debug?: boolean;
  /** 文档标题判定策略 */
  docTitleStrategy?: 'first_h1' | 'largest_heading' | 'none';
}

// ==========================================
// DocSkeleton 类型定义（LLM 友好的结构抽象）
// ==========================================

/**
 * 章节角色
 * 
 * 描述章节在文档中的语义角色，比 level 更具语义
 */
export type SectionRole = 
  | 'chapter'     // 章（顶级章节，通常是 H1 或第一级 H2）
  | 'section'     // 节（二级章节）
  | 'subsection'  // 小节（三级章节）
  | 'appendix'    // 附录
  | 'meta';       // 元信息（如版本历史、参考文献）

/**
 * 章节骨架节点
 * 
 * 专为 LLM 设计的章节表示，包含人类友好的显示索引和语义角色
 */
export interface DocSectionSkeleton {
  /** 章节 ID（对应 SectionNode.id） */
  id: string;
  /** 章节标题（纯文本） */
  title: string;
  /** 人类友好的显示索引，如 "第1章" / "1.1" / "Chapter 1" */
  displayIndex?: string;
  /** 章节角色（语义分类） */
  role: SectionRole;
  /** 层级（1/2/3） */
  level: 1 | 2 | 3;
  /** 父章节 ID（顶级章节为 null） */
  parentId: string | null;
  /** 子章节列表 */
  children: DocSectionSkeleton[];
  /** 在 blocks 中的起始索引 */
  startBlockIndex: number;
  /** 在 blocks 中的结束索引 */
  endBlockIndex: number;
  /** 直属段落数（不含子章节的段落） */
  paragraphCount: number;
}

/**
 * 文档骨架元信息
 * 
 * 已经计算好的统计信息，LLM 可以直接引用
 */
export interface DocSkeletonMeta {
  /** 章（chapter）的数量 */
  chapterCount: number;
  /** 节（section）的数量（含 subsection） */
  sectionCount: number;
  /** 是否有绪论/概述类章节 */
  hasIntro: boolean;
  /** 是否有结论/总结类章节 */
  hasConclusion: boolean;
  /** 语言提示（基于标题判断） */
  languageHint: 'zh' | 'en' | 'mixed' | 'other';
  /** 总章节数（含所有层级） */
  totalSections: number;
  /** 总段落数 */
  totalParagraphs: number;
}

/**
 * 文档骨架
 * 
 * 这是 DocStructureEngine 专为 LLM 提供的结构化输出。
 * 与 DocStructureSnapshot 相比，更强调语义角色和统计信息。
 */
export interface DocSkeleton {
  /** 章节骨架树 */
  sections: DocSectionSkeleton[];
  /** 元信息（统计、语言等） */
  meta: DocSkeletonMeta;
}

// ==========================================
// 内部类型
// ==========================================

/**
 * Block 特征（内部使用）
 * 
 * 用于分析每个 block 是否为标题
 */
interface BlockFeatures {
  /** block 实例（Lexical 或 AST） */
  block: LexicalNode | BlockNode;
  /** block ID / key */
  id: string;
  /** 在数组中的索引 */
  index: number;
  
  /** 是否使用了 Heading 样式（block.type === 'heading'） */
  isHeadingStyle: boolean;
  /** 从样式推断的标题层级（如果有） */
  headingLevelFromStyle?: number;
  
  /** 字号（从 style 推导，或默认值） */
  fontSize: number;
  /** 是否加粗 */
  isBold: boolean;
  
  /** 纯文本内容 */
  text: string;
  /** 文本长度 */
  textLength: number;
  /** 是否为单行短文本 */
  isSingleLine: boolean;
  /** 是否以编号开头（如 "1.", "第一章"） */
  startsWithNumbering: boolean;
  
  /** 是否在文档顶部附近（index <= 2） */
  isNearTop: boolean;
}

/**
 * 标题候选项（内部使用）
 */
interface HeadingCandidate {
  /** block 实例 */
  block: LexicalNode | BlockNode;
  /** block ID */
  id: string;
  /** 在数组中的索引 */
  index: number;
  /** 归一化后的逻辑层级 */
  level: 1 | 2 | 3;
  /** 原始特征 */
  features: BlockFeatures;
  /** 标题得分 */
  headingScore: number;
}

// ==========================================
// 核心函数：buildDocStructure
// ==========================================

/**
 * 从 Lexical 编辑器构建文档结构快照
 * 
 * @param editor - Lexical 编辑器实例
 * @param options - 构建选项
 * @returns DocStructureSnapshot
 */
export function buildDocStructureFromEditor(
  editor: LexicalEditor,
  options?: BuildDocStructureOptions
): DocStructureSnapshot {
  const opts = { debug: false, docTitleStrategy: 'first_h1' as const, ...options };
  
  let result: DocStructureSnapshot | null = null;
  
  editor.getEditorState().read(() => {
    const root = $getRoot();
    const children = root.getChildren();
    
    // 转换为统一格式进行处理
    const blocks = children.map((node, index) => ({
      node,
      id: node.getKey(),
      index,
      type: node.getType(),
      text: node.getTextContent(),
    }));
    
    result = buildDocStructureInternal(blocks, opts, 'lexical');
  });
  
  if (!result) {
    // Fallback: 返回空结构
    return {
      sections: [],
      paragraphRoles: {},
      meta: {
        totalBlocks: 0,
        totalSections: 0,
        generatedAt: Date.now(),
        engineVersion: '1.0.0',
      },
    };
  }
  
  return result;
}

/**
 * 从 DocumentAst 构建文档结构快照
 * 
 * @param ast - Document AST
 * @param options - 构建选项
 * @returns DocStructureSnapshot
 */
export function buildDocStructureFromAst(
  ast: DocumentAst,
  options?: BuildDocStructureOptions
): DocStructureSnapshot {
  const opts = { debug: false, docTitleStrategy: 'first_h1' as const, ...options };
  
  const blocks = ast.blocks.map((block, index) => ({
    node: block,
    id: block.id,
    index,
    type: block.type,
    text: getBlockText(block),
  }));
  
  return buildDocStructureInternal(blocks, opts, 'ast');
}

/**
 * 便捷导出：与旧版 API 兼容
 */
export const buildDocStructure = buildDocStructureFromEditor;

// ==========================================
// 内部实现
// ==========================================

/**
 * 统一的 block 表示
 */
interface UnifiedBlock {
  node: LexicalNode | BlockNode;
  id: string;
  index: number;
  type: string;
  text: string;
}

/**
 * 内部构建函数
 */
function buildDocStructureInternal(
  blocks: UnifiedBlock[],
  options: Required<BuildDocStructureOptions>,
  source: 'lexical' | 'ast'
): DocStructureSnapshot {
  const { debug, docTitleStrategy } = options;
  
  if (debug) {
    console.log(`[DocStructureEngine] Building structure from ${source}, ${blocks.length} blocks`);
  }
  
  // 1. 提取每个 block 的特征
  const features = blocks.map(b => extractBlockFeatures(b, source));
  
  // 2. 计算正文字号（用于标题判定）
  const bodyFontSize = computeBodyFontSize(features);
  
  if (debug) {
    console.log('[DocStructureEngine] Computed body font size:', bodyFontSize);
  }
  
  // 3. 计算 headingScore，找出候选标题
  const scoredFeatures = features.map(f => ({
    ...f,
    headingScore: computeHeadingScore(f, bodyFontSize),
  }));
  
  const headingCandidatesRaw = scoredFeatures.filter(f => f.headingScore >= HEADING_THRESHOLD);
  
  if (debug) {
    console.log('[DocStructureEngine] Heading candidates:', headingCandidatesRaw.length);
    headingCandidatesRaw.forEach(h => {
      console.log(`  - [${h.index}] "${h.text.slice(0, 30)}" score=${h.headingScore}`);
    });
  }
  
  // 4. 归一化标题层级
  const headingCandidates: HeadingCandidate[] = headingCandidatesRaw
    .sort((a, b) => a.index - b.index)
    .map(f => ({
      block: f.block,
      id: f.id,
      index: f.index,
      level: assignLogicalLevel(f, bodyFontSize),
      features: f,
      headingScore: f.headingScore,
    }));
  
  // 5. 构造 Section 树
  const { sections, sectionMap } = buildSectionTree(headingCandidates, blocks.length);
  
  if (debug) {
    console.log('[DocStructureEngine] Built section tree, root sections:', sections.length);
  }
  
  // 6. 填充 ownParagraphBlockIds 和 paragraphRoles
  const paragraphRoles = buildParagraphRoles(
    blocks,
    features,
    sections,
    sectionMap,
    bodyFontSize,
    docTitleStrategy
  );
  
  // 7. 构建元信息
  const docTitleBlockId = Object.entries(paragraphRoles)
    .find(([_, role]) => role === 'doc_title')?.[0];
  
  const totalSections = countTotalSections(sections);
  
  const meta: DocStructureMeta = {
    totalBlocks: blocks.length,
    totalSections,
    docTitleBlockId,
    generatedAt: Date.now(),
    engineVersion: '1.0.0',
  };
  
  if (debug) {
    console.log('[DocStructureEngine] Structure built:', {
      totalBlocks: meta.totalBlocks,
      totalSections: meta.totalSections,
      hasDocTitle: !!docTitleBlockId,
    });
  }
  
  return {
    sections,
    paragraphRoles,
    meta,
  };
}

// ==========================================
// Step 1.2: 提取 Block 特征
// ==========================================

/**
 * 提取单个 block 的特征
 */
function extractBlockFeatures(block: UnifiedBlock, source: 'lexical' | 'ast'): BlockFeatures {
  const { node, id, index, type, text } = block;
  
  // 检测是否为 heading
  let isHeadingStyle = false;
  let headingLevelFromStyle: number | undefined;
  
  if (source === 'lexical') {
    // Lexical AST: 检查节点类型
    isHeadingStyle = type === 'heading';
    if (isHeadingStyle && $isHeadingNode(node as LexicalNode)) {
      const tag = (node as HeadingNode).getTag();
      headingLevelFromStyle = parseInt(tag.replace('h', ''), 10);
    }
  } else {
    // DocumentAst: 检查 block.type
    isHeadingStyle = type === 'heading';
    if (isHeadingStyle && isAstHeading(node as BlockNode)) {
      headingLevelFromStyle = (node as any).level;
    }
  }
  
  // 字号和加粗（AST 中没有直接提供，使用默认值）
  // TODO: 如果未来 AST 支持样式信息，可以在这里提取
  const fontSize = DEFAULT_BODY_FONT_SIZE;
  const isBold = false;
  
  // 文本特征
  const textLength = text.length;
  const isSingleLine = !text.includes('\n') && textLength < 100;
  const startsWithNumbering = /^(第[一二三四五六七八九十\d]+[章节部分]|[0-9]+\.|[一二三四五六七八九十]+、|Chapter\s+\d+|Part\s+\d+)/i.test(text.trim());
  
  // 位置特征
  const isNearTop = index <= 2;
  
  return {
    block: node,
    id,
    index,
    isHeadingStyle,
    headingLevelFromStyle,
    fontSize,
    isBold,
    text,
    textLength,
    isSingleLine,
    startsWithNumbering,
    isNearTop,
  };
}

/**
 * 计算正文字号
 * 
 * 使用 paragraph 类型块的中位数字号作为正文字号
 */
function computeBodyFontSize(features: BlockFeatures[]): number {
  const paragraphFontSizes = features
    .filter(f => !f.isHeadingStyle && f.textLength > 20)
    .map(f => f.fontSize);
  
  if (paragraphFontSizes.length === 0) {
    return DEFAULT_BODY_FONT_SIZE;
  }
  
  // 计算中位数
  const sorted = [...paragraphFontSizes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ==========================================
// Step 1.3: 计算 headingScore
// ==========================================

/**
 * 计算标题得分
 * 
 * 得分越高，越可能是标题
 */
function computeHeadingScore(f: BlockFeatures, bodyFontSize: number): number {
  let score = 0;
  
  // 内置 heading 样式权重最大
  if (f.isHeadingStyle) {
    score += 4;
  }
  
  // 字号明显大于正文
  if (f.fontSize > bodyFontSize + 2) {
    score += 2;
  }
  
  // 加粗
  if (f.isBold) {
    score += 1;
  }
  
  // 单行短文本（更像标题）
  if (f.isSingleLine && f.textLength > 0 && f.textLength < 80) {
    score += 1;
  }
  
  // 以编号开头
  if (f.startsWithNumbering) {
    score += 1;
  }
  
  // 文档顶部的更可能是标题
  if (f.isNearTop && f.isSingleLine) {
    score += 1;
  }
  
  return score;
}

// ==========================================
// Step 1.4: 归一化逻辑层级
// ==========================================

/**
 * 将标题候选分配到逻辑层级 1/2/3
 */
function assignLogicalLevel(f: BlockFeatures & { headingScore: number }, bodyFontSize: number): 1 | 2 | 3 {
  // 优先使用已有的 heading level
  if (f.isHeadingStyle && f.headingLevelFromStyle != null) {
    const lvl = f.headingLevelFromStyle;
    if (lvl >= 1 && lvl <= 3) {
      return lvl as 1 | 2 | 3;
    }
    // H4/H5/H6 降级为 H3
    if (lvl > 3) {
      return 3;
    }
  }
  
  // 否则按字体差值分类
  const delta = f.fontSize - bodyFontSize;
  if (delta >= DOC_TITLE_FONT_SIZE_ADVANTAGE) {
    return 1;
  }
  if (delta >= 2) {
    return 2;
  }
  return 3;
}

// ==========================================
// Step 1.5: 构造 Section 树
// ==========================================

/**
 * 构造 Section 树
 * 
 * 使用栈来维护层级关系
 */
function buildSectionTree(
  headingCandidates: HeadingCandidate[],
  totalBlockCount: number
): {
  sections: SectionNode[];
  sectionMap: Map<string, SectionNode>;
} {
  const sections: SectionNode[] = [];
  const sectionMap = new Map<string, SectionNode>();
  const stack: SectionNode[] = [];
  
  for (const h of headingCandidates) {
    const node: SectionNode = {
      id: `sec-${h.id}`,
      level: h.level,
      titleBlockId: h.id,
      titleText: h.features.text.trim(),
      startBlockIndex: h.index,
      endBlockIndex: totalBlockCount, // 先设为文档结尾，后面修正
      ownParagraphBlockIds: [],
      children: [],
    };
    
    sectionMap.set(h.id, node);
    
    // 维护层级栈：弹出所有 >= 当前层级的节点
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      const top = stack.pop()!;
      // 修正结束位置
      top.endBlockIndex = h.index;
    }
    
    // 找到父节点
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    
    if (parent) {
      parent.children.push(node);
    } else {
      sections.push(node);
    }
    
    stack.push(node);
  }
  
  // 收尾：栈里剩下的 section endBlockIndex 指向文档结尾
  for (const node of stack) {
    node.endBlockIndex = totalBlockCount;
  }
  
  return { sections, sectionMap };
}

// ==========================================
// Step 1.6: 填充 paragraphRoles
// ==========================================

/**
 * 构建段落角色映射
 */
function buildParagraphRoles(
  blocks: UnifiedBlock[],
  features: BlockFeatures[],
  sections: SectionNode[],
  sectionMap: Map<string, SectionNode>,
  _bodyFontSize: number, // 保留用于未来扩展
  docTitleStrategy: BuildDocStructureOptions['docTitleStrategy']
): Record<string, ParagraphRole> {
  const roles: Record<string, ParagraphRole> = {};
  
  // 首先，标记所有章节标题
  for (const [blockId] of sectionMap) {
    roles[blockId] = 'section_title';
  }
  
  // 处理文档主标题
  if (docTitleStrategy === 'first_h1') {
    // 找到第一个 H1
    for (const section of sections) {
      if (section.level === 1) {
        roles[section.titleBlockId] = 'doc_title';
        break;
      }
    }
  } else if (docTitleStrategy === 'largest_heading') {
    // 找到字号最大的标题（在顶部区域）
    const topHeadings = features.filter(f => f.isNearTop && f.isHeadingStyle);
    if (topHeadings.length > 0) {
      const largest = topHeadings.reduce((prev, curr) => 
        curr.fontSize > prev.fontSize ? curr : prev
      );
      roles[largest.id] = 'doc_title';
    }
  }
  
  // 遍历所有 blocks，分配角色
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const feature = features[i];
    
    // 已经是标题的跳过
    if (roles[block.id]) {
      continue;
    }
    
    // 根据 block 类型分配角色
    const type = block.type;
    
    if (type === 'list' || type === 'listitem') {
      roles[block.id] = 'list_item';
      continue;
    }
    
    if (type === 'quote') {
      roles[block.id] = 'quote';
      continue;
    }
    
    // 检测 meta 信息（文档开头的短段落，包含作者/日期等）
    if (feature.isNearTop && feature.isSingleLine) {
      const metaPatterns = [
        /^(作者|Author|By|撰写|编写)[：:\s]/i,
        /^(日期|Date|时间|创建于)[：:\s]/i,
        /^(版本|Version|v\d)/i,
        /^(©|Copyright|版权)/i,
        /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/,
      ];
      
      if (metaPatterns.some(p => p.test(feature.text.trim()))) {
        roles[block.id] = 'meta';
        continue;
      }
    }
    
    // 默认为正文
    roles[block.id] = 'body';
  }
  
  // 填充 sections 的 ownParagraphBlockIds
  fillSectionOwnParagraphs(sections, blocks);
  
  return roles;
}

/**
 * 填充 section 的 ownParagraphBlockIds
 * 
 * 递归处理，确保子 section 的段落不计入父 section 的 own
 */
function fillSectionOwnParagraphs(
  sections: SectionNode[],
  blocks: UnifiedBlock[]
): void {
  // 为每个 section 收集 own paragraphs
  for (const section of flattenSections(sections)) {
    const { startBlockIndex, endBlockIndex, children } = section;
    
    // 计算子 section 覆盖的区间
    const childRanges: Array<{ start: number; end: number }> = children.map(child => ({
      start: child.startBlockIndex,
      end: child.endBlockIndex,
    }));
    
    // 收集 own paragraphs（不在子区间内的）
    for (let i = startBlockIndex + 1; i < endBlockIndex; i++) {
      const inChildRange = childRanges.some(r => i >= r.start && i < r.end);
      if (!inChildRange) {
        section.ownParagraphBlockIds.push(blocks[i].id);
      }
    }
  }
}

/**
 * 扁平化 section 树
 */
function flattenSections(sections: SectionNode[]): SectionNode[] {
  const result: SectionNode[] = [];
  
  function traverse(node: SectionNode) {
    result.push(node);
    for (const child of node.children) {
      traverse(child);
    }
  }
  
  for (const section of sections) {
    traverse(section);
  }
  
  return result;
}

/**
 * 统计总章节数
 */
function countTotalSections(sections: SectionNode[]): number {
  let count = 0;
  
  function traverse(node: SectionNode) {
    count++;
    for (const child of node.children) {
      traverse(child);
    }
  }
  
  for (const section of sections) {
    traverse(section);
  }
  
  return count;
}

// ==========================================
// 辅助查询函数
// ==========================================

/**
 * 从结构快照中查找 section by ID
 */
export function findSectionById(
  snapshot: DocStructureSnapshot,
  sectionId: string
): SectionNode | null {
  // sectionId 可能是 "sec-xxx" 格式或原始 block id
  const normalizedId = sectionId.startsWith('sec-') ? sectionId : `sec-${sectionId}`;
  const blockId = sectionId.startsWith('sec-') ? sectionId.slice(4) : sectionId;
  
  function search(sections: SectionNode[]): SectionNode | null {
    for (const section of sections) {
      if (section.id === normalizedId || section.titleBlockId === blockId) {
        return section;
      }
      const found = search(section.children);
      if (found) return found;
    }
    return null;
  }
  
  return search(snapshot.sections);
}

/**
 * 从结构快照中查找 section by block ID
 */
export function findSectionByBlockId(
  snapshot: DocStructureSnapshot,
  blockId: string
): SectionNode | null {
  function search(sections: SectionNode[]): SectionNode | null {
    for (const section of sections) {
      if (section.titleBlockId === blockId) {
        return section;
      }
      const found = search(section.children);
      if (found) return found;
    }
    return null;
  }
  
  return search(snapshot.sections);
}

/**
 * 获取 block 所属的 section
 */
export function findSectionContainingBlock(
  snapshot: DocStructureSnapshot,
  blockId: string
): SectionNode | null {
  function search(sections: SectionNode[]): SectionNode | null {
    for (const section of sections) {
      // 检查是否在该 section 的 own paragraphs 中
      if (section.ownParagraphBlockIds.includes(blockId)) {
        return section;
      }
      // 检查子 section
      const found = search(section.children);
      if (found) return found;
    }
    return null;
  }
  
  return search(snapshot.sections);
}

/**
 * 获取扁平的大纲列表
 */
export function getOutlineFromSnapshot(
  snapshot: DocStructureSnapshot
): Array<{ sectionId: string; title: string; level: number }> {
  const outline: Array<{ sectionId: string; title: string; level: number }> = [];
  
  function traverse(section: SectionNode) {
    outline.push({
      sectionId: section.titleBlockId,
      title: section.titleText,
      level: section.level,
    });
    for (const child of section.children) {
      traverse(child);
    }
  }
  
  for (const section of snapshot.sections) {
    traverse(section);
  }
  
  return outline;
}

// ==========================================
// DocSkeleton 构建函数
// ==========================================

/**
 * 从 Lexical 编辑器构建文档骨架
 */
export function buildDocSkeletonFromEditor(
  editor: LexicalEditor,
  options?: BuildDocStructureOptions
): DocSkeleton {
  const snapshot = buildDocStructureFromEditor(editor, options);
  return buildDocSkeletonFromSnapshot(snapshot);
}

/**
 * 从 DocumentAst 构建文档骨架
 */
export function buildDocSkeletonFromAst(
  ast: DocumentAst,
  options?: BuildDocStructureOptions
): DocSkeleton {
  const snapshot = buildDocStructureFromAst(ast, options);
  return buildDocSkeletonFromSnapshot(snapshot);
}

/**
 * 从 DocStructureSnapshot 构建文档骨架
 * 
 * 这是核心转换函数，将内部结构映射为 LLM 友好的骨架
 */
export function buildDocSkeletonFromSnapshot(
  snapshot: DocStructureSnapshot
): DocSkeleton {
  // 收集所有章节标题用于语言检测
  const allTitles: string[] = [];
  
  // 计数器
  let chapterCount = 0;
  let sectionCount = 0;
  let totalParagraphs = 0;
  let hasIntro = false;
  let hasConclusion = false;
  
  // 章节索引计数器
  let chapterIndex = 0;
  
  /**
   * 递归转换 SectionNode → DocSectionSkeleton
   */
  function convertToSkeleton(
    node: SectionNode,
    parentId: string | null,
    parentRole: SectionRole | null,
    indexInParent: number
  ): DocSectionSkeleton {
    allTitles.push(node.titleText);
    
    // 1. 确定角色
    const role = determineRole(node, parentRole, node.titleText);
    
    // 2. 更新计数
    if (role === 'chapter') {
      chapterCount++;
      chapterIndex++;
    } else if (role === 'section' || role === 'subsection') {
      sectionCount++;
    }
    
    totalParagraphs += node.ownParagraphBlockIds.length;
    
    // 3. 检测特殊章节
    const lowerTitle = node.titleText.toLowerCase();
    if (isIntroTitle(lowerTitle)) {
      hasIntro = true;
    }
    if (isConclusionTitle(lowerTitle)) {
      hasConclusion = true;
    }
    
    // 4. 生成显示索引
    const displayIndex = generateDisplayIndex(role, node.level, chapterIndex, indexInParent + 1);
    
    // 5. 递归处理子章节
    const children: DocSectionSkeleton[] = node.children.map((child, i) =>
      convertToSkeleton(child, node.id, role, i)
    );
    
    return {
      id: node.id,
      title: node.titleText,
      displayIndex,
      role,
      level: node.level,
      parentId,
      children,
      startBlockIndex: node.startBlockIndex,
      endBlockIndex: node.endBlockIndex,
      paragraphCount: node.ownParagraphBlockIds.length,
    };
  }
  
  // 转换所有顶级章节
  const sections: DocSectionSkeleton[] = snapshot.sections.map((section, i) =>
    convertToSkeleton(section, null, null, i)
  );
  
  // 检测语言
  const languageHint = detectLanguage(allTitles);
  
  // 计算总章节数
  const totalSections = chapterCount + sectionCount;
  
  return {
    sections,
    meta: {
      chapterCount,
      sectionCount,
      hasIntro,
      hasConclusion,
      languageHint,
      totalSections,
      totalParagraphs,
    },
  };
}

/**
 * 确定章节角色
 */
function determineRole(
  node: SectionNode,
  parentRole: SectionRole | null,
  title: string
): SectionRole {
  const lowerTitle = title.toLowerCase();
  
  // 检测附录
  if (isAppendixTitle(lowerTitle)) {
    return 'appendix';
  }
  
  // 检测元信息
  if (isMetaTitle(lowerTitle)) {
    return 'meta';
  }
  
  // 基于层级和父级角色决定
  if (node.level === 1) {
    return 'chapter';
  }
  
  if (node.level === 2) {
    // 如果父级是 null（顶级），则是 chapter
    // 如果父级是 chapter，则是 section
    if (parentRole === null) {
      return 'chapter';
    }
    return 'section';
  }
  
  // level === 3
  return 'subsection';
}

/**
 * 生成人类友好的显示索引
 */
function generateDisplayIndex(
  role: SectionRole,
  _level: number,
  chapterIndex: number,
  indexInParent: number
): string | undefined {
  if (role === 'chapter') {
    return `第${chapterIndex}章`;
  }
  
  if (role === 'section') {
    return `${chapterIndex}.${indexInParent}`;
  }
  
  if (role === 'subsection') {
    return `${indexInParent}`;
  }
  
  return undefined;
}

/**
 * 检测标题是否为绪论/概述
 */
function isIntroTitle(lowerTitle: string): boolean {
  const introKeywords = [
    'overview', 'introduction', 'intro', 'preface',
    '概述', '简介', '导言', '前言', '绪论', '概要'
  ];
  return introKeywords.some(kw => lowerTitle.includes(kw));
}

/**
 * 检测标题是否为结论/总结
 */
function isConclusionTitle(lowerTitle: string): boolean {
  const conclusionKeywords = [
    'conclusion', 'summary', 'closing', 'final',
    '结论', '总结', '结语', '结尾', '小结'
  ];
  return conclusionKeywords.some(kw => lowerTitle.includes(kw));
}

/**
 * 检测标题是否为附录
 */
function isAppendixTitle(lowerTitle: string): boolean {
  const appendixKeywords = [
    'appendix', 'attachment', 'annex',
    '附录', '附件', '附表'
  ];
  return appendixKeywords.some(kw => lowerTitle.includes(kw));
}

/**
 * 检测标题是否为元信息
 */
function isMetaTitle(lowerTitle: string): boolean {
  const metaKeywords = [
    'version history', 'revision', 'changelog', 'references', 'bibliography',
    '版本历史', '修订记录', '变更记录', '参考文献', '引用'
  ];
  return metaKeywords.some(kw => lowerTitle.includes(kw));
}

/**
 * 基于标题检测文档语言
 */
function detectLanguage(titles: string[]): 'zh' | 'en' | 'mixed' | 'other' {
  if (titles.length === 0) return 'other';
  
  let zhCount = 0;
  let enCount = 0;
  
  for (const title of titles) {
    // 统计中文字符
    const zhChars = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
    // 统计英文字符
    const enChars = (title.match(/[a-zA-Z]/g) || []).length;
    
    if (zhChars > enChars) {
      zhCount++;
    } else if (enChars > zhChars) {
      enCount++;
    }
  }
  
  const total = titles.length;
  const zhRatio = zhCount / total;
  const enRatio = enCount / total;
  
  if (zhRatio > 0.7) return 'zh';
  if (enRatio > 0.7) return 'en';
  if (zhRatio > 0.3 && enRatio > 0.3) return 'mixed';
  
  return 'other';
}

/**
 * 从 DocSkeleton 获取扁平的章节列表
 */
export function flattenDocSkeleton(
  skeleton: DocSkeleton
): DocSectionSkeleton[] {
  const result: DocSectionSkeleton[] = [];
  
  function traverse(section: DocSectionSkeleton) {
    result.push(section);
    for (const child of section.children) {
      traverse(child);
    }
  }
  
  for (const section of skeleton.sections) {
    traverse(section);
  }
  
  return result;
}

/**
 * 在 DocSkeleton 中查找章节 by ID
 */
export function findSkeletonSectionById(
  skeleton: DocSkeleton,
  sectionId: string
): DocSectionSkeleton | null {
  function search(sections: DocSectionSkeleton[]): DocSectionSkeleton | null {
    for (const section of sections) {
      if (section.id === sectionId) {
        return section;
      }
      const found = search(section.children);
      if (found) return found;
    }
    return null;
  }
  
  return search(skeleton.sections);
}

/**
 * 在 DocSkeleton 中查找章节 by 标题（模糊匹配）
 */
export function findSkeletonSectionByTitle(
  skeleton: DocSkeleton,
  titleQuery: string,
  exactMatch: boolean = false
): DocSectionSkeleton | null {
  const normalizedQuery = titleQuery.toLowerCase().trim();
  
  function search(sections: DocSectionSkeleton[]): DocSectionSkeleton | null {
    for (const section of sections) {
      const normalizedTitle = section.title.toLowerCase().trim();
      
      if (exactMatch) {
        if (normalizedTitle === normalizedQuery) {
          return section;
        }
      } else {
        // 模糊匹配：包含查询字符串
        if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
          return section;
        }
      }
      
      const found = search(section.children);
      if (found) return found;
    }
    return null;
  }
  
  return search(skeleton.sections);
}

/**
 * 在 DocSkeleton 中按索引查找章节
 * 
 * @param skeleton - 文档骨架
 * @param index - 1-based 索引（如"第1章"对应 index=1）
 * @param role - 过滤的角色（如只查找 'chapter'）
 */
export function findSkeletonSectionByIndex(
  skeleton: DocSkeleton,
  index: number,
  role?: SectionRole
): DocSectionSkeleton | null {
  const flatList = flattenDocSkeleton(skeleton);
  
  let count = 0;
  for (const section of flatList) {
    if (role && section.role !== role) {
      continue;
    }
    count++;
    if (count === index) {
      return section;
    }
  }
  
  return null;
}

