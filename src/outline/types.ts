/**
 * Outline 类型定义
 * 
 * 定义大纲视图相关的类型。
 */

// ==========================================
// 基础类型
// ==========================================

/** 标题级别 */
export type HeadingLevel = 1 | 2 | 3;

/** 大纲项 */
export interface OutlineItem {
  /** 对应文档内部的 block/paragraph id (Lexical node key) */
  id: string;
  /** 标题级别 */
  level: HeadingLevel;
  /** 标题内容（纯文本） */
  text: string;
  /** 在文档中的顺序（从 0 开始） */
  position: number;
  /** 子项（用于树形展示） */
  children?: OutlineItem[];
}

/** 章节范围 */
export interface SectionRange {
  /** 起始段落 ID（包含，即标题本身） */
  startId: string;
  /** 结束段落 ID（不包含，即下一章节的标题或文档末尾） */
  endId: string | null;
  /** 起始位置（段落索引） */
  startIndex: number;
  /** 结束位置（段落索引，不包含） */
  endIndex: number;
  /** 包含的段落 ID 列表 */
  paragraphIds: string[];
}

/** 章节内容 */
export interface SectionContent {
  /** 标题 */
  heading: OutlineItem;
  /** 章节范围 */
  range: SectionRange;
  /** 章节纯文本内容（不含标题） */
  plainText: string;
  /** 章节 HTML 内容（不含标题） */
  htmlContent?: string;
}

// ==========================================
// 章节级 AI 意图
// ==========================================

/** 章节级 AI 操作类型 */
export type SectionIntentType = 
  | 'rewriteSection'
  | 'summarizeSection'
  | 'translateSection'
  | 'refineSection'
  | 'expandSection';

/** 章节级 AI 意图 */
export interface SectionIntent {
  type: SectionIntentType;
  /** 要操作的 heading 段落 id */
  sectionHeadingId: string;
  /** 用户的附加说明 */
  userPrompt?: string;
  /** 翻译目标语言（仅 translateSection） */
  targetLang?: 'en' | 'zh';
  /** 改写风格（仅 rewriteSection） */
  tone?: 'formal' | 'concise' | 'friendly';
}

/** 章节级 AI 响应 */
export interface SectionAgentResponse {
  success: boolean;
  /** 生成的新内容 */
  newContent?: string;
  /** 错误信息 */
  error?: string;
  /** 延迟（毫秒） */
  latencyMs?: number;
}

// ==========================================
// Outline 状态
// ==========================================

/** Outline 状态 */
export interface OutlineState {
  /** 所有大纲项（扁平列表） */
  items: OutlineItem[];
  /** 当前高亮的项 ID */
  activeItemId: string | null;
  /** 折叠状态（key: item id, value: 是否折叠） */
  collapsedItems: Record<string, boolean>;
  /** 是否正在加载 */
  loading: boolean;
}

/** 初始 Outline 状态 */
export const initialOutlineState: OutlineState = {
  items: [],
  activeItemId: null,
  collapsedItems: {},
  loading: false,
};

