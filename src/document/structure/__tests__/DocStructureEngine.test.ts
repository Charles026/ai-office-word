/**
 * DocStructureEngine 测试
 * 
 * 测试文档结构引擎的核心功能：
 * - 章节树构建
 * - 段落角色分配
 * - 查询辅助函数
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildDocStructureFromAst,
  findSectionById,
  findSectionByBlockId,
  findSectionContainingBlock,
  getOutlineFromSnapshot,
  type DocStructureSnapshot,
  type SectionNode,
} from '../DocStructureEngine';
import type { DocumentAst, HeadingNode, ParagraphNode, ListNode } from '../../types';
import { createHeading, createParagraph, createList } from '../../types';

// ==========================================
// 测试数据构建辅助函数
// ==========================================

/**
 * 创建测试用的 DocumentAst
 */
function createTestDocument(blocks: Array<HeadingNode | ParagraphNode | ListNode>): DocumentAst {
  return {
    version: 1,
    blocks,
    metadata: {
      title: 'Test Document',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    },
  };
}

/**
 * 创建典型 PRD 文档结构
 */
function createPRDDocument(): DocumentAst {
  return createTestDocument([
    // Block 0: 文档主标题 (H1)
    { ...createHeading(1, 'How to Write a Great PRD'), id: 'block-0' },
    // Block 1: 作者信息 (meta)
    { ...createParagraph('作者：张三 | 日期：2024-01-01'), id: 'block-1' },
    // Block 2: 简介段落
    { ...createParagraph('This guide helps you write better PRDs.'), id: 'block-2' },
    
    // Block 3: H2 Overview
    { ...createHeading(2, 'Overview'), id: 'block-3' },
    // Block 4: Overview 正文
    { ...createParagraph('A PRD is a product requirements document.'), id: 'block-4' },
    // Block 5: Overview 正文
    { ...createParagraph('It describes what to build and why.'), id: 'block-5' },
    
    // Block 6: H2 PRD vs MRD
    { ...createHeading(2, 'PRD vs MRD'), id: 'block-6' },
    // Block 7: 正文
    { ...createParagraph('PRD focuses on product features.'), id: 'block-7' },
    
    // Block 8: H3 Goals (子章节)
    { ...createHeading(3, 'Goals'), id: 'block-8' },
    // Block 9: Goals 正文
    { ...createParagraph('Define clear goals for your PRD.'), id: 'block-9' },
    
    // Block 10: H3 Non-goals (子章节)
    { ...createHeading(3, 'Non-goals'), id: 'block-10' },
    // Block 11: Non-goals 正文
    { ...createParagraph('Also define what is out of scope.'), id: 'block-11' },
    
    // Block 12: H2 Requirements
    { ...createHeading(2, 'Requirements'), id: 'block-12' },
    // Block 13: Requirements 正文
    { ...createParagraph('List all functional requirements.'), id: 'block-13' },
    // Block 14: Requirements 列表
    { ...createList(true, ['Feature A', 'Feature B', 'Feature C']), id: 'block-14' },
  ]);
}

// ==========================================
// 测试套件
// ==========================================

describe('DocStructureEngine', () => {
  describe('buildDocStructureFromAst', () => {
    it('应该从空文档构建空结构', () => {
      const ast = createTestDocument([]);
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections).toHaveLength(0);
      expect(snapshot.meta.totalBlocks).toBe(0);
      expect(snapshot.meta.totalSections).toBe(0);
    });
    
    it('应该正确识别 H1 为 section', () => {
      const ast = createTestDocument([
        { ...createHeading(1, 'Main Title'), id: 'h1-block' },
        { ...createParagraph('Some content'), id: 'p1-block' },
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections).toHaveLength(1);
      expect(snapshot.sections[0].level).toBe(1);
      expect(snapshot.sections[0].titleText).toBe('Main Title');
      expect(snapshot.sections[0].titleBlockId).toBe('h1-block');
    });
    
    it('应该正确识别 H2 为 section', () => {
      const ast = createTestDocument([
        { ...createHeading(2, 'Section Title'), id: 'h2-block' },
        { ...createParagraph('Section content'), id: 'p1-block' },
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections).toHaveLength(1);
      expect(snapshot.sections[0].level).toBe(2);
      expect(snapshot.sections[0].titleText).toBe('Section Title');
    });
    
    it('应该构建正确的层级树结构', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast);
      
      // 根级应该有 H1 和 3 个 H2
      // 由于 H1 包含后续的 H2，实际上只有 H1 在根级
      expect(snapshot.sections.length).toBeGreaterThanOrEqual(1);
      
      // 第一个应该是 H1 文档标题
      const h1Section = snapshot.sections[0];
      expect(h1Section.level).toBe(1);
      expect(h1Section.titleText).toBe('How to Write a Great PRD');
      
      // H1 下应该有 H2 作为子章节
      expect(h1Section.children.length).toBeGreaterThanOrEqual(1);
    });
    
    it('应该正确计算 section 的 start/end index', () => {
      const ast = createTestDocument([
        { ...createHeading(2, 'Section 1'), id: 'h2-1' },
        { ...createParagraph('Content 1'), id: 'p1' },
        { ...createParagraph('Content 2'), id: 'p2' },
        { ...createHeading(2, 'Section 2'), id: 'h2-2' },
        { ...createParagraph('Content 3'), id: 'p3' },
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // Section 1: index 0-2 (不含 index 3)
      const section1 = snapshot.sections[0];
      expect(section1.startBlockIndex).toBe(0);
      expect(section1.endBlockIndex).toBe(3); // 到 Section 2 开始前
      
      // Section 2: index 3-4
      const section2 = snapshot.sections[1];
      expect(section2.startBlockIndex).toBe(3);
      expect(section2.endBlockIndex).toBe(5); // 到文档结尾
    });
    
    it('应该正确收集 ownParagraphBlockIds', () => {
      const ast = createTestDocument([
        { ...createHeading(2, 'Parent Section'), id: 'h2-parent' },
        { ...createParagraph('Parent intro'), id: 'p-intro' },
        { ...createHeading(3, 'Child Section'), id: 'h3-child' },
        { ...createParagraph('Child content'), id: 'p-child' },
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // Parent section 应该只有 intro 作为 own paragraph
      const parentSection = snapshot.sections[0];
      expect(parentSection.ownParagraphBlockIds).toContain('p-intro');
      expect(parentSection.ownParagraphBlockIds).not.toContain('p-child');
      
      // Child section 应该有自己的 paragraph
      const childSection = parentSection.children[0];
      expect(childSection.ownParagraphBlockIds).toContain('p-child');
    });
  });
  
  describe('paragraphRoles', () => {
    it('应该将第一个 H1 标记为 doc_title', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast, { docTitleStrategy: 'first_h1' });
      
      expect(snapshot.paragraphRoles['block-0']).toBe('doc_title');
    });
    
    it('应该将其他 heading 标记为 section_title', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.paragraphRoles['block-3']).toBe('section_title'); // H2 Overview
      expect(snapshot.paragraphRoles['block-6']).toBe('section_title'); // H2 PRD vs MRD
      expect(snapshot.paragraphRoles['block-8']).toBe('section_title'); // H3 Goals
    });
    
    it('应该识别 meta 信息', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast);
      
      // 作者/日期信息应该被识别为 meta
      expect(snapshot.paragraphRoles['block-1']).toBe('meta');
    });
    
    it('应该将普通段落标记为 body', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.paragraphRoles['block-4']).toBe('body');
      expect(snapshot.paragraphRoles['block-5']).toBe('body');
    });
    
    it('应该将列表标记为 list_item', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.paragraphRoles['block-14']).toBe('list_item');
    });
  });
  
  describe('查询辅助函数', () => {
    let snapshot: DocStructureSnapshot;
    
    beforeEach(() => {
      const ast = createPRDDocument();
      snapshot = buildDocStructureFromAst(ast);
    });
    
    describe('findSectionById', () => {
      it('应该通过 block id 找到 section', () => {
        const section = findSectionById(snapshot, 'block-3');
        expect(section).not.toBeNull();
        expect(section?.titleText).toBe('Overview');
      });
      
      it('应该通过 sec- 前缀 id 找到 section', () => {
        const section = findSectionById(snapshot, 'sec-block-3');
        expect(section).not.toBeNull();
        expect(section?.titleText).toBe('Overview');
      });
      
      it('应该找到嵌套的子 section', () => {
        const section = findSectionById(snapshot, 'block-8');
        expect(section).not.toBeNull();
        expect(section?.titleText).toBe('Goals');
        expect(section?.level).toBe(3);
      });
      
      it('应该返回 null 当 section 不存在时', () => {
        const section = findSectionById(snapshot, 'non-existent');
        expect(section).toBeNull();
      });
    });
    
    describe('findSectionByBlockId', () => {
      it('应该通过 titleBlockId 找到 section', () => {
        const section = findSectionByBlockId(snapshot, 'block-6');
        expect(section).not.toBeNull();
        expect(section?.titleText).toBe('PRD vs MRD');
      });
    });
    
    describe('findSectionContainingBlock', () => {
      it('应该找到包含指定 block 的 section', () => {
        const section = findSectionContainingBlock(snapshot, 'block-4');
        expect(section).not.toBeNull();
        // block-4 是 Overview 章节的正文
        expect(section?.titleText).toBe('Overview');
      });
      
      it('应该找到包含子章节 block 的正确 section', () => {
        const section = findSectionContainingBlock(snapshot, 'block-9');
        expect(section).not.toBeNull();
        // block-9 是 Goals 章节的正文
        expect(section?.titleText).toBe('Goals');
      });
    });
    
    describe('getOutlineFromSnapshot', () => {
      it('应该返回扁平的大纲列表', () => {
        const outline = getOutlineFromSnapshot(snapshot);
        
        expect(outline.length).toBeGreaterThan(0);
        
        // 检查包含主要章节
        const titles = outline.map(o => o.title);
        expect(titles).toContain('How to Write a Great PRD');
        expect(titles).toContain('Overview');
        expect(titles).toContain('PRD vs MRD');
        expect(titles).toContain('Goals');
        expect(titles).toContain('Non-goals');
        expect(titles).toContain('Requirements');
      });
      
      it('大纲应该按文档顺序排列', () => {
        const outline = getOutlineFromSnapshot(snapshot);
        
        // 找到 PRD vs MRD 和其子章节的位置
        const prdVsMrdIndex = outline.findIndex(o => o.title === 'PRD vs MRD');
        const goalsIndex = outline.findIndex(o => o.title === 'Goals');
        const nonGoalsIndex = outline.findIndex(o => o.title === 'Non-goals');
        
        // Goals 和 Non-goals 应该在 PRD vs MRD 之后
        expect(goalsIndex).toBeGreaterThan(prdVsMrdIndex);
        expect(nonGoalsIndex).toBeGreaterThan(goalsIndex);
      });
    });
  });
  
  describe('meta 信息', () => {
    it('应该正确记录总 block 数', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.meta.totalBlocks).toBe(15);
    });
    
    it('应该正确记录总 section 数', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast);
      
      // H1(1) + H2(3) + H3(2) = 6 sections
      expect(snapshot.meta.totalSections).toBe(6);
    });
    
    it('应该记录 doc_title block id', () => {
      const ast = createPRDDocument();
      const snapshot = buildDocStructureFromAst(ast, { docTitleStrategy: 'first_h1' });
      
      expect(snapshot.meta.docTitleBlockId).toBe('block-0');
    });
  });
  
  describe('边界情况', () => {
    it('应该处理只有段落没有标题的文档', () => {
      const ast = createTestDocument([
        { ...createParagraph('Just some text'), id: 'p1' },
        { ...createParagraph('More text'), id: 'p2' },
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections).toHaveLength(0);
      expect(snapshot.paragraphRoles['p1']).toBe('body');
      expect(snapshot.paragraphRoles['p2']).toBe('body');
    });
    
    it('应该处理连续的标题（无正文）', () => {
      const ast = createTestDocument([
        { ...createHeading(2, 'Section 1'), id: 'h2-1' },
        { ...createHeading(2, 'Section 2'), id: 'h2-2' },
        { ...createHeading(2, 'Section 3'), id: 'h2-3' },
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      expect(snapshot.sections).toHaveLength(3);
      expect(snapshot.sections[0].ownParagraphBlockIds).toHaveLength(0);
      expect(snapshot.sections[1].ownParagraphBlockIds).toHaveLength(0);
      expect(snapshot.sections[2].ownParagraphBlockIds).toHaveLength(0);
    });
    
    it('应该处理跳级标题（H2 直接到 H4）', () => {
      const ast = createTestDocument([
        { ...createHeading(2, 'Section'), id: 'h2' },
        { ...createParagraph('Content'), id: 'p1' },
        // H4 会被归一化为 H3
        { ...createHeading(4 as any, 'Subsection'), id: 'h4' },
        { ...createParagraph('Sub content'), id: 'p2' },
      ]);
      
      const snapshot = buildDocStructureFromAst(ast);
      
      // H4 应该被归一化为 H3
      const subsection = findSectionById(snapshot, 'h4');
      expect(subsection?.level).toBe(3);
    });
  });
});

// ==========================================
// 导入 beforeEach
// ==========================================
import { beforeEach } from 'vitest';

