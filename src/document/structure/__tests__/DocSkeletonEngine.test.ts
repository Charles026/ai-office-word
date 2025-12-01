/**
 * DocSkeleton 测试
 * 
 * 测试 buildDocSkeleton 及其辅助函数
 */

import { describe, it, expect } from 'vitest';
import {
  buildDocSkeletonFromSnapshot,
  flattenDocSkeleton,
  findSkeletonSectionById,
  findSkeletonSectionByTitle,
  findSkeletonSectionByIndex,
  type DocStructureSnapshot,
  type SectionNode,
  type DocSkeleton,
} from '../DocStructureEngine';

// ==========================================
// 测试数据：模拟 "How to Write a Great PRD" 结构
// ==========================================

function createPrdDocumentSnapshot(): DocStructureSnapshot {
  // 创建一个类似于 PRD 文档的结构
  const sections: SectionNode[] = [
    {
      id: 'sec-1',
      level: 1,
      titleBlockId: 'block-1',
      titleText: 'How to Write a Great PRD',
      startBlockIndex: 0,
      endBlockIndex: 100, // 假设整个文档
      ownParagraphBlockIds: ['block-2', 'block-3'], // 导语
      children: [
        {
          id: 'sec-2',
          level: 2,
          titleBlockId: 'block-4',
          titleText: 'Overview',
          startBlockIndex: 4,
          endBlockIndex: 10,
          ownParagraphBlockIds: ['block-5', 'block-6'],
          children: [],
        },
        {
          id: 'sec-3',
          level: 2,
          titleBlockId: 'block-11',
          titleText: 'PRD vs MRD',
          startBlockIndex: 11,
          endBlockIndex: 18,
          ownParagraphBlockIds: ['block-12', 'block-13', 'block-14'],
          children: [],
        },
        {
          id: 'sec-4',
          level: 2,
          titleBlockId: 'block-19',
          titleText: 'PRD vs Product Strategy',
          startBlockIndex: 19,
          endBlockIndex: 25,
          ownParagraphBlockIds: ['block-20', 'block-21'],
          children: [],
        },
        {
          id: 'sec-5',
          level: 2,
          titleBlockId: 'block-26',
          titleText: 'Ten Steps to Writing a PRD',
          startBlockIndex: 26,
          endBlockIndex: 60,
          ownParagraphBlockIds: ['block-27'],
          children: [
            {
              id: 'sec-5-1',
              level: 3,
              titleBlockId: 'block-28',
              titleText: 'Step 1: Do Your Homework',
              startBlockIndex: 28,
              endBlockIndex: 32,
              ownParagraphBlockIds: ['block-29', 'block-30', 'block-31'],
              children: [],
            },
            {
              id: 'sec-5-2',
              level: 3,
              titleBlockId: 'block-32',
              titleText: 'Step 2: Define the Problem',
              startBlockIndex: 32,
              endBlockIndex: 36,
              ownParagraphBlockIds: ['block-33', 'block-34', 'block-35'],
              children: [],
            },
            {
              id: 'sec-5-3',
              level: 3,
              titleBlockId: 'block-36',
              titleText: 'Step 3: Set Clear Goals',
              startBlockIndex: 36,
              endBlockIndex: 40,
              ownParagraphBlockIds: ['block-37', 'block-38', 'block-39'],
              children: [],
            },
            // ... 可以添加更多 steps
          ],
        },
        {
          id: 'sec-6',
          level: 2,
          titleBlockId: 'block-61',
          titleText: 'Common Pitfalls',
          startBlockIndex: 61,
          endBlockIndex: 85,
          ownParagraphBlockIds: ['block-62'],
          children: [
            {
              id: 'sec-6-1',
              level: 3,
              titleBlockId: 'block-63',
              titleText: 'Pitfall 1: Usability Testing Issues',
              startBlockIndex: 63,
              endBlockIndex: 68,
              ownParagraphBlockIds: ['block-64', 'block-65', 'block-66', 'block-67'],
              children: [],
            },
            {
              id: 'sec-6-2',
              level: 3,
              titleBlockId: 'block-68',
              titleText: 'Pitfall 2: Scope Creep',
              startBlockIndex: 68,
              endBlockIndex: 73,
              ownParagraphBlockIds: ['block-69', 'block-70', 'block-71', 'block-72'],
              children: [],
            },
          ],
        },
        {
          id: 'sec-7',
          level: 2,
          titleBlockId: 'block-86',
          titleText: 'Conclusion',
          startBlockIndex: 86,
          endBlockIndex: 95,
          ownParagraphBlockIds: ['block-87', 'block-88', 'block-89', 'block-90'],
          children: [],
        },
      ],
    },
  ];

  return {
    sections,
    paragraphRoles: {
      'block-1': 'section_title',
      'block-2': 'body',
      'block-3': 'body',
      // ... 更多映射
    },
    meta: {
      totalBlocks: 100,
      totalSections: 12, // 1 + 6 + 5
      docTitleBlockId: 'block-1',
      generatedAt: Date.now(),
      engineVersion: '1.0.0',
    },
  };
}

function createChineseDocumentSnapshot(): DocStructureSnapshot {
  // 创建一个中文文档结构
  const sections: SectionNode[] = [
    {
      id: 'sec-1',
      level: 1,
      titleBlockId: 'block-1',
      titleText: '产品需求文档编写指南',
      startBlockIndex: 0,
      endBlockIndex: 50,
      ownParagraphBlockIds: ['block-2'],
      children: [
        {
          id: 'sec-2',
          level: 2,
          titleBlockId: 'block-3',
          titleText: '概述',
          startBlockIndex: 3,
          endBlockIndex: 10,
          ownParagraphBlockIds: ['block-4', 'block-5'],
          children: [],
        },
        {
          id: 'sec-3',
          level: 2,
          titleBlockId: 'block-11',
          titleText: '第一章：需求分析',
          startBlockIndex: 11,
          endBlockIndex: 25,
          ownParagraphBlockIds: ['block-12'],
          children: [],
        },
        {
          id: 'sec-4',
          level: 2,
          titleBlockId: 'block-26',
          titleText: '结论',
          startBlockIndex: 26,
          endBlockIndex: 35,
          ownParagraphBlockIds: ['block-27', 'block-28'],
          children: [],
        },
      ],
    },
  ];

  return {
    sections,
    paragraphRoles: {},
    meta: {
      totalBlocks: 50,
      totalSections: 4,
      generatedAt: Date.now(),
      engineVersion: '1.0.0',
    },
  };
}

// ==========================================
// 测试
// ==========================================

describe('DocSkeletonEngine', () => {
  describe('buildDocSkeletonFromSnapshot', () => {
    it('应该正确构建 PRD 文档的骨架', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      expect(skeleton).toBeDefined();
      expect(skeleton.sections).toHaveLength(1); // 顶级 H1 只有一个
      expect(skeleton.sections[0].title).toBe('How to Write a Great PRD');
    });

    it('应该正确计算 chapterCount', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      // 顶级 H1 + 6 个 H2 = 7 个 chapter
      // 但根据 role 分配逻辑，H1 是 chapter，H2 因为有 parent 所以是 section
      expect(skeleton.meta.chapterCount).toBe(1); // 只有 H1 被标记为 chapter
    });

    it('应该正确计算 sectionCount', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      // 6 个 H2 (sections) + 5 个 H3 (subsections) = 11
      expect(skeleton.meta.sectionCount).toBe(11);
    });

    it('应该正确检测 hasIntro', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      expect(skeleton.meta.hasIntro).toBe(true); // "Overview" 匹配
    });

    it('应该正确检测 hasConclusion', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      expect(skeleton.meta.hasConclusion).toBe(true); // "Conclusion" 匹配
    });

    it('应该正确检测英文文档的 languageHint', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      expect(skeleton.meta.languageHint).toBe('en');
    });

    it('应该正确检测中文文档的 languageHint', () => {
      const snapshot = createChineseDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      expect(skeleton.meta.languageHint).toBe('zh');
    });

    it('应该正确分配 role', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      // 顶级 H1 应该是 chapter
      expect(skeleton.sections[0].role).toBe('chapter');

      // H2 应该是 section
      expect(skeleton.sections[0].children[0].role).toBe('section'); // Overview
      expect(skeleton.sections[0].children[1].role).toBe('section'); // PRD vs MRD

      // H3 应该是 subsection
      const tenSteps = skeleton.sections[0].children[3]; // Ten Steps
      expect(tenSteps.children[0].role).toBe('subsection'); // Step 1
    });

    it('应该生成正确的 displayIndex', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      expect(skeleton.sections[0].displayIndex).toBe('第1章');
    });

    it('应该正确计算 paragraphCount', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      const overview = skeleton.sections[0].children[0];
      expect(overview.paragraphCount).toBe(2);

      const prdVsMrd = skeleton.sections[0].children[1];
      expect(prdVsMrd.paragraphCount).toBe(3);
    });

    it('应该正确计算 totalParagraphs', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);

      // 计算所有 ownParagraphBlockIds 的总和
      expect(skeleton.meta.totalParagraphs).toBeGreaterThan(0);
    });
  });

  describe('flattenDocSkeleton', () => {
    it('应该返回扁平的章节列表', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const flat = flattenDocSkeleton(skeleton);

      // 1 (H1) + 6 (H2) + 5 (H3) = 12
      expect(flat.length).toBe(12);
    });

    it('扁平列表应该按深度优先顺序排列', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const flat = flattenDocSkeleton(skeleton);

      expect(flat[0].title).toBe('How to Write a Great PRD');
      expect(flat[1].title).toBe('Overview');
      expect(flat[2].title).toBe('PRD vs MRD');
    });
  });

  describe('findSkeletonSectionById', () => {
    it('应该能找到顶级章节', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionById(skeleton, 'sec-1');

      expect(found).not.toBeNull();
      expect(found?.title).toBe('How to Write a Great PRD');
    });

    it('应该能找到嵌套章节', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionById(skeleton, 'sec-5-1');

      expect(found).not.toBeNull();
      expect(found?.title).toBe('Step 1: Do Your Homework');
    });

    it('找不到时应该返回 null', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionById(skeleton, 'non-existent');

      expect(found).toBeNull();
    });
  });

  describe('findSkeletonSectionByTitle', () => {
    it('应该能精确匹配标题', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByTitle(skeleton, 'Overview', true);

      expect(found).not.toBeNull();
      expect(found?.id).toBe('sec-2');
    });

    it('应该能模糊匹配标题', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByTitle(skeleton, 'ten steps');

      expect(found).not.toBeNull();
      expect(found?.title).toContain('Ten Steps');
    });

    it('应该能匹配部分标题', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByTitle(skeleton, 'PRD');

      expect(found).not.toBeNull();
      expect(found?.title).toContain('PRD');
    });

    it('找不到时应该返回 null', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByTitle(skeleton, 'NonExistent Title');

      expect(found).toBeNull();
    });
  });

  describe('findSkeletonSectionByIndex', () => {
    it('应该能按索引查找 chapter', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByIndex(skeleton, 1, 'chapter');

      expect(found).not.toBeNull();
      expect(found?.title).toBe('How to Write a Great PRD');
    });

    it('应该能按索引查找 section', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByIndex(skeleton, 1, 'section');

      expect(found).not.toBeNull();
      expect(found?.title).toBe('Overview');
    });

    it('应该能按索引查找任意章节', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByIndex(skeleton, 3);

      expect(found).not.toBeNull();
      expect(found?.title).toBe('PRD vs MRD');
    });

    it('索引超出范围时应该返回 null', () => {
      const snapshot = createPrdDocumentSnapshot();
      const skeleton = buildDocSkeletonFromSnapshot(snapshot);
      const found = findSkeletonSectionByIndex(skeleton, 100, 'chapter');

      expect(found).toBeNull();
    });
  });
});

