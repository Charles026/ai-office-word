/**
 * 直接会话视图
 * 
 * 【功能】
 * - 左侧会话列表
 * - 右侧聊天界面
 * - 不绑定文档 AST
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../store';
import { ChatSession, ChatMessage } from '../store/types';
import './ChatView.css';

// ==========================================
// Icons
// ==========================================

const PlusIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3.5 3.5h7M5.25 3.5V2.625a.875.875 0 0 1 .875-.875h1.75a.875.875 0 0 1 .875.875V3.5M4.375 5.25v5.25a.875.875 0 0 0 .875.875h3.5a.875.875 0 0 0 .875-.875V5.25" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SendIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M2 9l7-7 7 7M9 2v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-45 9 9)"/>
  </svg>
);

const SparkleIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1l1.2 3.6L13 6l-3.8 1.4L8 11l-1.2-3.6L3 6l3.8-1.4L8 1z"/>
  </svg>
);

// ==========================================
// Session Item
// ==========================================

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}

const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isActive,
  onClick,
  onDelete,
}) => {
  return (
    <div
      className={`chat-session-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <span className="chat-session-title">{session.title}</span>
      <button
        className="chat-session-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="删除会话"
      >
        <TrashIcon />
      </button>
    </div>
  );
};

// ==========================================
// Message Item
// ==========================================

interface MessageItemProps {
  message: ChatMessage;
}

const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  return (
    <div className={`chat-message ${message.role}`}>
      <div className="chat-message-avatar">
        {message.role === 'user' ? '我' : <SparkleIcon />}
      </div>
      <div className="chat-message-content">
        {message.isStreaming ? (
          <span className="chat-message-typing">正在思考...</span>
        ) : (
          message.content
        )}
      </div>
    </div>
  );
};

// ==========================================
// Main Component
// ==========================================

export const ChatView: React.FC = () => {
  const { state, dispatch, createNewChat, sendChatMessage } = useAppContext();
  const { chatSessions, currentChatId, chatLoading } = state;
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 获取当前会话
  const currentSession = chatSessions.find(s => s.id === currentChatId);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, [currentChatId]);

  /**
   * 选择会话
   */
  const handleSelectSession = useCallback((sessionId: string) => {
    dispatch({ type: 'SET_CURRENT_CHAT', payload: sessionId });
  }, [dispatch]);

  /**
   * 删除会话
   */
  const handleDeleteSession = useCallback((sessionId: string) => {
    if (confirm('确定删除这个会话吗？')) {
      dispatch({ type: 'DELETE_CHAT_SESSION', payload: sessionId });
    }
  }, [dispatch]);

  /**
   * 发送消息
   */
  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || chatLoading) return;

    setInputValue('');
    await sendChatMessage(content);
  }, [inputValue, chatLoading, sendChatMessage]);

  /**
   * 键盘事件
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="chat-view">
      {/* 左侧会话列表 */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <button className="chat-new-btn" onClick={createNewChat}>
            <PlusIcon />
            <span>新建对话</span>
          </button>
        </div>
        <div className="chat-session-list">
          {chatSessions.map(session => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === currentChatId}
              onClick={() => handleSelectSession(session.id)}
              onDelete={() => handleDeleteSession(session.id)}
            />
          ))}
          {chatSessions.length === 0 && (
            <div className="chat-session-empty">
              暂无对话
            </div>
          )}
        </div>
      </div>

      {/* 右侧聊天区 */}
      <div className="chat-main">
        {currentSession ? (
          <>
            {/* 消息列表 */}
            <div className="chat-messages">
              {currentSession.messages.length === 0 && (
                <div className="chat-empty">
                  <SparkleIcon />
                  <h3>开始新对话</h3>
                  <p>你可以问我任何问题</p>
                </div>
              )}
              {currentSession.messages.map(msg => (
                <MessageItem key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区 */}
            <div className="chat-input-area">
              <div className="chat-input-wrapper">
                <textarea
                  ref={inputRef}
                  className="chat-input"
                  placeholder="输入消息..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={chatLoading}
                  rows={1}
                />
                <button
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || chatLoading}
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="chat-no-session">
            <SparkleIcon />
            <h3>选择或创建一个对话</h3>
            <p>点击左侧「新建对话」开始</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatView;

