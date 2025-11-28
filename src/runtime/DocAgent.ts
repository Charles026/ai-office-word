/**
 * DocAgent - 统一 AI 行为入口
 * 
 * 【职责】
 * - 统一管理所有 AI 文档操作（改写、翻译、总结、结构化等）
 * - 协调 DocTools 和 LlmService
 * - 返回结果供 Editor 层应用
 * 
 * 【架构位置】
 * UI (AiRewriteDialog) → DocAgent → LlmService → OpenRouter/OpenAI
 *                              ↓
 *                    返回结果 → Editor (replaceSelection / insertAfter)
 * 
 * 【设计原则】（参考 DocAgent 设计规则）
 * - 只做「局部 edit」，不做「整篇重写」
 * - Agent 调用少量核心工具，工具职责单一
 * - 每次 AI 修改可被 Undo
 * - 输出 debug log 便于问题排查
 * 
 * 【禁止事项】
 * - 不直接操作 DOM 或 Lexical Editor
 * - 不在此处做 UI 逻辑
 * - 不在不知道文档结构的前提下修改整篇文档
 */

import { LlmService, LlmResponse } from './LlmService';
import {
  REWRITE_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  STRUCTURE_SYSTEM_PROMPT,
  CUSTOM_SYSTEM_PROMPT,
  SECTION_REWRITE_SYSTEM_PROMPT,
  SECTION_SUMMARIZE_SYSTEM_PROMPT,
  SECTION_TRANSLATE_SYSTEM_PROMPT,
  buildRewriteUserMessage,
  buildSummarizeUserMessage,
  buildTranslateUserMessage,
  buildStructureUserMessage,
  buildCustomUserMessage,
  buildSectionRewriteUserMessage,
  buildSectionSummarizeUserMessage,
  buildSectionTranslateUserMessage,
  REWRITE_TONE_INSTRUCTIONS,
  TRANSLATE_LANG_INSTRUCTIONS,
  STRUCTURE_FORMAT_INSTRUCTIONS,
} from './promptTemplates/docAgent';
import {
  validateSelectionText,
  callLLM,
  checkLlmAvailability,
  logDocAgentAction,
} from './DocTools';

// ==========================================
// 类型定义
// ==========================================

/** 改写语气 */
export type RewriteTone = keyof typeof REWRITE_TONE_INSTRUCTIONS;

/** 翻译目标语言 */
export type TranslateTargetLang = keyof typeof TRANSLATE_LANG_INSTRUCTIONS;

/** 结构化格式 */
export type StructureFormat = keyof typeof STRUCTURE_FORMAT_INSTRUCTIONS;

/** DocAgent 意图类型 - 选区级 */
export interface DocAgentIntent {
  type: 'rewrite' | 'summarize' | 'translate' | 'structure' | 'custom';
  /** 改写语气（仅 type='rewrite' 时有效） */
  tone?: RewriteTone;
  /** 翻译目标语言（仅 type='translate' 时有效） */
  targetLang?: TranslateTargetLang;
  /** 结构化格式（仅 type='structure' 时有效） */
  format?: StructureFormat;
  /** 自定义提示词（仅 type='custom' 时有效） */
  customPrompt?: string;
}

/** 章节级 AI 意图类型 */
export type SectionIntentType = 
  | 'rewriteSection'
  | 'summarizeSection'
  | 'translateSection';

/** 章节级 AI 意图 */
export interface SectionIntent {
  type: SectionIntentType;
  /** 改写语气（仅 type='rewriteSection' 时有效） */
  tone?: RewriteTone;
  /** 翻译目标语言（仅 type='translateSection' 时有效） */
  targetLang?: TranslateTargetLang;
  /** 用户的附加说明 */
  userPrompt?: string;
}

/** 章节信息 */
export interface SectionInfo {
  /** 章节标题 */
  title: string;
  /** 章节内容（不含标题） */
  content: string;
}

/** DocAgent 操作类型 */
export type DocAgentAction = 
  | 'replace'      // 替换选区
  | 'insertAfter'; // 在选区后插入

/** DocAgent 响应 */
export interface DocAgentResponse {
  success: boolean;
  /** 生成的文本 */
  text?: string;
  /** 操作类型 */
  action: DocAgentAction;
  /** 错误信息 */
  error?: string;
  /** 延迟（毫秒） */
  latencyMs?: number;
}

/** DocAgent 上下文（可选，用于提供更多信息） */
export interface DocAgentContext {
  /** 选区前的文本（上下文） */
  beforeText?: string;
  /** 选区后的文本（上下文） */
  afterText?: string;
  /** 文档类型（可选） */
  documentType?: string;
}

// ==========================================
// DocAgent 类
// ==========================================

export class DocAgent {
  private llmService: LlmService;

  constructor(llmService: LlmService) {
    this.llmService = llmService;
  }

  /**
   * 统一入口：处理选区
   * 
   * @param intent - 用户意图
   * @param selectionText - 选中的文本
   * @param context - 可选的上下文信息
   */
  async handleSelection(
    intent: DocAgentIntent,
    selectionText: string,
    _context?: DocAgentContext
  ): Promise<DocAgentResponse> {
    const startTime = Date.now();
    
    // 验证选区
    const validation = validateSelectionText(selectionText);
    if (!validation.valid) {
      logDocAgentAction({
        action: 'handleSelection',
        intent: intent.type,
        success: false,
        error: validation.error,
      });
      return {
        success: false,
        action: 'replace',
        error: validation.error,
      };
    }

    // 检查 LLM 服务
    const availability = checkLlmAvailability(this.llmService);
    if (!availability.available) {
      logDocAgentAction({
        action: 'handleSelection',
        intent: intent.type,
        success: false,
        error: availability.error,
      });
      return {
        success: false,
        action: 'replace',
        error: availability.error,
      };
    }

    // 根据意图分发到对应处理函数
    let result: DocAgentResponse;
    
    switch (intent.type) {
      case 'rewrite':
        result = await this.rewriteSelection(selectionText, intent.tone || 'formal');
        break;
      
      case 'summarize':
        result = await this.summarizeSelection(selectionText);
        break;
      
      case 'translate':
        result = await this.translateSelection(selectionText, intent.targetLang || 'en');
        break;
      
      case 'structure':
        result = await this.structureSelection(selectionText, intent.format || 'bullets');
        break;
      
      case 'custom':
        result = await this.customRewrite(selectionText, intent.customPrompt || '');
        break;
      
      default:
        result = {
          success: false,
          action: 'replace',
          error: `未知的意图类型: ${(intent as any).type}`,
        };
    }

    // 记录日志
    const latencyMs = Date.now() - startTime;
    logDocAgentAction({
      action: 'handleSelection',
      intent: intent.type,
      inputLength: selectionText.length,
      outputLength: result.text?.length,
      latencyMs,
      success: result.success,
      error: result.error,
    });

    return { ...result, latencyMs };
  }

  /**
   * 改写选区
   */
  private async rewriteSelection(
    selectionText: string,
    tone: RewriteTone
  ): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: REWRITE_SYSTEM_PROMPT,
      userMessage: buildRewriteUserMessage(selectionText, tone),
    });

    return this.formatResponse(result, 'replace');
  }

  /**
   * 总结选区
   * 
   * 注意：总结操作返回 action='insertAfter'，
   * 表示应该在选区后插入新段落，而不是替换选区
   */
  private async summarizeSelection(selectionText: string): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      userMessage: buildSummarizeUserMessage(selectionText),
    });

    return this.formatResponse(result, 'insertAfter');
  }

  /**
   * 翻译选区
   */
  private async translateSelection(
    selectionText: string,
    targetLang: TranslateTargetLang
  ): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: TRANSLATE_SYSTEM_PROMPT,
      userMessage: buildTranslateUserMessage(selectionText, targetLang),
    });

    return this.formatResponse(result, 'replace');
  }

  /**
   * 结构化选区
   */
  private async structureSelection(
    selectionText: string,
    format: StructureFormat
  ): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: STRUCTURE_SYSTEM_PROMPT,
      userMessage: buildStructureUserMessage(selectionText, format),
    });

    return this.formatResponse(result, 'replace');
  }

  /**
   * 自定义改写（用于用户输入的任意提示词）
   */
  private async customRewrite(
    selectionText: string,
    customPrompt: string
  ): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: CUSTOM_SYSTEM_PROMPT,
      userMessage: buildCustomUserMessage(selectionText, customPrompt),
    });

    return this.formatResponse(result, 'replace');
  }

  /**
   * 格式化响应
   */
  private formatResponse(
    llmResponse: LlmResponse,
    action: DocAgentAction
  ): DocAgentResponse {
    if (llmResponse.success && llmResponse.text) {
      return {
        success: true,
        text: llmResponse.text,
        action,
        latencyMs: llmResponse.latencyMs,
      };
    }

    return {
      success: false,
      action,
      error: llmResponse.error || 'AI 处理失败',
      latencyMs: llmResponse.latencyMs,
    };
  }

  // ==========================================
  // 章节级操作
  // ==========================================

  /**
   * 统一入口：处理章节
   * 
   * @param intent - 章节级意图
   * @param section - 章节信息（标题 + 内容）
   */
  async handleSection(
    intent: SectionIntent,
    section: SectionInfo
  ): Promise<DocAgentResponse> {
    const startTime = Date.now();
    
    // 验证章节内容
    const validation = validateSelectionText(section.content);
    if (!validation.valid) {
      logDocAgentAction({
        action: 'handleSection',
        intent: intent.type,
        success: false,
        error: validation.error,
      });
      return {
        success: false,
        action: 'replace',
        error: validation.error,
      };
    }

    // 检查 LLM 服务
    const availability = checkLlmAvailability(this.llmService);
    if (!availability.available) {
      logDocAgentAction({
        action: 'handleSection',
        intent: intent.type,
        success: false,
        error: availability.error,
      });
      return {
        success: false,
        action: 'replace',
        error: availability.error,
      };
    }

    // 根据意图分发到对应处理函数
    let result: DocAgentResponse;
    
    switch (intent.type) {
      case 'rewriteSection':
        result = await this.rewriteSection(section, intent.tone || 'formal');
        break;
      
      case 'summarizeSection':
        result = await this.summarizeSection(section);
        break;
      
      case 'translateSection':
        result = await this.translateSection(section, intent.targetLang || 'en');
        break;
      
      default:
        result = {
          success: false,
          action: 'replace',
          error: `未知的章节意图类型: ${(intent as any).type}`,
        };
    }

    // 记录日志
    const latencyMs = Date.now() - startTime;
    logDocAgentAction({
      action: 'handleSection',
      intent: intent.type,
      inputLength: section.content.length,
      outputLength: result.text?.length,
      latencyMs,
      success: result.success,
      error: result.error,
    });

    return { ...result, latencyMs };
  }

  /**
   * 改写章节
   */
  private async rewriteSection(
    section: SectionInfo,
    tone: RewriteTone
  ): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: SECTION_REWRITE_SYSTEM_PROMPT,
      userMessage: buildSectionRewriteUserMessage(section.title, section.content, tone),
    });

    return this.formatResponse(result, 'replace');
  }

  /**
   * 总结章节
   * 
   * 注意：总结操作返回 action='insertAfter'，
   * 表示应该在章节末尾插入摘要段落
   */
  private async summarizeSection(section: SectionInfo): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: SECTION_SUMMARIZE_SYSTEM_PROMPT,
      userMessage: buildSectionSummarizeUserMessage(section.title, section.content),
    });

    return this.formatResponse(result, 'insertAfter');
  }

  /**
   * 翻译章节
   */
  private async translateSection(
    section: SectionInfo,
    targetLang: TranslateTargetLang
  ): Promise<DocAgentResponse> {
    const result = await callLLM(this.llmService, {
      systemPrompt: SECTION_TRANSLATE_SYSTEM_PROMPT,
      userMessage: buildSectionTranslateUserMessage(section.title, section.content, targetLang),
    });

    return this.formatResponse(result, 'replace');
  }
}

// ==========================================
// 辅助函数：从 UI 按钮映射到 Intent
// ==========================================

/**
 * 从预设按钮标签映射到 DocAgentIntent
 */
export function mapPresetToIntent(presetLabel: string): DocAgentIntent | null {
  switch (presetLabel) {
    case '更正式':
      return { type: 'rewrite', tone: 'formal' };
    case '更简洁':
      return { type: 'rewrite', tone: 'concise' };
    case '更友好':
      return { type: 'rewrite', tone: 'friendly' };
    case '翻译英文':
      return { type: 'translate', targetLang: 'en' };
    case '翻译中文':
      return { type: 'translate', targetLang: 'zh' };
    case '总结':
      return { type: 'summarize' };
    case '改成列表':
      return { type: 'structure', format: 'bullets' };
    case '改成编号':
      return { type: 'structure', format: 'numbered' };
    case '分段':
      return { type: 'structure', format: 'paragraphs' };
    case '加小标题':
      return { type: 'structure', format: 'headings' };
    default:
      return null;
  }
}

/**
 * 从用户输入的提示词推断 Intent
 * 
 * 如果能匹配到预设意图，返回对应的 Intent
 * 否则返回 custom 类型
 */
export function inferIntentFromPrompt(prompt: string): DocAgentIntent {
  const normalizedPrompt = prompt.trim().toLowerCase();

  // 尝试匹配改写意图
  if (normalizedPrompt.includes('正式') || normalizedPrompt.includes('formal')) {
    return { type: 'rewrite', tone: 'formal' };
  }
  if (normalizedPrompt.includes('简洁') || normalizedPrompt.includes('concise') || normalizedPrompt.includes('精简')) {
    return { type: 'rewrite', tone: 'concise' };
  }
  if (normalizedPrompt.includes('友好') || normalizedPrompt.includes('亲切') || normalizedPrompt.includes('friendly')) {
    return { type: 'rewrite', tone: 'friendly' };
  }

  // 尝试匹配翻译意图
  if (normalizedPrompt.includes('翻译成英文') || normalizedPrompt.includes('translate to english') || normalizedPrompt.includes('英文')) {
    return { type: 'translate', targetLang: 'en' };
  }
  if (normalizedPrompt.includes('翻译成中文') || normalizedPrompt.includes('translate to chinese') || normalizedPrompt.includes('中文')) {
    return { type: 'translate', targetLang: 'zh' };
  }

  // 尝试匹配总结意图
  if (normalizedPrompt.includes('总结') || normalizedPrompt.includes('摘要') || normalizedPrompt.includes('summarize') || normalizedPrompt.includes('summary')) {
    return { type: 'summarize' };
  }

  // 尝试匹配结构化意图（编号优先于列表，因为"编号列表"包含"列表"）
  if (normalizedPrompt.includes('编号') || normalizedPrompt.includes('numbered')) {
    return { type: 'structure', format: 'numbered' };
  }
  if (normalizedPrompt.includes('列表') || normalizedPrompt.includes('条目') || normalizedPrompt.includes('bullets')) {
    return { type: 'structure', format: 'bullets' };
  }
  if (normalizedPrompt.includes('分段') || normalizedPrompt.includes('段落')) {
    return { type: 'structure', format: 'paragraphs' };
  }
  if (normalizedPrompt.includes('小标题') || normalizedPrompt.includes('标题') || normalizedPrompt.includes('headings')) {
    return { type: 'structure', format: 'headings' };
  }

  // 默认：自定义改写
  return { type: 'custom', customPrompt: prompt };
}

// 导出类型
export type { LlmResponse };
