/**
 * DocAgent 模块导出
 * 
 * 【模块职责】
 * - 提供复杂意图的结构化表达（Intent → Plan → Steps）
 * - 提供 Plan 构建器和执行器
 * - 提供命令到 Intent 的适配层
 * 
 * 【核心概念】
 * - DocEditIntent：高层业务意图（用户想做什么）
 * - DocEditPlan：可执行计划（按什么步骤实现）
 * - DocEditPlanStep：原子操作步骤（可映射到 DocOps）
 * 
 * 【v2 重构】
 * - Intent 使用「一个主类型 + 多个能力开关」的结构化 schema
 * - Planner 根据开关组合 Plan，不再依赖 kind 字符串
 */

// 类型定义
export {
  // Intent Kind
  type DocEditIntentKind,
  isLegacyIntentKind,
  
  // Intent
  type DocEditIntent,
  type DocEditTarget,
  type NormalizedDocEditIntent,
  
  // Intent 子对象
  type RewriteConfig,
  type HighlightConfig,
  type SummaryConfig,
  
  // 归一化类型
  type NormalizedLengthType,
  type NormalizedRewriteConfig,
  
  // 通用选项
  type ToneType,
  type LengthType,
  type HighlightStyle,
  type SummaryStyle,
  
  // Plan
  type DocEditPlan,
  type PlanSource,
  
  // Steps
  type DocEditPlanStep,
  type RewriteSectionStep,
  type MarkKeySentencesStep,
  type AppendBulletSummaryStep,
  
  // 辅助函数
  generateIntentId,
  isValidPlan,
  getPlanStepTypes,
  createSectionEditIntent,
  INTENT_DEFAULTS,
} from './docEditTypes';

// Plan 构建器
export {
  buildDocEditPlanForIntent,
  normalizeDocEditIntent,
  logPlanSummary,
  getEnabledFeatures,
} from './docEditPlanner';

// Intent 预设（Command → Intent 适配层）
export {
  type IntentPresetName,
  type IntentBuildContext,
  buildDocEditIntentFromCommand,
  getIntentPreset,
  buildCustomIntent,
  isCommandSupportedForIntent,
  getSupportedCommandKeys,
  getPresetNames,
  describePreset,
} from './docEditIntentPresets';

// Runtime
export {
  runDocEditPlan,
  validatePlanForExecution,
  testComplexIntentExecution,
  type DocEditPlanResult,
  type StepResult,
} from './docAgentRuntime';
