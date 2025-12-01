/**
 * SectionDocOps → DocumentRuntime Path Tests
 * 
 * 验证 SectionAI 的 DocOps 通过 DocumentRuntime 正确应用
 * 
 * 【测试范围】
 * 1. convertSectionOpsToDocOps 转换正确性
 * 2. DocumentRuntime.applyDocOps 执行成功
 * 3. AST 更新正确
 * 4. 历史记录可用
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { convertSectionOpsToDocOps } from '../../docops/adapter';
import { DocumentRuntime } from '../../document/DocumentRuntime';
import { documentEngine } from '../../document/DocumentEngine';
import { createEmptyDocument, createParagraph } from '../../document/types';
import type { SectionDocOp } from '../../docops/sectionDocOpsDiff';
import {
  setSectionDocOpsViaDocumentEngine,
  getSectionDocOpsViaDocumentEngine,
} from '../sectionAiActions';

describe('SectionDocOps → DocumentRuntime Path', () => {
  let runtime: DocumentRuntime;

  beforeEach(() => {
    documentEngine.clearHistory();
    
    // 创建测试文档
    const doc = createEmptyDocument();
    doc.blocks = [
      { ...createParagraph('第一段内容'), id: 'para-1' },
      { ...createParagraph('第二段内容'), id: 'para-2' },
      { ...createParagraph('第三段内容'), id: 'para-3' },
    ];
    
    runtime = new DocumentRuntime(doc);
  });

  afterEach(() => {
    // 重置 feature flag
    setSectionDocOpsViaDocumentEngine(false);
  });

  // ==========================================
  // 转换测试
  // ==========================================

  describe('convertSectionOpsToDocOps', () => {
    it('should convert replace_paragraph to ReplaceBlockText', () => {
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-1'],
          targetKey: 'para-1',
          newText: '新的第一段',
          preserveStyle: true,
          index: 0,
        },
      ];

      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');

      expect(docOps.length).toBe(1);
      expect(docOps[0].type).toBe('ReplaceBlockText');
      expect(docOps[0].payload).toEqual({
        nodeId: 'para-1',
        text: '新的第一段',
      });
      expect(docOps[0].meta.source).toBe('ai');
    });

    it('should convert insert_paragraph_after to InsertParagraph', () => {
      const sectionOps: SectionDocOp[] = [
        {
          type: 'insert_paragraph_after',
          referencePath: ['doc', 'para-2'],
          referenceKey: 'para-2',
          newText: '新插入的段落',
          index: 2,
        },
      ];

      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');

      expect(docOps.length).toBe(1);
      expect(docOps[0].type).toBe('InsertParagraph');
      expect(docOps[0].payload).toEqual({
        afterNodeId: 'para-2',
        text: '新插入的段落',
      });
    });

    it('should convert delete_paragraph to DeleteNode', () => {
      const sectionOps: SectionDocOp[] = [
        {
          type: 'delete_paragraph',
          targetPath: ['doc', 'para-3'],
          targetKey: 'para-3',
          index: 2,
        },
      ];

      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');

      expect(docOps.length).toBe(1);
      expect(docOps[0].type).toBe('DeleteNode');
      expect(docOps[0].payload).toEqual({
        nodeId: 'para-3',
      });
    });

    it('should convert multiple ops in sequence', () => {
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-1'],
          targetKey: 'para-1',
          newText: '改写后的第一段',
          preserveStyle: true,
          index: 0,
        },
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-2'],
          targetKey: 'para-2',
          newText: '改写后的第二段',
          preserveStyle: true,
          index: 1,
        },
      ];

      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');

      expect(docOps.length).toBe(2);
      expect(docOps[0].type).toBe('ReplaceBlockText');
      expect(docOps[1].type).toBe('ReplaceBlockText');
    });
  });

  // ==========================================
  // DocumentRuntime 应用测试
  // ==========================================

  describe('DocumentRuntime.applyDocOps', () => {
    it('should apply ReplaceBlockText to AST', () => {
      const docOps = convertSectionOpsToDocOps([
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-1'],
          targetKey: 'para-1',
          newText: '新的第一段',
          preserveStyle: true,
          index: 0,
        },
      ], 'ai');

      const success = runtime.applyDocOps(docOps);

      expect(success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      const firstBlock = snapshot.ast.blocks[0];
      expect(firstBlock.children[0]).toHaveProperty('text', '新的第一段');
    });

    it('should apply InsertParagraph to AST', () => {
      const docOps = convertSectionOpsToDocOps([
        {
          type: 'insert_paragraph_after',
          referencePath: ['doc', 'para-2'],
          referenceKey: 'para-2',
          newText: '新插入的段落',
          index: 2,
        },
      ], 'ai');

      const initialCount = runtime.getSnapshot().ast.blocks.length;
      const success = runtime.applyDocOps(docOps);

      expect(success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks.length).toBe(initialCount + 1);
      
      // 新段落应该在 para-2 之后
      const insertedBlock = snapshot.ast.blocks[2]; // index 2 是 para-2 之后
      expect(insertedBlock.children[0]).toHaveProperty('text', '新插入的段落');
    });

    it('should apply DeleteNode to AST', () => {
      const docOps = convertSectionOpsToDocOps([
        {
          type: 'delete_paragraph',
          targetPath: ['doc', 'para-3'],
          targetKey: 'para-3',
          index: 2,
        },
      ], 'ai');

      const initialCount = runtime.getSnapshot().ast.blocks.length;
      const success = runtime.applyDocOps(docOps);

      expect(success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks.length).toBe(initialCount - 1);
      
      // para-3 应该被删除
      const ids = snapshot.ast.blocks.map(b => b.id);
      expect(ids).not.toContain('para-3');
    });

    it('should record history for undo', () => {
      const docOps = convertSectionOpsToDocOps([
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-1'],
          targetKey: 'para-1',
          newText: '改写后的内容',
          preserveStyle: true,
          index: 0,
        },
      ], 'ai');

      runtime.applyDocOps(docOps);

      const snapshot = runtime.getSnapshot();
      expect(snapshot.canUndo).toBe(true);
    });

    it('should support undo after applyDocOps', () => {
      const originalText = runtime.getSnapshot().ast.blocks[0].children[0];
      
      const docOps = convertSectionOpsToDocOps([
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-1'],
          targetKey: 'para-1',
          newText: '改写后的内容',
          preserveStyle: true,
          index: 0,
        },
      ], 'ai');

      runtime.applyDocOps(docOps);
      
      // 验证修改已应用
      let snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', '改写后的内容');
      
      // Undo
      runtime.undo();
      
      // 验证恢复原状
      snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', '第一段内容');
    });
  });

  // ==========================================
  // Feature Flag 测试
  // ==========================================

  describe('Feature Flag Control', () => {
    it('should allow toggling useSectionDocOpsViaDocumentEngine', () => {
      expect(getSectionDocOpsViaDocumentEngine()).toBe(false);
      
      setSectionDocOpsViaDocumentEngine(true);
      expect(getSectionDocOpsViaDocumentEngine()).toBe(true);
      
      setSectionDocOpsViaDocumentEngine(false);
      expect(getSectionDocOpsViaDocumentEngine()).toBe(false);
    });
  });

  // ==========================================
  // 集成测试：模拟 SectionAI 改写流程
  // ==========================================

  describe('Integration: Simulated SectionAI Rewrite', () => {
    it('should successfully apply a typical rewrite operation', () => {
      // 模拟 SectionAI 返回的 SectionDocOps
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-1'],
          targetKey: 'para-1',
          newText: '这是 AI 改写后的第一段内容，更加清晰明了。',
          preserveStyle: true,
          index: 0,
        },
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-2'],
          targetKey: 'para-2',
          newText: '这是 AI 改写后的第二段内容，逻辑更加通顺。',
          preserveStyle: true,
          index: 1,
        },
      ];

      // 转换并应用
      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      const success = runtime.applyDocOps(docOps);

      expect(success).toBe(true);
      
      // 验证结果
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', '这是 AI 改写后的第一段内容，更加清晰明了。');
      expect(snapshot.ast.blocks[1].children[0]).toHaveProperty('text', '这是 AI 改写后的第二段内容，逻辑更加通顺。');
      
      // 验证可撤销
      expect(snapshot.canUndo).toBe(true);
    });

    it('should successfully apply a summarize operation (fewer paragraphs)', () => {
      // 模拟 summarize：3 段变 2 段
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-1'],
          targetKey: 'para-1',
          newText: '综合摘要第一段',
          preserveStyle: true,
          index: 0,
        },
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-2'],
          targetKey: 'para-2',
          newText: '综合摘要第二段',
          preserveStyle: true,
          index: 1,
        },
        {
          type: 'delete_paragraph',
          targetPath: ['doc', 'para-3'],
          targetKey: 'para-3',
          index: 2,
        },
      ];

      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      const success = runtime.applyDocOps(docOps);

      expect(success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks.length).toBe(2);
    });

    it('should successfully apply an expand operation (more paragraphs)', () => {
      // 模拟 expand：在 para-2 后插入新段落
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'para-2'],
          targetKey: 'para-2',
          newText: '扩写后的第二段',
          preserveStyle: true,
          index: 1,
        },
        {
          type: 'insert_paragraph_after',
          referencePath: ['doc', 'para-2'],
          referenceKey: 'para-2',
          newText: '这是 AI 扩写新增的段落内容。',
          index: 2,
        },
      ];

      const initialCount = runtime.getSnapshot().ast.blocks.length;
      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      const success = runtime.applyDocOps(docOps);

      expect(success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks.length).toBe(initialCount + 1);
    });
  });
});

