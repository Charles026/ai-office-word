/**
 * Section Context 类型定义
 * 
 * 用于 DocAgentRuntime 中"重写 / 总结 / 扩写 Section"等能力的数据输入。
 * 
 * 【核心概念】
 * - ownParagraphs: 当前标题"直属"的段落（从标题后到第一个子标题之前）
 * - subtreeParagraphs: 当前标题整个子树的所有段落（包含子 H3 的内容）
 * - childSections: 子 section 的元信息（用于上下文，不做写入）
 */

// ==========================================
// 基础类型
// ==========================================

/**
 * 段落样式信息（简化版）
 */
export interface ParagraphStyle {
  /** 是否加粗 */
  bold?: boolean;
  /** 是否斜体 */
  italic?: boolean;
  /** 是否下划线 */
  underline?: boolean;
  /** 字号 */
  fontSize?: number;
  /** 字体 */
  fontFamily?: string;
  /** 文本对齐 */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  // TODO: 扩展更多样式字段
}

/**
 * 段落信息（ParagraphContext）
 * 
 * 用于表示 section 中的一个段落/内容节点
 */
export interface ParagraphInfo {
  /** 段落节点的 key */
  nodeKey: string;
  /** 段落纯文本 */
  text: string;
  /** 在 AST 中的位置路径 */
  nodePath: string[];
  /** 节点类型（paragraph, listitem, quote, code 等） */
  nodeType: string;
  /** 简化后的 style 信息 */
  style?: ParagraphStyle;
}

/** ParagraphContext 别名，与 ParagraphInfo 相同 */
export type ParagraphContext = ParagraphInfo;

/**
 * Section 层级
 */
export type SectionLevel = 1 | 2 | 3;

// ==========================================
// 子 Section 元信息
// ==========================================

/**
 * 子 Section 元信息
 * 
 * 用于描述 H2 下的 H3 子章节信息（只读，不做写入）
 */
export interface ChildSectionMeta {
  /** 子 section 的 ID（节点 key） */
  sectionId: string;
  /** 层级（通常是 3 = H3） */
  level: SectionLevel;
  /** 子 section 标题文本 */
  titleText: string;
  /** 在全局 blockNodes 中的起始 index（标题自身） */
  startIndex: number;
  /** 该子 section 的结束 index */
  endIndex: number;
  /** 直属段落数量（不含子 section） */
  ownParagraphCount: number;
  /** 包含其子树所有段落数量 */
  totalParagraphCount: number;
}

// ==========================================
// SectionContext 主类型
// ==========================================

/**
 * Section 上下文
 * 
 * 从 Document AST 中抽取的一个 section（H2 或 H3）的完整结构化上下文。
 * 用于 DocAgentRuntime 中的 AI 操作。
 * 
 * 【双层结构】
 * - ownParagraphs: 直属段落（导语部分）
 * - subtreeParagraphs: 整个子树的所有段落（包含子 H3）
 * 
 * 【向后兼容】
 * - paragraphs 等同于 ownParagraphs，确保旧代码正常工作
 */
export interface SectionContext {
  /** 当前 section 的唯一 ID（来自 AST NodeKey） */
  sectionId: string;
  
  /** 该 section 的标题文本（H2/H3） */
  titleText: string;
  
  /** 标题节点在 AST 中的 path */
  titleNodePath: string[];
  
  /** section 层级（2 = H2, 3 = H3） */
  level: SectionLevel;
  
  // ========== 双层段落结构 ==========
  
  /**
   * 当前标题直属段落（own）
   * 
   * 从标题后第一段到第一个子标题之前的所有段落。
   * 对于 H2，这是"导语"部分；对于 H3，通常等于 subtreeParagraphs。
   */
  ownParagraphs: ParagraphInfo[];
  
  /**
   * 整棵子树的所有段落（subtree）
   * 
   * 包含 ownParagraphs 且顺序一致。
   * 对于 H2，包含所有 H3 子章节的正文（线性展开）。
   * 对于 H3，通常等于 ownParagraphs。
   */
  subtreeParagraphs: ParagraphInfo[];
  
  /**
   * 子 section 元信息（只用于上下文，不做写入）
   * 
   * 对于 H2，包含其下所有 H3 的元信息。
   * 对于 H3，通常为空数组。
   */
  childSections: ChildSectionMeta[];
  
  // ========== 向后兼容字段 ==========
  
  /**
   * 该 section 下的所有段落
   * 
   * @deprecated 请使用 ownParagraphs 或 subtreeParagraphs
   * 
   * 为向后兼容保留，等同于 ownParagraphs
   */
  paragraphs: ParagraphInfo[];
  
  // ========== 位置信息 ==========
  
  /** 该 section 在全文所有 blockNodes 中的起始 index（标题自身） */
  startIndex: number;
  
  /** 该 section 子树的最后一个 block 的 index */
  endIndex: number;
  
  /** 参与 section 的原始 AST 节点列表（可选，调试用） */
  rawBlocks?: unknown[];
  
  /** 元信息 */
  meta?: SectionContextMeta;
}

/**
 * Section 上下文元信息
 */
export interface SectionContextMeta {
  /** 直属段落数（ownParagraphs.length） */
  paragraphCount: number;
  /** 子树总段落数（subtreeParagraphs.length） */
  subtreeParagraphCount: number;
  /** 子 section 数量 */
  childSectionCount: number;
  /** 总字符数（subtree） */
  totalCharCount: number;
  /** 提取时间戳 */
  extractedAt: number;
}

// ==========================================
// 错误类型
// ==========================================

/**
 * Section 上下文提取错误
 */
export class SectionContextError extends Error {
  constructor(
    message: string,
    public readonly sectionId: string,
    public readonly code: SectionContextErrorCode
  ) {
    super(message);
    this.name = 'SectionContextError';
  }
}

/**
 * 错误代码
 */
export type SectionContextErrorCode =
  | 'SECTION_NOT_FOUND'
  | 'NOT_A_HEADING'
  | 'INVALID_HEADING_LEVEL'
  | 'AST_ACCESS_ERROR';

