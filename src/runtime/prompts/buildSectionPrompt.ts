/**
 * Section Prompt Builder (v2)
 * 
 * Used by DocAgentRuntime during Section-level AI actions (rewrite/summarize/expand).
 * Pure function. No side effects.
 * 
 * 【职责】
 * 根据 Intent + SectionContext 生成结构化的 Prompt。
 * 
 * 【设计原则】
 * - 纯函数：不依赖 editor / AST / DOM
 * - 输出为纯字符串，不包含 LLM API 逻辑
 * - Prompt 风格：规则化、结构化、分段清晰
 * - 支持未来扩展：章节重排、版本对比等
 * 
 * 【v2 新增：处事原则与不确定性协议】
 * - 在 System Prompt 中注入「Copilot 处事原则」
 * - 输出格式要求包含 confidence/uncertainties/responseMode
 * - LLM 需要根据 BehaviorSummary 做连续性和安全性决策
 */

import {
  SectionPromptInput,
  BuiltPrompt,
  PromptMetadata,
  SimplifiedSection,
  SimplifiedParagraph,
  PromptMode,
} from './sectionPromptTypes';
import { SectionContext } from '../context/types';
import { AgentIntent, AgentIntentOptions } from '../intents/types';
import { buildRecentBehaviorSummary } from '../../interaction';
import { buildBehaviorSummaryV2, type BehaviorContext } from '../../interaction/behaviorSummaryV2';

const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

// ==========================================
// System Prompt 模板
// ==========================================

/**
 * Copilot 处事原则 (v2)
 * 
 * 这段原则强调连续性、保守性、不确定时澄清，避免硬编码阈值
 */
const COPILOT_PRINCIPLES = `
=== Copilot 处事原则 ===

你的目标不是简单执行指令，而是成为用户的长期写作伙伴。

遇到用户指令不够具体时：
- 优先保持与用户最近几次操作风格的"连续性"（例如：结构、长度、标重点的粒度），而不是发明一种完全不同的新风格。
- 如果根据行为和当前指令仍然无法确定最佳方案，并且不同方案会带来很不一样的结果（例如：删掉大量内容、彻底改写结构），请选择更保守的方案：少改一点，让结果更容易被撤销或继续调整。

遇到真正高不确定性、且会显著影响内容结构或信息量的情况：
- 不要假装自己"完全懂了"，而是将不确定点记录在 uncertainties 中，并设置 responseMode = "clarify"。
- 用简短自然语言提出一个非常具体的问题，并给出 2~3 个候选选项，方便用户快速选择。

在大多数情况下，如果你对意图的理解比较清晰，且改动不会造成严重信息损失：
- 可以设置 responseMode = "auto_apply"，直接在文档中应用修改，同时在自然语言回应中简单说明你"打算怎么改"，让用户心里有数。

如果你对意图理解足够清晰，但改动涉及较多内容（例如长段落重写、合并多段）：
- 更推荐使用 responseMode = "preview"，先生成一个预览结果（例如新版本内容），让用户确认后再应用到文档。
`;

/**
 * 基础 System Prompt 模板
 */
const BASE_SYSTEM_PROMPT = `You are an AI writing assistant specialized in structured document editing (Word/Docx style).

Your output **MUST** strictly follow the JSON structure requested in the user prompt.
You must NOT omit any paragraph unless explicitly instructed.
You must NOT merge or split paragraphs unless instructed.
Maintain semantic fidelity while applying the requested transformation.
Do not invent new content unless expand mode is used.
Do not include any meta commentary.
Output in the same language as the input content.
${COPILOT_PRINCIPLES}`;

/**
 * 根据模式获取 System Prompt
 */
function getSystemPrompt(mode: PromptMode): string {
  const modeSpecificRules: Record<PromptMode, string> = {
    rewrite: `
Additional rules for REWRITE mode:
- Keep the exact same number of paragraphs
- Preserve the semantic meaning of each paragraph
- Apply the requested tone and depth adjustments`,
    summarize: `
Additional rules for SUMMARIZE mode:
- Condense the content while preserving key information
- Output format depends on the requested style (bullet/short/long)
- Do not add information not present in the original`,
    expand: `
Additional rules for EXPAND mode:
- You MAY add new paragraphs if needed
- Add relevant details, examples, or explanations
- Keep the logical structure intact
- Do not contradict the original content`,
  };

  return BASE_SYSTEM_PROMPT + modeSpecificRules[mode];
}

// ==========================================
// 任务指令模板
// ==========================================

/**
 * 获取重写任务指令
 */
function getRewriteTaskInstruction(options?: AgentIntentOptions): string {
  const tone = options?.rewriteTone || 'default';
  const depth = options?.rewriteDepth || 'medium';
  const scope = options?.rewriteScope || 'intro';
  const customPrompt = options?.customPrompt;

  // 根据 scope 添加额外说明
  const scopeNote = scope === 'chapter'
    ? `
- This is a CHAPTER-level rewrite (includes all sub-sections)
- You may adjust content across sub-sections for better flow
- PRESERVE the overall chapter structure and sub-section headings`
    : `
- This is an INTRO-level rewrite (only the introduction paragraphs)
- Do NOT modify any sub-section content`;

  // 组装自定义指令
  const customInstruction = customPrompt
    ? `\n\nUSER CUSTOM INSTRUCTION:\n${customPrompt}\n\n(Please prioritize this custom instruction above other style settings)`
    : '';

  return `TASK: Rewrite all paragraphs within this section.

Requirements:
- Tone: ${tone}
- Depth: ${depth}
- KEEP paragraph count exactly the same
- KEEP semantic meaning of each paragraph
- DO NOT merge or split paragraphs${scopeNote}${customInstruction}`;
}

/**
 * 获取总结任务指令
 */
function getSummarizeTaskInstruction(options?: AgentIntentOptions): string {
  const style = options?.summaryStyle || 'bullet';
  const customPrompt = options?.customPrompt;

  const styleGuide: Record<string, string> = {
    bullet: 'Output as bullet points (each point as a separate paragraph)',
    short: 'Output as 1-2 concise paragraphs',
    long: 'Output as 3-5 detailed paragraphs',
  };

  // 组装自定义指令
  const customInstruction = customPrompt
    ? `\n\nUSER CUSTOM INSTRUCTION:\n${customPrompt}\n\n(Please prioritize this custom instruction)`
    : '';

  return `TASK: Summarize this section.

Requirements:
- Style: ${style}
- ${styleGuide[style] || styleGuide.bullet}
- Output ONLY the summary content
- Preserve key information and main points${customInstruction}`;
}

/**
 * 获取扩写任务指令
 */
function getExpandTaskInstruction(options?: AgentIntentOptions): string {
  const length = options?.expandLength || 'medium';
  const customPrompt = options?.customPrompt;

  const lengthGuide: Record<string, string> = {
    short: 'Add 1-2 sentences per paragraph',
    medium: 'Add 2-4 sentences per paragraph, may add 1-2 new paragraphs',
    long: 'Significantly expand each paragraph, may add multiple new paragraphs',
  };

  // 组装自定义指令
  const customInstruction = customPrompt
    ? `\n\nUSER CUSTOM INSTRUCTION:\n${customPrompt}\n\n(Please prioritize this custom instruction)`
    : '';

  return `TASK: Expand this section with more detail.

Requirements:
- Expansion level: ${length}
- ${lengthGuide[length] || lengthGuide.medium}
- Add relevant details, examples, or explanations
- KEEP the logical structure intact
- Paragraph count MAY increase if needed${customInstruction}`;
}

/**
 * 根据模式获取任务指令
 */
function getTaskInstruction(mode: PromptMode, options?: AgentIntentOptions): string {
  switch (mode) {
    case 'rewrite':
      return getRewriteTaskInstruction(options);
    case 'summarize':
      return getSummarizeTaskInstruction(options);
    case 'expand':
      return getExpandTaskInstruction(options);
    default:
      return getRewriteTaskInstruction(options);
  }
}

// ==========================================
// 输出格式模板
// ==========================================

/**
 * 获取输出格式要求 (v2)
 * 
 * 新增：confidence / uncertainties / responseMode 字段
 */
function getOutputFormatInstruction(): string {
  return `OUTPUT FORMAT (STRICT):

Always respond using the following blocks (plain text, no Markdown code fences):

[assistant]
Your short natural-language acknowledgement for the user (1-2 sentences).
If responseMode is "clarify", this should be a specific question with 2-3 candidate options.

[intent]
{
  "intentId": "...",
  "scope": { "sectionId": "<current section id>" },
  "tasks": [ ... ],
  "confidence": 0.85,
  "uncertainties": [
    {
      "field": "tasks[0].params.length",
      "reason": "用户只说'精简一点'，没指明具体长度",
      "candidateOptions": ["short", "medium"]
    }
  ],
  "responseMode": "auto_apply"
}

=== Intent 字段说明 ===

confidence (推荐，0~1，默认 0.8):
- 你对自身理解用户意图的信心度
- 接近 1.0 表示非常确信
- 低于 0.6 时应考虑 preview 或 clarify

uncertainties (可选):
- 列出你觉得不确定的部分
- 每项包含 field（哪个字段）、reason（为什么不确定）、candidateOptions（候选选项）
- 如果没有不确定的地方，可以省略或设为空数组

responseMode (推荐，默认 "auto_apply"):
- "auto_apply": 直接应用到文档（适用于高信心、低风险的改动）
- "preview": 生成预览让用户确认（适用于较大改动或中等信心）
- "clarify": 暂不改文档，向用户提问澄清（适用于高不确定性、高风险的情况）

=== 选择 responseMode 的原则 ===

- 如果 confidence >= 0.8 且改动范围较小 → auto_apply
- 如果 confidence >= 0.6 且改动较大（如长段落重写）→ preview
- 如果 confidence < 0.6 且 uncertainties 涉及关键决策 → clarify
- 当 clarify 时，[assistant] 块应包含简短问题和 2~3 个选项
- 如果不确定该用什么模式，默认使用 "auto_apply"

[docops]
{
  "version": "1.0",
  "intentId": "<same as intentId>",
  "ops": [
    {
      "type": "replace_range",
      "scope": { "sectionId": "<current section id>" },
      "payload": {
        "paragraphs": [
          { "index": 0, "text": "rewritten paragraph 0" },
          { "index": 1, "text": "rewritten paragraph 1" }
        ]
      }
    }
  ]
}

Requirements for [docops]:
- At least one op must exist (unless responseMode is "clarify", then docops can be minimal or empty).
- replace_range payload.paragraphs MUST keep the same paragraph indexes as the input unless expand mode allows more.
- JSON must be valid and NOT wrapped in markdown code fences (no \`\`\`json).

CRITICAL: Output JSON directly as plain text. Do NOT use markdown code blocks like \`\`\`json ... \`\`\`.`;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 将 SectionContext 转换为简化的 Section 数据
 */
function simplifySection(context: SectionContext): SimplifiedSection {
  // 防御性检查
  if (!context) {
    throw new Error('[simplifySection] context is undefined');
  }
  if (!context.paragraphs) {
    throw new Error(`[simplifySection] context.paragraphs is undefined, sectionId: ${context.sectionId}`);
  }
  if (!Array.isArray(context.paragraphs)) {
    throw new Error(`[simplifySection] context.paragraphs is not an array, type: ${typeof context.paragraphs}`);
  }

  const paragraphs: SimplifiedParagraph[] = context.paragraphs.map((p, index) => ({
    index,
    text: p.text,
  }));

  return {
    title: context.titleText,
    level: context.level,
    paragraphs,
  };
}

/**
 * 转义 JSON 字符串中的特殊字符
 */
function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * 将 Section 数据格式化为 JSON 字符串
 */
function formatSectionAsJson(section: SimplifiedSection): string {
  const paragraphsJson = section.paragraphs
    .map(p => `    { "index": ${p.index}, "text": "${escapeJsonString(p.text)}" }`)
    .join(',\n');

  return `{
  "section": {
    "title": "${escapeJsonString(section.title)}",
    "level": ${section.level},
    "paragraphs": [
${paragraphsJson}
    ]
  }
}`;
}

/**
 * 估算 token 数量（粗略估算：字符数 / 4）
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * 从 Intent Kind 提取 Prompt Mode
 */
function getModeFromIntent(intent: AgentIntent): PromptMode {
  switch (intent.kind) {
    case 'rewrite_section':
    case 'rewrite':
      return 'rewrite';
    case 'summarize_section':
    case 'summarize':
      return 'summarize';
    case 'expand_section':
      return 'expand';
    default:
      return 'rewrite';
  }
}

// ==========================================
// 核心构建函数
// ==========================================

/**
 * 构建基础 Section Prompt
 * 
 * @param intent - Agent Intent
 * @param context - Section 上下文
 * @param mode - Prompt 模式
 * @param docId - 文档 ID（可选，用于获取用户行为摘要）
 * @param sectionId - Section ID（可选，用于 v2 行为摘要）
 * @param sectionTitle - Section 标题（可选，用于 v2 行为摘要）
 * @returns { prompt: BuiltPrompt, behaviorContext: BehaviorContext | null }
 */
interface BuildBaseSectionPromptResult {
  prompt: BuiltPrompt;
  behaviorContext: BehaviorContext | null;
}

function buildBaseSectionPrompt(
  intent: AgentIntent,
  context: SectionContext,
  mode: PromptMode,
  docId?: string,
  sectionId?: string,
  sectionTitle?: string
): BuildBaseSectionPromptResult {
  // 1. 构建 System Prompt
  let system = getSystemPrompt(mode);
  let behaviorContext: BehaviorContext | null = null;

  // 2. 获取用户行为摘要并注入到 System Prompt
  // 优先使用 v2（如果有 sectionId），否则使用 v1
  const actualSectionId = sectionId || context.sectionId;
  const actualSectionTitle = sectionTitle || context.titleText;

  if (__DEV__) {
    console.log('[SectionPrompt] Building prompt with docId:', docId, 'sectionId:', actualSectionId);
  }

  if (docId && actualSectionId) {
    // 🆕 使用 BehaviorSummary v2
    try {
      const v2Result = buildBehaviorSummaryV2({
        docId,
        scope: 'section',
        sectionId: actualSectionId,
        sectionTitle: actualSectionTitle,
        windowMs: 10 * 60 * 1000,
        limit: 50,
      });

      behaviorContext = v2Result.behaviorContext;

      if (__DEV__) {
        console.log('[BehaviorSummaryV2] textSummary length:', v2Result.textSummary.length);
        console.log('[BehaviorSummaryV2] behaviorContext:', v2Result.behaviorContext);
      }

      // 只在有摘要时追加（只描述事实 + 使用说明）
      if (v2Result.textSummary) {
        system += `

=== 最近用户在此文档上的操作（当前小节） ===
${v2Result.textSummary}

=== 行为数据使用说明 ===
- 上面的内容只是对用户最近在当前小节中的操作记录。
- 当用户提到「标注重点」「突出重点」「高亮」时，请你：
  1. 先根据这些行为自行判断用户更可能希望标记词语、短语还是句子；
  2. 如果行为数据不足以判断，就直接问用户，避免瞎猜；
  3. 不要直接把这些描述重复说给用户听。`;
        
        if (__DEV__) {
          console.log('[SectionPrompt] BehaviorSummaryV2 injected into system prompt');
        }
      } else if (__DEV__) {
        console.log('[SectionPrompt] BehaviorSummaryV2 empty, skipping injection');
      }
    } catch (err) {
      console.error('[SectionPrompt] Failed to get BehaviorSummaryV2:', err);
      
      // Fallback to v1
      try {
        const behaviorSummary = buildRecentBehaviorSummary({
          docId,
          loose: true,
          looseLimit: 20,
        });

        if (behaviorSummary.summaryText && behaviorSummary.stats.eventCount > 0) {
          system += `

=== 最近用户在此文档上的操作（供你参考，不需要向用户复述） ===
${behaviorSummary.summaryText}`;
        }
      } catch (v1Err) {
        console.error('[SectionPrompt] Failed to get BehaviorSummary v1 fallback:', v1Err);
      }
    }
  } else if (docId) {
    // 没有 sectionId，使用 v1
    try {
      const behaviorSummary = buildRecentBehaviorSummary({
        docId,
        loose: true,
        looseLimit: 20,
      });

      if (__DEV__) {
        console.log('[BehaviorSummary] v1 fallback - summaryText length:', behaviorSummary.summaryText.length);
      }

      if (behaviorSummary.summaryText && behaviorSummary.stats.eventCount > 0) {
        system += `

=== 最近用户在此文档上的操作（供你参考，不需要向用户复述） ===
${behaviorSummary.summaryText}`;
      }
    } catch (err) {
      console.error('[SectionPrompt] Failed to get BehaviorSummary v1:', err);
    }
  } else if (__DEV__) {
    console.log('[SectionPrompt] No docId provided, skipping BehaviorSummary');
  }

  // 3. 简化 Section 数据
  const simplifiedSection = simplifySection(context);

  // 4. 构建 User Prompt 各部分
  const sectionJson = formatSectionAsJson(simplifiedSection);
  const taskInstruction = getTaskInstruction(mode, intent.options);
  const outputFormat = getOutputFormatInstruction();

  // 5. 组装 User Prompt
  const user = `INPUT SECTION:

${sectionJson}

---

${taskInstruction}

---

${outputFormat}`;

  // 6. 构建元数据
  const metadata: PromptMetadata = {
    sectionId: context.sectionId,
    sectionLevel: context.level,
    paragraphCount: context.paragraphs.length,
    estimatedTokens: estimateTokens(system + user),
    builtAt: Date.now(),
    intentKind: intent.kind,
  };

  return {
    prompt: {
      system,
      user,
      metadata,
    },
    behaviorContext,
  };
}

// ==========================================
// 导出的 Prompt Builder 函数
// ==========================================

/**
 * Section Prompt 构建结果（包含 BehaviorContext）
 */
export interface SectionPromptBuildResult {
  prompt: BuiltPrompt;
  behaviorContext: BehaviorContext | null;
}

/**
 * 构建重写 Section 的 Prompt
 * 
 * @param input - Prompt 输入（intent + context + docId）
 * @returns BuiltPrompt - 构建完成的 Prompt
 * 
 * @example
 * ```ts
 * const prompt = buildRewriteSectionPrompt({ intent, context, docId });
 * const response = await llm.chat([
 *   { role: 'system', content: prompt.system },
 *   { role: 'user', content: prompt.user },
 * ]);
 * ```
 */
export function buildRewriteSectionPrompt(input: SectionPromptInput): BuiltPrompt {
  const result = buildBaseSectionPrompt(
    input.intent,
    input.context,
    'rewrite',
    input.docId,
    input.sectionId,
    input.sectionTitle
  );
  return result.prompt;
}

/**
 * 构建重写 Section 的 Prompt（带 BehaviorContext）
 */
export function buildRewriteSectionPromptWithContext(input: SectionPromptInput): SectionPromptBuildResult {
  return buildBaseSectionPrompt(
    input.intent,
    input.context,
    'rewrite',
    input.docId,
    input.sectionId,
    input.sectionTitle
  );
}

/**
 * 构建总结 Section 的 Prompt
 * 
 * @param input - Prompt 输入（intent + context + docId）
 * @returns BuiltPrompt - 构建完成的 Prompt
 * 
 * @example
 * ```ts
 * const prompt = buildSummarizeSectionPrompt({ intent, context, docId });
 * const response = await llm.chat([
 *   { role: 'system', content: prompt.system },
 *   { role: 'user', content: prompt.user },
 * ]);
 * ```
 */
export function buildSummarizeSectionPrompt(input: SectionPromptInput): BuiltPrompt {
  const result = buildBaseSectionPrompt(
    input.intent,
    input.context,
    'summarize',
    input.docId,
    input.sectionId,
    input.sectionTitle
  );
  return result.prompt;
}

/**
 * 构建扩写 Section 的 Prompt
 * 
 * @param input - Prompt 输入（intent + context + docId）
 * @returns BuiltPrompt - 构建完成的 Prompt
 * 
 * @example
 * ```ts
 * const prompt = buildExpandSectionPrompt({ intent, context, docId });
 * const response = await llm.chat([
 *   { role: 'system', content: prompt.system },
 *   { role: 'user', content: prompt.user },
 * ]);
 * ```
 */
export function buildExpandSectionPrompt(input: SectionPromptInput): BuiltPrompt {
  const result = buildBaseSectionPrompt(
    input.intent,
    input.context,
    'expand',
    input.docId,
    input.sectionId,
    input.sectionTitle
  );
  return result.prompt;
}

/**
 * 根据 Intent 自动选择 Prompt Builder
 * 
 * @param input - Prompt 输入（intent + context + docId）
 * @returns BuiltPrompt - 构建完成的 Prompt
 */
export function buildSectionPrompt(input: SectionPromptInput): BuiltPrompt {
  const mode = getModeFromIntent(input.intent);
  const result = buildBaseSectionPrompt(
    input.intent,
    input.context,
    mode,
    input.docId,
    input.sectionId,
    input.sectionTitle
  );
  return result.prompt;
}

/**
 * 根据 Intent 自动选择 Prompt Builder（带 BehaviorContext）
 */
export function buildSectionPromptWithContext(input: SectionPromptInput): SectionPromptBuildResult {
  const mode = getModeFromIntent(input.intent);
  return buildBaseSectionPrompt(
    input.intent,
    input.context,
    mode,
    input.docId,
    input.sectionId,
    input.sectionTitle
  );
}

// ==========================================
// 导出内部函数（用于测试）
// ==========================================

export const __internal = {
  getSystemPrompt,
  getTaskInstruction,
  getOutputFormatInstruction,
  simplifySection,
  escapeJsonString,
  formatSectionAsJson,
  estimateTokens,
  getModeFromIntent,
  buildBaseSectionPrompt,
};

