/**
 * CommandBus - 统一命令总线
 * 
 * 【职责】
 * - 注册和执行命令
 * - 维护命令状态
 * - 提供命令可用性查询
 * 
 * 【设计原则】
 * - 所有编辑操作都通过此总线执行
 * - 命令只操作 AST 和 SelectionState
 * - 不直接操作 DOM
 * 
 * 【v1 重构】(2025-11)
 * - 新增 DocumentRuntime 集成
 * - 命令执行流程：
 *   1. 从 runtime.getSnapshot() 获取当前 AST + selection
 *   2. 命令 handler 生成 DocOps
 *   3. runtime.applyDocOps(docOps) 更新 AST
 *   4. 返回结果供 UI 同步
 */

import {
  CommandId,
  CommandContext,
  CommandResult,
  CommandState,
  CommandStates,
  CommandHandler,
  CommandRegistry,
  CommandPayloadMap,
} from './types';

import { findBlockById, hasInlineChildren } from '../../document/types';
import { DocSelection, isCollapsedSelection, normalizeSelection } from '../../document/selection';
import { documentEngine } from '../../document/DocumentEngine';
import { DocumentRuntime, documentRuntime as defaultRuntime } from '../../document/DocumentRuntime';
import { createOpMeta, DocOp } from '../../docops/types';

// ==========================================
// CommandBus 实现
// ==========================================

export class CommandBus {
  private registry: CommandRegistry = {};
  private runtime: DocumentRuntime;

  constructor(runtime?: DocumentRuntime) {
    this.runtime = runtime ?? defaultRuntime;
    this.registerDefaultHandlers();
  }

  /**
   * 设置 DocumentRuntime
   * 
   * 用于切换文档时更换 runtime 实例
   */
  setRuntime(runtime: DocumentRuntime): void {
    this.runtime = runtime;
  }

  /**
   * 获取当前 DocumentRuntime
   */
  getRuntime(): DocumentRuntime {
    return this.runtime;
  }

  /**
   * 注册命令处理器
   */
  register<T extends CommandId>(commandId: T, handler: CommandHandler<T>): void {
    this.registry[commandId] = handler as any;
  }

  /**
   * 执行命令（传入上下文版本）
   * 
   * 用于需要精确控制上下文的场景
   */
  execute<T extends CommandId>(
    commandId: T,
    context: CommandContext,
    payload?: CommandPayloadMap[T]
  ): CommandResult {
    const handler = this.registry[commandId];
    
    if (!handler) {
      console.warn(`[CommandBus] Command not implemented: ${commandId}`);
      return {
        success: false,
        nextAst: context.ast,
        nextSelection: context.selection,
        error: `Command "${commandId}" not implemented`,
      };
    }

    try {
      return handler(context, payload as any);
    } catch (error) {
      console.error(`[CommandBus] Command "${commandId}" failed:`, error);
      return {
        success: false,
        nextAst: context.ast,
        nextSelection: context.selection,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 执行命令（使用 DocumentRuntime）
   * 
   * 这是推荐的新入口：
   * 1. 从 runtime.getSnapshot() 获取当前状态
   * 2. 执行命令
   * 3. 如果成功，更新 runtime 状态
   * 
   * @param commandId - 命令 ID
   * @param payload - 命令参数
   * @returns 执行结果
   */
  executeWithRuntime<T extends CommandId>(
    commandId: T,
    payload?: CommandPayloadMap[T]
  ): CommandResult {
    const snapshot = this.runtime.getSnapshot();
    const context: CommandContext = {
      ast: snapshot.ast,
      selection: snapshot.selection,
    };

    // 特殊处理 undo/redo（直接调用 runtime）
    if (commandId === 'undo') {
      const success = this.runtime.undo();
      const newSnapshot = this.runtime.getSnapshot();
      return {
        success,
        nextAst: newSnapshot.ast,
        nextSelection: newSnapshot.selection,
        error: success ? undefined : 'Nothing to undo',
      };
    }

    if (commandId === 'redo') {
      const success = this.runtime.redo();
      const newSnapshot = this.runtime.getSnapshot();
      return {
        success,
        nextAst: newSnapshot.ast,
        nextSelection: newSnapshot.selection,
        error: success ? undefined : 'Nothing to redo',
      };
    }

    // 执行命令
    const result = this.execute(commandId, context, payload);

    // 如果成功且 AST 有变化，同步到 runtime
    if (result.success && result.nextAst !== context.ast) {
      // 更新 runtime 的 AST
      // 注意：历史已经由 documentEngine.applyOps 内部记录了
      // 这里只需要更新 runtime 的 AST 引用
      this.runtime._setAstWithoutHistory(result.nextAst);
    }

    // 更新选区
    if (result.nextSelection) {
      this.runtime.setSelection(result.nextSelection);
    }

    return result;
  }

  /**
   * 获取命令状态
   */
  getCommandState(commandId: CommandId, context: CommandContext): CommandState {
    const { selection } = context;

    switch (commandId) {
      // 文本格式命令
      case 'toggleBold':
      case 'toggleItalic':
      case 'toggleUnderline':
      case 'toggleStrike':
        return this.getFormatCommandState(commandId, context);

      // 块级格式命令
      case 'setBlockTypeParagraph':
      case 'setBlockTypeHeading1':
      case 'setBlockTypeHeading2':
      case 'setBlockTypeHeading3':
        return this.getBlockTypeState(commandId, context);

      // 对齐命令（暂时都启用）
      case 'alignLeft':
      case 'alignCenter':
      case 'alignRight':
      case 'alignJustify':
        return { enabled: !!selection, active: false };

      // 列表命令
      case 'toggleBulletList':
      case 'toggleNumberList':
        return { enabled: !!selection, active: false };

      // 历史命令
      case 'undo':
        return { enabled: documentEngine.canUndo(), active: false };
      case 'redo':
        return { enabled: documentEngine.canRedo(), active: false };

      // 编辑命令
      case 'insertText':
      case 'splitBlock':
      case 'insertLineBreak':
        return { enabled: !!selection, active: false };
      case 'deleteRange':
        return { enabled: selection ? !isCollapsedSelection(selection) : false, active: false };
      case 'replaceRange':
      case 'aiRewrite':
        return { enabled: selection ? !isCollapsedSelection(selection) : false, active: false };

      // 剪贴板
      case 'cut':
      case 'copy':
        return { enabled: selection ? !isCollapsedSelection(selection) : false, active: false };
      case 'paste':
        return { enabled: !!selection, active: false };

      default:
        return { enabled: false, active: false };
    }
  }

  /**
   * 获取所有命令的状态
   */
  getAllCommandStates(context: CommandContext): CommandStates {
    const commands: CommandId[] = [
      'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike',
      'setBlockTypeParagraph', 'setBlockTypeHeading1', 'setBlockTypeHeading2', 'setBlockTypeHeading3',
      'toggleBulletList', 'toggleNumberList',
      'alignLeft', 'alignCenter', 'alignRight',
      'undo', 'redo',
      'cut', 'copy', 'paste',
      'aiRewrite',
    ];

    const states: CommandStates = {};
    for (const cmd of commands) {
      states[cmd] = this.getCommandState(cmd, context);
    }
    return states;
  }

  // ==========================================
  // 内部方法：状态计算
  // ==========================================

  private getFormatCommandState(commandId: CommandId, context: CommandContext): CommandState {
    const { ast, selection } = context;
    
    if (!selection) {
      return { enabled: false, active: false };
    }

    // 获取当前 block
    const block = findBlockById(ast, selection.focus.blockId);
    if (!block || !hasInlineChildren(block)) {
      return { enabled: false, active: false };
    }

    // 检查当前 mark 状态
    const firstChild = block.children[0];
    let active = false;
    
    if (firstChild?.type === 'text') {
      switch (commandId) {
        case 'toggleBold':
          active = !!firstChild.marks?.bold;
          break;
        case 'toggleItalic':
          active = !!firstChild.marks?.italic;
          break;
        case 'toggleUnderline':
          active = !!firstChild.marks?.underline;
          break;
        case 'toggleStrike':
          active = !!firstChild.marks?.strikethrough;
          break;
      }
    }

    return { enabled: true, active };
  }

  private getBlockTypeState(commandId: CommandId, context: CommandContext): CommandState {
    const { ast, selection } = context;
    
    if (!selection) {
      return { enabled: false, active: false };
    }

    const block = findBlockById(ast, selection.focus.blockId);
    if (!block) {
      return { enabled: false, active: false };
    }

    let active = false;

    switch (commandId) {
      case 'setBlockTypeParagraph':
        active = block.type === 'paragraph';
        break;
      case 'setBlockTypeHeading1':
        active = block.type === 'heading' && block.level === 1;
        break;
      case 'setBlockTypeHeading2':
        active = block.type === 'heading' && block.level === 2;
        break;
      case 'setBlockTypeHeading3':
        active = block.type === 'heading' && block.level === 3;
        break;
    }

    return { enabled: true, active };
  }

  // ==========================================
  // 注册默认命令处理器
  // ==========================================

  private registerDefaultHandlers(): void {
    // ==========================================
    // 文本格式命令
    // ==========================================

    this.register('toggleBold', (ctx, payload) => {
      return this.applyFormatCommand(ctx, 'ToggleBold', payload?.force);
    });

    this.register('toggleItalic', (ctx, payload) => {
      return this.applyFormatCommand(ctx, 'ToggleItalic', payload?.force);
    });

    this.register('toggleUnderline', (ctx, payload) => {
      return this.applyFormatCommand(ctx, 'ToggleUnderline', payload?.force);
    });

    this.register('toggleStrike', (ctx, payload) => {
      return this.applyFormatCommand(ctx, 'ToggleStrike', payload?.force);
    });

    // ==========================================
    // 块级格式命令
    // ==========================================

    this.register('setBlockTypeParagraph', (ctx) => {
      return this.applySetHeadingLevel(ctx, 0);
    });

    this.register('setBlockTypeHeading1', (ctx) => {
      return this.applySetHeadingLevel(ctx, 1);
    });

    this.register('setBlockTypeHeading2', (ctx) => {
      return this.applySetHeadingLevel(ctx, 2);
    });

    this.register('setBlockTypeHeading3', (ctx) => {
      return this.applySetHeadingLevel(ctx, 3);
    });

    // ==========================================
    // 历史命令
    // ==========================================

    this.register('undo', (ctx) => {
      const prevAst = documentEngine.undo(ctx.ast);
      if (prevAst) {
        return {
          success: true,
          nextAst: prevAst,
          nextSelection: ctx.selection,
        };
      }
      return {
        success: false,
        nextAst: ctx.ast,
        nextSelection: ctx.selection,
        error: 'Nothing to undo',
      };
    });

    this.register('redo', (ctx) => {
      const nextAst = documentEngine.redo(ctx.ast);
      if (nextAst) {
        return {
          success: true,
          nextAst: nextAst,
          nextSelection: ctx.selection,
        };
      }
      return {
        success: false,
        nextAst: ctx.ast,
        nextSelection: ctx.selection,
        error: 'Nothing to redo',
      };
    });

    // ==========================================
    // 编辑命令
    // ==========================================

    this.register('insertText', (ctx, payload) => {
      if (!ctx.selection || !payload?.text) {
        return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'No selection or text' };
      }

      const ops: DocOp[] = [{
        type: 'InsertText',
        payload: {
          nodeId: ctx.selection.focus.blockId,
          offset: ctx.selection.focus.offset,
          text: payload.text,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(ctx.ast, ops);
      
      // 更新选区位置
      const newSelection: DocSelection = {
        anchor: {
          blockId: ctx.selection.focus.blockId,
          offset: ctx.selection.focus.offset + payload.text.length,
        },
        focus: {
          blockId: ctx.selection.focus.blockId,
          offset: ctx.selection.focus.offset + payload.text.length,
        },
      };

      return {
        success: result.changed,
        nextAst: result.nextAst,
        nextSelection: newSelection,
      };
    });

    this.register('deleteRange', (ctx) => {
      if (!ctx.selection || isCollapsedSelection(ctx.selection)) {
        return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'No selection' };
      }

      const { startBlockId, startOffset, endBlockId, endOffset } = normalizeSelection(ctx.ast, ctx.selection);

      const ops: DocOp[] = [{
        type: 'DeleteRange',
        payload: {
          startNodeId: startBlockId,
          startOffset,
          endNodeId: endBlockId,
          endOffset,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(ctx.ast, ops);
      
      // 选区折叠到删除起点
      const newSelection: DocSelection = {
        anchor: { blockId: startBlockId, offset: startOffset },
        focus: { blockId: startBlockId, offset: startOffset },
      };

      return {
        success: result.changed,
        nextAst: result.nextAst,
        nextSelection: newSelection,
      };
    });

    this.register('replaceRange', (ctx, payload) => {
      if (!ctx.selection || isCollapsedSelection(ctx.selection) || !payload?.newText) {
        return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'Invalid parameters' };
      }

      const { startBlockId, startOffset, endBlockId, endOffset } = normalizeSelection(ctx.ast, ctx.selection);

      // 删除 + 插入
      const ops: DocOp[] = [
        {
          type: 'DeleteRange',
          payload: {
            startNodeId: startBlockId,
            startOffset,
            endNodeId: endBlockId,
            endOffset,
          },
          meta: createOpMeta('user'),
        },
        {
          type: 'InsertText',
          payload: {
            nodeId: startBlockId,
            offset: startOffset,
            text: payload.newText,
          },
          meta: createOpMeta('user'),
        },
      ];

      const result = documentEngine.applyOps(ctx.ast, ops);
      
      // 选区移动到新文本末尾
      const newSelection: DocSelection = {
        anchor: { blockId: startBlockId, offset: startOffset + payload.newText.length },
        focus: { blockId: startBlockId, offset: startOffset + payload.newText.length },
      };

      return {
        success: result.changed,
        nextAst: result.nextAst,
        nextSelection: newSelection,
      };
    });

    this.register('splitBlock', (ctx) => {
      if (!ctx.selection) {
        return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'No selection' };
      }

      const ops: DocOp[] = [{
        type: 'SplitBlock',
        payload: {
          nodeId: ctx.selection.focus.blockId,
          offset: ctx.selection.focus.offset,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(ctx.ast, ops);
      
      // 选区移动到新 block 开头
      // 需要找到新创建的 block
      const blockIndex = result.nextAst.blocks.findIndex(b => b.id === ctx.selection!.focus.blockId);
      const newBlock = result.nextAst.blocks[blockIndex + 1];
      
      const newSelection: DocSelection = newBlock ? {
        anchor: { blockId: newBlock.id, offset: 0 },
        focus: { blockId: newBlock.id, offset: 0 },
      } : ctx.selection;

      return {
        success: result.changed,
        nextAst: result.nextAst,
        nextSelection: newSelection,
      };
    });

    this.register('insertLineBreak', (ctx) => {
      if (!ctx.selection) {
        return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'No selection' };
      }

      const ops: DocOp[] = [{
        type: 'InsertLineBreak',
        payload: {
          nodeId: ctx.selection.focus.blockId,
          offset: ctx.selection.focus.offset,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(ctx.ast, ops);
      
      // 选区移动到换行符后
      const newSelection: DocSelection = {
        anchor: { blockId: ctx.selection.focus.blockId, offset: ctx.selection.focus.offset + 1 },
        focus: { blockId: ctx.selection.focus.blockId, offset: ctx.selection.focus.offset + 1 },
      };

      return {
        success: result.changed,
        nextAst: result.nextAst,
        nextSelection: newSelection,
      };
    });

    // ==========================================
    // AI 改写命令
    // ==========================================

    this.register('aiRewrite', (ctx, payload) => {
      // AI 改写本质上就是 replaceRange
      return this.execute('replaceRange', ctx, { newText: payload?.newText ?? '' });
    });

    // ==========================================
    // 暂未实现的命令
    // ==========================================

    const notImplemented = (name: string) => (ctx: CommandContext) => ({
      success: false,
      nextAst: ctx.ast,
      nextSelection: ctx.selection,
      error: `Command "${name}" not yet implemented`,
    });

    this.register('toggleBulletList', notImplemented('toggleBulletList'));
    this.register('toggleNumberList', notImplemented('toggleNumberList'));
    this.register('alignLeft', notImplemented('alignLeft'));
    this.register('alignCenter', notImplemented('alignCenter'));
    this.register('alignRight', notImplemented('alignRight'));
    this.register('alignJustify', notImplemented('alignJustify'));
    this.register('cut', notImplemented('cut'));
    this.register('copy', notImplemented('copy'));
    this.register('paste', notImplemented('paste'));
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  private applyFormatCommand(
    ctx: CommandContext,
    opType: 'ToggleBold' | 'ToggleItalic' | 'ToggleUnderline' | 'ToggleStrike',
    force?: boolean
  ): CommandResult {
    if (!ctx.selection) {
      return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'No selection' };
    }

    const { startBlockId, startOffset, endBlockId, endOffset } = normalizeSelection(ctx.ast, ctx.selection);

    // 只支持同一 block 内的格式化
    if (startBlockId !== endBlockId) {
      return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'Cross-block formatting not supported' };
    }

    const ops: DocOp[] = [{
      type: opType,
      payload: {
        nodeId: startBlockId,
        startOffset,
        endOffset,
        force,
      },
      meta: createOpMeta('user'),
    }];

    const result = documentEngine.applyOps(ctx.ast, ops);

    return {
      success: result.changed,
      nextAst: result.nextAst,
      nextSelection: ctx.selection,
    };
  }

  private applySetHeadingLevel(ctx: CommandContext, level: 0 | 1 | 2 | 3): CommandResult {
    if (!ctx.selection) {
      return { success: false, nextAst: ctx.ast, nextSelection: ctx.selection, error: 'No selection' };
    }

    const ops: DocOp[] = [{
      type: 'SetHeadingLevel',
      payload: {
        nodeId: ctx.selection.focus.blockId,
        level,
      },
      meta: createOpMeta('user'),
    }];

    const result = documentEngine.applyOps(ctx.ast, ops);

    return {
      success: result.changed,
      nextAst: result.nextAst,
      nextSelection: ctx.selection,
    };
  }
}

// 导出单例
export const commandBus = new CommandBus();

