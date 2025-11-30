/**
 * Copilot Intent 解析器
 * 
 * 【职责】
 * - 构建 Copilot System Prompt（告诉 LLM 输出格式）
 * - 从 LLM 原始输出中解析 [INTENT] 和 [REPLY] 块
 * - 容错处理，解析失败时降级为纯聊天
 * 
 * 【Prompt 协议】
 * LLM 必须使用以下格式输出：
 * 
 * [INTENT]
 * { "mode": "edit"|"chat", "action": "...", "target": {...}, "params": {...} }
 * [/INTENT]
 * 
 * [REPLY]
 * 给用户看的自然语言回答
 * [/REPLY]
 */

import type {
  CopilotSessionState,
  CopilotModelOutput,
  CopilotIntent,
  IntentParseResult,
} from './copilotRuntimeTypes';
import { parseCopilotIntentSafe } from './copilotRuntimeTypes';
import type { DocContextEnvelope } from '../docContext';
import type { BehaviorSummary } from '../interaction';

// ==========================================
// 常量
// ==========================================

const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

/** [INTENT] 标记正则 */
const INTENT_BLOCK_REGEX = /\[INTENT\]([\s\S]*?)\[\/INTENT\]/i;

/** [REPLY] 标记正则 */
const REPLY_BLOCK_REGEX = /\[REPLY\]([\s\S]*?)\[\/REPLY\]/i;

// ==========================================
// System Prompt 构建
// ==========================================

/**
 * 构建 Copilot System Prompt
 * 
 * 告诉 LLM：
 * 1. 它的角色和能力
 * 2. 文档上下文（从 DocContextEnvelope）
 * 3. 输出格式要求
 * 4. 用户偏好
 * 
 * @param state - 当前会话状态
 * @param envelope - 文档上下文信封
 * @param behaviorSummary - 用户行为摘要（可选）
 */
export function buildCopilotSystemPrompt(
  state: CopilotSessionState,
  envelope: DocContextEnvelope,
  behaviorSummary?: BehaviorSummary
): string {
  const parts: string[] = [];

  // 1. 角色定义
  parts.push(buildRoleDefinition(state));

  // 2. 能力说明
  parts.push(buildCapabilitiesSection(state));

  // 3. 文档上下文
  parts.push(buildDocumentContextSection(envelope));

  // 4. 输出格式要求
  parts.push(buildOutputFormatSection());

  // 5. 用户偏好
  parts.push(buildUserPrefsSection(state));

  // 6. 行为摘要（可选）
  if (behaviorSummary && behaviorSummary.summaryText) {
    parts.push(buildBehaviorSummarySection(behaviorSummary));
  }

  return parts.join('\n\n');
}

/**
 * 构建角色定义部分
 */
function buildRoleDefinition(state: CopilotSessionState): string {
  return `# 角色

你是 **AI Office Copilot**，嵌入在一个本地 AI Word 编辑器中的写作助手。

你的职责：
- 帮助用户理解和改进他们的文档
- 在用户需要时执行文档编辑操作（重写、总结等）
- 以自然、专业的方式与用户交流`;
}

/**
 * 构建能力说明部分
 */
function buildCapabilitiesSection(state: CopilotSessionState): string {
  return `# 能力

你可以执行以下操作：

1. **rewrite_section** - 重写章节
   - 改进文字表达、调整语气、优化结构
   - 需要用户指定目标章节

2. **summarize_section** - 总结章节
   - 提取章节要点，生成简洁摘要
   - 需要用户指定目标章节

3. **summarize_document** - 总结整篇文档
   - 提取文档核心内容，生成全文摘要
   - 不需要指定章节

4. **highlight_terms** - 标记关键词（暂未实现）
   - 识别并标记文档中的关键术语

当用户的请求不涉及文档编辑时，你应该以普通聊天模式回复。`;
}

/**
 * 构建文档上下文部分
 */
function buildDocumentContextSection(envelope: DocContextEnvelope): string {
  const parts: string[] = ['# 当前文档上下文'];

  // 文档标题
  if (envelope.global.title) {
    parts.push(`**文档标题**：${envelope.global.title}`);
  }

  // 根据 scope 构建不同的上下文
  if (envelope.scope === 'document') {
    // 文档级别：显示大纲和各章节预览，包含 sectionId
    if (envelope.global.outline.length > 0) {
      // 🆕 显示 sectionId，让模型知道可以使用哪些 ID
      const outlineText = envelope.global.outline
        .map(o => `${'  '.repeat(o.level - 1)}- [${o.sectionId}] ${o.title}`)
        .join('\n');
      parts.push(`**文档大纲（带章节ID）**：\n${outlineText}`);
      
      // 🆕 明确告诉模型如何使用这些 ID
      parts.push(`\n**重要**：上面方括号中的内容（如 \`${envelope.global.outline[0]?.sectionId || 'section-xxx'}\`）就是章节ID（sectionId），当你需要执行 rewrite_section 或 summarize_section 时，请使用这些 ID。`);
    }

    // 各章节预览
    if (envelope.global.sectionsPreview && envelope.global.sectionsPreview.length > 0) {
      parts.push('**各章节预览**：');
      for (const section of envelope.global.sectionsPreview) {
        const indent = '  '.repeat(section.level - 1);
        parts.push(`${indent}• [${section.sectionId}] ${section.title} (${section.charCount} 字)`);
        if (section.snippet) {
          parts.push(`${indent}  > ${section.snippet}`);
        }
      }
    }

    // 总字数
    if (envelope.global.totalCharCount) {
      parts.push(`**文档总字数**：约 ${envelope.global.totalCharCount} 字`);
    }
  } else if (envelope.scope === 'section') {
    // 章节级别：显示当前章节详情
    if (envelope.focus.sectionTitle) {
      parts.push(`**当前聚焦章节**：${envelope.focus.sectionTitle}`);
    }
    // 🆕 明确显示当前章节的 sectionId
    if (envelope.focus.sectionId) {
      parts.push(`**当前章节ID**：\`${envelope.focus.sectionId}\`（执行编辑操作时使用此ID）`);
    }
    if (envelope.focus.text) {
      parts.push(`**章节内容**：\n${envelope.focus.text}`);
    }
    if (envelope.focus.charCount) {
      parts.push(`**章节字数**：${envelope.focus.charCount} 字`);
    }

    // 也显示简化的大纲，带 sectionId
    if (envelope.global.outline.length > 0) {
      const outlineText = envelope.global.outline
        .map(o => `${'  '.repeat(o.level - 1)}- [${o.sectionId}] ${o.title}${o.sectionId === envelope.focus.sectionId ? ' ← 当前' : ''}`)
        .join('\n');
      parts.push(`**文档大纲**：\n${outlineText}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * 构建输出格式部分
 */
function buildOutputFormatSection(): string {
  return `# 输出格式要求

你**必须**严格使用以下格式输出，包含 [INTENT] 和 [REPLY] 两个块：

\`\`\`
[INTENT]
{"mode":"edit或chat","action":"动作名","target":{"scope":"document或section","sectionId":"章节ID"},"params":{}}
[/INTENT]

[REPLY]
给用户看的自然语言回复
[/REPLY]
\`\`\`

## 关键规则

1. **每次回复都必须包含 [INTENT] 块**，即使是纯聊天
2. **每次回复都必须包含 [REPLY] 块**
3. **JSON 必须是单行有效 JSON**，不要换行
4. **sectionId 必须使用文档大纲中提供的真实 ID**（如上面显示的 \`[xxx-xxx]\` 格式）

## mode 选择规则

- **mode="chat"**：用户只是提问、询问信息、不涉及修改文档
- **mode="edit"**：用户明确表示要「改写」「重写」「润色」「总结」「修改」文档内容

## action 和 sectionId 规则

| action | 说明 | sectionId 要求 |
|--------|------|----------------|
| rewrite_section | 重写/改写/润色章节 | **必须**提供（从大纲中选择） |
| summarize_section | 总结章节 | **必须**提供 |
| summarize_document | 总结整篇文档 | 不需要（scope=document） |

## 示例

**用户说："你看到了什么内容？"**
\`\`\`
[INTENT]
{"mode":"chat","action":"summarize_document","target":{"scope":"document"}}
[/INTENT]

[REPLY]
这篇文档是关于产品需求管理的指南，包含以下章节...
[/REPLY]
\`\`\`

**用户说："帮我改写「PRD vs MRD」这一节"（假设该章节ID是 abc-123）**
\`\`\`
[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section","sectionId":"abc-123"}}
[/INTENT]

[REPLY]
好的，我来帮你改写「PRD vs MRD」这一节的内容，让表达更清晰流畅。
[/REPLY]
\`\`\`

**用户说："帮我总结一下这篇文档"**
\`\`\`
[INTENT]
{"mode":"chat","action":"summarize_document","target":{"scope":"document"}}
[/INTENT]

[REPLY]
这篇文档的核心内容如下：...（这里是总结内容，不修改文档）
[/REPLY]
\`\`\`

**用户说："帮我把「背景介绍」这一节内容精简一下"（假设该章节ID是 def-456）**
\`\`\`
[INTENT]
{"mode":"edit","action":"rewrite_section","target":{"scope":"section","sectionId":"def-456"},"params":{"length":"shorter"}}
[/INTENT]

[REPLY]
好的，我来帮你精简「背景介绍」这一节的内容。
[/REPLY]
\`\`\`

**重要**：当用户说"改写这一段"或"帮我润色当前章节"时，如果上下文中有「当前章节ID」，请使用那个 ID；否则请礼貌地询问用户想要改写哪个章节。`;
}

/**
 * 构建用户偏好部分
 */
function buildUserPrefsSection(state: CopilotSessionState): string {
  const langLabel = state.userPrefs.language === 'zh' ? '中文' : state.userPrefs.language === 'en' ? '英文' : '中英混合';
  const styleLabel = state.userPrefs.style === 'concise' ? '简洁' : '详细';

  return `# 用户偏好

- **回复语言**：${langLabel}
- **回复风格**：${styleLabel}

请根据用户偏好调整你的回复。`;
}

/**
 * 构建行为摘要部分
 */
function buildBehaviorSummarySection(summary: BehaviorSummary): string {
  return `# 用户最近的操作

${summary.summaryText}

请参考这些信息，更好地理解用户的写作意图。`;
}

// ==========================================
// 输出解析
// ==========================================

/**
 * 解析 Copilot 模型输出
 * 
 * 从 LLM 原始响应中提取 [INTENT] 和 [REPLY] 块。
 * 
 * 容错策略：
 * 1. 如果找到 [INTENT] 块，尝试解析 JSON
 * 2. JSON 解析失败 → intent 置为 undefined
 * 3. 如果找到 [REPLY] 块，使用其内容
 * 4. 如果没有 [REPLY] 块，使用原文作为回复
 * 
 * @param raw - LLM 原始输出
 * @returns CopilotModelOutput
 */
export function parseCopilotModelOutput(raw: string): CopilotModelOutput {
  const result: CopilotModelOutput = {
    intent: undefined,
    replyText: '',
    rawText: raw,
  };

  if (!raw || typeof raw !== 'string') {
    if (__DEV__) {
      console.warn('[CopilotIntentParser] Empty or invalid raw text');
    }
    result.replyText = '抱歉，我无法理解您的请求。';
    return result;
  }

  // 1. 尝试提取 [INTENT] 块
  const intentMatch = raw.match(INTENT_BLOCK_REGEX);
  if (intentMatch && intentMatch[1]) {
    const intentJsonStr = intentMatch[1].trim();
    
    if (__DEV__) {
      console.log('[CopilotIntentParser] Found [INTENT] block:', intentJsonStr.slice(0, 200));
    }
    
    try {
      // 清理可能的 markdown 代码块包装
      const cleanedJson = stripMarkdownCodeBlock(intentJsonStr);
      
      if (__DEV__) {
        console.log('[CopilotIntentParser] Cleaned JSON:', cleanedJson);
      }
      
      const intentJson = JSON.parse(cleanedJson);
      
      // 使用安全解析函数验证结构
      const parsedIntent = parseCopilotIntentSafe(intentJson);
      if (parsedIntent) {
        result.intent = parsedIntent;
        if (__DEV__) {
          console.log('[CopilotIntentParser] ✅ Intent parsed successfully:', {
            mode: parsedIntent.mode,
            action: parsedIntent.action,
            scope: parsedIntent.target.scope,
            sectionId: parsedIntent.target.sectionId,
          });
        }
      } else {
        if (__DEV__) {
          console.warn('[CopilotIntentParser] ❌ Intent validation failed:', intentJson);
          console.warn('[CopilotIntentParser] Validation requires: mode (chat|edit), action, target.scope, and sectionId for section actions');
        }
      }
    } catch (parseError) {
      if (__DEV__) {
        console.warn('[CopilotIntentParser] ❌ JSON parse failed:', parseError);
        console.warn('[CopilotIntentParser] Raw JSON string:', intentJsonStr.slice(0, 300));
      }
      // 解析失败，intent 保持 undefined
    }
  } else {
    if (__DEV__) {
      console.warn('[CopilotIntentParser] ⚠️ No [INTENT] block found in LLM output');
      console.warn('[CopilotIntentParser] Output preview:', raw.slice(0, 300));
    }
  }

  // 2. 尝试提取 [REPLY] 块
  const replyMatch = raw.match(REPLY_BLOCK_REGEX);
  if (replyMatch && replyMatch[1]) {
    result.replyText = replyMatch[1].trim();
  } else {
    // 没有 [REPLY] 块，尝试使用原文（去掉 INTENT 块）
    let fallbackText = raw;
    if (intentMatch) {
      fallbackText = raw.replace(INTENT_BLOCK_REGEX, '').trim();
    }
    result.replyText = fallbackText || '抱歉，我无法生成有效的回复。';
    
    if (__DEV__) {
      console.debug('[CopilotIntentParser] No [REPLY] block, using fallback');
    }
  }

  return result;
}

/**
 * 去除 JSON 字符串中的 Markdown 代码块包装
 */
function stripMarkdownCodeBlock(text: string): string {
  let result = text.trim();
  
  // 去除开头的 ```json 或 ``` 标记
  result = result.replace(/^```(?:json|JSON)?\s*\n?/m, '');
  
  // 去除结尾的 ``` 标记
  result = result.replace(/\n?```\s*$/m, '');
  
  return result.trim();
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 检查 Intent 是否可执行（edit 模式且有有效 action）
 */
export function isIntentExecutable(intent: CopilotIntent | undefined): boolean {
  if (!intent) return false;
  if (intent.mode !== 'edit') return false;
  
  // 目前只支持这几个 action
  const executableActions = ['rewrite_section', 'summarize_section'];
  return executableActions.includes(intent.action);
}

/**
 * 从 Intent 构建用户友好的操作描述
 */
export function describeIntent(intent: CopilotIntent): string {
  const actionLabels: Record<string, string> = {
    'rewrite_section': '重写章节',
    'summarize_section': '总结章节',
    'summarize_document': '总结文档',
    'highlight_terms': '标记关键词',
  };

  const actionLabel = actionLabels[intent.action] || intent.action;
  
  if (intent.mode === 'chat') {
    return `聊天（${actionLabel}）`;
  }
  
  return actionLabel;
}

