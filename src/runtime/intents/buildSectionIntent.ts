/**
 * Section Intent Builder
 * 
 * 【职责】
 * 为 Section 级 AI 操作构建结构化、类型安全的 AgentIntent。
 * 
 * 【设计原则】
 * - 纯函数：不读写 AST、不访问 Editor、不访问 DOM、不调用 LLM
 * - 无副作用：不修改输入参数
 * - 无 async/await
 * - 返回值完全可 JSON 化
 * - 不生成 ID（由 Runtime 注入）
 * 
 * 【与其他模块的关系】
 * - 依赖 SectionContext（来自 extractSectionContext）
 * - 产出 IntentWithoutId（供 DocAgentRuntime 使用）
 */

import { SectionContext } from '../context/types';
import {
  IntentWithoutId,
  AgentIntentOptions,
  RewriteTone,
  RewriteDepth,
  SummaryStyle,
  ExpandLength,
  SectionScope,
} from './types';

// ==========================================
// 开发模式标志
// ==========================================

const __DEV__ = process.env.NODE_ENV === 'development';

// ==========================================
// 参数校验
// ==========================================

/**
 * 校验 SectionContext 基本字段
 * 
 * v1.2: 支持 H1/H2/H3 三级标题
 * - level = 1: 文档级导语 / 顶级章节（如文档标题）
 * - level = 2: 一级章节（H2）
 * - level = 3: 二级子章节（H3）
 * 
 * @throws Error 当 context 无效时
 */
function validateSectionContext(context: SectionContext, functionName: string): void {
  if (!context) {
    throw new Error(`[${functionName}] context 不能为空`);
  }
  
  if (!context.sectionId) {
    throw new Error(`[${functionName}] context.sectionId 不能为空`);
  }
  
  // v1.2: 支持 H1/H2/H3
  if (context.level < 1 || context.level > 3) {
    throw new Error(
      `[${functionName}] context.level 必须是 1/2/3，实际值: ${context.level}`
    );
  }
}

// ==========================================
// Rewrite Section Intent Builder
// ==========================================

/**
 * buildRewriteSectionIntent 的选项
 */
export interface RewriteSectionOptions {
  /** 重写语气 */
  tone?: RewriteTone;
  /** 重写深度 */
  depth?: RewriteDepth;
  /**
   * 重写范围
   * 
   * - 'intro': 只重写导语部分（ownParagraphs）- 默认
   * - 'chapter': 重写整章内容（subtreeParagraphs，包含子 H3）
   * 
   * 注意：只有 H2 且有子 section 时，chapter scope 才有意义
   */
  scope?: SectionScope;
  /** 自定义提示词（例如 refinement 要求） */
  customPrompt?: string;
}

/**
 * 构建重写 Section 的 Intent
 * 
 * @param context - Section 上下文（来自 extractSectionContext）
 * @param options - 重写选项
 * @returns IntentWithoutId - 不含 ID 的 Intent body
 * 
 * @example
 * ```ts
 * // 重写导语
 * const intent = buildRewriteSectionIntent(context, { tone: 'formal' });
 * 
 * // 重写整章（仅 H2）
 * const intent = buildRewriteSectionIntent(context, { scope: 'chapter' });
 * ```
 */
export function buildRewriteSectionIntent(
  context: SectionContext,
  options?: RewriteSectionOptions
): IntentWithoutId {
  validateSectionContext(context, 'buildRewriteSectionIntent');

  const intentOptions: AgentIntentOptions = {};
  
  // 映射选项
  if (options?.tone) {
    intentOptions.rewriteTone = options.tone;
  }
  if (options?.depth) {
    intentOptions.rewriteDepth = options.depth;
  }
  if (options?.customPrompt) {
    intentOptions.customPrompt = options.customPrompt;
  }
  
  // 默认 scope 为 'intro'
  const scope = options?.scope ?? 'intro';
  intentOptions.rewriteScope = scope;

  const intent: IntentWithoutId = {
    kind: 'rewrite_section',
    source: 'section',
    locale: 'auto',
    options: intentOptions,
    metadata: {
      sectionId: context.sectionId,
      sectionLevel: context.level,
      createdAt: Date.now(),
    },
  };

  if (__DEV__) {
    console.debug('[buildRewriteSectionIntent]', {
      sectionId: context.sectionId,
      level: context.level,
      tone: options?.tone,
      depth: options?.depth,
      scope,
      ownParagraphs: context.ownParagraphs.length,
      subtreeParagraphs: context.subtreeParagraphs.length,
      childSections: context.childSections.length,
    });
  }

  return intent;
}

// ==========================================
// Summarize Section Intent Builder
// ==========================================

/**
 * buildSummarizeSectionIntent 的选项
 */
export interface SummarizeSectionOptions {
  /** 总结风格 */
  style?: SummaryStyle;
  /** 自定义提示词 */
  customPrompt?: string;
}

/**
 * 构建总结 Section 的 Intent
 * 
 * @param context - Section 上下文（来自 extractSectionContext）
 * @param options - 总结选项
 * @returns IntentWithoutId - 不含 ID 的 Intent body
 * 
 * @example
 * ```ts
 * const context = extractSectionContext(editor, sectionId);
 * const intent = buildSummarizeSectionIntent(context, { style: 'bullet' });
 * const result = await runtime.run(intent, context);
 * ```
 */
export function buildSummarizeSectionIntent(
  context: SectionContext,
  options?: SummarizeSectionOptions
): IntentWithoutId {
  validateSectionContext(context, 'buildSummarizeSectionIntent');

  const intentOptions: AgentIntentOptions = {};
  
  // 映射选项
  if (options?.style) {
    intentOptions.summaryStyle = options.style;
  }
  if (options?.customPrompt) {
    intentOptions.customPrompt = options.customPrompt;
  }

  const intent: IntentWithoutId = {
    kind: 'summarize_section',
    source: 'section',
    locale: 'auto',
    options: Object.keys(intentOptions).length > 0 ? intentOptions : undefined,
    metadata: {
      sectionId: context.sectionId,
      sectionLevel: context.level,
      createdAt: Date.now(),
    },
  };

  if (__DEV__) {
    console.debug('[buildSummarizeSectionIntent]', {
      sectionId: context.sectionId,
      level: context.level,
      style: options?.style,
    });
  }

  return intent;
}

// ==========================================
// Expand Section Intent Builder
// ==========================================

/**
 * buildExpandSectionIntent 的选项
 */
export interface ExpandSectionOptions {
  /** 扩写长度 */
  length?: ExpandLength;
  /** 自定义提示词 */
  customPrompt?: string;
}

/**
 * 构建扩写 Section 的 Intent
 * 
 * @param context - Section 上下文（来自 extractSectionContext）
 * @param options - 扩写选项
 * @returns IntentWithoutId - 不含 ID 的 Intent body
 * 
 * @example
 * ```ts
 * const context = extractSectionContext(editor, sectionId);
 * const intent = buildExpandSectionIntent(context, { length: 'medium' });
 * const result = await runtime.run(intent, context);
 * ```
 */
export function buildExpandSectionIntent(
  context: SectionContext,
  options?: ExpandSectionOptions
): IntentWithoutId {
  validateSectionContext(context, 'buildExpandSectionIntent');

  const intentOptions: AgentIntentOptions = {};
  
  // 映射选项
  if (options?.length) {
    intentOptions.expandLength = options.length;
  }
  if (options?.customPrompt) {
    intentOptions.customPrompt = options.customPrompt;
  }

  const intent: IntentWithoutId = {
    kind: 'expand_section',
    source: 'section',
    locale: 'auto',
    options: Object.keys(intentOptions).length > 0 ? intentOptions : undefined,
    metadata: {
      sectionId: context.sectionId,
      sectionLevel: context.level,
      createdAt: Date.now(),
    },
  };

  if (__DEV__) {
    console.debug('[buildExpandSectionIntent]', {
      sectionId: context.sectionId,
      level: context.level,
      length: options?.length,
    });
  }

  return intent;
}

// ==========================================
// Highlight Only Intent Builder
// ==========================================

/**
 * buildHighlightOnlyIntent 的选项
 */
export interface HighlightOnlyOptions {
  /** 高亮模式 */
  mode?: 'terms' | 'sentences' | 'auto';
  /** 词语数量 */
  termCount?: number;
  /** 样式 */
  style?: 'default' | 'bold' | 'underline' | 'background';
}

/**
 * 构建只高亮（不改写）的 Intent
 * 
 * @param context - Section 上下文
 * @param options - 高亮选项
 * @returns IntentWithoutId
 */
export function buildHighlightOnlyIntent(
  context: SectionContext,
  options?: HighlightOnlyOptions
): IntentWithoutId {
  validateSectionContext(context, 'buildHighlightOnlyIntent');

  const intentOptions: AgentIntentOptions = {
    // 🆕 明确标记：只高亮，不改写
    highlightMode: options?.mode ?? 'terms',
  };
  
  if (options?.termCount) {
    intentOptions.termCount = options.termCount;
  }
  
  // 自定义 prompt 明确告诉 LLM 只做高亮
  intentOptions.customPrompt = `只标记重点词语/句子，不要改写文本内容。返回 mark_key_terms 任务，包含 3-5 个重点词语。${
    options?.style === 'bold' ? '样式设置为 bold。' : ''
  }`;

  const intent: IntentWithoutId = {
    kind: 'highlight_section', // 新的 intent kind
    source: 'section',
    locale: 'auto',
    options: intentOptions,
    metadata: {
      sectionId: context.sectionId,
      sectionLevel: context.level,
      createdAt: Date.now(),
      highlightOnly: true, // 标记为只高亮
    },
  };

  if (__DEV__) {
    console.debug('[buildHighlightOnlyIntent]', {
      sectionId: context.sectionId,
      level: context.level,
      mode: options?.mode,
      style: options?.style,
    });
  }

  return intent;
}

// ==========================================
// 预留：未来扩展的 Intent Builder
// ==========================================

// TODO: Outline 级 Intent Builder
// export function buildRestructureOutlineIntent(outline: OutlineItem[]): IntentWithoutId

// TODO: Version Compare Intent Builder
// export function buildCompareVersionsIntent(
//   versionA: string,
//   versionB: string
// ): IntentWithoutId

// TODO: Semantic Section Intent Builder
// export function buildIdentifyRequirementsIntent(
//   context: SectionContext
// ): IntentWithoutId

