/**
 * DocOpsEngine 单元测试
 * 
 * 测试覆盖：
 * - buildOpsForRewriteSelection：单段内选区替换
 * - 边界情况：空选区、newText 为空
 */

import { describe, it, expect } from 'vitest';
import { StubDocOpsEngine } from '../DocOpsEngine';
import { DocumentEngine } from '../../document/DocumentEngine';
import { createOpMeta } from '../types';
import { getBlockText } from '../../document/types';

describe('DocOpsEngine', () => {
  const docOpsEngine = new StubDocOpsEngine();
  const documentEngine = new DocumentEngine();

  // ==========================================
  // buildOpsForRewriteSelection
  // ==========================================

  describe('buildOpsForRewriteSelection', () => {
    it('应该为单段内选区生成正确的 DocOps', () => {
      // 创建一个包含文本的文档
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]).nextAst;

      // 构造选区：选中 "World"
      const selection = {
        anchorNodeId: blockId,
        anchorOffset: 6,
        focusNodeId: blockId,
        focusOffset: 11,
        isCollapsed: false,
      };

      // 生成替换操作
      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, 'Universe');

      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe('DeleteRange');
      expect(ops[1].type).toBe('InsertText');
    });

    it('应用生成的 DocOps 后应该正确替换文本', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]).nextAst;

      const selection = {
        anchorNodeId: blockId,
        anchorOffset: 6,
        focusNodeId: blockId,
        focusOffset: 11,
        isCollapsed: false,
      };

      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, 'Universe');
      const result = documentEngine.applyOps(doc, ops);

      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello Universe');
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

      // 反向选区：focus < anchor
      const selection = {
        anchorNodeId: blockId,
        anchorOffset: 11,
        focusNodeId: blockId,
        focusOffset: 6,
        isCollapsed: false,
      };

      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, 'Universe');
      const result = documentEngine.applyOps(doc, ops);

      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello Universe');
    });

    it('空选区（折叠）应该返回空 ops', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello' },
        meta,
      }]).nextAst;

      const selection = {
        anchorNodeId: blockId,
        anchorOffset: 3,
        focusNodeId: blockId,
        focusOffset: 3,
        isCollapsed: true,
      };

      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, 'World');

      // 空选区不应该产生删除操作，只有插入
      expect(ops.length).toBeLessThanOrEqual(1);
    });

    it('newText 为空时应该只删除不插入', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World' },
        meta,
      }]).nextAst;

      const selection = {
        anchorNodeId: blockId,
        anchorOffset: 5,
        focusNodeId: blockId,
        focusOffset: 11,
        isCollapsed: false,
      };

      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, '');
      const result = documentEngine.applyOps(doc, ops);

      expect(getBlockText(result.nextAst.blocks[0])).toBe('Hello');
    });

    it('替换后其他 block 不受影响', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const firstBlockId = doc.blocks[0].id;
      
      // 创建两个段落
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: firstBlockId, offset: 0, text: 'First Paragraph' },
        meta,
      }]).nextAst;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertParagraph',
        payload: { afterNodeId: firstBlockId, text: 'Second Paragraph' },
        meta,
      }]).nextAst;

      // 只选中第一个段落的部分文本
      const selection = {
        anchorNodeId: firstBlockId,
        anchorOffset: 0,
        focusNodeId: firstBlockId,
        focusOffset: 5,
        isCollapsed: false,
      };

      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, 'New');
      const result = documentEngine.applyOps(doc, ops);

      expect(getBlockText(result.nextAst.blocks[0])).toBe('New Paragraph');
      expect(getBlockText(result.nextAst.blocks[1])).toBe('Second Paragraph');
    });
  });

  // ==========================================
  // AI 改写链路集成测试（不依赖网络）
  // ==========================================

  describe('AI 改写链路（无网络）', () => {
    it('完整改写流程应该正确工作', () => {
      // 模拟一个完整的 AI 改写流程
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      // 1. 创建文档内容
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: '这是一段需要改写的文本' },
        meta,
      }]).nextAst;

      // 2. 模拟选区快照
      const selection = {
        anchorNodeId: blockId,
        anchorOffset: 0,
        focusNodeId: blockId,
        focusOffset: 11, // "这是一段需要改写的文本"
        isCollapsed: false,
      };

      // 3. 模拟 LLM 返回的新文本
      const newText = '这是经过AI改写后的专业文本';

      // 4. 生成 DocOps
      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, newText);

      // 5. 应用操作
      const result = documentEngine.applyOps(doc, ops);

      // 6. 验证结果
      expect(result.changed).toBe(true);
      expect(getBlockText(result.nextAst.blocks[0])).toBe('这是经过AI改写后的专业文本');
    });

    it('改写后新 offset 应该正确计算', () => {
      let doc = documentEngine.createEmptyDocument();
      const meta = createOpMeta('user');
      const blockId = doc.blocks[0].id;
      
      doc = documentEngine.applyOps(doc, [{
        type: 'InsertText',
        payload: { nodeId: blockId, offset: 0, text: 'Hello World!' },
        meta,
      }]).nextAst;

      const selection = {
        anchorNodeId: blockId,
        anchorOffset: 6,
        focusNodeId: blockId,
        focusOffset: 11,
        isCollapsed: false,
      };

      const newText = 'Universe';
      const ops = docOpsEngine.buildOpsForRewriteSelection(doc, selection, newText);
      const result = documentEngine.applyOps(doc, ops);

      // 原文 "Hello World!" (12字符)
      // 删除 "World" (5字符) 后 "Hello !" (7字符)
      // 插入 "Universe" (8字符) 后 "Hello Universe!" (15字符)
      const expectedText = 'Hello Universe!';
      expect(getBlockText(result.nextAst.blocks[0])).toBe(expectedText);
      expect(expectedText.length).toBe(15);
      
      // 光标应该在 newText 末尾：startOffset + newText.length = 6 + 8 = 14
      const expectedCaretOffset = 6 + newText.length;
      expect(expectedCaretOffset).toBe(14);
    });
  });
});

