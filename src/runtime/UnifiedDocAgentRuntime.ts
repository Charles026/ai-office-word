/**
 * UnifiedDocAgentRuntime - 统一的 AI Agent 运行时
 * 
 * 【职责】
 * - 统一所有 AI 调用入口
 * - 管理 Intent → LLM → Result 的完整流程
 * - 记录日志和监控
 * - 不直接操作 AST，只返回 DocOps
 * 
 * 【架构位置】
 * UI → UnifiedDocAgentRuntime → IPC(ai:runAgent) → LLM → DocOps → UI 应用到 AST
 * 
 * 【设计原则】
 * - 单例模式，全局唯一
 * - 不引用 React 组件、DOM、Lexical Editor 实例
 * - 不直接读写文件，只通过 IPC 调用主进程
 * - 所有 AI 调用必须经过此 Runtime
 */

import {
  AgentIntent,
  AgentContext,
  AgentResult,
  DocOpItem,
  createAgentIntent,
  createSuccessResult,
  createErrorResult,
} from './agentTypes';

import {
  AgentLogger,
  getAgentLogger,
} from './logging/AgentLogger';

// ==========================================
// 类型定义
// ==========================================

/** IPC 调用结果 */
interface IpcAgentResponse {
  success: boolean;
  text?: string;
  error?: string;
  latencyMs?: number;
  model?: string;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

/** Runtime 配置 */
interface UnifiedDocAgentRuntimeConfig {
  /** 是否启用日志 */
  enableLogging: boolean;
  /** 超时时间（毫秒） */
  timeoutMs: number;
}

const DEFAULT_CONFIG: UnifiedDocAgentRuntimeConfig = {
  enableLogging: true,
  timeoutMs: 60000,
};

// ==========================================
// UnifiedDocAgentRuntime 类
// ==========================================

export class UnifiedDocAgentRuntime {
  private static _instance: UnifiedDocAgentRuntime | null = null;
  private config: UnifiedDocAgentRuntimeConfig;
  private logger: AgentLogger;

  private constructor(config: Partial<UnifiedDocAgentRuntimeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = getAgentLogger();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): UnifiedDocAgentRuntime {
    if (!UnifiedDocAgentRuntime._instance) {
      UnifiedDocAgentRuntime._instance = new UnifiedDocAgentRuntime();
    }
    return UnifiedDocAgentRuntime._instance;
  }

  /**
   * 重置实例（仅用于测试）
   */
  static resetInstance(): void {
    UnifiedDocAgentRuntime._instance = null;
  }

  // ==========================================
  // 核心方法
  // ==========================================

  /**
   * 运行 Agent
   * 
   * 这是所有 AI 调用的统一入口
   * 
   * @param intent - 操作意图
   * @param context - 操作上下文
   * @returns AgentResult - 操作结果（包含 DocOps）
   */
  async run(intent: AgentIntent, context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    // 记录开始日志
    this.logStarted(intent, context);

    try {
      // 1. 验证输入
      const validationError = this.validateInput(intent, context);
      if (validationError) {
        return this.handleError(intent, context, validationError, startTime);
      }

      // 2. 通过 IPC 调用主进程 AI handler
      const ipcResponse = await this.callAgentIpc(intent, context);

      // 3. 处理响应
      if (!ipcResponse.success) {
        return this.handleError(
          intent, 
          context, 
          ipcResponse.error || '未知错误', 
          startTime
        );
      }

      // 4. 将 LLM 结果转换为 DocOps
      const docOps = this.buildDocOpsFromResult(intent, context, ipcResponse.text || '');

      // 5. 构造成功结果
      const result = createSuccessResult(intent.id, docOps, {
        latencyMs: Date.now() - startTime,
        model: ipcResponse.model,
        tokenUsage: ipcResponse.tokenUsage,
      });

      // 记录成功日志
      this.logSucceeded(intent, context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.handleError(intent, context, errorMsg, startTime);
    }
  }

  // ==========================================
  // 私有方法
  // ==========================================

  /**
   * 验证输入
   */
  private validateInput(intent: AgentIntent, context: AgentContext): string | null {
    // 检查必要字段
    if (!intent.id) {
      return 'Intent ID 不能为空';
    }

    if (!intent.kind) {
      return 'Intent kind 不能为空';
    }

    // 根据 source 检查 context
    if (intent.source === 'selection' && !context.selectionText) {
      return '选区操作需要提供 selectionText';
    }

    if (intent.source === 'heading' && !context.headingId) {
      return '章节操作需要提供 headingId';
    }

    // 检查文本长度
    const text = context.selectionText || context.sectionContent || '';
    if (text.length > 10000) {
      return '文本过长，最大支持 10000 字符';
    }

    return null;
  }

  /**
   * 调用主进程 AI handler
   */
  private async callAgentIpc(
    intent: AgentIntent, 
    context: AgentContext
  ): Promise<IpcAgentResponse> {
    // 检查 window.aiDoc 是否可用
    if (typeof window === 'undefined' || !window.aiDoc) {
      return {
        success: false,
        error: 'AI 服务不可用（window.aiDoc 未定义）',
      };
    }

    // 根据 intent.kind 调用对应的 IPC 方法
    // TODO: 统一为单一通道 ai:runAgent
    try {
      switch (intent.kind) {
        case 'rewrite':
        case 'summarize':
        case 'translate':
        case 'structure':
        case 'custom':
          return await this.callSelectionAgent(intent, context);

        case 'generate_outline':
          // TODO: 实现大纲生成
          return {
            success: false,
            error: '大纲生成功能尚未实现',
          };

        default:
          return {
            success: false,
            error: `不支持的操作类型: ${intent.kind}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 调用选区级 Agent
   */
  private async callSelectionAgent(
    intent: AgentIntent,
    context: AgentContext
  ): Promise<IpcAgentResponse> {
    const startTime = Date.now();

    // 映射到现有的 handleSelection API
    const docAgentIntent = this.mapToLegacyIntent(intent);
    
    const response = await window.aiDoc.handleSelection({
      selectionText: context.selectionText || context.sectionContent || '',
      intent: docAgentIntent,
    });

    return {
      success: response.success,
      text: response.text,
      error: response.error,
      latencyMs: response.latencyMs || (Date.now() - startTime),
    };
  }

  /**
   * 映射到旧版 Intent 格式
   * 
   * TODO: 后续统一后可以移除此映射
   */
  private mapToLegacyIntent(intent: AgentIntent): {
    type: 'rewrite' | 'summarize' | 'translate' | 'custom';
    tone?: 'formal' | 'concise' | 'friendly';
    targetLang?: 'en' | 'zh';
    customPrompt?: string;
  } {
    const options = intent.options || {};

    switch (intent.kind) {
      case 'rewrite':
        return {
          type: 'rewrite',
          tone: options.tone as 'formal' | 'concise' | 'friendly',
        };

      case 'translate':
        return {
          type: 'translate',
          targetLang: options.targetLang as 'en' | 'zh',
        };

      case 'summarize':
        return {
          type: 'summarize',
        };

      case 'structure':
      case 'custom':
      default:
        return {
          type: 'custom',
          customPrompt: options.customPrompt as string,
        };
    }
  }

  /**
   * 将 LLM 结果转换为 DocOps
   * 
   * TODO: 后续移到 src/docops/ 下的独立模块
   */
  private buildDocOpsFromResult(
    intent: AgentIntent,
    context: AgentContext,
    llmResult: string
  ): DocOpItem[] {
    // 根据 intent.kind 和 source 确定操作类型
    const action = this.determineAction(intent);

    if (action === 'insertAfter') {
      // 总结等操作：在原文后插入
      return [{
        type: 'insertAfter',
        target: context.headingId,
        content: llmResult,
      }];
    } else {
      // 改写、翻译等操作：替换原文
      return [{
        type: 'replace',
        content: llmResult,
      }];
    }
  }

  /**
   * 确定操作类型（替换还是插入）
   */
  private determineAction(intent: AgentIntent): 'replace' | 'insertAfter' {
    // 总结操作默认在原文后插入
    if (intent.kind === 'summarize') {
      return 'insertAfter';
    }
    // 其他操作默认替换
    return 'replace';
  }

  /**
   * 处理错误
   */
  private handleError(
    intent: AgentIntent,
    context: AgentContext,
    error: string,
    startTime: number
  ): AgentResult {
    const durationMs = Date.now() - startTime;

    // 记录失败日志
    this.logFailed(intent, context, error, durationMs);

    return createErrorResult(intent.id, error, { latencyMs: durationMs });
  }

  // ==========================================
  // 日志方法
  // ==========================================

  private logStarted(intent: AgentIntent, context: AgentContext): void {
    if (!this.config.enableLogging) return;

    this.logger.logStarted({ intent, context });
  }

  private logSucceeded(
    intent: AgentIntent,
    context: AgentContext,
    result: AgentResult,
    durationMs: number
  ): void {
    if (!this.config.enableLogging) return;

    this.logger.logSucceeded({ intent, context, result, durationMs });
  }

  private logFailed(
    intent: AgentIntent,
    context: AgentContext,
    error: string,
    durationMs: number
  ): void {
    if (!this.config.enableLogging) return;

    this.logger.logFailed({ intent, context, error, durationMs });
  }
}

// ==========================================
// 语义化 Helper 方法
// ==========================================

/**
 * 获取 Runtime 实例
 */
export function getDocAgentRuntime(): UnifiedDocAgentRuntime {
  return UnifiedDocAgentRuntime.getInstance();
}

/**
 * 改写选区
 */
export async function runRewriteOnSelection(
  mode: 'formal' | 'concise' | 'friendly',
  selectionText: string
): Promise<AgentResult> {
  const runtime = getDocAgentRuntime();
  
  const intent = createAgentIntent('rewrite', 'selection', { tone: mode });
  const context: AgentContext = { selectionText };
  
  return runtime.run(intent, context);
}

/**
 * 翻译选区
 */
export async function runTranslateSelection(
  targetLocale: 'en' | 'zh',
  selectionText: string
): Promise<AgentResult> {
  const runtime = getDocAgentRuntime();
  
  const intent = createAgentIntent('translate', 'selection', { targetLang: targetLocale });
  const context: AgentContext = { selectionText };
  
  return runtime.run(intent, context);
}

/**
 * 总结选区
 */
export async function runSummarizeSelection(
  selectionText: string
): Promise<AgentResult> {
  const runtime = getDocAgentRuntime();
  
  const intent = createAgentIntent('summarize', 'selection');
  const context: AgentContext = { selectionText };
  
  return runtime.run(intent, context);
}

/**
 * 总结章节
 */
export async function runSummarizeHeading(
  headingId: string,
  headingText: string,
  bodyText: string
): Promise<AgentResult> {
  const runtime = getDocAgentRuntime();
  
  const intent = createAgentIntent('summarize', 'heading');
  const context: AgentContext = {
    headingId,
    headingText,
    sectionContent: bodyText,
  };
  
  return runtime.run(intent, context);
}

/**
 * 翻译章节
 */
export async function runTranslateHeading(
  headingId: string,
  headingText: string,
  sectionHtml: string,
  targetLocale: 'en' | 'zh'
): Promise<AgentResult> {
  const runtime = getDocAgentRuntime();
  
  const intent = createAgentIntent('translate', 'heading', { targetLang: targetLocale });
  const context: AgentContext = {
    headingId,
    headingText,
    sectionHtml,
  };
  
  return runtime.run(intent, context);
}

/**
 * 自定义操作
 */
export async function runCustomPrompt(
  customPrompt: string,
  selectionText: string
): Promise<AgentResult> {
  const runtime = getDocAgentRuntime();
  
  const intent = createAgentIntent('custom', 'selection', { customPrompt });
  const context: AgentContext = { selectionText };
  
  return runtime.run(intent, context);
}

// ==========================================
// 导出
// ==========================================

export default UnifiedDocAgentRuntime;

