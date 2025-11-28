/**
 * AgentLogger - Agent 日志记录器
 * 
 * 【职责】
 * - 记录 Agent 操作的开始、成功、失败事件
 * - 输出到控制台（前端调试）
 * - 发送到主进程（持久化到文件）
 * 
 * 【设计原则】
 * - 不抛异常，日志失败不影响业务逻辑
 * - 不记录完整用户文本，保护隐私
 * - 支持全局开关控制
 */

import { AgentIntent, AgentContext, AgentResult } from '../agentTypes';
import {
  AgentLogEvent,
  IntentMeta,
  ContextMeta,
  ResultMeta,
  AgentLoggerConfig,
  DEFAULT_LOGGER_CONFIG,
  generateLogEventId,
  truncateForPreview,
  generateOptionsSummary,
} from './types';

// ==========================================
// 全局配置
// ==========================================

let globalConfig: AgentLoggerConfig = { ...DEFAULT_LOGGER_CONFIG };

/**
 * 设置日志配置
 */
export function setLoggerConfig(config: Partial<AgentLoggerConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * 获取当前配置
 */
export function getLoggerConfig(): AgentLoggerConfig {
  return { ...globalConfig };
}

/**
 * 启用/禁用日志
 */
export function setLoggerEnabled(enabled: boolean): void {
  globalConfig.enabled = enabled;
}

// ==========================================
// AgentLogger 类
// ==========================================

export class AgentLogger {
  private config: AgentLoggerConfig;

  constructor(config?: Partial<AgentLoggerConfig>) {
    this.config = { ...globalConfig, ...config };
  }

  // ==========================================
  // 公开方法
  // ==========================================

  /**
   * 记录开始事件
   */
  logStarted(params: {
    intent: AgentIntent;
    context: AgentContext;
  }): void {
    if (!this.config.enabled) return;

    try {
      const event = this.buildEvent('started', params.intent, params.context);
      this.outputEvent(event);
    } catch (error) {
      this.handleLogError('logStarted', error);
    }
  }

  /**
   * 记录成功事件
   */
  logSucceeded(params: {
    intent: AgentIntent;
    context: AgentContext;
    result: AgentResult;
    durationMs: number;
  }): void {
    if (!this.config.enabled) return;

    try {
      const event = this.buildEvent(
        'succeeded',
        params.intent,
        params.context,
        params.durationMs,
        params.result
      );
      this.outputEvent(event);
    } catch (error) {
      this.handleLogError('logSucceeded', error);
    }
  }

  /**
   * 记录失败事件
   */
  logFailed(params: {
    intent: AgentIntent;
    context: AgentContext;
    error: string;
    durationMs: number;
  }): void {
    if (!this.config.enabled) return;

    try {
      const event = this.buildEvent(
        'failed',
        params.intent,
        params.context,
        params.durationMs,
        undefined,
        params.error
      );
      this.outputEvent(event);
    } catch (error) {
      this.handleLogError('logFailed', error);
    }
  }

  // ==========================================
  // 私有方法
  // ==========================================

  /**
   * 构建日志事件
   */
  private buildEvent(
    phase: 'started' | 'succeeded' | 'failed',
    intent: AgentIntent,
    context: AgentContext,
    durationMs?: number,
    result?: AgentResult,
    error?: string
  ): AgentLogEvent {
    const event: AgentLogEvent = {
      id: generateLogEventId(),
      timestamp: Date.now(),
      phase,
      intentMeta: this.buildIntentMeta(intent),
      contextMeta: this.buildContextMeta(context),
    };

    if (durationMs !== undefined) {
      event.durationMs = durationMs;
    }

    if (result) {
      event.resultMeta = this.buildResultMeta(result);
    }

    if (error) {
      event.error = error;
    }

    return event;
  }

  /**
   * 构建 Intent 元信息
   */
  private buildIntentMeta(intent: AgentIntent): IntentMeta {
    return {
      intentId: intent.id,
      kind: intent.kind,
      source: intent.source,
      locale: intent.locale,
      optionsSummary: generateOptionsSummary(intent.options),
    };
  }

  /**
   * 构建 Context 元信息
   */
  private buildContextMeta(context: AgentContext): ContextMeta {
    const meta: ContextMeta = {
      hasSelectionText: !!context.selectionText,
      hasHeadingId: !!context.headingId,
    };

    if (context.selectionText) {
      meta.selectionTextLength = context.selectionText.length;
      meta.selectionTextPreview = truncateForPreview(
        context.selectionText,
        this.config.previewMaxLength
      );
    }

    if (context.headingId) {
      meta.headingId = context.headingId;
    }

    if (context.documentMeta) {
      meta.documentWordCount = context.documentMeta.wordCount;
      meta.docId = context.documentMeta.docId;
    }

    return meta;
  }

  /**
   * 构建 Result 元信息
   */
  private buildResultMeta(result: AgentResult): ResultMeta {
    return {
      docOpsCount: result.docOps.length,
      isEmpty: result.docOps.length === 0,
      model: result.payload?.model,
      tokenUsage: result.payload?.tokenUsage,
    };
  }

  /**
   * 输出日志事件
   */
  private outputEvent(event: AgentLogEvent): void {
    // 输出到控制台
    if (this.config.consoleOutput) {
      this.outputToConsole(event);
    }

    // 发送到主进程
    if (this.config.sendToMain) {
      this.sendToMain(event);
    }
  }

  /**
   * 输出到控制台
   */
  private outputToConsole(event: AgentLogEvent): void {
    const prefix = `[DocAgent][${event.phase}]`;
    const summary = {
      intentId: event.intentMeta.intentId,
      kind: event.intentMeta.kind,
      source: event.intentMeta.source,
      ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
      ...(event.resultMeta && { docOpsCount: event.resultMeta.docOpsCount }),
      ...(event.error && { error: event.error }),
    };

    switch (event.phase) {
      case 'started':
        console.log(prefix, summary);
        break;
      case 'succeeded':
        console.log(prefix, summary);
        break;
      case 'failed':
        console.warn(prefix, summary);
        break;
    }
  }

  /**
   * 发送到主进程
   */
  private sendToMain(event: AgentLogEvent): void {
    try {
      // 检查 electronAPI 是否可用
      if (typeof window !== 'undefined' && (window as any).electronAPI?.sendAgentLog) {
        (window as any).electronAPI.sendAgentLog(event);
      }
    } catch (error) {
      // 静默失败，不影响业务
      console.debug('[AgentLogger] Failed to send log to main:', error);
    }
  }

  /**
   * 处理日志错误
   */
  private handleLogError(method: string, error: unknown): void {
    console.error(`[AgentLogger] ${method} failed:`, error);
  }
}

// ==========================================
// 单例实例
// ==========================================

let defaultLogger: AgentLogger | null = null;

/**
 * 获取默认 Logger 实例
 */
export function getAgentLogger(): AgentLogger {
  if (!defaultLogger) {
    defaultLogger = new AgentLogger();
  }
  return defaultLogger;
}

// ==========================================
// 便捷方法
// ==========================================

/**
 * 记录开始事件（便捷方法）
 */
export function logAgentStarted(intent: AgentIntent, context: AgentContext): void {
  getAgentLogger().logStarted({ intent, context });
}

/**
 * 记录成功事件（便捷方法）
 */
export function logAgentSucceeded(
  intent: AgentIntent,
  context: AgentContext,
  result: AgentResult,
  durationMs: number
): void {
  getAgentLogger().logSucceeded({ intent, context, result, durationMs });
}

/**
 * 记录失败事件（便捷方法）
 */
export function logAgentFailed(
  intent: AgentIntent,
  context: AgentContext,
  error: string,
  durationMs: number
): void {
  getAgentLogger().logFailed({ intent, context, error, durationMs });
}

// ==========================================
// 导出
// ==========================================

export default AgentLogger;

