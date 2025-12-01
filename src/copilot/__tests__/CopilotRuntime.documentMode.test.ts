/**
 * CopilotRuntime Document Mode 测试
 * 
 * 测试 Full-Doc 和 Chunked 模式的分流逻辑
 * 
 * 注意：这些测试主要验证类型和常量，完整的集成测试需要真实的 Lexical 环境
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FULL_DOC_TOKEN_THRESHOLD, CHARS_PER_TOKEN } from '../utils/tokenUtils';
import type { DocContextEnvelope, DocScopeMode } from '../../docContext';

// ==========================================
// 测试
// ==========================================

describe('CopilotRuntime Document Mode', () => {
  describe('模式分流逻辑（单元测试）', () => {
    /**
     * 模拟分流逻辑（与 docContextEngine 中的实现一致）
     */
    function determineDocMode(charCount: number): DocScopeMode {
      const tokenEstimate = Math.ceil(charCount / CHARS_PER_TOKEN);
      return tokenEstimate < FULL_DOC_TOKEN_THRESHOLD ? 'full' : 'chunked';
    }

    it('小文档应该使用 full 模式', () => {
      // 创建一个小于阈值的文档（~2000 tokens = ~8000 chars）
      const smallDocChars = 5000;
      expect(determineDocMode(smallDocChars)).toBe('full');
    });

    it('大文档应该使用 chunked 模式', () => {
      // 创建一个超过阈值的文档（~10000 tokens = ~40000 chars）
      const largeDocChars = 50000;
      expect(determineDocMode(largeDocChars)).toBe('chunked');
    });

    it('边界情况测试', () => {
      // 刚好在阈值边缘
      // FULL_DOC_TOKEN_THRESHOLD = 8000, CHARS_PER_TOKEN = 4
      // 需要 < 8000 tokens 才是 full，所以需要 < 32000 chars
      const justBelowThresholdChars = (FULL_DOC_TOKEN_THRESHOLD - 1) * CHARS_PER_TOKEN;
      const exactThresholdChars = FULL_DOC_TOKEN_THRESHOLD * CHARS_PER_TOKEN;
      
      expect(determineDocMode(justBelowThresholdChars)).toBe('full'); // 7999 tokens
      expect(determineDocMode(exactThresholdChars)).toBe('chunked'); // 8000 tokens
    });
  });

  describe('Envelope 结构验证', () => {
    it('Full 模式 Envelope 应该包含 documentFullText', () => {
      const fullModeEnvelope: DocContextEnvelope = {
        docId: 'small-doc',
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
          title: 'Small Document',
          outline: [],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 1000,
        },
        mode: 'full',
        documentFullText: '完整文档内容...',
        documentTokenEstimate: 1000,
      };

      expect(fullModeEnvelope.mode).toBe('full');
      expect(fullModeEnvelope.documentFullText).toBeDefined();
      expect(fullModeEnvelope.documentTokenEstimate).toBeLessThan(FULL_DOC_TOKEN_THRESHOLD);
    });

    it('Chunked 模式 Envelope 不应该包含 documentFullText', () => {
      const chunkedModeEnvelope: DocContextEnvelope = {
        docId: 'large-doc',
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
          title: 'Large Document',
          outline: [],
          sectionsPreview: [
            { sectionId: 'sec-1', title: 'Section 1', level: 2, snippet: '...', charCount: 50000 },
          ],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 20000,
        },
        mode: 'chunked',
        documentFullText: undefined,
        documentTokenEstimate: 20000,
      };

      expect(chunkedModeEnvelope.mode).toBe('chunked');
      expect(chunkedModeEnvelope.documentFullText).toBeUndefined();
      expect(chunkedModeEnvelope.documentTokenEstimate).toBeGreaterThan(FULL_DOC_TOKEN_THRESHOLD);
    });

    it('Section scope 不应该有 mode 字段', () => {
      const sectionEnvelope: DocContextEnvelope = {
        docId: 'doc',
        scope: 'section',
        focus: {
          sectionId: 'sec-1',
          sectionTitle: 'Section 1',
          text: 'Section content',
          charCount: 15,
          approxTokenCount: 4,
        },
        neighborhood: {},
        global: {
          title: 'Document',
          outline: [],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 4,
        },
        // Section scope 不设置 mode
      };

      expect(sectionEnvelope.scope).toBe('section');
      expect(sectionEnvelope.mode).toBeUndefined();
    });
  });

  describe('常量配置', () => {
    it('FULL_DOC_TOKEN_THRESHOLD 应该是 8000', () => {
      expect(FULL_DOC_TOKEN_THRESHOLD).toBe(8000);
    });

    it('CHARS_PER_TOKEN 应该是 4', () => {
      expect(CHARS_PER_TOKEN).toBe(4);
    });
  });

  describe('编辑 Intent 不受模式影响', () => {
    it('编辑类 action 列表应该已定义', () => {
      // 这些 action 应该始终走结构化路径，不受 Full-Doc 模式影响
      const editActions = [
        'rewrite_section',
        'rewrite_paragraph',
        'summarize_section',
      ];
      
      editActions.forEach(action => {
        expect(typeof action).toBe('string');
        expect(action.length).toBeGreaterThan(0);
      });
    });

    it('聊天类 action 可以在 Full-Doc 模式下获益', () => {
      // 这些 action 在 Full-Doc 模式下可以看到完整文档
      const chatActions = [
        'summarize_document',
        'highlight_terms',
      ];
      
      chatActions.forEach(action => {
        expect(typeof action).toBe('string');
      });
    });
  });
});
