/**
 * AI IPC Handlers - AI 功能的 IPC 处理器
 * 
 * 【职责】
 * - 接收 renderer 的 AI 请求
 * - 调用 DocAgent 执行 AI 任务
 * - 返回结果给 renderer
 * 
 * 【禁止事项】
 * - 不直接修改 AST（只生成 DocOps）
 * - 不在此处做文件 I/O
 */

import { ipcMain } from 'electron';
import { DocumentAst, getTextInSelection, isValidSelection } from '../../document/types';
import { DocSelection, DocOp } from '../../docops/types';
import { docOpsEngine } from '../../docops/DocOpsEngine';
import { llmService } from '../../runtime/LlmService';
import { 
  DocAgent, 
  DocAgentIntent, 
  DocAgentResponse, 
  SectionIntent, 
  SectionInfo
} from '../../runtime/DocAgent';
import { RewriteSelectionResponse } from '../../runtime/types';

// 创建 DocAgent 实例
const docAgent = new DocAgent(llmService);

// ==========================================
// 请求/响应类型
// ==========================================

interface RewriteSelectionRequest {
  ast?: DocumentAst; // Optional now
  selection?: DocSelection; // Optional now
  selectionText?: string; // Direct text input
  userPrompt: string;
}

/** DocAgent 请求（新版） */
interface DocAgentRequest {
  selectionText: string;
  intent: DocAgentIntent;
}

// ==========================================
// Handlers
// ==========================================

/**
 * 注册 AI IPC handlers
 */
export function registerAiHandlers(): void {
  /**
   * AI 改写选区
   * 
   * 流程：
   * 1. 从 AST + selection 提取选区文本
   * 2. 调用 LLM 进行改写
   * 3. 调用 DocOpsEngine 生成 DocOps
   * 4. 返回结果
   */
  ipcMain.handle(
    'ai:rewrite-selection',
    async (_, request: RewriteSelectionRequest): Promise<RewriteSelectionResponse> => {
      console.log('[aiHandlers] Received rewrite-selection request');
      
      const { ast, selection, selectionText: directSelectionText, userPrompt } = request;

      let selectionText = directSelectionText;

      // If no direct text, try extracting from AST
      if (!selectionText && ast && selection) {
        if (!isValidSelection(selection)) {
          return {
            success: false,
            error: '无效的选区',
          };
        }
        selectionText = getTextInSelection(ast, selection);
      }

      if (!selectionText) {
        return {
          success: false,
          error: '选区为空',
        };
      }

      // 检查文本长度
      const MAX_SELECTION_LENGTH = 5000;
      if (selectionText.length > MAX_SELECTION_LENGTH) {
        return {
          success: false,
          error: `选区文本过长（${selectionText.length} 字符），请缩小选择范围（最大 ${MAX_SELECTION_LENGTH} 字符）`,
        };
      }

      console.log(`[aiHandlers] Selection text (${selectionText.length} chars):`, 
        selectionText.slice(0, 100) + (selectionText.length > 100 ? '...' : ''));
      console.log('[aiHandlers] User prompt:', userPrompt);

      // 检查 LLM 服务
      if (!llmService.isAvailable()) {
        console.warn('[aiHandlers] LLM service not available');
        return {
          success: false,
          error: 'AI 服务未配置。请设置 OPENROUTER_API_KEY（推荐）或 OPENAI_API_KEY 环境变量后重启应用。',
        };
      }

      try {
        // 调用 LLM
        const startTime = Date.now();
        const llmResult = await llmService.rewriteSelection(selectionText, userPrompt);
        const latencyMs = Date.now() - startTime;

        if (!llmResult.success || !llmResult.text) {
          return {
            success: false,
            error: llmResult.error || 'AI 返回空结果',
            latencyMs,
          };
        }

        const newText = llmResult.text;
        console.log(`[aiHandlers] LLM returned (${newText.length} chars):`, 
          newText.slice(0, 100) + (newText.length > 100 ? '...' : ''));

        // 生成 DocOps (如果有 AST) - 对于 Lexical 模式，我们不需要 DocOps
        let ops: DocOp[] = [];
        
        if (ast && selection) {
          ops = docOpsEngine.buildOpsForRewriteSelection(ast, selection, newText);
          console.log(`[aiHandlers] Generated ${ops.length} DocOps`);
        } else {
          // Lexical 模式：直接返回 newText，由前端处理替换
          console.log('[aiHandlers] Lexical mode: returning newText only');
        }

        return {
          success: true,
          newText,
          ops,
          latencyMs,
        };
      } catch (error) {
        console.error('[aiHandlers] Rewrite selection failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'AI 改写失败',
        };
      }
    }
  );

  /**
   * 获取 AI 服务状态
   */
  ipcMain.handle('ai:get-status', async (): Promise<{
    available: boolean;
    model?: string;
    provider?: string;
    error?: string;
  }> => {
    const available = llmService.isAvailable();
    
    if (!available) {
      return {
        available: false,
        error: '未配置 API Key。请设置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 环境变量。',
      };
    }

    // 检测使用的是哪个 provider
    const endpoint = process.env.OPENROUTER_API_ENDPOINT 
      || process.env.OPENAI_API_ENDPOINT 
      || 'https://openrouter.ai/api/v1/chat/completions';
    
    const isOpenRouter = endpoint.includes('openrouter.ai');
    const model = process.env.OPENROUTER_MODEL 
      || process.env.OPENAI_MODEL 
      || 'openai/gpt-4o-mini';

    return {
      available: true,
      model,
      provider: isOpenRouter ? 'OpenRouter' : 'OpenAI Compatible',
    };
  });

  /**
   * AI 聊天（不绑定文档）
   */
  ipcMain.handle('ai:chat', async (_, request: {
    messages: Array<{ role: string; content: string }>;
  }): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> => {
    const startTime = Date.now();
    
    try {
      if (!llmService.isAvailable()) {
        return {
          success: false,
          error: '未配置 API Key。请设置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 环境变量。',
        };
      }

      const result = await llmService.chat(request.messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })));

      console.log(`[aiHandlers] Chat completed in ${Date.now() - startTime}ms`);

      if (result.success) {
        return {
          success: true,
          content: result.text,
        };
      } else {
        return {
          success: false,
          error: result.error || '聊天请求失败',
        };
      }
    } catch (error) {
      console.error('[aiHandlers] Chat error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '聊天请求失败',
      };
    }
  });

  /**
   * AI 生成文档初稿
   */
  ipcMain.handle('ai:bootstrap-document', async (_, request: {
    prompt: string;
  }): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> => {
    const startTime = Date.now();
    
    try {
      if (!llmService.isAvailable()) {
        return {
          success: false,
          error: '未配置 API Key。请设置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 环境变量。',
        };
      }

      const systemPrompt = `你是一个专业的文档写作助手。用户会告诉你他想创建什么样的文档，你需要生成一份结构清晰的文档初稿。

要求：
1. 使用简单的标题格式：# 一级标题，## 二级标题，### 三级标题
2. 正文直接写，不需要任何 markdown 格式
3. 内容要专业、实用
4. 直接输出文档内容，不要添加任何解释说明`;

      const result = await llmService.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.prompt },
      ]);

      console.log(`[aiHandlers] Bootstrap document completed in ${Date.now() - startTime}ms`);

      if (result.success) {
        return {
          success: true,
          content: result.text,
        };
      } else {
        return {
          success: false,
          error: result.error || '生成文档失败',
        };
      }
    } catch (error) {
      console.error('[aiHandlers] Bootstrap document error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '生成文档失败',
      };
    }
  });

  /**
   * DocAgent 统一入口（新版 API）- 选区级
   * 
   * 支持所有 AI 操作：rewrite、summarize、translate、custom
   */
  ipcMain.handle(
    'ai:doc-agent',
    async (_, request: DocAgentRequest): Promise<DocAgentResponse> => {
      console.log('[aiHandlers] DocAgent request:', { 
        intent: request.intent, 
        textLength: request.selectionText?.length 
      });

      const { selectionText, intent } = request;

      if (!selectionText?.trim()) {
        return {
          success: false,
          action: 'replace',
          error: '选区为空',
        };
      }

      // 检查文本长度
      const MAX_SELECTION_LENGTH = 5000;
      if (selectionText.length > MAX_SELECTION_LENGTH) {
        return {
          success: false,
          action: 'replace',
          error: `选区文本过长（${selectionText.length} 字符），请缩小选择范围（最大 ${MAX_SELECTION_LENGTH} 字符）`,
        };
      }

      // 检查 LLM 服务
      if (!llmService.isAvailable()) {
        console.warn('[aiHandlers] LLM service not available');
        return {
          success: false,
          action: 'replace',
          error: 'AI 服务未配置。请设置 OPENROUTER_API_KEY（推荐）或 OPENAI_API_KEY 环境变量后重启应用。',
        };
      }

      try {
        const result = await docAgent.handleSelection(intent, selectionText);
        console.log('[aiHandlers] DocAgent result:', { 
          success: result.success, 
          action: result.action,
          textLength: result.text?.length,
          error: result.error,
        });
        return result;
      } catch (error) {
        console.error('[aiHandlers] DocAgent error:', error);
        return {
          success: false,
          action: 'replace',
          error: error instanceof Error ? error.message : 'AI 处理失败',
        };
      }
    }
  );

  /**
   * DocAgent 统一入口 - 章节级
   * 
   * 支持章节级 AI 操作：rewriteSection、summarizeSection、translateSection
   */
  ipcMain.handle(
    'ai:doc-agent-section',
    async (_, request: { intent: SectionIntent; section: SectionInfo }): Promise<DocAgentResponse> => {
      console.log('[aiHandlers] DocAgent section request:', { 
        intent: request.intent, 
        sectionTitle: request.section.title,
        contentLength: request.section.content?.length 
      });

      const { intent, section } = request;

      if (!section.content?.trim()) {
        return {
          success: false,
          action: 'replace',
          error: '章节内容为空',
        };
      }

      // 检查文本长度
      const MAX_SECTION_LENGTH = 10000; // 章节允许更长
      if (section.content.length > MAX_SECTION_LENGTH) {
        return {
          success: false,
          action: 'replace',
          error: `章节内容过长（${section.content.length} 字符），请选择较短的章节（最大 ${MAX_SECTION_LENGTH} 字符）`,
        };
      }

      // 检查 LLM 服务
      if (!llmService.isAvailable()) {
        console.warn('[aiHandlers] LLM service not available');
        return {
          success: false,
          action: 'replace',
          error: 'AI 服务未配置。请设置 OPENROUTER_API_KEY（推荐）或 OPENAI_API_KEY 环境变量后重启应用。',
        };
      }

      try {
        const result = await docAgent.handleSection(intent, section);
        console.log('[aiHandlers] DocAgent section result:', { 
          success: result.success, 
          action: result.action,
          textLength: result.text?.length,
          error: result.error,
        });
        return result;
      } catch (error) {
        console.error('[aiHandlers] DocAgent section error:', error);
        return {
          success: false,
          action: 'replace',
          error: error instanceof Error ? error.message : 'AI 处理失败',
        };
      }
    }
  );

  /**
   * 翻译 HTML 章节（用于 DocumentTranslateAgent）
   * 
   * 保格式翻译：尽量保留 HTML 结构
   */
  ipcMain.handle(
    'ai:translate-html-section',
    async (_, request: {
      html: string;
      direction: 'en_to_zh' | 'zh_to_en';
    }): Promise<{
      success: boolean;
      text?: string;
      error?: string;
      latencyMs?: number;
    }> => {
      const startTime = Date.now();
      const { html, direction } = request;

      console.log('[aiHandlers] Translate HTML section request:', {
        htmlLength: html?.length,
        direction,
      });

      if (!html?.trim()) {
        return {
          success: false,
          error: '内容为空',
        };
      }

      // 检查 LLM 服务
      if (!llmService.isAvailable()) {
        return {
          success: false,
          error: 'AI 服务未配置。请设置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 环境变量。',
        };
      }

      try {
        const result = await llmService.translateHtmlSection(html, { direction });
        const latencyMs = Date.now() - startTime;

        if (result.success && result.text) {
          console.log('[aiHandlers] Translate HTML section success:', {
            latencyMs,
            resultLength: result.text.length,
          });
          return {
            success: true,
            text: result.text,
            latencyMs,
          };
        } else {
          return {
            success: false,
            error: result.error || 'LLM 返回空响应',
            latencyMs,
          };
        }
      } catch (error) {
        console.error('[aiHandlers] Translate HTML section error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '翻译失败',
          latencyMs: Date.now() - startTime,
        };
      }
    }
  );

  /**
   * 总结章节（用于 DocumentSummarizerAgent）
   * 
   * 独立的 LLM 调用入口，专门用于文档级总结任务
   */
  ipcMain.handle(
    'ai:summarize-section',
    async (_, request: { 
      text: string; 
      options?: { language?: 'zh' | 'en'; style?: 'formal' | 'casual' }; 
    }): Promise<{
      success: boolean;
      text?: string;
      error?: string;
      latencyMs?: number;
    }> => {
      const startTime = Date.now();
      const { text, options } = request;

      console.log('[aiHandlers] Summarize section request:', { 
        textLength: text?.length,
        options 
      });

      if (!text?.trim()) {
        return {
          success: false,
          error: '内容为空',
        };
      }

      // 检查 LLM 服务
      if (!llmService.isAvailable()) {
        return {
          success: false,
          error: 'AI 服务未配置。请设置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 环境变量。',
        };
      }

      try {
        const language = options?.language || 'zh';
        const systemPrompt = `你是一个专业的文档摘要助手。请为给定的章节内容生成简洁的总结。

规则：
1. 总结应该简洁明了，1-3 句话
2. 保留关键信息和核心观点
3. 使用${language === 'zh' ? '中文' : '英文'}输出
4. 不要添加任何额外的解释或说明
5. 不要以"总结："或"Summary:"开头`;

        const result = await llmService.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请总结以下内容：\n\n${text}` },
        ]);

        const latencyMs = Date.now() - startTime;

        if (result.success && result.text) {
          console.log('[aiHandlers] Summarize section success:', { 
            latencyMs, 
            summaryLength: result.text.length 
          });
          return {
            success: true,
            text: result.text,
            latencyMs,
          };
        } else {
          return {
            success: false,
            error: result.error || 'LLM 返回空响应',
            latencyMs,
          };
        }
      } catch (error) {
        console.error('[aiHandlers] Summarize section error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '总结失败',
          latencyMs: Date.now() - startTime,
        };
      }
    }
  );

  console.log('[aiHandlers] AI IPC handlers registered');
}

/**
 * 注销 AI IPC handlers
 */
export function unregisterAiHandlers(): void {
  ipcMain.removeHandler('ai:rewrite-selection');
  ipcMain.removeHandler('ai:doc-agent');
  ipcMain.removeHandler('ai:doc-agent-section');
  ipcMain.removeHandler('ai:translate-html-section');
  ipcMain.removeHandler('ai:summarize-section');
  ipcMain.removeHandler('ai:get-status');
  ipcMain.removeHandler('ai:chat');
  ipcMain.removeHandler('ai:bootstrap-document');
  console.log('[aiHandlers] AI IPC handlers unregistered');
}

