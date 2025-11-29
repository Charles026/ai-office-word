/**
 * CopilotInspector - DocContext 调试面板 (v2)
 * 
 * 仅在开发模式下可用，用于查看：
 * - DocContextEnvelope
 * - 发送给 LLM 的 messages
 * - 基础统计信息
 * - v2 新增：CanonicalIntent 的 confidence / uncertainties / responseMode
 */

import React, { useState, useCallback } from 'react';
import { Icon } from '../components/Icon';
import { useCopilotDebug } from './copilotDebugStore';
import { CopilotDebugSnapshot, DebugMessage } from './copilotDebugTypes';
import './CopilotInspector.css';

// ==========================================
// 复制按钮组件
// ==========================================

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = '复制' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button 
      className={`inspector-copy-btn ${copied ? 'copied' : ''}`} 
      onClick={handleCopy}
      title={label}
    >
      <Icon name={copied ? 'Check' : 'Copy'} size={12} />
      <span>{copied ? '已复制' : label}</span>
    </button>
  );
};

// ==========================================
// Props
// ==========================================

interface CopilotInspectorProps {
  onClose: () => void;
}

// ==========================================
// 子组件：JSON 美化显示
// ==========================================

const JsonViewer: React.FC<{ data: unknown; maxHeight?: number }> = ({
  data,
  maxHeight = 400,
}) => {
  const formatted = JSON.stringify(data, null, 2);
  return (
    <pre
      className="inspector-json"
      style={{ maxHeight }}
    >
      {formatted}
    </pre>
  );
};

/** 获取所有消息的文本内容（用于复制） */
function getMessagesText(messages: DebugMessage[]): string {
  return messages.map(msg => `[${msg.role.toUpperCase()}]\n${msg.content}`).join('\n\n---\n\n');
}

// ==========================================
// 子组件：消息列表
// ==========================================

const MessageList: React.FC<{ messages: DebugMessage[]; title: string }> = ({
  messages,
  title,
}) => {
  const allText = getMessagesText(messages);

  if (messages.length === 0) {
    return (
      <div className="inspector-column">
        <div className="inspector-column-header">
          <span>{title}</span>
        </div>
        <div className="inspector-empty">暂无消息</div>
      </div>
    );
  }

  return (
    <div className="inspector-column">
      <div className="inspector-column-header">
        <span>{title}</span>
        <CopyButton text={allText} label="复制全部" />
      </div>
      <div className="inspector-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`inspector-message inspector-message-${msg.role}`}>
            <div className="inspector-message-header">
              <span className="inspector-message-role">{msg.role}</span>
              <div className="inspector-message-actions">
                <span className="inspector-message-length">{msg.contentLength} chars</span>
                <CopyButton text={msg.content} label="复制" />
              </div>
            </div>
            <pre className="inspector-message-content">{msg.content}</pre>
          </div>
        ))}
      </div>
    </div>
  );
};

// ==========================================
// 子组件：概览信息
// ==========================================

const SnapshotMeta: React.FC<{ snapshot: CopilotDebugSnapshot }> = ({ snapshot }) => {
  const envelope = snapshot.envelope;
  const behaviorContext = snapshot.behaviorContext;
  const canonicalIntent = snapshot.canonicalIntent;
  const estimatedTokens = envelope?.budget.estimatedTokens ?? 0;
  const maxTokens = envelope?.budget.maxTokens ?? 0;

  // 获取 responseMode 显示样式
  const getResponseModeStyle = (mode?: string) => {
    switch (mode) {
      case 'auto_apply': return { color: '#22c55e', label: '✓ Auto Apply' };
      case 'preview': return { color: '#f59e0b', label: '👁 Preview' };
      case 'clarify': return { color: '#3b82f6', label: '❓ Clarify' };
      default: return { color: '#6b7280', label: mode || '-' };
    }
  };

  // 获取 confidence 显示样式
  const getConfidenceStyle = (confidence?: number) => {
    if (confidence === undefined) return { color: '#6b7280', label: '-' };
    const pct = Math.round(confidence * 100);
    if (confidence >= 0.8) return { color: '#22c55e', label: `${pct}% ✓` };
    if (confidence >= 0.6) return { color: '#f59e0b', label: `${pct}%` };
    return { color: '#ef4444', label: `${pct}% ⚠` };
  };

  const responseModeInfo = getResponseModeStyle(canonicalIntent?.responseMode);
  const confidenceInfo = getConfidenceStyle(canonicalIntent?.confidence);

  return (
    <div className="inspector-meta">
      <div className="inspector-meta-row">
        <span className="inspector-meta-label">Scope:</span>
        <span className="inspector-meta-value">{snapshot.scope}</span>
      </div>
      {snapshot.sectionId && (
        <div className="inspector-meta-row">
          <span className="inspector-meta-label">Section ID:</span>
          <span className="inspector-meta-value">{snapshot.sectionId}</span>
        </div>
      )}
      {snapshot.sectionTitle && (
        <div className="inspector-meta-row">
          <span className="inspector-meta-label">Section Title:</span>
          <span className="inspector-meta-value">{snapshot.sectionTitle}</span>
        </div>
      )}
      <div className="inspector-meta-row">
        <span className="inspector-meta-label">Doc ID:</span>
        <span className="inspector-meta-value inspector-meta-truncate">
          {snapshot.docId || '(none)'}
        </span>
      </div>
      <div className="inspector-meta-row">
        <span className="inspector-meta-label">Used Envelope:</span>
        <span className={`inspector-meta-value ${snapshot.usedEnvelope ? 'yes' : 'no'}`}>
          {snapshot.usedEnvelope ? 'Yes ✓' : 'No'}
        </span>
      </div>
      <div className="inspector-meta-row">
        <span className="inspector-meta-label">Latency:</span>
        <span className="inspector-meta-value">
          {snapshot.timings.totalMs ? `${snapshot.timings.totalMs}ms` : '-'}
        </span>
      </div>
      {envelope && (
        <div className="inspector-meta-row">
          <span className="inspector-meta-label">Tokens (est):</span>
          <span className="inspector-meta-value">
            {estimatedTokens} / {maxTokens}
          </span>
        </div>
      )}
      
      {/* 🆕 v2: Intent Protocol 信息 */}
      {canonicalIntent && (
        <>
          <div className="inspector-meta-divider">Intent Protocol (v2)</div>
          <div className="inspector-meta-row">
            <span className="inspector-meta-label">Response Mode:</span>
            <span className="inspector-meta-value" style={{ color: responseModeInfo.color }}>
              {responseModeInfo.label}
            </span>
          </div>
          <div className="inspector-meta-row">
            <span className="inspector-meta-label">Confidence:</span>
            <span className="inspector-meta-value" style={{ color: confidenceInfo.color }}>
              {confidenceInfo.label}
            </span>
          </div>
          {canonicalIntent.uncertainties && canonicalIntent.uncertainties.length > 0 && (
            <div className="inspector-meta-row">
              <span className="inspector-meta-label">Uncertainties:</span>
              <span className="inspector-meta-value" style={{ color: '#f59e0b' }}>
                {canonicalIntent.uncertainties.length} 项
              </span>
            </div>
          )}
        </>
      )}

      {/* BehaviorContext 展示（只显示事实数据） */}
      {behaviorContext && (
        <>
          <div className="inspector-meta-divider">Behavior Metrics (v2)</div>
          <div className="inspector-meta-row">
            <span className="inspector-meta-label">Rewrite Count:</span>
            <span className="inspector-meta-value">{behaviorContext.edits.rewriteCount}</span>
          </div>
          <div className="inspector-meta-row">
            <span className="inspector-meta-label">Undo Count:</span>
            <span className="inspector-meta-value">{behaviorContext.edits.undoCount}</span>
          </div>
          {behaviorContext.metrics && (
            <>
              <div className="inspector-meta-row">
                <span className="inspector-meta-label">AI Key Sentences:</span>
                <span className="inspector-meta-value">{behaviorContext.metrics.aiKeySentenceCount}</span>
              </div>
              <div className="inspector-meta-row">
                <span className="inspector-meta-label">AI Key Terms:</span>
                <span className="inspector-meta-value">{behaviorContext.metrics.aiKeyTermCount}</span>
              </div>
              <div className="inspector-meta-row">
                <span className="inspector-meta-label">User Inline Terms:</span>
                <span className="inspector-meta-value">{behaviorContext.metrics.userInlineTermsCount}</span>
              </div>
              <div className="inspector-meta-row">
                <span className="inspector-meta-label">User Inline Sentences:</span>
                <span className="inspector-meta-value">{behaviorContext.metrics.userInlineSentenceFormatCount}</span>
              </div>
            </>
          )}
        </>
      )}
      {snapshot.error && (
        <div className="inspector-meta-row inspector-meta-error">
          <span className="inspector-meta-label">Error:</span>
          <span className="inspector-meta-value">{snapshot.error}</span>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 主组件
// ==========================================

export const CopilotInspector: React.FC<CopilotInspectorProps> = ({ onClose }) => {
  const { lastSnapshot, history, clear } = useCopilotDebug();
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 当前显示的快照
  const currentSnapshot = history[selectedIndex] || lastSnapshot;

  return (
    <div className="inspector-overlay" onClick={onClose}>
      <div className="inspector-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="inspector-header">
          <div className="inspector-header-left">
            <Icon name="Bug" size={18} />
            <span className="inspector-title">DocContext Inspector</span>
            <span className="inspector-badge">DEV</span>
          </div>
          <div className="inspector-header-right">
            <span className="inspector-history-count">
              {history.length} snapshots
            </span>
            {history.length > 0 && (
              <button className="inspector-btn inspector-btn-clear" onClick={clear}>
                Clear
              </button>
            )}
            <button className="inspector-btn inspector-btn-close" onClick={onClose}>
              <Icon name="X" size={16} />
            </button>
          </div>
        </div>

        {/* 历史选择器 */}
        {history.length > 1 && (
          <div className="inspector-history-selector">
            <label>History:</label>
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
            >
              {history.map((snap, idx) => (
                <option key={snap.id} value={idx}>
                  #{idx + 1} - {snap.scope} - {new Date(snap.createdAt).toLocaleTimeString()}
                  {snap.error ? ' ⚠️' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 内容区 */}
        {currentSnapshot ? (
          <>
            {/* Meta 信息 */}
            <SnapshotMeta snapshot={currentSnapshot} />

            {/* 三栏布局 */}
            <div className="inspector-columns">
              {/* 左：Envelope */}
              <div className="inspector-column">
                <div className="inspector-column-header">
                  <span>Envelope</span>
                  {currentSnapshot.envelope && (
                    <CopyButton 
                      text={JSON.stringify(currentSnapshot.envelope, null, 2)} 
                      label="复制" 
                    />
                  )}
                </div>
                {currentSnapshot.envelope ? (
                  <JsonViewer data={currentSnapshot.envelope} />
                ) : (
                  <div className="inspector-empty">
                    未使用 DocContextEnvelope
                  </div>
                )}
              </div>

              {/* 中：Request */}
              <MessageList
                messages={currentSnapshot.requestMessages}
                title="Request → LLM"
              />

              {/* 右：Response */}
              <MessageList
                messages={currentSnapshot.responseMessages}
                title="Response ← LLM"
              />
            </div>

            {(currentSnapshot.canonicalIntent || currentSnapshot.docOpsPlan) && (
              <div className="inspector-columns">
                {currentSnapshot.canonicalIntent && (
                  <div className="inspector-column">
                    <div className="inspector-column-header">
                      <span>Canonical Intent</span>
                      <CopyButton
                        text={JSON.stringify(currentSnapshot.canonicalIntent, null, 2)}
                        label="复制"
                      />
                    </div>
                    <JsonViewer data={currentSnapshot.canonicalIntent} />
                  </div>
                )}
                {currentSnapshot.docOpsPlan && (
                  <div className="inspector-column">
                    <div className="inspector-column-header">
                      <span>DocOps Plan</span>
                      <CopyButton
                        text={JSON.stringify(currentSnapshot.docOpsPlan, null, 2)}
                        label="复制"
                      />
                    </div>
                    <JsonViewer data={currentSnapshot.docOpsPlan} />
                  </div>
                )}
              </div>
            )}

            {/* 🆕 v2: Uncertainties 详情展示 */}
            {currentSnapshot.canonicalIntent?.uncertainties && 
             currentSnapshot.canonicalIntent.uncertainties.length > 0 && (
              <div className="inspector-uncertainties">
                <div className="inspector-column-header">
                  <span>⚠️ Uncertainties ({currentSnapshot.canonicalIntent.uncertainties.length})</span>
                </div>
                <div className="inspector-uncertainties-list">
                  {currentSnapshot.canonicalIntent.uncertainties.map((uncertainty, idx) => (
                    <div key={idx} className="inspector-uncertainty-item">
                      <div className="inspector-uncertainty-field">
                        <strong>Field:</strong> {uncertainty.field}
                      </div>
                      <div className="inspector-uncertainty-reason">
                        <strong>Reason:</strong> {uncertainty.reason}
                      </div>
                      {uncertainty.candidateOptions && uncertainty.candidateOptions.length > 0 && (
                        <div className="inspector-uncertainty-options">
                          <strong>Options:</strong>{' '}
                          {uncertainty.candidateOptions.map((opt, i) => (
                            <span key={i} className="inspector-option-badge">{opt}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentSnapshot.assistantResponse && (
              <div className="inspector-assistant-response">
                <div className="inspector-column-header">
                  <span>Assistant Message</span>
                  <CopyButton text={currentSnapshot.assistantResponse} label="复制" />
                </div>
                <pre className="inspector-message-content">
                  {currentSnapshot.assistantResponse}
                </pre>
              </div>
            )}
          </>
        ) : (
          <div className="inspector-empty-state">
            <Icon name="Search" size={48} />
            <p>暂无调试数据</p>
            <p className="inspector-hint">请先触发一次 Copilot 请求</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CopilotInspector;

