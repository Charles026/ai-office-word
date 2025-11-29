/**
 * 命令系统导出
 */

export { CommandBus, commandBus } from './CommandBus';

// Feature Flags
export {
  getCommandFeatureFlags,
  setCommandFeatureFlags,
  resetCommandFeatureFlags,
  shouldUseCommandBus,
} from './featureFlags';
export type { CommandFeatureFlags } from './featureFlags';

// Lexical 桥接层
export { reconcileAstToLexical } from './LexicalReconciler';
export {
  lexicalSelectionToDocSelection,
  syncLexicalToRuntime,
  executeCommandViaRuntime,
  blockIdMapper,
  BlockIdMapper,
} from './LexicalBridge';

// 状态提供者
export {
  EditorStateProvider,
  getEditorStateProvider,
  resetEditorStateProvider,
  useUnifiedEditorState,
  useUpdateLexicalState,
} from './EditorStateProvider';
export type { UnifiedEditorState, LexicalStateReport } from './EditorStateProvider';

// 导出值
export { RIBBON_TO_COMMAND } from './types';

// 导出类型
export type {
  CommandId,
  CommandContext,
  CommandResult,
  CommandState,
  CommandStates,
  CommandPayloadMap,
  CommandHandler,
  CommandRegistry,
} from './types';
