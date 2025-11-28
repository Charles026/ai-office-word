/**
 * CopilotHeader - Copilot 面板头部
 * 
 * 【职责】
 * - 显示 Copilot 标题
 * - 显示当前上下文状态（针对什么）
 * - 提供折叠/关闭按钮
 * - 开发模式下提供 DocEditPlan 测试按钮
 * - 开发模式下提供 DocContext Inspector 入口
 */

import React, { useState } from 'react';
import { CopilotContext, CopilotScope } from './copilotTypes';
import { Icon } from '../components/Icon';
import { testComplexIntentExecution } from '../docAgent';
import { CopilotInspector } from './CopilotInspector';

// ==========================================
// Props
// ==========================================

interface CopilotHeaderProps {
  /** 当前上下文 */
  context: CopilotContext;
  /** 是否正在加载/思考 */
  isLoading?: boolean;
  /** 关闭面板回调 */
  onClose?: () => void;
  /** 清空会话回调 */
  onClear?: () => void;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 根据 scope 获取上下文描述文案
 */
function getContextDescription(context: CopilotContext): string {
  const { scope, sectionTitle, selectionSnippet } = context;

  switch (scope) {
    case 'selection':
      if (selectionSnippet) {
        const truncated = selectionSnippet.length > 30
          ? selectionSnippet.slice(0, 30) + '...'
          : selectionSnippet;
        return `针对：当前选区「${truncated}」`;
      }
      return '针对：当前选区';

    case 'section':
      if (sectionTitle) {
        const truncated = sectionTitle.length > 20
          ? sectionTitle.slice(0, 20) + '...'
          : sectionTitle;
        return `针对：${truncated}`;
      }
      return '针对：当前章节';

    case 'document':
      return '针对：整篇文档';

    case 'none':
    default:
      return '未绑定文档（纯聊天模式）';
  }
}

/**
 * 获取 scope 对应的图标
 */
function getScopeIcon(scope: CopilotScope): string {
  switch (scope) {
    case 'selection':
      return 'TextSelect';
    case 'section':
      return 'Heading';
    case 'document':
      return 'FileText';
    case 'none':
    default:
      return 'MessageCircle';
  }
}

// ==========================================
// 组件
// ==========================================

export const CopilotHeader: React.FC<CopilotHeaderProps> = ({
  context,
  isLoading = false,
  onClose,
  onClear,
}) => {
  const contextDescription = getContextDescription(context);
  const scopeIcon = getScopeIcon(context.scope);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [showInspector, setShowInspector] = useState(false);

  // 开发模式下的复杂意图测试
  const handleTestDocEdit = async () => {
    if (!context.docId || !context.sectionId) {
      alert('请先将光标移到某个 H2/H3 标题上，使 Copilot 感知到当前章节');
      return;
    }

    setIsTestRunning(true);
    console.log('[Test] Starting DocEditPlan test...', {
      docId: context.docId,
      sectionId: context.sectionId,
      sectionTitle: context.sectionTitle,
    });

    try {
      const result = await testComplexIntentExecution(context.docId, context.sectionId);
      console.log('[Test] Result:', result);

      if (result.success) {
        alert(`✅ 测试成功！\n\n完成了 ${result.completedSteps}/${result.totalSteps} 个步骤：\n${result.stepResults?.map(s => `• ${s.type}: ${s.durationMs}ms`).join('\n')}`);
      } else {
        alert(`❌ 测试失败\n\n错误: ${result.error}`);
      }
    } catch (error) {
      console.error('[Test] Error:', error);
      alert(`❌ 测试出错：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsTestRunning(false);
    }
  };

  // 只在开发模式显示测试按钮
  const isDev = process.env.NODE_ENV === 'development';
  
  // 状态文本
  const statusText = isLoading || isTestRunning ? '思考中...' : '空闲';

  return (
    <div className="copilot-header">
      <div className="copilot-header-left">
        <div className="copilot-header-title">
          <span className={`copilot-status-dot ${isLoading || isTestRunning ? 'thinking' : ''}`} />
          <span>Copilot</span>
          <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400, marginLeft: 4 }}>
            {statusText}
          </span>
        </div>
        <div className="copilot-header-context">
          <Icon name={scopeIcon as any} size={12} />
          <span>{contextDescription}</span>
        </div>
      </div>
      
      <div className="copilot-header-actions">
        {/* 开发模式：DocContext Inspector 按钮 */}
        {isDev && (
          <button
            className="copilot-header-btn copilot-dev-btn"
            onClick={() => setShowInspector(true)}
            title="DocContext Inspector"
            aria-label="打开调试面板"
            style={{
              background: 'rgba(139, 92, 246, 0.2)',
              color: '#a78bfa',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            Dev
          </button>
        )}
        {/* 开发模式：DocEditPlan 测试按钮 */}
        {isDev && (
          <button
            className="copilot-header-btn copilot-test-btn"
            onClick={handleTestDocEdit}
            disabled={isTestRunning || !context.sectionId}
            title="测试复杂意图（改写+高亮+摘要）"
            aria-label="测试复杂意图"
            style={{
              background: context.sectionId ? 'rgba(245, 158, 11, 0.2)' : 'rgba(107, 114, 128, 0.2)',
              color: context.sectionId ? '#fbbf24' : '#6b7280',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '11px',
            }}
          >
            {isTestRunning ? '⏳' : '🧪'}
          </button>
        )}
        {onClear && (
          <button
            className="copilot-header-btn"
            onClick={onClear}
            title="清空对话"
            aria-label="清空对话"
          >
            <Icon name="Trash2" size={14} />
          </button>
        )}
        {onClose && (
          <button
            className="copilot-header-btn"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <Icon name="X" size={16} />
          </button>
        )}
      </div>

      {/* DocContext Inspector 弹窗 */}
      {showInspector && (
        <CopilotInspector onClose={() => setShowInspector(false)} />
      )}
    </div>
  );
};

export default CopilotHeader;

