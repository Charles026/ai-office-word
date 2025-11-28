/**
 * Selection 工具函数单元测试
 * 
 * 测试覆盖：
 * - snapshotSelection：正常选区、反向选区、跨 block 选区
 * - 边界情况：非法 offset 的防御行为
 */

import { describe, it, expect } from 'vitest';
import {
  snapshotSelection,
  isCollapsedSelection,
  isCrossBlockSelection,
  normalizeSelection,
  createCollapsedSelection,
  createRangeSelection,
  isValidRangeSelection,
} from '../selection';
import { DocumentEngine } from '../DocumentEngine';
import { createOpMeta } from '../../docops/types';

describe('Selection 工具函数', () => {
  const documentEngine = new DocumentEngine();

  // ==========================================
  // isCollapsedSelection
  // ==========================================

  describe('isCollapsedSelection', () => {
    it('anchor 和 focus 相同时应返回 true', () => {
      const sel = createCollapsedSelection('block1', 5);
      expect(isCollapsedSelection(sel)).toBe(true);
    });

    it('anchor 和 focus 不同时应返回 false', () => {
      const sel = createRangeSelection('block1', 0, 'block1', 5);
      expect(isCollapsedSelection(sel)).toBe(false);
    });
  });

  // ==========================================
  // isCrossBlockSelection
  // ==========================================

  describe('isCrossBlockSelection', () => {
    it('同一 block 内选区应返回 false', () => {
      const sel = createRangeSelection('block1', 0, 'block1', 5);
      expect(isCrossBlockSelection(sel)).toBe(false);
    });

    it('跨 block 选区应返回 true', () => {
      const sel = createRangeSelection('block1', 0, 'block2', 5);
      expect(isCrossBlockSelection(sel)).toBe(true);
    });
  });

  // ==========================================
  // snapshotSelection
  // ==========================================

  describe('snapshotSelection', () => {
    it('应该正确提取同一 block 内的选区文本', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]).nextAst;

      const sel = createRangeSelection(blockId, 0, blockId, 5);
      const snapshot = snapshotSelection(doc, sel);

      expect(snapshot.text).toBe('Hello');
      expect(snapshot.isCollapsed).toBe(false);
      expect(snapshot.isCrossBlock).toBe(false);
    });

    it('反向选区（anchor > focus）应该正确处理', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]).nextAst;

      // 反向选区：anchor 在后面
      const sel = createRangeSelection(blockId, 11, blockId, 6);
      const snapshot = snapshotSelection(doc, sel);

      expect(snapshot.text).toBe('World');
    });

    it('折叠选区应该返回空文本', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello' },
        meta,
      }]).nextAst;

      const sel = createCollapsedSelection(blockId, 3);
      const snapshot = snapshotSelection(doc, sel);

      expect(snapshot.text).toBe('');
      expect(snapshot.isCollapsed).toBe(true);
    });

    it('跨 block 选区应该用换行连接文本', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const firstBlockId = doc.blocks[0].id;
      
      // 创建两个段落
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: firstBlockId, offset: 0, text: 'First' },
        meta,
      }]).nextAst;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertParagraph',
        payload: { afterNodeId: firstBlockId, text: 'Second' },
        meta,
      }]).nextAst;

      const secondBlockId = doc.blocks[1].id;
      const sel = createRangeSelection(firstBlockId, 0, secondBlockId, 6);
      const snapshot = snapshotSelection(doc, sel);

      expect(snapshot.text).toBe('First\nSecond');
      expect(snapshot.isCrossBlock).toBe(true);
    });

    it('非法 blockId 应该返回空文本', () => {
      const doc = documentEngine.createEmptyDocument();
      const sel = createRangeSelection('invalid-id', 0, 'invalid-id', 5);
      const snapshot = snapshotSelection(doc, sel);

      expect(snapshot.text).toBe('');
      expect(snapshot.isCollapsed).toBe(true);
    });

    it('offset 超出范围应该被安全处理', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello' },
        meta,
      }]).nextAst;

      // offset 超出文本长度
      const sel = createRangeSelection(blockId, 0, blockId, 100);
      const snapshot = snapshotSelection(doc, sel);

      // 应该截取到文本末尾
      expect(snapshot.text).toBe('Hello');
    });
  });

  // ==========================================
  // normalizeSelection
  // ==========================================

  describe('normalizeSelection', () => {
    it('正向选区应该保持不变', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello' },
        meta,
      }]).nextAst;

      const sel = createRangeSelection(blockId, 0, blockId, 5);
      const norm = normalizeSelection(doc, sel);

      expect(norm.startOffset).toBe(0);
      expect(norm.endOffset).toBe(5);
    });

    it('反向选区应该被规范化', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello' },
        meta,
      }]).nextAst;

      const sel = createRangeSelection(blockId, 5, blockId, 0);
      const norm = normalizeSelection(doc, sel);

      expect(norm.startOffset).toBe(0);
      expect(norm.endOffset).toBe(5);
    });
  });

  // ==========================================
  // isValidRangeSelection
  // ==========================================

  describe('isValidRangeSelection', () => {
    it('null 应该返回 false', () => {
      expect(isValidRangeSelection(null)).toBe(false);
    });

    it('折叠选区应该返回 false', () => {
      const sel = createCollapsedSelection('block1', 5);
      expect(isValidRangeSelection(sel)).toBe(false);
    });

    it('有效范围选区应该返回 true', () => {
      const sel = createRangeSelection('block1', 0, 'block1', 5);
      expect(isValidRangeSelection(sel)).toBe(true);
    });
  });
});

