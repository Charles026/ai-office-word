/**
 * 结构查询解析器
 * 
 * 【职责】
 * - 从用户自然语言中识别结构查询意图
 * - 将中文问法映射到结构术语（章/节/段）
 * - 提供置信度评估，低置信度时需要澄清
 * 
 * 【设计原则】
 * - 纯规则化，不使用 LLM
 * - 所有结构信息来自 DocContextEnvelope
 * - 不确定时返回 low confidence，让 Copilot 走澄清路径
 * 
 * @tag structure-stats-sot v1.5
 */

import type { DocContextEnvelope, DocStructure, ChapterInfo } from '../docContext/docContextTypes';

// ==========================================
// 类型定义
// ==========================================

/**
 * 结构查询类型
 */
export type StructuralQueryKind = 
  | 'chapter_count'      // "有几章"
  | 'section_count'      // "有几节/小节"
  | 'paragraph_count'    // "有几段"
  | 'word_count'         // "有多少字"
  | 'char_count'         // "有多少字符"
  | 'token_count'        // "有多少 token"
  | 'title_query'        // "文章标题是什么"
  | 'chapter_title'      // "第 N 章的标题"
  | 'section_title'      // "第 N 节的标题"
  | 'locate_chapter'     // "第一章在哪"
  | 'locate_section'     // "第一节在哪"
  | 'other';             // 非结构查询

/**
 * 目标层级
 */
export type TargetLevel = 'chapter' | 'section' | 'paragraph';

/**
 * 结构查询解析结果
 */
export interface StructuralQueryResolution {
  /** 查询类型 */
  kind: StructuralQueryKind;
  /** 目标层级（章/节/段） */
  targetLevel?: TargetLevel;
  /** 章索引（1-based） */
  chapterIndex?: number;
  /** 节索引（1-based，在当前章内） */
  sectionIndex?: number;
  /** 段落索引（1-based） */
  paragraphIndex?: number;
  /** 置信度 */
  confidence: 'high' | 'low';
  /** 需要澄清时的问题 */
  clarificationQuestion?: string;
  /** 直接回答（如果可以从 structure/stats 获取） */
  directAnswer?: string;
  /** 调试信息 */
  debugInfo?: string;
}

// ==========================================
// 模式匹配正则
// ==========================================

/** 章数量查询 */
const CHAPTER_COUNT_PATTERNS = [
  /有\s*(几|多少)\s*(章|大章|部分)/,
  /一共\s*(几|多少)\s*(章|大章|部分)/,
  /总共\s*(几|多少)\s*(章|大章|部分)/,
  /(章|大章|部分)\s*数量/,
  /how\s*many\s*chapters?/i,
];

/** 节/小节数量查询 */
const SECTION_COUNT_PATTERNS = [
  /有\s*(几|多少)\s*(节|小节|子章节)/,
  /一共\s*(几|多少)\s*(节|小节|子章节)/,
  /总共\s*(几|多少)\s*(节|小节|子章节)/,
  /(节|小节|子章节)\s*数量/,
  /how\s*many\s*sections?/i,
];

/** 段落数量查询 */
const PARAGRAPH_COUNT_PATTERNS = [
  /有\s*(几|多少)\s*(段|段落)/,
  /一共\s*(几|多少)\s*(段|段落)/,
  /总共\s*(几|多少)\s*(段|段落)/,
  /(段|段落)\s*数量/,
  /how\s*many\s*paragraphs?/i,
];

/** 字数查询 */
const WORD_COUNT_PATTERNS = [
  /有\s*(几|多少)\s*(字|个字)/,
  /一共\s*(几|多少)\s*(字|个字)/,
  /字数/,
  /多少\s*字/,
  /word\s*count/i,
  /how\s*many\s*words?/i,
];

/** 字符数查询 */
const CHAR_COUNT_PATTERNS = [
  /有\s*(几|多少)\s*字符/,
  /字符数/,
  /character\s*count/i,
];

/** Token 数查询 */
const TOKEN_COUNT_PATTERNS = [
  /有\s*(几|多少)\s*token/i,
  /token\s*(数|数量|count)/i,
  /how\s*many\s*tokens?/i,
];

/** 文档标题查询 */
const TITLE_QUERY_PATTERNS = [
  /(文章|文档|文本)\s*(标题|题目|名字|叫什么)/,
  /标题是\s*(什么|啥)/,
  /题目是\s*(什么|啥)/,
  /what.*(title|name)/i,
];

/** 第 N 章/节模式 */
const NTH_CHAPTER_PATTERN = /第\s*([一二三四五六七八九十\d]+)\s*(章|大章|部分)/;
const NTH_SECTION_PATTERN = /第\s*([一二三四五六七八九十\d]+)\s*(节|小节|子章节)/;
const NTH_PARAGRAPH_PATTERN = /第\s*([一二三四五六七八九十\d]+)\s*(段|段落)/;

/**
 * 编辑意图关键词
 * 
 * 如果用户文本包含这些词，应该跳过结构查询匹配，让 LLM 解析为编辑意图
 * 这样 "帮我重写第一章" 不会被误识别为 locate_chapter
 * 
 * @tag structure-stats-sot v1.5
 */
const EDIT_INTENT_KEYWORDS = [
  '重写', '改写', '修改', '编辑', '润色', '精简', '扩展', '优化',
  '帮我', '请', '把', '将', '让', '使',
  'rewrite', 'edit', 'modify', 'polish', 'expand', 'shorten', 'improve',
];

// ==========================================
// 主函数
// ==========================================

/**
 * 解析用户问句的结构查询意图
 * 
 * @param userText - 用户原始问句
 * @param envelope - 文档上下文信封
 * @returns 解析结果
 * 
 * @tag structure-stats-sot
 */
export function resolveStructuralQuery(
  userText: string,
  envelope: DocContextEnvelope
): StructuralQueryResolution {
  const text = userText.toLowerCase().trim();
  const { structure, stats, docMeta } = envelope.global;
  
  // 0. 🆕 v1.5: 编辑意图过滤
  // 如果用户文本包含编辑关键词（如"重写""改写""帮我"），跳过结构查询匹配
  // 让 LLM 解析为编辑意图，这样 "帮我重写第一章" 不会被误识别为 locate_chapter
  const hasEditIntent = EDIT_INTENT_KEYWORDS.some(keyword => text.includes(keyword));
  if (hasEditIntent) {
    return {
      kind: 'other',
      confidence: 'high',
      debugInfo: 'skipped - contains edit intent keyword',
    };
  }
  
  // 1. 章数量查询
  if (matchesAny(text, CHAPTER_COUNT_PATTERNS)) {
    return resolveChapterCount(structure);
  }
  
  // 2. 节数量查询
  if (matchesAny(text, SECTION_COUNT_PATTERNS)) {
    return resolveSectionCount(structure);
  }
  
  // 3. 段落数量查询
  if (matchesAny(text, PARAGRAPH_COUNT_PATTERNS)) {
    return resolveParagraphCount(stats);
  }
  
  // 4. 字数查询
  if (matchesAny(text, WORD_COUNT_PATTERNS)) {
    return resolveWordCount(stats);
  }
  
  // 5. 字符数查询
  if (matchesAny(text, CHAR_COUNT_PATTERNS)) {
    return resolveCharCount(stats);
  }
  
  // 6. Token 数查询
  if (matchesAny(text, TOKEN_COUNT_PATTERNS)) {
    return resolveTokenCount(stats);
  }
  
  // 7. 文档标题查询
  if (matchesAny(text, TITLE_QUERY_PATTERNS)) {
    return resolveTitleQuery(docMeta);
  }
  
  // 8. 第 N 章查询
  const chapterMatch = text.match(NTH_CHAPTER_PATTERN);
  if (chapterMatch) {
    const index = parseChineseOrArabicNumber(chapterMatch[1]);
    if (index !== null) {
      return resolveNthChapter(index, structure);
    }
  }
  
  // 9. 第 N 节查询
  const sectionMatch = text.match(NTH_SECTION_PATTERN);
  if (sectionMatch) {
    const index = parseChineseOrArabicNumber(sectionMatch[1]);
    if (index !== null) {
      return resolveNthSection(index, structure);
    }
  }
  
  // 10. 第 N 段查询
  const paragraphMatch = text.match(NTH_PARAGRAPH_PATTERN);
  if (paragraphMatch) {
    const index = parseChineseOrArabicNumber(paragraphMatch[1]);
    if (index !== null) {
      return {
        kind: 'locate_section',
        targetLevel: 'paragraph',
        paragraphIndex: index,
        confidence: 'high',
        debugInfo: `parsed paragraph index: ${index}`,
      };
    }
  }
  
  // 11. 其他 - 非结构查询
  return {
    kind: 'other',
    confidence: 'high',
    debugInfo: 'not a structural query',
  };
}

// ==========================================
// 解析子函数
// ==========================================

function resolveChapterCount(structure?: DocStructure): StructuralQueryResolution {
  if (!structure) {
    return {
      kind: 'chapter_count',
      targetLevel: 'chapter',
      confidence: 'low',
      clarificationQuestion: '系统没有获取到文档结构信息，无法统计章节数量。',
      debugInfo: 'structure is undefined',
    };
  }
  
  return {
    kind: 'chapter_count',
    targetLevel: 'chapter',
    confidence: 'high',
    directAnswer: `这篇文档共有 ${structure.chapterCount} 个章（大章节）。`,
    debugInfo: `chapterCount: ${structure.chapterCount}`,
  };
}

function resolveSectionCount(structure?: DocStructure): StructuralQueryResolution {
  if (!structure) {
    return {
      kind: 'section_count',
      targetLevel: 'section',
      confidence: 'low',
      clarificationQuestion: '系统没有获取到文档结构信息，无法统计小节数量。',
      debugInfo: 'structure is undefined',
    };
  }
  
  // 小节数 = 总章节数 - 大章数
  const sectionCount = structure.totalSectionCount - structure.chapterCount;
  
  return {
    kind: 'section_count',
    targetLevel: 'section',
    confidence: 'high',
    directAnswer: `这篇文档共有 ${sectionCount} 个小节（不含大章节），总共 ${structure.totalSectionCount} 个章节（含大章和小节）。`,
    debugInfo: `sectionCount: ${sectionCount}, totalSectionCount: ${structure.totalSectionCount}`,
  };
}

function resolveParagraphCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.paragraphCount === 0) {
    return {
      kind: 'paragraph_count',
      targetLevel: 'paragraph',
      confidence: 'low',
      clarificationQuestion: '系统没有统计到段落数量。',
      debugInfo: 'stats.paragraphCount is undefined or 0',
    };
  }
  
  return {
    kind: 'paragraph_count',
    targetLevel: 'paragraph',
    confidence: 'high',
    directAnswer: `这篇文档共有 ${stats.paragraphCount} 个段落。`,
    debugInfo: `paragraphCount: ${stats.paragraphCount}`,
  };
}

function resolveWordCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.wordCount === 0) {
    return {
      kind: 'word_count',
      confidence: 'low',
      clarificationQuestion: '系统没有统计到字数信息。',
      debugInfo: 'stats.wordCount is undefined or 0',
    };
  }
  
  return {
    kind: 'word_count',
    confidence: 'high',
    directAnswer: `这篇文档共有 ${stats.wordCount} 个字。`,
    debugInfo: `wordCount: ${stats.wordCount}`,
  };
}

function resolveCharCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.charCount === 0) {
    return {
      kind: 'char_count',
      confidence: 'low',
      clarificationQuestion: '系统没有统计到字符数信息。',
      debugInfo: 'stats.charCount is undefined or 0',
    };
  }
  
  return {
    kind: 'char_count',
    confidence: 'high',
    directAnswer: `这篇文档共有 ${stats.charCount} 个字符。`,
    debugInfo: `charCount: ${stats.charCount}`,
  };
}

function resolveTokenCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.tokenEstimate === 0) {
    return {
      kind: 'token_count',
      confidence: 'low',
      clarificationQuestion: '系统没有统计到 token 数信息。',
      debugInfo: 'stats.tokenEstimate is undefined or 0',
    };
  }
  
  return {
    kind: 'token_count',
    confidence: 'high',
    directAnswer: `这篇文档大约有 ${stats.tokenEstimate} 个 token（这是系统估算值）。`,
    debugInfo: `tokenEstimate: ${stats.tokenEstimate}`,
  };
}

function resolveTitleQuery(docMeta?: import('../docContext/docContextTypes').DocMeta): StructuralQueryResolution {
  if (!docMeta || !docMeta.title) {
    return {
      kind: 'title_query',
      confidence: 'high',
      directAnswer: '当前文档没有单独标注的文档标题。',
      debugInfo: 'docMeta.title is null or undefined',
    };
  }
  
  const note = docMeta.hasExplicitTitle 
    ? '' 
    : '（注：这是从第一个 H1 推断的，不是显式的文档标题）';
  
  return {
    kind: 'title_query',
    confidence: 'high',
    directAnswer: `文档标题是「${docMeta.title}」${note}`,
    debugInfo: `title: ${docMeta.title}, hasExplicitTitle: ${docMeta.hasExplicitTitle}`,
  };
}

function resolveNthChapter(index: number, structure?: DocStructure): StructuralQueryResolution {
  if (!structure) {
    return {
      kind: 'locate_chapter',
      targetLevel: 'chapter',
      chapterIndex: index,
      confidence: 'low',
      clarificationQuestion: '系统没有获取到文档结构信息，无法定位章节。',
      debugInfo: 'structure is undefined',
    };
  }
  
  if (index > structure.chapters.length || index < 1) {
    return {
      kind: 'locate_chapter',
      targetLevel: 'chapter',
      chapterIndex: index,
      confidence: 'low',
      clarificationQuestion: `文档只有 ${structure.chapters.length} 个大章节，找不到第 ${index} 章。`,
      debugInfo: `requested index ${index} out of range [1, ${structure.chapters.length}]`,
    };
  }
  
  const chapter = structure.chapters[index - 1];
  return {
    kind: 'locate_chapter',
    targetLevel: 'chapter',
    chapterIndex: index,
    confidence: 'high',
    directAnswer: `第 ${index} 章的标题是「${chapter.titleText}」，共有 ${chapter.childCount} 个子章节。`,
    debugInfo: `chapter: ${chapter.titleText}`,
  };
}

function resolveNthSection(index: number, structure?: DocStructure): StructuralQueryResolution {
  if (!structure) {
    return {
      kind: 'locate_section',
      targetLevel: 'section',
      sectionIndex: index,
      confidence: 'low',
      clarificationQuestion: '系统没有获取到文档结构信息，无法定位小节。',
      debugInfo: 'structure is undefined',
    };
  }
  
  // 找非 chapter 的 sections
  const sections = structure.allSections.filter(s => s.level > 1 || s.role !== 'chapter');
  
  if (index > sections.length || index < 1) {
    return {
      kind: 'locate_section',
      targetLevel: 'section',
      sectionIndex: index,
      confidence: 'low',
      clarificationQuestion: `文档只有 ${sections.length} 个小节，找不到第 ${index} 节。请确认你要找的是哪个章节。`,
      debugInfo: `requested index ${index} out of range [1, ${sections.length}]`,
    };
  }
  
  const section = sections[index - 1];
  return {
    kind: 'locate_section',
    targetLevel: 'section',
    sectionIndex: index,
    confidence: 'high',
    directAnswer: `第 ${index} 节的标题是「${section.titleText}」。`,
    debugInfo: `section: ${section.titleText}`,
  };
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 检查文本是否匹配任意一个模式
 */
function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

/**
 * 从中文数字/阿拉伯数字字符串转换为整数
 */
function parseChineseOrArabicNumber(str: string): number | null {
  // 先尝试阿拉伯数字
  const arabicNum = parseInt(str, 10);
  if (!isNaN(arabicNum)) {
    return arabicNum;
  }
  
  // 中文数字映射（只支持 1-20 的简单情况）
  const chineseMap: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
    '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
  };
  
  return chineseMap[str] ?? null;
}

/**
 * 判断是否为结构查询
 */
export function isStructuralQuery(resolution: StructuralQueryResolution): boolean {
  return resolution.kind !== 'other';
}

/**
 * 判断是否可以直接回答（不需要 LLM）
 */
export function canDirectAnswer(resolution: StructuralQueryResolution): boolean {
  return resolution.confidence === 'high' && !!resolution.directAnswer;
}

/**
 * 判断是否需要澄清
 */
export function needsClarification(resolution: StructuralQueryResolution): boolean {
  return resolution.confidence === 'low' && !!resolution.clarificationQuestion;
}

