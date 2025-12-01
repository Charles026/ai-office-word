# Copilot Runtime 设计文档

> 版本：v1.5  
> 日期：2025-11-30  
> 作者：AI Office Team

---

## 0. 现状快照

### 0.1 现有 Copilot 调用链

```
┌─────────────────────────────────────────────────────────────────────┐
│  CopilotPanel.tsx                                                   │
│    ├─ handleSend(userText)                                          │
│    │   ├─ 规则层：resolveCopilotCommandByRules() → ResolvedCommand  │
│    │   │   └─ [高置信度] → runCopilotCommand()                       │
│    │   │                                                            │
│    │   ├─ LLM Router：routeIntentWithLLM()                          │
│    │   │   ├─ mode='command' → runCopilotCommand()                  │
│    │   │   └─ mode='chat' → 继续 fallback                           │
│    │   │                                                            │
│    │   └─ Fallback：callCopilotModel()                              │
│    │       ├─ buildDocContextEnvelope(scope='document'|'section')   │
│    │       ├─ buildSystemPromptFromEnvelope()                       │
│    │       ├─ buildUserPromptFromEnvelope()                         │
│    │       └─ → 返回纯自然语言                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**关键特点**：
- 聊天路径（Fallback）只返回自然语言，没有 Intent 解析
- 命令执行通过 `runCopilotCommand()` → `copilotRuntimeBridge.ts`
- DocContextEnvelope 已支持 `scope='document'` 和 `scope='section'`

### 0.2 现有 Section AI 调用链（可改文档）

```
┌─────────────────────────────────────────────────────────────────────┐
│  sectionAiActions.ts                                                │
│    runSectionAiAction(action, sectionId, context)                   │
│    ├─ extractSectionContext(editor, sectionId)                      │
│    ├─ buildRewriteSectionIntent() / buildSummarizeSectionIntent()   │
│    ├─ buildSectionPrompt({ intent, context, docId })                │
│    ├─ callLlm(systemPrompt, userPrompt)                             │
│    ├─ parseStructuredLlmResponse()                                  │
│    │   └─ 解析 [assistant] [intent] [docops] 三段式                  │
│    ├─ buildSectionDocOpsDiff()                                      │
│    └─ applyDocOps(editor, docOps)                                   │
│        └─ editor.update() → Lexical 节点操作                         │
└─────────────────────────────────────────────────────────────────────┘
```

**关键特点**：
- 使用结构化输出协议：`[assistant][intent][docops]`
- 支持 `responseMode`：`auto_apply` / `preview` / `clarify`
- 通过 `SectionDocOp` 类型描述文档修改
- 直接操作 Lexical 节点（TODO: 迁移到 DocumentEngine）

### 0.3 现有 DocContextEnvelope

已实现两种 scope：

```typescript
// scope = 'document'
{
  focus: { sectionId: null, text: '' },
  global: {
    title: string,
    outline: OutlineEntry[],
    sectionsPreview: SectionPreview[],  // 每个章节的预览
    totalCharCount: number,
  }
}

// scope = 'section'
{
  focus: {
    sectionId: string,
    sectionTitle: string,
    text: string,  // 当前章节完整内容
    charCount: number,
  },
  global: {
    title: string,
    outline: OutlineEntry[],
  }
}
```

### 0.4 现有问题

1. **Copilot 聊天无法改文档**：只返回自然语言，没有 Intent → DocOps 路径
2. **没有统一的 CopilotRuntime**：命令执行分散在 Panel 和 Bridge 中
3. **没有会话记忆**：每次对话独立，无法 refinement
4. **Intent 协议不统一**：Section AI 有自己的协议，Copilot 没有

---

## 1. CopilotSessionState 字段含义

```typescript
interface CopilotSessionState {
  docId: string;               // 当前文档 ID
  scope: 'document' | 'section';  // 当前聚焦范围
  focusSectionId?: string;     // scope='section' 时必填，指向具体章节
  userPrefs: {
    language: 'zh' | 'en' | 'mixed';  // 用户偏好语言
    style: 'concise' | 'detailed';    // 回复风格
  };
  lastTask?: string;           // 最近一次任务类型（用于连续 refinement）
}
```

**设计原则**：
- 最小可用集合，只存储必要状态
- scope 由用户动作自动推断（点大纲 = section，对话整篇文档 = document）
- 不引入复杂的全局记忆，只维护单次会话

---

## 2. Intent 输出协议

### 2.1 支持的 Actions（Phase 1）

| Action | 说明 | 对应 DocOps |
|--------|------|-------------|
| `rewrite_section` | 重写章节（导语/全章） | replace_paragraph |
| `summarize_section` | 总结章节 | replace_paragraph |
| `summarize_document` | 总结整篇文档 | （返回文本，不改文档） |
| `highlight_terms` | 标记关键词 | 格式操作 |

### 2.2 Prompt 输出格式

```
[INTENT]
{
  "mode": "edit" | "chat",
  "action": "rewrite_section" | "summarize_section" | "summarize_document" | "highlight_terms",
  "target": {
    "scope": "document" | "section",
    "sectionId": "xxx"  // scope=section 时必填
  },
  "params": { ... }  // 可选参数
}
[/INTENT]

[REPLY]
给用户看的自然语言回答
[/REPLY]
```

### 2.3 解析容错

- 缺少 `[INTENT]` 块 → 当作纯聊天，`intent = undefined`
- JSON 解析失败 → 当作纯聊天
- `mode = 'chat'` → 不执行任何文档操作
- `mode = 'edit'` 但缺少必要字段 → 降级为聊天，打印警告

---

## 3. CopilotRuntime 调用链

```
┌─────────────────────────────────────────────────────────────────────┐
│  CopilotPanel.tsx                                                   │
│    └─ handleSend(userText)                                          │
│        └─ copilotRuntime.runTurn(userText)                          │
│                                                                     │
│  CopilotRuntime.ts                                                  │
│    runTurn(userText)                                                │
│    ├─ getSessionState()                                             │
│    ├─ buildDocContextEnvelope(scope)                                │
│    ├─ getBehaviorSummary()  // 可选                                  │
│    ├─ buildCopilotSystemPrompt(state, envelope, summary)            │
│    ├─ aiRuntime.chat(messages)                                      │
│    ├─ parseCopilotModelOutput(rawText)                              │
│    │   ├─ 提取 [INTENT]...[/INTENT]                                  │
│    │   ├─ 提取 [REPLY]...[/REPLY]                                    │
│    │   └─ 返回 { intent?, replyText, rawText }                       │
│    │                                                                │
│    ├─ [mode='chat'] → 直接返回 replyText                             │
│    └─ [mode='edit'] → applySectionEdit()                            │
│        └─ 复用现有 sectionAiActions / DocOps                         │
└─────────────────────────────────────────────────────────────────────┘
```

**关键原则**：
- CopilotRuntime 不直接操作 Lexical
- 所有文档修改通过 `applySectionEdit` 桥接现有 Section AI 路径
- 保持日志记录便于调试

---

## 4. 未来扩展

### 4.1 Document 级批处理

支持「帮我把每个章节都总结一下」这类需求：

```typescript
interface BatchTask {
  action: 'summarize_all_sections';
  sectionIds: string[];
  mode: 'sequential';  // 逐个处理，用户可中断
}
```

### 4.2 更复杂的 TaskPlan

引入简单的规划层（但不是多 Agent）：

```typescript
interface TaskPlan {
  goal: string;
  steps: Array<{
    type: 'rewrite' | 'summarize' | 'highlight';
    target: CopilotIntentTarget;
    status: 'pending' | 'running' | 'done' | 'skipped';
  }>;
}
```

### 4.3 连续 Refinement

基于 `lastTask` 支持：
- "再正式一点" → 识别为对上次重写的 refinement
- "不要这个总结，换一个风格" → 撤销并重做

---

## 5. 实现检查清单

### v1.0
- [x] 定义 CopilotSessionState 类型 (`copilotRuntimeTypes.ts`)
- [x] 定义 CopilotIntent 协议类型 (`copilotRuntimeTypes.ts`)
- [x] 实现 buildCopilotSystemPrompt() (`copilotIntentParser.ts`)
- [x] 实现 parseCopilotModelOutput() (`copilotIntentParser.ts`)
- [x] 实现 CopilotRuntime 类 (`CopilotRuntime.ts`)
- [x] 实现 useCopilotRuntime Hook (`useCopilotRuntime.ts`)
- [x] 修改 CopilotPanel 使用 Runtime
- [x] 编写单元测试（类型守约、Intent 解析、Runtime）

### v1.1 (自然语言定位)
- [x] 扩展 Intent 类型支持 `rewrite_paragraph` action
- [x] 添加 `ParagraphRef` 类型和相关 guard 函数
- [x] 更新 System Prompt 包含段落操作说明
- [x] 实现 `resolveEditTarget()` helper 函数
- [x] 实现 `inferParagraphRefFromText()` 自然语言推断
- [x] 段落重写桥接现有 section rewrite (V1 fallback)
- [x] 编写段落操作测试

### 未来计划
- [ ] 支持 document 级批处理
- [ ] 支持连续 refinement
- [ ] 实现真正的单段落 DocOps

---

## 5.1 调试日志（2025-11-30 补充）

### 发现的问题

1. **`useCopilotRuntime` 的 `isEnabled` 判断 bug**
   - 问题：首次渲染时 `runtimeRef.current` 还没创建，导致 `isEnabled` 返回 `false`
   - 修复：添加 `isRuntimeReady` state 跟踪 runtime 创建状态

2. **System Prompt 没有告诉模型如何获取 sectionId**
   - 问题：大纲中没有显示 sectionId，模型不知道用什么值
   - 修复：在大纲中显示 `[sectionId] 章节标题` 格式

3. **Few-shot 示例不够清晰**
   - 问题：示例中的 sectionId 是假值 `sec-001`
   - 修复：添加更多示例，强调必须使用大纲中的真实 ID

4. **调试信息不够明显**
   - 问题：很难判断 Intent 是否被正确解析
   - 修复：在 DEV 模式下显示详细的调试信息块

### 当前行为

| 用户输入 | 预期行为 |
|----------|----------|
| "你看到什么了" | mode=chat，返回文档概述 |
| "这篇文档讲了什么" | mode=chat，返回文档摘要 |
| "帮我改写「XXX」这一节" | mode=edit，使用大纲中对应的 sectionId |
| "帮我改写这一节"（有 focusSectionId） | mode=edit，使用当前聚焦章节的 ID |
| "帮我改写这一节"（无 focusSectionId） | mode=chat，礼貌询问用户想改哪一节 |

### 已知限制

1. **自然语言定位能力有限**：用户说"改写第三段"时，模型可能不知道对应哪个 sectionId
2. **需要配合 UI 触发**：最可靠的方式是在大纲中右键某章节，选择"用 Copilot 改写"
3. **编辑操作是异步的**：调用 `runSectionAiAction` 会再次调用 LLM 生成新内容

---

## 6. 自然语言定位能力 (v1.1 新增)

### 6.1 支持的段落引用短语

| 用户表达 | paragraphRef | paragraphIndex |
|----------|--------------|----------------|
| "这一段" / "这段" / "当前段" | `current` | - |
| "上一段" / "前一段" / "上段" | `previous` | - |
| "下一段" / "后一段" / "下段" | `next` | - |
| "第一段" / "第 1 段" | `nth` | 1 |
| "第二段" / "第 2 段" | `nth` | 2 |
| "第三段" / "第 3 段" | `nth` | 3 |
| ... | `nth` | N |

### 6.2 新增 Action: `rewrite_paragraph`

```typescript
interface CopilotIntent {
  mode: 'edit';
  action: 'rewrite_paragraph';
  target: {
    scope: 'section';
    sectionId: string | 'current' | 'auto';
  };
  params: {
    paragraphRef: 'current' | 'previous' | 'next' | 'nth';
    paragraphIndex?: number;  // 仅 nth 时使用，1-based
  };
}
```

### 6.3 Runtime 解析优先级

`resolveEditTarget()` 函数按以下优先级解析编辑目标：

1. **Intent.params** - LLM 显式指定的 `paragraphRef` / `paragraphIndex`
2. **当前 selection** - 用户光标所在的 block
3. **从 userText 推断** - 使用正则匹配自然语言
4. **Fallback 失败** - 返回友好提示

### 6.4 段落重写实现 (V1)

当前 V1 实现使用 **section rewrite 作为 fallback**：

```
rewrite_paragraph → resolveEditTarget() → kind='paragraph'
    → executeEditIntent() → runSectionAiAction('rewrite', sectionId)
```

**限制**：
- V1 实际上会重写整个章节，而不是只改那一段
- 未来 V2 将实现真正的单段落替换 DocOps

**TODO(copilot-runtime-paragraph)**：
- 实现单段落替换 DocOp
- 在 Prompt 中明确告诉 LLM "只改写第 N 段"
- 支持跨 section 的段落引用（如"改写文档的第三段"）

### 6.5 已知限制

| 场景 | 当前行为 | 未来计划 |
|------|----------|----------|
| 改写当前段落 | 重写整个章节 | 仅替换该段落 |
| 跨 section 引用 | 不支持 | 支持 "文档第 N 段" |
| 中文数字超过 20 | 不支持 | 扩展中文数字解析 |

---

## 7. H1/H2/H3 统一章节语义 (v1.2)

### 7.1 背景

之前的 Section AI 只支持 H2/H3 作为章节，H1 会报错「不支持的标题层级」。
v1.2 扩展了章节语义，让 H1/H2/H3 都能作为 `rewrite_section` / `rewrite_section_intro` 的目标。

### 7.2 章节层级语义

| 层级 | 语义 | 行为 |
|------|------|------|
| H1 | 文档根章节 / 文档标题 | 可作为章节操作目标，遇到下一个 H1 才结束 |
| H2 | 一级章节 | 标准行为，遇到 H1/H2 结束 |
| H3 | 二级子章节 | 标准行为，遇到 H1/H2/H3 结束 |

### 7.3 H1 的特殊行为

- **ownParagraphs**：H1 之后到第一个 H2 之前的段落（文档导语）
- **subtreeParagraphs**：包含整个文档子树（所有 H2/H3 内容）
- **childSections**：包含所有直接下级 H2 的元信息
- **endIndex**：整个 H1 章节的最后一个节点索引（直到下一个 H1 或文档结尾）

### 7.4 修改的文件

| 文件 | 变更 |
|------|------|
| `src/runtime/context/extractSectionContext.ts` | 移除 H1 限制，支持 level=1 |
| `src/ribbon/ai/AiSectionActions.tsx` | 允许 H1/H2/H3 触发 AI 操作 |
| `src/editor/contextMenus/HeadingContextMenu.tsx` | H1 也显示右键菜单 |
| `src/copilot/CopilotHeader.tsx` | 更新错误提示文案 |

---

## 8. 失败模式 & 错误码 (v1.2)

### 8.1 背景

之前 CopilotRuntime 对各种失败场景的处理偏"静默"，用户和开发者难以诊断问题。
v1.2 引入显式的 `intentStatus` 和 `errorCode` 字段。

### 8.2 IntentStatus 类型

```typescript
type IntentStatus = 'ok' | 'missing' | 'invalid' | 'unsupported_action';
```

| 状态 | 含义 | 用户体验 |
|------|------|----------|
| `ok` | Intent 解析成功且有效 | 正常流程 |
| `missing` | 模型未输出 [INTENT] 块 | 当作纯聊天 |
| `invalid` | Intent JSON 解析失败或字段不完整 | 显示友好提示 |
| `unsupported_action` | action 类型不支持 | 显示友好提示 |

### 8.3 ErrorCode 类型

```typescript
type CopilotErrorCode =
  | 'intent_missing'          // 模型未输出 [INTENT]
  | 'invalid_intent_json'     // INTENT JSON 解析失败
  | 'invalid_intent_fields'   // INTENT 缺少必要字段
  | 'section_not_found'       // sectionId 无效或不存在
  | 'unresolvable_target'     // 无法解析编辑目标
  | 'edit_execution_failed'   // runSectionAiAction 执行失败
  | 'llm_call_failed'         // LLM 调用失败
  | 'editor_not_ready'        // 编辑器未就绪
  | 'no_document';            // 无文档打开
```

### 8.4 错误触发节点

| 节点 | 错误条件 | intentStatus | errorCode |
|------|----------|--------------|-----------|
| 初始化检查 | 无文档打开 | invalid | no_document |
| 初始化检查 | 编辑器未就绪 | invalid | editor_not_ready |
| LLM 调用 | API 失败 | invalid | llm_call_failed |
| Intent 解析 | 无 [INTENT] 块 | missing | intent_missing |
| Intent 解析 | JSON 解析失败 | invalid | invalid_intent_json |
| 目标解析 | sectionId 无效 | invalid | section_not_found |
| 目标解析 | 段落无法定位 | invalid | unresolvable_target |
| 编辑执行 | runSectionAiAction 抛错 | ok | edit_execution_failed |

### 8.5 UI 显示

- **DEV 模式**：在消息气泡中显示完整调试信息（intentStatus, errorCode, 原始 Intent）
- **生产模式**：对 `section_not_found` / `unresolvable_target` 显示友好提示

### 8.6 Telemetry

所有错误场景在 DEV 模式下打印 `console.warn` 或 `console.error`，包含：
- 用户输入摘要
- Intent 解析结果
- 错误代码和消息

---

## 9. 连续提问与引用规则 (v1.2)

### 9.1 背景

用户在使用 Copilot 时，常常需要基于上一次编辑进行 follow-up 操作，如：
- "再改短一点" → 使用上次编辑的目标
- "再正式一点" → 保持上次的 sectionId/paragraphIndex

### 9.2 lastEditContext 机制

```typescript
interface LastEditContext {
  sectionId?: string;       // 上次编辑的章节 ID
  paragraphIndex?: number;  // 上次编辑的段落索引 (1-based)
  action?: CopilotAction;   // 上次执行的 action
  timestamp?: number;       // 上次编辑的时间戳
}
```

**更新时机**：
- 仅在 edit intent 成功执行后更新
- 切换文档时清空
- 可通过 `clearLastEditContext()` 手动清除

### 9.3 Follow-up 识别

Runtime 通过正则匹配识别 follow-up 请求：

```typescript
const followUpPatterns = [
  /再.{0,4}(短|简洁|长|详细|正式|口语|专业|通俗|清晰|精炼)/,
  /^(继续|接着|然后)/,
  /^再改/,
];
```

**示例**：
| 用户输入 | 识别结果 | 行为 |
|----------|----------|------|
| 再改短一点 | follow-up | 使用 lastEditContext.sectionId |
| 再正式一点 | follow-up | 使用 lastEditContext.sectionId |
| 继续 | follow-up | 使用 lastEditContext.sectionId |
| 帮我改写第二章 | 非 follow-up | 使用 Intent 中的 sectionId |

### 9.4 解析优先级

`resolveEditTarget` 函数的解析优先级：

1. **Intent.params**: LLM 显式指定的 sectionId
2. **当前 selection**: 用户光标位置
3. **lastEditContext**: follow-up 请求时使用
4. **Fallback**: 第一个章节或返回 unresolvable_target

### 9.5 已知限制

| 场景 | 当前行为 | 未来计划 |
|------|----------|----------|
| 跨文档 follow-up | 不支持（切换文档清空上下文） | 可能支持 |
| "上一次的下一段" | 不支持复合引用 | 待设计 |
| 历史编辑回溯 | 只保留最后一次 | 可扩展为栈 |

---

## 10. 文档上下文构建策略：Always Structure, Sometimes Full Text (v1.4)

### 10.1 核心原则

**任何 Copilot 调用都遵循以下策略**：

1. **始终运行 DocStructureEngine**：构建 `DocSkeleton`
2. **始终附带 skeleton**：在 `DocContextEnvelope` 中
3. **文档小就给全文**：`documentFullText` + skeleton
4. **文档大只给结构**：skeleton + 章节预览

### 10.2 skeleton 是结构的权威来源

```
用户问："这篇文档有几章？"

✅ 正确：基于 skeleton.meta.chapterCount 回答
❌ 错误：自己数大纲条目
```

### 10.3 自然语言章节引用

使用 `resolveSectionByUserText` 从用户输入解析章节引用：

| 用户说 | 解析方式 | 返回 |
|--------|----------|------|
| 第一章 | 索引匹配 | { sectionId: 'sec-1', reason: 'index' } |
| overview | 标题匹配 | { sectionId: 'sec-2', reason: 'exact_title' } |
| 概述部分 | 关键字匹配 | { sectionId: 'sec-1', reason: 'keyword' } |
| 上一章 | 相对引用 | { sectionId: 'sec-N-1', reason: 'index' } |

### 10.4 Prompt 中的展示

```
# 当前文档上下文

**📊 文档结构统计（skeleton.meta）**：
- 章数（chapter）：5
- 节数（section + subsection）：12
- 有概述/绪论：是
- 有结论/总结：是

**📑 文档结构（skeleton）**：
- [sec-1] (章) 第1章 Overview
- [sec-2] (章) 第2章 PRD vs MRD
...

**重要**：skeleton 是文档结构的唯一权威描述。
当用户问"有几章"时，必须基于 skeleton.meta 回答。
```

---

## 11. Full-Doc vs Chunked 模式 (v1.3)

### 10.1 背景

之前 CopilotRuntime 对 document 级别的查询只提供章节预览（snippets），无法让 LLM 看到完整文档内容。
这导致用户提问"文档有几个章节""帮我总结全文"时，LLM 只能依赖不完整的信息。

v1.3 引入 **Full-Doc vs Chunked 模式**，根据文档大小动态决定发送策略。

### 10.2 模式判定逻辑

```typescript
const FULL_DOC_TOKEN_THRESHOLD = 8000; // 约 32000 字符

function determineDocMode(documentTokens: number): DocScopeMode {
  return documentTokens < FULL_DOC_TOKEN_THRESHOLD ? 'full' : 'chunked';
}
```

| 文档大小 | 模式 | LLM 收到的内容 |
|----------|------|----------------|
| < 8000 tokens | `full` | 完整文档文本 + 结构大纲 |
| >= 8000 tokens | `chunked` | 结构大纲 + 各章节预览 |

### 10.3 DocContextEnvelope 扩展

```typescript
interface DocContextEnvelope {
  scope: 'document' | 'section';
  
  // v1.3 新增：仅 scope='document' 时使用
  mode?: 'full' | 'chunked';           // 模式标识
  documentFullText?: string;           // full 模式时填充
  documentTokenEstimate?: number;      // token 估算值
  
  // ... 其他字段
}
```

### 10.4 CopilotRuntime 分流逻辑

```typescript
async runTurn(userText: string): Promise<CopilotTurnResult> {
  const envelope = await this.buildEnvelope();
  
  if (envelope.scope === 'document') {
    if (envelope.mode === 'full' && envelope.documentFullText) {
      return this.runFullDocumentTurn(userText, envelope);
    } else {
      return this.runChunkedDocumentTurn(userText, envelope);
    }
  }
  
  // section scope 保持原有逻辑
  return this.runSectionTurn(userText, envelope);
}
```

### 10.5 Prompt 构建差异

**Full-Doc 模式**：
```
# 当前文档上下文

**模式**：📖 Full-Doc（已提供完整文档内容）
**文档 Token 估算**：约 1250 tokens

**文档大纲（带章节ID）**：
- [sec-1] Overview
- [sec-2] PRD vs MRD

---

**📄 完整文档内容**：

[这里是完整的文档文本...]

---

**Full-Doc 模式说明**：
- 你已获得整篇文档的完整文本
- 可以回答关于文档结构、内容细节、章节统计的问题
- 可以进行全文总结、关键点提取、标题建议等操作
- 若需要编辑文档，请指定具体的 sectionId
```

**Chunked 模式**：
```
# 当前文档上下文

**模式**：📋 Chunked（仅提供结构预览）

**文档大纲（带章节ID）**：
- [sec-1] Overview
- [sec-2] PRD vs MRD

**各章节预览**：
• [sec-1] Overview (2000 字)
  > This is an overview...
• [sec-2] PRD vs MRD (2000 字)
  > PRD focuses on...

**Chunked 模式说明**：
- 你只看到了文档的结构预览和部分段落
- 回答章节统计时请依赖大纲信息
- 若需要查看某个章节的完整内容，请用户点击该章节
```

### 10.6 编辑操作与 Full-Doc 模式

**重要**：即使在 Full-Doc 模式下，编辑类操作（`rewrite_section`, `rewrite_paragraph`）仍然走现有的 Section AI + DocOps 路径。

Full-Doc 模式主要服务于 **阅读类意图**：
- 章节统计、全文总结
- 内容问答、关键点提取
- 标题建议、结构分析

### 10.7 Token 估算工具

```typescript
// src/copilot/utils/tokenUtils.ts

export const FULL_DOC_TOKEN_THRESHOLD = 8000;

/** 粗略估算：1 token ≈ 4 字符 */
export function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
```

### 10.8 测试覆盖

| 测试文件 | 场景 |
|----------|------|
| `tokenUtils.test.ts` | token 估算准确性 |
| `DocContextEnvelope.documentMode.test.ts` | envelope 模式判定、字段填充 |
| `CopilotRuntime.documentMode.test.ts` | 分流逻辑、编辑操作路径 |
| `copilotIntentParser.documentMode.test.ts` | Prompt 构建差异 |

---

## 11. 结构与统计真相：Structure & Stats as Source of Truth (v1.5)

> 本节描述如何确保 Copilot 对"有多少章/小节/字数/标题是什么"类问题的回答基于 **真实结构与统计数据**，而不是 LLM 自由发挥。

### 11.1 设计目标

1. **结构真相**：章节数量、层级、标题等必须来自 `DocStructureEngine`
2. **统计真相**：字数、字符数、Token 数必须来自 runtime 计算
3. **标题分离**：文档标题 vs 章节标题在协议层明确区分
4. **禁止幻觉**：LLM 不得自行估算或发明数字

### 11.2 DocContextEnvelope 增强

```typescript
interface DocContextEnvelope {
  global: {
    // 已有字段
    outline: OutlineEntry[];
    sectionsPreview: SectionPreview[];
    
    // 🆕 v1.5 结构真相
    structure?: {
      chapters: ChapterInfo[];
    };
    
    // 🆕 v1.5 统计真相
    stats?: {
      wordCount?: number;
      charCount?: number;
      tokenEstimate?: number;
    };
    
    // 🆕 v1.5 文档元信息
    meta?: {
      title?: string;
    };
  };
}

interface ChapterInfo {
  id: string;           // sectionId
  level: 1 | 2 | 3;
  titleText: string;
  startBlockIndex: number;
  endBlockIndex: number;
  childCount: number;
}
```

### 11.3 数据来源链路

```
DocumentAst / LexicalEditor
        ↓
DocStructureEngine.buildDocSkeletonFromEditor()
        ↓
DocSkeleton / DocStructureSnapshot
        ↓
buildDocContextEnvelope()
        ↓
DocContextEnvelope
  ├─ global.structure.chapters[] ← 从 skeleton.sections 映射
  ├─ global.stats.wordCount      ← countWords(fullText)
  ├─ global.stats.charCount      ← fullText.length
  ├─ global.stats.tokenEstimate  ← estimateTokensForText(fullText)
  └─ global.meta.title           ← skeleton.meta.title 或 filename
```

### 11.4 结构查询解析器 (`structuralQueryResolver.ts`)

**职责**：
- 从用户自然语言中识别结构查询意图
- 将中文问法映射到结构术语（章/节/段）
- 提供置信度评估，低置信度时返回澄清问题

**支持的查询类型**：

| Kind | 示例问法 | 回答来源 |
|------|----------|----------|
| `chapter_count` | "有几章" / "共多少部分" | `structure.chapters.length` |
| `section_count` | "有几节" / "多少小节" | `structure.chapters` 子节点统计 |
| `paragraph_count` | "有几段" | `stats.paragraphCount` (如有) |
| `word_count` | "多少字" | `stats.wordCount` |
| `char_count` | "多少字符" | `stats.charCount` |
| `token_count` | "多少 token" | `stats.tokenEstimate` |
| `title_query` | "文章标题是什么" | `meta.title` |
| `locate_chapter` | "第一章在哪" | `structure.chapters[0]` |
| `locate_section` | "第二节在哪" | 遍历 `structure.chapters` |

**编辑意图过滤**：

当用户文本包含编辑关键词（如"重写""改写""帮我"）时，解析器返回 `kind: 'other'`，让 LLM 处理为编辑意图：

```typescript
const EDIT_INTENT_KEYWORDS = ['重写', '改写', '修改', '帮我', ...];

if (hasEditIntent) {
  return { kind: 'other', debugInfo: 'skipped - contains edit intent keyword' };
}
```

### 11.5 CopilotRuntime 短路逻辑

在 `runTurn` 中，对于可以直接回答的结构查询，跳过 LLM：

```typescript
const structuralResolution = resolveStructuralQuery(userText, envelope);

if (isStructuralQuery(structuralResolution)) {
  // 可以直接回答：使用 structure/stats 生成回复
  if (canDirectAnswer(structuralResolution)) {
    return {
      replyText: structuralResolution.directAnswer!,
      executed: false,
      intentStatus: 'ok',
    };
  }
  
  // 需要澄清：返回澄清问题
  if (needsClarification(structuralResolution)) {
    return {
      replyText: structuralResolution.clarificationQuestion!,
      executed: false,
      intentStatus: 'ok',
    };
  }
}

// 否则继续走 LLM 路径
```

### 11.6 System Prompt 硬约束

在 Copilot 的 System Prompt 中添加强约束：

```
## 结构与统计规则

1. **禁止数字估算**：你不能凭感觉估计「字数」「token 数」「章节数量」。
   - 如果 `global.stats` 或 `global.structure` 中有对应字段，使用它
   - 如果没有精确数字，只能用模糊表达或说明「系统没有统计到精确数字」
   - 禁止输出诸如"约 2 万字""大约 5,399 tokens"这类看似精确的估计

2. **标题区分**：
   - 「文档标题」= `global.meta.title`
   - 「Overview / PRD vs MRD」等是章节标题，不是文档标题
   - 回答"文章标题是什么"时：
     * 有 `meta.title` → 只复述这个值
     * 无 `meta.title` → 说「当前文档没有单独标注的文档标题」

3. **结构来源**：
   - 章节数量必须来自 `global.structure.chapters`
   - 不要自己分析文档内容推断章节数
```

### 11.7 测试覆盖

| 测试文件 | 场景 |
|----------|------|
| `structuralQueryResolver.test.ts` | 中文问法解析、编辑意图过滤、置信度判定 |
| `CopilotRuntime.followup.test.ts` | 编辑请求不被短路 |
| `docContextEngine.test.ts` | structure/stats 字段填充 |

---

## 12. 文件清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/copilot/copilotRuntimeTypes.ts` | 类型定义：SessionState, Intent, ModelOutput, ParagraphRef, IntentStatus, ErrorCode |
| `src/copilot/copilotIntentParser.ts` | Prompt 构建 + Intent 解析 |
| `src/copilot/CopilotRuntime.ts` | Runtime 核心类 + resolveEditTarget + lastEditContext + 错误处理 |
| `src/copilot/useCopilotRuntime.ts` | React Hook |
| `src/copilot/__tests__/copilotRuntimeTypes.test.ts` | 类型测试 |
| `src/copilot/__tests__/copilotIntentParser.test.ts` | 解析器测试 |
| `src/copilot/__tests__/CopilotRuntime.test.ts` | Runtime 测试（含错误处理测试 v1.2） |
| `src/copilot/__tests__/CopilotRuntime.paragraph.test.ts` | 段落操作测试 (v1.1) |
| `src/copilot/__tests__/CopilotRuntime.reference.test.ts` | 自然语言引用解析测试 (v1.1) |
| `src/copilot/__tests__/CopilotRuntime.followup.test.ts` | 连续提问测试 (v1.2) |
| `src/copilot/utils/tokenUtils.ts` | Token 估算工具 + 阈值常量 (v1.3) |
| `src/copilot/__tests__/copilotIntentParser.documentMode.test.ts` | Prompt Document Mode 测试 (v1.3) |
| `src/copilot/__tests__/CopilotRuntime.documentMode.test.ts` | Document Mode 分流测试 (v1.3) |
| `src/copilot/utils/__tests__/tokenUtils.test.ts` | Token 估算测试 (v1.3) |
| `src/docContext/__tests__/DocContextEnvelope.documentMode.test.ts` | Envelope 模式测试 (v1.3) |
| `src/copilot/structuralQueryResolver.ts` | 结构查询解析器 (v1.5) |
| `src/copilot/__tests__/structuralQueryResolver.test.ts` | 结构查询解析测试 (v1.5) |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/copilot/CopilotPanel.tsx` | 集成 CopilotRuntime，显示 intentStatus/errorCode，编辑失败提示 |
| `src/copilot/index.ts` | 导出新模块 |
| `src/runtime/context/extractSectionContext.ts` | 支持 H1 章节，清理 heading warning (v1.2) |
| `src/runtime/intents/buildSectionIntent.ts` | 支持 H1 level (v1.2) |
| `src/runtime/context/sectionScopeHelpers.ts` | H1 支持 chapter scope (v1.2) |
| `src/ribbon/ai/AiSectionActions.tsx` | 支持 H1/H2/H3 触发 AI 操作 (v1.2) |
| `src/editor/contextMenus/HeadingContextMenu.tsx` | 支持 H1 右键菜单 (v1.2) |
| `src/runtime/context/__tests__/extractSectionContext.test.ts` | H1 测试用例 (v1.2) |
| `src/runtime/intents/__tests__/buildSectionIntent.test.ts` | H1/非法 level 测试 (v1.2) |
| `src/docContext/docContextTypes.ts` | 添加 DocScopeMode、documentFullText、documentTokenEstimate、structure、stats、meta 字段 (v1.3, v1.5) |
| `src/docContext/docContextEngine.ts` | 实现 Full-Doc 模式 envelope 构建，填充 structure/stats/meta (v1.3, v1.5) |
| `src/copilot/copilotIntentParser.ts` | 添加结构与统计硬约束到 System Prompt (v1.5) |
| `src/copilot/CopilotRuntime.ts` | 添加结构查询短路逻辑 (v1.5) |

