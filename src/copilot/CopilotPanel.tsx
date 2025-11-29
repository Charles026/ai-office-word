/**
 * CopilotPanel - Copilot 右侧面板
 * 
 * 【职责】
 * - 展示面板头部（当前上下文状态 + 控制按钮）
 * - 展示消息列表
 * - 展示输入框
 * - 解析自然语言命令并执行文档操作
 * 
 * 【世界观】
 * Copilot 不是一个小插件，而是「文档语义层 + 操作层」之间的中枢。
 * 它能感知用户在 Word 里的 GUI 行为，并通过自然语言实现精确的文档操作。
 * 
 * 「自然语言只是入口，真正的权力在 Intent & DocOps，Copilot 是中枢而不是聊天玩具。」
 */

import React, { useCallback, useState } from 'react';
import { useCopilotStore } from './copilotStore';
import { CopilotHeader } from './CopilotHeader';
import { CopilotMessageList } from './CopilotMessageList';
import { CopilotInput } from './CopilotInput';
import { callCopilotModel } from './copilotModelCaller';
import { resolveCopilotCommandByRules, getRoughKind } from './copilotCommands';
import { routeIntentWithLLM } from './intentRouterAgent';
import { 
  runCopilotCommand, 
  applyPreviewResult, 
  cancelPreviewResult, 
  resolveClarification 
} from './copilotRuntimeBridge';
import { undoCopilotAction } from './copilotUndo';
import { createUserMessage, createAssistantMessage } from './copilotTypes';
import './CopilotPanel.css';

// ==========================================
// Props
// ==========================================

interface CopilotPanelProps {
  /** 是否可见 */
  visible: boolean;
  /** 关闭面板回调 */
  onClose?: () => void;
}

// ==========================================
// 组件
// ==========================================

export const CopilotPanel: React.FC<CopilotPanelProps> = ({
  visible,
  onClose,
}) => {
  const {
    context,
    sessions,
    appendMessage,
    updateMessage,
    clearSession,
  } = useCopilotStore();

  const [isLoading, setIsLoading] = useState(false);

  // 获取当前会话
  const docId = context.docId;
  const sessionKey = docId || '__global__';
  const activeSession = sessions[sessionKey];
  const messages = activeSession?.messages ?? [];

  // 发送消息 - 两级解析架构
  const handleSend = useCallback(async (content: string) => {
    if (isLoading) return;

    // 0. 基础准备
    const userMessage = createUserMessage(content, {
      docId: docId || undefined,
      scope: context.scope,
      sectionId: context.sectionId || undefined,
      sectionTitle: context.sectionTitle || undefined,
    });
    appendMessage(docId, userMessage);

    setIsLoading(true);

    try {
      // === 第一级：规则层粗解析 ===
      const ruleResult = resolveCopilotCommandByRules(content, context);
      
      // 高置信度规则：直接当命令执行
      if (ruleResult && ruleResult.confidence === 'high' && ruleResult.docId) {
        console.log('[CopilotPanel] Rule matched (high confidence):', ruleResult.command);
        await runCopilotCommand(ruleResult, userMessage);
        return;
      }

      // === 第二级：LLM Router（只在有 docId 时调用） ===
      if (context.docId && content.length >= 4) {
        const roughKind = ruleResult?.roughKind ?? getRoughKind(content);
        
        // 调用 LLM Router
        console.log('[CopilotPanel] Calling Intent Router...', { roughKind });
        const routerResult = await routeIntentWithLLM(content, context, roughKind);
        
        if (routerResult.mode === 'command' && routerResult.command) {
          console.log('[CopilotPanel] Router selected command:', routerResult.command.command, 'reason:', routerResult.reason);
          await runCopilotCommand(routerResult.command, userMessage);
          return;
        }
        
        console.log('[CopilotPanel] Router chose chat:', routerResult.reason);
      }

      // === Fallback：普通聊天（使用 DocContextEnvelope） ===
      console.log('[CopilotPanel] Fallback to chat');
      
      // 创建占位的助手消息
      const assistantMessage = createAssistantMessage('', true);
      appendMessage(docId, assistantMessage);

      // 🆕 智能选择 scope：
      // - 如果有 sectionId，使用 section scope
      // - 如果有 docId 但没有 sectionId，使用 document scope（让 LLM 能看到整篇文档）
      // - 否则使用 none
      let effectiveScope = context.scope;
      if (docId && !context.sectionId && context.scope !== 'document') {
        effectiveScope = 'document';
        console.log('[CopilotPanel] Auto-upgrading scope to "document" (no sectionId)');
      }

      // 调用 LLM（通过统一入口）
      const allMessages = [...messages, userMessage];
      const response = await callCopilotModel({
        docId,
        scope: effectiveScope,
        sectionId: context.sectionId || undefined,
        userInput: content,
        context,
        messages: allMessages,
      });

      // DEV: 打印 envelope 信息
      if (process.env.NODE_ENV === 'development' && response.envelope) {
        console.log('[CopilotPanel] DocContextEnvelope used:', {
          scope: response.envelope.scope,
          title: response.envelope.global.title,
          sectionTitle: response.envelope.focus.sectionTitle,
          charCount: response.envelope.scope === 'document' 
            ? response.envelope.global.totalCharCount 
            : response.envelope.focus.charCount,
          outlineCount: response.envelope.global.outline.length,
          sectionsPreviewCount: response.envelope.global.sectionsPreview?.length || 0,
        });
      }

      // 更新助手消息
      updateMessage(docId, assistantMessage.id, {
        content: response.content,
        isStreaming: false,
      });

    } catch (error) {
      console.error('[CopilotPanel] Send error:', error);
      const errorMessage = createAssistantMessage(
        '抱歉，发生了错误。请稍后重试。'
      );
      appendMessage(docId, errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [context, docId, messages, isLoading, appendMessage, updateMessage]);

  // 清空会话
  const handleClear = useCallback(() => {
    if (window.confirm('确定要清空当前对话吗？')) {
      clearSession(docId);
    }
  }, [docId, clearSession]);

  // 撤销操作
  const handleUndo = useCallback(async (actionId: string) => {
    if (!docId) return;
    
    if (window.confirm('确定要撤销这次修改吗？')) {
      try {
        await undoCopilotAction(docId, actionId);
      } catch (error) {
        console.error('[CopilotPanel] Undo error:', error);
        // 这里可以改用 toast，但 CopilotPanel 内部暂时没有 toast context，简单起见用 alert 或 console
        // 更好的做法是通过 copilotStore 添加一条 system 消息提示错误
        const errorMsg = createAssistantMessage(`撤销失败：${error instanceof Error ? error.message : '未知错误'}`);
        appendMessage(docId, errorMsg);
      }
    }
  }, [docId, appendMessage]);

  // v2 新增：应用预览
  const handleApplyPreview = useCallback(async (pendingResultId: string) => {
    setIsLoading(true);
    try {
      const success = await applyPreviewResult(pendingResultId);
      if (!success) {
        const errorMsg = createAssistantMessage('应用失败，请重试。');
        appendMessage(docId, errorMsg);
      }
    } catch (error) {
      console.error('[CopilotPanel] Apply preview error:', error);
      const errorMsg = createAssistantMessage(`应用失败：${error instanceof Error ? error.message : '未知错误'}`);
      appendMessage(docId, errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [docId, appendMessage]);

  // v2 新增：取消预览
  const handleCancelPreview = useCallback((pendingResultId: string) => {
    cancelPreviewResult(pendingResultId);
  }, []);

  // v2 新增：解决澄清
  const handleResolveClarify = useCallback(async (pendingResultId: string, choice: string) => {
    setIsLoading(true);
    try {
      await resolveClarification(pendingResultId, choice);
    } catch (error) {
      console.error('[CopilotPanel] Resolve clarify error:', error);
      const errorMsg = createAssistantMessage(`处理失败：${error instanceof Error ? error.message : '未知错误'}`);
      appendMessage(docId, errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [docId, appendMessage]);

  if (!visible) {
    return null;
  }

  return (
    <div className="copilot-panel">
      <CopilotHeader
        context={context}
        isLoading={isLoading}
        onClose={onClose}
        onClear={messages.length > 0 ? handleClear : undefined}
      />
      <CopilotMessageList
        messages={messages}
        isLoading={isLoading}
        onUndo={handleUndo}
        onApplyPreview={handleApplyPreview}
        onCancelPreview={handleCancelPreview}
        onResolveClarify={handleResolveClarify}
      />
      <CopilotInput
        context={context}
        onSend={handleSend}
        disabled={isLoading}
      />
    </div>
  );
};

export default CopilotPanel;

