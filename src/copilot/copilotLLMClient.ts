/**
 * Copilot LLM Client - 通用聊天封装
 * 
 * 【职责】
 * - 封装 LLM 聊天调用
 * - 注入 Copilot 世界观的 system prompt
 * - 转换消息格式
 * 
 * 【Phase 1】
 * - 只处理通用聊天 + 带一点上下文感知
 * - 不做文档改写决策
 */

import type { CopilotContext, CopilotMessage } from './copilotTypes';

// ==========================================
// 常量
// ==========================================

/** 保留的最大历史消息数 */
const MAX_HISTORY_MESSAGES = 10;

// ==========================================
// System Prompt
// ==========================================

/**
 * 构建 Copilot 的 System Prompt
 */
function buildSystemPrompt(context: CopilotContext): string {
  const parts: string[] = [];

  // 基础角色定义
  parts.push(`你是 AI Office 的写作助手 Copilot，嵌入在一个本地 AI Word 编辑器中。

你的能力：
1. 回答用户的知识问题、提供写作灵感和建议
2. 理解用户正在编辑的文档上下文
3. 提供专业、简洁、有帮助的回复

规则：
- 用中文回复，除非用户明确要求其他语言
- 回复要简洁有力，避免冗长
- 如果不确定，诚实说明
- 不要编造不存在的信息`);

  // 上下文信息
  if (context.docId) {
    parts.push(`\n当前文档：${context.docId}`);
  }

  // 作用范围
  parts.push(`\n当前焦点：${getScopeDescription(context)}`);

  // 选区内容
  if (context.selectionSnippet) {
    parts.push(`\n用户选中的文本片段：「${context.selectionSnippet}」`);
  }

  // 最近操作（用于连续 refinement）
  if (context.lastActions.length > 0) {
    const recentActions = context.lastActions.slice(-3);
    const actionsDesc = recentActions
      .map(a => `- ${a.type}${a.sectionTitle ? ` (${a.sectionTitle})` : ''}`)
      .join('\n');
    parts.push(`\n最近的文档操作：\n${actionsDesc}`);
  }

  return parts.join('\n');
}

/**
 * 获取作用范围描述
 */
function getScopeDescription(context: CopilotContext): string {
  switch (context.scope) {
    case 'selection':
      return '用户选中了一段文本';
    case 'section':
      return context.sectionTitle
        ? `用户正在编辑章节「${context.sectionTitle}」`
        : '用户正在编辑某个章节';
    case 'document':
      return '用户正在浏览整篇文档';
    case 'none':
    default:
      return '用户没有打开文档（纯聊天模式）';
  }
}

// ==========================================
// 消息转换
// ==========================================

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 将 Copilot 消息转换为 LLM 消息格式
 */
function convertMessages(messages: CopilotMessage[]): LLMMessage[] {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES)
    .map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));
}

// ==========================================
// LLM 调用
// ==========================================

export interface CopilotChatResponse {
  /** 回复内容 */
  content: string;
  /** 延迟（毫秒） */
  latencyMs?: number;
}

/**
 * 发送 Copilot 聊天请求
 * 
 * @param docId - 当前文档 ID（可为 null）
 * @param context - 当前上下文
 * @param messages - 历史消息
 */
export async function sendCopilotChat(
  _docId: string | null,
  context: CopilotContext,
  messages: CopilotMessage[]
): Promise<CopilotChatResponse> {
  // 构建 system prompt
  const systemPrompt = buildSystemPrompt(context);

  // 转换消息
  const llmMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...convertMessages(messages),
  ];

  // 调用 LLM（通过 IPC）
  try {
    // 注意：chat 方法期望的参数是 { messages: [...] } 对象
    const response = await window.aiDoc?.chat?.({ messages: llmMessages });

    if (response?.success && response.content) {
      return {
        content: response.content,
      };
    }

    // 处理错误
    const errorMsg = response?.error || 'LLM 响应异常';
    console.error('[CopilotLLMClient] LLM error:', errorMsg);
    return {
      content: `抱歉，发生了错误：${errorMsg}`,
    };
  } catch (error) {
    console.error('[CopilotLLMClient] Request failed:', error);
    return {
      content: '抱歉，网络请求失败。请检查网络连接后重试。',
    };
  }
}

export default sendCopilotChat;

