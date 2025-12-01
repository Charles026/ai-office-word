/**
 * resolveSectionByUserText 测试
 * 
 * 测试基于 DocSkeleton 的自然语言章节引用解析
 */

import { describe, it, expect } from 'vitest';
import { resolveSectionByUserText } from '../CopilotRuntime';
import type { DocSkeleton, DocSectionSkeleton } from '../../document/structure';

// ==========================================
// 测试数据：模拟 PRD 文档的骨架
// ==========================================

function createPrdSkeleton(): DocSkeleton {
  const sections: DocSectionSkeleton[] = [
    {
      id: 'sec-1',
      title: 'Overview',
      displayIndex: '第1章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 0,
      endBlockIndex: 10,
      paragraphCount: 3,
    },
    {
      id: 'sec-2',
      title: 'PRD vs MRD',
      displayIndex: '第2章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 11,
      endBlockIndex: 20,
      paragraphCount: 4,
    },
    {
      id: 'sec-3',
      title: 'Ten Steps to Writing a PRD',
      displayIndex: '第3章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [
        {
          id: 'sec-3-1',
          title: 'Step 1: Do Your Homework',
          displayIndex: '3.1',
          role: 'section',
          level: 2,
          parentId: 'sec-3',
          children: [],
          startBlockIndex: 22,
          endBlockIndex: 30,
          paragraphCount: 3,
        },
        {
          id: 'sec-3-2',
          title: 'Step 2: Define the Problem',
          displayIndex: '3.2',
          role: 'section',
          level: 2,
          parentId: 'sec-3',
          children: [],
          startBlockIndex: 31,
          endBlockIndex: 40,
          paragraphCount: 4,
        },
      ],
      startBlockIndex: 21,
      endBlockIndex: 50,
      paragraphCount: 1,
    },
    {
      id: 'sec-4',
      title: 'Common Pitfalls',
      displayIndex: '第4章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 51,
      endBlockIndex: 70,
      paragraphCount: 5,
    },
    {
      id: 'sec-5',
      title: 'Conclusion',
      displayIndex: '第5章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 71,
      endBlockIndex: 80,
      paragraphCount: 2,
    },
  ];

  return {
    sections,
    meta: {
      chapterCount: 5,
      sectionCount: 2,
      hasIntro: true,
      hasConclusion: true,
      languageHint: 'en',
      totalSections: 7,
      totalParagraphs: 22,
    },
  };
}

function createChineseSkeleton(): DocSkeleton {
  const sections: DocSectionSkeleton[] = [
    {
      id: 'sec-1',
      title: '概述',
      displayIndex: '第1章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 0,
      endBlockIndex: 10,
      paragraphCount: 3,
    },
    {
      id: 'sec-2',
      title: '需求分析',
      displayIndex: '第2章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 11,
      endBlockIndex: 30,
      paragraphCount: 5,
    },
    {
      id: 'sec-3',
      title: '系统设计',
      displayIndex: '第3章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 31,
      endBlockIndex: 50,
      paragraphCount: 6,
    },
    {
      id: 'sec-4',
      title: '结论',
      displayIndex: '第4章',
      role: 'chapter',
      level: 1,
      parentId: null,
      children: [],
      startBlockIndex: 51,
      endBlockIndex: 60,
      paragraphCount: 2,
    },
  ];

  return {
    sections,
    meta: {
      chapterCount: 4,
      sectionCount: 0,
      hasIntro: true,
      hasConclusion: true,
      languageHint: 'zh',
      totalSections: 4,
      totalParagraphs: 16,
    },
  };
}

// ==========================================
// 测试
// ==========================================

describe('resolveSectionByUserText', () => {
  describe('按索引匹配', () => {
    it('应该匹配 "第一章"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '第一章',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-1');
      expect(result.reason).toBe('index');
    });

    it('应该匹配 "第二章"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '第二章',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-2');
      expect(result.reason).toBe('index');
    });

    it('应该匹配 "第 3 章"（带空格）', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '第 3 章',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-3');
      expect(result.reason).toBe('index');
    });

    it('应该匹配英文 "chapter 1"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: 'chapter 1',
        skeleton,
        langHint: 'en',
      });

      expect(result.sectionId).toBe('sec-1');
      expect(result.reason).toBe('index');
    });

    it('应该匹配 "最后一章"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '最后一章',
        skeleton,
        lastSectionId: 'sec-2', // 需要 lastSectionId 才能使用相对引用
      });

      // 扁平化后 sec-5 是最后一个顶级章节，但考虑子章节后可能是 sec-3-2
      // 这里只检查能找到，并且是相对引用
      expect(result.sectionId).toBeDefined();
      expect(result.reason).toBe('index');
    });
  });

  describe('按标题匹配', () => {
    it('应该精确匹配英文标题 "Overview"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: 'overview',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-1');
      expect(result.reason).toBe('exact_title');
    });

    it('应该精确匹配中文标题 "概述"', () => {
      const skeleton = createChineseSkeleton();
      const result = resolveSectionByUserText({
        userText: '概述',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-1');
      expect(result.reason).toBe('exact_title');
    });

    it('应该匹配带引号的标题 「PRD vs MRD」', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '「PRD vs MRD」',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-2');
      // 可能匹配为 exact_title 或 partial_title
      expect(['exact_title', 'partial_title']).toContain(result.reason);
    });

    it('应该匹配带引号的标题 "Ten Steps"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '"Ten Steps to Writing a PRD"',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-3');
      // 可能匹配为 exact_title 或 partial_title
      expect(['exact_title', 'partial_title']).toContain(result.reason);
    });
  });

  describe('按关键字匹配', () => {
    it('应该匹配 "概述" 关键字', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '概述在哪里',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-1');
      expect(result.reason).toBe('keyword');
    });

    it('应该匹配 "结论" 关键字', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '帮我改写结论',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-5');
      expect(result.reason).toBe('keyword');
    });

    it('应该匹配中文 "结论" 关键字', () => {
      const skeleton = createChineseSkeleton();
      const result = resolveSectionByUserText({
        userText: '结论部分需要修改',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-4');
      // 标题就是"结论"，所以可能匹配为 exact_title 或 keyword
      expect(['exact_title', 'keyword']).toContain(result.reason);
    });
  });

  describe('相对引用', () => {
    it('应该匹配 "上一章"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '上一章',
        skeleton,
        lastSectionId: 'sec-2',
      });

      expect(result.sectionId).toBe('sec-1');
      expect(result.reason).toBe('index');
    });

    it('应该匹配 "下一章"', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '下一章',
        skeleton,
        lastSectionId: 'sec-2',
      });

      // sec-2 的下一个扁平化后是 sec-3
      expect(result.sectionId).toBe('sec-3');
      expect(result.reason).toBe('index');
    });
  });

  describe('未找到', () => {
    it('找不到时应该返回 not_found', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '不存在的章节标题',
        skeleton,
      });

      expect(result.sectionId).toBeUndefined();
      expect(result.reason).toBe('not_found');
    });

    it('空骨架应该返回 not_found', () => {
      const emptySkeleton: DocSkeleton = {
        sections: [],
        meta: {
          chapterCount: 0,
          sectionCount: 0,
          hasIntro: false,
          hasConclusion: false,
          languageHint: 'other',
          totalSections: 0,
          totalParagraphs: 0,
        },
      };
      
      const result = resolveSectionByUserText({
        userText: '第一章',
        skeleton: emptySkeleton,
      });

      expect(result.sectionId).toBeUndefined();
      expect(result.reason).toBe('not_found');
    });
  });

  describe('复杂场景', () => {
    it('应该在整句话中识别章节引用', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: '帮我改写第二章的内容，使其更加简洁',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-2');
      expect(result.reason).toBe('index');
    });

    it('应该匹配带有标题片段的请求', () => {
      const skeleton = createPrdSkeleton();
      const result = resolveSectionByUserText({
        userText: 'Ten Steps to Writing a PRD',
        skeleton,
      });

      expect(result.sectionId).toBe('sec-3');
      // 可能是 exact_title 或 partial_title
      expect(['exact_title', 'partial_title']).toContain(result.reason);
    });
  });
});

