/**
 * Token 估算工具测试
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokensForText,
  estimateTokensForCharCount,
  isDocumentSmallEnoughForFullMode,
  isTextSmallEnoughForFullMode,
  FULL_DOC_TOKEN_THRESHOLD,
  CHARS_PER_TOKEN,
} from '../tokenUtils';

describe('tokenUtils', () => {
  describe('estimateTokensForText', () => {
    it('应该对空字符串返回 0', () => {
      expect(estimateTokensForText('')).toBe(0);
    });

    it('应该对 null/undefined 返回 0', () => {
      // @ts-expect-error - 测试边界情况
      expect(estimateTokensForText(null)).toBe(0);
      // @ts-expect-error - 测试边界情况
      expect(estimateTokensForText(undefined)).toBe(0);
    });

    it('应该对短文本返回正确估算值', () => {
      const text = 'Hello, World!'; // 13 chars
      const expected = Math.ceil(13 / CHARS_PER_TOKEN);
      expect(estimateTokensForText(text)).toBe(expected);
    });

    it('应该对中文文本返回正确估算值', () => {
      const text = '你好，世界！'; // 6 chars
      const expected = Math.ceil(6 / CHARS_PER_TOKEN);
      expect(estimateTokensForText(text)).toBe(expected);
    });

    it('应该对大段文本单调增长', () => {
      const short = 'A'.repeat(100);
      const medium = 'A'.repeat(1000);
      const long = 'A'.repeat(10000);

      const shortTokens = estimateTokensForText(short);
      const mediumTokens = estimateTokensForText(medium);
      const longTokens = estimateTokensForText(long);

      expect(shortTokens).toBeLessThan(mediumTokens);
      expect(mediumTokens).toBeLessThan(longTokens);
    });

    it('应该使用 CHARS_PER_TOKEN 常量进行计算', () => {
      const text = 'A'.repeat(100);
      expect(estimateTokensForText(text)).toBe(Math.ceil(100 / CHARS_PER_TOKEN));
    });
  });

  describe('estimateTokensForCharCount', () => {
    it('应该对 0 返回 0', () => {
      expect(estimateTokensForCharCount(0)).toBe(0);
    });

    it('应该对负数返回 0', () => {
      expect(estimateTokensForCharCount(-100)).toBe(0);
    });

    it('应该返回与 estimateTokensForText 相同的结果', () => {
      const charCount = 1000;
      const text = 'A'.repeat(charCount);
      expect(estimateTokensForCharCount(charCount)).toBe(estimateTokensForText(text));
    });
  });

  describe('isDocumentSmallEnoughForFullMode', () => {
    it('应该对小于阈值的文档返回 true', () => {
      expect(isDocumentSmallEnoughForFullMode(5000)).toBe(true);
      expect(isDocumentSmallEnoughForFullMode(7999)).toBe(true);
    });

    it('应该对等于阈值的文档返回 false', () => {
      expect(isDocumentSmallEnoughForFullMode(FULL_DOC_TOKEN_THRESHOLD)).toBe(false);
    });

    it('应该对大于阈值的文档返回 false', () => {
      expect(isDocumentSmallEnoughForFullMode(10000)).toBe(false);
      expect(isDocumentSmallEnoughForFullMode(100000)).toBe(false);
    });

    it('应该支持自定义阈值', () => {
      expect(isDocumentSmallEnoughForFullMode(5000, 4000)).toBe(false);
      expect(isDocumentSmallEnoughForFullMode(5000, 6000)).toBe(true);
    });
  });

  describe('isTextSmallEnoughForFullMode', () => {
    it('应该对空文本返回 true', () => {
      expect(isTextSmallEnoughForFullMode('')).toBe(true);
    });

    it('应该对小文本返回 true', () => {
      const smallText = 'A'.repeat(1000); // ~250 tokens
      expect(isTextSmallEnoughForFullMode(smallText)).toBe(true);
    });

    it('应该对大文本返回 false', () => {
      // 创建一个超过阈值的文本
      // FULL_DOC_TOKEN_THRESHOLD = 8000, CHARS_PER_TOKEN = 4
      // 需要 8000 * 4 = 32000 chars
      const largeText = 'A'.repeat(40000);
      expect(isTextSmallEnoughForFullMode(largeText)).toBe(false);
    });
  });

  describe('常量', () => {
    it('FULL_DOC_TOKEN_THRESHOLD 应该是合理的值', () => {
      expect(FULL_DOC_TOKEN_THRESHOLD).toBeGreaterThan(1000);
      expect(FULL_DOC_TOKEN_THRESHOLD).toBeLessThan(100000);
    });

    it('CHARS_PER_TOKEN 应该是合理的值', () => {
      expect(CHARS_PER_TOKEN).toBeGreaterThan(1);
      expect(CHARS_PER_TOKEN).toBeLessThan(10);
    });
  });
});

