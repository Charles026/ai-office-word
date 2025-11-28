/**
 * DocumentEngine 单元测试
 * 
 * 测试覆盖：
 * - createEmptyDocument 行为
 * - applyOps：InsertParagraph / InsertText / DeleteRange / ToggleBold
 * - 回车拆段（SplitBlock）
 * - Shift+Enter 软换行（InsertLineBreak）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentEngine } from '../DocumentEngine';
import { createOpMeta } from '../../docops/types';
import { getBlockText } from '../types';

describe('DocumentEngine', () => {
  let engine: DocumentEngine;

  beforeEach(() => {
    engine = new DocumentEngine();
  });

  // ==========================================
  // createEmptyDocument
  // ==========================================

  describe('createEmptyDocument', () => {
    it('应该创建一个空文档', () => {
      const doc = engine.createEmptyDocument();
      
      expect(doc.version).toBe(0);
      expect(doc.blocks).toHaveLength(1);
      expect(doc.blocks[0].type).toBe('paragraph');
      expect(doc.metadata.createdAt).toBeDefined();
      expect(doc.metadata.modifiedAt).toBeDefined();
    });

    it('空文档的第一个段落应该没有内容', () => {
      const doc = engine.createEmptyDocument();
      const firstBlock = doc.blocks[0];
      
      if (firstBlock.type === 'paragraph') {
        expect(firstBlock.children).toHaveLength(0);
      }
    });
  });

  // ==========================================
  // InsertParagraph
  // ==========================================

  describe('InsertParagraph', () => {
    it('应该在文档末尾插入新段落', () => {
      const doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      
      const result = engine.applyOps(doc, [{
        type: 'InsertParagraph',
        payload: { afterNodeId: doc.blocks[0].id },
        meta,
      }]);

      expect(result.changed).toBe(true);
      expect(result.nextAst.blocks).toHaveLength(2);
      expect(result.nextAst.version).toBe(1);
    });

    it('应该在指定位置插入带文本的段落', () => {
      const doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      
      const result = engine.applyOps(doc, [{
        type: 'InsertParagraph',
        payload: { 
          afterNodeId: doc.blocks[0].id,
          text: 'Hello World',
        },
        meta,
      }]);

      expect(result.nextAst.blocks).toHaveLength(2);
      const newBlock = result.nextAst.blocks[1];
      expect(getBlockText(newBlock)).toBe('Hello World');
    });

    it('afterNodeId 为 null 时应该在文档开头插入', () => {
      const doc = engine.createEmptyDocument();
      const firstBlockId = doc.blocks[0].id;
      const meta = createOpMeta('user');
      
      const result = engine.applyOps(doc, [{
        type: 'InsertParagraph',
        payload: { 
          afterNodeId: null,
          text: 'First',
        },
        meta,
      }]);

      expect(result.nextAst.blocks).toHaveLength(2);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('First');
      expect(result.nextAst.blocks[1].id).toBe(firstBlockId);
    });
  });

  // ==========================================
  // InsertText
  // ==========================================

  describe('InsertText', () => {
    it('应该在空段落插入文本', () => {
      const doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      
      const result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: {
          nodeId: doc.blocks[0].id,
          offset: 0,
          text: 'Hello',
        },
        meta,
      }]);

      expect(result.changed).toBe(true);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello');
    });

    it('应该在指定偏移位置插入文本', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      
      // 先插入一些文本
      let result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: doc.blocks[0].id, offset: 0, text: 'HelloWorld' },
        meta,
      }]);
      
      // 在中间插入
      result = engine.applyOps(result.nextAst, [{
        type: 'InsertText',
        payload: { nodeId: result.nextAst.blocks[0].id, offset: 5, text: ' ' },
        meta,
      }]);

      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello World');
    });
  });

  // ==========================================
  // DeleteRange
  // ==========================================

  describe('DeleteRange', () => {
    it('应该删除同一 block 内的文本范围', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      // 先插入文本
      let result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]);
      
      // 删除 "World"
      result = engine.applyOps(result.nextAst, [{
        type: 'DeleteRange',
        payload: {
          startNodeId: blockId,
          startOffset: 6,
          endNodeId: blockId,
          endOffset: 11,
        },
        meta,
      }]);

      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello ');
    });

    it('应该处理跨 block 删除', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const firstBlockId = doc.blocks[0].id;
      
      // 插入两个段落
      let result = engine.applyOps(doc, [
        { type: 'InsertText', payload: { nodeId: firstBlockId, offset: 0, text: 'First' }, meta },
      ]);
      
      result = engine.applyOps(result.nextAst, [
        { type: 'InsertParagraph', payload: { afterNodeId: firstBlockId, text: 'Second' }, meta },
      ]);

      const secondBlockId = result.nextAst.blocks[1].id;
      
      // 跨段落删除
      result = engine.applyOps(result.nextAst, [{
        type: 'DeleteRange',
        payload: {
          startNodeId: firstBlockId,
          startOffset: 2,
          endNodeId: secondBlockId,
          endOffset: 3,
        },
        meta,
      }]);

      // 应该合并为一个段落
      expect(result.nextAst.blocks).toHaveLength(1);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('Fiond');
    });
  });

  // ==========================================
  // ToggleBold
  // ==========================================

  describe('ToggleBold', () => {
    it('应该切换段落的粗体状态', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      // 插入文本
      let result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Bold Text' },
        meta,
      }]);
      
      // 切换粗体
      result = engine.applyOps(result.nextAst, [{
        type: 'ToggleBold',
        payload: { nodeId: blockId, startOffset: 0, endOffset: 9 },
        meta,
      }]);

      const block = result.nextAst.blocks[0];
      if (block.type === 'paragraph' && block.children[0].type === 'text') {
        expect(block.children[0].marks.bold).toBe(true);
      }
    });

    it('再次切换应该取消粗体', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      // 插入文本并加粗
      let result = engine.applyOps(doc, [
        { type: 'InsertText', payload: { nodeId: blockId, offset: 0, text: 'Bold' }, meta },
        { type: 'ToggleBold', payload: { nodeId: blockId, startOffset: 0, endOffset: 4 }, meta },
      ]);
      
      // 再次切换
      result = engine.applyOps(result.nextAst, [{
        type: 'ToggleBold',
        payload: { nodeId: blockId, startOffset: 0, endOffset: 4 },
        meta,
      }]);

      const block = result.nextAst.blocks[0];
      if (block.type === 'paragraph' && block.children[0].type === 'text') {
        expect(block.children[0].marks.bold).toBe(false);
      }
    });
  });

  // ==========================================
  // SplitBlock (回车拆段)
  // ==========================================

  describe('SplitBlock', () => {
    it('应该在光标位置拆分段落', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      // 插入文本
      let result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]);
      
      // 在 offset 5 处拆分
      result = engine.applyOps(result.nextAst, [{
        type: 'SplitBlock',
        payload: { nodeId: blockId, offset: 5 },
        meta,
      }]);

      expect(result.nextAst.blocks).toHaveLength(2);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello');
      expect(getBlockText(result.nextAst.blocks[1])).toBe(' World');
    });

    it('在段首拆分应该创建空段落在前', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      let result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello' },
        meta,
      }]);
      
      result = engine.applyOps(result.nextAst, [{
        type: 'SplitBlock',
        payload: { nodeId: blockId, offset: 0 },
        meta,
      }]);

      expect(result.nextAst.blocks).toHaveLength(2);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('');
      expect(getBlockText(result.nextAst.blocks[1])).toBe('Hello');
    });

    it('在段尾拆分应该创建空段落在后', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      let result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello' },
        meta,
      }]);
      
      result = engine.applyOps(result.nextAst, [{
        type: 'SplitBlock',
        payload: { nodeId: blockId, offset: 5 },
        meta,
      }]);

      expect(result.nextAst.blocks).toHaveLength(2);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello');
      expect(getBlockText(result.nextAst.blocks[1])).toBe('');
    });
  });

  // ==========================================
  // InsertLineBreak (Shift+Enter 软换行)
  // ==========================================

  describe('InsertLineBreak', () => {
    it('应该在文本中插入换行符', () => {
      let doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      let result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]);
      
      result = engine.applyOps(result.nextAst, [{
        type: 'InsertLineBreak',
        payload: { nodeId: blockId, offset: 5 },
        meta,
      }]);

      // 仍然是一个 block，但包含换行
      expect(result.nextAst.blocks).toHaveLength(1);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello\n World');
    });
  });

  // ==========================================
  // Undo / Redo
  // ==========================================

  describe('Undo / Redo', () => {
    it('应该能撤销操作', () => {
      const doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      
      const result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: doc.blocks[0].id, offset: 0, text: 'Hello' },
        meta,
      }]);

      expect(engine.canUndo()).toBe(true);
      
      const undone = engine.undo(result.nextAst);
      expect(undone).not.toBeNull();
      expect(getBlockText(undone!.blocks[0])).toBe('');
    });

    it('应该能重做操作', () => {
      const doc = engine.createEmptyDocument();
      const meta = createOpMeta('user');
      
      const result = engine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: doc.blocks[0].id, offset: 0, text: 'Hello' },
        meta,
      }]);

      const undone = engine.undo(result.nextAst);
      expect(engine.canRedo()).toBe(true);
      
      const redone = engine.redo(undone!);
      expect(redone).not.toBeNull();
      expect(getBlockText(redone!.blocks[0])).toBe('Hello');
    });
  });
});

