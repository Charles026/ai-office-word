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

  // 🆕 structure-stats-sot v1.5: 硬约束放在最前面
  parts.push(buildStructureStatsConstraints(envelope));

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

// ==========================================
// structure-stats-sot v1.5: 硬约束
// ==========================================

/**
 * 构建结构与统计硬约束
 * 
 * 这是 Copilot 必须遵守的规则，放在 System Prompt 最前面。
 * 违反这些规则将导致用户获得错误信息。
 * 
 * @tag structure-stats-sot
 */
function buildStructureStatsConstraints(envelope: DocContextEnvelope): string {
  const { structure, stats, docMeta } = envelope.global;
  
  const lines: string[] = [
    '# ⚠️ 严格约束（必须遵守）',
    '',
    '## 1. 数字禁止幻觉',
    '',
    '你**绝对禁止**凭感觉估计以下数字：',
    '- 字数、字符数',
    '- Token 数',
    '- 章节数量、段落数量',
    '',
    '**规则**：',
    '- 若被问到这类问题，**只能**使用下方提供的 `structure` 和 `stats` 字段',
    '- 如果没有精确数字，只能使用模糊表达（如"篇幅较长"）或说明"系统没有统计到精确数字"',
    '- **禁止**输出类似"约 2 万字""大约 5,399 tokens"这类看似精确的估计',
    '',
  ];
  
  // 提供结构真相
  if (structure) {
    lines.push('## 2. 结构真相（Source of Truth）');
    lines.push('');
    lines.push('以下是文档结构的**唯一权威来源**，回答"有几章/几节"类问题时**必须**使用：');
    lines.push('');
    lines.push('```json');
    lines.push(`{`);
    lines.push(`  "chapterCount": ${structure.chapterCount},`);
    lines.push(`  "totalSectionCount": ${structure.totalSectionCount},`);
    lines.push(`  "chapters": [`);
    
    const chaptersToShow = structure.chapters.slice(0, 10); // 最多显示 10 个
    for (let i = 0; i < chaptersToShow.length; i++) {
      const ch = chaptersToShow[i];
      const comma = i < chaptersToShow.length - 1 ? ',' : '';
      lines.push(`    { "id": "${ch.id}", "title": "${ch.titleText}", "level": ${ch.level}, "childCount": ${ch.childCount} }${comma}`);
    }
    if (structure.chapters.length > 10) {
      lines.push(`    // ... 还有 ${structure.chapters.length - 10} 个章节`);
    }
    
    lines.push(`  ]`);
    lines.push(`}`);
    lines.push('```');
    lines.push('');
  }
  
  // 提供统计真相
  if (stats) {
    lines.push('## 3. 统计真相（Source of Truth）');
    lines.push('');
    lines.push('以下是文档统计的**唯一权威来源**，回答"有多少字/token"类问题时**必须**使用：');
    lines.push('');
    lines.push('```json');
    lines.push(`{`);
    lines.push(`  "charCount": ${stats.charCount},`);
    lines.push(`  "wordCount": ${stats.wordCount},`);
    lines.push(`  "tokenEstimate": ${stats.tokenEstimate},`);
    lines.push(`  "paragraphCount": ${stats.paragraphCount}`);
    lines.push(`}`);
    lines.push('```');
    lines.push('');
  }
  
  // 文档标题规则
  lines.push('## 4. 文档标题 vs 章节标题');
  lines.push('');
  lines.push('**重要区分**：');
  lines.push('- **文档标题**：指整篇文档的名称，从 `docMeta.title` 获取');
  lines.push('- **章节标题**：指大纲中各个章节的名称（如 Overview、PRD vs MRD 等）');
  lines.push('');
  
  if (docMeta) {
    if (docMeta.title) {
      lines.push(`**当前文档标题**：「${docMeta.title}」`);
      if (!docMeta.hasExplicitTitle) {
        lines.push('（注：这是从第一个 H1 推断的，不是显式的文档标题）');
      }
    } else {
      lines.push('**当前文档没有显式标题**');
    }
    lines.push('');
  }
  
  lines.push('**规则**：');
  lines.push('- 回答"文章标题是什么"类问题时：');
  lines.push('  - 如果 `docMeta.title` 存在，只能复述这个字段');
  lines.push('  - 如果字段为空，只能说"当前文档没有单独标注的文档标题"');
  lines.push('- **禁止**自己为文档起名字');
  lines.push('- Overview、PRD vs MRD 等是**章节标题**，不是文档标题');
  lines.push('');
  
  return lines.join('\n');
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

1. **rewrite_section** - 重写整个章节
   - 改进文字表达、调整语气、优化结构
   - 需要用户指定目标章节

2. **rewrite_paragraph** - 重写单个段落 ⭐
   - 当用户说"改写这一段""上一段""第 N 段"时使用
   - 需要在 params 中指定 paragraphRef
   - paragraphRef 可选值：
     * "current" - 当前光标所在段落（"这一段/这段"）
     * "previous" - 上一段
     * "next" - 下一段
     * "nth" - 第 N 段，同时设置 paragraphIndex

3. **summarize_section** - 总结章节
   - 提取章节要点，生成简洁摘要
   - 需要用户指定目标章节

4. **summarize_document** - 总结整篇文档
   - 提取文档核心内容，生成全文摘要
   - 不需要指定章节

5. **highlight_terms** - 标记关键词（暂未实现）
   - 识别并标记文档中的关键术语

当用户的请求不涉及文档编辑时，你应该以普通聊天模式回复。`;
}

/**
 * 构建文档上下文部分
 * 
 * v1.2 更新：支持 Full-Doc 模式
 * - mode='full': 提供完整文档文本 + 结构信息
 * - mode='chunked': 只提供结构预览（原有逻辑）
 * 
 * v1.3 更新：始终优先使用 skeleton 作为结构权威来源
 */
function buildDocumentContextSection(envelope: DocContextEnvelope): string {
  const parts: string[] = ['# 当前文档上下文'];
  const skeleton = envelope.skeleton;

  // 文档标题
  if (envelope.global.title) {
    parts.push(`**文档标题**：${envelope.global.title}`);
  }

  // 🆕 v1.3: 如果有 skeleton，显示结构化统计信息
  if (skeleton) {
    parts.push(buildSkeletonSection(skeleton));
  }

  // 根据 scope 构建不同的上下文
  if (envelope.scope === 'document') {
    // 🆕 v1.2: Full-Doc 模式标记
    const mode = envelope.mode || 'chunked';
    
    if (mode === 'full' && envelope.documentFullText) {
      // ==========================================
      // Full-Doc 模式：提供完整文档文本
      // ==========================================
      parts.push(`**模式**：📖 Full-Doc（已提供完整文档内容）`);
      parts.push(`**文档 Token 估算**：约 ${envelope.documentTokenEstimate} tokens`);
      
      // 🆕 v1.3: 优先使用 skeleton 显示大纲
      if (skeleton) {
        parts.push(buildSkeletonOutline(skeleton));
      } else if (envelope.global.outline.length > 0) {
        const outlineText = envelope.global.outline
          .map(o => `${'  '.repeat(o.level - 1)}- [${o.sectionId}] ${o.title}`)
          .join('\n');
        parts.push(`**文档大纲（带章节ID）**：\n${outlineText}`);
      }
      
      parts.push(`\n**重要**：skeleton 是文档结构的唯一权威描述。当用户问"有几章"时，必须基于 skeleton.meta 回答，不要自己推断。`);
      
      // 🆕 完整文档文本
      parts.push(`\n---\n\n**📄 完整文档内容**：\n\n${envelope.documentFullText}\n\n---`);
      
      // 总字数
      if (envelope.global.totalCharCount) {
        parts.push(`**文档总字数**：约 ${envelope.global.totalCharCount} 字`);
      }
      
      // Full-Doc 模式说明
      parts.push(`\n**Full-Doc 模式说明**：
- 你已获得整篇文档的完整文本
- 可以回答关于文档结构、内容细节、章节统计的问题
- 可以进行全文总结、关键点提取、标题建议等操作
- 若需要编辑文档（rewrite/summarize），请指定具体的 sectionId
- **不要**在此模式下直接修改文档，只提供分析和建议`);
      
    } else {
      // ==========================================
      // Chunked 模式：只提供结构和预览
      // ==========================================
      parts.push(`**模式**：📋 Chunked（仅提供结构预览）`);
      
      // 🆕 v1.3: 优先使用 skeleton 显示大纲
      if (skeleton) {
        parts.push(buildSkeletonOutline(skeleton));
      } else if (envelope.global.outline.length > 0) {
        const outlineText = envelope.global.outline
          .map(o => `${'  '.repeat(o.level - 1)}- [${o.sectionId}] ${o.title}`)
          .join('\n');
        parts.push(`**文档大纲（带章节ID）**：\n${outlineText}`);
        
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
      
      // Chunked 模式说明
      parts.push(`\n**Chunked 模式说明**：
- 你只看到了文档的结构预览和部分段落
- 回答章节统计时**必须**依赖 skeleton.meta 的信息
- 若需要查看某个章节的完整内容，请用户点击该章节`);
    }
  } else if (envelope.scope === 'section') {
    // 章节级别：显示当前章节详情
    if (envelope.focus.sectionTitle) {
      parts.push(`**当前聚焦章节**：${envelope.focus.sectionTitle}`);
    }
    // 明确显示当前章节的 sectionId
    if (envelope.focus.sectionId) {
      parts.push(`**当前章节ID**：\`${envelope.focus.sectionId}\`（执行编辑操作时使用此ID）`);
    }
    if (envelope.focus.text) {
      parts.push(`**章节内容**：\n${envelope.focus.text}`);
    }
    if (envelope.focus.charCount) {
      parts.push(`**章节字数**：${envelope.focus.charCount} 字`);
    }

    // 🆕 v1.3: 优先使用 skeleton 显示大纲
    if (skeleton) {
      parts.push(buildSkeletonOutline(skeleton, envelope.focus.sectionId || undefined));
    } else if (envelope.global.outline.length > 0) {
      const outlineText = envelope.global.outline
        .map(o => `${'  '.repeat(o.level - 1)}- [${o.sectionId}] ${o.title}${o.sectionId === envelope.focus.sectionId ? ' ← 当前' : ''}`)
        .join('\n');
      parts.push(`**文档大纲**：\n${outlineText}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * 构建 skeleton 统计信息部分
 */
function buildSkeletonSection(skeleton: import('../document/structure').DocSkeleton): string {
  const meta = skeleton.meta;
  const lines: string[] = [
    '**📊 文档结构统计（skeleton.meta）**：',
    `- 章数（chapter）：${meta.chapterCount}`,
    `- 节数（section + subsection）：${meta.sectionCount}`,
    `- 总段落数：${meta.totalParagraphs}`,
    `- 有概述/绪论：${meta.hasIntro ? '是' : '否'}`,
    `- 有结论/总结：${meta.hasConclusion ? '是' : '否'}`,
    `- 语言：${meta.languageHint === 'zh' ? '中文' : meta.languageHint === 'en' ? '英文' : meta.languageHint === 'mixed' ? '中英混合' : '其他'}`,
  ];
  return lines.join('\n');
}

/**
 * 构建基于 skeleton 的结构化大纲
 */
function buildSkeletonOutline(
  skeleton: import('../document/structure').DocSkeleton,
  currentSectionId?: string
): string {
  const lines: string[] = ['**📑 文档结构（skeleton）**：'];
  
  function formatRole(role: string): string {
    const roleLabels: Record<string, string> = {
      'chapter': '章',
      'section': '节',
      'subsection': '小节',
      'appendix': '附录',
      'meta': '元信息',
    };
    return roleLabels[role] || role;
  }
  
  function traverse(
    section: import('../document/structure').DocSectionSkeleton,
    depth: number = 0
  ) {
    const indent = '  '.repeat(depth);
    const roleLabel = formatRole(section.role);
    const indexLabel = section.displayIndex ? `${section.displayIndex} ` : '';
    const currentMarker = section.id === currentSectionId ? ' ← 当前' : '';
    
    lines.push(
      `${indent}- [${section.id}] (${roleLabel}) ${indexLabel}${section.title}${currentMarker}`
    );
    
    for (const child of section.children) {
      traverse(child, depth + 1);
    }
  }
  
  for (const section of skeleton.sections) {
    traverse(section);
  }
  
  lines.push('');
  lines.push('**重要**：上面方括号中的内容是章节 ID（sectionId）。当你需要执行 rewrite_section 时，请使用这些 ID。');
  
  return lines.join('\n');
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
4. **sectionId 可以是大纲中的真实 ID，也可以是 "current" 表示当前聚焦的章节**

## mode 选择规则

- **mode="chat"**：用户只是提问、询问信息、不涉及修改文档
- **mode="edit"**：用户明确表示要「改写」「重写」「润色」「总结」「修改」文档内容

## action 和 参数规则

| action | 说明 | sectionId | params |
|--------|------|-----------|--------|
| rewrite_section | 重写整个章节 | 必须提供（大纲ID或"current"） | 无 |
| rewrite_paragraph | 重写单个段落 | 必须提供（大纲ID或"current"） | paragraphRef, paragraphIndex |
| summarize_section | 总结章节 | 必须提供 | 无 |
| summarize_document | 总结文档 | 不需要 | 无 |

## params.paragraphRef 值（用于 rewrite_paragraph）

| 用户表达 | paragraphRef | paragraphIndex |
|----------|--------------|----------------|
| "这一段""这段" | "current" | 不需要 |
| "上一段" | "previous" | 不需要 |
| "下一段" | "next" | 不需要 |
| "第三段""第 3 段" | "nth" | 3 |

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

**用户说："帮我改写这一段"（当前在某个章节内）**
\`\`\`
[INTENT]
{"mode":"edit","action":"rewrite_paragraph","target":{"scope":"section","sectionId":"current"},"params":{"paragraphRef":"current"}}
[/INTENT]

[REPLY]
好的，我来帮你改写当前这一段的内容。
[/REPLY]
\`\`\`

**用户说："帮我改写上一段"**
\`\`\`
[INTENT]
{"mode":"edit","action":"rewrite_paragraph","target":{"scope":"section","sectionId":"current"},"params":{"paragraphRef":"previous"}}
[/INTENT]

[REPLY]
好的，我来帮你改写上一段的内容。
[/REPLY]
\`\`\`

**用户说："帮我改写第三段"**
\`\`\`
[INTENT]
{"mode":"edit","action":"rewrite_paragraph","target":{"scope":"section","sectionId":"current"},"params":{"paragraphRef":"nth","paragraphIndex":3}}
[/INTENT]

[REPLY]
好的，我来帮你改写第三段的内容。
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

**重要**：
- 当用户说"改写这一段""这段话"时，使用 **rewrite_paragraph** 并设置 paragraphRef
- 当用户说"改写这一节""这一小节""整节"时，使用 **rewrite_section**
- 如果不确定具体位置，可以使用 sectionId="current" 让系统自动定位`;
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
    parseStatus: 'missing', // 默认状态，稍后更新
  };

  if (!raw || typeof raw !== 'string') {
    if (__DEV__) {
      console.warn('[CopilotIntentParser] Empty or invalid raw text');
    }
    result.replyText = '抱歉，我无法理解您的请求。';
    result.parseStatus = 'missing';
    result.parseError = 'Empty or invalid raw text';
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
        result.parseStatus = 'ok';
        if (__DEV__) {
          console.log('[CopilotIntentParser] ✅ Intent parsed successfully:', {
            mode: parsedIntent.mode,
            action: parsedIntent.action,
            scope: parsedIntent.target.scope,
            sectionId: parsedIntent.target.sectionId,
          });
        }
      } else {
        // v1.1: 记录验证失败状态
        result.parseStatus = 'validation_error';
        result.parseError = 'Intent validation failed: missing required fields (mode/action/target.scope/sectionId)';
        if (__DEV__) {
          console.warn('[CopilotIntentParser] ❌ Intent validation failed:', intentJson);
          console.warn('[CopilotIntentParser] Validation requires: mode (chat|edit), action, target.scope, and sectionId for section actions');
        }
      }
    } catch (parseError) {
      // v1.1: 记录 JSON 解析失败状态
      result.parseStatus = 'json_error';
      result.parseError = `JSON parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
      if (__DEV__) {
        console.warn('[CopilotIntentParser] ❌ JSON parse failed:', parseError);
        console.warn('[CopilotIntentParser] Raw JSON string:', intentJsonStr.slice(0, 300));
      }
      // 解析失败，intent 保持 undefined
    }
  } else {
    // v1.1: 记录缺失状态
    result.parseStatus = 'missing';
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
  const executableActions = ['rewrite_section', 'rewrite_paragraph', 'summarize_section'];
  return executableActions.includes(intent.action);
}

/**
 * 从 Intent 构建用户友好的操作描述
 */
export function describeIntent(intent: CopilotIntent): string {
  const actionLabels: Record<string, string> = {
    'rewrite_section': '重写章节',
    'rewrite_paragraph': '重写段落',
    'summarize_section': '总结章节',
    'summarize_document': '总结文档',
    'highlight_terms': '标记关键词',
  };

  const actionLabel = actionLabels[intent.action] || intent.action;
  
  if (intent.mode === 'chat') {
    return `聊天（${actionLabel}）`;
  }
  
  // 如果是段落操作，添加段落引用信息
  if (intent.action === 'rewrite_paragraph' && intent.params?.paragraphRef) {
    const refLabels: Record<string, string> = {
      'current': '当前段落',
      'previous': '上一段',
      'next': '下一段',
      'nth': `第 ${intent.params.paragraphIndex || '?'} 段`,
    };
    const refLabel = refLabels[intent.params.paragraphRef as string] || '';
    return refLabel ? `${actionLabel}（${refLabel}）` : actionLabel;
  }
  
  return actionLabel;
}

