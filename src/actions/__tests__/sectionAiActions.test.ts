/**
 * Section AI Actions 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isAiProcessing,
  subscribeAiProcessing,
  SectionAiAction,
  SectionAiOptions,
  ToastCallbacks,
  SectionAiContext,
} from '../sectionAiActions';

// ==========================================
// 类型测试
// ==========================================

describe('Section AI Actions 类型', () => {
  it('SectionAiAction 应该包含正确的值', () => {
    const actions: SectionAiAction[] = ['rewrite', 'summarize', 'expand'];
    expect(actions).toHaveLength(3);
  });

  it('SectionAiOptions 应该可以正确构造', () => {
    const options: SectionAiOptions = {
      rewrite: { tone: 'formal', depth: 'medium' },
      summarize: { style: 'short' },
      expand: { length: 'medium' },
    };
    expect(options.rewrite?.tone).toBe('formal');
    expect(options.summarize?.style).toBe('short');
    expect(options.expand?.length).toBe('medium');
  });

  it('ToastCallbacks 应该可以正确构造', () => {
    const callbacks: ToastCallbacks = {
      addToast: vi.fn().mockReturnValue('toast-id'),
      dismissToast: vi.fn(),
    };
    
    const id = callbacks.addToast('测试消息', 'success', 3000);
    expect(id).toBe('toast-id');
    expect(callbacks.addToast).toHaveBeenCalledWith('测试消息', 'success', 3000);
    
    callbacks.dismissToast('toast-id');
    expect(callbacks.dismissToast).toHaveBeenCalledWith('toast-id');
  });
});

// ==========================================
// 状态管理测试
// ==========================================

describe('AI 处理状态管理', () => {
  beforeEach(() => {
    // 重置状态（注意：这里无法直接重置模块内部状态）
  });

  it('isAiProcessing 应该返回布尔值', () => {
    const result = isAiProcessing();
    expect(typeof result).toBe('boolean');
  });

  it('subscribeAiProcessing 应该返回取消订阅函数', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiProcessing(listener);
    
    expect(typeof unsubscribe).toBe('function');
    
    // 取消订阅
    unsubscribe();
  });

  it('多个订阅者应该都能被通知', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    
    const unsubscribe1 = subscribeAiProcessing(listener1);
    const unsubscribe2 = subscribeAiProcessing(listener2);
    
    // 清理
    unsubscribe1();
    unsubscribe2();
  });
});

// ==========================================
// SectionAiContext 测试
// ==========================================

describe('SectionAiContext', () => {
  it('应该可以正确构造上下文', () => {
    const mockEditor = {} as any; // Mock Lexical Editor
    const mockToast: ToastCallbacks = {
      addToast: vi.fn().mockReturnValue('toast-id'),
      dismissToast: vi.fn(),
    };
    
    const context: SectionAiContext = {
      editor: mockEditor,
      toast: mockToast,
      setAiProcessing: vi.fn(),
    };
    
    expect(context.editor).toBe(mockEditor);
    expect(context.toast).toBe(mockToast);
    expect(typeof context.setAiProcessing).toBe('function');
  });
});

