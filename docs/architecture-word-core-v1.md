# AI Office 文档内核 v1 - 架构说明与里程碑

> **产品定位**：不是富文本 Demo，而是 Word 级文档内核
> 
> 给未来的 AI Runtime / Copilot 提供可靠的「文档物理世界」

---

## 一、核心目标

文档内核 v1 的职责只有两件事：

1. **往返不坏**：任何本地 `.docx` 在这里 打开 → 编辑 → 保存 → 再用 Word/Libre 打开不会坏
2. **AI 安全操作**：AI 在这里做改写 / 续写 / 插入时，不会破坏文档结构和排版

---

## 二、架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Runtime / Copilot                      │
│                   (src/runtime/AiRuntime.ts)                 │
│              接入 LLM，将自然语言转为 Intent                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     DocOps Engine                            │
│                 (src/docops/DocOpsEngine.ts)                 │
│              将 Intent 翻译为原子文档操作 (DocOp[])            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Document AST                             │
│                   (src/document/types.ts)                    │
│              文档结构与内容的 Source of Truth                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Web Canvas                               │
│            (src/editor/MinimalEditor.tsx - Lexical)          │
│                    React 编辑器渲染                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Format / Layout Engine                      │
│        (src/format/libreoffice/LibreOfficeFormatEngine.ts)   │
│              docx ↔ HTML 读写与排版                           │
└─────────────────────────────────────────────────────────────┘
```

### 层级职责约束

| 层级 | 允许 | 禁止 |
|------|------|------|
| **AI Runtime** | 调用 LLM、管理对话上下文 | 直接修改 AST、访问文件系统 |
| **DocOps Engine** | 生成 DocOp 序列 | 修改 AST、调用 LLM |
| **Document AST** | 定义结构、提供不可变更新 | 处理 I/O、格式转换 |
| **Web Canvas** | 渲染 AST、响应用户输入 | 直接修改 AST（需通过 DocOps） |
| **Format Engine** | 格式转换 | 关心 UI 细节 |

---

## 三、当前代码结构

```
src/
├── runtime/          # AI Runtime 层
│   ├── AiRuntime.ts  # [WIP] Stub 实现，待接入 LLM
│   └── LlmService.ts # [TODO] LLM API 封装
│
├── docops/           # DocOps Engine 层
│   ├── types.ts      # [DONE] DocOp 类型定义
│   └── DocOpsEngine.ts # [WIP] Intent → DocOps 转换
│
├── document/         # Document AST 层
│   ├── types.ts      # [DONE] AST 类型定义
│   └── DocumentEngine.ts # [WIP] AST 不可变更新
│
├── editor/           # Web Canvas 层 (Lexical)
│   ├── MinimalEditor.tsx # [DONE] 基础编辑器
│   ├── plugins/      # [DONE] 列表、样式插件
│   └── styles/       # [DONE] 段落样式配置
│
├── format/           # Format Engine 层
│   ├── lexical/      # [DONE] Lexical ↔ HTML
│   ├── libreoffice/  # [DONE] LibreOffice CLI 适配
│   └── html/         # [DONE] HTML ↔ AST
│
├── core/commands/    # 命令系统
│   └── LexicalAdapter.ts # [DONE] Ribbon → Lexical 命令
│
└── config/           # 配置
    ├── fonts.ts      # [DONE] 字体选项
    └── appConfig.ts  # [DONE] 应用配置
```

---

## 四、文档内核 v1 能力清单与状态

### 1. 本地 docx 新建 / 打开 / 保存 不坏文件

| 能力 | 状态 | 说明 |
|------|------|------|
| 新建 docx | ✅ DONE | 通过 LibreOffice 创建空文档 |
| 打开 docx → HTML → Editor | ✅ DONE | LibreOffice 转 HTML，Lexical 加载 |
| 保存 Editor → HTML → docx | ✅ DONE | Lexical 导出 HTML，LibreOffice 转 docx |
| 另存为 | ✅ DONE | 支持选择路径 |
| 自动保存 | ❌ TODO | 需要实现 debounce 写入临时文件 |
| 脏状态追踪 | ✅ DONE | isDirty 标记，关闭前提示 |

### 2. 稳定的文本编辑 & 撤销/重做

| 能力 | 状态 | 说明 |
|------|------|------|
| 字符插入/删除 | ✅ DONE | Lexical 内置 |
| 换行 (Enter) | ✅ DONE | 支持，标题后 Enter 变正文 |
| 粘贴 | ⚠️ WIP | 基础支持，复杂格式可能丢失 |
| 光标移动 | ✅ DONE | 键盘 + 鼠标 |
| 选区操作 | ✅ DONE | Shift + 方向键 |
| Undo/Redo | ✅ DONE | Lexical HistoryPlugin |
| Undo/Redo 与 AST 一致 | ⚠️ WIP | 当前使用 Lexical 内部状态，非 AST |

**⚠️ 架构问题**：当前编辑器直接使用 Lexical 状态，未经过 Document AST 层。需要决定：
- 方案 A：保持 Lexical 为 Source of Truth，AST 仅用于 Import/Export
- 方案 B：AST 为 Source of Truth，Lexical 只是渲染层

**当前采用方案 A**，简化实现，后续可迁移。

### 3. 段落模型统一

| 能力 | 状态 | 说明 |
|------|------|------|
| 正文段落 | ✅ DONE | ParagraphNode |
| 标题段落 (H1/H2/H3) | ✅ DONE | HeadingNode |
| 列表项段落 | ✅ DONE | ListItemNode，支持多级 |
| 引用段落 | ❌ TODO | 需要添加 QuoteNode 支持 |
| 段落样式字段 | ✅ DONE | paragraphStyle 配置 |
| 列表信息 (listType/level) | ✅ DONE | Lexical ListNode |

### 4. 基础字符样式

| 能力 | 状态 | 说明 |
|------|------|------|
| 粗体 (B) | ✅ DONE | FORMAT_TEXT_COMMAND |
| 斜体 (I) | ✅ DONE | FORMAT_TEXT_COMMAND |
| 下划线 (U) | ✅ DONE | FORMAT_TEXT_COMMAND |
| 删除线 (S) | ✅ DONE | FORMAT_TEXT_COMMAND |
| 字体族 (fontKey) | ✅ DONE | 5 种预设字体 |
| 字号 | ❌ TODO | 需要添加字号选择器 |
| 选区覆盖 | ✅ DONE | 对选中文字应用 |
| 光标输入继承 | ✅ DONE | 通过 selection.style |

### 5. 基础段落样式系统

| 能力 | 状态 | 说明 |
|------|------|------|
| 预设样式 (正文/H1/H2/H3) | ✅ DONE | PARAGRAPH_STYLES 配置 |
| 样式绑定排版属性 | ✅ DONE | fontSize, fontWeight, lineHeight 等 |
| Ribbon 应用样式 | ✅ DONE | applyParagraphStyle 命令 |
| Enter 行为 (标题→正文) | ✅ DONE | StylePlugin |
| 引用样式 | ❌ TODO | 需要添加 |

### 6. 基础段落排版

| 能力 | 状态 | 说明 |
|------|------|------|
| 对齐 (左/中/右) | ❌ TODO | 需要实现 |
| 两端对齐 | ❌ TODO | 需要实现 |
| 首行缩进 | ❌ TODO | 需要实现 |
| 整体缩进 | ⚠️ WIP | 列表有缩进，段落无 |
| 行距 (1.0/1.5/2.0) | ❌ TODO | 需要实现 |
| 无序列表 | ✅ DONE | ListPlugin |
| 有序列表 | ✅ DONE | ListPlugin |
| Tab/Shift+Tab 调整级别 | ✅ DONE | ListPlugin |
| Enter 新条目/退出列表 | ✅ DONE | ListPlugin |
| 列表 docx 往返 | ⚠️ WIP | 基础支持，嵌套可能丢失 |

### 7. "纸张感"写作区域

| 能力 | 状态 | 说明 |
|------|------|------|
| Page-like 容器 | ✅ DONE | DocumentSurface 组件 |
| 页边距 | ✅ DONE | 固定 margin |
| 长文档滚动 | ✅ DONE | overflow: auto |
| 滚动平滑 | ✅ DONE | 无明显卡顿 |

### 8. AI 改写（选区级）

| 能力 | 状态 | 说明 |
|------|------|------|
| 选中文本触发 | ✅ DONE | Ribbon AI 改写按钮 |
| 提取选区文本 | ✅ DONE | getTextContent() |
| LLM 改写 | ⚠️ WIP | 有 UI，LLM 未接入 |
| 映射回 AST | ❌ TODO | 当前直接替换文本 |
| 保留段落样式 | ❌ TODO | 需要实现 |
| 一键 Undo | ✅ DONE | Lexical 历史 |
| DocOps 命令 | ✅ DONE | buildOpsForRewriteSelection |

### 9. AI 插入（光标级）

| 能力 | 状态 | 说明 |
|------|------|------|
| 光标触发 | ❌ TODO | 需要添加 UI |
| 上下文 prompt | ❌ TODO | 需要实现 |
| 插入段落 | ❌ TODO | 需要实现 |
| 继承当前样式 | ❌ TODO | 需要实现 |
| DocOps 命令 | ❌ TODO | DOC_AI_INSERT_AFTER |

### 10. 完整往返自测

| 能力 | 状态 | 说明 |
|------|------|------|
| 创建测试文档 | ⚠️ WIP | 手动测试 |
| 保存为 docx | ✅ DONE | LibreOffice 转换 |
| Word/Libre 验证 | ⚠️ WIP | 手动验证 |
| 再次打开验证 | ⚠️ WIP | 基础结构保留 |
| 自动化测试 | ❌ TODO | 需要编写 |

---

## 五、优先级排序

### P0 - 必须立即修复

1. **字号选择器** - 基础排版能力
2. **段落对齐** - 左/中/右/两端
3. **行距设置** - 1.0/1.5/2.0

### P1 - 本周完成

4. **自动保存** - 防止数据丢失
5. **引用样式** - 完善段落类型
6. **首行/整体缩进** - 段落排版

### P2 - 下周完成

7. **AI 插入功能** - 光标级 AI 操作
8. **改写保留样式** - AI 操作不破坏格式
9. **往返自动化测试** - 保证质量

### P3 - 后续迭代

10. **粘贴格式优化** - 复杂格式保留
11. **跨 block 选区改写** - AI 操作增强
12. **LLM 接入** - 真实 AI 能力

---

## 六、架构决策记录

### ADR-001: Lexical vs AST 作为 Source of Truth

**决策**：当前采用 Lexical 作为 Source of Truth，AST 仅用于 Import/Export。

**原因**：
- 简化实现，快速迭代
- Lexical 内置 Undo/Redo、Selection 管理
- AST 同步需要大量额外工作

**风险**：
- AI 操作需要先转换为 Lexical 命令
- 复杂操作可能难以表达

**迁移路径**：
- 如需 AST 为 Source of Truth，可通过 Lexical 的 EditorState 序列化实现

### ADR-002: LibreOffice 作为格式引擎

**决策**：使用 LibreOffice CLI 进行 docx ↔ HTML 转换。

**原因**：
- 高保真度的格式转换
- 支持复杂 Word 特性
- 避免重新实现 OOXML 解析

**风险**：
- 依赖外部应用
- 转换性能较慢

**备选**：SimpleDocxEngine 作为 fallback。

### ADR-003: 字体使用系统字体栈

**决策**：使用系统字体栈，不引入外部字体文件。

**原因**：
- 跨平台兼容
- 无需加载额外资源
- 减小应用体积

**字体栈**：
- 中文：PingFang SC, Microsoft YaHei, Noto Sans CJK SC
- 英文：SF Pro, Segoe UI, Roboto
- 等宽：SFMono, Menlo, Consolas

---

## 七、测试策略

### 单元测试

- `src/docops/__tests__/DocOpsEngine.test.ts` - DocOps 生成
- `src/document/__tests__/DocumentEngine.test.ts` - AST 操作
- `src/format/__tests__/HtmlMapping.test.ts` - HTML 转换

### 集成测试

- 创建文档 → 编辑 → 保存 → 重新打开
- 各种格式的 docx 导入导出
- AI 改写流程

### E2E 测试 (TODO)

- 完整用户流程
- 与 Word/LibreOffice 的兼容性

---

## 八、后续迭代顺序

在文档内核 v1 稳定后：

1. 大纲视图 / 结构导航（基于 H1/H2/H3）
2. 评论 / 批注（单人版）
3. 表格与图片的基础支持
4. Section / 页眉页脚（分页模型）
5. AI 级别提升：结构重组、自动生成大纲

---

**记住**：我们做的不是一个富文本 demo，而是 **"AI Office 的 Word 兼容文档内核，让未来 AI Runtime 有一个可靠的文档物理世界可以操纵"**。

