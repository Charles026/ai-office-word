/**
 * Copilot Model Caller - 统一 LLM 调用入口
 * 
 * 【职责】
 * - 集中处理 Copilot → LLM 的所有调用
 * - 在 scope=section 时使用 DocContextEnvelope 构造 prompt
 * - 记录调试信息供 Inspector 使用
 * 
 * 【设计】
 * - 统一入口，便于后续扩展和监控
 * - 与 copilotLLMClient.ts 协作，后者提供基础 Chat 能力
 */

import { CopilotContext, CopilotMessage } from './copilotTypes';
import { sendCopilotChat, CopilotChatResponse } from './copilotLLMClient';
import { getCopilotEditor } from './copilotRuntimeBridge';
import {
  buildDocContextEnvelope,
  buildSystemPromptFromEnvelope,
  buildUserPromptFromEnvelope,
  DocContextEnvelope,
} from '../docContext';
import {
  CopilotDebugSnapshot,
  DebugMessage,
  generateDebugId,
} from './copilotDebugTypes';
import { copilotDebugStore } from './copilotDebugStore';
import { buildRecentBehaviorSummary } from '../interaction';

// ==========================================
// 常量
// ==========================================

const DEFAULT_MAX_TOKENS = 8192;
const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

// ==========================================
// 类型
// ==========================================

export interface CallCopilotModelParams {
  /** 文档 ID */
  docId: string | null;
  /** 作用范围 */
  scope: 'selection' | 'section' | 'document' | 'none';
  /** 章节 ID（scope=section 时使用） */
  sectionId?: string;
  /** 用户输入 */
  userInput: string;
  /** 当前上下文（用于 fallback） */
  context: CopilotContext;
  /** 历史消息 */
  messages: CopilotMessage[];
  /** 最大 token 数 */
  maxTokens?: number;
}

export interface CallCopilotModelResult extends CopilotChatResponse {
  /** 使用的上下文信封（如果有） */
  envelope?: DocContextEnvelope;
}

// ==========================================
// 调试辅助函数
// ==========================================

/**
 * 将消息转换为调试格式
 */
function toDebugMessages(
  messages: Array<{ role: string; content: string }>
): DebugMessage[] {
  return messages.map((msg, index) => ({
    id: `msg-${index}`,
    role: msg.role as 'system' | 'user' | 'assistant',
    content: msg.content,
    contentLength: msg.content.length,
  }));
}

// ==========================================
// 主函数
// ==========================================

/**
 * 调用 Copilot 模型
 * 
 * 统一入口：
 * - scope=section 且有 sectionId 时，使用 DocContextEnvelope
 * - 其他情况使用原有的 sendCopilotChat
 * - 记录调试快照供 Inspector 使用
 */
export async function callCopilotModel(
  params: CallCopilotModelParams
): Promise<CallCopilotModelResult> {
  const {
    docId,
    scope,
    sectionId,
    userInput,
    context,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
  } = params;

  if (__DEV__) {
    console.debug('[CopilotModelCaller] callCopilotModel:', { docId, scope, sectionId });
  }

  // 初始化调试快照
  const snapshot: CopilotDebugSnapshot = {
    id: generateDebugId(),
    createdAt: Date.now(),
    docId,
    scope,
    sectionId,
    sectionTitle: context.sectionTitle || undefined,
    requestMessages: [],
    responseMessages: [],
    timings: {
      startedAt: Date.now(),
    },
    usedEnvelope: false,
  };

  // 获取编辑器引用
  const editor = getCopilotEditor();

  if (__DEV__) {
    console.debug('[CopilotModelCaller] Envelope conditions:', {
      scope,
      docId: docId ?? '(null)',
      sectionId: sectionId ?? '(null)',
      hasEditor: !!editor,
      willUseEnvelope: scope === 'section' && !!docId && !!sectionId && !!editor,
    });
  }

  // 尝试使用 DocContextEnvelope（scope=section 且有 editor）
  if (scope === 'section' && docId && sectionId && editor) {
    try {
      const envelope = await buildDocContextEnvelope(
        {
          docId,
          scope: 'section',
          sectionId,
          maxTokens,
        },
        editor
      );

      // 更新快照
      snapshot.envelope = envelope;
      snapshot.usedEnvelope = true;

      if (__DEV__) {
        console.debug('[CopilotModelCaller] Using DocContextEnvelope:', {
          sectionTitle: envelope.focus.sectionTitle,
          charCount: envelope.focus.charCount,
          outlineCount: envelope.global.outline.length,
        });
      }

      // 🆕 获取行为摘要（最近 10 分钟）
      const behaviorSummary = buildRecentBehaviorSummary({
        docId,
        windowMs: 10 * 60 * 1000, // 10 分钟
      });

      if (__DEV__) {
        console.debug('[CopilotModelCaller] Behavior summary:', {
          eventCount: behaviorSummary.stats.eventCount,
          aiOperations: behaviorSummary.stats.aiOperationCount,
          undoCount: behaviorSummary.stats.undoCount,
          bullets: behaviorSummary.bullets,
          summaryText: behaviorSummary.summaryText || '(empty)',
        });
      }

      // 使用 Envelope 构造 prompt（附带行为摘要）
      const systemPrompt = buildSystemPromptFromEnvelope(envelope, {
        behaviorSummary: behaviorSummary.summaryText,
      });
      const userPrompt = buildUserPromptFromEnvelope(envelope, userInput);

      // 记录请求消息
      const llmMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      snapshot.requestMessages = toDebugMessages(llmMessages);

      // 调用 LLM
      const response = await callLLMWithEnvelopeAndRecord(
        systemPrompt,
        userPrompt,
        messages,
        snapshot
      );

      return {
        ...response,
        envelope,
      };
    } catch (err) {
      if (__DEV__) {
        console.warn('[CopilotModelCaller] Failed to build envelope, fallback to sendCopilotChat:', err);
      }
      // 记录错误
      snapshot.error = err instanceof Error ? err.message : String(err);
      // 失败时 fallback 到原有逻辑
    }
  }

  // Fallback: 使用原有的 sendCopilotChat
  if (__DEV__) {
    console.debug('[CopilotModelCaller] Using fallback sendCopilotChat');
  }

  try {
    const response = await sendCopilotChat(docId, context, messages);
    
    // 记录响应
    snapshot.responseMessages = [{
      id: 'resp-0',
      role: 'assistant',
      content: response.content,
      contentLength: response.content.length,
    }];
    snapshot.timings.finishedAt = Date.now();
    snapshot.timings.totalMs = snapshot.timings.finishedAt - snapshot.timings.startedAt;

    // 保存快照
    if (__DEV__) {
      copilotDebugStore.setSnapshot(snapshot);
    }

    return response;
  } catch (error) {
    // 记录错误
    snapshot.error = error instanceof Error ? error.message : String(error);
    snapshot.timings.finishedAt = Date.now();
    snapshot.timings.totalMs = snapshot.timings.finishedAt - snapshot.timings.startedAt;

    if (__DEV__) {
      copilotDebugStore.setSnapshot(snapshot);
    }

    throw error;
  }
}

/**
 * 使用 Envelope 构造的 prompt 调用 LLM，并记录调试信息
 */
async function callLLMWithEnvelopeAndRecord(
  systemPrompt: string,
  userPrompt: string,
  _historyMessages: CopilotMessage[],
  snapshot: CopilotDebugSnapshot
): Promise<CopilotChatResponse> {
  // 构造消息数组
  const llmMessages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  try {
    const response = await window.aiDoc?.chat?.({ messages: llmMessages });

    // 记录响应
    snapshot.timings.finishedAt = Date.now();
    snapshot.timings.totalMs = snapshot.timings.finishedAt - snapshot.timings.startedAt;

    if (response?.success && response.content) {
      snapshot.responseMessages = [{
        id: 'resp-0',
        role: 'assistant',
        content: response.content,
        contentLength: response.content.length,
      }];

      // 保存快照
      if (__DEV__) {
        copilotDebugStore.setSnapshot(snapshot);
      }

      return {
        content: response.content,
      };
    }

    const errorMsg = response?.error || 'LLM 响应异常';
    snapshot.error = errorMsg;

    // 保存快照
    if (__DEV__) {
      copilotDebugStore.setSnapshot(snapshot);
    }

    console.error('[CopilotModelCaller] LLM error:', errorMsg);
    return {
      content: `抱歉，发生了错误：${errorMsg}`,
    };
  } catch (error) {
    // 记录错误
    snapshot.error = error instanceof Error ? error.message : String(error);
    snapshot.timings.finishedAt = Date.now();
    snapshot.timings.totalMs = snapshot.timings.finishedAt - snapshot.timings.startedAt;

    // 保存快照
    if (__DEV__) {
      copilotDebugStore.setSnapshot(snapshot);
    }

    console.error('[CopilotModelCaller] Request failed:', error);
    return {
      content: '抱歉，网络请求失败。请检查网络连接后重试。',
    };
  }
}
