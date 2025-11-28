/**
 * 全局应用状态 Context
 * 
 * 【职责】
 * - 管理全局应用状态
 * - 提供状态更新方法
 * - 持久化会话数据（localStorage）
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from 'react';
import {
  AppState,
  AppView,
  LocalDocMeta,
  OpenDocTab,
  ChatSession,
  ChatMessage,
  initialAppState,
  generateId,
  extractChatTitle,
} from './types';
import { DocumentAst } from '../document/types';

// ==========================================
// Actions
// ==========================================

type AppAction =
  // 视图切换
  | { type: 'SET_VIEW'; payload: AppView }
  
  // 文档列表
  | { type: 'SET_DOCS_LOADING'; payload: boolean }
  | { type: 'SET_DOCS'; payload: LocalDocMeta[] }
  | { type: 'SET_DOCS_ERROR'; payload: string | null }
  | { type: 'ADD_DOC'; payload: LocalDocMeta }
  | { type: 'REMOVE_DOC'; payload: string }
  | { type: 'UPDATE_DOC'; payload: { id: string; updates: Partial<LocalDocMeta> } }
  
  // 文档 Tab
  | { type: 'OPEN_TAB'; payload: OpenDocTab }
  | { type: 'CLOSE_TAB'; payload: string }
  | { type: 'SET_ACTIVE_TAB'; payload: string | null }
  | { type: 'UPDATE_TAB_AST'; payload: { id: string; ast: DocumentAst } }
  | { type: 'UPDATE_TAB'; payload: { id: string; updates: Partial<OpenDocTab> } }
  | { type: 'SET_TAB_DIRTY'; payload: { id: string; isDirty: boolean } }
  
  // 会话
  | { type: 'SET_CHAT_SESSIONS'; payload: ChatSession[] }
  | { type: 'ADD_CHAT_SESSION'; payload: ChatSession }
  | { type: 'DELETE_CHAT_SESSION'; payload: string }
  | { type: 'SET_CURRENT_CHAT'; payload: string | null }
  | { type: 'ADD_CHAT_MESSAGE'; payload: { sessionId: string; message: ChatMessage } }
  | { type: 'UPDATE_CHAT_MESSAGE'; payload: { sessionId: string; messageId: string; updates: Partial<ChatMessage> } }
  | { type: 'SET_CHAT_LOADING'; payload: boolean };

// ==========================================
// Reducer
// ==========================================

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    // 视图切换
    case 'SET_VIEW':
      return { ...state, currentView: action.payload };

    // 文档列表
    case 'SET_DOCS_LOADING':
      return { ...state, docsLoading: action.payload };
    case 'SET_DOCS':
      return { ...state, docs: action.payload, docsError: null };
    case 'SET_DOCS_ERROR':
      return { ...state, docsError: action.payload };
    case 'ADD_DOC':
      return { ...state, docs: [action.payload, ...state.docs] };
    case 'REMOVE_DOC':
      return { ...state, docs: state.docs.filter(d => d.id !== action.payload) };
    case 'UPDATE_DOC':
      return {
        ...state,
        docs: state.docs.map(d =>
          d.id === action.payload.id ? { ...d, ...action.payload.updates } : d
        ),
      };

    // 文档 Tab
    case 'OPEN_TAB': {
      const exists = state.openTabs.find(t => t.id === action.payload.id);
      if (exists) {
        return { 
          ...state, 
          activeTabId: action.payload.id,
          currentView: { type: 'doc', docId: action.payload.id }
        };
      }
      return {
        ...state,
        openTabs: [...state.openTabs, action.payload],
        activeTabId: action.payload.id,
        currentView: { type: 'doc', docId: action.payload.id },
      };
    }
    case 'CLOSE_TAB': {
      const newTabs = state.openTabs.filter(t => t.id !== action.payload);
      let newActiveId = state.activeTabId;
      let newView = state.currentView;
      
      // 如果关闭的是当前激活的 tab
      if (state.activeTabId === action.payload) {
        if (newTabs.length > 0) {
          newActiveId = newTabs[newTabs.length - 1].id;
          newView = { type: 'doc', docId: newActiveId };
        } else {
          newActiveId = null;
          newView = { type: 'new' };
        }
      }
      
      return {
        ...state,
        openTabs: newTabs,
        activeTabId: newActiveId,
        currentView: newView,
      };
    }
    case 'SET_ACTIVE_TAB':
      return { 
        ...state, 
        activeTabId: action.payload,
        currentView: action.payload ? { type: 'doc', docId: action.payload } : state.currentView
      };
    case 'UPDATE_TAB_AST':
      return {
        ...state,
        openTabs: state.openTabs.map(t =>
          t.id === action.payload.id ? { ...t, ast: action.payload.ast } : t
        ),
      };
    case 'UPDATE_TAB':
      return {
        ...state,
        openTabs: state.openTabs.map(t =>
          t.id === action.payload.id ? { ...t, ...action.payload.updates } : t
        ),
      };
    case 'SET_TAB_DIRTY':
      return {
        ...state,
        openTabs: state.openTabs.map(t =>
          t.id === action.payload.id ? { ...t, isDirty: action.payload.isDirty } : t
        ),
      };

    // 会话
    case 'SET_CHAT_SESSIONS':
      return { ...state, chatSessions: action.payload };
    case 'ADD_CHAT_SESSION':
      return {
        ...state,
        chatSessions: [action.payload, ...state.chatSessions],
        currentChatId: action.payload.id,
      };
    case 'DELETE_CHAT_SESSION': {
      const newSessions = state.chatSessions.filter(s => s.id !== action.payload);
      let newCurrentId = state.currentChatId;
      
      if (state.currentChatId === action.payload) {
        newCurrentId = newSessions.length > 0 ? newSessions[0].id : null;
      }
      
      return {
        ...state,
        chatSessions: newSessions,
        currentChatId: newCurrentId,
      };
    }
    case 'SET_CURRENT_CHAT':
      return { ...state, currentChatId: action.payload };
    case 'ADD_CHAT_MESSAGE': {
      return {
        ...state,
        chatSessions: state.chatSessions.map(s => {
          if (s.id === action.payload.sessionId) {
            const messages = [...s.messages, action.payload.message];
            return {
              ...s,
              messages,
              title: extractChatTitle(messages),
              updatedAt: Date.now(),
            };
          }
          return s;
        }),
      };
    }
    case 'UPDATE_CHAT_MESSAGE':
      return {
        ...state,
        chatSessions: state.chatSessions.map(s => {
          if (s.id === action.payload.sessionId) {
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === action.payload.messageId ? { ...m, ...action.payload.updates } : m
              ),
              updatedAt: Date.now(),
            };
          }
          return s;
        }),
      };
    case 'SET_CHAT_LOADING':
      return { ...state, chatLoading: action.payload };

    default:
      return state;
  }
}

// ==========================================
// Context
// ==========================================

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  
  // 便捷方法
  setView: (view: AppView) => void;
  openDocument: (tab: OpenDocTab) => void;
  closeDocument: (id: string) => void;
  updateDocumentAst: (id: string, ast: DocumentAst) => void;
  createNewChat: () => void;
  sendChatMessage: (content: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

// ==========================================
// Provider
// ==========================================

const CHAT_STORAGE_KEY = 'ai-office-chat-sessions';

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialAppState, (initial) => {
    // 从 localStorage 恢复会话数据
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(CHAT_STORAGE_KEY);
        if (saved) {
          const sessions = JSON.parse(saved) as ChatSession[];
          return {
            ...initial,
            chatSessions: sessions,
            currentChatId: sessions.length > 0 ? sessions[0].id : null,
          };
        }
      } catch (e) {
        console.error('[AppContext] Failed to restore chat sessions:', e);
      }
    }
    return initial;
  });

  // 持久化会话数据
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state.chatSessions));
      } catch (e) {
        console.error('[AppContext] Failed to save chat sessions:', e);
      }
    }
  }, [state.chatSessions]);

  // 便捷方法
  const setView = useCallback((view: AppView) => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, []);

  const openDocument = useCallback((tab: OpenDocTab) => {
    dispatch({ type: 'OPEN_TAB', payload: tab });
  }, []);

  const closeDocument = useCallback((id: string) => {
    dispatch({ type: 'CLOSE_TAB', payload: id });
  }, []);

  const updateDocumentAst = useCallback((id: string, ast: DocumentAst) => {
    dispatch({ type: 'UPDATE_TAB_AST', payload: { id, ast } });
    dispatch({ type: 'SET_TAB_DIRTY', payload: { id, isDirty: true } });
  }, []);

  const createNewChat = useCallback(() => {
    const now = Date.now();
    const session: ChatSession = {
      id: generateId(),
      title: '新会话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: 'ADD_CHAT_SESSION', payload: session });
  }, []);

  const sendChatMessage = useCallback(async (content: string) => {
    let sessionId = state.currentChatId;
    
    // 如果没有当前会话，创建一个新的
    if (!sessionId) {
      const now = Date.now();
      sessionId = generateId();
      const session: ChatSession = {
        id: sessionId,
        title: '新会话',
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: 'ADD_CHAT_SESSION', payload: session });
    }

    // 添加用户消息
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { sessionId, message: userMessage } });

    // 添加助手消息占位
    const assistantMessageId = generateId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      isStreaming: true,
    };
    dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { sessionId, message: assistantMessage } });
    dispatch({ type: 'SET_CHAT_LOADING', payload: true });

    try {
      // 调用 AI Runtime
      const result = await window.aiDoc?.chat?.({
        messages: [
          { role: 'user', content },
        ],
      });

      if (result?.success && result.content) {
        dispatch({
          type: 'UPDATE_CHAT_MESSAGE',
          payload: {
            sessionId,
            messageId: assistantMessageId,
            updates: {
              content: result.content,
              isStreaming: false,
            },
          },
        });
      } else {
        dispatch({
          type: 'UPDATE_CHAT_MESSAGE',
          payload: {
            sessionId,
            messageId: assistantMessageId,
            updates: {
              content: result?.error || '抱歉，发生了错误',
              isStreaming: false,
            },
          },
        });
      }
    } catch (error) {
      console.error('[AppContext] Chat error:', error);
      dispatch({
        type: 'UPDATE_CHAT_MESSAGE',
        payload: {
          sessionId,
          messageId: assistantMessageId,
          updates: {
            content: '抱歉，发生了网络错误',
            isStreaming: false,
          },
        },
      });
    } finally {
      dispatch({ type: 'SET_CHAT_LOADING', payload: false });
    }
  }, [state.currentChatId]);

  const value: AppContextValue = {
    state,
    dispatch,
    setView,
    openDocument,
    closeDocument,
    updateDocumentAst,
    createNewChat,
    sendChatMessage,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

// ==========================================
// Hook
// ==========================================

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}

export function useAppState(): AppState {
  return useAppContext().state;
}

