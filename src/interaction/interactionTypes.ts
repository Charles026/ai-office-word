/**
 * Interaction Context 类型定义
 * 
 * 【设计思路】
 * 定义"对 AI 有意义的用户事件类型"，而不是所有 UI 小动作。
 * 这些事件会被记录下来，生成行为摘要，帮助 AI 理解用户最近在做什么。
 * 
 * 【核心概念】
 * - InteractionEvent: 单个用户交互事件
 * - InteractionKind: 事件类型枚举
 * - 每个事件都带有 docId + 可选的 sectionId + timestamp
 */

// ==========================================
// 事件类型枚举
// ==========================================

/**
 * 交互事件类型
 * 
 * 只定义高价值事件，不记录所有 UI 小动作
 * 
 * v2 扩展：增加标记重点、格式操作等事件类型
 */
export type InteractionKind =
  // ==========================================
  // Section 焦点变化
  // ==========================================
  | 'section.focus_changed'
  // Section 标题重命名
  | 'section.renamed'

  // ==========================================
  // AI 操作相关
  // ==========================================
  // AI 重写操作成功应用
  | 'ai.section_rewrite.applied'
  // AI 重写操作被撤销
  | 'ai.section_rewrite.undone'
  // AI 选区改写成功应用
  | 'ai.selection_rewrite.applied'
  // AI 总结操作成功应用
  | 'ai.section_summary.applied'
  // AI 复合操作成功应用
  | 'ai.section_complex.applied'
  // 🆕 AI 标记关键句
  | 'ai.key_sentences.marked'
  // 🆕 AI 标记关键词语/短语
  | 'ai.key_terms.marked'

  // ==========================================
  // 用户编辑相关
  // ==========================================
  // 🆕 用户手动为选区应用格式（加粗、倾斜、高亮等）
  | 'user.inline_format.applied'
  // 🆕 用户手动撤销（包括撤销 AI 操作或普通操作）
  | 'user.undo'
  // 🆕 用户更改标题级别
  | 'user.heading_changed'

  // ==========================================
  // 文档系统相关
  // ==========================================
  // 文档保存
  | 'doc.saved'
  // 版本快照创建
  | 'doc.version_snapshot_created'
  // 🆕 系统创建快照
  | 'system.snapshot.created';

// ==========================================
// 事件元信息类型
// ==========================================

/**
 * Section 焦点变化的元信息
 */
export interface SectionFocusChangedMeta {
  /** 之前的 sectionId */
  fromSectionId?: string | null;
  /** 之前的 section 标题 */
  fromSectionTitle?: string | null;
  /** 当前的 section 标题 */
  toSectionTitle?: string | null;
}

/**
 * Section 重命名的元信息
 */
export interface SectionRenamedMeta {
  /** 重命名前的标题 */
  titleBefore: string;
  /** 重命名后的标题 */
  titleAfter: string;
}

/**
 * AI 重写操作的元信息
 */
export interface AiRewriteMeta {
  /** AI 操作类型 */
  actionKind: 'rewrite_intro' | 'rewrite_chapter' | 'rewrite_with_highlight';
  /** 语气选项 */
  tone?: 'formal' | 'casual' | 'neutral';
  /** 长度选项 */
  length?: 'keep' | 'shorter' | 'longer';
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * AI 总结操作的元信息
 */
export interface AiSummaryMeta {
  /** 章节标题 */
  sectionTitle?: string;
  /** 生成的 bullet 数量 */
  bulletCount?: number;
}

/**
 * AI 复合操作的元信息
 */
export interface AiComplexMeta {
  /** 操作类型 */
  actionKind: string;
  /** 包含的步骤 */
  steps?: string[];
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * 撤销操作的元信息
 */
export interface UndoMeta {
  /** 被撤销的操作类型 */
  originalActionKind: string;
  /** 撤销原因 */
  reason?: string;
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * 文档保存的元信息
 */
export interface DocSavedMeta {
  /** 保存类型 */
  saveType: 'manual' | 'auto';
}

/**
 * 版本快照的元信息
 */
export interface VersionSnapshotMeta {
  /** 快照 ID */
  snapshotId: string;
  /** 快照描述 */
  description?: string;
}

// ==========================================
// v2 新增 Meta 类型
// ==========================================

/**
 * AI 标记关键句的元信息
 */
export interface AiKeySentencesMarkedMeta {
  /** 标记的句子数量 */
  sentenceCount: number;
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * AI 标记关键词语的元信息
 */
export interface AiKeyTermsMarkedMeta {
  /** 标记的词语数量 */
  termCount: number;
  /** 平均词语长度（字符数） */
  avgTermLength?: number;
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * 用户手动格式操作的元信息
 */
export interface UserInlineFormatMeta {
  /** 格式类型 */
  format: 'bold' | 'italic' | 'underline' | 'highlight' | 'strikethrough';
  /** 格式化的字符数 */
  charLength: number;
  /** 格式化的词数（按空格分割） */
  wordCount?: number;
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * 用户撤销操作的元信息（通用）
 */
export interface UserUndoMeta {
  /** 被撤销的操作类型（如果已知） */
  targetKind?: string;
  /** 章节 ID */
  sectionId?: string;
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * 用户更改标题级别的元信息
 */
export interface UserHeadingChangedMeta {
  /** 之前的级别 */
  levelBefore: number;
  /** 之后的级别 */
  levelAfter: number;
  /** 章节标题 */
  sectionTitle?: string;
}

/**
 * 系统快照创建的元信息
 */
export interface SystemSnapshotMeta {
  /** 快照 ID */
  snapshotId: string;
  /** 触发原因 */
  reason?: 'before_ai_action' | 'manual' | 'auto_backup';
  /** 关联的 AI 操作类型 */
  relatedActionKind?: string;
}

/**
 * 事件元信息联合类型
 */
export type InteractionMeta =
  | SectionFocusChangedMeta
  | SectionRenamedMeta
  | AiRewriteMeta
  | AiSummaryMeta
  | AiComplexMeta
  | UndoMeta
  | DocSavedMeta
  | VersionSnapshotMeta
  // v2 新增
  | AiKeySentencesMarkedMeta
  | AiKeyTermsMarkedMeta
  | UserInlineFormatMeta
  | UserUndoMeta
  | UserHeadingChangedMeta
  | SystemSnapshotMeta
  | Record<string, unknown>;

// ==========================================
// 核心事件类型
// ==========================================

/**
 * 交互事件
 * 
 * 每个事件都带有：
 * - id: 唯一标识
 * - kind: 事件类型
 * - timestamp: 发生时间
 * - docId: 作用的文档
 * - sectionId: 作用的章节（可选）
 * - meta: 额外元信息
 */
export interface InteractionEvent {
  /** 事件 ID */
  id: string;
  /** 事件类型 */
  kind: InteractionKind;
  /** 发生时间（时间戳） */
  timestamp: number;
  /** 文档 ID */
  docId: string;
  /** 章节 ID（如果跟某个 section 相关） */
  sectionId?: string | null;
  /** 额外元信息 */
  meta?: InteractionMeta;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 生成事件 ID
 */
export function generateInteractionId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 创建交互事件
 */
export function createInteractionEvent(
  kind: InteractionKind,
  docId: string,
  sectionId?: string | null,
  meta?: InteractionMeta
): InteractionEvent {
  return {
    id: generateInteractionId(),
    kind,
    timestamp: Date.now(),
    docId,
    sectionId,
    meta,
  };
}

/**
 * 事件类型的中文描述
 */
export const INTERACTION_KIND_LABELS: Record<InteractionKind, string> = {
  // Section 相关
  'section.focus_changed': '切换章节焦点',
  'section.renamed': '重命名章节',
  // AI 操作
  'ai.section_rewrite.applied': 'AI 重写已应用',
  'ai.section_rewrite.undone': 'AI 重写已撤销',
  'ai.selection_rewrite.applied': 'AI 选区改写已应用',
  'ai.section_summary.applied': 'AI 总结已应用',
  'ai.section_complex.applied': 'AI 复合操作已应用',
  'ai.key_sentences.marked': 'AI 标记关键句',
  'ai.key_terms.marked': 'AI 标记关键词语',
  // 用户操作
  'user.inline_format.applied': '用户格式化文本',
  'user.undo': '用户撤销操作',
  'user.heading_changed': '用户更改标题级别',
  // 文档/系统
  'doc.saved': '文档已保存',
  'doc.version_snapshot_created': '版本快照已创建',
  'system.snapshot.created': '系统快照已创建',
};

/**
 * 检查事件是否为 AI 操作
 */
export function isAiInteraction(kind: InteractionKind): boolean {
  return kind.startsWith('ai.');
}

/**
 * 检查事件是否为 Section 相关
 */
export function isSectionInteraction(kind: InteractionKind): boolean {
  return kind.startsWith('section.') || kind.includes('.section_');
}

