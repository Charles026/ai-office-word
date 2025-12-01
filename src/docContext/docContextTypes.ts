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
 * 
 * @version 2.0.0 - 新增结构置信度和标题来源追踪
 */

// ==========================================
// 基础类型
// ==========================================

/**
 * 文档作用范围
 */
export type DocScope = 'selection' | 'section' | 'document';

// ==========================================
// v2: 结构识别置信度类型
// ==========================================

/**
 * 文档标题来源
 * 
 * 标识文档标题是如何被识别出来的
 * 
 * @tag structure-v2
 */
export type DocTitleSource =
  | 'explicit_meta'    // 来自显式的元数据字段（如文档属性）
  | 'heading'          // 来自 Heading 节点（H1/H2）
  | 'style_inferred'   // 通过样式推断（字号、加粗、居中等）
  | 'filename'         // 从文件名推断
  | 'none';            // 无法识别

/**
 * 置信度等级
 * 
 * 用于表达结构识别的可靠程度
 * 
 * @tag structure-v2
 */
export type Confidence = 'high' | 'medium' | 'low';

/**
 * 章节来源
 * 
 * 标识章节是如何被识别出来的
 * 
 * @tag structure-v2
 */
export type ChapterSource =
  | 'heading'          // 来自 Heading 节点
  | 'style_inferred'   // 通过样式推断
  | 'mixed';           // 混合来源（有 Heading 节点，但样式也参与判定）

/**
 * 标题候选项
 * 
 * 在识别文档标题时，系统会生成多个候选，最终选择最佳者
 * 保留候选列表用于调试和用户确认
 * 
 * @tag structure-v2
 */
export interface TitleCandidate {
  /** 标题文本 */
  text: string;
  /** 来源类型 */
  source: DocTitleSource;
  /** 置信度 */
  confidence: Confidence;
  /** 在文档中的位置索引（段落序号） */
  positionIndex: number;
  /** 识别原因（用于调试和解释） */
  reasons: string[];
  /** 综合得分（内部使用） */
  score?: number;
}

/**
 * Document Scope 模式 (v1.2)
 * 
 * - 'full': 全文模式，documentFullText 包含完整文档内容
 * - 'chunked': 分块模式，只提供结构预览和章节片段
 * 
 * 决策逻辑：当文档 token 数 < FULL_DOC_TOKEN_THRESHOLD 时使用 'full'
 */
export type DocScopeMode = 'full' | 'chunked';

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
// 结构真相类型 (structure-stats-sot v1)
// ==========================================

/**
 * 章节信息
 * 
 * 与 DocStructureEngine 的 SectionNode 对齐，但更精简。
 * 这是"有几章/第几章"类问题的唯一数据来源。
 * 
 * @tag structure-stats-sot
 * @tag structure-v2 - 新增 source/confidence/headingLevel/styleScore
 */
export interface ChapterInfo {
  /** 章节 ID（对应 DocStructureEngine 的 section.id） */
  id: string;
  /** 层级（1=H1/章, 2=H2/节, 3=H3/小节） */
  level: 1 | 2 | 3;
  /** 标题纯文本 */
  titleText: string;
  /** 在 blocks 中的起始索引 */
  startIndex: number;
  /** 在 blocks 中的结束索引（左闭右开） */
  endIndex: number;
  /** 子章节数量（直接子节点，不含孙子） */
  childCount: number;
  /** 直属段落数量（不含子章节的段落） */
  paragraphCount: number;
  /** 语义角色（从 DocSkeleton 获取） */
  role?: 'chapter' | 'section' | 'subsection' | 'appendix' | 'meta';
  
  // ========== v2: 结构识别追踪 ==========
  
  /**
   * 章节来源
   * 
   * 标识这个章节是如何被识别出来的：
   * - 'heading': 来自 Heading 节点（可靠）
   * - 'style_inferred': 通过样式推断（可能不准）
   * - 'mixed': 混合来源
   */
  source?: ChapterSource;
  
  /**
   * 识别置信度
   * 
   * - 'high': 有明确的 Heading 节点 + 样式一致
   * - 'medium': 有 Heading 但样式不典型，或样式推断但信号较强
   * - 'low': 纯样式推断且信号较弱
   */
  confidence?: Confidence;
  
  /**
   * 原始 Heading 层级
   * 
   * 如果来自 HeadingNode，记录原始的 h1-h6 层级。
   * 如果是 style_inferred，为 null。
   */
  headingLevel?: number | null;
  
  /**
   * 样式得分
   * 
   * 基于字号、加粗、对齐等样式特征计算的综合得分。
   * 用于辅助判断和调试。
   */
  styleScore?: number | null;
}

/**
 * 文档结构真相
 * 
 * 所有章节/节的计数和定位，都必须从这里获取。
 * LLM 禁止自行推断结构，必须使用这些字段。
 * 
 * @tag structure-stats-sot
 * @tag structure-v2 - 新增 globalConfidence/baseBodyFontSize
 */
export interface DocStructure {
  /** 章级别（level=1 或 role=chapter）的章节列表 */
  chapters: ChapterInfo[];
  /** 所有章节的扁平列表（包含所有层级） */
  allSections: ChapterInfo[];
  /** 顶层章节数量（level=1） */
  chapterCount: number;
  /** 所有章节总数（含子章节） */
  totalSectionCount: number;
  
  // ========== v2: 结构识别追踪 ==========
  
  /**
   * 全局置信度
   * 
   * 基于所有章节的 confidence 分布计算：
   * - 'high': 所有章节都是 high/medium confidence
   * - 'medium': 存在部分 style_inferred 且 low confidence 的章节
   * - 'low': 大部分章节为 low confidence 或结构不明确
   * 
   * 当 globalConfidence='low' 时，structuralQueryResolver 应返回澄清而非确定答案。
   */
  globalConfidence?: Confidence;
  
  /**
   * 基准正文字号
   * 
   * 通过分析文档中非标题段落的字号分布（取中位数）得出。
   * 用于判断某段落的字号是否"显著大于正文"。
   */
  baseBodyFontSize?: number | null;
}

/**
 * 文档统计信息
 * 
 * 所有数字统计必须从这里获取。
 * LLM 禁止估算或猜测任何数字。
 * 
 * @tag structure-stats-sot
 */
export interface DocStats {
  /** 总字符数（中文 + 英文 + 标点） */
  charCount: number;
  /** 总字数（中文按字，英文按词粗略估算） */
  wordCount: number;
  /** Token 估算（使用 estimateTokensForText） */
  tokenEstimate: number;
  /** 段落数量 */
  paragraphCount: number;
}

/**
 * 文档元信息
 * 
 * 文档级别的标识信息，与章节标题严格区分。
 * 
 * @tag structure-stats-sot
 * @tag structure-v2 - 新增 titleSource/titleConfidence/candidates
 */
export interface DocMeta {
  /** 
   * 文档标题
   * 
   * 优先级：
   * 1. 显式元数据（explicit_meta）
   * 2. 高置信度的 Heading 节点
   * 3. 高置信度的样式推断
   * 4. 文件名
   * 5. null（明确表示没有文档标题）
   * 
   * 注意：这与"章节标题"是不同的概念！
   */
  title: string | null;
  /** 文档来源（如果有） */
  source?: string;
  /** 文件名（不含路径） */
  filename?: string | null;
  /** 是否有显式的文档标题 */
  hasExplicitTitle: boolean;
  
  // ========== v2: 标题识别追踪 ==========
  
  /**
   * 标题来源
   * 
   * 标识当前 title 是如何被识别出来的
   */
  titleSource?: DocTitleSource;
  
  /**
   * 标题置信度
   * 
   * - 'high': 来自 explicit_meta 或明确的 H1 + 样式一致
   * - 'medium': 来自 Heading 但位置/样式不典型，或样式推断但信号较强
   * - 'low': 纯样式推断且信号较弱，或来自文件名
   */
  titleConfidence?: Confidence;
  
  /**
   * 标题候选列表
   * 
   * 保留所有可能的标题候选，用于：
   * - 调试和分析
   * - 低置信度时让用户确认
   * - 提供备选项
   */
  candidates?: TitleCandidate[];
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
 * 
 * @tag structure-stats-sot v1.5: 新增 structure / stats / meta
 */
export interface GlobalContext {
  /** 文档标题（通常是第一个 H1 或文件名）@deprecated 使用 meta.title */
  title: string | null;
  /** 文档摘要（v1 暂不填） */
  docSummary?: string;
  /** 完整大纲 */
  outline: OutlineEntry[];
  /** 文档总字符数（scope=document 时填充）@deprecated 使用 stats.charCount */
  totalCharCount?: number;
  /** 估算总 token 数（scope=document 时填充）@deprecated 使用 stats.tokenEstimate */
  approxTotalTokenCount?: number;
  /** 各章节预览（scope=document 时填充） */
  sectionsPreview?: SectionPreview[];
  
  // ========== structure-stats-sot v1.5 新增 ==========
  
  /**
   * 文档结构真相
   * 
   * 这是所有"有几章/第几章"类问题的唯一数据来源。
   * LLM 禁止自行推断结构。
   */
  structure?: DocStructure;
  
  /**
   * 文档统计信息
   * 
   * 这是所有"有多少字/多少 token"类问题的唯一数据来源。
   * LLM 禁止估算或猜测任何数字。
   */
  stats?: DocStats;
  
  /**
   * 文档元信息
   * 
   * 包含文档标题等标识信息。
   * 注意：meta.title 与章节标题是不同的概念！
   */
  docMeta?: DocMeta;
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
 * 
 * v1.2 新增：
 * - mode: 'full' | 'chunked' - Document scope 的工作模式
 * - documentFullText: Full 模式下的完整文档文本
 * - documentTokenEstimate: 文档 token 估算（用于调试和分流决策）
 * 
 * v1.3 新增：
 * - skeleton: DocSkeleton - 始终附带的结构化骨架（LLM 友好）
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
  
  // ========== v1.2 新增：Full-Doc 模式支持 ==========
  
  /**
   * Document scope 的工作模式
   * 
   * - 'full': 全文模式，documentFullText 包含完整文档内容
   * - 'chunked': 分块模式，只提供结构预览和章节片段
   * 
   * 仅当 scope='document' 时有效，其他 scope 为 undefined
   */
  mode?: DocScopeMode;
  
  /**
   * 完整文档文本
   * 
   * 仅当 scope='document' && mode='full' 时填充。
   * 包含所有段落的文本，段落间用双换行分隔。
   */
  documentFullText?: string;
  
  /**
   * 文档 token 估算
   * 
   * 用于调试、telemetry 和分流决策。
   * 使用 estimateTokensForText() 计算。
   */
  documentTokenEstimate?: number;
  
  // ========== v1.3 新增：DocSkeleton 结构化骨架 ==========
  
  /**
   * 文档结构骨架
   * 
   * 始终从 DocStructureEngine 生成，为 LLM 提供：
   * - 统一的章节结构树
   * - 语义化的章节角色（chapter/section/subsection）
   * - 预计算的统计信息（chapterCount、hasIntro 等）
   * 
   * 这是 LLM 理解文档结构的权威来源。
   */
  skeleton?: import('../document/structure').DocSkeleton;
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

