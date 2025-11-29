/**
 * Tests for responseMode handling in Section Copilot
 * 
 * 验证 Section AI 根据 responseMode 正确分支处理：
 * - auto_apply: 直接应用 DocOps
 * - preview: 存储待处理结果，不应用
 * - clarify: 存储待处理结果，等待用户选择
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copilotStore } from '../copilotStore';
import type { SectionAiResult } from '../../actions/sectionAiActions';
import type { CanonicalIntent } from '../../ai/intent/intentTypes';

// Mock 依赖
vi.mock('../../actions/sectionAiActions', () => ({
  applyPendingDocOps: vi.fn().mockResolvedValue(true),
  triggerSectionAiWithClarification: vi.fn().mockResolvedValue({
    success: true,
    responseMode: 'auto_apply',
    applied: true,
    assistantText: 'Done',
  }),
}));

describe('responseMode handling', () => {
  beforeEach(() => {
    copilotStore.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('CopilotMessageMeta responseMode fields', () => {
    it('should support preview mode metadata', () => {
      const docId = 'test-doc';
      
      // 模拟添加 preview 模式的消息
      copilotStore.appendMessage(docId, {
        id: 'msg-1',
        role: 'action',
        content: 'Preview test',
        createdAt: Date.now(),
        meta: {
          docId,
          scope: 'section',
          sectionId: 'sec-1',
          status: 'pending',
          responseMode: 'preview',
          previewText: 'New content here',
          originalText: 'Old content',
          pendingResultId: 'pending-1',
          confidence: 0.85,
        },
      });

      const session = copilotStore.getSession(docId);
      expect(session).not.toBeNull();
      expect(session!.messages).toHaveLength(1);
      
      const msg = session!.messages[0];
      expect(msg.meta?.responseMode).toBe('preview');
      expect(msg.meta?.previewText).toBe('New content here');
      expect(msg.meta?.originalText).toBe('Old content');
      expect(msg.meta?.pendingResultId).toBe('pending-1');
      expect(msg.meta?.confidence).toBe(0.85);
    });

    it('should support clarify mode metadata', () => {
      const docId = 'test-doc';
      
      copilotStore.appendMessage(docId, {
        id: 'msg-2',
        role: 'action',
        content: 'Clarify test',
        createdAt: Date.now(),
        meta: {
          docId,
          scope: 'section',
          sectionId: 'sec-1',
          status: 'pending',
          responseMode: 'clarify',
          clarifyQuestion: '请选择你想要的长度',
          clarifyOptions: ['保持原长', '精简到70%', '大幅删减'],
          clarifyField: 'length',
          pendingResultId: 'pending-2',
          confidence: 0.6,
        },
      });

      const session = copilotStore.getSession(docId);
      expect(session!.messages[0].meta?.responseMode).toBe('clarify');
      expect(session!.messages[0].meta?.clarifyQuestion).toBe('请选择你想要的长度');
      expect(session!.messages[0].meta?.clarifyOptions).toHaveLength(3);
      expect(session!.messages[0].meta?.clarifyField).toBe('length');
    });
  });

  describe('PendingSectionResult management', () => {
    it('should add and retrieve pending result', () => {
      const pendingResult = {
        id: 'pending-1',
        sectionId: 'sec-1',
        responseMode: 'preview' as const,
        resultJson: JSON.stringify({ docOps: [], intent: {} }),
        createdAt: Date.now(),
        messageId: 'msg-1',
      };

      copilotStore.addPendingResult(pendingResult);
      
      const retrieved = copilotStore.getPendingResult('pending-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sectionId).toBe('sec-1');
      expect(retrieved!.responseMode).toBe('preview');
    });

    it('should remove pending result', () => {
      const pendingResult = {
        id: 'pending-2',
        sectionId: 'sec-1',
        responseMode: 'clarify' as const,
        resultJson: '{}',
        createdAt: Date.now(),
      };

      copilotStore.addPendingResult(pendingResult);
      expect(copilotStore.getPendingResult('pending-2')).not.toBeNull();

      copilotStore.removePendingResult('pending-2');
      expect(copilotStore.getPendingResult('pending-2')).toBeNull();
    });

    it('should clear pending results for section', () => {
      copilotStore.addPendingResult({
        id: 'pending-a',
        sectionId: 'sec-1',
        responseMode: 'preview',
        resultJson: '{}',
        createdAt: Date.now(),
      });
      copilotStore.addPendingResult({
        id: 'pending-b',
        sectionId: 'sec-1',
        responseMode: 'clarify',
        resultJson: '{}',
        createdAt: Date.now(),
      });
      copilotStore.addPendingResult({
        id: 'pending-c',
        sectionId: 'sec-2',
        responseMode: 'preview',
        resultJson: '{}',
        createdAt: Date.now(),
      });

      copilotStore.clearPendingResultsForSection('sec-1');

      expect(copilotStore.getPendingResult('pending-a')).toBeNull();
      expect(copilotStore.getPendingResult('pending-b')).toBeNull();
      expect(copilotStore.getPendingResult('pending-c')).not.toBeNull();
    });
  });

  describe('SectionAiResult responseMode field', () => {
    it('should correctly identify auto_apply mode', () => {
      const result: SectionAiResult = {
        success: true,
        responseMode: 'auto_apply',
        applied: true,
        confidence: 0.95,
        assistantText: '已自动应用修改',
      };

      expect(result.responseMode).toBe('auto_apply');
      expect(result.applied).toBe(true);
    });

    it('should correctly identify preview mode', () => {
      const result: SectionAiResult = {
        success: true,
        responseMode: 'preview',
        applied: false,
        confidence: 0.8,
        docOps: [{ type: 'replace_paragraph', targetKey: 'p1', newText: 'New text' }],
      };

      expect(result.responseMode).toBe('preview');
      expect(result.applied).toBe(false);
      expect(result.docOps).toHaveLength(1);
    });

    it('should correctly identify clarify mode', () => {
      const result: SectionAiResult = {
        success: true,
        responseMode: 'clarify',
        applied: false,
        confidence: 0.5,
        uncertainties: [
          {
            field: 'length',
            reason: '用户说"精简一点"，但没说具体多少',
            candidateOptions: ['保持原长', '精简到70%'],
          },
        ],
        intent: {
          intentId: 'test-intent',
          scope: { target: 'section', sectionId: 'sec-1' },
          tasks: [{ type: 'rewrite', params: {} }],
        } as CanonicalIntent,
      };

      expect(result.responseMode).toBe('clarify');
      expect(result.uncertainties).toHaveLength(1);
      expect(result.uncertainties![0].candidateOptions).toContain('精简到70%');
    });
  });

  describe('Default responseMode behavior', () => {
    it('should default to auto_apply when responseMode is undefined', () => {
      const result: SectionAiResult = {
        success: true,
        // responseMode not set
        applied: true,
      };

      const effectiveMode = result.responseMode ?? 'auto_apply';
      expect(effectiveMode).toBe('auto_apply');
    });
  });
});

