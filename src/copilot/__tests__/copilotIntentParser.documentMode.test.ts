/**
 * copilotIntentParser Document Mode 测试
 * 
 * 测试 Full-Doc 和 Chunked 模式下的 Prompt 构建
 */

import { describe, it, expect, vi } from 'vitest';
import { buildCopilotSystemPrompt } from '../copilotIntentParser';
import type { CopilotSessionState } from '../copilotRuntimeTypes';
import type { DocContextEnvelope } from '../../docContext';

// ==========================================
// 测试数据
// ==========================================

function createDefaultState(): CopilotSessionState {
  return {
    docId: 'test-doc',
    scope: 'document',
    focusSectionId: undefined,
    userPrefs: {
      language: 'zh',
      style: 'concise',
    },
    lastTask: undefined,
  };
}

function createFullModeEnvelope(): DocContextEnvelope {
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
      title: 'How to Write a Great PRD',
      outline: [
        { sectionId: 'sec-1', title: 'Overview', level: 2 },
        { sectionId: 'sec-2', title: 'PRD vs MRD', level: 2 },
        { sectionId: 'sec-3', title: 'Goals', level: 3 },
      ],
      totalCharCount: 5000,
      approxTotalTokenCount: 1250,
      sectionsPreview: [
        { sectionId: 'sec-1', title: 'Overview', level: 2, snippet: 'This is an overview...', charCount: 2000 },
        { sectionId: 'sec-2', title: 'PRD vs MRD', level: 2, snippet: 'PRD focuses on...', charCount: 2000 },
        { sectionId: 'sec-3', title: 'Goals', level: 3, snippet: 'Define your goals...', charCount: 1000 },
      ],
    },
    budget: {
      maxTokens: 8192,
      estimatedTokens: 1250,
    },
    meta: {
      generatedAt: Date.now(),
      generatorVersion: 'v1.2',
    },
    // Full-Doc 模式字段
    mode: 'full',
    documentFullText: `## Overview

This is an overview of how to write a great PRD.

## PRD vs MRD

PRD focuses on product requirements, while MRD focuses on market requirements.

### Goals

Define your goals clearly.`,
    documentTokenEstimate: 1250,
  };
}

function createChunkedModeEnvelope(): DocContextEnvelope {
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
    // Chunked 模式字段
    mode: 'chunked',
    documentFullText: undefined,
    documentTokenEstimate: 25000,
  };
}

// ==========================================
// 测试
// ==========================================

describe('copilotIntentParser Document Mode', () => {
  describe('buildCopilotSystemPrompt', () => {
    it('Full-Doc 模式应该包含完整文档内容', () => {
      const state = createDefaultState();
      const envelope = createFullModeEnvelope();
      
      const prompt = buildCopilotSystemPrompt(state, envelope);
      
      // 验证包含 Full-Doc 模式标记
      expect(prompt).toContain('Full-Doc');
      expect(prompt).toContain('完整文档内容');
      
      // 验证包含实际文档内容
      expect(prompt).toContain('Overview');
      expect(prompt).toContain('PRD vs MRD');
      expect(prompt).toContain('Define your goals');
      
      // 验证包含 token 估算
      expect(prompt).toContain('Token 估算');
    });

    it('Chunked 模式不应该包含完整文档内容', () => {
      const state = createDefaultState();
      const envelope = createChunkedModeEnvelope();
      
      const prompt = buildCopilotSystemPrompt(state, envelope);
      
      // 验证包含 Chunked 模式标记
      expect(prompt).toContain('Chunked');
      expect(prompt).toContain('结构预览');
      
      // 验证不包含完整文档标记
      expect(prompt).not.toContain('完整文档内容');
      
      // 验证包含大纲和预览
      expect(prompt).toContain('Section 1');
      expect(prompt).toContain('Section 2');
      expect(prompt).toContain('章节预览');
    });

    it('Full-Doc 模式应该包含 sectionId 说明', () => {
      const state = createDefaultState();
      const envelope = createFullModeEnvelope();
      
      const prompt = buildCopilotSystemPrompt(state, envelope);
      
      // 验证包含 sectionId
      expect(prompt).toContain('sec-1');
      expect(prompt).toContain('sec-2');
      expect(prompt).toContain('sec-3');
      
      // 验证包含 sectionId 使用说明
      expect(prompt).toContain('章节ID');
      expect(prompt).toContain('sectionId');
    });

    it('Full-Doc 模式应该包含使用说明', () => {
      const state = createDefaultState();
      const envelope = createFullModeEnvelope();
      
      const prompt = buildCopilotSystemPrompt(state, envelope);
      
      // 验证包含使用说明
      expect(prompt).toContain('Full-Doc 模式说明');
      expect(prompt).toContain('回答关于文档结构');
      expect(prompt).toContain('全文总结');
    });

    it('Chunked 模式应该包含限制说明', () => {
      const state = createDefaultState();
      const envelope = createChunkedModeEnvelope();
      
      const prompt = buildCopilotSystemPrompt(state, envelope);
      
      // 验证包含 Chunked 模式说明
      expect(prompt).toContain('Chunked 模式说明');
      // v1.3 更新：现在引用 skeleton.meta
      expect(prompt).toContain('skeleton.meta');
    });

    it('Section scope 不应该受 mode 影响', () => {
      const state: CopilotSessionState = {
        ...createDefaultState(),
        scope: 'section',
        focusSectionId: 'sec-1',
      };
      
      const envelope: DocContextEnvelope = {
        docId: 'test-doc',
        scope: 'section',
        focus: {
          sectionId: 'sec-1',
          sectionTitle: 'Overview',
          text: 'This is the overview section content.',
          charCount: 38,
          approxTokenCount: 10,
        },
        neighborhood: {},
        global: {
          title: 'Test Doc',
          outline: [
            { sectionId: 'sec-1', title: 'Overview', level: 2 },
          ],
        },
        budget: {
          maxTokens: 8192,
          estimatedTokens: 10,
        },
        // Section scope 不设置 mode
      };
      
      const prompt = buildCopilotSystemPrompt(state, envelope);
      
      // Section scope 应该显示章节内容
      expect(prompt).toContain('Overview');
      expect(prompt).toContain('章节内容');
      expect(prompt).toContain('This is the overview section content');
      
      // 不应该有 Full-Doc 或 Chunked 标记
      expect(prompt).not.toContain('Full-Doc');
      expect(prompt).not.toContain('Chunked');
    });
  });
});

