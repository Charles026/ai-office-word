/**
 * AiRewriteDialog - AI 改写对话框
 * 
 * 【职责】
 * - 显示选区改写的意图输入界面
 * - 收集用户输入的改写意图
 * - 调用 DocAgent 执行 AI 操作
 * - 显示处理状态和错误信息
 * 
 * 【DocAgent 集成】
 * - 所有 AI 操作通过 DocAgent 统一入口
 * - 支持 rewrite、summarize、translate、custom 四种意图
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import './AiRewriteDialog.css';

// ==========================================
// 类型定义（与 DocAgent 保持一致）
// ==========================================

type RewriteTone = 'formal' | 'concise' | 'friendly';
type TranslateTargetLang = 'en' | 'zh';
type DocAgentAction = 'replace' | 'insertAfter';

interface DocAgentIntent {
  type: 'rewrite' | 'summarize' | 'translate' | 'custom';
  tone?: RewriteTone;
  targetLang?: TranslateTargetLang;
  customPrompt?: string;
}

interface DocAgentResponse {
  success: boolean;
  text?: string;
  action: DocAgentAction;
  error?: string;
  latencyMs?: number;
}

// ==========================================
// 预设按钮配置
// ==========================================

interface PresetButton {
  label: string;
  intent: DocAgentIntent;
}

const PRESET_BUTTONS: PresetButton[] = [
  { label: '更正式', intent: { type: 'rewrite', tone: 'formal' } },
  { label: '更简洁', intent: { type: 'rewrite', tone: 'concise' } },
  { label: '更友好', intent: { type: 'rewrite', tone: 'friendly' } },
  { label: '翻译英文', intent: { type: 'translate', targetLang: 'en' } },
  { label: '翻译中文', intent: { type: 'translate', targetLang: 'zh' } },
  { label: '总结', intent: { type: 'summarize' } },
];

// ==========================================
// Props
// ==========================================

interface AiRewriteDialogProps {
  /** 选中的文本（用于预览） */
  selectionText: string;
  /** 执行 AI 操作的回调 */
  onExecute: (intent: DocAgentIntent) => Promise<DocAgentResponse>;
  /** 取消/关闭 */
  onCancel: () => void;
  /** 操作成功后的回调 */
  onSuccess?: (response: DocAgentResponse) => void;
}

// ==========================================
// Component
// ==========================================

export const AiRewriteDialog: React.FC<AiRewriteDialogProps> = ({
  selectionText,
  onExecute,
  onCancel,
  onSuccess,
}) => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 执行 AI 操作
  const executeIntent = useCallback(async (intent: DocAgentIntent) => {
    setLoading(true);
    setError(null);

    try {
      console.log('[AiRewriteDialog] Executing intent:', intent);
      const response = await onExecute(intent);
      
      if (response.success) {
        console.log('[AiRewriteDialog] Success:', { 
          action: response.action, 
          textLength: response.text?.length 
        });
        onSuccess?.(response);
        onCancel(); // 成功后关闭对话框
      } else {
        console.error('[AiRewriteDialog] Error:', response.error);
        setError(response.error || 'AI 处理失败');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'AI 请求失败';
      console.error('[AiRewriteDialog] Exception:', e);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [onExecute, onSuccess, onCancel]);

  // 预设按钮点击
  const handlePresetClick = useCallback((intent: DocAgentIntent) => {
    executeIntent(intent);
  }, [executeIntent]);

  // 自定义提示词执行
  const handleCustomExecute = useCallback(() => {
    const prompt = customPrompt.trim();
    if (prompt) {
      executeIntent({ type: 'custom', customPrompt: prompt });
    }
  }, [customPrompt, executeIntent]);

  // 键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCustomExecute();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [handleCustomExecute, onCancel]);

  // 截断显示的选区文本
  const displayText = selectionText.length > 100 
    ? selectionText.slice(0, 100) + '...'
    : selectionText;

  return (
    <div className="ai-rewrite-dialog-overlay" onClick={onCancel}>
      <div 
        className="ai-rewrite-dialog"
        onClick={e => e.stopPropagation()}
      >
        <div className="ai-dialog-header">
          <span className="ai-dialog-icon">✨</span>
          <span className="ai-dialog-title">AI 改写</span>
          <button 
            className="ai-dialog-close"
            onClick={onCancel}
            disabled={loading}
          >
            ×
          </button>
        </div>

        <div className="ai-dialog-content">
          {/* 选区预览 */}
          <div className="ai-selection-preview">
            <span className="ai-preview-label">选中文本：</span>
            <span className="ai-preview-text">"{displayText}"</span>
          </div>

          {/* 预设按钮 */}
          <div className="ai-preset-buttons">
            {PRESET_BUTTONS.map((item) => (
              <button
                key={item.label}
                className="ai-preset-btn"
                onClick={() => handlePresetClick(item.intent)}
                disabled={loading}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* 自定义输入 */}
          <div className="ai-input-group">
            <input
              ref={inputRef}
              type="text"
              className="ai-intent-input"
              placeholder="输入改写意图，如：改成更正式的语气"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="ai-error-message">
              {error}
            </div>
          )}
        </div>

        <div className="ai-dialog-footer">
          <button 
            className="ai-btn ai-btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            取消
          </button>
          <button
            className="ai-btn ai-btn-primary"
            onClick={handleCustomExecute}
            disabled={loading || !customPrompt.trim()}
          >
            {loading ? (
              <>
                <span className="ai-loading-spinner" />
                处理中...
              </>
            ) : (
              '执行'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiRewriteDialog;
