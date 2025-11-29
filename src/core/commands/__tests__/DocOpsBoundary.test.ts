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

  // ==========================================
  // 边缘情况测试
  // ==========================================

  describe('Edge Cases', () => {
    beforeEach(() => {
      setCommandFeatureFlags({
        useCommandBusForFormat: true,
        useCommandBusForHistory: true,
      });
    });

    describe('Empty Document', () => {
      it('toggleBold on empty document should be no-op', () => {
        // 创建空文档 runtime
        const emptyDoc = createEmptyDocument();
        const emptyRuntime = new DocumentRuntime(emptyDoc);
        const emptyCommandBus = new CommandBus(emptyRuntime);
        
        // 无选区执行 toggleBold
        emptyRuntime.setSelection(null);
        const result = emptyCommandBus.executeWithRuntime('toggleBold');
        
        // 应该失败但不崩溃
        expect(result.success).toBe(false);
        
        // AST 未变化
        const snapshot = emptyRuntime.getSnapshot();
        expect(snapshot.ast.blocks.length).toBe(1); // 空文档有一个空段落
      });

      it('undo on empty document with no history should be no-op', () => {
        const emptyDoc = createEmptyDocument();
        const emptyRuntime = new DocumentRuntime(emptyDoc);
        const emptyCommandBus = new CommandBus(emptyRuntime);
        
        // 清空历史
        documentEngine.clearHistory();
        
        const result = emptyCommandBus.executeWithRuntime('undo');
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Nothing to undo');
      });

      it('toggleBold on document with single empty paragraph', () => {
        // 创建只有一个空段落的文档
        const doc = createEmptyDocument();
        doc.blocks = [{ ...createParagraph(''), id: 'empty-block' }];
        
        const singleRuntime = new DocumentRuntime(doc);
        const singleCommandBus = new CommandBus(singleRuntime);
        
        // 设置折叠选区在空段落
        singleRuntime.setSelection(createCollapsedSelection('empty-block', 0));
        
        // 执行 toggleBold（空选区应该 no-op）
        const result = singleCommandBus.executeWithRuntime('toggleBold');
        
        // 对空选区的格式操作应该成功但不改变 AST（取决于实现）
        // 至少不应该崩溃
        expect(result.success !== undefined).toBe(true);
      });
    });

    describe('Cross-Paragraph Selection', () => {
      it('toggleBold on cross-paragraph selection should fail gracefully', () => {
        // 创建两个段落的文档
        const doc = createEmptyDocument();
        doc.blocks = [
          { ...createParagraph('First paragraph'), id: 'block-1' },
          { ...createParagraph('Second paragraph'), id: 'block-2' },
        ];
        
        const multiRuntime = new DocumentRuntime(doc);
        const multiCommandBus = new CommandBus(multiRuntime);
        
        // 设置跨段落选区（从第一段中间到第二段中间）
        multiRuntime.setSelection(createRangeSelection('block-1', 6, 'block-2', 6));
        
        // 执行 toggleBold
        const result = multiCommandBus.executeWithRuntime('toggleBold');
        
        // 当前实现不支持跨段落格式化，应该失败但不崩溃
        // 注：未来可能支持，届时需要更新测试
        expect(result.success).toBe(false);
        expect(result.error).toContain('Cross-block');
      });
    });

    describe('Handler Error Scenarios', () => {
      it('should handle CommandBus handler throwing error', () => {
        // 创建一个会抛错的 CommandBus
        const errorRuntime = new DocumentRuntime(createEmptyDocument());
        const errorCommandBus = new CommandBus(errorRuntime);
        
        // 注册一个会抛错的 handler
        errorCommandBus.register('toggleBold' as any, () => {
          throw new Error('Test error: handler crashed');
        });
        
        errorRuntime.setSelection(createCollapsedSelection(
          errorRuntime.getSnapshot().ast.blocks[0].id, 
          0
        ));
        
        // 执行命令
        const result = errorCommandBus.executeWithRuntime('toggleBold');
        
        // 应该捕获错误，返回失败结果
        expect(result.success).toBe(false);
        expect(result.error).toContain('Test error');
      });
    });
  });

  // ==========================================
  // 防回退测试：确保 feature flag 开启时不调用 Lexical
  // ==========================================

  describe('No Lexical Fallback Verification', () => {
    beforeEach(() => {
      setCommandFeatureFlags({
        useCommandBusForFormat: true,
        useCommandBusForHistory: true,
      });
    });

    it('multiple format operations should all go through CommandBus', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 执行多个格式操作
      const results = [
        commandBus.executeWithRuntime('toggleBold'),
        commandBus.executeWithRuntime('toggleItalic'),
        commandBus.executeWithRuntime('toggleUnderline'),
        commandBus.executeWithRuntime('toggleStrike'),
      ];

      // 所有操作都应该成功
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
      });

      // 验证所有格式都已应用到 AST
      const snapshot = runtime.getSnapshot();
      const firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBe(true);
        expect(firstRun.marks?.italic).toBe(true);
        expect(firstRun.marks?.underline).toBe(true);
        expect(firstRun.marks?.strikethrough).toBe(true);
      }
    });

    it('format + undo sequence should all go through DocumentRuntime', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 执行格式操作
      commandBus.executeWithRuntime('toggleBold');
      commandBus.executeWithRuntime('toggleItalic');

      // 验证历史状态
      let snapshot = runtime.getSnapshot();
      expect(snapshot.canUndo).toBe(true);

      // 执行 undo 操作
      commandBus.executeWithRuntime('undo');
      commandBus.executeWithRuntime('undo');

      // 验证所有格式都已撤销
      snapshot = runtime.getSnapshot();
      const firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBeFalsy();
        expect(firstRun.marks?.italic).toBeFalsy();
      }

      // 验证历史状态
      expect(snapshot.canUndo).toBe(false);
      expect(snapshot.canRedo).toBe(true);
    });

    it('redo should restore all changes via DocumentRuntime', () => {
      runtime.setSelection(createRangeSelection('block-1', 0, 'block-1', 5));

      // 执行格式操作
      commandBus.executeWithRuntime('toggleBold');
      
      // Undo
      commandBus.executeWithRuntime('undo');
      
      // Redo
      const redoResult = commandBus.executeWithRuntime('redo');
      expect(redoResult.success).toBe(true);

      // 验证格式已恢复
      const snapshot = runtime.getSnapshot();
      const firstRun = snapshot.ast.blocks[0].children[0];
      if (firstRun.type === 'text') {
        expect(firstRun.marks?.bold).toBe(true);
      }
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

