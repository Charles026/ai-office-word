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

## 2025-11-30 更新：v1.2 - H1 支持 & 错误处理增强

### 新功能：H1/H2/H3 统一章节语义

**背景**：之前 Section AI 只支持 H2/H3，H1 会报错「不支持的标题层级」。

**变更**：
- H1 现在被视为「文档根章节」，可作为 `rewrite_section` 的目标
- H1 的 `ownParagraphs` = H2 之前的段落（文档导语）
- H1 的 `childSections` = 包含所有直接下级 H2

**修改的文件**：
- `src/runtime/context/extractSectionContext.ts` - 移除 H1 限制
- `src/ribbon/ai/AiSectionActions.tsx` - 支持 H1 触发
- `src/editor/contextMenus/HeadingContextMenu.tsx` - H1 也显示右键菜单

### 新功能：显式错误状态 & Telemetry

**背景**：之前失败场景处理偏"静默"，难以诊断问题。

**新增类型**：
```typescript
type IntentStatus = 'ok' | 'missing' | 'invalid' | 'unsupported_action';
type CopilotErrorCode = 'intent_missing' | 'invalid_intent_json' | 'section_not_found' | ...;
```

**CopilotTurnResult 新字段**：
- `intentStatus`: Intent 解析状态
- `errorCode`: 错误代码（用于 Telemetry）
- `errorMessage`: 用户可见的错误消息

**错误场景覆盖**：

| 场景 | intentStatus | errorCode |
|------|--------------|-----------|
| 无文档打开 | invalid | no_document |
| 编辑器未就绪 | invalid | editor_not_ready |
| LLM 调用失败 | invalid | llm_call_failed |
| 无 [INTENT] 块 | missing | intent_missing |
| sectionId 无效 | invalid | section_not_found |
| 段落无法定位 | invalid | unresolvable_target |
| 编辑执行失败 | ok | edit_execution_failed |

**UI 变化**：
- DEV 模式：显示 `IntentStatus: ✅/⚠️/❌` 和 `ErrorCode`
- 生产模式：对 `section_not_found` 等显示友好提示

---

## 2025-11-30 更新：v1.3 - 连续提问 & 写入闭环

### 新功能：连续提问 (lastEditContext)

**背景**：用户需要基于上次编辑进行 follow-up 操作。

**实现**：
- 新增 `LastEditContext` 接口，记录上次编辑的 sectionId / paragraphIndex / action
- `resolveEditTarget` 在识别到 follow-up 请求时使用 lastEditContext
- 支持的短语："再改短一点"、"再正式一点"、"继续"等

**测试**：新增 `CopilotRuntime.followup.test.ts`

### 增强：写入闭环

**背景**：确保 edit intent 真正修改文档，失败时明确告知用户。

**变更**：
- `CopilotPanel` 对编辑失败显示友好提示
- `intentStatus === 'ok'` + `executed === false` 时显示警告
- DEV 模式详细日志，生产模式用户友好提示

### 增强：Part B - 清理 heading warning

**变更**：
- 子 heading (如 H4/H5/H6) 不再触发 warning，静默加入 subtreeParagraphs
- 其他未知节点类型降级为 `console.debug`（不再 warn）

---

## 下一步计划

1. **Document 级批处理**：支持「帮我把每个章节都总结一下」
2. ~~**连续 Refinement**~~：✅ 已完成 (v1.3 lastEditContext)
3. **更多 Actions**：`highlight_terms`、`expand_section`
4. **UI 触发优化**：从大纲右键菜单直接调用 CopilotRuntime
5. ~~**H1 支持**~~：✅ 已完成 (v1.2)
6. ~~**错误处理增强**~~：✅ 已完成 (v1.2)
7. ~~**写入闭环**~~：✅ 已完成 (v1.3)

---

## 总结

右侧 Copilot **不再是纯聊天**，而是有明确 Runtime 层的「文档操作中枢」：

- 通过 Intent 协议识别用户编辑意图
- 通过 DocOps 路径安全地修改文档
- 保持良好的降级体验和可观测性
- **v1.2**：支持 H1/H2/H3 全语义章节 + 完善的错误状态和 Telemetry
- **v1.3**：支持连续提问 (lastEditContext) + 写入闭环验证

---

## v1.4 更新：DocStructureEngine (2025-11)

### 新增模块

引入了 **DocStructureEngine** 作为独立的结构理解层：

```
src/document/structure/
├── DocStructureEngine.ts      # 核心实现
├── index.ts                   # 模块导出
└── __tests__/
    └── DocStructureEngine.test.ts  # 26 个测试用例
```

### 核心能力

1. **章节树构建**：从 AST 构建 `SectionNode[]` 树结构
2. **段落角色分配**：为每个 block 分配 `ParagraphRole`（doc_title / section_title / body / meta 等）
3. **查询辅助**：`findSectionById`、`findSectionContainingBlock`、`getOutlineFromSnapshot`

### 与 Copilot 的集成

- `extractSectionContext` 新增 `getDocStructureSnapshot` 和 `extractSectionContextFromStructure`
- 为未来的结构智能化预留接口
- 保留原有逻辑作为 fallback

### 相关文档

详见 [docs/doc-structure-design.md](../doc-structure-design.md)
