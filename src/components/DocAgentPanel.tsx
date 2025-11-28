/**
 * DocAgentPanel - 文档 Agent 任务进度面板
 * 
 * 显示文档级 Agent 的运行状态和进度
 * 支持：DocumentSummarizerAgent、DocumentTranslateAgent 等
 */

import React from 'react';
import type { DocumentSummarizerState, AgentOverallStatus } from '../runtime/DocumentSummarizerAgent';
import type { DocAgentState, DocAgentOverallStatus } from '../runtime/docAgentRuntime';
import { Icon } from './Icon';
import './DocAgentPanel.css';

// ==========================================
// 通用任务类型（兼容两种 Agent）
// ==========================================

type TaskStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

interface GenericTask {
  heading: { id: string; level: number; text: string };
  status: TaskStatus;
  error?: string;
}

interface GenericAgentState {
  tasks: GenericTask[];
  status: DocAgentOverallStatus | AgentOverallStatus;
  currentIndex: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  agentType?: string;
  meta?: Record<string, unknown>;
}

// ==========================================
// Props
// ==========================================

interface DocAgentPanelProps {
  /** Summarizer Agent 状态 */
  state?: DocumentSummarizerState | null;
  /** Translate Agent 状态 */
  translateState?: DocAgentState | null;
  /** 取消回调 */
  onCancel?: () => void;
  /** 关闭面板回调 */
  onClose?: () => void;
  /** 是否可见 */
  visible: boolean;
}

// ==========================================
// 状态图标
// ==========================================

const STATUS_ICONS: Record<TaskStatus, { icon: string; color: string }> = {
  pending: { icon: '○', color: 'var(--text-secondary)' },
  running: { icon: '◎', color: 'var(--accent-blue)' },
  success: { icon: '✓', color: 'var(--accent-green)' },
  error: { icon: '✕', color: 'var(--accent-red)' },
  skipped: { icon: '—', color: 'var(--text-secondary)' },
};

const OVERALL_STATUS_TEXT: Record<string, string> = {
  idle: '等待开始',
  running: '正在处理...',
  success: '已完成',
  error: '部分失败',
  canceled: '已取消',
};

// 转换 Summarizer 状态为通用格式
function normalizeSummarizerState(state: DocumentSummarizerState): GenericAgentState {
  return {
    tasks: state.tasks.map(t => ({
      heading: t.section.heading,
      status: t.status,
      error: t.error,
    })),
    status: state.overallStatus,
    currentIndex: state.currentIndex,
    successCount: state.successCount,
    errorCount: state.errorCount,
    skippedCount: state.skippedCount,
    agentType: 'summarize',
  };
}

// 转换 Translate Agent 状态为通用格式
function normalizeTranslateState(state: DocAgentState): GenericAgentState {
  return {
    tasks: state.steps.map(s => ({
      heading: s.section.heading,
      status: s.status,
      error: s.error,
    })),
    status: state.status,
    currentIndex: state.currentIndex,
    successCount: state.successCount,
    errorCount: state.errorCount,
    skippedCount: state.skippedCount,
    agentType: state.agentType || 'translate',
    meta: state.meta,
  };
}

// 获取 Agent 类型标题
function getAgentTitle(agentType?: string, meta?: Record<string, unknown>): string {
  switch (agentType) {
    case 'summarize':
      return '逐节总结';
    case 'translate':
      const direction = meta?.directionLabel as string;
      return direction ? `整篇翻译（${direction}）` : '整篇翻译';
    default:
      return '文档处理';
  }
}

// ==========================================
// 组件
// ==========================================

export const DocAgentPanel: React.FC<DocAgentPanelProps> = ({
  state,
  translateState,
  onCancel,
  onClose,
  visible,
}) => {
  // 优先使用 translateState，然后是 state
  const activeState = translateState || state;
  
  if (!visible || !activeState) {
    return null;
  }

  // 转换为通用格式
  const normalizedState: GenericAgentState = translateState
    ? normalizeTranslateState(translateState)
    : normalizeSummarizerState(state!);

  const { tasks, status, currentIndex, successCount, errorCount, skippedCount, agentType, meta } = normalizedState;
  const totalCount = tasks.length;
  const completedCount = successCount + errorCount + skippedCount;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const isRunning = status === 'running';
  const isFinished = status === 'success' || status === 'error' || status === 'canceled';

  const title = getAgentTitle(agentType, meta);
  const iconName = agentType === 'translate' ? 'Languages' : 'Sparkles';

  return (
    <div className="doc-agent-panel">
      {/* 头部 */}
      <div className="doc-agent-panel-header">
        <div className="doc-agent-panel-title">
          <Icon name={iconName as any} size={16} />
          <span>{title}</span>
        </div>
        <button 
          className="doc-agent-panel-close" 
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {/* 状态概览 */}
      <div className="doc-agent-panel-status">
        <span className={`status-text status-${status}`}>
          {OVERALL_STATUS_TEXT[status] || status}
        </span>
        <span className="status-count">
          {completedCount} / {totalCount}
        </span>
      </div>

      {/* 进度条 */}
      <div className="doc-agent-panel-progress">
        <div 
          className={`progress-bar ${status}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* 任务列表 */}
      <div className="doc-agent-panel-tasks">
        {tasks.map((task, index) => (
          <GenericTaskItem 
            key={task.heading.id} 
            task={task} 
            isActive={isRunning && index === currentIndex}
          />
        ))}
      </div>

      {/* 统计信息 */}
      {isFinished && (
        <div className="doc-agent-panel-stats">
          <span className="stat success">✓ {successCount} 成功</span>
          {errorCount > 0 && <span className="stat error">✕ {errorCount} 失败</span>}
          {skippedCount > 0 && <span className="stat skipped">— {skippedCount} 跳过</span>}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="doc-agent-panel-actions">
        {isRunning && (
          <button className="action-btn cancel" onClick={onCancel}>
            <span>⏹</span>
            <span>停止</span>
          </button>
        )}
        {isFinished && (
          <button className="action-btn close" onClick={onClose}>
            <span>完成</span>
          </button>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 任务项组件（通用版本）
// ==========================================

interface GenericTaskItemProps {
  task: GenericTask;
  isActive: boolean;
}

const GenericTaskItem: React.FC<GenericTaskItemProps> = ({ task, isActive }) => {
  const { heading, status, error } = task;
  const statusInfo = STATUS_ICONS[status];

  // 截断标题
  const truncatedTitle = heading.text.length > 30
    ? heading.text.slice(0, 30) + '...'
    : heading.text;

  return (
    <div className={`task-item ${status} ${isActive ? 'active' : ''}`}>
      <span 
        className="task-status-icon" 
        style={{ color: statusInfo.color }}
      >
        {status === 'running' ? (
          <span className="spinning">◎</span>
        ) : (
          statusInfo.icon
        )}
      </span>
      <span className="task-title" title={heading.text}>
        <span className="heading-level">H{heading.level}</span>
        {truncatedTitle}
      </span>
      {error && status === 'error' && (
        <span className="task-error" title={error}>
          {error.slice(0, 20)}...
        </span>
      )}
    </div>
  );
};

export default DocAgentPanel;

