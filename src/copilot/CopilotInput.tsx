/**
 * CopilotInput - Copilot 输入区
 * 
 * 【职责】
 * - 提供多行文本输入框
 * - 处理发送逻辑
 * - 支持快捷键发送（Enter / Cmd+Enter）
 */

import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { CopilotContext } from './copilotTypes';
import { Icon } from '../components/Icon';

// ==========================================
// Props
// ==========================================

interface CopilotInputProps {
  /** 当前上下文 */
  context: CopilotContext;
  /** 发送消息回调 */
  onSend: (content: string) => void;
  /** 是否禁用（例如正在加载） */
  disabled?: boolean;
  /** 占位符文本 */
  placeholder?: string;
}

// ==========================================
// 组件
// ==========================================

export const CopilotInput: React.FC<CopilotInputProps> = ({
  context,
  onSend,
  disabled = false,
  placeholder,
}) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 动态占位符
  const getPlaceholder = (): string => {
    if (placeholder) return placeholder;
    
    switch (context.scope) {
      case 'selection':
        return '针对选区提问或下达指令...';
      case 'section':
        return `针对「${context.sectionTitle || '当前章节'}」提问...`;
      case 'document':
        return '针对文档提问或下达指令...';
      case 'none':
      default:
        return '输入消息...';
    }
  };

  // 发送消息
  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setValue('');

    // 重新聚焦
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [value, disabled, onSend]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送（Shift+Enter 换行）
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 自动调整高度
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    setValue(textarea.value);
    
    // 重置高度后计算实际需要的高度
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 120); // 最大 120px
    textarea.style.height = `${newHeight}px`;
  }, []);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="copilot-input">
      <div className="copilot-input-container">
        <textarea
          ref={textareaRef}
          className="copilot-input-textarea"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          disabled={disabled}
          rows={1}
        />
        <button
          className={`copilot-input-send ${canSend ? 'active' : ''}`}
          onClick={handleSend}
          disabled={!canSend}
          title="发送 (Enter)"
          aria-label="发送"
        >
          <Icon name="Send" size={16} />
        </button>
      </div>
      <div className="copilot-input-hint">
        <span>Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
};

export default CopilotInput;

