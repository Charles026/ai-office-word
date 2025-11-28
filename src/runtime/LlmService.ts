/**
 * LlmService - LLM API 调用服务
 * 
 * 【职责】
 * - 封装 LLM API 调用（OpenRouter / OpenAI / Claude）
 * - 管理 API Key 和配置
 * - 处理错误和重试
 * 
 * 【默认配置】
 * - 使用 OpenRouter API（兼容 OpenAI 格式）
 * - 支持通过环境变量覆盖
 * 
 * 【禁止事项】
 * - 不在 React 组件中直接调用
 * - 只通过 IPC 从主进程调用
 */

import https from 'https';
import http from 'http';

// ==========================================
// 配置
// ==========================================

export interface LlmConfig {
  /** API 端点 */
  endpoint: string;
  /** API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 超时（毫秒） */
  timeout: number;
  /** 最大 tokens */
  maxTokens: number;
  /** HTTP Referer（OpenRouter 需要） */
  httpReferer: string;
  /** 应用名称（OpenRouter 需要） */
  appTitle: string;
}

// 默认配置（OpenRouter 兼容）
// 注意：此文件在主进程（Electron）中运行，可以直接使用 process.env
const DEFAULT_CONFIG: LlmConfig = {
  // OpenRouter 端点（也可以通过环境变量切换回 OpenAI）
  endpoint: process.env.OPENROUTER_API_ENDPOINT 
    || process.env.OPENAI_API_ENDPOINT 
    || 'https://openrouter.ai/api/v1/chat/completions',
  // API Key（优先 OpenRouter，fallback 到 OpenAI）
  apiKey: process.env.OPENROUTER_API_KEY 
    || process.env.OPENAI_API_KEY 
    || '',
  // 模型（OpenRouter 格式：provider/model）
  model: process.env.OPENROUTER_MODEL 
    || process.env.OPENAI_MODEL 
    || 'openai/gpt-4o-mini',
  timeout: 120000, // 增加到 120 秒，适应长文档
  maxTokens: 8000,  // 增加到 8000，支持长文档翻译
  // OpenRouter 必需的请求头
  httpReferer: process.env.APP_REFERER || 'http://localhost',
  appTitle: process.env.APP_TITLE || 'AI Office Editor',
};

// 启动时打印配置（隐藏 API Key）
console.log('[LlmService] Config:', {
  endpoint: DEFAULT_CONFIG.endpoint,
  model: DEFAULT_CONFIG.model,
  apiKeySet: !!DEFAULT_CONFIG.apiKey,
  apiKeyPrefix: DEFAULT_CONFIG.apiKey ? DEFAULT_CONFIG.apiKey.slice(0, 10) + '...' : 'NOT SET',
});

// ==========================================
// 类型定义
// ==========================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LlmResponse {
  success: boolean;
  text?: string;
  error?: string;
  latencyMs?: number;
}

// ==========================================
// LLM Service
// ==========================================

export class LlmService {
  private config: LlmConfig;

  constructor(config: Partial<LlmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LlmConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 检查服务是否可用
   */
  isAvailable(): boolean {
    return !!this.config.apiKey && !!this.config.endpoint;
  }

  /**
   * 总结章节内容
   * 
   * @param text - 章节文本
   * @param options - 总结选项
   */
  async summarizeSection(
    text: string, 
    options: { language?: 'zh' | 'en'; style?: 'formal' | 'casual' } = {}
  ): Promise<LlmResponse> {
    const { language = 'zh', style = 'formal' } = options;
    
    const systemPrompt = `你是一个专业的文档摘要助手。请为给定的章节内容生成简洁的总结。

规则：
1. 用 2-3 句话总结该节的核心观点
2. 保持语气${style === 'formal' ? '正式、专业' : '轻松、易懂'}
3. 避免重复原文句子
4. 不要加"总结："等前缀，直接输出摘要内容
5. 不要使用 markdown 格式`;

    const langInstruction = language === 'zh' 
      ? '请用中文总结' 
      : 'Please summarize in English';

    const userMessage = `${langInstruction}。

章节内容：
${text}

请直接输出 2-3 句话的摘要：`;

    const response = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);

    // 如果模型返回空，提供兜底
    if (response.success && (!response.text || response.text.trim() === '')) {
      return {
        success: true,
        text: language === 'zh' ? '（本节内容过少，无法生成摘要）' : '(Content too brief to summarize)',
        latencyMs: response.latencyMs,
      };
    }

    return response;
  }

  /**
   * 翻译 HTML 章节（保格式翻译）
   * 
   * 用于整篇文档翻译 Agent，尽量保留 HTML 结构。
   * 
   * @param html - 章节 HTML
   * @param options - 翻译选项
   */
  async translateHtmlSection(
    html: string,
    options: { direction: 'en_to_zh' | 'zh_to_en' }
  ): Promise<LlmResponse> {
    const { direction } = options;
    
    const targetLang = direction === 'en_to_zh' ? '中文' : 'English';
    const sourceLang = direction === 'en_to_zh' ? '英文' : '中文';
    
    const systemPrompt = `你是一个专业的 HTML 文档翻译助手。你需要将给定的 HTML 内容从${sourceLang}翻译成${targetLang}。

严格要求：
1. 保持原有的 HTML 结构，包括：
   - 所有 HTML 标签（<p>、<h1>~<h6>、<b>、<i>、<u>、<ul>、<ol>、<li> 等）
   - 标签的属性（如 class、id 等）
   - 嵌套结构和缩进
2. 只翻译可见文本内容，不要修改：
   - 标签名
   - 标签属性
   - HTML 注释
3. 翻译质量要求：
   - 准确传达原文含义
   - 语言自然流畅
   - 保持专业术语的准确性
4. 不要添加任何额外的说明或注释
5. 直接输出翻译后的 HTML，不要用 \`\`\`html 包裹

示例：
输入: <p>Hello <b>World</b>!</p>
输出: <p>你好 <b>世界</b>！</p>`;

    const userMessage = `请翻译以下 HTML 内容到${targetLang}：

${html}

请直接输出翻译后的 HTML：`;

    const response = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);

    // Sanity check：确保返回的是有效 HTML
    if (response.success && response.text) {
      const text = response.text.trim();
      
      // 移除可能的 markdown 代码块包裹
      let cleanedHtml = text;
      if (cleanedHtml.startsWith('```html')) {
        cleanedHtml = cleanedHtml.slice(7);
      } else if (cleanedHtml.startsWith('```')) {
        cleanedHtml = cleanedHtml.slice(3);
      }
      if (cleanedHtml.endsWith('```')) {
        cleanedHtml = cleanedHtml.slice(0, -3);
      }
      cleanedHtml = cleanedHtml.trim();
      
      // 基本验证：非空且包含 HTML 标签
      if (cleanedHtml.length < 5) {
        return {
          success: false,
          error: '翻译结果过短或为空',
          latencyMs: response.latencyMs,
        };
      }
      
      return {
        success: true,
        text: cleanedHtml,
        latencyMs: response.latencyMs,
      };
    }

    return response;
  }

  /**
   * 执行选区改写
   * 
   * @param selectionText - 选中的文本
   * @param userPrompt - 用户意图描述
   */
  async rewriteSelection(selectionText: string, userPrompt: string): Promise<LlmResponse> {
    const systemPrompt = `你是一个专业的文本改写助手。用户会给你一段原文和改写要求，请按要求改写文本。

规则：
1. 只输出改写后的文本，不要解释、不加引号、不带 markdown 格式
2. 保持原文的核心含义
3. 如果是翻译任务，只输出翻译结果
4. 如果是总结任务，只输出总结内容`;

    const userMessage = `原文：
${selectionText}

改写要求：${userPrompt}

请直接输出改写后的文本：`;

    return this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);
  }

  /**
   * 通用聊天请求
   */
  async chat(messages: ChatMessage[]): Promise<LlmResponse> {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'LLM 服务未配置。请设置 OPENROUTER_API_KEY（推荐）或 OPENAI_API_KEY 环境变量。',
      };
    }

    const startTime = Date.now();

    try {
      const requestBody: ChatCompletionRequest = {
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: 0.7,
      };

      const response = await this.makeRequest(requestBody);
      const latencyMs = Date.now() - startTime;

      if (response.choices && response.choices.length > 0) {
        const text = response.choices[0].message.content.trim();
        
        // 记录 token 使用情况（帮助诊断截断问题）
        if (response.usage) {
          console.log('[LlmService] Token usage:', {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
            maxTokens: this.config.maxTokens,
            possibleTruncation: response.usage.completion_tokens >= this.config.maxTokens * 0.95,
          });
        }
        
        return {
          success: true,
          text,
          latencyMs,
        };
      }

      return {
        success: false,
        error: 'LLM 返回空响应',
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      console.error('[LlmService] Request failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'LLM 请求失败',
        latencyMs,
      };
    }
  }

  /**
   * 发送 HTTP 请求
   * 
   * 支持 OpenRouter 和 OpenAI 兼容端点
   * OpenRouter 需要额外的 HTTP-Referer 和 X-Title 请求头
   */
  private makeRequest(body: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.endpoint);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const requestData = JSON.stringify(body);

      // 构建请求头（兼容 OpenRouter 和 OpenAI）
      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Length': Buffer.byteLength(requestData),
      };

      // OpenRouter 必需的请求头
      // 即使使用 OpenAI 端点也不会有影响
      if (this.config.httpReferer) {
        headers['HTTP-Referer'] = this.config.httpReferer;
      }
      if (this.config.appTitle) {
        headers['X-Title'] = this.config.appTitle;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: this.config.timeout,
      };

      const req = lib.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              const errorBody = JSON.parse(data);
              reject(new Error(errorBody.error?.message || `HTTP ${res.statusCode}`));
              return;
            }
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error('解析 LLM 响应失败'));
          }
        });
      });

      req.on('error', (e) => {
        reject(e);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('LLM 请求超时'));
      });

      req.write(requestData);
      req.end();
    });
  }
}

// 导出单例
export const llmService = new LlmService();

