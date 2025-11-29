/**
 * Copilot 状态管理
 * 
 * 【职责】
 * - 管理 Copilot 会话（按 docId 存储）
 * - 管理当前上下文快照
 * - 提供状态更新方法
 * 
 * 【设计】
 * - 单一来源的状态管理
 * - 支持订阅状态变化
 * - DEV 模式下有调试日志
 */

import {
  CopilotSession,
  CopilotContext,
  CopilotMessage,
  CopilotActionMeta,
  createDefaultContext,
} from './copilotTypes';

// ==========================================
// 状态类型
// ==========================================

/**
 * 待处理的 Section AI 结果（用于 preview / clarify 模式）
 */
export interface PendingSectionResult {
  /** 唯一 ID */
  id: string;
  /** Section ID */
  sectionId: string;
  /** 响应模式 */
  responseMode: 'preview' | 'clarify';
  /** 完整的 SectionAiResult（JSON 序列化后存储） */
  resultJson: string;
  /** 创建时间 */
  createdAt: number;
  /** 关联的消息 ID */
  messageId?: string;
}

export interface CopilotState {
  /** 会话：按 docId 存储 */
  sessions: Record<string, CopilotSession>;
  /** 当前上下文 */
  context: CopilotContext;
  /** 待处理的 Section AI 结果（key = pendingResultId） */
  pendingResults: Record<string, PendingSectionResult>;
}

// ==========================================
// 状态变更监听器
// ==========================================

type CopilotListener = (state: CopilotState) => void;

// ==========================================
// 默认状态
// ==========================================

const GLOBAL_SESSION_KEY = '__global__';
const MAX_LAST_ACTIONS = 10;

function createInitialState(): CopilotState {
  return {
    sessions: {},
    context: createDefaultContext(),
    pendingResults: {},
  };
}

// ==========================================
// Store 实现
// ==========================================

class CopilotStore {
  private state: CopilotState;
  private listeners: Set<CopilotListener>;
  private isDev: boolean;

  constructor() {
    this.state = createInitialState();
    this.listeners = new Set();
    this.isDev = typeof process !== 'undefined' 
      ? process.env.NODE_ENV === 'development'
      : true;
  }

  // ==========================================
  // 状态访问
  // ==========================================

  getState(): CopilotState {
    return this.state;
  }

  getContext(): CopilotContext {
    return this.state.context;
  }

  getSession(docId: string): CopilotSession | null {
    return this.state.sessions[docId] || null;
  }

  getActiveSession(): CopilotSession | null {
    const docId = this.state.context.docId;
    if (!docId) {
      // 如果没有激活文档，使用全局会话
      return this.state.sessions[GLOBAL_SESSION_KEY] || null;
    }
    return this.state.sessions[docId] || null;
  }

  // ==========================================
  // 状态订阅
  // ==========================================

  subscribe(listener: CopilotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  private log(action: string, payload?: unknown): void {
    if (this.isDev) {
      console.debug(`[CopilotStore] ${action}`, payload);
    }
  }

  // ==========================================
  // Actions: 文档管理
  // ==========================================

  /**
   * 设置当前激活文档
   */
  setActiveDoc(docId: string | null): void {
    this.log('setActiveDoc', { docId });

    const newContext: CopilotContext = {
      ...this.state.context,
      docId,
      lastUpdatedAt: Date.now(),
    };

    // 如果 docId 为 null，重置上下文
    if (docId === null) {
      newContext.scope = 'none';
      newContext.sectionId = null;
      newContext.sectionTitle = null;
      newContext.selectionSnippet = null;
    } else {
      // 切换到新文档时，默认 scope 为 document
      newContext.scope = 'document';
      newContext.sectionId = null;
      newContext.sectionTitle = null;
      newContext.selectionSnippet = null;
    }

    this.state = {
      ...this.state,
      context: newContext,
    };

    this.notify();
  }

  // ==========================================
  // Actions: 消息管理
  // ==========================================

  /**
   * 追加消息到指定文档会话
   */
  appendMessage(docId: string | null, message: CopilotMessage): void {
    const sessionKey = docId || GLOBAL_SESSION_KEY;
    this.log('appendMessage', { sessionKey, messageId: message.id, role: message.role });

    const existingSession = this.state.sessions[sessionKey];
    const now = Date.now();

    let session: CopilotSession;
    if (existingSession) {
      session = {
        ...existingSession,
        messages: [...existingSession.messages, message],
        updatedAt: now,
      };
    } else {
      // 创建新会话
      session = {
        docId: sessionKey,
        messages: [message],
        createdAt: now,
        updatedAt: now,
      };
    }

    this.state = {
      ...this.state,
      sessions: {
        ...this.state.sessions,
        [sessionKey]: session,
      },
    };

    this.notify();
  }

  /**
   * 更新指定消息
   */
  updateMessage(
    docId: string | null,
    messageId: string,
    updates: Partial<CopilotMessage>
  ): void {
    const sessionKey = docId || GLOBAL_SESSION_KEY;
    const session = this.state.sessions[sessionKey];
    if (!session) return;

    this.log('updateMessage', { sessionKey, messageId, updates });

    const updatedMessages = session.messages.map(msg =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    );

    this.state = {
      ...this.state,
      sessions: {
        ...this.state.sessions,
        [sessionKey]: {
          ...session,
          messages: updatedMessages,
          updatedAt: Date.now(),
        },
      },
    };

    this.notify();
  }

  /**
   * 更新指定消息的 meta（浅合并）
   */
  updateMessageMeta(
    docId: string | null,
    messageId: string,
    metaPatch: Partial<CopilotMessage['meta']>
  ): void {
    const sessionKey = docId || GLOBAL_SESSION_KEY;
    const session = this.state.sessions[sessionKey];
    if (!session) return;

    this.log('updateMessageMeta', { sessionKey, messageId, metaPatch });

    const updatedMessages = session.messages.map(msg => {
      if (msg.id !== messageId) return msg;
      return {
        ...msg,
        meta: {
          ...msg.meta,
          ...metaPatch,
        },
      };
    });

    this.state = {
      ...this.state,
      sessions: {
        ...this.state.sessions,
        [sessionKey]: {
          ...session,
          messages: updatedMessages,
          updatedAt: Date.now(),
        },
      },
    };

    this.notify();
  }

  /**
   * 替换整个会话的消息（用于清空重建）
   */
  replaceMessages(docId: string | null, messages: CopilotMessage[]): void {
    const sessionKey = docId || GLOBAL_SESSION_KEY;
    this.log('replaceMessages', { sessionKey, count: messages.length });

    const existingSession = this.state.sessions[sessionKey];
    const now = Date.now();

    const session: CopilotSession = existingSession
      ? { ...existingSession, messages, updatedAt: now }
      : { docId: sessionKey, messages, createdAt: now, updatedAt: now };

    this.state = {
      ...this.state,
      sessions: {
        ...this.state.sessions,
        [sessionKey]: session,
      },
    };

    this.notify();
  }

  /**
   * 清空指定文档的会话
   */
  clearSession(docId: string | null): void {
    const sessionKey = docId || GLOBAL_SESSION_KEY;
    this.log('clearSession', { sessionKey });

    const newSessions = { ...this.state.sessions };
    delete newSessions[sessionKey];

    this.state = {
      ...this.state,
      sessions: newSessions,
    };

    this.notify();
  }

  // ==========================================
  // Actions: 上下文管理
  // ==========================================

  /**
   * 更新上下文（部分更新）
   */
  updateContext(partial: Partial<CopilotContext>): void {
    this.log('updateContext', partial);

    this.state = {
      ...this.state,
      context: {
        ...this.state.context,
        ...partial,
        lastUpdatedAt: Date.now(),
      },
    };

    this.notify();
  }

  /**
   * 记录最近操作
   */
  pushLastAction(action: CopilotActionMeta): void {
    this.log('pushLastAction', action);

    const lastActions = [...this.state.context.lastActions, action];
    
    // 限制长度为最近 10 条
    if (lastActions.length > MAX_LAST_ACTIONS) {
      lastActions.shift();
    }

    this.state = {
      ...this.state,
      context: {
        ...this.state.context,
        lastActions,
        lastUpdatedAt: Date.now(),
      },
    };

    this.notify();
  }

  // ==========================================
  // Actions: 待处理结果管理 (preview / clarify)
  // ==========================================

  /**
   * 添加待处理的 Section AI 结果
   */
  addPendingResult(result: PendingSectionResult): void {
    this.log('addPendingResult', { id: result.id, responseMode: result.responseMode });

    this.state = {
      ...this.state,
      pendingResults: {
        ...this.state.pendingResults,
        [result.id]: result,
      },
    };

    this.notify();
  }

  /**
   * 获取待处理结果
   */
  getPendingResult(id: string): PendingSectionResult | null {
    return this.state.pendingResults[id] || null;
  }

  /**
   * 移除待处理结果
   */
  removePendingResult(id: string): void {
    this.log('removePendingResult', { id });

    const newPendingResults = { ...this.state.pendingResults };
    delete newPendingResults[id];

    this.state = {
      ...this.state,
      pendingResults: newPendingResults,
    };

    this.notify();
  }

  /**
   * 清理指定 section 的所有待处理结果
   */
  clearPendingResultsForSection(sectionId: string): void {
    this.log('clearPendingResultsForSection', { sectionId });

    const newPendingResults = { ...this.state.pendingResults };
    for (const [id, result] of Object.entries(newPendingResults)) {
      if (result.sectionId === sectionId) {
        delete newPendingResults[id];
      }
    }

    this.state = {
      ...this.state,
      pendingResults: newPendingResults,
    };

    this.notify();
  }

  // ==========================================
  // 重置
  // ==========================================

  reset(): void {
    this.log('reset');
    this.state = createInitialState();
    this.notify();
  }
}

// ==========================================
// 单例导出
// ==========================================

export const copilotStore = new CopilotStore();

// ==========================================
// React Hook
// ==========================================

import { useSyncExternalStore, useCallback } from 'react';

/**
 * 使用 Copilot Store 的 Hook
 */
export function useCopilotStore() {
  const state = useSyncExternalStore(
    useCallback((cb) => copilotStore.subscribe(cb), []),
    () => copilotStore.getState(),
    () => copilotStore.getState()
  );

  return {
    // 状态
    state,
    context: state.context,
    sessions: state.sessions,
    pendingResults: state.pendingResults,

    // Actions
    setActiveDoc: (docId: string | null) => copilotStore.setActiveDoc(docId),
    appendMessage: (docId: string | null, message: CopilotMessage) =>
      copilotStore.appendMessage(docId, message),
    updateMessage: (docId: string | null, messageId: string, updates: Partial<CopilotMessage>) =>
      copilotStore.updateMessage(docId, messageId, updates),
    updateMessageMeta: (docId: string | null, messageId: string, metaPatch: Partial<CopilotMessage['meta']>) =>
      copilotStore.updateMessageMeta(docId, messageId, metaPatch),
    replaceMessages: (docId: string | null, messages: CopilotMessage[]) =>
      copilotStore.replaceMessages(docId, messages),
    clearSession: (docId: string | null) => copilotStore.clearSession(docId),
    updateContext: (partial: Partial<CopilotContext>) => copilotStore.updateContext(partial),
    pushLastAction: (action: CopilotActionMeta) => copilotStore.pushLastAction(action),
    
    // v2 新增：待处理结果管理
    addPendingResult: (result: PendingSectionResult) => copilotStore.addPendingResult(result),
    getPendingResult: (id: string) => copilotStore.getPendingResult(id),
    removePendingResult: (id: string) => copilotStore.removePendingResult(id),
    clearPendingResultsForSection: (sectionId: string) => copilotStore.clearPendingResultsForSection(sectionId),

    // 辅助方法
    getActiveSession: () => copilotStore.getActiveSession(),
    getSession: (docId: string) => copilotStore.getSession(docId),
  };
}

/**
 * 仅订阅上下文变化的 Hook
 */
export function useCopilotContext() {
  const context = useSyncExternalStore(
    useCallback((cb) => copilotStore.subscribe(cb), []),
    () => copilotStore.getContext(),
    () => copilotStore.getContext()
  );

  return context;
}

export default copilotStore;

