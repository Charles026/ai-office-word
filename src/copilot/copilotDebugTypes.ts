/**
 * Copilot 调试类型定义
 * 
 * 用于 DocContext Inspector 调试面板
 */

import { DocContextEnvelope, DocScope } from '../docContext';
import type { BehaviorContext } from '../interaction/behaviorSummaryV2';
import type { CanonicalIntent } from '../ai/intent/intentTypes';
import type { DocOpsPlan } from '../ai/docops/docOpsTypes';

// ==========================================
// 调试消息
// ==========================================

/**
 * 调试用的消息结构
 */
export interface DebugMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 截断后的内容长度 */
  contentLength: number;
}

// ==========================================
// 调试快照
// ==========================================

/**
 * 单次 Copilot 调用的调试快照
 */
export interface CopilotDebugSnapshot {
  /** 唯一 ID */
  id: string;
  /** 创建时间 */
  createdAt: number;
  /** 使用的模型名 */
  model?: string;
  /** 文档 ID */
  docId: string | null;
  /** 作用范围 */
  scope: DocScope | 'none';
  /** 章节 ID */
  sectionId?: string;
  /** 章节标题 */
  sectionTitle?: string;
  /** DocContext 信封（如果有） */
  envelope?: DocContextEnvelope;
  /** 🆕 BehaviorContext（v2 用户行为上下文） */
  behaviorContext?: BehaviorContext;
  /** 🆕 Canonical Intent JSON */
  canonicalIntent?: CanonicalIntent;
  /** 🆕 DocOpsPlan JSON */
  docOpsPlan?: DocOpsPlan;
  /** 🆕 Assistant 回复纯文本 */
  assistantResponse?: string;
  /** 发送给 LLM 的消息 */
  requestMessages: DebugMessage[];
  /** LLM 返回的消息 */
  responseMessages: DebugMessage[];
  /** 计时信息 */
  timings: {
    startedAt: number;
    finishedAt?: number;
    totalMs?: number;
  };
  /** 错误信息 */
  error?: string;
  /** 是否使用了 DocContextEnvelope */
  usedEnvelope: boolean;
}

// ==========================================
// 调试状态
// ==========================================

/**
 * 调试 Store 状态
 */
export interface CopilotDebugState {
  /** 最近一次快照 */
  lastSnapshot: CopilotDebugSnapshot | null;
  /** 历史快照列表（最新在前） */
  history: CopilotDebugSnapshot[];
}

/**
 * 生成调试 ID
 */
export function generateDebugId(): string {
  return `debug-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * 创建空的调试快照
 */
export function createEmptySnapshot(params: {
  docId: string | null;
  scope: DocScope | 'none';
  sectionId?: string;
  sectionTitle?: string;
}): CopilotDebugSnapshot {
  return {
    id: generateDebugId(),
    createdAt: Date.now(),
    docId: params.docId,
    scope: params.scope,
    sectionId: params.sectionId,
    sectionTitle: params.sectionTitle,
    requestMessages: [],
    responseMessages: [],
    timings: {
      startedAt: Date.now(),
    },
    usedEnvelope: false,
  };
}

