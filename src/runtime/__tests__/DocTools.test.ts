/**
 * DocTools 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  truncateText,
  extractSelectionContext,
  validateSelectionText,
  applyEdits,
  createReplaceEdit,
  createInsertEdit,
} from '../DocTools';

describe('DocTools', () => {
  describe('truncateText', () => {
    it('应该不截断短文本', () => {
      const result = truncateText('Hello', 10);
      expect(result).toBe('Hello');
    });

    it('应该截断长文本', () => {
      const result = truncateText('Hello World', 5);
      expect(result).toBe('Hello...');
    });

    it('应该处理边界情况', () => {
      const result = truncateText('Hello', 5);
      expect(result).toBe('Hello');
    });
  });

  describe('extractSelectionContext', () => {
    it('应该正确提取上下文', () => {
      const fullText = 'Before. Selected. After.';
      //                 0123456789...
      // "Selected" 从索引 8 到 16
      const result = extractSelectionContext(fullText, 8, 16, 50);
      
      expect(result.selectionText).toBe('Selected');
      expect(result.beforeText).toBe('Before. ');
      expect(result.afterText).toBe('. After.');
    });

    it('应该处理文本开头的选区', () => {
      const fullText = 'Hello World';
      const result = extractSelectionContext(fullText, 0, 5, 50);
      
      expect(result.selectionText).toBe('Hello');
      expect(result.beforeText).toBe('');
    });

    it('应该处理文本结尾的选区', () => {
      const fullText = 'Hello World';
      const result = extractSelectionContext(fullText, 6, 11, 50);
      
      expect(result.selectionText).toBe('World');
      expect(result.afterText).toBe('');
    });
  });

  describe('validateSelectionText', () => {
    it('应该拒绝空字符串', () => {
      const result = validateSelectionText('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('选区为空');
    });

    it('应该拒绝只有空白的字符串', () => {
      const result = validateSelectionText('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('选区只包含空白字符');
    });

    it('应该拒绝过长的字符串', () => {
      const longText = 'a'.repeat(6000);
      const result = validateSelectionText(longText);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('选区文本过长');
    });

    it('应该接受有效的字符串', () => {
      const result = validateSelectionText('Hello World');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('applyEdits', () => {
    it('应该应用替换操作', () => {
      const original = 'Hello World';
      const edits = [createReplaceEdit(0, 5, 'Hi')];
      const result = applyEdits(original, edits);
      expect(result).toBe('Hi World');
    });

    it('应该应用插入操作', () => {
      const original = 'Hello World';
      const edits = [createInsertEdit(5, ' Beautiful')];
      const result = applyEdits(original, edits);
      expect(result).toBe('Hello Beautiful World');
    });

    it('应该应用多个操作', () => {
      const original = 'Hello World';
      const edits = [
        createReplaceEdit(0, 5, 'Hi'),
        createReplaceEdit(6, 11, 'Universe'),
      ];
      const result = applyEdits(original, edits);
      expect(result).toBe('Hi Universe');
    });

    it('应该正确处理操作顺序', () => {
      const original = 'ABCDEF';
      // 从后往前替换，避免位置偏移
      const edits = [
        createReplaceEdit(0, 2, 'XX'),  // AB -> XX
        createReplaceEdit(4, 6, 'YY'),  // EF -> YY
      ];
      const result = applyEdits(original, edits);
      expect(result).toBe('XXCDYY');
    });
  });

  describe('createReplaceEdit', () => {
    it('应该创建正确的替换操作', () => {
      const edit = createReplaceEdit(0, 5, 'Hello');
      expect(edit).toEqual({
        type: 'replace',
        start: 0,
        end: 5,
        content: 'Hello',
      });
    });
  });

  describe('createInsertEdit', () => {
    it('应该创建正确的插入操作', () => {
      const edit = createInsertEdit(5, 'World');
      expect(edit).toEqual({
        type: 'insert',
        start: 5,
        content: 'World',
      });
    });
  });
});

