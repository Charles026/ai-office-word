/**
 * CopilotRuntime - Copilot 运行时核心
 * 
 * 【职责】
 * - 维护 CopilotSessionState
 * - 准备 DocContextEnvelope + BehaviorSummary
 * - 调用 LLM 并解析 Intent
 * - 根据 Intent 决定执行聊天或编辑操作
 * 
 * 【设计原则】
 * - 不直接操作 Lexical / DocumentEngine
 * - 所有文档编辑通过 applySectionEdit 桥接现有 Section AI 路径
 * - 保持良好的日志便于调试
 */

import { LexicalEditor, $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import type {
  CopilotSessionState,
  CopilotModelOutput,
  CopilotIntent,
  CopilotRuntimeScope,
  CopilotUserPrefs,
  ParagraphRef,
} from './copilotRuntimeTypes';
import { createDefaultSessionState, isSpecialSectionId, isParagraphRef } from './copilotRuntimeTypes';
import {
  buildCopilotSystemPrompt,
  parseCopilotModelOutput,
  isIntentExecutable,
  describeIntent,
} from './copilotIntentParser';
import { buildDocContextEnvelope } from '../docContext';
import type { DocContextEnvelope } from '../docContext';
import { buildRecentBehaviorSummary } from '../interaction';
import type { BehaviorSummary } from '../interaction';
import {
  runSectionAiAction,
  type SectionAiAction,
  type SectionAiContext,
  type SectionAiResult,
} from '../actions/sectionAiActions';
import { copilotStore } from './copilotStore';
import { copilotDebugStore } from './copilotDebugStore';
import { generateDebugId } from './copilotDebugTypes';
import type { CopilotDebugSnapshot, DebugMessage } from './copilotDebugTypes';
import {
  resolveStructuralQuery,
  isStructuralQuery,
  canDirectAnswer,
  needsClarification,
} from './structuralQueryResolver';

// ==========================================
// 常量
// ==========================================

const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

const DEFAULT_MAX_TOKENS = 8192;
const BEHAVIOR_WINDOW_MS = 10 * 60 * 1000; // 10 分钟

// ==========================================
// 段落定位类型 (v1.1 新增)
// ==========================================

/**
 * 解析后的编辑目标
 * 
 * - kind='section': 重写整个章节
 * - kind='paragraph': 重写单个段落
 */
export interface ResolvedEditTarget {
  /** 目标类型 */
  kind: 'section' | 'paragraph';
  /** 章节 ID */
  sectionId: string;
  /** 段落 block ID（paragraph 时必填） */
  blockId?: string;
  /** 段落索引（1-based，仅用于日志/调试） */
  paragraphIndex?: number;
}

/**
 * 段落信息（用于定位）
 */
interface ParagraphBlockInfo {
  id: string;
  index: number;
  text: string;
}

// ==========================================
// 自然语言定位辅助函数 (v1.1 新增)
// ==========================================

/**
 * 从中文数字/阿拉伯数字字符串转换为整数
 * 
 * 支持: "一" → 1, "二" → 2, ..., "十" → 10, "3" → 3, "12" → 12
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

// ==========================================
// 自然语言章节引用解析 (v1.3 新增)
// ==========================================

/**
 * 章节引用解析结果
 */
export interface SectionResolutionResult {
  /** 解析到的章节 ID */
  sectionId?: string;
  /** 解析原因/方法 */
  reason: 'exact_title' | 'partial_title' | 'index' | 'keyword' | 'not_found';
  /** 匹配置信度 (0-1) */
  confidence?: number;
  /** 调试信息 */
  debugInfo?: string;
}

/**
 * 从用户自然语言中解析章节引用
 * 
 * 基于 DocSkeleton 进行结构化匹配，不依赖 LLM 猜测。
 * 
 * 匹配优先级：
 * 1. 精确匹配标题（忽略大小写、前后空格）
 * 2. 根据"第X章/节"的中文表达 + index 映射
 * 3. 关键字匹配（如 "概述" → title 包含 Overview/概述 的 chapter）
 * 4. 模糊匹配标题（包含查询字符串）
 * 
 * @param args.userText - 用户输入的自然语言
 * @param args.skeleton - 文档骨架结构
 * @param args.lastSectionId - 上次编辑的章节 ID（用于相对引用）
 * @param args.langHint - 语言提示
 */
export function resolveSectionByUserText(args: {
  userText: string;
  skeleton: import('../document/structure').DocSkeleton;
  lastSectionId?: string | null;
  langHint?: 'zh' | 'en' | 'mixed' | 'other';
}): SectionResolutionResult {
  const { userText, skeleton, lastSectionId, langHint = skeleton.meta.languageHint } = args;
  const text = userText.toLowerCase().trim();
  
  // 扁平化章节列表便于遍历
  const flatSections = flattenDocSkeletonLocal(skeleton);
  
  if (flatSections.length === 0) {
    return { reason: 'not_found', debugInfo: 'skeleton is empty' };
  }
  
  // 1. 尝试按索引匹配："第一章"、"第二节"、"第 3 章"
  const indexResult = resolveByIndex(text, flatSections, langHint);
  if (indexResult) {
    return indexResult;
  }
  
  // 2. 尝试精确匹配标题
  const exactResult = resolveByExactTitle(text, flatSections);
  if (exactResult) {
    return exactResult;
  }
  
  // 3. 尝试关键字匹配（概述、结论等）
  const keywordResult = resolveByKeyword(text, flatSections);
  if (keywordResult) {
    return keywordResult;
  }
  
  // 4. 尝试模糊匹配标题
  const fuzzyResult = resolveByFuzzyTitle(text, flatSections);
  if (fuzzyResult) {
    return fuzzyResult;
  }
  
  // 5. 尝试相对引用："上一章"、"下一节"
  if (lastSectionId) {
    const relativeResult = resolveByRelative(text, flatSections, lastSectionId);
    if (relativeResult) {
      return relativeResult;
    }
  }
  
  return { reason: 'not_found', debugInfo: `no match for: ${text.slice(0, 50)}` };
}

/**
 * 扁平化 DocSkeleton（本地版本，避免循环依赖）
 */
function flattenDocSkeletonLocal(
  skeleton: import('../document/structure').DocSkeleton
): import('../document/structure').DocSectionSkeleton[] {
  const result: import('../document/structure').DocSectionSkeleton[] = [];
  
  function traverse(section: import('../document/structure').DocSectionSkeleton) {
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
 * 按索引解析：匹配 "第 N 章/节"
 * 
 * 注意：需要排除相对引用如 "上一章"、"下一章"
 */
function resolveByIndex(
  text: string,
  sections: import('../document/structure').DocSectionSkeleton[],
  langHint?: string
): SectionResolutionResult | null {
  // 排除相对引用模式
  if (/(上一|下一|前一|后一|最后)(章|节|部分)/.test(text)) {
    return null;
  }
  
  // 中文模式：匹配 "第一章"、"第二节"、"第 3 部分"
  const zhPatterns = [
    /第\s*([一二三四五六七八九十\d]+)\s*(章|节|部分|小节)/,
  ];
  
  // 英文模式：匹配 "chapter 1"、"section 2"
  const enPatterns = [
    /chapter\s*(\d+)/i,
    /section\s*(\d+)/i,
    /part\s*(\d+)/i,
  ];
  
  const patterns = langHint === 'en' ? [...enPatterns, ...zhPatterns] : [...zhPatterns, ...enPatterns];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const indexStr = match[1];
      const index = parseChineseOrArabicNumber(indexStr);
      if (index === null || index <= 0) continue;
      
      // 确定要查找的角色类型
      const unitText = match[2]?.toLowerCase() || '';
      let roleFilter: string | null = null;
      
      if (/章|chapter/.test(unitText)) {
        roleFilter = 'chapter';
      } else if (/节|section|小节/.test(unitText)) {
        roleFilter = 'section';
      }
      
      // 在匹配的角色类型中查找第 N 个
      let count = 0;
      for (const section of sections) {
        if (roleFilter && section.role !== roleFilter) {
          continue;
        }
        count++;
        if (count === index) {
          return {
            sectionId: section.id,
            reason: 'index',
            confidence: 0.9,
            debugInfo: `matched index ${index} with role=${roleFilter || 'any'}`,
          };
        }
      }
    }
  }
  
  return null;
}

/**
 * 按精确标题匹配
 * 
 * 优先匹配更长的标题，避免短标题误匹配
 */
function resolveByExactTitle(
  text: string,
  sections: import('../document/structure').DocSectionSkeleton[]
): SectionResolutionResult | null {
  // 按标题长度降序排序，优先匹配长标题
  const sortedSections = [...sections].sort(
    (a, b) => b.title.length - a.title.length
  );
  
  for (const section of sortedSections) {
    const normalizedTitle = section.title.toLowerCase().trim();
    // 只有当标题足够长（>= 3 字符）时才尝试子串匹配
    if (normalizedTitle === text) {
      return {
        sectionId: section.id,
        reason: 'exact_title',
        confidence: 1.0,
        debugInfo: `exact match: "${section.title}"`,
      };
    }
    // 子串匹配要求标题长度 >= 4 且用户文本包含完整标题
    if (normalizedTitle.length >= 4 && text.includes(normalizedTitle)) {
      return {
        sectionId: section.id,
        reason: 'exact_title',
        confidence: 0.95,
        debugInfo: `substring match: "${section.title}"`,
      };
    }
  }
  return null;
}

/**
 * 按关键字匹配（概述、结论等常见章节）
 */
function resolveByKeyword(
  text: string,
  sections: import('../document/structure').DocSectionSkeleton[]
): SectionResolutionResult | null {
  const keywordMappings: Array<{ patterns: RegExp[]; titleKeywords: string[] }> = [
    {
      patterns: [/概述|概要|简介|导言|overview|introduction|intro/i],
      titleKeywords: ['概述', '概要', '简介', '导言', 'overview', 'introduction', 'intro'],
    },
    {
      patterns: [/结论|结语|总结|小结|conclusion|summary/i],
      titleKeywords: ['结论', '结语', '总结', '小结', 'conclusion', 'summary'],
    },
    {
      patterns: [/背景|background/i],
      titleKeywords: ['背景', 'background'],
    },
    {
      patterns: [/方法|method/i],
      titleKeywords: ['方法', 'method', 'methods'],
    },
    {
      patterns: [/步骤|step/i],
      titleKeywords: ['步骤', 'step', 'steps'],
    },
    {
      patterns: [/附录|appendix/i],
      titleKeywords: ['附录', 'appendix'],
    },
  ];
  
  for (const mapping of keywordMappings) {
    // 检查用户输入是否包含关键字模式
    const matchesUserText = mapping.patterns.some(p => p.test(text));
    if (!matchesUserText) continue;
    
    // 查找标题包含对应关键字的章节
    for (const section of sections) {
      const normalizedTitle = section.title.toLowerCase();
      const matchesTitle = mapping.titleKeywords.some(kw => 
        normalizedTitle.includes(kw.toLowerCase())
      );
      if (matchesTitle) {
        return {
          sectionId: section.id,
          reason: 'keyword',
          confidence: 0.8,
          debugInfo: `keyword match: "${section.title}"`,
        };
      }
    }
  }
  
  return null;
}

/**
 * 按模糊标题匹配
 */
function resolveByFuzzyTitle(
  text: string,
  sections: import('../document/structure').DocSectionSkeleton[]
): SectionResolutionResult | null {
  // 提取用户文本中可能的标题引用
  // 匹配引号内容："PRD vs MRD"、「概述」、『背景』
  const quotedPatterns = [
    /"([^"]+)"/,
    /「([^」]+)」/,
    /『([^』]+)』/,
    /'([^']+)'/,
    /《([^》]+)》/,
  ];
  
  for (const pattern of quotedPatterns) {
    const match = text.match(pattern);
    if (match) {
      const quoted = match[1].toLowerCase().trim();
      for (const section of sections) {
        const normalizedTitle = section.title.toLowerCase().trim();
        if (normalizedTitle.includes(quoted) || quoted.includes(normalizedTitle)) {
          return {
            sectionId: section.id,
            reason: 'partial_title',
            confidence: 0.7,
            debugInfo: `quoted match: "${section.title}"`,
          };
        }
      }
    }
  }
  
  // 尝试直接子串匹配
  for (const section of sections) {
    const normalizedTitle = section.title.toLowerCase().trim();
    // 至少匹配 3 个字符的子串
    if (normalizedTitle.length >= 3 && text.includes(normalizedTitle)) {
      return {
        sectionId: section.id,
        reason: 'partial_title',
        confidence: 0.6,
        debugInfo: `substring match: "${section.title}"`,
      };
    }
  }
  
  return null;
}

/**
 * 按相对引用匹配：上一章、下一节
 */
function resolveByRelative(
  text: string,
  sections: import('../document/structure').DocSectionSkeleton[],
  lastSectionId: string
): SectionResolutionResult | null {
  // 找到 lastSectionId 的索引
  const currentIndex = sections.findIndex(s => s.id === lastSectionId);
  if (currentIndex === -1) return null;
  
  // 匹配 "上一章/节"
  if (/(上一|前一)(章|节|部分)/.test(text)) {
    if (currentIndex > 0) {
      return {
        sectionId: sections[currentIndex - 1].id,
        reason: 'index',
        confidence: 0.85,
        debugInfo: `relative: previous of ${lastSectionId}`,
      };
    }
  }
  
  // 匹配 "下一章/节"
  if (/(下一|后一)(章|节|部分)/.test(text)) {
    if (currentIndex < sections.length - 1) {
      return {
        sectionId: sections[currentIndex + 1].id,
        reason: 'index',
        confidence: 0.85,
        debugInfo: `relative: next of ${lastSectionId}`,
      };
    }
  }
  
  // 匹配 "最后一章/节"
  if (/(最后一|最后)(章|节)/.test(text)) {
    return {
      sectionId: sections[sections.length - 1].id,
      reason: 'index',
      confidence: 0.85,
      debugInfo: 'relative: last section',
    };
  }
  
  return null;
}

/**
 * 从用户自然语言中推断 paragraphRef
 * 
 * 匹配模式：
 * - "这一段" / "这段" / "当前段" → current
 * - "上一段" / "前一段" → previous
 * - "下一段" / "后一段" → next
 * - "第三段" / "第 3 段" → nth + index
 */
function inferParagraphRefFromText(userText: string): { ref: ParagraphRef; index?: number } | null {
  // 匹配 "这一段" / "这段" / "当前段"
  if (/(这一段|这段|当前段|这一段落|这段落)/.test(userText)) {
    return { ref: 'current' };
  }
  
  // 匹配 "上一段" / "前一段"
  if (/(上一段|前一段|上段)/.test(userText)) {
    return { ref: 'previous' };
  }
  
  // 匹配 "下一段" / "后一段"
  if (/(下一段|后一段|下段)/.test(userText)) {
    return { ref: 'next' };
  }
  
  // 匹配 "第 N 段"
  const nthMatch = userText.match(/第\s*([一二三四五六七八九十\d]+)\s*段/);
  if (nthMatch) {
    const index = parseChineseOrArabicNumber(nthMatch[1]);
    if (index !== null && index > 0) {
      return { ref: 'nth', index };
    }
  }
  
  return null;
}

/**
 * 从 Lexical 编辑器获取当前光标所在的 block ID
 */
function getCurrentBlockIdFromEditor(editor: LexicalEditor): string | null {
  let blockId: string | null = null;
  
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }
    
    const anchorNode = selection.anchor.getNode();
    // 向上找到顶级块
    let current = anchorNode;
    const root = $getRoot();
    while (current && current.getParent() !== root) {
      const parent = current.getParent();
      if (!parent) break;
      current = parent;
    }
    
    if (current) {
      blockId = current.getKey();
    }
  });
  
  return blockId;
}

/**
 * 从 Lexical 编辑器获取指定章节内的所有段落 block
 * 
 * TODO(copilot-runtime-paragraph): 当前实现使用简化逻辑，
 * 假设章节内的所有块级元素都是"段落"。
 * 未来可以更精确地只获取 paragraph 类型的节点。
 */
function getParagraphBlocksInSection(
  editor: LexicalEditor,
  sectionId: string
): ParagraphBlockInfo[] {
  const paragraphs: ParagraphBlockInfo[] = [];
  
  editor.getEditorState().read(() => {
    const root = $getRoot();
    const children = root.getChildren();
    
    // 找到章节标题
    let inSection = false;
    let sectionLevel = 0;
    let paragraphIndex = 0;
    
    for (const node of children) {
      const nodeKey = node.getKey();
      const nodeType = node.getType();
      const text = node.getTextContent();
      
      // 检查是否是 heading
      if (nodeType === 'heading') {
        // @ts-expect-error - 获取 heading level
        const tag = node.getTag?.() || 'h1';
        const level = parseInt(tag.replace('h', ''), 10) || 1;
        
        if (nodeKey === sectionId) {
          // 找到目标章节
          inSection = true;
          sectionLevel = level;
          continue;
        }
        
        if (inSection && level <= sectionLevel) {
          // 遇到同级或更高级的标题，结束当前章节
          break;
        }
      }
      
      // 如果在目标章节内，收集段落
      if (inSection && (nodeType === 'paragraph' || nodeType === 'list')) {
        paragraphIndex++;
        paragraphs.push({
          id: nodeKey,
          index: paragraphIndex,
          text: text.slice(0, 100), // 只保留前 100 字符用于调试
        });
      }
    }
  });
  
  return paragraphs;
}

/**
 * 检测是否为 follow-up 请求（基于上次编辑）
 * 
 * 支持的短语：
 * - "再改短一点" / "再简洁一点"
 * - "再正式一点" / "再口语一点"
 * - "继续" / "接着"
 */
function isFollowUpRequest(userText: string): boolean {
  const followUpPatterns = [
    /再.{0,4}(短|简洁|长|详细|正式|口语|专业|通俗|清晰|精炼)/,
    /^(继续|接着|然后)/,
    /^再改/,
  ];
  return followUpPatterns.some(p => p.test(userText));
}

/**
 * 解析编辑目标 (v1.2 增强版)
 * 
 * 将 CopilotIntent + 用户上下文 → 具体的 sectionId / blockId
 * 
 * 优先级：
 * 1. Intent.params (LLM 显式指定)
 * 2. 当前 selection（用户光标位置）
 * 3. 从 userText 推断（自然语言匹配）
 * 4. v1.2: lastEditContext (follow-up 请求)
 * 5. Fallback 失败
 * 
 * @returns ResolvedEditTarget 或 null（无法解析时）
 */
function resolveEditTarget(args: {
  intent: CopilotIntent;
  userText: string;
  state: CopilotSessionState;
  envelope: DocContextEnvelope;
  editor: LexicalEditor;
  lastEditContext?: LastEditContext | null;
}): ResolvedEditTarget | null {
  const { intent, userText, state, envelope, editor, lastEditContext } = args;
  const { action, target, params } = intent;
  
  if (__DEV__) {
    console.log('[resolveEditTarget] Starting resolution:', {
      action,
      targetScope: target.scope,
      targetSectionId: target.sectionId,
      focusSectionId: state.focusSectionId,
      params,
    });
  }
  
  // ==========================================
  // Step 1: 解析 sectionId
  // ==========================================
  
  let resolvedSectionId: string | null = null;
  
  // 1.1 检查 Intent 中的 sectionId
  if (target.sectionId && !isSpecialSectionId(target.sectionId)) {
    // 验证 sectionId 是否在大纲中存在
    const existsInOutline = envelope.global.outline.some(o => o.sectionId === target.sectionId);
    if (existsInOutline) {
      resolvedSectionId = target.sectionId;
    } else {
      if (__DEV__) {
        console.warn('[resolveEditTarget] sectionId not in outline:', target.sectionId);
      }
      // 不立即失败，继续尝试其他方式
    }
  }
  
  // 1.2 如果是 'current' / 'auto' 或 undefined，使用 focusSectionId
  if (!resolvedSectionId) {
    if (state.focusSectionId) {
      resolvedSectionId = state.focusSectionId;
    } 
    // v1.2: 对于 follow-up 请求，使用 lastEditContext
    else if (lastEditContext?.sectionId && isFollowUpRequest(userText)) {
      resolvedSectionId = lastEditContext.sectionId;
      if (__DEV__) {
        console.log('[resolveEditTarget] Using lastEditContext for follow-up:', resolvedSectionId);
      }
    }
    else if (envelope.global.outline.length > 0) {
      // Fallback: 使用第一个章节
      resolvedSectionId = envelope.global.outline[0].sectionId;
      if (__DEV__) {
        console.log('[resolveEditTarget] Fallback to first section:', resolvedSectionId);
      }
    }
  }
  
  // 如果仍然没有 sectionId，返回失败
  if (!resolvedSectionId) {
    if (__DEV__) {
      console.warn('[resolveEditTarget] Cannot resolve sectionId');
    }
    return null;
  }
  
  // ==========================================
  // Step 2: 根据 action 类型决定返回
  // ==========================================
  
  // 2.1 章节级操作：直接返回
  if (action === 'rewrite_section' || action === 'summarize_section') {
    return {
      kind: 'section',
      sectionId: resolvedSectionId,
    };
  }
  
  // 2.2 段落级操作：需要进一步解析
  if (action === 'rewrite_paragraph') {
    const paragraphs = getParagraphBlocksInSection(editor, resolvedSectionId);
    
    if (paragraphs.length === 0) {
      if (__DEV__) {
        console.warn('[resolveEditTarget] No paragraphs found in section:', resolvedSectionId);
      }
      return null;
    }
    
    // 获取当前光标所在 block（用于 current / previous / next）
    const currentBlockId = getCurrentBlockIdFromEditor(editor);
    const currentBlockIndex = currentBlockId 
      ? paragraphs.findIndex(p => p.id === currentBlockId)
      : -1;
    
    if (__DEV__) {
      console.log('[resolveEditTarget] Paragraph context:', {
        totalParagraphs: paragraphs.length,
        currentBlockId,
        currentBlockIndex,
      });
    }
    
    // 解析 paragraphRef
    let paragraphRef: ParagraphRef | undefined = params?.paragraphRef as ParagraphRef | undefined;
    let paragraphIndex: number | undefined = params?.paragraphIndex as number | undefined;
    
    // 如果 Intent 中没有指定，尝试从 userText 推断
    if (!paragraphRef || !isParagraphRef(paragraphRef)) {
      const inferred = inferParagraphRefFromText(userText);
      if (inferred) {
        paragraphRef = inferred.ref;
        paragraphIndex = inferred.index;
        if (__DEV__) {
          console.log('[resolveEditTarget] Inferred from userText:', inferred);
        }
      }
    }
    
    // 默认 fallback 到 current
    if (!paragraphRef) {
      paragraphRef = 'current';
    }
    
    // 根据 paragraphRef 选择目标段落
    let targetParagraph: ParagraphBlockInfo | null = null;
    
    switch (paragraphRef) {
      case 'current':
        if (currentBlockIndex >= 0) {
          targetParagraph = paragraphs[currentBlockIndex];
        } else {
          // 如果光标不在章节内，使用第一个段落
          targetParagraph = paragraphs[0];
        }
        break;
        
      case 'previous':
        if (currentBlockIndex > 0) {
          targetParagraph = paragraphs[currentBlockIndex - 1];
        } else {
          if (__DEV__) {
            console.warn('[resolveEditTarget] No previous paragraph');
          }
          return null;
        }
        break;
        
      case 'next':
        if (currentBlockIndex >= 0 && currentBlockIndex < paragraphs.length - 1) {
          targetParagraph = paragraphs[currentBlockIndex + 1];
        } else {
          if (__DEV__) {
            console.warn('[resolveEditTarget] No next paragraph');
          }
          return null;
        }
        break;
        
      case 'nth':
        // paragraphIndex 是 1-based
        const idx = (paragraphIndex || 1) - 1;
        if (idx >= 0 && idx < paragraphs.length) {
          targetParagraph = paragraphs[idx];
        } else {
          if (__DEV__) {
            console.warn('[resolveEditTarget] Paragraph index out of range:', paragraphIndex, 'max:', paragraphs.length);
          }
          return null;
        }
        break;
    }
    
    if (!targetParagraph) {
      if (__DEV__) {
        console.warn('[resolveEditTarget] Failed to resolve target paragraph');
      }
      return null;
    }
    
    if (__DEV__) {
      console.log('[resolveEditTarget] Resolved paragraph target:', {
        sectionId: resolvedSectionId,
        blockId: targetParagraph.id,
        paragraphIndex: targetParagraph.index,
        textPreview: targetParagraph.text.slice(0, 50),
      });
    }
    
    return {
      kind: 'paragraph',
      sectionId: resolvedSectionId,
      blockId: targetParagraph.id,
      paragraphIndex: targetParagraph.index,
    };
  }
  
  // 其他 action 类型，暂不支持
  return null;
}

// ==========================================
// 依赖接口
// ==========================================

/**
 * CopilotRuntime 依赖
 */
export interface CopilotRuntimeDeps {
  /** LLM 聊天接口 */
  chatWithLLM: (messages: Array<{ role: string; content: string }>) => Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }>;
  
  /** 获取 Lexical 编辑器实例 */
  getEditor: () => LexicalEditor | null;
  
  /** Toast 回调 */
  toast?: {
    addToast: (message: string, type: 'success' | 'error' | 'info' | 'loading', duration?: number) => string;
    dismissToast: (id: string) => void;
  };
}

// ==========================================
// Intent 状态和错误码类型 (v1.1)
// ==========================================

/**
 * Intent 解析状态
 * 
 * - 'ok': Intent 解析成功且有效
 * - 'missing': 模型未输出 [INTENT] 块（当作纯聊天）
 * - 'invalid': [INTENT] 解析失败或缺少必要字段
 * - 'unsupported_action': action 类型不支持
 */
export type IntentStatus = 'ok' | 'missing' | 'invalid' | 'unsupported_action';

/**
 * 错误代码（用于 Telemetry 和调试）
 */
export type CopilotErrorCode =
  | 'intent_missing'          // 模型未输出 [INTENT]
  | 'invalid_intent_json'     // INTENT JSON 解析失败
  | 'invalid_intent_fields'   // INTENT 缺少必要字段
  | 'section_not_found'       // sectionId 无效或不存在
  | 'unresolvable_target'     // 无法解析编辑目标（段落/章节）
  | 'edit_execution_failed'   // runSectionAiAction 执行失败
  | 'llm_call_failed'         // LLM 调用失败
  | 'editor_not_ready'        // 编辑器未就绪
  | 'no_document';            // 无文档打开

/**
 * runTurn 返回结果
 * 
 * v1.1: 新增 intentStatus / errorCode / errorMessage 字段用于更明确的错误处理
 */
export interface CopilotTurnResult {
  /** 给用户的回复文本 */
  replyText: string;
  /** 解析出的 Intent（可能为空） */
  intent?: CopilotIntent;
  /** 是否执行了文档编辑 */
  executed: boolean;
  /** 执行结果（仅当 executed=true） */
  editResult?: SectionAiResult;
  
  // ========== v1.1 新增：显式错误状态 ==========
  
  /**
   * Intent 解析状态
   * 
   * - 'ok': Intent 解析成功
   * - 'missing': 模型未输出 [INTENT]（当作纯聊天）
   * - 'invalid': 解析失败或字段不完整
   */
  intentStatus: IntentStatus;
  
  /**
   * 错误代码（用于 Telemetry 和调试）
   * 
   * 仅在出错时设置，正常情况为 undefined
   */
  errorCode?: CopilotErrorCode;
  
  /**
   * 用户可见的错误消息
   * 
   * 在非 DEV 模式下也可显示给用户
   */
  errorMessage?: string;
  
  /**
   * @deprecated 使用 errorMessage 代替
   */
  error?: string;
}

// ==========================================
// 上一次编辑上下文 (v1.2)
// ==========================================

/**
 * 上一次编辑操作的上下文
 * 
 * 用于支持连续提问和相对引用，如：
 * - "再改短一点" → 使用 lastEditContext 的目标
 * - "上一段再正式一点" → 结合 lastEditContext 和相对引用
 */
export interface LastEditContext {
  /** 上次编辑的章节 ID */
  sectionId?: string;
  /** 上次编辑的段落索引 (1-based) */
  paragraphIndex?: number;
  /** 上次执行的 action */
  action?: CopilotAction;
  /** 上次编辑的时间戳 */
  timestamp?: number;
}

// ==========================================
// CopilotRuntime 类
// ==========================================

/**
 * Copilot 运行时
 * 
 * 在 UI 与底层 AI/DocOps 之间的协调层。
 * 
 * v1.2: 新增 lastEditContext 用于支持连续提问
 */
export class CopilotRuntime {
  private state: CopilotSessionState;
  private deps: CopilotRuntimeDeps;
  
  /** v1.2: 上一次编辑操作的上下文 */
  private lastEditContext: LastEditContext | null = null;
  
  constructor(deps: CopilotRuntimeDeps, initialDocId?: string) {
    this.deps = deps;
    this.state = createDefaultSessionState(initialDocId || '');
    
    if (__DEV__) {
      console.log('[CopilotRuntime] Initialized with docId:', initialDocId);
    }
  }
  
  /**
   * 获取上一次编辑上下文 (v1.2)
   */
  getLastEditContext(): LastEditContext | null {
    return this.lastEditContext ? { ...this.lastEditContext } : null;
  }
  
  /**
   * 清除上一次编辑上下文 (v1.2)
   */
  clearLastEditContext(): void {
    this.lastEditContext = null;
  }
  
  // ==========================================
  // State 访问器
  // ==========================================
  
  /**
   * 获取当前会话状态
   */
  getSessionState(): CopilotSessionState {
    return { ...this.state };
  }
  
  /**
   * 更新会话状态
   */
  updateSessionState(patch: Partial<CopilotSessionState>): void {
    this.state = { ...this.state, ...patch };
    
    if (__DEV__) {
      console.debug('[CopilotRuntime] State updated:', patch);
    }
  }
  
  /**
   * 设置当前文档
   */
  setDocId(docId: string): void {
    this.state.docId = docId;
    // 切换文档时重置为 document scope
    this.state.scope = 'document';
    this.state.focusSectionId = undefined;
    this.state.lastTask = undefined;
    // v1.2: 切换文档时清除 lastEditContext
    this.lastEditContext = null;
  }
  
  /**
   * 设置聚焦范围
   */
  setScope(scope: CopilotRuntimeScope, sectionId?: string): void {
    this.state.scope = scope;
    if (scope === 'section' && sectionId) {
      this.state.focusSectionId = sectionId;
    } else if (scope === 'document') {
      this.state.focusSectionId = undefined;
    }
  }
  
  /**
   * 设置用户偏好
   */
  setUserPrefs(prefs: Partial<CopilotUserPrefs>): void {
    this.state.userPrefs = { ...this.state.userPrefs, ...prefs };
  }
  
  // ==========================================
  // 核心方法：runTurn
  // ==========================================
  
  /**
   * 执行一轮对话
   * 
   * 流程：
   * 1. 读取当前 SessionState
   * 2. 构建 DocContextEnvelope（v1.2: 自动决定 full/chunked 模式）
   * 3. 可选：获取 BehaviorSummary
   * 4. 构建 System Prompt + User Message
   *    - scope='document' + mode='full': 提供完整文档文本
   *    - scope='document' + mode='chunked': 只提供结构和预览
   *    - scope='section': 提供当前章节内容
   * 5. 调用 LLM
   * 6. 解析 Intent
   * 7. 根据 Intent 执行操作：
   *    - mode=edit → 执行编辑（始终使用结构化上下文，即使是 Full-Doc 模式）
   *    - mode=chat → 只返回回复
   * 
   * 【v1.2 Full-Doc 模式】
   * 当 scope='document' 且文档 token 数 < FULL_DOC_TOKEN_THRESHOLD 时：
   * - envelope.mode = 'full'
   * - envelope.documentFullText 包含完整文档
   * - 适合"看完整篇再说"的问题（章节统计、全文总结、标题建议等）
   * - 编辑类操作仍使用结构化 Section AI 路径，不受 Full-Doc 模式影响
   * 
   * @param userText - 用户输入
   * @returns CopilotTurnResult
   */
  async runTurn(userText: string): Promise<CopilotTurnResult> {
    const { docId, scope, focusSectionId } = this.state;
    
    if (__DEV__) {
      console.log('[CopilotRuntime] runTurn started:', {
        userText: userText.slice(0, 50),
        docId,
        scope,
        focusSectionId,
      });
    }
    
    // 初始化调试快照
    const debugSnapshot: CopilotDebugSnapshot = {
      id: generateDebugId(),
      createdAt: Date.now(),
      model: 'copilot-runtime',
      docId,
      scope,
      sectionId: focusSectionId,
      requestMessages: [],
      responseMessages: [],
      timings: { startedAt: Date.now() },
      usedEnvelope: false,
    };
    
    try {
      // 1. 检查基本条件
      if (!docId) {
        if (__DEV__) {
          console.warn('[CopilotRuntime] No document open');
        }
        return {
          replyText: '请先打开一个文档。',
          executed: false,
          intentStatus: 'invalid',
          errorCode: 'no_document',
          errorMessage: '请先打开一个文档。',
          error: 'No document open',
        };
      }
      
      const editor = this.deps.getEditor();
      if (!editor) {
        if (__DEV__) {
          console.warn('[CopilotRuntime] Editor not ready');
        }
        return {
          replyText: '编辑器未就绪，请稍后重试。',
          executed: false,
          intentStatus: 'invalid',
          errorCode: 'editor_not_ready',
          errorMessage: '编辑器未就绪，请稍后重试。',
          error: 'Editor not ready',
        };
      }
      
      // 2. 构建 DocContextEnvelope
      let envelope: DocContextEnvelope;
      try {
        envelope = await buildDocContextEnvelope(
          {
            docId,
            scope: scope,
            sectionId: scope === 'section' ? focusSectionId : undefined,
            maxTokens: DEFAULT_MAX_TOKENS,
          },
          editor
        );
        debugSnapshot.envelope = envelope;
        debugSnapshot.usedEnvelope = true;
        
        if (__DEV__) {
          console.debug('[CopilotRuntime] Envelope built:', {
            scope: envelope.scope,
            title: envelope.global.title,
            focusSection: envelope.focus.sectionTitle,
            // v1.2 新增：Full-Doc 模式信息
            mode: envelope.mode,
            documentTokenEstimate: envelope.documentTokenEstimate,
            hasFullText: !!envelope.documentFullText,
          });
        }
      } catch (envelopeError) {
        if (__DEV__) {
          console.error('[CopilotRuntime] Failed to build envelope:', envelopeError);
        }
        return {
          replyText: '无法获取文档上下文，请重试。',
          executed: false,
          intentStatus: 'invalid',
          errorCode: 'section_not_found',
          errorMessage: '无法获取文档上下文，请重试。',
          error: `Envelope build failed: ${envelopeError}`,
        };
      }
      
      // 3. 🆕 structure-stats-sot v1.5: 结构查询短路
      // 对于"有几章/多少字"类问题，直接使用 structure/stats，不走 LLM
      const structuralResolution = resolveStructuralQuery(userText, envelope);
      
      if (isStructuralQuery(structuralResolution)) {
        if (__DEV__) {
          console.log('[CopilotRuntime] 结构查询检测:', {
            kind: structuralResolution.kind,
            confidence: structuralResolution.confidence,
            hasDirectAnswer: !!structuralResolution.directAnswer,
          });
        }
        
        // 如果可以直接回答，不走 LLM
        if (canDirectAnswer(structuralResolution)) {
          if (__DEV__) {
            console.log('[CopilotRuntime] 短路回答（不走 LLM）:', structuralResolution.directAnswer);
          }
          
          debugSnapshot.shortCircuit = {
            type: 'structural_query',
            kind: structuralResolution.kind,
            answer: structuralResolution.directAnswer,
          };
          this.saveDebugSnapshot(debugSnapshot);
          
          return {
            replyText: structuralResolution.directAnswer!,
            executed: false,
            intentStatus: 'ok',
            // 这是结构查询的直接回答，不是 edit intent
          };
        }
        
        // 如果需要澄清，返回澄清问题
        if (needsClarification(structuralResolution)) {
          if (__DEV__) {
            console.log('[CopilotRuntime] 需要澄清:', structuralResolution.clarificationQuestion);
          }
          
          debugSnapshot.shortCircuit = {
            type: 'clarification_needed',
            kind: structuralResolution.kind,
            question: structuralResolution.clarificationQuestion,
          };
          this.saveDebugSnapshot(debugSnapshot);
          
          return {
            replyText: structuralResolution.clarificationQuestion!,
            executed: false,
            intentStatus: 'ok',
          };
        }
      }
      
      // 4. 获取行为摘要
      let behaviorSummary: BehaviorSummary | undefined;
      try {
        behaviorSummary = buildRecentBehaviorSummary({
          docId,
          windowMs: BEHAVIOR_WINDOW_MS,
        });
        
        if (__DEV__ && behaviorSummary.stats.eventCount > 0) {
          console.debug('[CopilotRuntime] Behavior summary:', {
            eventCount: behaviorSummary.stats.eventCount,
            bullets: behaviorSummary.bullets,
          });
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[CopilotRuntime] Failed to build behavior summary:', err);
        }
        // 行为摘要失败不阻止流程
      }
      
      // 5. 构建 Prompt
      const systemPrompt = buildCopilotSystemPrompt(this.state, envelope, behaviorSummary);
      const userPrompt = this.buildUserPrompt(userText, envelope);
      
      // 记录请求消息
      const requestMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      debugSnapshot.requestMessages = requestMessages.map((msg, idx) => ({
        id: `req-${idx}`,
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
        contentLength: msg.content.length,
      }));
      
      // 5. 调用 LLM
      if (__DEV__) {
        console.log('[CopilotRuntime] Calling LLM...');
      }
      
      const llmResponse = await this.deps.chatWithLLM(requestMessages);
      
      debugSnapshot.timings.finishedAt = Date.now();
      debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
      
      if (!llmResponse.success || !llmResponse.content) {
        debugSnapshot.error = llmResponse.error || 'LLM call failed';
        this.saveDebugSnapshot(debugSnapshot);
        
        if (__DEV__) {
          console.error('[CopilotRuntime] LLM call failed:', llmResponse.error);
        }
        
        return {
          replyText: `抱歉，AI 响应失败：${llmResponse.error || '未知错误'}`,
          executed: false,
          intentStatus: 'invalid',
          errorCode: 'llm_call_failed',
          errorMessage: `AI 响应失败：${llmResponse.error || '未知错误'}`,
          error: llmResponse.error,
        };
      }
      
      // 记录响应
      debugSnapshot.responseMessages = [{
        id: 'resp-0',
        role: 'assistant',
        content: llmResponse.content,
        contentLength: llmResponse.content.length,
      }];
      
      // 🆕 DEV: 打印原始 LLM 输出（便于调试 Intent 解析）
      if (__DEV__) {
        console.log('[CopilotRuntime] ========== LLM RAW OUTPUT ==========');
        console.log(llmResponse.content.slice(0, 1000));
        if (llmResponse.content.length > 1000) {
          console.log('... (truncated, total length:', llmResponse.content.length, ')');
        }
        console.log('[CopilotRuntime] ====================================');
      }
      
      // 6. 解析 Intent
      const parsed = parseCopilotModelOutput(llmResponse.content);
      
      if (__DEV__) {
        console.log('[CopilotRuntime] Parsed output:', {
          hasIntent: !!parsed.intent,
          intentMode: parsed.intent?.mode,
          intentAction: parsed.intent?.action,
          targetScope: parsed.intent?.target?.scope,
          targetSectionId: parsed.intent?.target?.sectionId,
          replyTextLength: parsed.replyText.length,
          replyTextPreview: parsed.replyText.slice(0, 100),
        });
      }
      
      // 记录解析结果
      if (parsed.intent) {
        debugSnapshot.canonicalIntent = {
          intentId: `copilot-${Date.now()}`,
          scope: {
            level: parsed.intent.target.scope,
            sectionId: parsed.intent.target.sectionId,
          },
          tasks: [{
            type: parsed.intent.action as any,
            target: parsed.intent.target.scope,
          }],
          responseMode: parsed.intent.mode === 'edit' ? 'auto_apply' : 'auto_apply',
        } as any;
      }
      
      // 7. 根据 Intent 决定行为
      if (parsed.intent && parsed.intent.mode === 'edit' && isIntentExecutable(parsed.intent)) {
        // 🆕 v1.2: 使用 resolveEditTarget 解析具体目标，支持 follow-up
        const resolved = resolveEditTarget({
          intent: parsed.intent,
          userText,
          state: this.state,
          envelope,
          editor,
          lastEditContext: this.lastEditContext,
        });
        
        if (!resolved) {
          // 无法解析目标，返回友好提示
          if (__DEV__) {
            console.warn('[CopilotRuntime] Failed to resolve edit target:', {
              action: parsed.intent.action,
              targetSectionId: parsed.intent.target.sectionId,
              focusSectionId: this.state.focusSectionId,
            });
          }
          
          this.saveDebugSnapshot(debugSnapshot);
          
          const errorMsg = '我无法确定你说的是文档里的哪一部分。可以从大纲右键选择章节，或在问题里说清章节名称再试一次。';
          return {
            replyText: errorMsg,
            intent: parsed.intent,
            executed: false,
            intentStatus: 'invalid',
            errorCode: 'unresolvable_target',
            errorMessage: errorMsg,
            error: 'unresolvable_target',
          };
        }
        
        if (__DEV__) {
          console.log('[CopilotRuntime] Resolved target:', resolved);
        }
        
        // 执行编辑操作
        const editResult = await this.executeEditIntent(parsed.intent, editor, resolved);
        
        // 更新 lastTask
        this.state.lastTask = parsed.intent.action;
        
        this.saveDebugSnapshot(debugSnapshot);
        
        // v1.2: 区分编辑成功和失败的状态
        if (editResult.success) {
          // v1.2: 更新 lastEditContext 用于后续 follow-up
          this.lastEditContext = {
            sectionId: resolved.sectionId,
            paragraphIndex: resolved.paragraphIndex,
            action: parsed.intent.action,
            timestamp: Date.now(),
          };
          
          if (__DEV__) {
            console.log('[CopilotRuntime] Updated lastEditContext:', this.lastEditContext);
          }
          
          return {
            replyText: parsed.replyText,
            intent: parsed.intent,
            executed: true,
            editResult,
            intentStatus: 'ok',
          };
        } else {
          if (__DEV__) {
            console.error('[CopilotRuntime] Edit execution failed:', {
              action: parsed.intent.action,
              sectionId: resolved.sectionId,
              error: editResult.error,
            });
          }
          
          return {
            replyText: parsed.replyText || '编辑执行失败，请重试。',
            intent: parsed.intent,
            executed: false,
            editResult,
            intentStatus: 'ok', // Intent 本身是正确的，只是执行失败
            errorCode: 'edit_execution_failed',
            errorMessage: editResult.error || '编辑执行失败',
            error: editResult.error,
          };
        }
      }
      
      // 纯聊天模式（或 Intent 未执行）
      this.saveDebugSnapshot(debugSnapshot);
      
      // v1.1: 判断 Intent 状态
      const intentStatus: IntentStatus = parsed.intent ? 'ok' : 'missing';
      
      if (!parsed.intent && __DEV__) {
        console.warn('[CopilotRuntime] INTENT missing, falling back to chat mode');
      }
      
      return {
        replyText: parsed.replyText,
        intent: parsed.intent,
        executed: false,
        intentStatus,
        errorCode: parsed.intent ? undefined : 'intent_missing',
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      if (__DEV__) {
        console.error('[CopilotRuntime] runTurn error:', error);
      }
      
      debugSnapshot.error = errorMsg;
      debugSnapshot.timings.finishedAt = Date.now();
      debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
      this.saveDebugSnapshot(debugSnapshot);
      
      return {
        replyText: `抱歉，发生了错误：${errorMsg}`,
        executed: false,
        intentStatus: 'invalid',
        errorCode: 'edit_execution_failed',
        errorMessage: errorMsg,
        error: errorMsg,
      };
    }
  }
  
  // ==========================================
  // 内部方法
  // ==========================================
  
  /**
   * 构建用户消息
   * 
   * v1.2: 根据 scope 和 mode 构建不同的用户消息
   */
  private buildUserPrompt(userText: string, envelope: DocContextEnvelope): string {
    const parts: string[] = [`用户指令：${userText}`];
    
    // 如果是 section scope，提供章节内容
    if (envelope.scope === 'section' && envelope.focus.text) {
      parts.push(`\n当前章节内容：\n${envelope.focus.text}`);
    }
    
    // v1.2: document scope + full 模式时，提示 LLM 全文已在 system prompt 中
    if (envelope.scope === 'document' && envelope.mode === 'full') {
      parts.push(`\n（你已在 system prompt 中获得了完整的文档内容，请基于全文回答上述问题）`);
    } else if (envelope.scope === 'document' && envelope.mode === 'chunked') {
      parts.push(`\n（你只看到了文档的结构预览和部分段落，回答章节统计时请依赖大纲信息）`);
    }
    
    return parts.join('\n');
  }
  
  /**
   * 执行编辑 Intent
   * 
   * 桥接现有的 Section AI 路径
   * 
   * v1.1: 新增 resolved 参数，支持段落级操作
   */
  private async executeEditIntent(
    intent: CopilotIntent,
    editor: LexicalEditor,
    resolved: ResolvedEditTarget
  ): Promise<SectionAiResult> {
    const { action } = intent;
    
    if (__DEV__) {
      console.log('[CopilotRuntime] Executing edit intent:', describeIntent(intent), resolved);
    }
    
    // 构建执行上下文
    const context: SectionAiContext = {
      editor,
      toast: this.deps.toast || {
        addToast: (msg, type) => {
          if (__DEV__) console.log(`[Toast] ${type}: ${msg}`);
          return 'mock-toast';
        },
        dismissToast: () => {},
      },
    };
    
    // ==========================================
    // 章节级操作
    // ==========================================
    if (resolved.kind === 'section') {
      // 映射 CopilotAction → SectionAiAction
      let sectionAction: SectionAiAction;
      switch (action) {
        case 'rewrite_section':
          sectionAction = 'rewrite';
          break;
        case 'summarize_section':
          sectionAction = 'summarize';
          break;
        default:
          return {
            success: false,
            error: `不支持的章节操作类型: ${action}`,
          };
      }
      
      try {
        const result = await runSectionAiAction(sectionAction, resolved.sectionId, context);
        
        if (__DEV__) {
          console.log('[CopilotRuntime] Section edit result:', {
            success: result.success,
            responseMode: result.responseMode,
            applied: result.applied,
          });
        }
        
        return result;
      } catch (error) {
        if (__DEV__) {
          console.error('[CopilotRuntime] Section edit execution failed:', error);
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    
    // ==========================================
    // 段落级操作 (v1.1 新增)
    // ==========================================
    if (resolved.kind === 'paragraph') {
      if (action !== 'rewrite_paragraph') {
        return {
          success: false,
          error: `段落级不支持的操作: ${action}`,
        };
      }
      
      if (!resolved.blockId) {
        return {
          success: false,
          error: '缺少目标段落 ID',
        };
      }
      
      // TODO(copilot-runtime-paragraph): 实现真正的段落重写逻辑
      // 当前 V1 实现：复用 section rewrite，但只针对单个段落
      // 未来可以实现更细粒度的段落替换 DocOps
      
      try {
        // V1: 暂时使用 section rewrite 处理整个 section
        // 这不是最优方案，但能保证基本功能可用
        if (__DEV__) {
          console.log('[CopilotRuntime] Paragraph rewrite - using section rewrite as fallback', {
            sectionId: resolved.sectionId,
            blockId: resolved.blockId,
            paragraphIndex: resolved.paragraphIndex,
          });
        }
        
        // 调用 section rewrite，Section AI 会处理整个章节
        // 但用户看到的效果是"整个章节被重写"而不是"只改了那一段"
        // TODO: 实现真正的单段落重写能力
        const result = await runSectionAiAction('rewrite', resolved.sectionId, context);
        
        if (__DEV__) {
          console.log('[CopilotRuntime] Paragraph edit result (via section):', {
            success: result.success,
            responseMode: result.responseMode,
            applied: result.applied,
          });
        }
        
        return {
          ...result,
          // 标记这是段落级操作（便于 UI 展示）
          // @ts-expect-error - 扩展属性
          paragraphTarget: {
            blockId: resolved.blockId,
            paragraphIndex: resolved.paragraphIndex,
          },
        };
      } catch (error) {
        if (__DEV__) {
          console.error('[CopilotRuntime] Paragraph edit execution failed:', error);
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    
    return {
      success: false,
      error: `未知的目标类型: ${resolved.kind}`,
    };
  }
  
  /**
   * 保存调试快照
   */
  private saveDebugSnapshot(snapshot: CopilotDebugSnapshot): void {
    if (__DEV__) {
      copilotDebugStore.setSnapshot(snapshot);
    }
  }
}

// ==========================================
// 工厂函数
// ==========================================

/**
 * 创建 CopilotRuntime 实例
 * 
 * 使用默认的 window.aiDoc.chat 作为 LLM 接口
 */
export function createCopilotRuntime(
  getEditor: () => LexicalEditor | null,
  toast?: CopilotRuntimeDeps['toast'],
  initialDocId?: string
): CopilotRuntime {
  const deps: CopilotRuntimeDeps = {
    chatWithLLM: async (messages) => {
      if (typeof window !== 'undefined' && window.aiDoc?.chat) {
        try {
          const response = await window.aiDoc.chat({ messages });
          return {
            success: response.success,
            content: response.content,
            error: response.error,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'LLM 调用失败',
          };
        }
      }
      return {
        success: false,
        error: 'LLM 服务不可用',
      };
    },
    getEditor,
    toast,
  };
  
  return new CopilotRuntime(deps, initialDocId);
}

