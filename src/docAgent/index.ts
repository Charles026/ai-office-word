/**
 * DocAgent 模块导出
 * 
 * 【模块职责】
 * - 提供复杂意图的结构化表达（Intent → Plan → Steps）
 * - 提供 Plan 构建器和执行器
 * - 提供命令到 Intent 的适配层
 * - 🆕 v3: 提供 Macro 执行器（Orchestrator 层）
 * 
 * 【核心概念】
 * - DocEditIntent：高层业务意图（用户想做什么）
 * - DocEditPlan：可执行计划（按什么步骤实现）
 * - DocEditPlanStep：原子操作步骤（可映射到 DocOps）
 * - 🆕 SectionEditMacro：原子步骤组合（由 Orchestrator 展开执行）
 * 
 * 【v3 Orchestrator 重构】
 * - 只保留原子意图，组合逻辑放在 Orchestrator 层
 * - 每个 macro.step 独立调用对应的 SectionAI agent
 * - highlight_section 完全独立于 rewrite_section
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
  // 🆕 v3 Macro 类型和函数
  type SectionEditMacro,
  type AtomicStep,
  type AtomicStepKind,
  type RewriteStepParams,
  type HighlightStepParams,
  getMacroForCommand,
  hasMacro,
  describeMacro,
} from './docEditIntentPresets';

// Runtime
export {
  runDocEditPlan,
  validatePlanForExecution,
  type DocEditPlanResult,
  type StepResult,
  // 🆕 v3 Orchestrator
  runMacroForCommand,
  isMacroCommand,
  type MacroExecutionResult,
  type MacroExecutionContext,
} from './docAgentRuntime';
