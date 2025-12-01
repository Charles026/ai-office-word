/**
 * 结构查询解析器测试
 * 
 * @tag structure-stats-sot v1.5
 * @tag structure-v2 - 新增置信度和混合意图测试
 */

import { describe, it, expect } from 'vitest';
import {
  resolveStructuralQuery,
  isStructuralQuery,
  canDirectAnswer,
  needsClarification,
  shouldShortCircuit,
  type StructuralQueryResolution,
} from '../structuralQueryResolver';
import type { DocContextEnvelope, DocStructure, DocStats, DocMeta, Confidence } from '../../docContext/docContextTypes';

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

function createMockStructure(globalConfidence: Confidence = 'high'): DocStructure {
  return {
    chapters: [
      { id: 'ch-1', level: 1, titleText: 'Overview', startIndex: 0, endIndex: 10, childCount: 2, paragraphCount: 3, source: 'heading', confidence: 'high' },
      { id: 'ch-2', level: 1, titleText: 'PRD vs MRD', startIndex: 11, endIndex: 20, childCount: 0, paragraphCount: 5, source: 'heading', confidence: 'high' },
      { id: 'ch-3', level: 1, titleText: 'Ten Steps', startIndex: 21, endIndex: 50, childCount: 10, paragraphCount: 2, source: 'heading', confidence: 'high' },
      { id: 'ch-4', level: 1, titleText: 'Common Pitfalls', startIndex: 51, endIndex: 80, childCount: 5, paragraphCount: 3, source: 'heading', confidence: 'high' },
      { id: 'ch-5', level: 1, titleText: 'Conclusion', startIndex: 81, endIndex: 100, childCount: 0, paragraphCount: 2, source: 'heading', confidence: 'high' },
    ],
    allSections: [
      { id: 'ch-1', level: 1, titleText: 'Overview', startIndex: 0, endIndex: 10, childCount: 2, paragraphCount: 3, source: 'heading', confidence: 'high' },
      { id: 'sec-1-1', level: 2, titleText: 'Background', startIndex: 1, endIndex: 5, childCount: 0, paragraphCount: 2, source: 'heading', confidence: 'high' },
      { id: 'sec-1-2', level: 2, titleText: 'Goals', startIndex: 6, endIndex: 10, childCount: 0, paragraphCount: 1, source: 'heading', confidence: 'high' },
      { id: 'ch-2', level: 1, titleText: 'PRD vs MRD', startIndex: 11, endIndex: 20, childCount: 0, paragraphCount: 5, source: 'heading', confidence: 'high' },
      { id: 'ch-3', level: 1, titleText: 'Ten Steps', startIndex: 21, endIndex: 50, childCount: 10, paragraphCount: 2, source: 'heading', confidence: 'high' },
      { id: 'ch-4', level: 1, titleText: 'Common Pitfalls', startIndex: 51, endIndex: 80, childCount: 5, paragraphCount: 3, source: 'heading', confidence: 'high' },
      { id: 'ch-5', level: 1, titleText: 'Conclusion', startIndex: 81, endIndex: 100, childCount: 0, paragraphCount: 2, source: 'heading', confidence: 'high' },
    ],
    chapterCount: 5,
    totalSectionCount: 7,
    globalConfidence,
  };
}

/**
 * 创建低置信度的 mock 结构（纯样式推断）
 */
function createMockStyleInferredStructure(): DocStructure {
  return {
    chapters: [
      { id: 'ch-1', level: 1, titleText: '可能的标题一', startIndex: 0, endIndex: 10, childCount: 0, paragraphCount: 3, source: 'style_inferred', confidence: 'low' },
      { id: 'ch-2', level: 1, titleText: '可能的标题二', startIndex: 11, endIndex: 20, childCount: 0, paragraphCount: 5, source: 'style_inferred', confidence: 'low' },
    ],
    allSections: [
      { id: 'ch-1', level: 1, titleText: '可能的标题一', startIndex: 0, endIndex: 10, childCount: 0, paragraphCount: 3, source: 'style_inferred', confidence: 'low' },
      { id: 'ch-2', level: 1, titleText: '可能的标题二', startIndex: 11, endIndex: 20, childCount: 0, paragraphCount: 5, source: 'style_inferred', confidence: 'low' },
    ],
    chapterCount: 2,
    totalSectionCount: 2,
    globalConfidence: 'low',
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

function createMockDocMeta(hasTitle: boolean = true, titleConfidence: Confidence = 'high'): DocMeta {
  return {
    title: hasTitle ? 'How to Write a Great PRD' : null,
    hasExplicitTitle: hasTitle && titleConfidence === 'high',
    titleSource: hasTitle ? 'heading' : 'none',
    titleConfidence: hasTitle ? titleConfidence : 'low',
    candidates: hasTitle ? [
      { text: 'How to Write a Great PRD', source: 'heading', confidence: titleConfidence, positionIndex: 0, reasons: ['H1 标题'] },
    ] : [],
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

    it('canDirectAnswer 应该支持 medium confidence', () => {
      expect(canDirectAnswer({ kind: 'chapter_count', confidence: 'medium', directAnswer: '5 章' })).toBe(true);
    });

    it('canDirectAnswer 应该尊重 shortCircuit=false', () => {
      expect(canDirectAnswer({ kind: 'chapter_count', confidence: 'high', directAnswer: '5 章', shortCircuit: false })).toBe(false);
    });

    it('needsClarification 应该正确判断', () => {
      expect(needsClarification({ kind: 'chapter_count', confidence: 'low', clarificationQuestion: '需要澄清' })).toBe(true);
      expect(needsClarification({ kind: 'chapter_count', confidence: 'high' })).toBe(false);
    });

    it('shouldShortCircuit 应该正确判断', () => {
      expect(shouldShortCircuit({ kind: 'chapter_count', confidence: 'high', directAnswer: '5 章', shortCircuit: true })).toBe(true);
      expect(shouldShortCircuit({ kind: 'chapter_count', confidence: 'high', directAnswer: '5 章', shortCircuit: false })).toBe(false);
    });
  });

  // ========== v2: 新增测试 ==========

  describe('v2: 低置信度处理', () => {
    it('globalConfidence=low 时章节计数应该返回澄清', () => {
      const envelope = createMockEnvelope({
        structure: createMockStyleInferredStructure(),
      });
      
      const result = resolveStructuralQuery('有几章', envelope);
      
      expect(result.kind).toBe('chapter_count');
      expect(result.confidence).toBe('low');
      expect(result.clarificationQuestion).toBeDefined();
      expect(result.clarificationQuestion).toContain('样式');
    });

    it('低置信度章节的定位查询应该返回不确定提示', () => {
      const envelope = createMockEnvelope({
        structure: createMockStyleInferredStructure(),
      });
      
      const result = resolveStructuralQuery('第一章', envelope);
      
      expect(result.kind).toBe('locate_chapter');
      expect(result.confidence).toBe('low');
      expect(result.clarificationQuestion).toBeDefined();
    });
  });

  describe('v2: 混合意图检测', () => {
    it('强编辑意图应该跳过结构查询', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      // 包含"重写"这个强编辑意图词
      const result = resolveStructuralQuery('重写第一章', envelope);
      
      expect(result.kind).toBe('other');
      expect(result.shortCircuit).toBe(false);
      expect(result.debugInfo).toContain('edit intent');
    });

    it('弱编辑意图 + 结构查询应该不短路', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure(),
      });
      
      // "帮我"是弱编辑意图，但"有几章"是结构查询
      const result = resolveStructuralQuery('帮我看看有几章', envelope);
      
      expect(result.kind).toBe('chapter_count');
      expect(result.shortCircuit).toBe(false);
      expect(result.debugInfo).toContain('weak edit intent');
    });
  });

  describe('v2: 标题置信度', () => {
    it('低置信度标题应该返回不确定提示', () => {
      const envelope = createMockEnvelope({
        docMeta: createMockDocMeta(true, 'low'),
      });
      
      const result = resolveStructuralQuery('文档标题是什么', envelope);
      
      expect(result.kind).toBe('title_query');
      expect(result.confidence).toBe('low');
      expect(result.clarificationQuestion).toBeDefined();
      expect(result.clarificationQuestion).toContain('置信度较低');
    });

    it('高置信度标题应该直接回答', () => {
      const envelope = createMockEnvelope({
        docMeta: createMockDocMeta(true, 'high'),
      });
      
      const result = resolveStructuralQuery('文档标题是什么', envelope);
      
      expect(result.kind).toBe('title_query');
      expect(result.confidence).toBe('high');
      expect(result.directAnswer).toBeDefined();
      expect(result.directAnswer).toContain('How to Write a Great PRD');
    });
  });

  describe('v2: structureConfidence 字段', () => {
    it('结果应该包含 structureConfidence', () => {
      const envelope = createMockEnvelope({
        structure: createMockStructure('medium'),
      });
      
      const result = resolveStructuralQuery('有几章', envelope);
      
      expect(result.structureConfidence).toBe('medium');
    });
  });
});

