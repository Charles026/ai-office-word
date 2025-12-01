# DocStructureEngine 设计文档

> 版本：v1.4  
> 日期：2025-11-30  
> 作者：AI Office Team

> 版本：v1.0.0
> 日期：2025-11
> 状态：已实现

## 1. 概述

**DocStructureEngine** 是 AI Office 文档模型中的一个新抽象层，负责理解文档的章节结构（H1/H2/H3）和段落角色（doc_title / section_title / body / meta 等），为 Section AI 和 Copilot 提供稳定的"结构真相"。

### 1.1 层级定位

```
┌─────────────────────────────────────────────────────────────┐
│                    Copilot / Section AI                      │
│              （消费结构化上下文，执行 AI 操作）                │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 消费
                              │
┌─────────────────────────────────────────────────────────────┐
│                  DocContextEnvelope                          │
│                 （上下文快照，传给 LLM）                       │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 构建自
                              │
┌─────────────────────────────────────────────────────────────┐
│                  DocStructureEngine  ← NEW                   │
│              （结构真相：章节树 + 段落角色）                   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 分析
                              │
┌─────────────────────────────────────────────────────────────┐
│                    DocumentAst / Lexical AST                 │
│                （内容真相：文本 + 基础样式）                   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心价值

1. **统一的结构真相**：Section AI 和 Copilot 不再需要各自猜测文档结构
2. **稳定的 API**：`DocStructureSnapshot` 提供一致的结构查询接口
3. **角色语义**：每个 block 都有明确的角色标签（doc_title / body / meta 等）
4. **可扩展**：为未来的结构智能化（如小模型辅助）预留接口

## 2. 核心类型

### 2.1 SectionNode（章节节点）

```typescript
interface SectionNode {
  id: string;                    // 内部 sectionId（sec-{blockId}）
  level: 1 | 2 | 3;              // 归一化后的逻辑层级
  titleBlockId: string;          // 标题所在 block 的 ID
  titleText: string;             // 标题纯文本

  startBlockIndex: number;       // 在 blocks 中的起始索引
  endBlockIndex: number;         // 结束索引（左闭右开）

  ownParagraphBlockIds: string[];// 直属正文段落（不含子 section）
  children: SectionNode[];       // 子章节
}
```

### 2.2 ParagraphRole（段落角色）

```typescript
type ParagraphRole =
  | 'doc_title'      // 文档主标题（整个文档只应有一个）
  | 'section_title'  // 章节标题（任何层级的 H1/H2/H3）
  | 'body'           // 正文段落
  | 'list_item'      // 列表项
  | 'quote'          // 引用
  | 'meta'           // 元信息（作者、日期、页脚等）
  | 'unknown';       // 无法识别
```

### 2.3 DocStructureSnapshot（结构快照）

```typescript
interface DocStructureSnapshot {
  sections: SectionNode[];                     // 章节树（根级别）
  paragraphRoles: Record<string, ParagraphRole>;// blockId → 角色
  meta: DocStructureMeta;                      // 元信息
}

interface DocStructureMeta {
  totalBlocks: number;
  totalSections: number;
  docTitleBlockId?: string;
  generatedAt: number;
  engineVersion: string;
}
```

## 3. 算法设计

### 3.1 标题识别（headingScore）

每个 block 计算一个"标题得分"，得分 >= 3 被认定为标题候选：

| 特征 | 得分 |
|------|------|
| 内置 heading 样式 (block.type === 'heading') | +4 |
| 字号明显大于正文 | +2 |
| 加粗 | +1 |
| 单行短文本 (< 80 字) | +1 |
| 以编号开头 ("第一章", "1.", "Chapter 1") | +1 |
| 在文档顶部 (index <= 2) | +1 |

### 3.2 层级归一化

将 Heading 候选归一化为逻辑层级 1/2/3：

1. **优先使用已有的 heading level**：
   - H1 → level 1
   - H2 → level 2
   - H3 → level 3
   - H4/H5/H6 → level 3（降级）

2. **否则按字号差分类**：
   - delta >= 4 → level 1
   - delta >= 2 → level 2
   - 其他 → level 3

### 3.3 章节树构建

使用栈来维护层级关系：

```
for each heading candidate h:
  1. 弹出栈中所有 level >= h.level 的节点，修正其 endBlockIndex
  2. 如果栈为空，将 h 加入根级 sections
  3. 否则将 h 加入栈顶节点的 children
  4. 将 h 入栈
```

### 3.4 段落角色分配

1. **文档主标题**：根据策略（`first_h1` / `largest_heading`）识别
2. **章节标题**：所有 heading 候选
3. **meta**：顶部短文本，匹配 "作者"/"日期"/"版本"/"©" 等模式
4. **list_item / quote**：根据 block.type
5. **body**：默认角色

## 4. 使用方式

### 4.1 从 Lexical 编辑器构建

```typescript
import { buildDocStructureFromEditor } from '@/document/structure';

// 在编辑器状态可用时调用
const snapshot = buildDocStructureFromEditor(editor);

// 查询章节
const section = findSectionById(snapshot, sectionId);
```

### 4.2 从 DocumentAst 构建

```typescript
import { buildDocStructureFromAst } from '@/document/structure';

// 离线处理
const snapshot = buildDocStructureFromAst(ast);
```

### 4.3 结合 extractSectionContext

```typescript
import {
  getDocStructureSnapshot,
  extractSectionContextFromStructure,
  isSectionIdValid,
} from '@/runtime/context';

// 获取结构快照（可复用）
const snapshot = getDocStructureSnapshot(editor);

// 验证 sectionId
if (isSectionIdValid(snapshot, sectionId)) {
  // 提取上下文
  const context = extractSectionContextFromStructure(editor, snapshot, sectionId);
}
```

## 5. 章节层级语义

### 5.1 H1/H2/H3 的含义

| 层级 | 语义 | 典型用途 |
|------|------|----------|
| H1 | 文档根章节 | 文档主标题，通常只有一个 |
| H2 | 一级章节 | 主要章节划分 |
| H3 | 二级子章节 | 章节内的细分 |

### 5.2 文档主标题处理

- 第一个 H1 默认被标记为 `doc_title`
- 如果文档主标题下没有正文段落，它仍是一个 SectionNode
- Section AI 在处理 `doc_title` 时应特殊对待（通常不直接改写）

### 5.3 层级跳跃处理

- H4/H5/H6 会被归一化为 H3
- 跳级标题（如 H2 直接到 H4）不影响树结构，H4 会作为 H3 挂在 H2 下

## 6. 与现有组件的集成

### 6.1 extractSectionContext

- `extractSectionContext` 仍然是主要的上下文提取入口
- 新增 `extractSectionContextFromStructure` 可以基于预构建的 snapshot
- 保留原有逻辑作为 fallback

### 6.2 DocContextEnvelope

- `global.outline` 可以从 `getOutlineFromSnapshot(snapshot)` 获取
- `paragraphRoles` 可用于增强上下文信息

### 6.3 CopilotRuntime

- `resolveEditTarget` 可以使用 `findSectionById` 验证目标
- 段落定位可以参考 `ownParagraphBlockIds`

## 7. 未来扩展

### 7.1 小模型辅助结构判断

当前 v1 是纯启发式算法，未来可以在"灰色区域"引入小模型辅助：

- 判断一段文本是否是标题
- 识别 meta 信息（作者、版权等）
- 处理非标准格式的文档

### 7.2 增量更新

当前实现是全量重建，未来可以支持增量更新：

- 只重新分析修改的 block 及其周围
- 维护 sectionId 稳定性

### 7.3 更丰富的角色语义

可以扩展 ParagraphRole：

- `table` / `figure` / `code_block`
- `abstract` / `conclusion` / `reference`

## 8. 文件清单

```
src/document/structure/
├── DocStructureEngine.ts      # 核心实现
├── index.ts                   # 模块导出
└── __tests__/
    └── DocStructureEngine.test.ts  # 测试（26 cases）

src/runtime/context/
├── extractSectionContext.ts   # 新增 DocStructureEngine 集成
└── index.ts                   # 更新导出

src/document/
└── index.ts                   # 更新导出
```

## 9. 注意事项

1. **性能**：`buildDocStructureFromEditor` 是 O(n) 复杂度，对于大文档建议缓存 snapshot
2. **边界**：DocStructureEngine 不修改 AST，所有写操作仍通过 DocOps
3. **兼容**：原有的 `extractSectionContext` 仍然可用，新实现是可选的增强

---

## 10. DocSkeleton：LLM 友好的结构抽象 (v1.4)

### 10.1 背景

`DocStructureSnapshot` 是内部结构表示，字段多且偏技术向。为让 LLM 更好地理解文档结构，引入 `DocSkeleton` 作为对外层输出。

### 10.2 核心类型

```typescript
// 章节角色（语义化）
type SectionRole = 'chapter' | 'section' | 'subsection' | 'appendix' | 'meta';

// 章节骨架节点（LLM 友好）
interface DocSectionSkeleton {
  id: string;                   // sectionId
  title: string;                // 标题纯文本
  displayIndex?: string;        // "第1章" / "1.1" / "Chapter 1"
  role: SectionRole;            // 语义角色
  level: 1 | 2 | 3;             // 层级
  parentId: string | null;      // 父章节 ID
  children: DocSectionSkeleton[];
  startBlockIndex: number;
  endBlockIndex: number;
  paragraphCount: number;       // 直属段落数
}

// 骨架元信息（预计算统计）
interface DocSkeletonMeta {
  chapterCount: number;         // 章数
  sectionCount: number;         // 节数（含 subsection）
  hasIntro: boolean;            // 有概述/绪论
  hasConclusion: boolean;       // 有结论/总结
  languageHint: 'zh' | 'en' | 'mixed' | 'other';
  totalSections: number;
  totalParagraphs: number;
}

// 文档骨架
interface DocSkeleton {
  sections: DocSectionSkeleton[];
  meta: DocSkeletonMeta;
}
```

### 10.3 使用方式

```typescript
import { buildDocSkeletonFromEditor, findSkeletonSectionById } from '@/document/structure';

// 构建骨架
const skeleton = buildDocSkeletonFromEditor(editor);

// 获取章节统计
console.log(`章数: ${skeleton.meta.chapterCount}`);
console.log(`节数: ${skeleton.meta.sectionCount}`);

// 查找章节
const section = findSkeletonSectionById(skeleton, 'sec-123');
```

### 10.4 与 DocContextEnvelope 集成

```typescript
// DocContextEnvelope 现在始终包含 skeleton
interface DocContextEnvelope {
  // ... 原有字段
  skeleton?: DocSkeleton;  // v1.4 新增
}
```

### 10.5 System Prompt 中的展示

skeleton 会在 System Prompt 中以结构化方式展示：

```
**📊 文档结构统计（skeleton.meta）**：
- 章数（chapter）：5
- 节数（section + subsection）：12
- 总段落数：47
- 有概述/绪论：是
- 有结论/总结：是
- 语言：英文

**📑 文档结构（skeleton）**：
- [sec-1] (章) 第1章 Overview
- [sec-2] (章) 第2章 PRD vs MRD
- [sec-3] (章) 第3章 Ten Steps to Writing a PRD
  - [sec-3-1] (节) Step 1: Do Your Homework
  - [sec-3-2] (节) Step 2: Define the Problem
```

### 10.6 自然语言章节引用解析

基于 skeleton 的 `resolveSectionByUserText` 函数：

| 用户表达 | 匹配方式 |
|----------|----------|
| "第一章" | 索引匹配 |
| "overview 这一章" | 关键字匹配 |
| "PRD vs MRD" | 标题匹配 |
| "上一章" | 相对引用 |
| "最后一章" | 相对引用 |

```typescript
import { resolveSectionByUserText } from '@/copilot/CopilotRuntime';

const result = resolveSectionByUserText({
  userText: '帮我改写第二章',
  skeleton,
  lastSectionId: 'sec-1',
});

if (result.sectionId) {
  console.log(`找到章节: ${result.sectionId}, 方式: ${result.reason}`);
}
```

---

> 相关文档：
> - [docs/docops-developer-guide.md](./docops-developer-guide.md)
> - [docs/copilot-runtime-design.md](./copilot-runtime-design.md)

