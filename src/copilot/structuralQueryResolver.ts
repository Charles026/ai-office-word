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
 * @tag structure-v2 - 使用 globalConfidence 和章节级别 confidence
 */

import type { DocContextEnvelope, DocStructure, ChapterInfo, Confidence, DocMeta } from '../docContext/docContextTypes';

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
 * 
 * @tag structure-v2 - 支持 medium confidence 和 shortCircuit 控制
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
  /** 置信度（v2: 支持 medium） */
  confidence: Confidence;
  /** 需要澄清时的问题 */
  clarificationQuestion?: string;
  /** 直接回答（如果可以从 structure/stats 获取） */
  directAnswer?: string;
  /** 调试信息 */
  debugInfo?: string;
  
  // ========== v2: 新增字段 ==========
  
  /**
   * 是否应该短路（不走 LLM）
   * 
   * - true: 可以直接返回 directAnswer 或 clarificationQuestion
   * - false: 应该把结构信息传给 LLM 做更复杂的处理
   * 
   * 例如：混合意图（"帮我重写第一章，顺便告诉我有几章"）应该 shortCircuit=false
   */
  shortCircuit?: boolean;
  
  /**
   * 结构源置信度
   * 
   * 来自 DocStructure.globalConfidence，用于判断结构信息的可靠性
   */
  structureConfidence?: Confidence;
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
 * 编辑意图关键词（强）
 * 
 * 明确的编辑动词，出现时应该让 LLM 处理
 * 
 * @tag structure-v2
 */
const EDIT_INTENT_KEYWORDS_STRONG = [
  '重写', '改写', '修改', '编辑', '润色', '精简', '扩展', '优化',
  '删除', '删掉', '增加', '添加', '调整', '替换', '更新',
  'rewrite', 'edit', 'modify', 'polish', 'expand', 'shorten', 'improve',
  'delete', 'remove', 'add', 'update', 'replace',
];

/**
 * 编辑意图关键词（弱）
 * 
 * 请求类前缀，单独出现不足以判定为编辑意图，
 * 但与结构词同时出现时应该让 LLM 处理
 * 
 * @tag structure-v2
 */
const EDIT_INTENT_KEYWORDS_WEAK = [
  '帮我', '请', '把', '将', '让', '使', '能不能', '可以',
  'please', 'can you', 'could you', 'help me',
];

/**
 * 检测是否包含编辑意图
 * 
 * @tag structure-v2
 */
function hasEditIntent(text: string): { hasStrong: boolean; hasWeak: boolean } {
  const lowerText = text.toLowerCase();
  const hasStrong = EDIT_INTENT_KEYWORDS_STRONG.some(kw => lowerText.includes(kw));
  const hasWeak = EDIT_INTENT_KEYWORDS_WEAK.some(kw => lowerText.includes(kw));
  return { hasStrong, hasWeak };
}

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
 * @tag structure-v2 - 使用 globalConfidence 和混合意图检测
 */
export function resolveStructuralQuery(
  userText: string,
  envelope: DocContextEnvelope
): StructuralQueryResolution {
  const text = userText.toLowerCase().trim();
  const { structure, stats, docMeta } = envelope.global;
  
  // 获取结构全局置信度
  const structureConfidence = structure?.globalConfidence || 'low';
  
  // 0. 编辑意图检测
  const editIntent = hasEditIntent(text);
  
  // 如果包含强编辑意图词，跳过结构查询匹配，让 LLM 处理
  if (editIntent.hasStrong) {
    return {
      kind: 'other',
      confidence: 'high',
      shortCircuit: false,  // 不短路，让 LLM 处理
      structureConfidence,
      debugInfo: 'skipped - contains strong edit intent keyword',
    };
  }
  
  // 1. 章数量查询
  if (matchesAny(text, CHAPTER_COUNT_PATTERNS)) {
    const result = resolveChapterCount(structure);
    return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
  }
  
  // 2. 节数量查询
  if (matchesAny(text, SECTION_COUNT_PATTERNS)) {
    const result = resolveSectionCount(structure);
    return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
  }
  
  // 3. 段落数量查询
  if (matchesAny(text, PARAGRAPH_COUNT_PATTERNS)) {
    const result = resolveParagraphCount(stats);
    return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
  }
  
  // 4. 字数查询
  if (matchesAny(text, WORD_COUNT_PATTERNS)) {
    const result = resolveWordCount(stats);
    return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
  }
  
  // 5. 字符数查询
  if (matchesAny(text, CHAR_COUNT_PATTERNS)) {
    const result = resolveCharCount(stats);
    return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
  }
  
  // 6. Token 数查询
  if (matchesAny(text, TOKEN_COUNT_PATTERNS)) {
    const result = resolveTokenCount(stats);
    return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
  }
  
  // 7. 文档标题查询
  if (matchesAny(text, TITLE_QUERY_PATTERNS)) {
    const result = resolveTitleQuery(docMeta);
    return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
  }
  
  // 8. 第 N 章查询
  const chapterMatch = text.match(NTH_CHAPTER_PATTERN);
  if (chapterMatch) {
    const index = parseChineseOrArabicNumber(chapterMatch[1]);
    if (index !== null) {
      const result = resolveNthChapter(index, structure);
      return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
    }
  }
  
  // 9. 第 N 节查询
  const sectionMatch = text.match(NTH_SECTION_PATTERN);
  if (sectionMatch) {
    const index = parseChineseOrArabicNumber(sectionMatch[1]);
    if (index !== null) {
      const result = resolveNthSection(index, structure);
      return applyGlobalConfidence(result, structureConfidence, editIntent.hasWeak);
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
        shortCircuit: !editIntent.hasWeak,
        structureConfidence,
        debugInfo: `parsed paragraph index: ${index}`,
      };
    }
  }
  
  // 11. 其他 - 非结构查询
  return {
    kind: 'other',
    confidence: 'high',
    shortCircuit: true,
    structureConfidence,
    debugInfo: 'not a structural query',
  };
}

/**
 * 应用全局置信度到解析结果
 * 
 * 当结构全局置信度为 low 时，降级解析结果的置信度并添加澄清信息
 * 
 * @tag structure-v2
 */
function applyGlobalConfidence(
  result: StructuralQueryResolution,
  structureConfidence: Confidence,
  hasWeakEditIntent: boolean
): StructuralQueryResolution {
  // 添加结构置信度
  result.structureConfidence = structureConfidence;
  
  // 如果有弱编辑意图词，不短路
  if (hasWeakEditIntent) {
    result.shortCircuit = false;
    result.debugInfo = (result.debugInfo || '') + ' [has weak edit intent, not short-circuiting]';
    return result;
  }
  
  // 如果结构全局置信度为 low，降级结果置信度
  if (structureConfidence === 'low' && result.confidence === 'high') {
    result.confidence = 'medium';
    result.shortCircuit = true;
    
    // 对于计数类查询，添加不确定提示
    if (result.kind === 'chapter_count' || result.kind === 'section_count') {
      const originalAnswer = result.directAnswer;
      result.directAnswer = originalAnswer
        ? `${originalAnswer}\n\n⚠️ 注意：当前文档主要通过样式标记标题，系统对章节结构的识别可能不够准确。`
        : undefined;
      result.debugInfo = (result.debugInfo || '') + ' [downgraded due to low structure confidence]';
    }
    return result;
  }
  
  // 默认可以短路
  result.shortCircuit = true;
  return result;
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
      shortCircuit: true,
      clarificationQuestion: '系统没有获取到文档结构信息，无法统计章节数量。',
      debugInfo: 'structure is undefined',
    };
  }
  
  // v2: 检查全局置信度
  const globalConf = structure.globalConfidence || 'medium';
  
  if (globalConf === 'low') {
    return {
      kind: 'chapter_count',
      targetLevel: 'chapter',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: `系统检测到 ${structure.chapterCount} 个可能的章节，但由于文档主要通过样式标记标题（而非使用标准 Heading 格式），无法确定这个数字是否准确。建议检查文档格式或手动确认。`,
      debugInfo: `chapterCount: ${structure.chapterCount}, globalConfidence: low`,
    };
  }
  
  return {
    kind: 'chapter_count',
    targetLevel: 'chapter',
    confidence: globalConf === 'high' ? 'high' : 'medium',
    shortCircuit: true,
    directAnswer: `这篇文档共有 ${structure.chapterCount} 个章（大章节）。`,
    debugInfo: `chapterCount: ${structure.chapterCount}, globalConfidence: ${globalConf}`,
  };
}

function resolveSectionCount(structure?: DocStructure): StructuralQueryResolution {
  if (!structure) {
    return {
      kind: 'section_count',
      targetLevel: 'section',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: '系统没有获取到文档结构信息，无法统计小节数量。',
      debugInfo: 'structure is undefined',
    };
  }
  
  // 小节数 = 总章节数 - 大章数
  const sectionCount = structure.totalSectionCount - structure.chapterCount;
  const globalConf = structure.globalConfidence || 'medium';
  
  if (globalConf === 'low') {
    return {
      kind: 'section_count',
      targetLevel: 'section',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: `系统检测到约 ${sectionCount} 个小节，但由于文档结构识别置信度较低，无法确定准确数字。`,
      debugInfo: `sectionCount: ${sectionCount}, globalConfidence: low`,
    };
  }
  
  return {
    kind: 'section_count',
    targetLevel: 'section',
    confidence: globalConf === 'high' ? 'high' : 'medium',
    shortCircuit: true,
    directAnswer: `这篇文档共有 ${sectionCount} 个小节（不含大章节），总共 ${structure.totalSectionCount} 个章节（含大章和小节）。`,
    debugInfo: `sectionCount: ${sectionCount}, totalSectionCount: ${structure.totalSectionCount}, globalConfidence: ${globalConf}`,
  };
}

function resolveParagraphCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.paragraphCount === 0) {
    return {
      kind: 'paragraph_count',
      targetLevel: 'paragraph',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: '系统没有统计到段落数量。',
      debugInfo: 'stats.paragraphCount is undefined or 0',
    };
  }
  
  return {
    kind: 'paragraph_count',
    targetLevel: 'paragraph',
    confidence: 'high',
    shortCircuit: true,
    directAnswer: `这篇文档共有 ${stats.paragraphCount} 个段落。`,
    debugInfo: `paragraphCount: ${stats.paragraphCount}`,
  };
}

function resolveWordCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.wordCount === 0) {
    return {
      kind: 'word_count',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: '系统没有统计到字数信息。',
      debugInfo: 'stats.wordCount is undefined or 0',
    };
  }
  
  return {
    kind: 'word_count',
    confidence: 'high',
    shortCircuit: true,
    directAnswer: `这篇文档共有 ${stats.wordCount} 个字。`,
    debugInfo: `wordCount: ${stats.wordCount}`,
  };
}

function resolveCharCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.charCount === 0) {
    return {
      kind: 'char_count',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: '系统没有统计到字符数信息。',
      debugInfo: 'stats.charCount is undefined or 0',
    };
  }
  
  return {
    kind: 'char_count',
    confidence: 'high',
    shortCircuit: true,
    directAnswer: `这篇文档共有 ${stats.charCount} 个字符。`,
    debugInfo: `charCount: ${stats.charCount}`,
  };
}

function resolveTokenCount(stats?: import('../docContext/docContextTypes').DocStats): StructuralQueryResolution {
  if (!stats || stats.tokenEstimate === 0) {
    return {
      kind: 'token_count',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: '系统没有统计到 token 数信息。',
      debugInfo: 'stats.tokenEstimate is undefined or 0',
    };
  }
  
  return {
    kind: 'token_count',
    confidence: 'high',
    shortCircuit: true,
    directAnswer: `这篇文档大约有 ${stats.tokenEstimate} 个 token（这是系统估算值）。`,
    debugInfo: `tokenEstimate: ${stats.tokenEstimate}`,
  };
}

function resolveTitleQuery(docMeta?: DocMeta): StructuralQueryResolution {
  if (!docMeta || !docMeta.title) {
    return {
      kind: 'title_query',
      confidence: 'high',
      shortCircuit: true,
      directAnswer: '当前文档没有单独标注的文档标题。',
      debugInfo: 'docMeta.title is null or undefined',
    };
  }
  
  // v2: 使用 titleSource 和 titleConfidence
  const titleConf = docMeta.titleConfidence || 'medium';
  const titleSource = docMeta.titleSource || 'heading';
  
  // 构建来源说明
  let sourceNote = '';
  if (titleSource === 'explicit_meta') {
    sourceNote = '';  // 显式元数据，不需要说明
  } else if (titleSource === 'heading') {
    sourceNote = titleConf === 'high' ? '' : '（从 H1 标题推断）';
  } else if (titleSource === 'style_inferred') {
    sourceNote = '（通过样式特征推断，可能不准确）';
  } else if (titleSource === 'filename') {
    sourceNote = '（从文件名推断）';
  }
  
  // 低置信度时返回不确定提示
  if (titleConf === 'low') {
    const candidateInfo = docMeta.candidates && docMeta.candidates.length > 1
      ? `\n\n其他可能的候选：\n${docMeta.candidates.slice(1, 4).map(c => `- 「${c.text}」(${c.source})`).join('\n')}`
      : '';
    
    return {
      kind: 'title_query',
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: `系统推测文档标题可能是「${docMeta.title}」${sourceNote}，但置信度较低。请确认这是否正确？${candidateInfo}`,
      debugInfo: `title: ${docMeta.title}, source: ${titleSource}, confidence: ${titleConf}`,
    };
  }
  
  return {
    kind: 'title_query',
    confidence: titleConf,
    shortCircuit: true,
    directAnswer: `文档标题是「${docMeta.title}」${sourceNote}`,
    debugInfo: `title: ${docMeta.title}, source: ${titleSource}, confidence: ${titleConf}`,
  };
}

function resolveNthChapter(index: number, structure?: DocStructure): StructuralQueryResolution {
  if (!structure) {
    return {
      kind: 'locate_chapter',
      targetLevel: 'chapter',
      chapterIndex: index,
      confidence: 'low',
      shortCircuit: true,
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
      shortCircuit: true,
      clarificationQuestion: `文档只有 ${structure.chapters.length} 个大章节，找不到第 ${index} 章。`,
      debugInfo: `requested index ${index} out of range [1, ${structure.chapters.length}]`,
    };
  }
  
  const chapter = structure.chapters[index - 1];
  const globalConf = structure.globalConfidence || 'medium';
  const chapterConf = chapter.confidence || 'medium';
  
  // 取全局和章节置信度的较低者
  const effectiveConf: Confidence = 
    globalConf === 'low' || chapterConf === 'low' ? 'low' :
    globalConf === 'medium' || chapterConf === 'medium' ? 'medium' : 'high';
  
  // 低置信度时返回不确定提示
  if (effectiveConf === 'low') {
    return {
      kind: 'locate_chapter',
      targetLevel: 'chapter',
      chapterIndex: index,
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: `系统推测第 ${index} 章可能是「${chapter.titleText}」，但这个章节是通过样式推断的（${chapter.source || 'unknown'}），可能不准确。`,
      debugInfo: `chapter: ${chapter.titleText}, source: ${chapter.source}, confidence: ${chapterConf}, globalConfidence: ${globalConf}`,
    };
  }
  
  return {
    kind: 'locate_chapter',
    targetLevel: 'chapter',
    chapterIndex: index,
    confidence: effectiveConf,
    shortCircuit: true,
    directAnswer: `第 ${index} 章的标题是「${chapter.titleText}」，共有 ${chapter.childCount} 个子章节。`,
    debugInfo: `chapter: ${chapter.titleText}, source: ${chapter.source}, confidence: ${chapterConf}`,
  };
}

function resolveNthSection(index: number, structure?: DocStructure): StructuralQueryResolution {
  if (!structure) {
    return {
      kind: 'locate_section',
      targetLevel: 'section',
      sectionIndex: index,
      confidence: 'low',
      shortCircuit: true,
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
      shortCircuit: true,
      clarificationQuestion: `文档只有 ${sections.length} 个小节，找不到第 ${index} 节。请确认你要找的是哪个章节。`,
      debugInfo: `requested index ${index} out of range [1, ${sections.length}]`,
    };
  }
  
  const section = sections[index - 1];
  const globalConf = structure.globalConfidence || 'medium';
  const sectionConf = section.confidence || 'medium';
  
  // 取全局和章节置信度的较低者
  const effectiveConf: Confidence = 
    globalConf === 'low' || sectionConf === 'low' ? 'low' :
    globalConf === 'medium' || sectionConf === 'medium' ? 'medium' : 'high';
  
  if (effectiveConf === 'low') {
    return {
      kind: 'locate_section',
      targetLevel: 'section',
      sectionIndex: index,
      confidence: 'low',
      shortCircuit: true,
      clarificationQuestion: `系统推测第 ${index} 节可能是「${section.titleText}」，但识别置信度较低。`,
      debugInfo: `section: ${section.titleText}, source: ${section.source}, confidence: ${sectionConf}`,
    };
  }
  
  return {
    kind: 'locate_section',
    targetLevel: 'section',
    sectionIndex: index,
    confidence: effectiveConf,
    shortCircuit: true,
    directAnswer: `第 ${index} 节的标题是「${section.titleText}」。`,
    debugInfo: `section: ${section.titleText}, source: ${section.source}, confidence: ${sectionConf}`,
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
 * 
 * @tag structure-v2 - 支持 medium confidence 的直接回答
 */
export function canDirectAnswer(resolution: StructuralQueryResolution): boolean {
  // high 或 medium confidence 都可以直接回答
  const canAnswer = (resolution.confidence === 'high' || resolution.confidence === 'medium') 
    && !!resolution.directAnswer;
  // 但如果 shortCircuit 明确为 false，不应直接回答
  if (resolution.shortCircuit === false) {
    return false;
  }
  return canAnswer;
}

/**
 * 判断是否需要澄清
 */
export function needsClarification(resolution: StructuralQueryResolution): boolean {
  return resolution.confidence === 'low' && !!resolution.clarificationQuestion;
}

/**
 * 判断是否应该短路（不走 LLM）
 * 
 * @tag structure-v2
 */
export function shouldShortCircuit(resolution: StructuralQueryResolution): boolean {
  // 如果明确指定了 shortCircuit，使用它
  if (resolution.shortCircuit !== undefined) {
    return resolution.shortCircuit;
  }
  // 默认：有直接答案或澄清问题时短路
  return canDirectAnswer(resolution) || needsClarification(resolution);
}

/**
 * 获取置信度提示文本
 * 
 * @tag structure-v2
 */
export function getConfidenceHint(resolution: StructuralQueryResolution): string | null {
  if (resolution.confidence === 'low') {
    return '⚠️ 系统对此结构识别的置信度较低，结果可能不准确。';
  }
  if (resolution.confidence === 'medium') {
    return 'ℹ️ 此结果基于文档结构分析，可能存在偏差。';
  }
  return null;
}

