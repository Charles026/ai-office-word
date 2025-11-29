/**
 * EditorStateProvider - 统一编辑器状态提供者
 * 
 * 【职责】
 * - 提供统一的编辑器状态接口
 * - 根据 feature flags 从不同来源获取状态
 * - 支持订阅状态变化
 * 
 * 【状态来源】
 * - DocumentRuntime: canUndo, canRedo, selection, ast
 * - Lexical: 格式状态、列表状态等（v1 仍从 Lexical 获取）
 * 
 * 【迁移策略】
 * v1: canUndo/canRedo 可切换到 DocumentRuntime
 * v2: 更多状态逐步迁移
 */

import { documentRuntime, DocumentRuntime, DocumentRuntimeSnapshot } from '../../document/DocumentRuntime';
import { getCommandFeatureFlags } from './featureFlags';

// ==========================================
// 状态类型
// ==========================================

/**
 * 统一编辑器状态
 */
export interface UnifiedEditorState {
  // 历史状态
  canUndo: boolean;
  canRedo: boolean;
  
  // 选区状态
  hasSelection: boolean;
  isCollapsed: boolean;
  
  // 文档版本
  version: number;
  
  // 状态来源（用于调试）
  _sources: {
    history: 'runtime' | 'lexical';
    selection: 'runtime' | 'lexical';
  };
}

/**
 * Lexical 状态报告（从 MinimalEditor 传入）
 */
export interface LexicalStateReport {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  activeFormats: string[];
  // ... 其他字段
}

// ==========================================
// EditorStateProvider
// ==========================================

type StateListener = (state: UnifiedEditorState) => void;

export class EditorStateProvider {
  private runtime: DocumentRuntime;
  private lexicalState: LexicalStateReport | null = null;
  private listeners: Set<StateListener> = new Set();
  private unsubscribeRuntime: (() => void) | null = null;

  constructor(runtime: DocumentRuntime = documentRuntime) {
    this.runtime = runtime;
    
    // 订阅 runtime 状态变化
    this.unsubscribeRuntime = this.runtime.subscribe(() => {
      this.notify();
    });
  }

  /**
   * 更新 Lexical 状态
   * 
   * 由 StateReporterPlugin 调用
   */
  updateLexicalState(state: LexicalStateReport): void {
    this.lexicalState = state;
    this.notify();
  }

  /**
   * 获取统一状态
   */
  getState(): UnifiedEditorState {
    const flags = getCommandFeatureFlags();
    const runtimeSnapshot = this.runtime.getSnapshot();

    // 决定状态来源
    const useRuntimeForHistory = flags.useCommandBusForHistory;
    
    // 历史状态
    let canUndo: boolean;
    let canRedo: boolean;
    let historySource: 'runtime' | 'lexical';

    if (useRuntimeForHistory) {
      canUndo = runtimeSnapshot.canUndo;
      canRedo = runtimeSnapshot.canRedo;
      historySource = 'runtime';
    } else {
      canUndo = this.lexicalState?.canUndo ?? false;
      canRedo = this.lexicalState?.canRedo ?? false;
      historySource = 'lexical';
    }

    // 选区状态（v1 仍从 Lexical 获取）
    const hasSelection = this.lexicalState?.hasSelection ?? false;
    const isCollapsed = runtimeSnapshot.selection 
      ? runtimeSnapshot.selection.anchor.blockId === runtimeSnapshot.selection.focus.blockId &&
        runtimeSnapshot.selection.anchor.offset === runtimeSnapshot.selection.focus.offset
      : true;

    return {
      canUndo,
      canRedo,
      hasSelection,
      isCollapsed,
      version: runtimeSnapshot.version,
      _sources: {
        history: historySource,
        selection: 'lexical', // v1 始终从 Lexical 获取
      },
    };
  }

  /**
   * 订阅状态变化
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 通知所有监听者
   */
  private notify(): void {
    const state = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[EditorStateProvider] Listener error:', error);
      }
    });
  }

  /**
   * 销毁
   */
  dispose(): void {
    if (this.unsubscribeRuntime) {
      this.unsubscribeRuntime();
      this.unsubscribeRuntime = null;
    }
    this.listeners.clear();
  }
}

// ==========================================
// 单例
// ==========================================

let globalProvider: EditorStateProvider | null = null;

/**
 * 获取全局 EditorStateProvider
 */
export function getEditorStateProvider(): EditorStateProvider {
  if (!globalProvider) {
    globalProvider = new EditorStateProvider();
  }
  return globalProvider;
}

/**
 * 重置全局 Provider（用于测试）
 */
export function resetEditorStateProvider(): void {
  if (globalProvider) {
    globalProvider.dispose();
    globalProvider = null;
  }
}

// ==========================================
// React Hook
// ==========================================

import { useSyncExternalStore, useCallback } from 'react';

/**
 * 使用统一编辑器状态的 Hook
 */
export function useUnifiedEditorState(): UnifiedEditorState {
  const provider = getEditorStateProvider();
  
  const state = useSyncExternalStore(
    useCallback((cb) => provider.subscribe(cb), [provider]),
    () => provider.getState(),
    () => provider.getState()
  );
  
  return state;
}

/**
 * 用于更新 Lexical 状态的 Hook
 * 
 * 在 StateReporterPlugin 中调用
 */
export function useUpdateLexicalState() {
  const provider = getEditorStateProvider();
  
  return useCallback((state: LexicalStateReport) => {
    provider.updateLexicalState(state);
  }, [provider]);
}

