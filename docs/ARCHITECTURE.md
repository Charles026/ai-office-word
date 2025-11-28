# AI Office 编辑器架构文档

## 概述

AI Office 是一个基于 Electron + React 的桌面文档编辑器，采用 **Document Model + Command Bus** 架构。

### 核心原则

1. **AST 是唯一真相** - 所有文档内容都存储在 `DocumentAst` 中
2. **命令驱动** - 所有编辑操作都通过 `CommandBus` 执行
3. **不可变更新** - AST 更新返回新对象，不修改原对象
4. **分层清晰** - UI / 命令 / 文档 / 格式 各层职责明确

---

## 架构层级

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│   ┌─────────┐  ┌─────────────┐  ┌──────────────────────┐    │
│   │ Ribbon  │  │  Shortcuts  │  │   AI Rewrite Panel   │    │
│   └────┬────┘  └──────┬──────┘  └──────────┬───────────┘    │
│        │              │                    │                 │
│        └──────────────┼────────────────────┘                 │
│                       ▼                                      │
│   ┌──────────────────────────────────────────────────────┐  │
│   │              EditorContainer (React)                  │  │
│   │  - 维护 AST 状态                                       │  │
│   │  - 维护选区状态                                        │  │
│   │  - 转发命令到 CommandBus                               │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Command Layer                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                  CommandBus                           │  │
│   │  - 注册命令处理器                                      │  │
│   │  - 执行命令                                           │  │
│   │  - 计算命令状态 (enabled/active)                       │  │
│   └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│           ┌───────────────┼───────────────┐                 │
│           ▼               ▼               ▼                 │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│   │ toggleBold  │ │ setHeading  │ │ replaceRange│          │
│   │ toggleItalic│ │ splitBlock  │ │ (AI改写)    │          │
│   │ ...         │ │ ...         │ │ ...         │          │
│   └─────────────┘ └─────────────┘ └─────────────┘          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Document Layer                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │               DocumentEngine                          │  │
│   │  - 应用 DocOps 到 AST                                  │  │
│   │  - 维护历史记录 (undo/redo)                            │  │
│   │  - 不可变更新                                         │  │
│   └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                 DocumentAst                           │  │
│   │  - blocks: BlockNode[]                                │  │
│   │  - version: number                                    │  │
│   │  - metadata                                           │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Format Layer                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │            LibreOfficeFormatEngine                    │  │
│   │  - docx → HTML → AST (导入)                           │  │
│   │  - AST → HTML → docx (导出)                           │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心模块

### 1. DocumentAst (`src/document/types.ts`)

文档的抽象语法树，是所有编辑操作的基础。

```typescript
interface DocumentAst {
  version: number;
  blocks: BlockNode[];
  metadata: DocumentMetadata;
}

type BlockNode = ParagraphNode | HeadingNode | ListNode | PlaceholderNode;

interface TextRunNode {
  id: string;
  type: 'text';
  text: string;
  marks: TextMarks;  // { bold?, italic?, underline?, strikethrough? }
}
```

### 2. CommandBus (`src/core/commands/CommandBus.ts`)

统一命令总线，所有编辑操作都通过它执行。

```typescript
// 执行命令
const result = commandBus.execute('toggleBold', context, payload);

// 查询命令状态
const state = commandBus.getCommandState('toggleBold', context);
// { enabled: boolean, active: boolean }
```

**支持的命令：**

| 类别 | 命令 ID | 说明 |
|------|---------|------|
| 文本格式 | `toggleBold`, `toggleItalic`, `toggleUnderline`, `toggleStrike` | 切换文本样式 |
| 块级格式 | `setBlockTypeParagraph`, `setBlockTypeHeading1/2/3` | 设置段落类型 |
| 编辑 | `insertText`, `deleteRange`, `replaceRange`, `splitBlock` | 文本编辑 |
| 历史 | `undo`, `redo` | 撤销/重做 |
| AI | `aiRewrite` | AI 改写（本质是 replaceRange） |

### 3. DocumentEngine (`src/document/DocumentEngine.ts`)

负责将 DocOps 应用到 AST，并维护历史记录。

```typescript
const result = documentEngine.applyOps(ast, [
  { type: 'InsertText', payload: { nodeId, offset, text }, meta }
]);
// { nextAst, changed: boolean }

const prevAst = documentEngine.undo(currentAst);
const nextAst = documentEngine.redo(currentAst);
```

### 4. DocOps (`src/docops/types.ts`)

原子文档操作，描述对 AST 的具体修改。

```typescript
type DocOp =
  | InsertParagraphOp
  | InsertTextOp
  | DeleteRangeOp
  | ToggleBoldOp
  | ToggleItalicOp
  | ToggleUnderlineOp
  | ToggleStrikeOp
  | SetHeadingLevelOp
  | SplitBlockOp
  | InsertLineBreakOp
  | ...
```

### 5. Selection (`src/document/selection.ts`)

选区模型，不依赖浏览器原生 selection。

```typescript
interface DocSelection {
  anchor: DocPoint;  // { blockId, offset }
  focus: DocPoint;
}

interface SelectionSnapshot extends DocSelection {
  text: string;
  isCollapsed: boolean;
  isCrossBlock: boolean;
}
```

---

## 数据流

### 1. Ribbon 按钮点击

```
Ribbon 按钮点击
    ↓
EditorContainer.executeCommand(ribbonId)
    ↓
RIBBON_TO_COMMAND 映射 → commandId
    ↓
CommandBus.execute(commandId, context, payload)
    ↓
命令处理器生成 DocOps
    ↓
DocumentEngine.applyOps(ast, ops)
    ↓
返回新 AST + 新 Selection
    ↓
更新 React 状态
    ↓
DocumentCanvas 重新渲染
```

### 2. 键盘快捷键

```
键盘事件 (Cmd+B)
    ↓
EditorContainer 的 keydown 处理
    ↓
executeCommandInternal('toggleBold')
    ↓
(同上)
```

### 3. AI 改写

```
用户选中文本 → 点击 AI 改写
    ↓
打开 AiRewriteDialog（锁定 selectionSnapshot）
    ↓
用户输入 prompt → 点击执行
    ↓
调用 window.aiDoc.rewriteSelection({ ast, selection, prompt })
    ↓
Main 进程调用 LLM API
    ↓
返回 newText
    ↓
executeCommandInternal('aiRewrite', { newText })
    ↓
CommandBus.execute('replaceRange', ...) 
    ↓
DocumentEngine 应用 DeleteRange + InsertText
    ↓
更新 AST，光标移到新文本末尾
```

### 4. 文档导入/导出

```
打开 docx 文件
    ↓
Main: LibreOfficeFormatEngine.importFromDocx(filePath)
    ↓
LibreOffice CLI: docx → HTML
    ↓
htmlToAst(html): HTML → DocumentAst
    ↓
Renderer: 初始化 EditorContainer

保存 docx 文件
    ↓
Renderer: onSave(ast)
    ↓
Main: LibreOfficeFormatEngine.exportToDocx(ast, filePath)
    ↓
astToHtml(ast): AST → HTML
    ↓
LibreOffice CLI: HTML → docx
```

---

## 目录结构

```
src/
├── core/                    # 核心模块（不依赖 React）
│   └── commands/           # 命令系统
│       ├── types.ts        # 命令类型定义
│       ├── CommandBus.ts   # 命令总线
│       └── __tests__/      # 单元测试
│
├── document/               # 文档模型
│   ├── types.ts            # AST 类型定义
│   ├── selection.ts        # 选区模型
│   ├── DocumentEngine.ts   # AST 更新引擎
│   └── __tests__/          # 单元测试
│
├── docops/                 # 文档操作
│   ├── types.ts            # DocOp 类型
│   ├── DocOpsEngine.ts     # Intent → DocOps 转换
│   └── __tests__/          # 单元测试
│
├── format/                 # 格式转换
│   ├── html/               # HTML ↔ AST
│   ├── libreoffice/        # LibreOffice 集成
│   └── __tests__/          # 单元测试
│
├── canvas/                 # 编辑器 UI 组件
│   ├── EditorContainer.tsx # 编辑器容器
│   ├── DocumentCanvas.tsx  # 文档渲染
│   └── AiRewriteDialog.tsx # AI 改写对话框
│
├── ribbon/                 # Ribbon UI
│   ├── types.ts            # Ribbon 类型
│   ├── Ribbon.tsx          # Ribbon 组件
│   └── Ribbon.css          # Ribbon 样式
│
└── runtime/                # AI 运行时
    ├── AiRuntime.ts        # AI 调用入口
    └── LlmService.ts       # LLM API 封装
```

---

## 测试

```bash
# 运行所有测试
npm test

# 运行特定测试
npm test -- --run src/core/commands/__tests__/CommandBus.test.ts

# 生成覆盖率报告
npm run test:coverage
```

**测试覆盖：**
- `DocumentEngine`: 基础操作 (InsertText, DeleteRange, ToggleBold, SplitBlock 等)
- `CommandBus`: 命令执行和状态计算
- `Selection`: 选区工具函数
- `HtmlMapping`: HTML ↔ AST 转换

---

## 开发规范

### 禁止事项

1. **不允许在 React 组件中直接修改 AST** - 必须通过 `executeCommand` 或 `DocumentEngine.applyOps`
2. **不允许直接操作 DOM** - 格式化、插入等操作必须通过命令系统
3. **不允许在命令层调用网络 API** - 网络调用只能在 Runtime 层
4. **不允许在 Document 层处理 UI 逻辑**

### 添加新命令

1. 在 `src/core/commands/types.ts` 添加命令 ID
2. 在 `CommandBus.ts` 注册处理器
3. 如果需要新的 DocOp，在 `src/docops/types.ts` 添加
4. 在 `DocumentEngine.ts` 添加对应的 handler
5. 编写单元测试

### 添加新格式

1. 在 `TextMarks` 中添加新属性
2. 添加对应的 `Toggle*Op`
3. 在 `DocumentEngine` 添加 handler
4. 更新 `htmlToAst` 和 `astToHtml` 的映射规则
5. 编写单元测试

---

## 后续演进

- [ ] 样式系统：抽象 Word 样式到 styleId
- [ ] 大纲视图：基于 HeadingNode 生成文档大纲
- [ ] 评论/批注：作为独立的 annotation 层
- [ ] 协同编辑：OT/CRDT 支持
- [ ] 更多块类型：表格、图片、代码块

