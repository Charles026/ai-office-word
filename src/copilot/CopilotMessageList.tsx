/**
 * CopilotMessageList - Copilot 消息列表
 * 
 * 【职责】
 * - 渲染消息流
 * - 区分不同角色的消息样式
 * - 支持 action 类型消息的卡片展示
 * - v2 新增：支持 preview / clarify 模式的交互卡片
 */

import React, { useEffect, useRef, useState } from 'react';
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
  /** 应用预览回调（preview 模式） */
  onApplyPreview?: (pendingResultId: string) => void;
  /** 取消预览回调（preview 模式） */
  onCancelPreview?: (pendingResultId: string) => void;
  /** 解决澄清回调（clarify 模式） */
  onResolveClarify?: (pendingResultId: string, choice: string) => void;
}

// ==========================================
// 单条消息组件
// ==========================================

interface MessageItemProps {
  message: CopilotMessage;
  onUndo?: (actionId: string) => void;
  onApplyPreview?: (pendingResultId: string) => void;
  onCancelPreview?: (pendingResultId: string) => void;
  onResolveClarify?: (pendingResultId: string, choice: string) => void;
}

const MessageItem: React.FC<MessageItemProps> = ({ 
  message, 
  onUndo,
  onApplyPreview,
  onCancelPreview,
  onResolveClarify,
}) => {
  const { id, role, content, meta, isStreaming } = message;
  const [customInput, setCustomInput] = useState('');

  // Action 类型消息使用卡片样式
  if (role === 'action') {
    const canUndo = meta?.status === 'applied' && meta?.undoable;
    const isPreview = meta?.responseMode === 'preview' && meta?.status === 'pending';
    const isClarify = meta?.responseMode === 'clarify' && meta?.status === 'pending';

    // Preview 模式卡片
    if (isPreview && meta?.pendingResultId) {
      return (
        <div className="copilot-message copilot-message-action">
          <div className="copilot-message-preview-card">
            <div className="copilot-message-action-header">
              <Icon name="Eye" size={14} />
              <span className="action-type">预览改写结果</span>
              {meta?.sectionTitle && (
                <span className="action-target">· {meta.sectionTitle}</span>
              )}
            </div>
            
            {/* 预览内容 */}
            <div className="copilot-preview-content">
              {meta.previewText ? (
                <div className="copilot-preview-text">
                  {meta.previewText}
                </div>
              ) : (
                <div className="copilot-preview-empty">无预览内容</div>
              )}
            </div>
            
            {/* 置信度显示 */}
            {meta.confidence !== undefined && (
              <div className="copilot-confidence">
                <span className="confidence-label">置信度:</span>
                <span className="confidence-value">{Math.round(meta.confidence * 100)}%</span>
              </div>
            )}
            
            {/* 操作按钮 */}
            <div className="copilot-preview-actions">
              <button
                className="copilot-preview-btn copilot-preview-btn-primary"
                onClick={() => onApplyPreview?.(meta.pendingResultId!)}
              >
                <Icon name="Check" size={14} />
                <span>应用到文档</span>
              </button>
              <button
                className="copilot-preview-btn copilot-preview-btn-secondary"
                onClick={() => onCancelPreview?.(meta.pendingResultId!)}
              >
                <Icon name="X" size={14} />
                <span>暂不应用</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Clarify 模式卡片
    if (isClarify && meta?.pendingResultId) {
      return (
        <div className="copilot-message copilot-message-action">
          <div className="copilot-message-clarify-card">
            <div className="copilot-message-action-header">
              <Icon name="HelpCircle" size={14} />
              <span className="action-type">需要确认</span>
              {meta?.sectionTitle && (
                <span className="action-target">· {meta.sectionTitle}</span>
              )}
            </div>
            
            {/* 澄清问题 */}
            <div className="copilot-clarify-question">
              {meta.clarifyQuestion || '请选择一个选项：'}
            </div>
            
            {/* 候选选项按钮 */}
            {meta.clarifyOptions && meta.clarifyOptions.length > 0 && (
              <div className="copilot-clarify-options">
                {meta.clarifyOptions.map((option, index) => (
                  <button
                    key={index}
                    className="copilot-clarify-option-btn"
                    onClick={() => onResolveClarify?.(meta.pendingResultId!, option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            
            {/* 自定义输入 */}
            <div className="copilot-clarify-custom">
              <input
                type="text"
                className="copilot-clarify-input"
                placeholder="或输入你的具体要求..."
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customInput.trim()) {
                    onResolveClarify?.(meta.pendingResultId!, customInput.trim());
                    setCustomInput('');
                  }
                }}
              />
              <button
                className="copilot-clarify-submit-btn"
                disabled={!customInput.trim()}
                onClick={() => {
                  if (customInput.trim()) {
                    onResolveClarify?.(meta.pendingResultId!, customInput.trim());
                    setCustomInput('');
                  }
                }}
              >
                <Icon name="Send" size={14} />
              </button>
            </div>
            
            {/* 置信度显示 */}
            {meta.confidence !== undefined && (
              <div className="copilot-confidence">
                <span className="confidence-label">置信度:</span>
                <span className="confidence-value">{Math.round(meta.confidence * 100)}%</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    // 默认 Action 卡片（auto_apply 或其他状态）
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
  onApplyPreview,
  onCancelPreview,
  onResolveClarify,
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
        <MessageItem 
          key={message.id} 
          message={message} 
          onUndo={onUndo}
          onApplyPreview={onApplyPreview}
          onCancelPreview={onCancelPreview}
          onResolveClarify={onResolveClarify}
        />
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

