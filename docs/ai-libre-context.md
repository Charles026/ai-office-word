# AI-LIBRE / AI Office – Project Context

> 本文是 AI-LIBRE / AI Office 项目的「架构背景 + 设计约束」，  
> 供人类开发者和代码助手（Codex / ChatGPT 等）统一世界观使用。

---

## 1. 项目概览（What）

### 1.1 产品定位

- 本地优先的 **AI Word 编辑器**：**AI-LIBRE / AI Office**

- 面向场景：

  - 单人、严肃写作 / 长文档创作

  - 本地 `.docx` 文件

- 有意不做：

  - 多人协作

  - 云端文档 / 云盘存储

  - 复杂权限系统

### 1.2 技术栈

- 桌面壳：**Electron + React + TypeScript**

- 编辑器内核：**Lexical（Rich Text）**

- 文档中间层：

  - `docx ↔ HTML / LibreHTML ↔ Lexical AST`

---

## 2. 当前已实现能力（Now）

### 2.1 编辑体验

- 基础文字编辑

- 标题：H1 / H2 / H3

- 段落对齐方式

- 字体大小等基础格式

- 大纲视图

  - 按 H1/H2/H3 抽取结构

- Ribbon 工具栏

  - 常用格式工具入口

### 2.2 文件能力

- 本地新建 `.docx`

- 打开本地 `.docx`

- 最近文档列表

### 2.3 AI 能力（Section AI + Copilot）

- 对选区 / 小节的 AI 操作已打通：

  - 改写（rewrite）

  - 翻译（translate）

  - 总结（summarize）

- 核心链路（单次 Section AI）：

  ```text
  Editor / Outline
    → DocContextEnvelope
    → Section Prompt
    → LLM
    → DocOps
    → Document AST
  ```

- Copilot 右侧对话面板：

  - 可按章节发指令

  - 支持应用 AI 结果到文档

### 2.4 调试工具：DocContextInspector

- 可以查看每次 LLM 调用的完整上下文：

  - Envelope

  - System / User / Assistant 消息

- 主要用于：

  - Prompt 调试

  - 行为分析

  - 未来查看 Intent / DocOpsPlan

---

## 3. 核心架构：DocOps Runtime（How）

### 3.1 总链路

```text
AI Runtime / Copilot
  → DocOps Engine
  → Document AST
  → Web Canvas
  → Format / Layout Engine
```

- **AI Runtime / Copilot**

  - 负责理解用户自然语言意图

  - 基于文档 & 行为上下文规划操作（Intent / DocOpsPlan）

- **DocOps Engine**

  - 所有 AI 对文档的修改都抽象为 **DocOps**

  - 只接受结构化操作，不直接改 DOM/HTML

  - 负责在 AST 上执行，并保证可撤销、可回放

- **Document AST & Web Canvas**

  - AST：统一的文档结构表示（连接 docx / HTML / Lexical）

  - Canvas：编辑器 UI，展示 AST 的可视化结果

> 设计原则：**AI 永远在「DocOps 层」动手，而不是在「原始字符串」上乱改。**

---

## 4. DocContextEnvelope（文档上下文）

### 4.1 作用

> **给 LLM 提供结构化的文档上下文。**

当前重点支持 `scope = section`：

- `focus`

  - 当前小节 id

  - 当前小节标题

  - 当前小节正文文本

  - `charCount` / `approxTokenCount`

- `global`

  - 文档标题

  - 完整大纲（`sectionId + title`）

所有 Section AI 的 prompt 构造都统一从 **Envelope** 取数据，不直接从 Editor 状态拼字符串。

---

## 5. InteractionLog & BehaviorSummary v2（行为上下文）

### 5.1 InteractionLog（原始事件）

> **只记录"发生了什么"，不在这里推断偏好。**

典型事件：

- AI 相关

  - `ai.section_rewrite.applied`

  - `ai.key_sentences.marked`

  - `ai.key_terms.marked`

- 用户手动操作

  - `user.inline_format.applied`（对选区加粗 / 高亮）

  - `user.section_focus.changed`

  - `user.undo`

  - ……（可扩展）

这些事件仅用于**后续行为分析和意图理解**，不会直接展示给用户。

### 5.2 BehaviorSummary v2

> 目标：把「用户最近对当前小节做了什么」压缩成一段行为数据，
> 注入到 System Prompt，让 LLM 自己理解用户偏好和复杂意图。

函数形态（概念）：

```ts
buildBehaviorSummaryV2({ docId, sectionId, windowMs })
  → {
      textSummary: string;      // 面向 LLM 的自然语言事实描述
      behaviorContext: object;  // 结构化统计，用于 Planner / 扩展
    }
```

统计内容包括但不限于：

- 重写次数 / 撤销次数

- AI 标记关键句数量（`aiKeySentenceCount`）

- AI 标记关键词语数量（`aiKeyTermCount`）

- 用户手动对短选区加粗/高亮次数（词 / 短语级）

- 用户手动对整句加粗/高亮次数（句子级）

- 最近一次操作类型（`lastActionKind`）等

#### 5.2.1 注入 System Prompt 的方式（Section AI 专用）

示意：

```text
=== 最近用户在此文档上的操作（当前小节） ===
{textSummary}

=== 行为数据使用说明 ===
- 上面的内容只是对用户最近在当前小节中的操作记录。
- 当用户提到「标注重点」「突出重点」「高亮」等时，请你：
  1. 根据这些行为自行判断用户更可能希望标记词语、短语还是句子；
  2. 如果行为数据不足以判断，就直接向用户确认，避免瞎猜；
  3. 不要把这些行为描述原样重复给用户听。
```

#### 5.2.2 设计关键点

- **不在代码里推断偏好布尔值**

  - 不再有 `prefersKeyTerms = true/false` 这类硬逻辑。

- 行为摘要只做：

  - **客观记录 + 数据压缩**

  - 复杂意图和偏好推断交给 LLM（结合当前自然语言指令）。

---

## 6. AI Runtime 三层角色划分

> 统一认知：所有 AI 相关代码都尽量归入以下三层之一。

| 层级                | 职责                                                  |
| ----------------- | --------------------------------------------------- |
| **ContextEngine** | 把世界说清楚：整理 DocContextEnvelope + BehaviorSummary（事实）。 |
| **LLM / Copilot** | 判断 & 规划：理解自然语言，生成 Canonical Intent + DocOpsPlan。    |
| **DocOps Engine** | 执行：在 AST 上应用 DocOps，保证可预测、可撤销、可记录。                  |

**重要约束：**

- ContextEngine **不做偏好推断**，只产出事实数据。

- LLM 负责利用这些事实 + 高层"处事原则"来做决策。

- DocOps Engine 不理解自然语言，只认结构化 DocOps。

---

## 7. Copilot 设计目标（"很懂你"的方式）

高层目标：

1. **理解复杂意图**

   - 能处理诸如「改写这一段，同时帮我标出重点词语」之类的组合需求。

2. **尊重文档结构 & 信息安全**

   - 不随意删改结构，不无理由删段落。

3. **逐步变"懂你"**

   - 通过 BehaviorSummary 感知用户最近的写作 / 标注习惯；

   - 在不确定时保持保守，必要时用极低摩擦的澄清问一句。

原则（给 LLM 的"性格设定"）：

- 优先保证：

  1. 不做错 / 不破坏结构

  2. 尽量少打扰

  3. 在高影响决策上允许用户拍板

- 当指令模糊时：

  - 倾向选择与用户最近行为**连续**、且**容易撤销**的方案；

  - 无法确定且涉及大改动时，宁可先询问用户。

（这些原则在具体实现中会写入 Section AI 的 System Prompt。）

---

## 8. 对代码助手（Codex / ChatGPT 等）的约定

> 本节专门给「代码生成 / 架构建议」模型看的。

1. **请默认已阅读本文件并遵守其中架构设定。**

2. 在涉及 AI / Copilot 相关代码时：

   - 优先保证：

     - 稳定性

     - 清晰的分层（ContextEngine / LLM / DocOps Engine）

     - 所有文档修改通过 DocOps 抽象

   - 不要：

     - 直接操作 DOM / HTML 字符串来改文档内容

     - 在日志层写用户"偏好布尔值"

     - 引入 Multi-Agent / 复杂外部编排服务（当前阶段）

3. 当需要扩展功能（如 Intent / DocOpsPlan / BehaviorSummary）时：

   - 先思考它属于哪一层（ContextEngine / LLM / DocOps），再决定放在哪个模块；

   - 避免把多层职责混在同一个文件里；

   - 尽量提供类型安全的接口（TypeScript 类型 + 基础校验）。

---

> **TL;DR：**
> AI-LIBRE / AI Office 不是"有 AI 的编辑器"，
> 而是一套围绕 `.docx` 的本地 DocOps Runtime：
>
> - ContextEngine 把文档 & 行为说清楚；
> - LLM 在此基础上判断 / 规划；
> - DocOps Engine 负责在 AST 上安全执行。
>   所有代码与架构决策，都应围绕这个核心展开。

