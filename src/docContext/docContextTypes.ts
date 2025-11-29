/**
 * DocContext 类型定义
 * 
 * 【职责】
 * - 定义文档上下文的结构化类型
 * - 为 Copilot / DocAgent 提供统一的上下文快照格式
 * 
 * 【设计】
 * - DocContextEnvelope：三层上下文结构（focus / neighborhood / global）
 * - focus：高分辨率焦点（当前选区/章节）
 * - neighborhood：邻域上下文（前后章节摘要）
 * - global：全局信息（文档标题/大纲）
 */

// ==========================================
// 基础类型
// ==========================================

/**
 * 文档作用范围
 */
export type DocScope = 'selection' | 'section' | 'document';

/**
 * 大纲项（精简版，用于 Envelope）
 */
export interface OutlineEntry {
  /** 章节 ID（对应 Lexical node key） */
  sectionId: string;
  /** 章节标题 */
  title: string;
  /** 层级（1=H1, 2=H2, 3=H3） */
  level: number;
  /** 章节摘要（可选，v2 才会填充） */
  summary?: string;
}

/**
 * 邻域章节信息
 */
export interface NeighborSection {
  /** 章节 ID */
  sectionId: string;
  /** 章节标题 */
  title: string;
  /** 层级 */
  level?: number;
  /** 章节摘要（v1 暂不填） */
  summary?: string;
}

/**
 * 章节预览（用于 document scope）
 * 
 * 提供每个章节的简短预览，帮助 LLM 理解文档内容
 */
export interface SectionPreview {
  /** 章节 ID */
  sectionId: string;
  /** 章节标题 */
  title: string;
  /** 层级（1=H1, 2=H2, 3=H3） */
  level: number;
  /** 章节内容片段（前 N 字符） */
  snippet: string;
  /** 章节总字符数 */
  charCount: number;
}

// ==========================================
// DocContextEnvelope（核心类型）
// ==========================================

/**
 * Focus 焦点信息
 * 
 * 当前用户聚焦的内容（高分辨率）
 */
export interface FocusContext {
  /** 章节 ID（scope=section/selection 时有值） */
  sectionId: string | null;
  /** 章节标题 */
  sectionTitle: string | null;
  /** 当前焦点的纯文本内容（整个 section 或选区） */
  text: string;
  /** 字符数 */
  charCount: number;
  /** 估算 token 数（简单用 charCount / 3） */
  approxTokenCount: number;
  /** 选区片段（scope=selection 时使用） */
  selectionSnippet?: string;
}

/**
 * Neighborhood 邻域信息
 * 
 * 当前焦点的上下文（前后章节、同级章节）
 * v1 先占位，不填内容
 */
export interface NeighborhoodContext {
  /** 前一个章节 */
  previousSection?: NeighborSection;
  /** 后一个章节 */
  nextSection?: NeighborSection;
  /** 同级章节列表 */
  siblings?: NeighborSection[];
}

/**
 * Global 全局信息
 * 
 * 整个文档的概览信息
 */
export interface GlobalContext {
  /** 文档标题（通常是第一个 H1 或文件名） */
  title: string | null;
  /** 文档摘要（v1 暂不填） */
  docSummary?: string;
  /** 完整大纲 */
  outline: OutlineEntry[];
  /** 文档总字符数（scope=document 时填充） */
  totalCharCount?: number;
  /** 估算总 token 数（scope=document 时填充） */
  approxTotalTokenCount?: number;
  /** 各章节预览（scope=document 时填充） */
  sectionsPreview?: SectionPreview[];
}

/**
 * Budget 预算信息
 * 
 * Token 预算控制
 */
export interface BudgetInfo {
  /** 最大 token 数（输入参数） */
  maxTokens: number;
  /** 估算的当前 token 数 */
  estimatedTokens: number;
}

/**
 * 元信息
 */
export interface EnvelopeMeta {
  /** 生成时间戳 */
  generatedAt: number;
  /** 生成器版本 */
  generatorVersion: string;
}

/**
 * DocContextEnvelope - 文档上下文信封
 * 
 * 这是传递给 LLM 的统一上下文格式。
 * 包含三层信息：focus（焦点）/ neighborhood（邻域）/ global（全局）
 */
export interface DocContextEnvelope {
  /** 文档 ID */
  docId: string | null;
  /** 作用范围 */
  scope: DocScope;
  /** 高分辨率焦点 */
  focus: FocusContext;
  /** 邻域上下文（v1 先占位） */
  neighborhood: NeighborhoodContext;
  /** 全局信息 */
  global: GlobalContext;
  /** Token 预算 */
  budget: BudgetInfo;
  /** 元信息 */
  meta?: EnvelopeMeta;
}

// ==========================================
// 构建参数
// ==========================================

/**
 * 构建 DocContextEnvelope 的参数
 */
export interface BuildContextOptions {
  /** 文档 ID */
  docId: string;
  /** 作用范围 */
  scope: DocScope;
  /** 章节 ID（scope=section 时必须） */
  sectionId?: string;
  /** 选区范围（scope=selection 时使用，暂用 unknown 占位） */
  selectionRange?: unknown;
  /** 最大 token 数 */
  maxTokens: number;
}

// ==========================================
// 错误类型
// ==========================================

/**
 * DocContext 构建错误
 */
export class DocContextError extends Error {
  constructor(message: string) {
    super(`[DocContextEngine] ${message}`);
    this.name = 'DocContextError';
  }
}

