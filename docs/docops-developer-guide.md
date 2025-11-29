# DocOps 开发者指南

> 本指南面向 AI-LIBRE 项目的开发者，说明如何正确使用 DocOps 架构进行文档编辑功能开发。

---

## 1. 架构概览

### 1.1 核心原则

```
┌─────────────────────────────────────────────────────────────┐
│                    黄金法则                                  │
│                                                             │
│  1. AST 是真相（Source of Truth）                           │
│  2. 所有文档修改必须通过 DocOps                              │
│  3. UI 只是渲染器，不是状态持有者                            │
│  4. 命令层只负责意图解析，不负责状态变更                      │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 数据流

```
用户操作 (键盘/鼠标/Ribbon)
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  LexicalAdapter / UI 事件处理                                │
│  - 捕获用户意图                                              │
│  - 调用 CommandBus                                          │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  CommandBus.executeWithRuntime(commandId, payload)          │
│  - 从 DocumentRuntime 获取当前状态                           │
│  - 调用命令 Handler                                         │
│  - Handler 返回 DocOp[]                                     │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  DocumentEngine.applyOps(ast, docOps)                       │
│  - 将 DocOps 应用到 AST                                     │
│  - 记录历史（支持 undo/redo）                                │
│  - 返回新的 AST                                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  DocumentRuntime                                            │
│  - 更新内部 AST 引用                                         │
│  - 通知订阅者                                               │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  LexicalReconciler.reconcileAstToLexical(editor, ast)       │
│  - 将 AST 同步到 Lexical                                    │
│  - 更新选区                                                 │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
用户看到更新后的文档
```

---

## 2. 各层职责

### 2.1 Command Layer (`src/core/commands/`)

**职责**：
- 理解用户意图
- 解析当前选区和上下文
- 组装 `DocOp[]`

**约束**：
- ❌ 不直接修改 AST
- ❌ 不直接操作 Lexical/DOM
- ✅ 只返回 DocOps 列表

**核心文件**：
| 文件 | 说明 |
|------|------|
| `CommandBus.ts` | 命令总线，注册和执行命令 |
| `types.ts` | 命令类型定义 |
| `LexicalAdapter.ts` | Lexical 命令适配器（过渡层） |
| `LexicalBridge.ts` | Lexical ⇄ AST 桥接 |
| `LexicalReconciler.ts` | AST → Lexical 同步 |
| `featureFlags.ts` | Feature Flag 控制 |

**示例：添加新命令**

```typescript
// 1. 在 types.ts 中定义命令 ID 和 payload
export type CommandId = 
  | 'toggleBold'
  | 'toggleItalic'
  | 'myNewCommand'  // 新增
  ;

export interface CommandPayloadMap {
  // ...
  myNewCommand: { someParam: string };
}

// 2. 在 CommandBus.ts 中注册 handler
private registerDefaultHandlers() {
  // ...
  this.register('myNewCommand', (ctx, payload) => {
    const { ast, selection } = ctx;
    
    // 组装 DocOps
    const docOps: DocOp[] = [{
      type: 'my_new_op',
      nodeId: selection?.anchor.blockId,
      // ...
    }];
    
    // 调用 DocumentEngine
    const result = documentEngine.applyOps(ast, docOps);
    
    return {
      success: result.changed,
      nextAst: result.nextAst,
      nextSelection: selection,
    };
  });
}
```

### 2.2 DocOps Layer (`src/docops/`)

**职责**：
- 定义原子操作类型（JSON Serializable）
- 提供类型适配器（如 `SectionDocOp` → `DocOp`）

**约束**：
- ✅ 操作必须是可序列化的
- ✅ 操作必须是幂等的或可逆的

**核心文件**：
| 文件 | 说明 |
|------|------|
| `types.ts` | DocOp 类型定义 |
| `adapter.ts` | SectionDocOp → DocOp 转换 |

**示例：添加新 DocOp 类型**

```typescript
// 在 types.ts 中定义
export interface MyNewOp {
  type: 'my_new_op';
  nodeId: string;
  someData: string;
  meta?: OpMeta;
}

export type DocOp = 
  | InsertTextOp
  | DeleteRangeOp
  | MyNewOp  // 新增
  ;
```

### 2.3 DocumentEngine (`src/document/DocumentEngine.ts`)

**职责**：
- 将 DocOps 应用到 DocumentAst
- 管理 Undo/Redo 历史栈
- 保证 AST 的一致性

**约束**：
- ❌ 不依赖 UI
- ❌ 不依赖 Lexical
- ✅ 纯逻辑，可单元测试

**示例：添加新 Op Handler**

```typescript
// 在 DocumentEngine.ts 中
private applySingleOp(ast: DocumentAst, op: DocOp): DocumentAst {
  switch (op.type) {
    // ...
    case 'my_new_op':
      return this.handleMyNewOp(ast, op);
    default:
      console.warn(`Unknown op type: ${(op as any).type}`);
      return ast;
  }
}

private handleMyNewOp(ast: DocumentAst, op: MyNewOp): DocumentAst {
  // 实现具体逻辑
  const newBlocks = ast.blocks.map(block => {
    if (block.id === op.nodeId) {
      // 修改 block
      return { ...block, /* changes */ };
    }
    return block;
  });
  
  return {
    ...ast,
    blocks: newBlocks,
    version: ast.version + 1,
  };
}
```

### 2.4 DocumentRuntime (`src/document/DocumentRuntime.ts`)

**职责**：
- 统一文档状态管理（AST + Selection + Version）
- 提供 UI 层的唯一状态接口
- 支持订阅状态变化

**核心 API**：

```typescript
interface IDocumentRuntime {
  // 获取当前快照
  getSnapshot(): DocumentRuntimeSnapshot;
  
  // 应用 DocOps
  applyDocOps(docOps: DocOp[]): boolean;
  
  // 历史操作
  undo(): boolean;
  redo(): boolean;
  
  // 选区管理
  setSelection(selection: DocSelection | null): void;
  
  // 订阅变化
  subscribe(listener: (snapshot) => void): () => void;
}
```

---

## 3. 开发指南

### 3.1 添加新的编辑功能

1. **定义 DocOp 类型** (`src/docops/types.ts`)
2. **实现 Engine Handler** (`src/document/DocumentEngine.ts`)
3. **注册 Command** (`src/core/commands/CommandBus.ts`)
4. **添加测试** (`src/*/__tests__/`)
5. **连接 UI** (Ribbon/快捷键)

### 3.2 添加新的 AI 功能

1. **定义 SectionDocOp**（如果需要新操作）
2. **实现 Adapter 转换** (`src/docops/adapter.ts`)
3. **在 Section AI 中使用**
4. **添加测试**

### 3.3 调试技巧

```javascript
// 启用新路径
__commandFeatureFlags.set({
  useCommandBusForFormat: true,
  useCommandBusForBlockType: true,
  useCommandBusForHistory: true,
});

// 查看当前 AST
const runtime = require('./src/document/DocumentRuntime').documentRuntime;
console.log(JSON.stringify(runtime.getSnapshot().ast, null, 2));

// 查看历史栈
const engine = require('./src/document/DocumentEngine').documentEngine;
console.log('Can undo:', engine.canUndo());
console.log('Can redo:', engine.canRedo());
```

---

## 4. 边界违规清单

以下是当前仍存在"越界"逻辑的地方，需要在后续版本中重构：

### 4.1 高优先级 (影响核心编辑)

| 文件 | 问题 | 状态 |
|------|------|------|
| `LexicalAdapter.ts` | 部分命令仍直接操作 Lexical | 🔄 通过 Feature Flag 逐步迁移 |
| `sectionAiActions.ts` | `applyDocOps` 直接操作 Lexical 节点 | ⚠️ TODO(docops-boundary) |

### 4.2 中优先级 (影响特定功能)

| 文件 | 问题 | 状态 |
|------|------|------|
| `DocumentCanvas.tsx` | UI 事件处理器直接构造 DocOps | ⚠️ 待重构 |
| `copilotRuntimeBridge.ts` | 部分 AI 操作绕过 CommandBus | ⚠️ 待重构 |

### 4.3 低优先级 (可延后)

| 文件 | 问题 | 状态 |
|------|------|------|
| 列表操作 | 未支持 DocOps 路径 | 📋 v2 计划 |
| IME 输入 | 未充分测试 | 📋 v2 计划 |
| 粘贴操作 | 仍走 Lexical 原生 | 📋 v2 计划 |

---

## 5. 测试指南

### 5.1 单元测试

```bash
# 运行所有测试
npm test

# 运行特定测试
npm test -- --run src/document/__tests__/marks.toggle.test.ts

# 运行 DocOps 相关测试
npm test -- --run src/core/commands/__tests__/
npm test -- --run src/document/__tests__/
npm test -- --run src/docops/__tests__/
```

### 5.2 手动测试 Checklist

参见 `docs/docops-runtime-notes.md` 中的完整 Checklist。

---

## 6. FAQ

### Q: 为什么要用 DocOps 而不是直接操作 Lexical？

**A**: 
1. **可测试性**：DocOps 是纯数据，可以脱离 UI 测试
2. **可追踪性**：每个操作都有明确的类型和参数，便于调试和日志
3. **可撤销性**：基于 AST 的历史栈比 Lexical 的更可控
4. **AI 友好**：LLM 可以直接生成 DocOps，无需理解 Lexical 内部

### Q: Feature Flag 什么时候可以默认开启？

**A**: 当以下条件满足时：
1. 所有核心编辑功能测试通过
2. 手动测试 Checklist 全部通过
3. 性能没有明显下降
4. 无已知 bug

### Q: 如何处理 Lexical 不支持的操作？

**A**: 
1. 先在 AST 层面定义操作
2. 实现 DocumentEngine handler
3. 在 Reconciler 中处理 AST → Lexical 的映射
4. 如果 Lexical 无法表达，考虑自定义 Lexical Node

---

*最后更新：2025-11*

