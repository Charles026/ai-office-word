# Copilot Runtime Review - 2025-11

> 日期：2025-11-30  
> 作者：AI Office Team

---

## 概述

本次迭代为 Copilot 右侧面板补充了一层 **CopilotRuntime + Intent 协议**，使 Copilot 能够：

1. **看到整篇文档**：使用 `DocContextEnvelope(scope='document')` 构建上下文
2. **有记忆的对话**：通过 `CopilotSessionState` 维护会话状态
3. **发出编辑意图**：解析 `[INTENT]...[/INTENT]` 结构，通过现有 Section AI / DocOps 路径改文档

---

## 架构变化

### Before（v2）

```
CopilotPanel
├─ 规则层 → runCopilotCommand()
├─ LLM Router → runCopilotCommand()
└─ Fallback → callCopilotModel() → 纯自然语言
```

**问题**：Fallback 聊天路径无法改文档。

### After（v3）

```
CopilotPanel
├─ 规则层 → runCopilotCommand()           [快速路径，保留]
├─ CopilotRuntime.runTurn()               [🆕 新增]
│   ├─ buildDocContextEnvelope()
│   ├─ buildCopilotSystemPrompt()
│   ├─ LLM call
│   ├─ parseCopilotModelOutput()
│   │   ├─ [INTENT]...[/INTENT] → CopilotIntent
│   │   └─ [REPLY]...[/REPLY] → replyText
│   ├─ mode='edit' → executeEditIntent() → Section AI → DocOps
│   └─ mode='chat' → 返回 replyText
└─ Fallback → 原有逻辑                     [降级保留]
```

---

## Intent 协议

### 输出格式

```
[INTENT]
{
  "mode": "edit" | "chat",
  "action": "rewrite_section" | "summarize_section" | "summarize_document" | "highlight_terms",
  "target": { "scope": "document" | "section", "sectionId": "xxx" },
  "params": { ... }
}
[/INTENT]

[REPLY]
给用户看的自然语言回复
[/REPLY]
```

### 支持的 Actions（Phase 1）

| Action | 说明 | 是否需要 sectionId |
|--------|------|-------------------|
| `rewrite_section` | 重写章节 | ✅ 是 |
| `summarize_section` | 总结章节 | ✅ 是 |
| `summarize_document` | 总结文档 | ❌ 否 |
| `highlight_terms` | 标记关键词 | ✅ 是（暂未实现） |

### 容错策略

- 缺少 `[INTENT]` 块 → 当作纯聊天
- JSON 解析失败 → 当作纯聊天
- Intent 验证失败（如缺少 sectionId）→ 当作纯聊天

---

## 边界检查

### DocOps 边界

✅ **CopilotRuntime 不直接操作 Lexical**

所有文档编辑通过 `executeEditIntent()` → `runSectionAiAction()` → 现有 DocOps 路径。

```typescript
// CopilotRuntime.ts
private async executeEditIntent(intent, editor) {
  // 映射 action → SectionAiAction
  // 调用现有的 runSectionAiAction()
  // 不直接操作 Lexical 节点
}
```

### 未发现新的边界问题

- CopilotRuntime 复用现有 Section AI 能力
- DocContextEnvelope 只读取文档结构，不修改
- BehaviorSummary 只读取交互日志

---

## 新增文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `copilotRuntimeTypes.ts` | ~180 | 类型定义 + Guard 函数 |
| `copilotIntentParser.ts` | ~280 | Prompt 构建 + Intent 解析 |
| `CopilotRuntime.ts` | ~350 | Runtime 核心逻辑 |
| `useCopilotRuntime.ts` | ~100 | React Hook |
| 测试文件 x3 | ~400 | 单元测试 |

---

## 测试覆盖

### 类型测试 (`copilotRuntimeTypes.test.ts`)

- Guard 函数：`isCopilotAction`, `isCopilotMode`, `isCopilotRuntimeScope`
- Intent 验证：`validateCopilotIntent`, `parseCopilotIntentSafe`
- 默认状态：`createDefaultSessionState`

### 解析器测试 (`copilotIntentParser.test.ts`)

- 正常解析：INTENT + REPLY 块
- JSON 容错：无效 JSON、Markdown 代码块包装
- 标签缺失：无 INTENT、无 REPLY
- System Prompt：document/section scope

### Runtime 测试 (`CopilotRuntime.test.ts`)

- State 管理：初始化、更新、scope 切换
- runTurn：edit 模式、chat 模式、降级处理
- 边界情况：无 docId、无 editor、LLM 失败

---

## 调试记录（2025-11-30）

### 问题：Copilot 只会聊天，不会改文档

**根因分析**：

1. `useCopilotRuntime` 的 `isEnabled` 在首次渲染时错误返回 `false`
2. System Prompt 没有告诉模型大纲中章节的 sectionId
3. Few-shot 示例使用假 sectionId，模型不知道用什么值
4. 调试信息不够，难以判断问题出在哪里

**修复措施**：

1. 添加 `isRuntimeReady` state 正确跟踪 runtime 创建状态
2. 在大纲中显示 `[sectionId] 章节标题` 格式
3. 改进 System Prompt 示例，强调使用真实 sectionId
4. 在 DEV 模式下显示详细的调试信息块

**验证方法**：

在 DevTools 控制台中查找以下日志：

```
[CopilotRuntime] ========== LLM RAW OUTPUT ==========
...
[CopilotIntentParser] ✅ Intent parsed successfully: { mode, action, scope, sectionId }
...
[CopilotPanel] ✅ Runtime executed edit: { action, target }
```

如果看到 `⚠️ 未解析到 Intent` 或 `❌ JSON parse failed`，说明模型没有按格式输出。

---

## 下一步计划

1. **Document 级批处理**：支持「帮我把每个章节都总结一下」
2. **连续 Refinement**：基于 `lastTask` 支持「再正式一点」
3. **更多 Actions**：`highlight_terms`、`expand_section`
4. **UI 触发优化**：从大纲右键菜单直接调用 CopilotRuntime

---

## 总结

右侧 Copilot **不再是纯聊天**，而是有明确 Runtime 层的「文档操作中枢」：

- 通过 Intent 协议识别用户编辑意图
- 通过 DocOps 路径安全地修改文档
- 保持良好的降级体验和可观测性

