/**
 * 统一 DocAgent Runtime 模块导出
 * 
 * 【使用方式】
 * import { 
 *   getDocAgentRuntime,
 *   runRewriteOnSelection,
 *   runTranslateSelection,
 *   runSummarizeSelection,
 * } from '@/runtime/unified';
 */

// 核心类型
export * from '../agentTypes';

// 日志模块
export * from '../logging';

// Runtime
export {
  UnifiedDocAgentRuntime,
  getDocAgentRuntime,
  runRewriteOnSelection,
  runTranslateSelection,
  runSummarizeSelection,
  runSummarizeHeading,
  runTranslateHeading,
  runCustomPrompt,
} from '../UnifiedDocAgentRuntime';

