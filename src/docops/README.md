# DocOps 架构与边界定义 (v1)

> 本文档描述命令层（Command Layer）与文档操作层（DocOps）的映射关系，以及架构边界。

## 1. 核心架构分层

### 1.1 目标架构（v1 重构目标）

```
UI / Lexical 事件
  → CommandBus.executeWithRuntime(commandId, payload)
  → 命令 Handler 组装 DocOps[]
  → DocumentRuntime.applyDocOps(docOps)
  → DocumentEngine 更新 AST + 历史栈
  → DocumentRuntime 通知订阅者
  → Reconciler 同步 AST 到 Lexical
```

### 1.2 当前分层

- **DocumentRuntime (`src/document/DocumentRuntime.ts`)** 🆕:
  - 职责：统一文档状态管理（AST + Selection + Version）。
  - 提供 `getSnapshot()` / `applyDocOps()` / `undo()` / `redo()` 接口。
  - 是 UI 层的唯一状态来源（Source of Truth）。

- **Command Layer (`src/core/commands`)**:
  - 职责：理解用户意图，处理参数，计算定位。
  - 产出：`DocOp[]`。
  - 约束：不直接修改 AST，不直接操作 DOM/UI。

- **DocOps Layer (`src/docops`)**:
  - 职责：定义原子操作（JSON Serializable），提供转换适配器。
  - 核心类型：`InsertText`, `DeleteRange`, `ReplaceBlockText` 等。

- **DocumentEngine (`src/document/DocumentEngine.ts`)**:
  - 职责：将 `DocOp` 应用到 `DocumentAst`，管理 Undo/Redo 栈。
  - 约束：纯逻辑，无 UI 依赖。

## 2. Command -> DocOps 映射表

| Command ID | DocOp Type | 说明 |
| :--- | :--- | :--- |
| `insertText` | `InsertText` | 在光标处插入文本 |
| `deleteRange` | `DeleteRange` | 删除选区内容 |
| `splitBlock` | `SplitBlock` | 回车换行，拆分 Block |
| `insertLineBreak` | `InsertLineBreak` | 软换行 (Shift+Enter) |
| `toggleBold` | `ToggleBold` | 切换加粗 |
| `toggleItalic` | `ToggleItalic` | 切换斜体 |
| `setBlockType...` | `SetHeadingLevel` | 设置标题级别 |
| `aiRewrite` | `ReplaceRange` | AI 改写（替换选区） |

## 3. AI 改写回写机制

AI 改写流程（Section AI）现在采用以下路径：
1. LLM 生成 `SectionDocOp[]`（高层语义操作，如 `replace_paragraph`）。
2. **Adapter** (`src/docops/adapter.ts`) 将其转换为基础 `DocOp[]`（如 `ReplaceBlockText`）。
3. **DocumentEngine** 应用这些 `DocOp` 更新 AST。

*注意：当前处于 v1 过渡期，UI 层（Lexical）的更新仍通过 `applyDocOps` 中的遗留代码直接执行，AST 更新为影子模式，后续将统一由 AST 驱动 UI。*

## 4. 边界违规现状 (Refactor Targets)

以下模块包含“越界”逻辑，需在后续版本中重构：

- **LexicalAdapter.ts**: 直接调用 `editor.update` 操作 Lexical State，绕过 DocumentEngine。
- **sectionAiActions.ts**: `applyDocOps` 直接操作 Lexical 节点（已标记 TODO）。
- **DocumentCanvas.tsx**: UI 事件处理器直接构造 DocOps，绕过 CommandBus。

## 5. 开发指南

- **新增命令**：
  1. 在 `src/docops/types.ts` 定义所需的原子 `DocOp`。
  2. 在 `src/document/DocumentEngine.ts` 实现该 Op 的 handler。
  3. 在 `src/core/commands/CommandBus.ts` 注册命令，组装 Op。
- **AI 新能力**：
  1. 尽量复用现有 `SectionDocOp`。
  2. 如果需要新操作，在 `src/docops/adapter.ts` 中增加转换逻辑。

## 6. v1 重构进度 (2025-11)

### 6.1 已完成

- [x] Step 0: 梳理现状，在 LexicalAdapter.ts 添加架构说明
- [x] Step 1: 设计 DocumentRuntime 接口骨架
  - 新增 `src/document/DocumentRuntime.ts`
  - 提供 `getSnapshot()` / `applyDocOps()` / `undo()` / `redo()` / `subscribe()`
  - CommandBus 新增 `executeWithRuntime()` 方法
- [x] Step 2: 迁移基础命令到 CommandBus → DocOps
  - 新增 `src/core/commands/featureFlags.ts` - Feature Flag 系统
  - 新增 `src/core/commands/LexicalReconciler.ts` - AST 到 Lexical 同步器
  - 新增 `src/core/commands/LexicalBridge.ts` - Lexical 与 DocumentRuntime 桥接
  - LexicalAdapter 已支持 feature flag 分支，可通过 flag 切换新旧路径
  - 支持的命令：`toggleBold`, `toggleItalic`, `toggleUnderline`, `toggleStrikethrough`,
    `setBlockTypeParagraph`, `setBlockTypeHeading1/2/3`, `undo`, `redo`, `insertText`
- [x] Step 3: 让 DocumentEngine 驱动 UI 状态
  - 新增 `src/core/commands/EditorStateProvider.ts` - 统一编辑器状态提供者
  - 支持从 DocumentRuntime 或 Lexical 获取状态
  - 提供 `useUnifiedEditorState` Hook 供 React 组件使用
  - MinimalEditor 的 StateReporterPlugin 已集成状态同步

### 6.2 如何启用新路径

在开发模式下，可以通过控制台启用新路径：

```javascript
// 启用文本格式命令的新路径
__commandFeatureFlags.set({ useCommandBusForFormat: true });

// 启用块级格式命令的新路径
__commandFeatureFlags.set({ useCommandBusForBlockType: true });

// 启用 undo/redo 的新路径
__commandFeatureFlags.set({ useCommandBusForHistory: true });

// 启用文本编辑的新路径（影响核心编辑体验，谨慎开启）
__commandFeatureFlags.set({ useCommandBusForEdit: true });

// 查看当前状态
__commandFeatureFlags.get();

// 重置为默认（全部关闭）
__commandFeatureFlags.reset();
```

- [x] Step 4: undo/redo 全量切到 DocumentEngine
  - 修复了 `executeWithRuntime` 未更新 runtime AST 的问题
  - 新增 `DocumentRuntime._setAstWithoutHistory()` 方法
  - undo/redo 命令不会重置历史栈（跳过 `syncLexicalToRuntime`）
  - 当 DocumentEngine 没有历史时，自动 fallback 到 Lexical
  - 新增 7 个 undo/redo 测试用例

### 6.4 Bug 修复

- [x] 2025-11: 修复 toggleBold 通过 DocOps 时误将整段加粗/相互影响的问题
  - **问题**：选中一个单词加粗 → 整句都被加粗；在另一行加粗 → 前一行的加粗被撤销
  - **原因**：`handleToggleBold` 忽略了 `startOffset`/`endOffset`，对整个 block 的所有子节点应用 bold
  - **修复**：重写 `applyInlineMark` 方法，实现按选区范围精确切换 mark
    - 将文本按选区边界拆分成多个 TextRunNode
    - 只对选区内的部分切换 mark
    - 选区外的部分保持不变
    - 合并相邻的相同格式文本节点
  - 新增 9 个 mark toggle 测试用例

- [x] 2025-11: 修复 AST → Lexical 同步时丢失 inline marks 的问题
  - **问题**：toggleBold 后整段格式被"清洗"，所有 bold/italic/underline 和 heading 都消失
  - **原因**：`LexicalReconciler.createLexicalNodeFromBlock` 使用 `getInlineText()` 将所有文本合并成单个字符串，丢失了多个 TextRunNode 的 marks 信息
  - **修复**：
    - 新增 `appendInlineNodesToLexical` 函数，为每个 TextRunNode 创建独立的 Lexical TextNode
    - 每个 TextNode 保留自己的 marks（bold/italic/underline/strikethrough/code）
    - 修复选区同步逻辑，正确找到多个 TextNode 中的目标节点
  - 新增 2 个测试用例验证格式保留

- [x] 2025-11: 修复 Lexical → AST 同步时丢失 inline marks 的问题（根因修复）
  - **问题**：即使 LexicalReconciler 正确处理了 AST → Lexical，toggleBold 仍然清空格式
  - **根因**：`LexicalBridge.lexicalNodeToBlock` 在从 Lexical 同步到 Runtime 时，只取 `textContent`（纯文本），**完全丢失了 inline marks**
  - **影响链路**：
    1. `executeCommandViaCommandBus` 调用 `syncLexicalToRuntime`
    2. `syncLexicalToRuntime` 调用 `lexicalStateToAst`
    3. `lexicalStateToAst` 调用 `lexicalNodeToBlock`（❌ 丢失 marks）
    4. 用丢失 marks 的 AST 重置 Runtime
    5. toggleBold 在"干净"的 AST 上操作
    6. 同步回 Lexical 时格式已丢失
  - **修复**：
    - 重写 `lexicalNodeToBlock`，新增 `extractInlineNodesFromLexical` 函数
    - 遍历 Lexical 元素节点的所有子节点，为每个 TextNode 提取 marks
    - 使用 `extractMarksFromLexicalTextNode` 从 Lexical TextNode.getFormat() 位掩码中提取 bold/italic/underline/strikethrough/code

- [x] 2025-11: 修复「新建空文档 + useCommandBusForFormat=true」时的崩溃
  - **问题**：新建空文档后触发格式命令，控制台报错 `getTopLevelElementOrThrow: root nodes are not top level elements`
  - **根因**：Lexical ⇄ AST 桥接层在空文档/初始文档场景下的假设被踩爆
    1. `lexicalStateToAst` 可能返回空的 blocks 数组
    2. `lexicalNodeToBlock` 没有检查传入节点是否是 ElementNode
    3. 选区同步时没有处理空 AST 的情况
  - **修复**：
    - `lexicalStateToAst`: 只处理 root 的直接子节点（top-level ElementNode），跳过 TextNode
    - `lexicalStateToAst`: 空文档时返回包含一个空段落的 AST
    - `lexicalNodeToBlock`: 添加 `$isElementNode` 类型保护
    - `reconcileAstToLexical`: 空 AST 时创建一个空段落节点
    - `reconcileSelectionToLexical`: 空 AST/Lexical 树时安全返回或回退到第一个 block

### 6.3 已完成

- [x] Step 5: 最小测试 + 自测 checklist
  - 新增 `EmptyDocument.test.ts` - 10 个测试用例覆盖空文档场景
  - 新增 `docs/docops-runtime-notes.md` - 完整自测清单和架构文档
  - 所有 432 个测试通过

- [x] Step 6: 总结和提供未来建议
  - 新增 `docs/docops-developer-guide.md` - 完整开发者指南
  - 说明 Command 层、DocOps 层、DocumentEngine 的职责
  - 添加边界违规清单和 TODO 标记
  - 提供开发指南和 FAQ

### 6.5 边界违规清单（需后续重构）

以下模块仍存在"越界"逻辑，已标记 `TODO(docops-boundary)`：

| 优先级 | 文件 | 问题 |
|--------|------|------|
| 🔴 高 | `LexicalAdapter.ts` | 部分命令仍直接操作 Lexical |
| 🔴 高 | `sectionAiActions.ts` | `applyDocOps` 直接操作 Lexical 节点 |
| 🟡 中 | `DocumentCanvas.tsx` | UI 事件处理器直接构造 DocOps |
| 🟡 中 | `copilotRuntimeBridge.ts` | 部分 AI 操作绕过 CommandBus |
| 🟢 低 | 列表操作 | 未支持 DocOps 路径 |
| 🟢 低 | IME 输入 | 未充分测试 |
| 🟢 低 | 粘贴操作 | 仍走 Lexical 原生 |

### 6.6 待完成（v2）

- [ ] 优化 Reconciler 性能（增量更新）
- [ ] 支持列表、缩进、对齐等块级操作
- [ ] 处理中文输入法的组合输入（IME）
- [ ] 移除对 Lexical HistoryPlugin 的依赖（可选，当新路径稳定后）
- [ ] 重构边界违规清单中的高优先级项目
