/**
 * Runtime 层导出
 * 
 * 此层负责 AI 交互和意图处理
 */

// 原有类型
export * from './types';
export * from './AiRuntime';

// 日志模块
export * from './logging';

// Context 模块（Section 上下文提取）
export * from './context';

// Intents 模块（Intent Builder）- 使用 intents 中的类型定义
export * from './intents';

// Prompts 模块（Prompt Builder）
export * from './prompts';

// 统一 Runtime
export {
  UnifiedDocAgentRuntime,
  getDocAgentRuntime,
  runRewriteOnSelection,
  runTranslateSelection,
  runSummarizeSelection,
  runSummarizeHeading,
  runTranslateHeading,
  runCustomPrompt,
} from './UnifiedDocAgentRuntime';

