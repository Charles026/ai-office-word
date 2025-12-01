/**
 * 结构查询解析器测试
 * 
 * @tag structure-stats-sot v1.5
 */

import { describe, it, expect } from 'vitest';
import {
  resolveStructuralQuery,
  isStructuralQuery,
  canDirectAnswer,
  needsClarification,
  type StructuralQueryResolution,
} from '../structuralQueryResolver';
import type { DocContextEnvelope, DocStructure, DocStats, DocMeta } from '../../docContext/docContextTypes';

// ==========================================
// 测试数据
// ==========================================

function createMockEnvelope(options: {
  structure?: DocStructure;
  stats?: DocStats;
  docMeta?: DocMeta;
} = {}): DocContextEnvelope {
  return {
    docId: 'test-doc',
    scope: 'document',
    focus: {
      sectionId: null,
      sectionTitle: null,
      text: '',
      charCount: 0,
      approxTokenCount: 0,
    },
    neighborhood: {},
    global: {
      title: 'Test Document',
      outline: [],
      structure: options.structure,
      stats: options.stats,
      docMeta: options.docMeta,
    },
    budget: {
      maxTokens: 8192,
      estimatedTokens: 1000,
    },
  };
}

function createMockStructure(): DocStructure {
  return {
    chapters: [
      { id: 'ch-1', level: 1, titleText: 'Overview', startIndex: 0, endIndex: 10, childCount: 2, paragraphCount: 3 },
      { id: 'ch-2', level: 1, titleText: 'PRD vs MRD', startIndex: 11, endIndex: 20, childCount: 0, paragraphCount: 5 },
      { id: 'ch-3', level: 1, titleText: 'Ten Steps', startIndex: 21, endIndex: 50, childCount: 10, paragraphCount: 2 },
      { id: 'ch-4', level: 1, titleText: 'Common Pitfalls', startIndex: 51, endIndex: 80, childCount: 5, paragraphCount: 3 },
      { id: 'ch-5', level: 1, titleText: 'Conclusion', startIndex: 81, endIndex: 100, childCount: 0, paragraphCount: 2 },
    ],
    allSections: [
      { id: 'ch-1', level: 1, titleText: 'Overview', startIndex: 0, endIndex: 10, childCount: 2, paragraphCount: 3 },
      { id: 'sec-1-1', level: 2, titleText: 'Background', startIndex: 1, endIndex: 5, childCount: 0, paragraphCount: 2 },
      { id: 'sec-1-2', level: 2, titleText: 'Goals', startIndex: 6, endIndex: 10, childCount: 0, paragraphCount: 1 },
      { id: 'ch-2', level: 1, titleText: 'PRD vs MRD', startIndex: 11, endIndex: 20, childCount: 0, paragraphCount: 5 },
      { id: 'ch-3', level: 1, titleText: 'Ten Steps', startIndex: 21, endIndex: 50, childCount: 10, paragraphCount: 2 },
      { id: 'ch-4', level: 1, titleText: 'Common Pitfalls', startIndex: 51, endIndex: 80, childCount: 5, paragraphCount: 3 },
      { id: 'ch-5', level: 1, titleText: 'Conclusion', startIndex: 81, endIndex: 100, childCount: 0, paragraphCount: 2 },
    ],
    chapterCount: 5,
    totalSectionCount: 7,
  };
}

function createMockStats(): DocStats {
  return {
    charCount: 12500,
    wordCount: 3200,
    tokenEstimate: 4100,
    paragraphCount: 45,
  };
}

function createMockDocMeta(hasTitle: boolean = true): DocMeta {
  return {
    title: hasTitle ? 'How to Write a Great PRD' : null,
    hasExplicitTitle: hasTitle,
  };
}

// ==========================================
// 测试
// ==========================================

describe('structuralQueryResolver', () => {
  describe('章节计数查询', () => {
    it('应该识别"有几章"并返回正确答案', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('有几章', envelope);
      
      expect(result.kind).toBe('chapter_count');
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toContain('5');
      expect(canDirectAnswer(result)).toBe(true);
    });

    it('应该识别"一共有多少章"', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('一共有多少章', envelope);
      
      expect(result.kind).toBe('chapter_count');
      expect(result.confidence).toBe('high');
    });

    it('应该识别"总共多少章"', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('总共多少章', envelope);
      
      expect(result.kind).toBe('chapter_count');
    });

    it('没有 structure 时应该返回 low confidence', () => {
      const envelope = createMockEnvelope({});
      
      const result = resolveStructuralQuery('有几章', envelope);
      
      expect(result.kind).toBe('chapter_count');
      expect(result.confidence).toBe('low');
      expect(needsClarification(result)).toBe(true);
    });
  });

  describe('小节计数查询', () => {
    it('应该识别"有几节"', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('有几节', envelope);
      
      expect(result.kind).toBe('section_count');
      expect(result.confidence).toBe('high');
      // 7 - 5 = 2 个非 chapter 的小节
      expect(result.directAnswer).toContain('2');
    });

    it('应该识别"有多少节"', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('有多少节', envelope);
      
      expect(result.kind).toBe('section_count');
    });
  });

  describe('段落计数查询', () => {
    it('应该识别"有几段"', () => {
      const envelope = createMockEnvelope({
        stats: createMockStats(),
      });
      
      const result = resolveStructuralQuery('有几段', envelope);
      
      expect(result.kind).toBe('paragraph_count');
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toContain('45');
    });

    it('应该识别"有多少段落"', () => {
      const envelope = createMockEnvelope({
        stats: createMockStats(),
      });
      
      const result = resolveStructuralQuery('有多少段落', envelope);
      
      expect(result.kind).toBe('paragraph_count');
    });
  });

  describe('字数查询', () => {
    it('应该识别"有多少字"', () => {
      const envelope = createMockEnvelope({
        stats: createMockStats(),
      });
      
      const result = resolveStructuralQuery('有多少字', envelope);
      
      expect(result.kind).toBe('word_count');
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toContain('3200');
    });

    it('应该识别"字数"', () => {
      const envelope = createMockEnvelope({
        stats: createMockStats(),
      });
      
      const result = resolveStructuralQuery('字数', envelope);
      
      expect(result.kind).toBe('word_count');
    });

    it('没有 stats 时应该返回 low confidence', () => {
      const envelope = createMockEnvelope({});
      
      const result = resolveStructuralQuery('有多少字', envelope);
      
      expect(result.kind).toBe('word_count');
      expect(result.confidence).toBe('low');
    });
  });

  describe('token 数查询', () => {
    it('应该识别"有多少 token"', () => {
      const envelope = createMockEnvelope({
        stats: createMockStats(),
      });
      
      const result = resolveStructuralQuery('有多少 token', envelope);
      
      expect(result.kind).toBe('token_count');
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toContain('4100');
    });

    it('应该识别"token count"', () => {
      const envelope = createMockEnvelope({
        stats: createMockStats(),
      });
      
      const result = resolveStructuralQuery('token count', envelope);
      
      expect(result.kind).toBe('token_count');
    });
  });

  describe('文档标题查询', () => {
    it('有标题时应该返回标题', () => {
      const envelope = createMockEnvelope({
        docMeta: createMockDocMeta(true),
      });
      
      const result = resolveStructuralQuery('文档标题是什么', envelope);
      
      expect(result.kind).toBe('title_query');
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toContain('How to Write a Great PRD');
    });

    it('没有标题时应该明确说明', () => {
      const envelope = createMockEnvelope({
        docMeta: createMockDocMeta(false),
      });
      
      const result = resolveStructuralQuery('文章标题叫什么', envelope);
      
      expect(result.kind).toBe('title_query');
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toContain('没有');
    });

    it('应该识别"标题是什么"', () => {
      const envelope = createMockEnvelope({
        docMeta: createMockDocMeta(true),
      });
      
      const result = resolveStructuralQuery('标题是什么', envelope);
      
      expect(result.kind).toBe('title_query');
    });
  });

  describe('第 N 章查询', () => {
    it('应该识别"第一章"', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('第一章', envelope);
      
      expect(result.kind).toBe('locate_chapter');
      expect(result.chapterIndex).toBe(1);
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toContain('Overview');
    });

    it('应该识别"第三章"', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('第三章是什么', envelope);
      
      expect(result.kind).toBe('locate_chapter');
      expect(result.chapterIndex).toBe(3);
      expect(result.directAnswer).toContain('Ten Steps');
    });

    it('超出范围时应该返回 low confidence', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      const result = resolveStructuralQuery('第十章', envelope);
      
      expect(result.kind).toBe('locate_chapter');
      expect(result.confidence).toBe('low');
      expect(result.clarificationQuestion).toContain('找不到');
    });
  });

  describe('非结构查询', () => {
    it('编辑请求中包含章节引用时应该返回 other，让 LLM 处理编辑意图', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
        stats: createMockStats(),
      });
      
      // v1.5: "帮我改写第一章" 包含编辑意图关键词（"帮我" "改写"）
      // 应该返回 other，让 LLM 解析为编辑意图，而不是被短路处理
      // 这样 CopilotRuntime 可以正确执行 rewrite_section
      const result = resolveStructuralQuery('帮我改写第一章', envelope);
      
      expect(result.kind).toBe('other');
      expect(result.debugInfo).toContain('edit intent');
    });

    it('纯聊天应该返回 other', () => {
      const envelope = createMockEnvelope({});
      
      const result = resolveStructuralQuery('你好', envelope);
      
      expect(result.kind).toBe('other');
    });
  });

  describe('辅助函数', () => {
    it('isStructuralQuery 应该正确识别', () => {
      expect(isStructuralQuery({ kind: 'chapter_count', confidence: 'high' })).toBe(true);
      expect(isStructuralQuery({ kind: 'other', confidence: 'high' })).toBe(false);
    });

    it('canDirectAnswer 应该正确判断', () => {
      expect(canDirectAnswer({ kind: 'chapter_count', confidence: 'high', directAnswer: '5 章' })).toBe(true);
      expect(canDirectAnswer({ kind: 'chapter_count', confidence: 'low' })).toBe(false);
      expect(canDirectAnswer({ kind: 'chapter_count', confidence: 'high' })).toBe(false);
    });

    it('needsClarification 应该正确判断', () => {
      expect(needsClarification({ kind: 'chapter_count', confidence: 'low', clarificationQuestion: '需要澄清' })).toBe(true);
      expect(needsClarification({ kind: 'chapter_count', confidence: 'high' })).toBe(false);
    });
  });
});

