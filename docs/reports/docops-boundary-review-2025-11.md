# DocOps Boundary Review - 2025-11

> 本报告记录 DocOps 边界收紧的工作进展、残留问题和测试覆盖状态。

---

## 1. 边界收紧概述

### 1.1 目标

将核心编辑命令的执行路径从「直接操作 Lexical」迁移到「CommandBus → DocOps → DocumentEngine」，确保：

1. **AST 是真相**：所有修改都反映在 DocumentAst 上
2. **历史一致性**：Undo/Redo 通过 DocumentEngine 历史栈管理
3. **可测试性**：命令逻辑可脱离 Lexical 单独测试
4. **边界明确**：feature flag 开启时，不允许偷偷绕过 DocOps

### 1.2 当前状态

| 命令类型 | Feature Flag | 状态 | 备注 |
|----------|--------------|------|------|
| **Inline Format** | `useCommandBusForFormat` | ✅ 已完成 | toggleBold/Italic/Underline/Strike |
| **History** | `useCommandBusForHistory` | ✅ 已完成 | undo/redo |
| **Block Type** | `useCommandBusForBlockType` | 🔄 已实现 | 待验证 |
| **Edit** | `useCommandBusForEdit` | 🔄 已实现 | 待验证 |

---

## 2. 边界监控机制

### 2.1 Legacy 分支报警器

在 `LexicalAdapter.ts` 中增加了边界违规检测：

```typescript
// 🚨 边界监控：检测 feature flag 开启时意外进入 legacy 分支
const boundaryViolation = detectBoundaryViolation(commandId, flags);
if (boundaryViolation) {
  console.error(
    `[docops-boundary-legacy-hit] 🚨 BOUNDARY VIOLATION: ` +
    `Command "${commandId}" entered legacy path while ${boundaryViolation.flagName}=true.`
  );
  return; // 阻止执行，避免绕过 DocOps
}
```

**检测覆盖范围**：
- `useCommandBusForFormat`: toggleBold/Italic/Underline/Strikethrough
- `useCommandBusForHistory`: undo/redo
- `useCommandBusForBlockType`: setBlockTypeParagraph/Heading1/2/3
- `useCommandBusForEdit`: insertText/deleteRange/splitBlock/insertLineBreak

### 2.2 MinimalEditor 只读监听说明

在 `MinimalEditor.tsx` 的 CAN_UNDO/CAN_REDO 监听处添加了详细注释，说明：

- 这里监听的是 Lexical 内部历史状态，仅用于 UI 展示
- UI 层撤销/重做必须通过 CommandBus/DocumentRuntime 实现
- 禁止直接 dispatch UNDO_COMMAND/REDO_COMMAND

---

## 3. 测试覆盖观察

### 3.1 DocOpsBoundary.test.ts 测试用例

| 类别 | 测试数量 | 覆盖场景 |
|------|----------|----------|
| Format Commands | 6 | toggleBold/Italic/Underline/Strike + 无选区 |
| History Commands | 4 | undo/redo + 无历史 |
| Format + History 集成 | 3 | 撤销/重做格式变更 |
| Feature Flag OFF | 1 | CommandBus 直接调用 |
| **边缘情况** | 5 | 空文档、跨段落选区、handler 抛错 |
| **防回退** | 3 | 多格式操作 + undo/redo 全链路 |
| **合计** | **22** | |

### 3.2 新增边缘测试覆盖

| 场景 | 测试内容 | 状态 |
|------|----------|------|
| 空文档 | toggleBold 在空文档/空段落上 | ✅ 通过 |
| 空历史 | undo 在无历史时 | ✅ 通过 |
| 跨段落选区 | toggleBold 跨段落选区 | ✅ 失败但不崩溃 |
| Handler 抛错 | CommandBus handler 抛出异常 | ✅ 捕获错误 |
| 多格式操作 | 连续 Bold/Italic/Underline/Strike | ✅ 全部通过 |
| Format + Undo | 格式化后撤销/重做 | ✅ 全部通过 |

---

## 4. 残留越界触点

### 4.1 高优先级（影响核心编辑）

| 文件 | 问题 | 状态 |
|------|------|------|
| `LexicalAdapter.ts` | clearFormat 未实现 DocOps 路径 | ⚠️ 待迁移 |
| `LexicalAdapter.ts` | 列表命令仍走 Lexical | ⚠️ 待迁移 |
| `sectionAiActions.ts` | applyDocOps 直接操作 Lexical 节点 | ⚠️ TODO(docops-boundary) |

### 4.2 中优先级

| 文件 | 问题 | 状态 |
|------|------|------|
| `DocumentCanvas.tsx` | UI 事件处理器直接构造 DocOps | ⚠️ 待重构 |
| `copilotRuntimeBridge.ts` | 部分 AI 操作绕过 CommandBus | ⚠️ 待重构 |
| `copilotUndo.ts` | Copilot undo 可能绕过 DocumentRuntime | ⚠️ 待验证 |

### 4.3 低优先级（可延后）

| 模块 | 问题 | 状态 |
|------|------|------|
| 列表操作 | toggleBulletList/NumberedList 未实现 DocOps | 📋 v2 计划 |
| 缩进操作 | indentIncrease/Decrease 直接操作 Lexical | 📋 v2 计划 |
| IME 输入 | 未充分测试 | 📋 v2 计划 |
| 粘贴操作 | 仍走 Lexical 原生 | 📋 v2 计划 |

---

## 5. 下一步计划

### 5.1 短期（本周）

- [ ] 验证 `useCommandBusForBlockType` 功能正确性
- [ ] 验证 `useCommandBusForEdit` 功能正确性
- [ ] 完善手动测试 Checklist

### 5.2 中期（2周内）

- [ ] 迁移 clearFormat 到 DocOps 路径
- [ ] 审查 Section AI 的边界问题
- [ ] 审查 Copilot undo 的边界问题

### 5.3 长期（下个版本）

- [ ] 列表命令 DocOps 支持
- [ ] 复杂粘贴场景 DocOps 支持
- [ ] IME 输入测试覆盖

---

## 6. 测试命令

```bash
# 运行边界测试
npm test -- --run src/core/commands/__tests__/DocOpsBoundary.test.ts

# 运行所有命令层测试
npm test -- --run src/core/commands/__tests__/

# 启用 feature flags 手动测试
# 在 DevTools Console 中执行：
__commandFeatureFlags.set({
  useCommandBusForFormat: true,
  useCommandBusForHistory: true,
});
```

---

## 7. Copilot 文档上下文增强 (2025-11-29)

### 新增功能

**Copilot 现在可以"看到"整篇文档**：
- 实现了 `DocContextEnvelope(scope='document')`
- 提供文档的结构化快照（大纲 + 各章节预览）
- LLM 不再回答"我看不到文档内容"

### 技术实现

| 模块 | 变更 |
|------|------|
| `docContextTypes.ts` | 新增 `SectionPreview` 类型，扩展 `GlobalContext` |
| `docContextEngine.ts` | 实现 `buildDocumentScopeEnvelope()` 函数 |
| `copilotModelCaller.ts` | 支持 `scope='document'` 的 envelope 构建 |
| `CopilotPanel.tsx` | 自动升级 scope：无 sectionId 时使用 document scope |

### 自动 Scope 选择

```
用户打开文档 → docId 有值
├── 光标在 H2/H3 标题上 → scope='section' → 使用该章节内容
└── 光标在普通段落上 → scope='document' → 使用整篇文档快照
```

---

## 8. 变更记录

| 日期 | 变更 |
|------|------|
| 2025-11-29 | 初始报告：边界收紧完成 inline format + history |
| 2025-11-29 | 新增 legacy 分支监控机制 |
| 2025-11-29 | 补充边缘测试：空文档、跨段落、handler 抛错 |
| 2025-11-29 | 新增 MinimalEditor 只读监听说明 |
| 2025-11-29 | **Copilot 支持 document scope**：能看到整篇文档的结构化快照 |

---

*报告生成时间：2025-11-29*

