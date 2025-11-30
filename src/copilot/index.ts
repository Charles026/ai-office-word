/**
 * Copilot 模块导出
 */

// 类型
export * from './copilotTypes';

// Store
export { copilotStore, useCopilotStore, useCopilotContext } from './copilotStore';
export type { CopilotState, PendingSectionResult } from './copilotStore';

// 组件
export { CopilotPanel } from './CopilotPanel';
export { CopilotHeader } from './CopilotHeader';
export { CopilotMessageList } from './CopilotMessageList';
export { CopilotInput } from './CopilotInput';

// LLM Client
export { sendCopilotChat } from './copilotLLMClient';
export type { CopilotChatResponse } from './copilotLLMClient';

// Model Caller (统一 LLM 调用入口，使用 DocContextEnvelope)
export { callCopilotModel } from './copilotModelCaller';
export type { CallCopilotModelParams, CallCopilotModelResult } from './copilotModelCaller';

// Debug (开发模式调试工具)
export { copilotDebugStore, useCopilotDebug } from './copilotDebugStore';
export type { CopilotDebugSnapshot, DebugMessage } from './copilotDebugTypes';
export { CopilotInspector } from './CopilotInspector';

// 命令解析
export { resolveCopilotCommand, COMMAND_LABELS } from './copilotCommands';
export type { CopilotCommand, ResolvedCommand } from './copilotCommands';

// Runtime Bridge
export {
  runCopilotCommand,
  setCopilotEditor,
  getCopilotEditor,
  setCopilotToast,
  // v2 新增：Preview / Clarify 用户交互处理
  applyPreviewResult,
  cancelPreviewResult,
  resolveClarification,
} from './copilotRuntimeBridge';

// Context Listener
export {
  initCopilotContextListener,
  destroyCopilotContextListener,
  isCopilotContextListenerInitialized,
} from './copilotContextListener';

// ==========================================
// v3 新增：CopilotRuntime & Intent 协议
// ==========================================

// Runtime 类型
export * from './copilotRuntimeTypes';

// Runtime 实现
export { CopilotRuntime, createCopilotRuntime } from './CopilotRuntime';
export type { CopilotRuntimeDeps, CopilotTurnResult } from './CopilotRuntime';

// Runtime Hook
export { useCopilotRuntime } from './useCopilotRuntime';

// Intent 解析器
export {
  buildCopilotSystemPrompt,
  parseCopilotModelOutput,
  isIntentExecutable,
  describeIntent,
} from './copilotIntentParser';

