# DocOps 架构与边界定义 (v1)

> 本文档描述命令层（Command Layer）与文档操作层（DocOps）的映射关系，以及架构边界。

## 1. 核心架构分层

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
