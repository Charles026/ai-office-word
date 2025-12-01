/**
 * SectionDocOps → DocOps 转换测试（Rewrite 场景）
 * 
 * 【测试目标】
 * 验证 SectionDocOps 到 DocOps 的转换，特别是 Block ID 映射问题
 * 
 * 【问题背景】
 * - SectionDocOps 使用 Lexical nodeKey（如 "12", "paragraph_abc"）
 * - DocumentEngine AST 使用自己生成的 nodeId（如 "node_xxx_abc"）
 * - 当两者不一致时，DocumentEngine.applyOps 会找不到 block，返回 changed: false
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { convertSectionOpsToDocOps } from '../adapter';
import { DocumentRuntime } from '../../document/DocumentRuntime';
import { documentEngine } from '../../document/DocumentEngine';
import { createEmptyDocument, createParagraph, findBlockById } from '../../document/types';
import type { SectionDocOp } from '../sectionDocOpsDiff';
import type { DocOp } from '../types';

describe('SectionDocOps → DocOps Rewrite', () => {
  let runtime: DocumentRuntime;

  beforeEach(() => {
    documentEngine.clearHistory();
  });

  // ==========================================
  // 问题复现：Block ID 不匹配
  // ==========================================

  describe('Block ID Mismatch Issue', () => {
    it('should FAIL when using Lexical nodeKey that does not exist in AST', () => {
      // 创建使用 DocumentEngine 生成的 ID 的文档
      const doc = createEmptyDocument();
      doc.blocks = [
        { ...createParagraph('Requirements 文档描述了需求。'), id: 'node_1_abc' },
        { ...createParagraph('Design 文档描述了设计。'), id: 'node_2_def' },
        { ...createParagraph('Implementation 文档描述了实现。'), id: 'node_3_ghi' },
        { ...createParagraph('Testing 文档描述了测试。'), id: 'node_4_jkl' },
      ];
      
      runtime = new DocumentRuntime(doc);
      
      // 模拟 SectionDocOps 使用 Lexical nodeKey（这是问题所在）
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', '12'], // Lexical nodeKey
          targetKey: '12',           // Lexical nodeKey - 与 AST 中的 ID 不匹配！
          newText: '改写后的 Requirements 内容。',
          preserveStyle: true,
          index: 0,
        },
      ];
      
      // 转换
      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      
      // 验证转换后的 nodeId 仍然是 Lexical nodeKey
      expect(docOps[0].payload).toHaveProperty('nodeId', '12');
      
      // 尝试应用 - 应该失败（返回 false），因为 AST 中没有 id="12" 的 block
      const success = runtime.applyDocOps(docOps);
      
      // 这就是问题：applyDocOps 返回 false，因为找不到 block
      expect(success).toBe(false);
      
      // 验证 findBlockById 确实找不到
      const block = findBlockById(runtime.getSnapshot().ast, '12');
      expect(block).toBeNull();
    });

    it('should SUCCEED when using matching AST block IDs', () => {
      // 创建文档，使用特定的 ID
      const doc = createEmptyDocument();
      doc.blocks = [
        { ...createParagraph('Requirements 文档描述了需求。'), id: 'block-1' },
        { ...createParagraph('Design 文档描述了设计。'), id: 'block-2' },
        { ...createParagraph('Implementation 文档描述了实现。'), id: 'block-3' },
        { ...createParagraph('Testing 文档描述了测试。'), id: 'block-4' },
      ];
      
      runtime = new DocumentRuntime(doc);
      
      // 使用与 AST 匹配的 ID
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'block-1'],
          targetKey: 'block-1',  // 与 AST 中的 ID 匹配！
          newText: '改写后的 Requirements 内容。',
          preserveStyle: true,
          index: 0,
        },
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'block-2'],
          targetKey: 'block-2',
          newText: '改写后的 Design 内容。',
          preserveStyle: true,
          index: 1,
        },
      ];
      
      // 转换并应用
      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      const success = runtime.applyDocOps(docOps);
      
      // 应该成功
      expect(success).toBe(true);
      
      // 验证内容已更新
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', '改写后的 Requirements 内容。');
      expect(snapshot.ast.blocks[1].children[0]).toHaveProperty('text', '改写后的 Design 内容。');
    });
  });

  // ==========================================
  // 最简单的 Rewrite 场景
  // ==========================================

  describe('Minimal Rewrite Scenario (with correct IDs)', () => {
    beforeEach(() => {
      // 构造一个类似 PRD 文档的最小场景
      const doc = createEmptyDocument();
      doc.blocks = [
        { ...createParagraph('Requirements vs. Design 章节导语第一段'), id: 'intro-para-1' },
        { ...createParagraph('这是需求定义的重要性说明。'), id: 'intro-para-2' },
        { ...createParagraph('设计文档应该基于需求文档。'), id: 'intro-para-3' },
        { ...createParagraph('两者需要保持同步更新。'), id: 'intro-para-4' },
      ];
      
      runtime = new DocumentRuntime(doc);
    });

    it('should rewrite all 4 paragraphs successfully', () => {
      // 模拟 AI 返回的改写结果
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'intro-para-1'],
          targetKey: 'intro-para-1',
          newText: '【AI改写】Requirements 与 Design 的关系是软件工程的核心。',
          preserveStyle: true,
          index: 0,
        },
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'intro-para-2'],
          targetKey: 'intro-para-2',
          newText: '【AI改写】需求文档定义了"做什么"，是项目的起点。',
          preserveStyle: true,
          index: 1,
        },
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'intro-para-3'],
          targetKey: 'intro-para-3',
          newText: '【AI改写】设计文档回答"怎么做"，将需求转化为技术方案。',
          preserveStyle: true,
          index: 2,
        },
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'intro-para-4'],
          targetKey: 'intro-para-4',
          newText: '【AI改写】保持两者的一致性是项目成功的关键。',
          preserveStyle: true,
          index: 3,
        },
      ];

      // 1. 转换
      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      
      // 验证转换结果
      expect(docOps.length).toBe(4);
      docOps.forEach((op, i) => {
        expect(op.type).toBe('ReplaceBlockText');
        expect(op.payload).toHaveProperty('nodeId', `intro-para-${i + 1}`);
      });
      
      // 2. 应用
      const success = runtime.applyDocOps(docOps);
      expect(success).toBe(true);
      
      // 3. 验证结果
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', '【AI改写】Requirements 与 Design 的关系是软件工程的核心。');
      expect(snapshot.ast.blocks[1].children[0]).toHaveProperty('text', '【AI改写】需求文档定义了"做什么"，是项目的起点。');
      expect(snapshot.ast.blocks[2].children[0]).toHaveProperty('text', '【AI改写】设计文档回答"怎么做"，将需求转化为技术方案。');
      expect(snapshot.ast.blocks[3].children[0]).toHaveProperty('text', '【AI改写】保持两者的一致性是项目成功的关键。');
      
      // 4. 验证历史记录
      expect(snapshot.canUndo).toBe(true);
    });

    it('should support undo after rewrite', () => {
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'intro-para-1'],
          targetKey: 'intro-para-1',
          newText: '改写后的内容',
          preserveStyle: true,
          index: 0,
        },
      ];

      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      runtime.applyDocOps(docOps);
      
      // Undo
      runtime.undo();
      
      // 验证恢复
      const snapshot = runtime.getSnapshot();
      expect(snapshot.ast.blocks[0].children[0]).toHaveProperty('text', 'Requirements vs. Design 章节导语第一段');
    });
  });

  // ==========================================
  // 诊断辅助函数
  // ==========================================

  describe('Diagnostic Helpers', () => {
    it('should provide clear diagnostics when block is not found', () => {
      const doc = createEmptyDocument();
      doc.blocks = [
        { ...createParagraph('Test'), id: 'real-id-123' },
      ];
      
      runtime = new DocumentRuntime(doc);
      
      // 使用错误的 ID
      const sectionOps: SectionDocOp[] = [
        {
          type: 'replace_paragraph',
          targetPath: ['doc', 'wrong-id'],
          targetKey: 'wrong-id',
          newText: 'New text',
          preserveStyle: true,
          index: 0,
        },
      ];
      
      const docOps = convertSectionOpsToDocOps(sectionOps, 'ai');
      
      // 诊断信息
      const snapshot = runtime.getSnapshot();
      const requestedNodeId = (docOps[0].payload as any).nodeId;
      const availableIds = snapshot.ast.blocks.map(b => b.id);
      const found = availableIds.includes(requestedNodeId);
      
      console.log('[Diagnostic] Requested nodeId:', requestedNodeId);
      console.log('[Diagnostic] Available IDs:', availableIds);
      console.log('[Diagnostic] Found:', found);
      
      expect(found).toBe(false);
      expect(requestedNodeId).toBe('wrong-id');
      expect(availableIds).toContain('real-id-123');
    });
  });
});

// ==========================================
// 解决方案说明
// ==========================================

/**
 * 【问题根因】
 * 
 * 1. SectionDocOps 来自 sectionDocOpsDiff.ts，使用 Lexical 的 nodeKey
 *    - 在 buildSectionDocOpsDiff() 中，targetKey 取自 ParagraphInfo.nodeKey
 *    - ParagraphInfo.nodeKey 是从 Lexical 编辑器中提取的
 * 
 * 2. DocumentEngine AST 使用自己生成的 ID
 *    - createParagraph() 调用 generateNodeId() 生成类似 "node_xxx_abc" 的 ID
 *    - 当从 HTML 导入或创建新文档时，会生成新的 ID
 * 
 * 3. 两者不一致导致 findBlockById 返回 null
 * 
 * 【解决方案】
 * 
 * 方案 A: 在 Reconciler 中维护 Lexical nodeKey ↔ AST block ID 的映射
 *   - 优点：不改变现有 ID 生成逻辑
 *   - 缺点：需要额外维护映射表，增加复杂度
 * 
 * 方案 B: 让 AST 使用 Lexical nodeKey 作为 block ID
 *   - 优点：简单直接，无需映射
 *   - 缺点：AST 的 ID 格式依赖 Lexical
 * 
 * 方案 C: 在 convertSectionOpsToDocOps 时查找真实的 AST block ID
 *   - 优点：保持 AST ID 独立
 *   - 缺点：需要访问当前 AST 进行查找（按索引或内容匹配）
 * 
 * 推荐：方案 B，在 LexicalReconciler 中，当从 Lexical 同步到 AST 时，
 * 使用 Lexical nodeKey 作为 AST block ID。这样 SectionDocOps 的 targetKey
 * 就可以直接用于 DocumentEngine。
 */

