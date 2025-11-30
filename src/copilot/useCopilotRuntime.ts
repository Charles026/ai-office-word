/**
 * useCopilotRuntime - Copilot Runtime Hook
 * 
 * 【职责】
 * - 管理 CopilotRuntime 实例的生命周期
 * - 同步 CopilotStore 的 context 变化到 Runtime
 * - 提供 runTurn 等方法给 UI 使用
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { CopilotRuntime, createCopilotRuntime, type CopilotTurnResult } from './CopilotRuntime';
import { getCopilotEditor } from './copilotRuntimeBridge';
import { useCopilotStore } from './copilotStore';
import type { CopilotRuntimeScope } from './copilotRuntimeTypes';

// ==========================================
// 常量
// ==========================================

const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

// ==========================================
// Hook 参数
// ==========================================

interface UseCopilotRuntimeOptions {
  /** Toast 回调（可选） */
  toast?: {
    addToast: (message: string, type: 'success' | 'error' | 'info' | 'loading', duration?: number) => string;
    dismissToast: (id: string) => void;
  };
  /** 是否启用 Runtime（可用于降级开关） */
  enabled?: boolean;
}

// ==========================================
// Hook 返回值
// ==========================================

interface UseCopilotRuntimeReturn {
  /** 是否已启用 Runtime */
  isEnabled: boolean;
  /** 执行一轮对话 */
  runTurn: (userText: string) => Promise<CopilotTurnResult | null>;
  /** 设置 scope（document/section） */
  setScope: (scope: CopilotRuntimeScope, sectionId?: string) => void;
  /** 获取当前 Runtime 实例（调试用） */
  getRuntime: () => CopilotRuntime | null;
}

// ==========================================
// Hook 实现
// ==========================================

/**
 * Copilot Runtime Hook
 * 
 * 在组件中使用 CopilotRuntime 的标准方式。
 * 
 * @example
 * ```tsx
 * const { runTurn, isEnabled } = useCopilotRuntime({ enabled: true });
 * 
 * const handleSend = async (text: string) => {
 *   if (isEnabled) {
 *     const result = await runTurn(text);
 *     if (result) {
 *       // 处理 result
 *     }
 *   } else {
 *     // 降级逻辑
 *   }
 * };
 * ```
 */
export function useCopilotRuntime(
  options: UseCopilotRuntimeOptions = {}
): UseCopilotRuntimeReturn {
  const { toast, enabled = true } = options;
  
  const { context } = useCopilotStore();
  const runtimeRef = useRef<CopilotRuntime | null>(null);
  // 🆕 用 state 跟踪 runtime 是否已创建，以便触发重新渲染
  const [isRuntimeReady, setIsRuntimeReady] = React.useState(false);
  
  // 创建或更新 Runtime 实例
  useEffect(() => {
    if (!enabled) {
      runtimeRef.current = null;
      setIsRuntimeReady(false);
      return;
    }
    
    // 创建 Runtime（如果尚未创建）
    if (!runtimeRef.current) {
      runtimeRef.current = createCopilotRuntime(
        getCopilotEditor,
        toast,
        context.docId || undefined
      );
      setIsRuntimeReady(true);
      
      if (__DEV__) {
        console.log('[useCopilotRuntime] Runtime created, docId:', context.docId);
      }
    }
    
    // 同步 docId
    if (context.docId && runtimeRef.current.getSessionState().docId !== context.docId) {
      runtimeRef.current.setDocId(context.docId);
      
      if (__DEV__) {
        console.log('[useCopilotRuntime] DocId synced:', context.docId);
      }
    }
    
    // 同步 scope 和 sectionId
    const currentState = runtimeRef.current.getSessionState();
    const targetScope = context.scope === 'section' ? 'section' : 'document';
    
    if (currentState.scope !== targetScope || currentState.focusSectionId !== (context.sectionId || undefined)) {
      runtimeRef.current.setScope(
        targetScope,
        context.sectionId || undefined
      );
      
      if (__DEV__) {
        console.log('[useCopilotRuntime] Scope synced:', targetScope, context.sectionId);
      }
    }
  }, [enabled, context.docId, context.scope, context.sectionId, toast]);
  
  // runTurn 方法
  const runTurn = useCallback(async (userText: string): Promise<CopilotTurnResult | null> => {
    // 🆕 如果 runtime 还没创建，先尝试创建
    if (!runtimeRef.current && enabled && context.docId) {
      runtimeRef.current = createCopilotRuntime(
        getCopilotEditor,
        toast,
        context.docId
      );
      setIsRuntimeReady(true);
      if (__DEV__) {
        console.log('[useCopilotRuntime] Runtime created on-demand');
      }
    }
    
    if (!enabled || !runtimeRef.current) {
      if (__DEV__) {
        console.log('[useCopilotRuntime] runTurn skipped:', { enabled, hasRuntime: !!runtimeRef.current });
      }
      return null;
    }
    
    try {
      if (__DEV__) {
        console.log('[useCopilotRuntime] runTurn calling runtime...', {
          userText: userText.slice(0, 50),
          state: runtimeRef.current.getSessionState(),
        });
      }
      
      const result = await runtimeRef.current.runTurn(userText);
      
      if (__DEV__) {
        console.log('[useCopilotRuntime] runTurn result:', {
          hasIntent: !!result.intent,
          intentMode: result.intent?.mode,
          intentAction: result.intent?.action,
          executed: result.executed,
          error: result.error,
          replyTextLength: result.replyText?.length,
        });
      }
      
      return result;
    } catch (error) {
      if (__DEV__) {
        console.error('[useCopilotRuntime] runTurn error:', error);
      }
      return null;
    }
  }, [enabled, context.docId, toast]);
  
  // setScope 方法
  const setScope = useCallback((scope: CopilotRuntimeScope, sectionId?: string) => {
    if (runtimeRef.current) {
      runtimeRef.current.setScope(scope, sectionId);
    }
  }, []);
  
  // getRuntime 方法（调试用）
  const getRuntime = useCallback(() => runtimeRef.current, []);
  
  // 🆕 isEnabled 现在正确跟踪 runtime 状态
  const isEnabled = enabled && isRuntimeReady;
  
  return useMemo(() => ({
    isEnabled,
    runTurn,
    setScope,
    getRuntime,
  }), [isEnabled, runTurn, setScope, getRuntime]);
}

export default useCopilotRuntime;

