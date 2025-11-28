/**
 * Intent Router Agent - LLM 意图路由器
 * 
 * 【职责】
 * - 在规则层无法确定意图时，调用 LLM 进行精判
 * - 在有限命令集合里做选择，或判断为普通聊天
 * 
 * 【架构定位】
 * 这是一个「单模型 Multi-Agent 架构」中的 IntentRouterAgent：
 * - 当前版本只在规则层不确定时调用，减少 token 消耗
 * - 与 DocAgent 一起构成小型 multi-agent 系统
 * 
 * 【未来扩展】
 * - 支持更多命令（格式调整、生成大纲等）
 * - 支持 multi-turn：参考 lastActions 做连续对话
 * - 在某些命令上要求 Router 附带 options（tone/length）
 */

import { CopilotContext } from './copilotTypes';
import { RoughKind, ResolvedCommand, CopilotCommand, commandNeedsSection } from './copilotCommands';

// ==========================================
// 类型定义
// ==========================================

/**
 * Router 返回结果
 */
export interface RouterResult {
  /** 模式：command = 执行命令，chat = 普通聊天 */
  mode: 'command' | 'chat';
  /** 当 mode='command' 时的命令 */
  command?: ResolvedCommand;
  /** 调试用：Router 的决策理由 */
  reason?: string;
}

/**
 * LLM 返回的 JSON 结构
 */
interface RouterLLMResponse {
  mode: 'command' | 'chat';
  command?: string;
  scope?: string;
  reason?: string;
}

// ==========================================
// 常量
// ==========================================

const __DEV__ = process.env.NODE_ENV !== 'production';

/**
 * 支持的命令列表
 */
const SUPPORTED_COMMANDS: CopilotCommand[] = [
  'rewrite_selection',
  'summarize_selection',
  'translate_selection',
  'rewrite_section_intro',
  'summarize_section',
  'expand_section',
  'summarize_document',
];

// ==========================================
// System Prompt
// ==========================================

const ROUTER_SYSTEM_PROMPT = `你是一个《文档编辑 Copilot 的意图路由器》。

你的任务是：根据用户输入和当前上下文，决定是否执行一个"文档操作命令"。

如果没有明确的文档操作意图，就返回 mode:"chat"，让上层当普通聊天处理，不要改文档。

你只能在下面这几个命令里选择（command 字段）：
- rewrite_selection: 重写选区
- summarize_selection: 总结选区
- translate_selection: 翻译选区
- rewrite_section_intro: 重写章节导语
- summarize_section: 总结章节
- expand_section: 扩写章节
- summarize_document: 总结整篇文档

scope 字段含义：
- "selection": 针对当前选区
- "section": 针对当前 H2/H3 小节
- "document": 针对整篇文档

决策规则：
1. 如果用户明确说要"改写"、"重写"、"润色"某个部分 → 选择对应的 rewrite 命令
2. 如果用户说要"总结"、"概括" → 选择对应的 summarize 命令
3. 如果用户说要"翻译" → 选择 translate 命令
4. 如果用户说要"扩写"、"展开"、"详细一点" → 选择 expand 命令
5. 如果用户只是提问、闲聊、或意图不明确 → 返回 mode:"chat"

如果无法确定要执行哪一个命令，或者用户只是提问/闲聊，请返回：
{
  "mode": "chat",
  "reason": "用户意图不明确/只是在提问"
}

严格输出 JSON，不要多余文字。`;

// ==========================================
// 核心函数
// ==========================================

/**
 * 构建 User Prompt
 */
function buildUserPrompt(
  userText: string,
  context: CopilotContext,
  roughKind: RoughKind
): string {
  const selectionSnippet = context.selectionSnippet
    ? context.selectionSnippet.slice(0, 100) + (context.selectionSnippet.length > 100 ? '...' : '')
    : null;

  return `用户指令: ${userText}

当前上下文:
- docId: ${context.docId || '无'}
- scope: ${context.scope}
- sectionId: ${context.sectionId || '无'}
- sectionTitle: ${context.sectionTitle || '无'}
- selectionSnippet: ${selectionSnippet || '无选区'}
- roughKind: ${roughKind}

请分析用户意图，返回 JSON 格式的决策结果。`;
}

/**
 * 调用 LLM 进行意图路由
 * 
 * @param userText - 用户输入
 * @param context - 当前上下文
 * @param roughKind - 规则层粗分类结果
 * @returns Router 决策结果
 */
export async function routeIntentWithLLM(
  userText: string,
  context: CopilotContext,
  roughKind: RoughKind
): Promise<RouterResult> {
  if (__DEV__) {
    console.log('[IntentRouter] Calling LLM...', { userText: userText.slice(0, 50), roughKind });
  }

  try {
    // 1. 构建 prompt
    const userPrompt = buildUserPrompt(userText, context, roughKind);

    // 2. 调用 LLM
    const response = await window.aiDoc?.chat?.({
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    if (!response?.success || !response.content) {
      if (__DEV__) console.warn('[IntentRouter] LLM call failed:', response?.error);
      return { mode: 'chat', reason: 'LLM 调用失败' };
    }

    // 3. 解析 JSON
    const content = response.content.trim();
    let json: RouterLLMResponse;
    
    try {
      // 尝试提取 JSON（处理可能的 markdown 代码块）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      json = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      if (__DEV__) console.warn('[IntentRouter] JSON parse failed:', content);
      return { mode: 'chat', reason: 'LLM 输出格式错误' };
    }

    // 4. 校验结果
    if (json.mode !== 'command') {
      return { mode: 'chat', reason: json.reason || 'LLM 判定为聊天' };
    }

    // 5. 校验命令
    const command = json.command as CopilotCommand;
    if (!SUPPORTED_COMMANDS.includes(command)) {
      if (__DEV__) console.warn('[IntentRouter] Unknown command:', command);
      return { mode: 'chat', reason: '不支持的命令' };
    }

    // 6. 校验上下文需求
    if (commandNeedsSection(command) && !context.sectionId) {
      if (__DEV__) console.log('[IntentRouter] Command needs section but no sectionId');
      return { mode: 'chat', reason: '命令需要 section 上下文' };
    }

    // 7. 构造 ResolvedCommand
    const resolvedCommand: ResolvedCommand = {
      command,
      scope: (json.scope as any) || context.scope || 'section',
      docId: context.docId,
      sectionId: context.sectionId,
      sectionTitle: context.sectionTitle,
      options: { fromRouter: true },
    };

    if (__DEV__) {
      console.log('[IntentRouter] Resolved:', command, 'reason:', json.reason);
    }

    return {
      mode: 'command',
      command: resolvedCommand,
      reason: json.reason,
    };

  } catch (error) {
    if (__DEV__) console.error('[IntentRouter] Error:', error);
    return { mode: 'chat', reason: '路由器异常' };
  }
}

