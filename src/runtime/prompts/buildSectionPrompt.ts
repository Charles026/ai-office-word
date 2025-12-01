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

=== 高亮任务选择规则（词语级 vs 句子级）===

当用户请求中包含「高亮」「标记」「突出」等意图时，请根据以下规则选择正确的任务类型：

【使用 mark_key_terms（词语/短语级）的情况】
用户使用以下表达时，必须输出 mark_key_terms 任务：
- 「标出 X 个重点词语」「关键词」「核心术语」
- 「highlight key terms」「keywords」「key phrases」
- 「3–5 个词」「几个关键概念」
- 「标记重要术语」「专业名词」

mark_key_terms 的 terms 规则：
- phrase 必须是重写后段落中按原文出现的短语，不能是整句
- 英文建议 2–7 个单词，中文建议 3–15 个字符
- 若用户说「3–5 个」，返回 3–5 条即可

【使用 mark_key_sentences（句子级）的情况】
用户使用以下表达时，使用 mark_key_sentences 任务：
- 「关键句」「重要句子」「核心观点句」
- 「key sentences」「important sentences」
- 「标出最重要的句子」

【同时使用两种的情况】
如果用户同时提到「重点词语」和「关键句」，可以在 tasks 中同时包含两种任务。

【style 样式字段规则】
当用户在请求中提到样式相关词汇时，必须在 mark_key_terms.params 中设置 style 字段：
- 用户说「加粗」「标粗」「bold」→ style: "bold"
- 用户说「下划线」「underline」→ style: "underline"
- 用户说「高亮」「背景」「highlight」→ style: "background"
- 用户没有明确说样式 → style: "default" 或不设置

【只标记不改写的情况】
当用户的请求中只包含「标记」「高亮」「加粗」等词，但不包含「改写」「润色」「优化」等词时：
- tasks 中只包含 mark_key_terms，不要包含 rewrite
- 例如：「这一段标记 3-5 个重点单词并加粗」→ 只有 mark_key_terms，无 rewrite

=== 示例 1：改写 + 标记词语 ===
用户输入：「改写这一节，并标出 3–5 个重点词语」
tasks：
[
  { "type": "rewrite", "params": { "tone": "default" } },
  {
    "type": "mark_key_terms",
    "params": {
      "sectionId": "<当前 section id>",
      "terms": [
        { "phrase": "requirements and design", "occurrence": 1 },
        { "phrase": "coherent product", "occurrence": 1 },
        { "phrase": "implementation efforts", "occurrence": 1 }
      ]
    }
  }
]

=== 示例 2：只标记词语（加粗）===
用户输入：「这一段标记 3-5 个重点单词并加粗」
tasks：
[
  {
    "type": "mark_key_terms",
    "params": {
      "sectionId": "<当前 section id>",
      "style": "bold",
      "terms": [
        { "phrase": "user experience", "occurrence": 1 },
        { "phrase": "design patterns", "occurrence": 1 },
        { "phrase": "implementation", "occurrence": 1 }
      ]
    }
  }
]
注意：此例中没有 rewrite 任务，因为用户只要求标记，不要求改写。
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
    highlight: `
Additional rules for HIGHLIGHT mode:
- DO NOT rewrite or modify the original text
- Only identify 3-5 key terms/phrases from the existing text
- Each term should be 2-7 words (English) or 3-15 characters (Chinese)
- Terms must exist exactly as written in the original text
- DO NOT output [docops] block - only output [assistant] and [intent]`,
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
// 高亮模式相关
// ==========================================

import type { HighlightMode } from '../intents/types';

/**
 * 根据高亮模式获取允许的高亮任务类型
 */
function getAllowedHighlightKinds(highlightMode: HighlightMode): string[] {
  switch (highlightMode) {
    case 'terms':
      return ['mark_key_terms'];
    case 'sentences':
      return ['mark_key_sentences'];
    case 'paragraphs':
      return ['mark_key_paragraphs'];
    case 'auto':
      return ['mark_key_terms', 'mark_key_sentences', 'mark_key_paragraphs'];
    case 'none':
    default:
      return [];
  }
}

/**
 * 获取高亮任务说明
 */
function getHighlightTaskInstruction(highlightMode: HighlightMode, sectionId: string): string {
  if (highlightMode === 'none') {
    return '';
  }

  const allowedKinds = getAllowedHighlightKinds(highlightMode);
  
  let instruction = `
=== 高亮任务说明 ===

本次请求允许的高亮任务类型: ${allowedKinds.join(', ')}

`;

  if (allowedKinds.includes('mark_key_terms')) {
    instruction += `
【mark_key_terms - 词语/短语级高亮】
用于标记文中的关键概念、专业术语、核心论点等。

规则：
- terms 是「词语/短语」，不是整句
- 中文建议长度 3–15 字；英文建议 2–7 个词
- 选择真正重要的概念，不要标太多纯功能词
- 同一个短语出现多次时，可使用 occurrence 指定第几次（从 1 开始）；不指定默认为第一次
- 不要跨句选择

示例：
{
  "type": "mark_key_terms",
  "params": {
    "sectionId": "${sectionId}",
    "terms": [
      { "phrase": "关键概念", "occurrence": 1 },
      { "phrase": "核心论点" }
    ]
  }
}

`;
  }

  if (allowedKinds.includes('mark_key_sentences')) {
    instruction += `
【mark_key_sentences - 句子级高亮】
用于标记文中的核心观点句、总结句、关键论据等。

规则：
- 选择完整的句子
- 优先选择段落的主题句、结论句
- 不要选择过渡句或纯描述性句子

示例：
{
  "type": "mark_key_sentences",
  "params": {
    "sectionId": "${sectionId}",
    "sentenceIndexes": [0, 3],
    "sentences": [
      { "text": "这是核心观点句。" }
    ]
  }
}

`;
  }

  if (allowedKinds.includes('mark_key_paragraphs')) {
    instruction += `
【mark_key_paragraphs - 段落级高亮】（预留功能）
用于标记整个段落的重要性。

示例：
{
  "type": "mark_key_paragraphs",
  "params": {
    "sectionId": "${sectionId}",
    "paragraphIndexes": [0, 2]
  }
}

`;
  }

  if (highlightMode === 'auto') {
    instruction += `
【auto 模式说明】
你可以根据内容特点选择最合适的高亮粒度：
- 优先用 mark_key_terms 标出关键概念和术语
- 如有必要，再用 mark_key_sentences 标出核心观点句
- 可以同时输出多种高亮任务

`;
  } else if (highlightMode === 'terms') {
    instruction += `
【terms 模式说明】
本次只允许使用 mark_key_terms，请专注于词语/短语级别的标注。

`;
  } else if (highlightMode === 'sentences') {
    instruction += `
【sentences 模式说明】
本次只允许使用 mark_key_sentences，请专注于句子级别的标注。

`;
  }

  return instruction;
}

// ==========================================
// 输出格式模板
// ==========================================

/**
 * 🆕 Highlight-only 输出格式（不要求 docops）
 * 
 * 用于 highlight_section agent，只需要 [assistant] 和 [intent]
 */
function getHighlightOnlyOutputFormat(sectionId: string = ''): string {
  return `OUTPUT FORMAT (HIGHLIGHT ONLY - NO DOCOPS REQUIRED):

You are identifying key terms/phrases from the text. DO NOT rewrite the text.

Always respond using ONLY these two blocks (no [docops] block needed):

[assistant]
A brief acknowledgement (1 sentence). Example: "I've identified 4 key terms from this section."

[intent]
{
  "intentId": "highlight-${Date.now()}",
  "scope": { "target": "section", "sectionId": "${sectionId || '<section id>'}" },
  "tasks": [
    {
      "type": "mark_key_terms",
      "params": {
        "sectionId": "${sectionId || '<section id>'}",
        "terms": [
          { "phrase": "exact phrase from text", "occurrence": 1 },
          { "phrase": "another key term" },
          { "phrase": "important concept" }
        ],
        "style": "bold"
      }
    }
  ],
  "confidence": 0.9,
  "responseMode": "auto_apply"
}

IMPORTANT RULES:
1. DO NOT output [docops] block - only [assistant] and [intent]
2. Each "phrase" MUST be an exact substring from the original text
3. Select 3-5 key terms that are important concepts/terminology
4. For English: each phrase should be 2-7 words
5. For Chinese: each phrase should be 3-15 characters
6. DO NOT include common words like "the", "a", "is", "and"
7. Prefer noun phrases, technical terms, or named entities`;
}

/**
 * 获取输出格式要求 (v2)
 * 
 * 新增：confidence / uncertainties / responseMode 字段
 * 新增：根据 highlightMode 动态生成允许的任务类型
 */
function getOutputFormatInstruction(highlightMode: HighlightMode = 'none', sectionId: string = ''): string {
  const allowedHighlightKinds = getAllowedHighlightKinds(highlightMode);
  const highlightTaskInstruction = getHighlightTaskInstruction(highlightMode, sectionId);
  
  // 构建高亮任务示例
  let highlightTaskExample = '';
  if (allowedHighlightKinds.length > 0) {
    if (allowedHighlightKinds.includes('mark_key_terms')) {
      highlightTaskExample += `,
    {
      "type": "mark_key_terms",
      "params": {
        "sectionId": "${sectionId || '<section id>'}",
        "terms": [
          { "phrase": "关键概念", "occurrence": 1 },
          { "phrase": "核心术语" }
        ]
      }
    }`;
    }
    if (allowedHighlightKinds.includes('mark_key_sentences')) {
      highlightTaskExample += `,
    {
      "type": "mark_key_sentences",
      "params": {
        "sectionId": "${sectionId || '<section id>'}",
        "sentenceIndexes": [0]
      }
    }`;
    }
  }

  // 构建高亮模式说明
  const highlightModeNote = highlightMode !== 'none' 
    ? `\n\n注意：本次请求的高亮模式为「${highlightMode}」，允许的高亮任务: ${allowedHighlightKinds.join(', ') || '无'}`
    : '';

  return `OUTPUT FORMAT (STRICT):

Always respond using the following blocks (plain text, no Markdown code fences):

[assistant]
Your short natural-language acknowledgement for the user (1-2 sentences).
If responseMode is "clarify", this should be a specific question with 2-3 candidate options.

[intent]
{
  "intentId": "...",
  "scope": { "target": "section", "sectionId": "${sectionId || '<current section id>'}" },
  "tasks": [
    { "type": "rewrite", "params": { "tone": "formal", "depth": "medium" } }${highlightTaskExample}
  ],
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
${highlightModeNote}
${highlightTaskInstruction}
=== tasks 字段说明 ===

tasks 是一个任务数组，每个任务必须有 "type" 字段。

基础任务类型：
1. rewrite（重写）:
   { "type": "rewrite", "params": { "tone": "formal", "depth": "medium" } }

2. summarize（总结）:
   { "type": "summarize", "params": { "style": "bullet" } }

3. insert_block（插入内容块）:
   { "type": "insert_block", "params": { "blockType": "paragraph" } }

4. add_comment（添加批注）:
   { "type": "add_comment", "params": { "comment": "..." } }

高亮任务类型（根据 highlightMode 决定可用性）：
5. mark_key_terms（词语/短语级标记）:
   {
     "type": "mark_key_terms",
     "params": {
       "sectionId": "${sectionId || '<section id>'}",
       "terms": [
         { "phrase": "关键概念", "occurrence": 1 },
         { "phrase": "核心术语" }
       ]
     }
   }

6. mark_key_sentences（句子级标记）:
   {
     "type": "mark_key_sentences",
     "params": {
       "sectionId": "${sectionId || '<section id>'}",
       "sentenceIndexes": [0, 3]
     }
   }

7. mark_key_paragraphs（段落级标记）:
   {
     "type": "mark_key_paragraphs",
     "params": {
       "sectionId": "${sectionId || '<section id>'}",
       "paragraphIndexes": [0]
     }
   }

注意：
- 如果需要同时改写并标记重点，请返回多个任务
- 高亮任务只有在 highlightMode 允许时才能使用
- 当前允许的高亮任务: ${allowedHighlightKinds.length > 0 ? allowedHighlightKinds.join(', ') : '无（highlightMode = none）'}

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
    case 'highlight_section':
      return 'highlight';
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
  
  // 获取高亮模式（默认为 'none'）
  const highlightMode = (intent.options?.highlightMode as HighlightMode) || 'none';
  
  // 🆕 highlight 模式使用专门的 intent-only 输出格式
  const outputFormat = mode === 'highlight' 
    ? getHighlightOnlyOutputFormat(context.sectionId)
    : getOutputFormatInstruction(highlightMode, context.sectionId);

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

