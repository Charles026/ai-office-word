# Block ID → Lexical Key 迁移报告

**日期**: 2025-12-01  
**作者**: AI Engineering  
**状态**: 已完成核心改造，待端到端验证

---

## 一、问题现状

### 1.1 现象

Highlight 流程中：
- `InlineMark` 成功应用到 AST（日志有 `Applied InlineMark: ... (key_term)`）
- `ToggleBold` 虽然生成并提交到 `DocumentRuntime.applyDocOps()`，但**没有生效**
- 控制台没有 DocumentEngine 的 ToggleBold 日志
- UI 上关键词没有加粗

### 1.2 根因

**AST block.id 与 DocOps nodeId 不同源，导致 ToggleBold 找不到目标 block**

| 组件 | ID 格式 | 示例 |
|------|---------|------|
| htmlToAst() | `generateNodeId()` | `"node_1764576887775_twb8pa"` |
| lexicalNodeToBlock() | `` `lexical-${key}` `` | `"lexical-1580"` |
| SectionDocOps / HighlightSpans | 纯 Lexical key | `"1580"` |

三种格式互不兼容！

### 1.3 验证

`__docDebug__.quickTestReplace('新内容')` 证明：只要 `DocOps.nodeId == AST.block.id`，`DocumentRuntime.applyDocOps()` 就能正常工作。

---

## 二、改动点

### 2.1 LexicalBridge.ts - 使用纯 Lexical key 作为 block.id

```diff
// 之前
- id: `lexical-${key}`,

// 之后
+ id: node.getKey(),  // 纯 Lexical key
```

**改动文件**: `src/core/commands/LexicalBridge.ts`

**改动位置**: `lexicalNodeToBlock()` 函数（第 139-170 行）

**注释**: 添加了说明文档，强调 Block.id 必须使用纯 Lexical nodeKey

### 2.2 LexicalReconciler.ts - 添加 updateAstIdsFromLexical 函数

新增两个函数：

1. **`updateAstIdsFromLexical(editor, ast)`**
   - 将 AST block IDs 更新为对应的 Lexical nodeKeys
   - 用于 HTML 导入后同步 ID

2. **`reconcileAndAlignIds(editor, ast, options)`**
   - 一站式方法：reconcile + ID 对齐
   - 推荐在文档加载流程中使用

**改动文件**: `src/core/commands/LexicalReconciler.ts`

**改动位置**: 文件末尾新增（第 356-420 行）

### 2.3 MinimalEditor.tsx - HTML 加载后同步到 DocumentRuntime

```typescript
// HtmlLoaderPlugin 中新增
setTimeout(() => {
  syncLexicalToRuntime(editor);
  console.log('[HtmlLoaderPlugin] ✅ Synced Lexical state to DocumentRuntime');
}, 0);
```

**改动文件**: `src/editor/MinimalEditor.tsx`

**改动位置**: `HtmlLoaderPlugin` 组件

**作用**: HTML 加载到 Lexical 后，自动同步到 DocumentRuntime，确保 AST block IDs 与 Lexical keys 一致

### 2.4 DocumentEngine.ts - 增加 ToggleBold 调试日志

```typescript
// handleToggleBold() 中新增
console.log(`[DocumentEngine] Applying ToggleBold: nodeId="${nodeId}", ...`);

// 当 block 找不到时
console.warn(`[DocumentEngine] ⚠️ ToggleBold target block NOT FOUND: nodeId="${nodeId}"`);
console.warn(`[DocumentEngine] Available block IDs:`, ast.blocks.map(b => b.id));
```

**改动文件**: `src/document/DocumentEngine.ts`

**改动位置**: `handleToggleBold()` 和 `applyInlineMark()` 函数

### 2.5 index.ts - 导出新函数

```typescript
export { 
  reconcileAstToLexical, 
  updateAstIdsFromLexical,
  reconcileAndAlignIds,
} from './LexicalReconciler';
```

**改动文件**: `src/core/commands/index.ts`

---

## 三、验收标准

### 3.1 DevTools 验证

```javascript
// 控制台执行
__docDebug__.getAstBlockIds()

// 预期输出: ["1580", "1583", "1589", ...] （纯数字/短字符串）
// 不应该是: ["node_xxx...", "lexical-xxx"]
```

### 3.2 ToggleBold 日志验证

执行 Highlight 命令后，控制台应该显示：

```
[DocumentEngine] Applying ToggleBold: nodeId="1580", startOffset=0, endOffset=10, force=true
```

不应该出现：
```
[DocumentEngine] ⚠️ ToggleBold target block NOT FOUND
```

### 3.3 UI 验证

Highlight 标记的关键词应该同时：
- 有 InlineMark 语义标记
- 有视觉加粗效果

---

## 四、测试结果

### 4.1 单元测试

| 测试文件 | 结果 |
|----------|------|
| `sectionDocOpsToDocOps.rewrite.test.ts` | ✅ 5 passed |
| `sectionDocOpsPath.test.ts` | ✅ 13 passed |
| `DocOpsBoundary.test.ts` | ✅ 22 passed |
| `featureFlags.test.ts` | ✅ 11 passed |
| `DocOpsEngine.test.ts` | ✅ 8 passed |
| `SectionDocOps.test.ts` | ✅ 3 passed |

### 4.2 已知无关失败

以下测试失败与本次改动无关：
- `EditorStateProvider.test.ts` - history source 相关
- `DocStructureEngine.v2.test.ts` - section structure 相关

---

## 五、后续事项

### 5.1 文档加载流程集成 ✅ 已完成

`HtmlLoaderPlugin` 现在会在 HTML 加载后自动调用 `syncLexicalToRuntime(editor)`：

```typescript
// MinimalEditor.tsx - HtmlLoaderPlugin
setTimeout(() => {
  syncLexicalToRuntime(editor);  // 自动同步 Lexical 状态到 DocumentRuntime
}, 0);
```

这确保了文档加载后 AST block IDs 与 Lexical keys 一致。

### 5.2 监控

添加 telemetry 追踪 ToggleBold 命中率，确保没有新的 ID 不匹配问题。

控制台日志格式：
```
[HtmlLoaderPlugin] ✅ Synced Lexical state to DocumentRuntime
[DocumentEngine] Applying ToggleBold: nodeId="1580", startOffset=51, endOffset=72, force=true
```

---

## 六、相关文件

- `src/core/commands/LexicalBridge.ts` - 使用纯 Lexical key
- `src/core/commands/LexicalReconciler.ts` - 新增 updateAstIdsFromLexical
- `src/core/commands/index.ts` - 导出新函数
- `src/document/DocumentEngine.ts` - ToggleBold 调试日志
- `src/editor/MinimalEditor.tsx` - HTML 加载后自动同步
- `docs/reports/docops-write-path-audit-2025-12.md`

