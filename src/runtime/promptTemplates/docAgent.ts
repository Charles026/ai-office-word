/**
 * DocAgent Prompt 模板
 * 
 * 集中维护与 DocAgent 相关的所有 prompt。
 * 
 * 【设计原则】
 * - 只改写「给定的 selectionText」，不要生成整篇
 * - 保持原有语种 / 改变语种（视场景而定）
 * - 保持内容事实不变，主要改写表达方式
 * - 输出格式简洁，不带 markdown / 引号 / 解释
 */

// ==========================================
// 改写 Prompt
// ==========================================

export const REWRITE_SYSTEM_PROMPT = `你是一个专业的文本改写助手。请按照指定的语气改写文本。

规则：
1. 只输出改写后的文本，不要解释、不加引号、不带 markdown 格式
2. 保持原文的核心含义不变
3. 保持原文的段落结构（如果有多段，用换行分隔）
4. 输出长度应与原文相近
5. 不要添加任何前缀或后缀说明`;

export const REWRITE_TONE_INSTRUCTIONS = {
  formal: '请将文本改写成更正式、专业的语气。使用书面语，避免口语化表达。',
  concise: '请将文本改写得更简洁精炼。删除冗余表达，保留核心信息。',
  friendly: '请将文本改写成更友好、亲切的语气。使用温和的表达方式。',
} as const;

export function buildRewriteUserMessage(selectionText: string, tone: keyof typeof REWRITE_TONE_INSTRUCTIONS): string {
  return `${REWRITE_TONE_INSTRUCTIONS[tone]}

原文：
${selectionText}

请直接输出改写后的文本：`;
}

// ==========================================
// 总结 Prompt
// ==========================================

export const SUMMARIZE_SYSTEM_PROMPT = `你是一个专业的文本摘要助手。请为给定文本生成简洁的摘要。

规则：
1. 只输出摘要内容，不要加"总结："等前缀
2. 不要解释、不加引号、不带 markdown 格式
3. 摘要应该是 1-3 句话，抓住核心要点
4. 不要扩写，只做压缩提炼
5. 保持客观，不添加个人观点`;

export function buildSummarizeUserMessage(selectionText: string): string {
  return `请为以下文本生成摘要：

${selectionText}

请直接输出摘要：`;
}

// ==========================================
// 翻译 Prompt
// ==========================================

export const TRANSLATE_SYSTEM_PROMPT = `你是一个专业的翻译助手。请准确翻译给定文本。

规则：
1. 只输出译文，不要解释、不加引号、不带 markdown 格式
2. 保持原文的段落结构（如果有多段，用换行分隔）
3. 翻译要准确、自然、流畅
4. 专业术语保持一致性
5. 不要添加任何注释或说明`;

export const TRANSLATE_LANG_INSTRUCTIONS = {
  en: '请将文本翻译成英文。',
  zh: '请将文本翻译成中文。',
} as const;

export function buildTranslateUserMessage(selectionText: string, targetLang: keyof typeof TRANSLATE_LANG_INSTRUCTIONS): string {
  return `${TRANSLATE_LANG_INSTRUCTIONS[targetLang]}

原文：
${selectionText}

请直接输出译文：`;
}

// ==========================================
// 结构化 Prompt
// ==========================================

export const STRUCTURE_SYSTEM_PROMPT = `你是一个专业的文本结构化助手。请按照指定的格式重新组织文本。

规则：
1. 只输出结构化后的文本，不要解释
2. 不加引号、不带 markdown 格式（除非要求输出列表）
3. 保持原文的核心内容不变
4. 只改变组织形式，不改变事实`;

export const STRUCTURE_FORMAT_INSTRUCTIONS = {
  bullets: '请将文本改写成项目符号列表形式。每个要点用 "• " 开头。',
  numbered: '请将文本改写成编号列表形式。每个要点用 "1. 2. 3." 等编号。',
  paragraphs: '请将文本重新组织成清晰的段落，每段一个主题。',
  headings: '请为文本添加适当的小标题，使结构更清晰。',
} as const;

export function buildStructureUserMessage(selectionText: string, format: keyof typeof STRUCTURE_FORMAT_INSTRUCTIONS): string {
  return `${STRUCTURE_FORMAT_INSTRUCTIONS[format]}

原文：
${selectionText}

请直接输出结构化后的文本：`;
}

// ==========================================
// 自定义 Prompt
// ==========================================

export const CUSTOM_SYSTEM_PROMPT = `你是一个专业的文本改写助手。用户会给你一段原文和改写要求，请按要求改写文本。

规则：
1. 只输出改写后的文本，不要解释、不加引号、不带 markdown 格式
2. 保持原文的核心含义
3. 如果是翻译任务，只输出翻译结果
4. 如果是总结任务，只输出总结内容
5. 严格按照用户的改写要求执行`;

export function buildCustomUserMessage(selectionText: string, customPrompt: string): string {
  return `原文：
${selectionText}

改写要求：${customPrompt}

请直接输出改写后的文本：`;
}

// ==========================================
// 章节级 Prompt
// ==========================================

export const SECTION_REWRITE_SYSTEM_PROMPT = `你是一个专业的文档章节改写助手。请按照指定的语气改写整个章节内容。

规则：
1. 只输出改写后的章节内容，不要解释、不加引号、不带 markdown 格式
2. 保持章节的核心含义和信息结构不变
3. 保持原有的段落结构（用换行分隔段落）
4. 不要改变标题本身，只改写标题下的内容
5. 保留关键信息和要点`;

export const SECTION_SUMMARIZE_SYSTEM_PROMPT = `你是一个专业的文档章节摘要助手。请为给定章节生成简洁的摘要。

规则：
1. 只输出摘要内容，不要加"总结："等前缀
2. 不要解释、不加引号、不带 markdown 格式
3. 摘要应该是 3-5 句话，抓住章节的核心要点
4. 不要扩写，只做压缩提炼
5. 保持客观，不添加个人观点`;

export const SECTION_TRANSLATE_SYSTEM_PROMPT = `你是一个专业的文档章节翻译助手。请准确翻译给定章节内容。

规则：
1. 只输出译文，不要解释、不加引号、不带 markdown 格式
2. 保持原文的段落结构（用换行分隔段落）
3. 翻译要准确、自然、流畅
4. 专业术语保持一致性
5. 不要添加任何注释或说明
6. 如果输入包含 [TITLE]...[/TITLE] 标记，请保持这个格式，翻译标记内的内容`;

export function buildSectionRewriteUserMessage(
  sectionTitle: string,
  sectionContent: string,
  tone: keyof typeof REWRITE_TONE_INSTRUCTIONS
): string {
  // 检查内容是否包含 [TITLE] 标记
  if (sectionContent.includes('[TITLE]')) {
    return `${REWRITE_TONE_INSTRUCTIONS[tone]}

请改写以下章节内容。保持 [TITLE]...[/TITLE] 格式，改写标记内和标记外的所有内容：

${sectionContent}

请直接输出改写后的内容，保持 [TITLE]...[/TITLE] 格式：`;
  }
  
  return `${REWRITE_TONE_INSTRUCTIONS[tone]}

章节标题：${sectionTitle}

章节内容：
${sectionContent}

请直接输出改写后的章节内容（不含标题）：`;
}

export function buildSectionSummarizeUserMessage(
  sectionTitle: string,
  sectionContent: string
): string {
  return `请为以下章节生成摘要：

章节标题：${sectionTitle}

章节内容：
${sectionContent}

请直接输出摘要：`;
}

export function buildSectionTranslateUserMessage(
  sectionTitle: string,
  sectionContent: string,
  targetLang: keyof typeof TRANSLATE_LANG_INSTRUCTIONS
): string {
  // 检查内容是否包含 [TITLE] 标记
  if (sectionContent.includes('[TITLE]')) {
    return `${TRANSLATE_LANG_INSTRUCTIONS[targetLang]}

请翻译以下章节内容。保持 [TITLE]...[/TITLE] 格式，翻译标记内和标记外的所有内容：

${sectionContent}

请直接输出翻译后的内容，保持 [TITLE]...[/TITLE] 格式：`;
  }
  
  return `${TRANSLATE_LANG_INSTRUCTIONS[targetLang]}

章节标题：${sectionTitle}

章节内容：
${sectionContent}

请直接输出译文（不含标题）：`;
}

