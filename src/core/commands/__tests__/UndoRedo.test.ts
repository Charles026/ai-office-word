/**
 * Undo/Redo 通过 DocumentEngine 的测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandBus } from '../CommandBus';
import { DocumentRuntime } from '../../../document/DocumentRuntime';
import { documentEngine } from '../../../document/DocumentEngine';
import { createEmptyDocument, createParagraph } from '../../../document/types';
import { createCollapsedSelection } from '../../../document/selection';
import { setCommandFeatureFlags, resetCommandFeatureFlags } from '../featureFlags';

describe('Undo/Redo via DocumentEngine', () => {
  let runtime: DocumentRuntime;
  let commandBus: CommandBus;

  beforeEach(() => {
    resetCommandFeatureFlags();
    
    // 🔴 清除全局 documentEngine 的历史（重要：测试隔离）
    documentEngine.clearHistory();
    
    // 创建带有一个段落的文档
    const doc = createEmptyDocument();
    doc.blocks = [
      { ...createParagraph('Hello World'), id: 'block-1' },
    ];
    
    runtime = new DocumentRuntime(doc);
    commandBus = new CommandBus(runtime);
  });

  describe('executeWithRuntime', () => {
    it('should record history when executing insertText', () => {
      // 设置选区
      runtime.setSelection(createCollapsedSelection('block-1', 5));

      // 执行 insertText 命令
      const result = commandBus.executeWithRuntime('insertText', { text: ' Beautiful' });

      expect(result.success).toBe(true);
      expect(runtime.getSnapshot().canUndo).toBe(true);
    });

    it('should undo insertText operation', () => {
      // 设置选区
      runtime.setSelection(createCollapsedSelection('block-1', 5));

      // 执行 insertText
      commandBus.executeWithRuntime('insertText', { text: ' Beautiful' });

      // 验证插入成功
      let snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello Beautiful World');

      // 执行 undo
      const undoResult = commandBus.executeWithRuntime('undo');
      expect(undoResult.success).toBe(true);

      // 验证恢复原状
      snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello World');
      expect(snapshot.canUndo).toBe(false);
      expect(snapshot.canRedo).toBe(true);
    });

    it('should redo after undo', () => {
      // 设置选区
      runtime.setSelection(createCollapsedSelection('block-1', 5));

      // 执行 insertText
      commandBus.executeWithRuntime('insertText', { text: ' Beautiful' });

      // Undo
      commandBus.executeWithRuntime('undo');

      // Redo
      const redoResult = commandBus.executeWithRuntime('redo');
      expect(redoResult.success).toBe(true);

      // 验证重做成功
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello Beautiful World');
      expect(snapshot.canUndo).toBe(true);
      expect(snapshot.canRedo).toBe(false);
    });

    it('should return error when nothing to undo', () => {
      const result = commandBus.executeWithRuntime('undo');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Nothing to undo');
    });

    it('should return error when nothing to redo', () => {
      const result = commandBus.executeWithRuntime('redo');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Nothing to redo');
    });

    it('should support multiple undo/redo operations', () => {
      runtime.setSelection(createCollapsedSelection('block-1', 11));

      // 执行多个操作
      commandBus.executeWithRuntime('insertText', { text: '!' });
      commandBus.executeWithRuntime('insertText', { text: '!' });
      commandBus.executeWithRuntime('insertText', { text: '!' });

      let snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello World!!!');

      // Undo 所有操作
      commandBus.executeWithRuntime('undo');
      commandBus.executeWithRuntime('undo');
      commandBus.executeWithRuntime('undo');

      snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello World');

      // Redo 部分操作
      commandBus.executeWithRuntime('redo');
      commandBus.executeWithRuntime('redo');

      snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Hello World!!');
    });
  });

  describe('with feature flags', () => {
    it('should use runtime history when useCommandBusForHistory is true', () => {
      setCommandFeatureFlags({ useCommandBusForHistory: true });

      // 模拟一些操作（通过 runtime 直接操作）
      runtime.setSelection(createCollapsedSelection('block-1', 5));
      commandBus.executeWithRuntime('insertText', { text: ' Test' });

      // 验证 canUndo 来自 runtime
      const snapshot = runtime.getSnapshot();
      expect(snapshot.canUndo).toBe(true);
    });
  });
});

