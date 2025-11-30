/**
 * CopilotRuntime 类型测试
 * 
 * 验证类型守约和 guard 函数
 */

import { describe, it, expect } from 'vitest';
import {
  CopilotIntent,
  CopilotAction,
  CopilotMode,
  CopilotRuntimeScope,
  CopilotSessionState,
  ParagraphRef,
  createDefaultSessionState,
  isCopilotAction,
  isCopilotMode,
  isCopilotRuntimeScope,
  isParagraphRef,
  isParagraphAction,
  intentRequiresSectionId,
  isSpecialSectionId,
  validateCopilotIntent,
  parseCopilotIntentSafe,
} from '../copilotRuntimeTypes';

describe('copilotRuntimeTypes', () => {
  // ==========================================
  // Guard 函数测试
  // ==========================================

  describe('isCopilotAction', () => {
    it('should return true for valid actions', () => {
      expect(isCopilotAction('rewrite_section')).toBe(true);
      expect(isCopilotAction('rewrite_paragraph')).toBe(true); // v1.1 新增
      expect(isCopilotAction('summarize_section')).toBe(true);
      expect(isCopilotAction('summarize_document')).toBe(true);
      expect(isCopilotAction('highlight_terms')).toBe(true);
    });

    it('should return false for invalid actions', () => {
      expect(isCopilotAction('invalid_action')).toBe(false);
      expect(isCopilotAction('')).toBe(false);
      expect(isCopilotAction(null)).toBe(false);
      expect(isCopilotAction(undefined)).toBe(false);
      expect(isCopilotAction(123)).toBe(false);
    });
  });

  // v1.1 新增：段落引用类型测试
  describe('isParagraphRef', () => {
    it('should return true for valid paragraph refs', () => {
      expect(isParagraphRef('current')).toBe(true);
      expect(isParagraphRef('previous')).toBe(true);
      expect(isParagraphRef('next')).toBe(true);
      expect(isParagraphRef('nth')).toBe(true);
    });

    it('should return false for invalid paragraph refs', () => {
      expect(isParagraphRef('invalid')).toBe(false);
      expect(isParagraphRef('')).toBe(false);
      expect(isParagraphRef(null)).toBe(false);
      expect(isParagraphRef(undefined)).toBe(false);
      expect(isParagraphRef(1)).toBe(false);
    });
  });

  // v1.1 新增：段落操作判断
  describe('isParagraphAction', () => {
    it('should return true for paragraph-level actions', () => {
      expect(isParagraphAction('rewrite_paragraph')).toBe(true);
    });

    it('should return false for section-level actions', () => {
      expect(isParagraphAction('rewrite_section')).toBe(false);
      expect(isParagraphAction('summarize_section')).toBe(false);
      expect(isParagraphAction('summarize_document')).toBe(false);
    });
  });

  // v1.1 新增：特殊 sectionId 判断
  describe('isSpecialSectionId', () => {
    it('should return true for special section IDs', () => {
      expect(isSpecialSectionId('current')).toBe(true);
      expect(isSpecialSectionId('auto')).toBe(true);
    });

    it('should return false for regular section IDs', () => {
      expect(isSpecialSectionId('sec-001')).toBe(false);
      expect(isSpecialSectionId('abc-123')).toBe(false);
      expect(isSpecialSectionId('')).toBe(false);
      expect(isSpecialSectionId(null)).toBe(false);
    });
  });

  describe('isCopilotMode', () => {
    it('should return true for valid modes', () => {
      expect(isCopilotMode('chat')).toBe(true);
      expect(isCopilotMode('edit')).toBe(true);
    });

    it('should return false for invalid modes', () => {
      expect(isCopilotMode('invalid')).toBe(false);
      expect(isCopilotMode('')).toBe(false);
      expect(isCopilotMode(null)).toBe(false);
    });
  });

  describe('isCopilotRuntimeScope', () => {
    it('should return true for valid scopes', () => {
      expect(isCopilotRuntimeScope('document')).toBe(true);
      expect(isCopilotRuntimeScope('section')).toBe(true);
    });

    it('should return false for invalid scopes', () => {
      expect(isCopilotRuntimeScope('selection')).toBe(false);
      expect(isCopilotRuntimeScope('none')).toBe(false);
      expect(isCopilotRuntimeScope('')).toBe(false);
    });
  });

  describe('intentRequiresSectionId', () => {
    it('should return true for section-level actions', () => {
      expect(intentRequiresSectionId('rewrite_section')).toBe(true);
      expect(intentRequiresSectionId('rewrite_paragraph')).toBe(true); // v1.1 新增
      expect(intentRequiresSectionId('summarize_section')).toBe(true);
      expect(intentRequiresSectionId('highlight_terms')).toBe(true);
    });

    it('should return false for document-level actions', () => {
      expect(intentRequiresSectionId('summarize_document')).toBe(false);
    });
  });

  // ==========================================
  // validateCopilotIntent 测试
  // ==========================================

  describe('validateCopilotIntent', () => {
    it('should validate a correct chat intent', () => {
      const intent: CopilotIntent = {
        mode: 'chat',
        action: 'summarize_document',
        target: { scope: 'document' },
      };
      expect(validateCopilotIntent(intent)).toBe(true);
    });

    it('should validate a correct edit intent with sectionId', () => {
      const intent: CopilotIntent = {
        mode: 'edit',
        action: 'rewrite_section',
        target: { scope: 'section', sectionId: 'abc123' },
      };
      expect(validateCopilotIntent(intent)).toBe(true);
    });

    // v1.1 新增：段落级 Intent 验证
    it('should validate a correct rewrite_paragraph intent', () => {
      const intent: CopilotIntent = {
        mode: 'edit',
        action: 'rewrite_paragraph',
        target: { scope: 'section', sectionId: 'sec-001' },
        params: { paragraphRef: 'current' },
      };
      expect(validateCopilotIntent(intent)).toBe(true);
    });

    it('should validate rewrite_paragraph with nth paragraphRef', () => {
      const intent: CopilotIntent = {
        mode: 'edit',
        action: 'rewrite_paragraph',
        target: { scope: 'section', sectionId: 'sec-001' },
        params: { paragraphRef: 'nth', paragraphIndex: 3 },
      };
      expect(validateCopilotIntent(intent)).toBe(true);
    });

    it('should validate rewrite_paragraph with special sectionId "current"', () => {
      const intent: CopilotIntent = {
        mode: 'edit',
        action: 'rewrite_paragraph',
        target: { scope: 'section', sectionId: 'current' },
        params: { paragraphRef: 'current' },
      };
      expect(validateCopilotIntent(intent)).toBe(true);
    });

    it('should reject intent without mode', () => {
      const intent = {
        action: 'rewrite_section',
        target: { scope: 'section', sectionId: 'abc123' },
      };
      expect(validateCopilotIntent(intent)).toBe(false);
    });

    it('should reject intent without action', () => {
      const intent = {
        mode: 'edit',
        target: { scope: 'section', sectionId: 'abc123' },
      };
      expect(validateCopilotIntent(intent)).toBe(false);
    });

    it('should reject section action without sectionId', () => {
      const intent = {
        mode: 'edit',
        action: 'rewrite_section',
        target: { scope: 'section' }, // 缺少 sectionId
      };
      expect(validateCopilotIntent(intent)).toBe(false);
    });

    it('should reject section action with document scope', () => {
      const intent = {
        mode: 'edit',
        action: 'rewrite_section',
        target: { scope: 'document' }, // 不匹配
      };
      expect(validateCopilotIntent(intent)).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(validateCopilotIntent(null)).toBe(false);
      expect(validateCopilotIntent(undefined)).toBe(false);
    });

    it('should reject non-object values', () => {
      expect(validateCopilotIntent('string')).toBe(false);
      expect(validateCopilotIntent(123)).toBe(false);
      expect(validateCopilotIntent([])).toBe(false);
    });
  });

  // ==========================================
  // parseCopilotIntentSafe 测试
  // ==========================================

  describe('parseCopilotIntentSafe', () => {
    it('should parse valid intent JSON', () => {
      const json = {
        mode: 'edit',
        action: 'summarize_section',
        target: { scope: 'section', sectionId: 'sec-001' },
        params: { bulletCount: 3 },
      };
      const result = parseCopilotIntentSafe(json);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe('edit');
      expect(result?.action).toBe('summarize_section');
      expect(result?.target.sectionId).toBe('sec-001');
    });

    it('should return null for invalid intent', () => {
      const json = {
        mode: 'invalid',
        action: 'rewrite_section',
      };
      expect(parseCopilotIntentSafe(json)).toBeNull();
    });

    it('should return null for empty object', () => {
      expect(parseCopilotIntentSafe({})).toBeNull();
    });
  });

  // ==========================================
  // createDefaultSessionState 测试
  // ==========================================

  describe('createDefaultSessionState', () => {
    it('should create a valid default state', () => {
      const state = createDefaultSessionState('doc-001');
      
      expect(state.docId).toBe('doc-001');
      expect(state.scope).toBe('document');
      expect(state.userPrefs.language).toBe('zh');
      expect(state.userPrefs.style).toBe('concise');
      expect(state.focusSectionId).toBeUndefined();
      expect(state.lastTask).toBeUndefined();
    });

    it('should allow modification of state', () => {
      const state = createDefaultSessionState('doc-002');
      state.scope = 'section';
      state.focusSectionId = 'sec-abc';
      state.lastTask = 'rewrite_section';
      
      expect(state.scope).toBe('section');
      expect(state.focusSectionId).toBe('sec-abc');
      expect(state.lastTask).toBe('rewrite_section');
    });
  });
});

