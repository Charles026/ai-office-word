/**
 * DocContextEnvelope Document Mode 测试
 * 
 * 测试 Full-Doc 模式和 Chunked 模式的分流逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocContextEnvelope, DocScopeMode } from '../docContextTypes';
import { FULL_DOC_TOKEN_THRESHOLD, CHARS_PER_TOKEN } from '../../copilot/utils/tokenUtils';

// ==========================================
// 测试 DocContextEnvelope 结构
// ==========================================

describe('DocContextEnvelope Document Mode', () => {
  describe('类型定义', () => {
    it('DocScopeMode 应该是 full 或 chunked', () => {
      const fullMode: DocScopeMode = 'full';
      const chunkedMode: DocScopeMode = 'chunked';
      
      expect(fullMode).toBe('full');
      expect(chunkedMode).toBe('chunked');
    });

    it('DocContextEnvelope 应该支持新的字段', () => {
      const envelope: DocContextEnvelope = {
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
          title: 'Test Doc',
          outline: [],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 1000,
        },
        // 新字段
        mode: 'full',
        documentFullText: 'Some full text content',
        documentTokenEstimate: 1000,
      };

      expect(envelope.mode).toBe('full');
      expect(envelope.documentFullText).toBe('Some full text content');
      expect(envelope.documentTokenEstimate).toBe(1000);
    });

    it('新字段应该是可选的（向后兼容）', () => {
      const envelope: DocContextEnvelope = {
        docId: 'test-doc',
        scope: 'section',
        focus: {
          sectionId: 'section-1',
          sectionTitle: 'Section 1',
          text: 'Some text',
          charCount: 9,
          approxTokenCount: 3,
        },
        neighborhood: {},
        global: {
          title: 'Test Doc',
          outline: [],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 3,
        },
        // 不设置新字段
      };

      expect(envelope.mode).toBeUndefined();
      expect(envelope.documentFullText).toBeUndefined();
      expect(envelope.documentTokenEstimate).toBeUndefined();
    });
  });

  describe('模式分流逻辑', () => {
    /**
     * 模拟分流逻辑（与 docContextEngine 中的实现一致）
     */
    function determineDocMode(charCount: number): DocScopeMode {
      const tokenEstimate = Math.ceil(charCount / CHARS_PER_TOKEN);
      return tokenEstimate < FULL_DOC_TOKEN_THRESHOLD ? 'full' : 'chunked';
    }

    it('小文档应该使用 full 模式', () => {
      // 小于阈值的文档
      const smallDocChars = (FULL_DOC_TOKEN_THRESHOLD - 1000) * CHARS_PER_TOKEN;
      expect(determineDocMode(smallDocChars)).toBe('full');
    });

    it('大文档应该使用 chunked 模式', () => {
      // 超过阈值的文档
      const largeDocChars = (FULL_DOC_TOKEN_THRESHOLD + 1000) * CHARS_PER_TOKEN;
      expect(determineDocMode(largeDocChars)).toBe('chunked');
    });

    it('边界情况：刚好等于阈值应该使用 chunked 模式', () => {
      const exactThresholdChars = FULL_DOC_TOKEN_THRESHOLD * CHARS_PER_TOKEN;
      expect(determineDocMode(exactThresholdChars)).toBe('chunked');
    });

    it('边界情况：刚好小于阈值应该使用 full 模式', () => {
      const justBelowThresholdChars = (FULL_DOC_TOKEN_THRESHOLD - 1) * CHARS_PER_TOKEN;
      expect(determineDocMode(justBelowThresholdChars)).toBe('full');
    });
  });

  describe('Full 模式 Envelope 结构', () => {
    it('Full 模式应该包含 documentFullText', () => {
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
          outline: [
            { sectionId: 'sec-1', title: 'Section 1', level: 2 },
            { sectionId: 'sec-2', title: 'Section 2', level: 2 },
          ],
          totalCharCount: 5000,
          approxTotalTokenCount: 1250,
          sectionsPreview: [],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 1250,
        },
        mode: 'full',
        documentFullText: '# Section 1\n\nContent 1\n\n# Section 2\n\nContent 2',
        documentTokenEstimate: 1250,
      };

      expect(fullModeEnvelope.mode).toBe('full');
      expect(fullModeEnvelope.documentFullText).toBeDefined();
      expect(fullModeEnvelope.documentFullText!.length).toBeGreaterThan(0);
    });
  });

  describe('Chunked 模式 Envelope 结构', () => {
    it('Chunked 模式不应该包含 documentFullText', () => {
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
          outline: [
            { sectionId: 'sec-1', title: 'Section 1', level: 2 },
            { sectionId: 'sec-2', title: 'Section 2', level: 2 },
          ],
          totalCharCount: 100000,
          approxTotalTokenCount: 25000,
          sectionsPreview: [
            { sectionId: 'sec-1', title: 'Section 1', level: 2, snippet: 'Content preview...', charCount: 50000 },
            { sectionId: 'sec-2', title: 'Section 2', level: 2, snippet: 'Content preview...', charCount: 50000 },
          ],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 25000,
        },
        mode: 'chunked',
        documentFullText: undefined, // 大文档不提供全文
        documentTokenEstimate: 25000,
      };

      expect(chunkedModeEnvelope.mode).toBe('chunked');
      expect(chunkedModeEnvelope.documentFullText).toBeUndefined();
      expect(chunkedModeEnvelope.global.sectionsPreview).toBeDefined();
      expect(chunkedModeEnvelope.global.sectionsPreview!.length).toBeGreaterThan(0);
    });
  });

  describe('阈值常量', () => {
    it('FULL_DOC_TOKEN_THRESHOLD 应该是合理的值', () => {
      // 应该足够大以容纳典型 PRD 文档
      expect(FULL_DOC_TOKEN_THRESHOLD).toBeGreaterThan(2000);
      // 但不能太大以致于超过常见模型的 context window
      expect(FULL_DOC_TOKEN_THRESHOLD).toBeLessThan(32000);
    });
  });
});

