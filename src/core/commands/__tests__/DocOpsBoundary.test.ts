/**
 * DocOps Boundary Tests
 * 
 * 验证当 feature flags 开启时：
 * - inline format 命令只走 CommandBus → DocOps → DocumentEngine
 * - undo/redo 只走 DocumentRuntime 历史栈
 * - 失败时不 fallback 到 Lexical
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  setCommandFeatureFlags,
  resetCommandFeatureFlags,
} from '../featureFlags';
import { CommandBus } from '../CommandBus';
import { DocumentRuntime } from '../../../document/DocumentRuntime';
import { documentEngine } from '../../../document/DocumentEngine';
import { createEmptyDocument, createParagraph } from '../../../document/types';
import { createCollapsedSelection, createRangeSelection } from '../../../document/selection';

describe('DocOps Boundary Enforcement', () => {
  let runtime: DocumentRuntime;
  let commandBus: CommandBus;

  beforeEach(() => {
    resetCommandFeatureFlags();
    documentEngine.clearHistory();
    
    // 创建带有一个段落的文档
    const doc = createEmptyDocument();
    doc.blocks = [
      { ...createParagraph('Hello World'), id: 'block-1' },
    ];
    
    runtime = new DocumentRuntime(doc);
    commandBus = new CommandBus(runtime);
  });

  afterEach(() => {
    resetCommandFeatureFlags();
  });

  // ==========================================
  // Format 命令边界测试
  // ==========================================

  describe('Format Commands via CommandBus', () => {
    beforeEach(() => {
      setCommandFeatureFlags({ useCommandBusForFormat: true });
    });

    it('toggleBold should update AST via DocumentEngine', () => {
      // 设置选区（选中 "Hello"）
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 执行 toggleBold
      const result = commandBus.executeWithRuntime('toggleBold');

      expect(result.success).toBe(true);
      
      // 验证 AST 已更新
      const snapshot = runtime.getSnapshot();
      const block = snapshot.ast.blocks[0];
      expect(block.children.length).toBeGreaterThan(0);
      
      // 第一个 run 应该有 bold mark
      const firstRun = block.children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBe(true);
      }
    });

    it('toggleBold should record history for undo', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 执行 toggleBold
      commandBus.executeWithRuntime('toggleBold');

      // 验证可以 undo
      const snapshot = runtime.getSnapshot();
      expect(snapshot.canUndo).toBe(true);
    });

    it('toggleItalic should update AST via DocumentEngine', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      const result = commandBus.executeWithRuntime('toggleItalic');

      expect(result.success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      const firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.italic).toBe(true);
      }
    });

    it('toggleUnderline should update AST via DocumentEngine', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      const result = commandBus.executeWithRuntime('toggleUnderline');

      expect(result.success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      const firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.underline).toBe(true);
      }
    });

    it('toggleStrike should update AST via DocumentEngine', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      const result = commandBus.executeWithRuntime('toggleStrike');

      expect(result.success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      const firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.strikethrough).toBe(true);
      }
    });

    it('format command with no selection should fail gracefully', () => {
      runtime.setSelection(null);

      const result = commandBus.executeWithRuntime('toggleBold');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No selection');
    });
  });

  // ==========================================
  // History 命令边界测试
  // ==========================================

  describe('History Commands via DocumentRuntime', () => {
    beforeEach(() => {
      setCommandFeatureFlags({ useCommandBusForHistory: true });
    });

    it('undo should use DocumentRuntime history', () => {
      // 先做一个操作
      runtime.setSelection(createCollapsedSelection('block-1', 11));
      commandBus.executeWithRuntime('insertText', { text: '!' });

      // 验证操作成功
      let snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello World!');
      expect(snapshot.canUndo).toBe(true);

      // 执行 undo
      const undoResult = commandBus.executeWithRuntime('undo');
      expect(undoResult.success).toBe(true);

      // 验证恢复原状
      snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello World');
    });

    it('redo should use DocumentRuntime history', () => {
      // 先做一个操作
      runtime.setSelection(createCollapsedSelection('block-1', 11));
      commandBus.executeWithRuntime('insertText', { text: '!' });

      // Undo
      commandBus.executeWithRuntime('undo');

      // Redo
      const redoResult = commandBus.executeWithRuntime('redo');
      expect(redoResult.success).toBe(true);

      // 验证重做成功
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello World!');
    });

    it('undo with no history should return false (no-op)', () => {
      const result = commandBus.executeWithRuntime('undo');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Nothing to undo');
    });

    it('redo with no history should return false (no-op)', () => {
      const result = commandBus.executeWithRuntime('redo');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Nothing to redo');
    });
  });

  // ==========================================
  // 组合测试：Format + History
  // ==========================================

  describe('Format + History Integration', () => {
    beforeEach(() => {
      setCommandFeatureFlags({
        useCommandBusForFormat: true,
        useCommandBusForHistory: true,
      });
    });

    it('should undo format changes', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 应用 bold
      commandBus.executeWithRuntime('toggleBold');

      // 验证 bold 已应用
      let snapshot = runtime.getSnapshot();
      let firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBe(true);
      }

      // Undo
      commandBus.executeWithRuntime('undo');

      // 验证 bold 已撤销
      snapshot = runtime.getSnapshot();
      firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBeFalsy();
      }
    });

    it('should redo format changes', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 应用 bold
      commandBus.executeWithRuntime('toggleBold');

      // Undo
      commandBus.executeWithRuntime('undo');

      // Redo
      commandBus.executeWithRuntime('redo');

      // 验证 bold 已重做
      const snapshot = runtime.getSnapshot();
      const firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBe(true);
      }
    });

    it('should handle multiple format operations and undo them in order', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 应用多个格式
      commandBus.executeWithRuntime('toggleBold');
      commandBus.executeWithRuntime('toggleItalic');

      // 验证两个格式都已应用
      let snapshot = runtime.getSnapshot();
      let firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBe(true);
        expect(firstRun.marks?.italic).toBe(true);
      }

      // Undo 一次（撤销 italic）
      commandBus.executeWithRuntime('undo');
      snapshot = runtime.getSnapshot();
      firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBe(true);
        expect(firstRun.marks?.italic).toBeFalsy();
      }

      // Undo 再一次（撤销 bold）
      commandBus.executeWithRuntime('undo');
      snapshot = runtime.getSnapshot();
      firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBeFalsy();
        expect(firstRun.marks?.italic).toBeFalsy();
      }
    });
  });

  // ==========================================
  // Feature Flag 关闭时的行为
  // ==========================================

  describe('When feature flags are OFF', () => {
    it('format commands should still work via CommandBus when called directly', () => {
      // 注意：这测试的是 CommandBus 本身，不是 LexicalAdapter
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      const result = commandBus.executeWithRuntime('toggleBold');

      // CommandBus 本身总是工作的
      expect(result.success).toBe(true);
    });
  });
});

// ==========================================
// 辅助函数
// ==========================================

/**
 * 创建范围选区
 */
function createRangeSelection(
  anchorBlockId: string,
  anchorOffset: number,
  focusBlockId: string,
  focusOffset: number
) {
  return {
    anchor: { blockId: anchorBlockId, offset: anchorOffset },
    focus: { blockId: focusBlockId, offset: focusOffset },
  };
}

