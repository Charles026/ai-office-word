/**
 * DocContextEngine - 文档上下文引擎
 * 
 * 【职责】
 * - 从 Document AST / Outline / SectionContext 构建统一的上下文快照
 * - 为 Copilot / DocAgent 提供结构化的文档信息
 * 
 * 【设计原则】
 * - 只读：不修改文档
 * - 纯函数：不调用 LLM
 * - 解耦：只依赖数据访问层，不依赖 UI
 * 
 * 【版本】
 * - v1：只支持 scope='section'，不做复杂压缩
 */

import { LexicalEditor } from 'lexical';
import {
  BuildContextOptions,
  DocContextEnvelope,
  DocContextError,
  OutlineEntry,
  FocusContext,
  NeighborhoodContext,
  GlobalContext,
  SectionPreview,
} from './docContextTypes';
import { extractSectionContext, getSectionFullText } from '../runtime/context';
import { generateOutlineFromEditor } from '../outline/outlineUtils';
import type { OutlineItem } from '../outline/types';

// ==========================================
// 常量
// ==========================================

const GENERATOR_VERSION = 'v1.1'; // 更新版本号，支持 document scope
const DEFAULT_MAX_TOKENS = 4096;
const SECTION_SNIPPET_LENGTH = 250; // 每个章节预览的字符数

// DEV 模式
const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

// ==========================================
// 辅助函数
// ==========================================

/**
 * 估算 token 数（简化版：字符数 / 3）
 */
function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 3);
}

/**
 * 将 OutlineItem 转换为 OutlineEntry
 */
function convertOutlineItem(item: OutlineItem): OutlineEntry {
  return {
    sectionId: item.id,
    title: item.text,
    level: item.level,
    // v1 不填 summary
  };
}

/**
 * 从大纲中查找章节标题
 */
function findSectionTitleFromOutline(
  outline: OutlineItem[],
  sectionId: string
): string | null {
  const item = outline.find(o => o.id === sectionId);
  return item?.text ?? null;
}

/**
 * 从大纲中推断文档标题
 * 
 * 规则：
 * 1. 如果有 H1，取第一个 H1
 * 2. 否则取第一个 H2
 * 3. 都没有返回 null
 */
function inferDocTitleFromOutline(outline: OutlineItem[]): string | null {
  const h1 = outline.find(o => o.level === 1);
  if (h1) return h1.text;
  
  const h2 = outline.find(o => o.level === 2);
  if (h2) return h2.text;
  
  return null;
}

// ==========================================
// 主函数
// ==========================================

/**
 * 构建文档上下文信封
 * 
 * 支持的 scope：
 * - 'section': 聚焦单个章节（需要 sectionId）
 * - 'document': 整篇文档概览（提供所有章节的预览）
 * 
 * @param options - 构建参数
 * @param editor - Lexical 编辑器实例
 * @returns DocContextEnvelope
 * @throws DocContextError
 */
export async function buildDocContextEnvelope(
  options: BuildContextOptions,
  editor: LexicalEditor
): Promise<DocContextEnvelope> {
  const { docId, scope, sectionId, maxTokens = DEFAULT_MAX_TOKENS } = options;

  if (__DEV__) {
    console.debug('[DocContextEngine] Building envelope:', { docId, scope, sectionId });
  }

  // 根据 scope 分发到不同的构建逻辑
  if (scope === 'document') {
    return buildDocumentScopeEnvelope(docId, editor, maxTokens);
  }

  if (scope === 'section') {
    return buildSectionScopeEnvelope(docId, sectionId, editor, maxTokens);
  }

  // selection scope 暂不支持
  throw new DocContextError(
    `Scope "${scope}" is not yet supported. Use "section" or "document".`
  );
}

/**
 * 构建 document scope 的信封
 * 
 * 提供整篇文档的结构化快照：
 * - 完整大纲
 * - 每个章节的预览（标题 + 前 N 字符）
 * - 总字符数和 token 估算
 */
async function buildDocumentScopeEnvelope(
  docId: string,
  editor: LexicalEditor,
  maxTokens: number
): Promise<DocContextEnvelope> {
  // 1. 获取大纲
  const outlineItems = generateOutlineFromEditor(editor);
  const outline: OutlineEntry[] = outlineItems.map(convertOutlineItem);

  if (__DEV__) {
    console.debug('[DocContextEngine] Document scope - outline items:', outlineItems.length);
  }

  // 2. 推断文档标题
  const docTitle = inferDocTitleFromOutline(outlineItems);

  // 3. 构建各章节预览
  const sectionsPreview: SectionPreview[] = [];
  let totalCharCount = 0;

  for (const item of outlineItems) {
    try {
      const sectionContext = extractSectionContext(editor, item.id);
      let sectionText = '';
      
      if (sectionContext) {
        sectionText = getSectionFullText(sectionContext);
      }
      
      const charCount = sectionText.length;
      totalCharCount += charCount;
      
      // 截取预览片段
      const snippet = sectionText.slice(0, SECTION_SNIPPET_LENGTH).trim();
      const hasMore = sectionText.length > SECTION_SNIPPET_LENGTH;
      
      sectionsPreview.push({
        sectionId: item.id,
        title: item.text,
        level: item.level,
        snippet: hasMore ? snippet + '...' : snippet,
        charCount,
      });
    } catch (err) {
      if (__DEV__) {
        console.warn('[DocContextEngine] Failed to extract section:', item.id, err);
      }
      // 即使提取失败，也添加一个空预览
      sectionsPreview.push({
        sectionId: item.id,
        title: item.text,
        level: item.level,
        snippet: '(内容提取失败)',
        charCount: 0,
      });
    }
  }

  const approxTotalTokenCount = estimateTokens(totalCharCount);

  // 4. 构建 Focus（document scope 时为空焦点）
  const focus: FocusContext = {
    sectionId: null,
    sectionTitle: null,
    text: '', // document scope 不提供单一焦点文本
    charCount: 0,
    approxTokenCount: 0,
  };

  // 5. 构建 Neighborhood（document scope 时不适用）
  const neighborhood: NeighborhoodContext = {};

  // 6. 构建 Global
  const global: GlobalContext = {
    title: docTitle,
    outline,
    totalCharCount,
    approxTotalTokenCount,
    sectionsPreview,
  };

  // 7. 组装 Envelope
  const envelope: DocContextEnvelope = {
    docId,
    scope: 'document',
    focus,
    neighborhood,
    global,
    budget: {
      maxTokens,
      estimatedTokens: approxTotalTokenCount,
    },
    meta: {
      generatedAt: Date.now(),
      generatorVersion: GENERATOR_VERSION,
    },
  };

  if (__DEV__) {
    console.debug('[DocContextEngine] Document envelope built:', {
      docId,
      title: docTitle,
      sectionCount: sectionsPreview.length,
      totalCharCount,
      approxTotalTokenCount,
    });
  }

  return envelope;
}

/**
 * 构建 section scope 的信封（原有逻辑）
 */
async function buildSectionScopeEnvelope(
  docId: string,
  sectionId: string | undefined,
  editor: LexicalEditor,
  maxTokens: number
): Promise<DocContextEnvelope> {
  if (!sectionId) {
    throw new DocContextError('sectionId is required when scope="section"');
  }

  // 1. 获取大纲
  const outlineItems = generateOutlineFromEditor(editor);
  const outline: OutlineEntry[] = outlineItems.map(convertOutlineItem);

  if (__DEV__) {
    console.debug('[DocContextEngine] Section scope - outline items:', outlineItems.length);
  }

  // 2. 获取章节标题
  const sectionTitle = findSectionTitleFromOutline(outlineItems, sectionId);

  // 3. 获取章节内容
  let sectionText = '';

  try {
    const sectionContext = extractSectionContext(editor, sectionId);
    if (sectionContext) {
      sectionText = getSectionFullText(sectionContext);
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[DocContextEngine] Failed to extract section context:', err);
    }
    sectionText = '';
  }

  const charCount = sectionText.length;
  const approxTokenCount = estimateTokens(charCount);

  // 4. 推断文档标题
  const docTitle = inferDocTitleFromOutline(outlineItems);

  // 5. 构建 Focus
  const focus: FocusContext = {
    sectionId,
    sectionTitle,
    text: sectionText,
    charCount,
    approxTokenCount,
  };

  // 6. 构建 Neighborhood（v1 先占位）
  const neighborhood: NeighborhoodContext = {};

  // 7. 构建 Global
  const global: GlobalContext = {
    title: docTitle,
    outline,
  };

  // 8. 组装 Envelope
  const envelope: DocContextEnvelope = {
    docId,
    scope: 'section',
    focus,
    neighborhood,
    global,
    budget: {
      maxTokens,
      estimatedTokens: approxTokenCount,
    },
    meta: {
      generatedAt: Date.now(),
      generatorVersion: GENERATOR_VERSION,
    },
  };

  if (__DEV__) {
    console.debug('[DocContextEngine] Section envelope built:', {
      docId,
      sectionTitle,
      charCount,
      approxTokenCount,
      outlineCount: outline.length,
    });
  }

  return envelope;
}

// ==========================================
// 辅助导出
// ==========================================

/**
 * 构建 System Prompt 的选项
 */
export interface BuildSystemPromptOptions {
  /** 行为摘要（可选） */
  behaviorSummary?: string;
}

/**
 * 从 DocContextEnvelope 构建 LLM System Prompt
 * 
 * 这是一个便捷方法，将 Envelope 转换为适合 LLM 的 system prompt
 * 
 * @param envelope - 文档上下文信封
 * @param options - 构建选项（可选）
 */
export function buildSystemPromptFromEnvelope(
  envelope: DocContextEnvelope,
  options?: BuildSystemPromptOptions
): string {
  const parts: string[] = [];

  // 根据 scope 选择不同的基础提示
  if (envelope.scope === 'document') {
    parts.push(buildDocumentScopeSystemPrompt(envelope));
  } else {
    parts.push(buildSectionScopeSystemPrompt(envelope));
  }

  // 🆕 行为摘要（用户最近的操作）
  if (options?.behaviorSummary && options.behaviorSummary.trim()) {
    parts.push(`\n## 用户最近的操作：\n${options.behaviorSummary}`);
  }

  return parts.join('\n');
}

/**
 * 构建 document scope 的系统提示
 * 
 * 关键：告诉 LLM 它已经能看到整篇文档的结构化快照
 */
function buildDocumentScopeSystemPrompt(envelope: DocContextEnvelope): string {
  const parts: string[] = [];

  // 基础角色定义 + 文档上下文说明
  parts.push(`你是 AI Office 的写作助手 Copilot，嵌入在一个本地 AI Word 编辑器中。

🔑 **重要说明**：系统已经向你提供了当前文档的完整结构化快照。
你可以基于下方的「文档大纲」和「各章节预览」来理解文档内容，直接回答用户的问题。
不要回复"我看不到文档内容"这类话——你已经拥有文档的上下文信息。

你的能力：
1. **理解文档结构**：基于大纲和章节预览，理解整篇文档的组织和主题
2. **回答问题**：基于已提供的上下文，帮助用户理解文档内容
3. **总结概括**：生成文档摘要、提取关键点、对比章节内容
4. **写作建议**：基于文档结构提供改进建议

规则：
- 用中文回复，除非用户明确要求其他语言
- 基于已提供的文档快照回答问题，不要说"看不到内容"
- 如果章节预览不够详细，可以请用户提供特定段落的完整内容
- 回复要简洁有力，避免冗长`);

  // 文档标题
  if (envelope.global.title) {
    parts.push(`\n## 📄 当前文档：「${envelope.global.title}」`);
  }

  // 文档统计
  if (envelope.global.totalCharCount !== undefined) {
    parts.push(`\n📊 文档规模：约 ${envelope.global.totalCharCount} 字 / ${envelope.global.approxTotalTokenCount} tokens`);
  }

  // 大纲信息
  if (envelope.global.outline.length > 0) {
    const outlineText = envelope.global.outline
      .map(o => `${'  '.repeat(o.level - 1)}- ${o.title}`)
      .join('\n');
    parts.push(`\n## 📑 文档大纲：\n${outlineText}`);
  }

  // 各章节预览
  if (envelope.global.sectionsPreview && envelope.global.sectionsPreview.length > 0) {
    parts.push(`\n## 📖 各章节预览：`);
    
    for (const section of envelope.global.sectionsPreview) {
      const indent = '  '.repeat(section.level - 1);
      parts.push(`\n${indent}### ${section.title} (${section.charCount} 字)`);
      if (section.snippet && section.snippet !== '(内容提取失败)') {
        parts.push(`${indent}> ${section.snippet}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * 构建 section scope 的系统提示（原有逻辑）
 */
function buildSectionScopeSystemPrompt(envelope: DocContextEnvelope): string {
  const parts: string[] = [];

  // 基础角色定义
  parts.push(`你是 AI Office 的写作助手 Copilot，嵌入在一个本地 AI Word 编辑器中。

你的能力：
1. 理解用户正在编辑的文档结构和内容
2. 根据用户指令对文档进行改写、总结、翻译等操作
3. 提供专业、简洁、有帮助的回复

规则：
- 用中文回复，除非用户明确要求其他语言
- 回复要简洁有力，避免冗长
- 如果不确定，诚实说明
- 不要编造不存在的信息`);

  // 文档信息
  if (envelope.global.title) {
    parts.push(`\n## 当前文档：${envelope.global.title}`);
  }

  // 大纲信息
  if (envelope.global.outline.length > 0) {
    const outlineText = envelope.global.outline
      .map(o => `${'  '.repeat(o.level - 1)}- ${o.title}`)
      .join('\n');
    parts.push(`\n## 文档大纲：\n${outlineText}`);
  }

  // 当前焦点
  if (envelope.scope === 'section' && envelope.focus.sectionTitle) {
    parts.push(`\n## 当前聚焦章节：「${envelope.focus.sectionTitle}」`);
  }

  return parts.join('\n');
}

/**
 * 从 DocContextEnvelope 构建 LLM User Prompt
 * 
 * 将用户输入 + 焦点内容组合成 user message
 */
export function buildUserPromptFromEnvelope(
  envelope: DocContextEnvelope,
  userInput: string
): string {
  const parts: string[] = [];

  // 用户指令
  parts.push(`用户指令：${userInput}`);

  // 根据 scope 添加不同的上下文
  if (envelope.scope === 'section' && envelope.focus.text) {
    // section scope：提供当前章节完整内容
    parts.push(`\n---\n以下是当前章节「${envelope.focus.sectionTitle || '未命名'}」的内容：\n\n${envelope.focus.text}`);
  } else if (envelope.scope === 'document') {
    // document scope：不需要额外内容，system prompt 已包含所有信息
    parts.push(`\n（你已经在 system prompt 中获得了整篇文档的结构化快照，请基于此回答上述问题）`);
  }

  return parts.join('\n');
}

