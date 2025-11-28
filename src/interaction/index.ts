/**
 * Interaction Context 模块导出
 * 
 * 【模块职责】
 * - 记录用户对文档的交互事件
 * - 生成行为摘要供 LLM 使用
 * - 帮助 AI 理解"用户最近在做什么"
 */

// 类型定义
export {
  type InteractionKind,
  type InteractionEvent,
  type InteractionMeta,
  type SectionFocusChangedMeta,
  type SectionRenamedMeta,
  type AiRewriteMeta,
  type AiSummaryMeta,
  type AiComplexMeta,
  type UndoMeta,
  type DocSavedMeta,
  type VersionSnapshotMeta,
  // v2 新增 meta 类型
  type AiKeySentencesMarkedMeta,
  type AiKeyTermsMarkedMeta,
  type UserInlineFormatMeta,
  type UserUndoMeta,
  type UserHeadingChangedMeta,
  type SystemSnapshotMeta,
  // 辅助函数
  generateInteractionId,
  createInteractionEvent,
  INTERACTION_KIND_LABELS,
  isAiInteraction,
  isSectionInteraction,
} from './interactionTypes';

// 日志 API
export {
  interactionLog,
  useRecentInteractions,
  // 便捷埋点函数
  logSectionFocusChanged,
  logSectionRenamed,
  logAiRewriteApplied,
  logAiRewriteUndone,
  logAiSummaryApplied,
  logAiComplexApplied,
  logDocSaved,
  logVersionSnapshotCreated,
  // v2 新增便捷函数
  logAiKeySentencesMarked,
  logAiKeyTermsMarked,
  logUserInlineFormat,
  logUserUndo,
  logUserHeadingChanged,
  logSystemSnapshotCreated,
  logAiSelectionRewriteApplied,
} from './interactionLog';

// 行为摘要 v1（保留）
export {
  type BehaviorSummary,
  buildRecentBehaviorSummary,
  buildRecentBehaviorSummaryEN,
} from './behaviorSummary';

// 行为摘要 v2（只提供事实数据，不做偏好推断）
export {
  type BehaviorMetrics,
  type BehaviorEditsInfo,
  type BehaviorFocus,
  type BehaviorContext,
  type BuildBehaviorSummaryV2Params,
  type BuildBehaviorSummaryV2Result,
  buildBehaviorSummaryV2,
} from './behaviorSummaryV2';

