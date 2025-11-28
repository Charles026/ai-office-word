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
} from './docContextTypes';
import { extractSectionContext, getSectionFullText } from '../runtime/context';
import { generateOutlineFromEditor } from '../outline/outlineUtils';
import type { OutlineItem } from '../outline/types';

// ==========================================
// 常量
// ==========================================

const GENERATOR_VERSION = 'v1';
const DEFAULT_MAX_TOKENS = 4096;

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
 * v1 版本只支持 scope='section'
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

  // v1 只支持 scope='section'
  if (scope !== 'section') {
    throw new DocContextError(
      `Only scope="section" is supported in v1, got: ${scope}`
    );
  }

  if (!sectionId) {
    throw new DocContextError('sectionId is required when scope="section"');
  }

  // 1. 获取大纲
  const outlineItems = generateOutlineFromEditor(editor);
  const outline: OutlineEntry[] = outlineItems.map(convertOutlineItem);

  if (__DEV__) {
    console.debug('[DocContextEngine] Outline items:', outlineItems.length);
  }

  // 2. 获取章节标题
  const sectionTitle = findSectionTitleFromOutline(outlineItems, sectionId);

  // 3. 获取章节内容
  let sectionText = '';
  let sectionContext = null;

  try {
    sectionContext = extractSectionContext(editor, sectionId);
    if (sectionContext) {
      // 使用 subtreeParagraphs 获取整个章节的文本
      sectionText = getSectionFullText(sectionContext);
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[DocContextEngine] Failed to extract section context:', err);
    }
    // 如果提取失败，使用空文本
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
    // selectionSnippet 在 scope=section 时不填
  };

  // 6. 构建 Neighborhood（v1 先占位）
  const neighborhood: NeighborhoodContext = {
    // TODO v2: 填充前后章节信息
  };

  // 7. 构建 Global
  const global: GlobalContext = {
    title: docTitle,
    outline,
    // docSummary 在 v1 不填
  };

  // 8. 组装 Envelope
  const envelope: DocContextEnvelope = {
    docId,
    scope,
    focus,
    neighborhood,
    global,
    budget: {
      maxTokens,
      estimatedTokens: approxTokenCount, // v1 仅估计 focus
    },
    meta: {
      generatedAt: Date.now(),
      generatorVersion: GENERATOR_VERSION,
    },
  };

  if (__DEV__) {
    console.debug('[DocContextEngine] Envelope built:', {
      docId,
      scope,
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

  // 🆕 行为摘要（用户最近的操作）
  if (options?.behaviorSummary && options.behaviorSummary.trim()) {
    parts.push(`\n## 用户最近的操作：\n${options.behaviorSummary}`);
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

  // 当前章节内容（如果有）
  if (envelope.scope === 'section' && envelope.focus.text) {
    parts.push(`\n---\n以下是当前章节「${envelope.focus.sectionTitle || '未命名'}」的内容：\n\n${envelope.focus.text}`);
  }

  return parts.join('\n');
}

