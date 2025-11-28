/**
 * CommandBus 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandBus } from '../CommandBus';
import { CommandContext } from '../types';
import { createEmptyDocument, createParagraph } from '../../../document/types';
import { documentEngine } from '../../../document/DocumentEngine';

describe('CommandBus', () => {
  let commandBus: CommandBus;

  beforeEach(() => {
    commandBus = new CommandBus();
    documentEngine.clearHistory();
  });

  // ==========================================
  // 辅助函数
  // ==========================================

  function createTestDocument(text: string = 'Hello World') {
    const doc = createEmptyDocument();
    doc.blocks = [createParagraph(text)];
    return doc;
  }

  function createContextWithSelection(doc: typeof createEmptyDocument extends () => infer R ? R : never, start: number, end: number): CommandContext {
    const blockId = doc.blocks[0].id;
    return {
      ast: doc,
      selection: {
        anchor: { blockId, offset: start },
        focus: { blockId, offset: end },
      },
    };
  }

  // ==========================================
  // toggleBold 测试
  // ==========================================

  describe('toggleBold', () => {
    it('should toggle bold on selection', () => {
      const doc = createTestDocument('Hello World');
      const ctx = createContextWithSelection(doc, 0, 5);

      const result = commandBus.execute('toggleBold', ctx);

      expect(result.success).toBe(true);
      const block = result.nextAst.blocks[0];
      if ('children' in block && block.children[0].type === 'text') {
        expect(block.children[0].marks?.bold).toBe(true);
      }
    });

    it('should toggle bold off when already bold', () => {
      const doc = createTestDocument('Bold Text');
      const block = doc.blocks[0];
      if ('children' in block && block.children[0].type === 'text') {
        block.children[0].marks = { bold: true };
      }
      const ctx = createContextWithSelection(doc, 0, 9);

      const result = commandBus.execute('toggleBold', ctx);

      expect(result.success).toBe(true);
      const resultBlock = result.nextAst.blocks[0];
      if ('children' in resultBlock && resultBlock.children[0].type === 'text') {
        expect(resultBlock.children[0].marks?.bold).toBe(false);
      }
    });

    it('should fail without selection', () => {
      const doc = createTestDocument();
      const ctx: CommandContext = { ast: doc, selection: null };

      const result = commandBus.execute('toggleBold', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ==========================================
  // toggleItalic 测试
  // ==========================================

  describe('toggleItalic', () => {
    it('should toggle italic on selection', () => {
      const doc = createTestDocument('Hello World');
      const ctx = createContextWithSelection(doc, 0, 5);

      const result = commandBus.execute('toggleItalic', ctx);

      expect(result.success).toBe(true);
      const block = result.nextAst.blocks[0];
      if ('children' in block && block.children[0].type === 'text') {
        expect(block.children[0].marks?.italic).toBe(true);
      }
    });
  });

  // ==========================================
  // setBlockType 测试
  // ==========================================

  describe('setBlockType', () => {
    it('should set block to heading 1', () => {
      const doc = createTestDocument('Title');
      const ctx = createContextWithSelection(doc, 0, 5);

      const result = commandBus.execute('setBlockTypeHeading1', ctx);

      expect(result.success).toBe(true);
      expect(result.nextAst.blocks[0].type).toBe('heading');
      if (result.nextAst.blocks[0].type === 'heading') {
        expect(result.nextAst.blocks[0].level).toBe(1);
      }
    });

    it('should set heading back to paragraph', () => {
      const doc = createTestDocument('Title');
      let ctx = createContextWithSelection(doc, 0, 5);
      
      // 先设为 heading
      let result = commandBus.execute('setBlockTypeHeading1', ctx);
      expect(result.nextAst.blocks[0].type).toBe('heading');

      // 再设回 paragraph
      ctx = { ...ctx, ast: result.nextAst };
      result = commandBus.execute('setBlockTypeParagraph', ctx);

      expect(result.success).toBe(true);
      expect(result.nextAst.blocks[0].type).toBe('paragraph');
    });
  });

  // ==========================================
  // replaceRange 测试（AI 改写场景）
  // ==========================================

  describe('replaceRange (AI rewrite)', () => {
    it('should replace selected text with new text', () => {
      const doc = createTestDocument('Hello World');
      const ctx = createContextWithSelection(doc, 0, 5); // 选中 "Hello"

      const result = commandBus.execute('replaceRange', ctx, { newText: '你好' });

      expect(result.success).toBe(true);
      const block = result.nextAst.blocks[0];
      if ('children' in block && block.children[0].type === 'text') {
        expect(block.children[0].text).toBe('你好 World');
      }
    });

    it('should move selection to end of new text after replace', () => {
      const doc = createTestDocument('Hello World');
      const ctx = createContextWithSelection(doc, 0, 5);

      const result = commandBus.execute('replaceRange', ctx, { newText: '你好' });

      expect(result.success).toBe(true);
      expect(result.nextSelection?.focus.offset).toBe(2); // "你好" 长度
    });

    it('should fail with collapsed selection', () => {
      const doc = createTestDocument('Hello World');
      const ctx = createContextWithSelection(doc, 3, 3); // 光标，无选区

      const result = commandBus.execute('replaceRange', ctx, { newText: 'Test' });

      expect(result.success).toBe(false);
    });
  });

  // ==========================================
  // undo/redo 测试
  // ==========================================

  describe('undo/redo', () => {
    it('should undo last operation', () => {
      const doc = createTestDocument('Hello');
      const ctx = createContextWithSelection(doc, 5, 5);

      // 执行一个操作
      const insertResult = commandBus.execute('insertText', ctx, { text: ' World' });
      expect(insertResult.success).toBe(true);

      // 撤销
      const undoCtx: CommandContext = { ast: insertResult.nextAst, selection: insertResult.nextSelection };
      const undoResult = commandBus.execute('undo', undoCtx);

      expect(undoResult.success).toBe(true);
      const block = undoResult.nextAst.blocks[0];
      if ('children' in block && block.children[0].type === 'text') {
        expect(block.children[0].text).toBe('Hello');
      }
    });

    it('should redo after undo', () => {
      const doc = createTestDocument('Hello');
      const ctx = createContextWithSelection(doc, 5, 5);

      // 执行操作
      const insertResult = commandBus.execute('insertText', ctx, { text: ' World' });
      
      // 撤销
      const undoCtx: CommandContext = { ast: insertResult.nextAst, selection: insertResult.nextSelection };
      const undoResult = commandBus.execute('undo', undoCtx);
      
      // 重做
      const redoCtx: CommandContext = { ast: undoResult.nextAst, selection: undoResult.nextSelection };
      const redoResult = commandBus.execute('redo', redoCtx);

      expect(redoResult.success).toBe(true);
      const block = redoResult.nextAst.blocks[0];
      if ('children' in block && block.children[0].type === 'text') {
        expect(block.children[0].text).toBe('Hello World');
      }
    });

    it('should fail undo with empty history', () => {
      documentEngine.clearHistory();
      const doc = createTestDocument('Hello');
      const ctx: CommandContext = { ast: doc, selection: null };

      const result = commandBus.execute('undo', ctx);

      expect(result.success).toBe(false);
    });
  });

  // ==========================================
  // splitBlock 测试
  // ==========================================

  describe('splitBlock', () => {
    it('should split paragraph at cursor position', () => {
      const doc = createTestDocument('Hello World');
      const blockId = doc.blocks[0].id;
      const ctx: CommandContext = {
        ast: doc,
        selection: {
          anchor: { blockId, offset: 5 },
          focus: { blockId, offset: 5 },
        },
      };

      const result = commandBus.execute('splitBlock', ctx);

      expect(result.success).toBe(true);
      expect(result.nextAst.blocks.length).toBe(2);
      
      const block1 = result.nextAst.blocks[0];
      const block2 = result.nextAst.blocks[1];
      
      if ('children' in block1 && block1.children[0].type === 'text') {
        expect(block1.children[0].text).toBe('Hello');
      }
      if ('children' in block2 && block2.children[0].type === 'text') {
        expect(block2.children[0].text).toBe(' World');
      }
    });
  });

  // ==========================================
  // 命令状态测试
  // ==========================================

  describe('getCommandState', () => {
    it('should return enabled=true for format commands with selection', () => {
      const doc = createTestDocument('Hello');
      const ctx = createContextWithSelection(doc, 0, 5);

      const state = commandBus.getCommandState('toggleBold', ctx);

      expect(state.enabled).toBe(true);
      expect(state.active).toBe(false);
    });

    it('should return active=true when text is bold', () => {
      const doc = createTestDocument('Bold');
      const block = doc.blocks[0];
      if ('children' in block && block.children[0].type === 'text') {
        block.children[0].marks = { bold: true };
      }
      const ctx = createContextWithSelection(doc, 0, 4);

      const state = commandBus.getCommandState('toggleBold', ctx);

      expect(state.active).toBe(true);
    });

    it('should return enabled=false without selection', () => {
      const doc = createTestDocument('Hello');
      const ctx: CommandContext = { ast: doc, selection: null };

      const state = commandBus.getCommandState('toggleBold', ctx);

      expect(state.enabled).toBe(false);
    });
  });
});

