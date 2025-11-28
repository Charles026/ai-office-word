/**
 * Copilot 调试状态存储
 * 
 * 用于记录和访问 Copilot 调用的调试信息
 */

import {
  CopilotDebugSnapshot,
  CopilotDebugState,
} from './copilotDebugTypes';

// ==========================================
// 常量
// ==========================================

/** 最大历史记录数 */
const MAX_HISTORY = 50;

// ==========================================
// Store 实现
// ==========================================

type DebugListener = (state: CopilotDebugState) => void;

class CopilotDebugStore {
  private state: CopilotDebugState;
  private listeners: Set<DebugListener>;

  constructor() {
    this.state = {
      lastSnapshot: null,
      history: [],
    };
    this.listeners = new Set();
  }

  /**
   * 获取当前状态
   */
  getState(): CopilotDebugState {
    return this.state;
  }

  /**
   * 获取最近一次快照
   */
  getLastSnapshot(): CopilotDebugSnapshot | null {
    return this.state.lastSnapshot;
  }

  /**
   * 获取历史记录
   */
  getHistory(): CopilotDebugSnapshot[] {
    return this.state.history;
  }

  /**
   * 设置最新快照
   */
  setSnapshot(snapshot: CopilotDebugSnapshot): void {
    // 更新 lastSnapshot
    this.state.lastSnapshot = snapshot;

    // 添加到历史（最新在前）
    this.state.history = [
      snapshot,
      ...this.state.history.slice(0, MAX_HISTORY - 1),
    ];

    this.notify();

    // DEV 日志
    if (process.env.NODE_ENV === 'development') {
      console.log('[CopilotDebug] Snapshot recorded:', {
        id: snapshot.id,
        scope: snapshot.scope,
        sectionId: snapshot.sectionId,
        usedEnvelope: snapshot.usedEnvelope,
        totalMs: snapshot.timings.totalMs,
        error: snapshot.error,
      });
    }
  }

  /**
   * 清空历史
   */
  clear(): void {
    this.state = {
      lastSnapshot: null,
      history: [],
    };
    this.notify();
  }

  /**
   * 订阅状态变化
   */
  subscribe(listener: DebugListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   */
  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

// 单例导出
export const copilotDebugStore = new CopilotDebugStore();

// ==========================================
// React Hook
// ==========================================

import { useState, useEffect } from 'react';

/**
 * 使用 Copilot 调试状态的 Hook
 */
export function useCopilotDebug() {
  const [state, setState] = useState<CopilotDebugState>(
    copilotDebugStore.getState()
  );

  useEffect(() => {
    return copilotDebugStore.subscribe(setState);
  }, []);

  return {
    lastSnapshot: state.lastSnapshot,
    history: state.history,
    clear: () => copilotDebugStore.clear(),
  };
}

