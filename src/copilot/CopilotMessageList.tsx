/**
 * CopilotMessageList - Copilot 消息列表
 * 
 * 【职责】
 * - 渲染消息流
 * - 区分不同角色的消息样式
 * - 支持 action 类型消息的卡片展示
 */

import React, { useEffect, useRef } from 'react';
import type { CopilotMessage } from './copilotTypes';
import { Icon } from '../components/Icon';

// ==========================================
// Props
// ==========================================

interface CopilotMessageListProps {
  /** 消息列表 */
  messages: CopilotMessage[];
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 撤销回调 */
  onUndo?: (actionId: string) => void;
}

// ==========================================
// 单条消息组件
// ==========================================

interface MessageItemProps {
  message: CopilotMessage;
  onUndo?: (actionId: string) => void;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, onUndo }) => {
  const { id, role, content, meta, isStreaming } = message;

  // Action 类型消息使用卡片样式
  if (role === 'action') {
    const canUndo = meta?.status === 'applied' && meta?.undoable;

    return (
      <div className={`copilot-message copilot-message-action`}>
        <div className="copilot-message-action-card">
          <div className="copilot-message-action-header">
            <Icon name="Zap" size={14} />
            <span className="action-type">{meta?.actionType || '操作'}</span>
            {meta?.sectionTitle && (
              <span className="action-target">· {meta.sectionTitle}</span>
            )}
          </div>
          <div className="copilot-message-action-content">
            {content}
          </div>
          {meta?.status && (
            <div className={`copilot-message-action-status status-${meta.status}`}>
              {meta.status === 'pending' && '处理中...'}
              {meta.status === 'applied' && '已应用'}
              {meta.status === 'failed' && `失败: ${meta.error || '未知错误'}`}
              {meta.status === 'reverted' && '已撤销'}
            </div>
          )}
          
          {canUndo && onUndo && (
            <button
              className="copilot-undo-btn"
              onClick={() => onUndo(id)}
              title="撤销本次修改"
            >
              <Icon name="Undo" size={12} />
              <span>撤销修改</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // System 消息
  if (role === 'system') {
    return (
      <div className="copilot-message copilot-message-system">
        <div className="copilot-message-system-content">
          <Icon name="Info" size={14} />
          <span>{content}</span>
        </div>
      </div>
    );
  }

  // User / Assistant 消息
  const isUser = role === 'user';
  
  return (
    <div className={`copilot-message copilot-message-${role}`}>
      {!isUser && (
        <div className="copilot-message-avatar">
          <Icon name="Sparkles" size={14} />
        </div>
      )}
      <div className="copilot-message-bubble">
        <div className="copilot-message-content">
          {content}
          {isStreaming && <span className="copilot-message-cursor">▋</span>}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 列表组件
// ==========================================

export const CopilotMessageList: React.FC<CopilotMessageListProps> = ({
  messages,
  isLoading,
  onUndo,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // 空状态
  if (messages.length === 0 && !isLoading) {
    return (
      <div className="copilot-message-list copilot-message-list-empty">
        <div className="copilot-empty-state">
          <Icon name="MessageCircle" size={32} />
          <p>开始和 Copilot 对话</p>
          <span className="copilot-empty-hint">
            你可以问我任何问题，或者让我帮你改写、总结文档内容
          </span>
        </div>
      </div>
    );
  }

  // 按 createdAt 升序排列
  const sortedMessages = [...messages].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="copilot-message-list" ref={listRef}>
      {sortedMessages.map((message) => (
        <MessageItem key={message.id} message={message} onUndo={onUndo} />
      ))}
      {isLoading && (
        <div className="copilot-message copilot-message-assistant copilot-message-loading">
          <div className="copilot-message-avatar">
            <Icon name="Sparkles" size={14} />
          </div>
          <div className="copilot-message-bubble">
            <div className="copilot-typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CopilotMessageList;

