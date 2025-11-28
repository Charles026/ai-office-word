/**
 * Agent 日志类型定义
 * 
 * 【设计原则】
 * - 只记录必要的元信息，不记录完整用户文本
 * - 支持结构化查询和分析
 * - 便于调试但保护隐私
 */

import { AgentKind, AgentSource, AgentLocale } from '../agentTypes';

// ==========================================
// 日志事件类型
// ==========================================

/**
 * 日志阶段
 */
export type LogPhase = 'started' | 'succeeded' | 'failed';

/**
 * Agent 日志事件
 */
export interface AgentLogEvent {
  /** 日志事件 ID */
  id: string;
  
  /** 时间戳 */
  timestamp: number;
  
  /** 阶段 */
  phase: LogPhase;
  
  /** Intent 元信息（不含完整文本） */
  intentMeta: IntentMeta;
  
  /** Context 元信息（不含完整文本） */
  contextMeta: ContextMeta;
  
  /** 处理耗时（毫秒，仅 succeeded/failed 阶段） */
  durationMs?: number;
  
  /** 结果元信息（仅 succeeded 阶段） */
  resultMeta?: ResultMeta;
  
  /** 错误信息（仅 failed 阶段） */
  error?: string;
}

/**
 * Intent 元信息
 */
export interface IntentMeta {
  /** Intent ID */
  intentId: string;
  
  /** 操作类型 */
  kind: AgentKind;
  
  /** 操作来源 */
  source: AgentSource;
  
  /** 语言设置 */
  locale?: AgentLocale;
  
  /** 选项摘要（不含敏感信息） */
  optionsSummary?: string;
}

/**
 * Context 元信息
 */
export interface ContextMeta {
  /** 是否有选区文本 */
  hasSelectionText: boolean;
  
  /** 选区文本长度 */
  selectionTextLength?: number;
  
  /** 选区文本预览（截断，仅调试用） */
  selectionTextPreview?: string;
  
  /** 是否有标题 ID */
  hasHeadingId: boolean;
  
  /** 标题 ID */
  headingId?: string;
  
  /** 文档字数 */
  documentWordCount?: number;
  
  /** 文档 ID */
  docId?: string;
}

/**
 * 结果元信息
 */
export interface ResultMeta {
  /** DocOps 数量 */
  docOpsCount: number;
  
  /** 是否为空结果 */
  isEmpty: boolean;
  
  /** 使用的模型 */
  model?: string;
  
  /** Token 消耗 */
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
}

// ==========================================
// 日志配置
// ==========================================

/**
 * 日志配置
 */
export interface AgentLoggerConfig {
  /** 是否启用日志 */
  enabled: boolean;
  
  /** 是否输出到控制台 */
  consoleOutput: boolean;
  
  /** 是否发送到主进程 */
  sendToMain: boolean;
  
  /** 文本预览最大长度 */
  previewMaxLength: number;
}

/**
 * 默认日志配置
 */
export const DEFAULT_LOGGER_CONFIG: AgentLoggerConfig = {
  enabled: true,
  consoleOutput: true,
  sendToMain: true,
  previewMaxLength: 50,
};

// ==========================================
// 工具函数
// ==========================================

/**
 * 生成日志事件 ID
 */
export function generateLogEventId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 截断文本（用于预览）
 */
export function truncateForPreview(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}

/**
 * 生成选项摘要
 */
export function generateOptionsSummary(options?: Record<string, unknown>): string | undefined {
  if (!options) return undefined;
  
  const keys = Object.keys(options).filter(k => 
    // 排除敏感字段
    !['customPrompt', 'apiKey', 'password'].includes(k)
  );
  
  if (keys.length === 0) return undefined;
  
  return keys.map(k => `${k}=${String(options[k])}`).join(', ');
}

