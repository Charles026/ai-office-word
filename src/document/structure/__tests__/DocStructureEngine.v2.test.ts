/**
 * DocStructureEngine v2 测试
 * 
 * 测试样式推断、置信度追踪和混乱层级处理
 * 
 * @tag structure-v2
 */

import { describe, it, expect } from 'vitest';
import {
  buildDocStructureFromAst,
  buildDocSkeletonFromSnapshot,
  type DocStructureSnapshot,
  type SectionNode,
} from '../DocStructureEngine';
import type { DocumentAst, BlockNode, HeadingNode, ParagraphNode } from '../../types';
import { createHeading, createParagraph, generateNodeId } from '../../types';

// ==========================================
// 测试工具函数
// ==========================================

function createTestDocument(blocks: BlockNode[]): DocumentAst {
  return {
    version: 1,
    blocks,
    metadata: {
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    },
  };
}

function createTestHeading(level: 1 | 2 | 3 | 4 | 5 | 6, text: string): HeadingNode {
  return createHeading(level, text);
}

function createTestParagraph(text: string): ParagraphNode {
  return createParagraph(text);
}

// ==========================================
// 测试用例
// ==========================================

describe('DocStructureEngine v2', () => {
  describe('基础结构识别', () => {
    it('应该正确识别标准 Heading 结构', () => {
      const ast = createTestDocument([
        createTestHeading(1, '文档标题'),
        createTestParagraph('第一章导言内容'),
        createTestHeading(2, '第一节'),
        createTestParagraph('第一节内容'),
        createTestHeading(2, '第二节'),
        createTestParagraph('第二节内容'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // 应该有 1 个顶级章节
      expect(snapshot.sections.length).toBe(1);
      
      // 第一个章节应该是 H1
      const mainSection = snapshot.sections[0];
      expect(mainSection.level).toBe(1);
      expect(mainSection.titleText).toBe('文档标题');
      
      // 应该有 2 个子章节
      expect(mainSection.children.length).toBe(2);
      
      // v2: 验证 source 和 confidence
      expect(mainSection.source).toBe('heading');
      expect(mainSection.confidence).toBeDefined();
    });

    it('应该在元信息中包含 v2 字段', () => {
      const ast = createTestDocument([
        createTestHeading(1, '文档标题'),
        createTestParagraph('正文内容'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // v2: 验证 meta 包含新字段
      expect(snapshot.meta.engineVersion).toBe('2.0.0');
      expect(snapshot.meta.baseBodyFontSize).toBeDefined();
      expect(snapshot.meta.globalConfidence).toBeDefined();
    });
  });

  describe('v2: 置信度追踪', () => {
    it('纯 Heading 文档应该有 high globalConfidence', () => {
      const ast = createTestDocument([
        createTestHeading(1, '第一章'),
        createTestParagraph('内容'),
        createTestHeading(1, '第二章'),
        createTestParagraph('内容'),
        createTestHeading(1, '第三章'),
        createTestParagraph('内容'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // 所有章节都来自 Heading，全局置信度应该较高
      expect(snapshot.meta.globalConfidence).toBe('high');
      
      // 每个章节的 source 应该是 heading
      for (const section of snapshot.sections) {
        expect(section.source).toBe('heading');
      }
    });

    it('SectionNode 应该包含 headingLevel', () => {
      const ast = createTestDocument([
        createTestHeading(1, 'H1 标题'),
        createTestHeading(2, 'H2 标题'),
        createTestHeading(3, 'H3 标题'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      const h1 = snapshot.sections[0];
      
      expect(h1.headingLevel).toBe(1);
      expect(h1.children[0]?.headingLevel).toBe(2);
    });
  });

  describe('v2: DocSkeleton 构建', () => {
    it('DocSkeleton 应该包含 v2 字段', () => {
      const ast = createTestDocument([
        createTestHeading(1, '第一章'),
        createTestParagraph('内容'),
        createTestHeading(2, '第一节'),
        createTestParagraph('内容'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      
      // meta 应该包含 v2 字段
      expect(skeleton.meta.globalConfidence).toBeDefined();
      expect(skeleton.meta.baseBodyFontSize).toBeDefined();
      
      // sections 应该包含 v2 字段
      expect(skeleton.sections[0].source).toBeDefined();
      expect(skeleton.sections[0].confidence).toBeDefined();
    });
  });

  describe('v2: 混乱层级处理', () => {
    it('H4/H5/H6 应该被降级为 level 3', () => {
      const ast = createTestDocument([
        createTestHeading(1, 'H1'),
        createTestHeading(4, 'H4 应该变成 level 3'),
        createTestHeading(5, 'H5 应该变成 level 3'),
        createTestHeading(6, 'H6 应该变成 level 3'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      const h1 = snapshot.sections[0];
      
      // H4/H5/H6 应该都被降级为 level 3
      for (const child of h1.children) {
        expect(child.level).toBe(3);
        // 但 headingLevel 应该保留原始值
        expect([4, 5, 6]).toContain(child.headingLevel);
      }
    });

    it('文档题目为 H3、正文有 H1 时应该正确处理', () => {
      // 模拟混乱的文档结构
      const ast = createTestDocument([
        createTestHeading(3, '这是文档题目（误用 H3）'),
        createTestParagraph('导言内容'),
        createTestHeading(1, '这是正文标题（误用 H1）'),
        createTestParagraph('正文内容'),
        createTestHeading(1, '另一个误设的 H1'),
        createTestParagraph('更多内容'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // 结构应该被识别出来，虽然可能不是用户期望的
      expect(snapshot.sections.length).toBeGreaterThan(0);
      
      // 元信息应该记录结构
      expect(snapshot.meta.totalSections).toBeGreaterThan(0);
    });
  });

  describe('v2: 段落角色识别', () => {
    it('应该识别 doc_title 角色', () => {
      const ast = createTestDocument([
        createTestHeading(1, '文档主标题'),
        createTestParagraph('正文内容'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // 第一个 H1 应该被标记为 doc_title
      expect(snapshot.meta.docTitleBlockId).toBeDefined();
      expect(snapshot.paragraphRoles[snapshot.meta.docTitleBlockId!]).toBe('doc_title');
    });

    it('应该识别 meta 角色（作者/日期等）', () => {
      const ast = createTestDocument([
        createTestHeading(1, '文档标题'),
        createTestParagraph('作者：张三'),
        createTestParagraph('日期：2025-01-01'),
        createTestParagraph('正文内容'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // 检查是否有 meta 角色
      const metaBlocks = Object.entries(snapshot.paragraphRoles)
        .filter(([_, role]) => role === 'meta');
      
      // 至少应该识别出一个 meta 块
      expect(metaBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('v2: 边界情况', () => {
    it('空文档应该返回空结构', () => {
      const ast = createTestDocument([]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections.length).toBe(0);
      expect(snapshot.meta.totalSections).toBe(0);
    });

    it('只有段落的文档应该没有章节', () => {
      const ast = createTestDocument([
        createTestParagraph('段落一'),
        createTestParagraph('段落二'),
        createTestParagraph('段落三'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections.length).toBe(0);
      expect(snapshot.meta.totalSections).toBe(0);
    });

    it('单个 H1 的文档', () => {
      const ast = createTestDocument([
        createTestHeading(1, '唯一的标题'),
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections.length).toBe(1);
      expect(snapshot.sections[0].titleText).toBe('唯一的标题');
    });
  });
});

