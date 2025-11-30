# Copilot Runtime 设计文档

> 版本：v1.0  
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

- [x] 定义 CopilotSessionState 类型 (`copilotRuntimeTypes.ts`)
- [x] 定义 CopilotIntent 协议类型 (`copilotRuntimeTypes.ts`)
- [x] 实现 buildCopilotSystemPrompt() (`copilotIntentParser.ts`)
- [x] 实现 parseCopilotModelOutput() (`copilotIntentParser.ts`)
- [x] 实现 CopilotRuntime 类 (`CopilotRuntime.ts`)
- [x] 实现 useCopilotRuntime Hook (`useCopilotRuntime.ts`)
- [x] 修改 CopilotPanel 使用 Runtime
- [x] 编写单元测试（类型守约、Intent 解析、Runtime）
- [ ] 支持 document 级批处理
- [ ] 支持连续 refinement

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

## 6. 文件清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/copilot/copilotRuntimeTypes.ts` | 类型定义：SessionState, Intent, ModelOutput |
| `src/copilot/copilotIntentParser.ts` | Prompt 构建 + Intent 解析 |
| `src/copilot/CopilotRuntime.ts` | Runtime 核心类 |
| `src/copilot/useCopilotRuntime.ts` | React Hook |
| `src/copilot/__tests__/copilotRuntimeTypes.test.ts` | 类型测试 |
| `src/copilot/__tests__/copilotIntentParser.test.ts` | 解析器测试 |
| `src/copilot/__tests__/CopilotRuntime.test.ts` | Runtime 测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/copilot/CopilotPanel.tsx` | 集成 CopilotRuntime，三级解析架构 |
| `src/copilot/index.ts` | 导出新模块 |

