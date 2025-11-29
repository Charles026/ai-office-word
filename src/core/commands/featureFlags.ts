/**
 * Feature Flags for Command System Migration
 * 
 * 用于控制命令执行路径的切换：
 * - false: 使用旧路径（LexicalAdapter 直接操作 Lexical）
 * - true: 使用新路径（CommandBus → DocOps → DocumentEngine）
 * 
 * 【迁移策略】
 * 1. 开发模式下逐个开启，验证功能正确性
 * 2. 验证通过后设为默认开启
 * 3. 最终移除旧代码和 feature flag
 */

export interface CommandFeatureFlags {
  /**
   * 使用 CommandBus 处理文本格式命令
   * - toggleBold, toggleItalic, toggleUnderline, toggleStrike
   */
  useCommandBusForFormat: boolean;

  /**
   * 使用 CommandBus 处理块级格式命令
   * - setBlockTypeParagraph, setBlockTypeHeading1/2/3
   */
  useCommandBusForBlockType: boolean;

  /**
   * 使用 CommandBus 处理 undo/redo
   */
  useCommandBusForHistory: boolean;

  /**
   * 使用 CommandBus 处理文本编辑
   * - insertText, deleteRange, splitBlock
   * 
   * 注意：这个开关影响最核心的编辑体验，需要最后开启
   */
  useCommandBusForEdit: boolean;
}

/**
 * 默认 feature flags
 * 
 * 初始状态：全部关闭，使用旧路径
 */
const defaultFlags: CommandFeatureFlags = {
  useCommandBusForFormat: false,
  useCommandBusForBlockType: false,
  useCommandBusForHistory: false,
  useCommandBusForEdit: false,
};

/**
 * 当前 feature flags
 */
let currentFlags: CommandFeatureFlags = { ...defaultFlags };

/**
 * 获取当前 feature flags
 */
export function getCommandFeatureFlags(): CommandFeatureFlags {
  return { ...currentFlags };
}

/**
 * 设置 feature flags
 * 
 * @param flags - 要设置的 flags（部分更新）
 */
export function setCommandFeatureFlags(flags: Partial<CommandFeatureFlags>): void {
  currentFlags = { ...currentFlags, ...flags };
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[FeatureFlags] Updated:', currentFlags);
  }
}

/**
 * 重置为默认值
 */
export function resetCommandFeatureFlags(): void {
  currentFlags = { ...defaultFlags };
}

/**
 * 检查是否应该使用 CommandBus 处理指定命令
 */
export function shouldUseCommandBus(commandId: string): boolean {
  switch (commandId) {
    // 文本格式
    case 'toggleBold':
    case 'toggleItalic':
    case 'toggleUnderline':
    case 'toggleStrikethrough':
      return currentFlags.useCommandBusForFormat;

    // 块级格式
    case 'setBlockTypeParagraph':
    case 'setBlockTypeHeading1':
    case 'setBlockTypeHeading2':
    case 'setBlockTypeHeading3':
      return currentFlags.useCommandBusForBlockType;

    // 历史
    case 'undo':
    case 'redo':
      return currentFlags.useCommandBusForHistory;

    // 编辑
    case 'insertText':
    case 'deleteRange':
    case 'splitBlock':
    case 'insertLineBreak':
      return currentFlags.useCommandBusForEdit;

    // 其他命令暂时使用旧路径
    default:
      return false;
  }
}

// ==========================================
// DEV 模式下暴露到 window 方便调试
// ==========================================

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__commandFeatureFlags = {
    get: getCommandFeatureFlags,
    set: setCommandFeatureFlags,
    reset: resetCommandFeatureFlags,
    shouldUse: shouldUseCommandBus,
  };
}

