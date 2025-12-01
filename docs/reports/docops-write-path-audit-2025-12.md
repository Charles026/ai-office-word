# DocOps 写路径审计报告 (2025-12)

> **状态**: ✅ 重构完成  
> **日期**: 2025-12-01  
> **变更**: 所有 AI 改写/扩写/高亮操作统一走 DocOps → DocumentRuntime 写路径

## 一、架构现状要点总结

### 1. DocumentEngine / DocumentRuntime (✅ 正确架构)
- `DocumentEngine` 是 AST 的唯一 mutator，维护历史记录
- `DocumentRuntime` 封装 Engine，提供订阅机制
- 所有修改应通过 `applyDocOps()` 执行

### 2. DocOps 类型定义
| 文件 | 职责 |
|------|------|
| `docops/types.ts` | 底层原子操作 (InsertText, DeleteRange, ToggleBold, etc.) |
| `docops/sectionDocOpsDiff.ts` | Section 级高层操作 (ReplaceParagraph, InsertParagraphAfter, DeleteParagraph) |
| `docops/adapter.ts` | SectionDocOp → DocOp 转换器 |

### 3. 写路径分类

#### ✅ 正确路径 (通过 DocumentRuntime)
- `highlightSpans.ts` → `documentRuntime.applyDocOps()`
- `CommandBus` → `documentEngine.applyOps()` → `LexicalReconciler`

#### ❌ 绕过路径 (直接操作 Lexical)
| 文件 | 函数/位置 | 问题描述 |
|------|----------|----------|
| `sectionAiActions.ts` | `applyDocOps()` L515-595 | 使用 `editor.update()` 直接操作 Lexical 节点 |
| `docAgentRuntime.ts` | `applyBoldToTargets()` L501-525 | 直接 `editor.update()` |
| `LexicalAdapter.ts` | `replaceSelection()` L835-854 | 直接 `selection.insertText()` |
| `LexicalAdapter.ts` | `insertAfterSelection()` L868-900 | 直接创建 ParagraphNode |
| `LexicalAdapter.ts` | `replaceSectionContent()` L951-1039 | 直接操作节点 |
| `LexicalAdapter.ts` | `insertAfterSection()` L1049-1099 | 直接操作节点 |
| `LexicalAdapter.ts` | LEGACY PATH (toggleBold etc.) | dispatch FORMAT_TEXT_COMMAND |
| `LexicalAdapter.ts` | LEGACY PATH (undo/redo) | dispatch UNDO_COMMAND/REDO_COMMAND |

---

## 二、修改路径清单

### A. 通过 DocumentRuntime.applyDocOps 间接修改的路径

```
1. highlightSpans.ts
   executeHighlightKeyTerms() → documentRuntime.applyDocOps([ApplyInlineMark, ToggleBold])
   
2. CommandBus 路径 (当 feature flag 开启时)
   LexicalAdapter → CommandBus.executeWithRuntime() → documentEngine.applyOps()
```

### B. 直接操作 Lexical 节点 / dispatch Lexical command 的路径

```
1. sectionAiActions.ts:applyDocOps() 
   - editor.update() 内调用 $getNodeByKey().clear(), $createTextNode() 等
   - 影响：所有 SectionAI 的 rewrite/summarize/expand 操作
   
2. docAgentRuntime.ts:applyBoldToTargets()
   - editor.update() 内操作段落节点
   - 影响：mark_key_sentences 步骤
   
3. LexicalAdapter.ts:replaceSelection()
   - selection.insertText(newText)
   - 影响：AI 改写（选区替换）
   
4. LexicalAdapter.ts:insertAfterSelection()
   - $createParagraphNode(), topLevelElement.insertAfter()
   - 影响：AI 总结（插入摘要）
   
5. LexicalAdapter.ts:replaceSectionContent()
   - node.clear(), node.append(), node.remove()
   - 影响：章节级 AI 改写
   
6. LexicalAdapter.ts:insertAfterSection()
   - $createParagraphNode(), lastNodeInSection.insertAfter()
   - 影响：章节级 AI 总结
   
7. LexicalAdapter.ts LEGACY PATH (toggleBold/Italic/Underline/Strikethrough)
   - editor.dispatchCommand(FORMAT_TEXT_COMMAND, ...)
   - 影响：工具栏格式按钮（当 useCommandBusForFormat=false）
   
8. LexicalAdapter.ts LEGACY PATH (undo/redo)
   - editor.dispatchCommand(UNDO_COMMAND/REDO_COMMAND, undefined)
   - 影响：撤销/重做（当 useCommandBusForHistory=false）
```

---

## 三、重构目标

```
目标架构:
UI / SectionAI / Copilot
  → 生成 DocOps[]
  → DocumentRuntime.applyDocOps()
  → DocumentEngine 更新 AST + 历史
  → LexicalReconciler 同步到 Lexical 渲染

禁止:
- 直接调用 editor.update() 修改内容
- 直接 dispatch Lexical FORMAT_TEXT_COMMAND
- 绕过 DocumentEngine 的任何写操作
```

---

## 四、Feature Flags 状态

| Flag | 当前值 | 说明 |
|------|--------|------|
| `useCommandBusForFormat` | ✅ **true** | 加粗/斜体/下划线走 CommandBus → DocOps |
| `useCommandBusForBlockType` | false | 标题级别暂保持旧路径 |
| `useCommandBusForHistory` | ✅ **true** | Undo/Redo 走 DocumentEngine 历史 |
| `useCommandBusForEdit` | false | 文本输入保持旧路径（影响输入体验） |
| `useSectionDocOpsViaDocumentEngine` | false | SectionAI DocOps 新路径（测试验证中） |

### 新增 Feature Flag

```typescript
// sectionAiActions.ts
setSectionDocOpsViaDocumentEngine(true)  // 启用 SectionAI 的 DocumentEngine 路径
getSectionDocOpsViaDocumentEngine()      // 查询当前状态

// 开发者控制台调试
window.__sectionAiFlags.enableDocumentEngine()
window.__sectionAiFlags.disableDocumentEngine()
```

---

## 五、改造优先级

1. **P0: SectionAI 写路径** - `sectionAiActions.ts:applyDocOps()`
   - 这是 AI 操作的主要入口，必须首先改造
   
2. **P1: LexicalAdapter LEGACY PATH 开关默认值**
   - 将 `useCommandBusForFormat` 和 `useCommandBusForHistory` 改为 true
   
3. **P2: AI 命令 (replaceSelection, replaceSectionContent)**
   - 改为通过 DocOps 执行

4. **P3: docAgentRuntime 高亮路径**
   - `applyBoldToTargets()` 改为 DocOps

---

## 六、验收标准

1. 触发「改写一段」→ 有 `DocumentRuntime.applyDocOps` 调用日志
2. 「改写 → 撤销 → 重做」→ 通过 DocumentEngine 历史完成
3. 所有 `// TODO: still bypassing DocumentEngine` 注释可追踪

---

## 七、Block ID 对齐（已修复）

> 详见 [block-id-lexical-key-migration.md](./block-id-lexical-key-migration.md)

### 问题根因

AST block.id 与 DocOps nodeId 不同源：
- `htmlToAst()` 使用 `generateNodeId()` → `"node_xxx_abc"`
- `lexicalNodeToBlock()` 使用 `` `lexical-${key}` `` → `"lexical-1580"`
- SectionDocOps / HighlightSpans 使用纯 Lexical key → `"1580"`

三种格式互不兼容，导致 ToggleBold 找不到目标 block。

### 修复方案（已实现）

1. **LexicalBridge.ts**: `lexicalNodeToBlock()` 使用纯 Lexical key 作为 block.id
2. **LexicalReconciler.ts**: 新增 `updateAstIdsFromLexical()` 函数
3. **DocumentEngine.ts**: 增加 ToggleBold 调试日志

### 验收

```javascript
// AST block IDs 应该是纯 Lexical key
__docDebug__.getAstBlockIds()
// 预期: ["1580", "1583", "1589", ...]
// 不应该是: ["node_xxx...", "lexical-xxx"]
```

---

## 八、调试工具使用指南

### 在控制台中调试

```javascript
// 查看当前 AST 状态
__docDebug__.showAstState()

// 测试替换第一个段落
__docDebug__.quickTestReplace('新的段落内容')

// 手动测试 SectionDocOps
__docDebug__.testSectionDocOps([{
  type: 'replace_paragraph',
  targetPath: ['doc', 'block-id'],
  targetKey: 'block-id',
  newText: '新内容',
  preserveStyle: true,
  index: 0,
}])

// 获取 AST block IDs
__docDebug__.getAstBlockIds()
```

### Feature Flag 控制

```javascript
// 启用 DocumentEngine 路径
__sectionAiFlags.enableDocumentEngine()

// 禁用（使用 legacy Lexical 路径）
__sectionAiFlags.disableDocumentEngine()

// 查看当前状态
__sectionAiFlags.get()
```

