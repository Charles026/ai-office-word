/**
 * Copilot Runtime Bridge - 连接 Copilot 命令与 DocAgentRuntime
 * 
 * 【职责】
 * - 执行 Copilot 命令（文档操作）
 * - 调用现有的 Section AI 能力
 * - 更新 Copilot 会话状态（action 消息）
 * 
 * 【设计原则】
 * - 复用现有 Runtime 能力，不重造轮子
 * - 所有文档操作都通过 DocOps 执行
 * - 操作结果以 action 消息形式记录
 */

import { LexicalEditor } from 'lexical';
import {
  ResolvedCommand,
  CopilotCommand,
  buildActionDescription,
  buildContextMissingMessage,
  buildNotImplementedMessage,
  isCommandImplemented,
  commandNeedsSection,
} from './copilotCommands';
import {
  CopilotMessage,
  generateCopilotId,
  createAssistantMessage,
} from './copilotTypes';
import { copilotStore } from './copilotStore';
import {
  runSectionAiAction,
  SectionAiAction,
  SectionAiContext,
  SectionAiResult,
  applyPendingDocOps,
  triggerSectionAiWithClarification,
  ClarificationChoice,
} from '../actions/sectionAiActions';
import type { PendingSectionResult } from './copilotStore';
import { createSectionSnapshot } from './copilotSnapshots';
import { extractSectionContext } from '../runtime/context';
import { copilotDebugStore } from './copilotDebugStore';
import { CopilotDebugSnapshot, generateDebugId } from './copilotDebugTypes';
import { buildDocContextEnvelope, buildSystemPromptFromEnvelope, buildUserPromptFromEnvelope } from '../docContext';
import type { SectionDocOp } from '../docops/sectionDocOpsDiff';
import { runDocEditPlan, buildDocEditPlanForIntent, buildDocEditIntentFromCommand } from '../docAgent';
import type { ToneType, LengthType } from '../docAgent/docEditTypes';
import {
  hasHighlightTasks,
  filterHighlightTasks,
} from '../actions/highlightExecution';
import {
  logAiRewriteApplied,
  logAiSummaryApplied,
  logAiComplexApplied,
} from '../interaction';

// ==========================================
// Editor 引用管理
// ==========================================

/**
 * 全局编辑器引用
 * 
 * 由 App.tsx 在编辑器就绪时设置
 */
let _currentEditor: LexicalEditor | null = null;

/**
 * Section 命令执行状态标志
 * 
 * 用于防止 Section 命令执行时重复触发 Selection 流
 */
let _isSectionCommandRunning = false;

/**
 * 设置当前编辑器实例
 */
export function setCopilotEditor(editor: LexicalEditor | null): void {
  _currentEditor = editor;
  console.log('[CopilotBridge] Editor set:', !!editor);
}

/**
 * 获取当前编辑器实例
 */
export function getCopilotEditor(): LexicalEditor | null {
  return _currentEditor;
}

/**
 * 检查是否有 Section 命令正在执行
 * 
 * 用于 EditorContainer 的 handleAiCommand 中，避免重复触发 Selection 流
 */
export function isSectionCommandRunning(): boolean {
  return _isSectionCommandRunning;
}

// ==========================================
// Toast 回调管理
// ==========================================

/**
 * Toast 回调类型
 */
interface ToastCallbacks {
  addToast: (message: string, type: 'success' | 'error' | 'info' | 'loading', duration?: number) => string;
  dismissToast: (id: string) => void;
}

let _toastCallbacks: ToastCallbacks | null = null;

/**
 * 设置 Toast 回调
 */
export function setCopilotToast(callbacks: ToastCallbacks | null): void {
  _toastCallbacks = callbacks;
}

/**
 * 获取 Toast 回调（带默认值）
 */
function getToastCallbacks(): ToastCallbacks {
  if (_toastCallbacks) return _toastCallbacks;
  
  // 默认回调（仅打印日志）
  return {
    addToast: (message, type) => {
      console.log(`[CopilotBridge Toast] ${type}: ${message}`);
      return 'mock-toast-id';
    },
    dismissToast: () => {},
  };
}

// ==========================================
// 命令 → SectionAiAction 映射
// ==========================================

/**
 * 将 CopilotCommand 映射到 SectionAiAction
 */
function mapCommandToAction(command: CopilotCommand): SectionAiAction | null {
  switch (command) {
    case 'rewrite_section_intro':
    case 'rewrite_section_chapter':
      return 'rewrite';
    case 'summarize_section':
      return 'summarize';
    case 'expand_section':
      return 'expand';
    default:
      return null;
  }
}

// ==========================================
// 调试辅助函数
// ==========================================

/**
 * 将 DocOps 格式化为可读的调试信息
 */
function formatDocOpsForDebug(docOps?: SectionDocOp[]): string {
  if (!docOps || docOps.length === 0) {
    return '无 DocOps 执行';
  }

  const lines: string[] = [
    `📝 执行了 ${docOps.length} 个 DocOps：`,
    '',
  ];

  for (let i = 0; i < docOps.length; i++) {
    const op = docOps[i];
    const index = i + 1;

    switch (op.type) {
      case 'replace_paragraph':
        lines.push(`${index}. 🔄 替换段落 [${op.targetKey}]`);
        lines.push(`   新文: "${truncateText(op.newText, 100)}"`);
        lines.push('');
        break;

      case 'insert_paragraph_after':
        lines.push(`${index}. ➕ 插入段落`);
        lines.push(`   内容: "${truncateText(op.newText, 80)}"`);
        lines.push('');
        break;

      case 'delete_paragraph':
        lines.push(`${index}. ❌ 删除段落`);
        lines.push(`   Key: ${op.targetKey}`);
        lines.push('');
        break;

      default:
        lines.push(`${index}. ❓ 未知操作: ${(op as any).type}`);
        lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 截断文本
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// ==========================================
// v2 新增：responseMode 分支处理
// ==========================================

/**
 * 根据 responseMode 处理 SectionAiResult
 * 
 * - auto_apply: 已应用，更新状态并显示成功消息
 * - preview: 存储待处理结果，显示预览卡片
 * - clarify: 存储待处理结果，显示澄清问题卡片
 */
async function handleSectionAiResult(
  result: SectionAiResult,
  resolved: ResolvedCommand,
  docId: string,
  actionMsg: CopilotMessage,
  snapshotId: string | undefined,
  editor: LexicalEditor,
  sectionAction: SectionAiAction,
  debugSnapshot: CopilotDebugSnapshot | null
): Promise<void> {
  const __DEV__ = process.env.NODE_ENV === 'development';

  if (!result.success) {
    // 失败处理
    copilotStore.updateMessageMeta(docId, actionMsg.id, { 
      status: 'failed',
      error: result.error,
    });

    const failMsg = createAssistantMessage(
      `执行失败：${result.error || '未知错误'}`
    );
    copilotStore.appendMessage(docId, failMsg);

    if (__DEV__ && debugSnapshot) {
      debugSnapshot.timings.finishedAt = Date.now();
      debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
      debugSnapshot.error = result.error || '执行失败';
      copilotDebugStore.setSnapshot(debugSnapshot);
    }
    return;
  }

  const responseMode = result.responseMode ?? 'auto_apply';

  switch (responseMode) {
    case 'auto_apply':
      await handleAutoApply(result, resolved, docId, actionMsg, snapshotId, debugSnapshot);
      break;
      
    case 'preview':
      await handlePreview(result, resolved, docId, actionMsg, editor, sectionAction);
      break;
      
    case 'clarify':
      await handleClarify(result, resolved, docId, actionMsg, sectionAction);
      break;
  }
}

/**
 * auto_apply 模式：已自动应用，显示成功消息
 */
async function handleAutoApply(
  result: SectionAiResult,
  resolved: ResolvedCommand,
  docId: string,
  actionMsg: CopilotMessage,
  snapshotId: string | undefined,
  debugSnapshot: CopilotDebugSnapshot | null
): Promise<void> {
  const __DEV__ = process.env.NODE_ENV === 'development';

  copilotStore.updateMessageMeta(docId, actionMsg.id, { 
    status: 'applied',
    responseMode: 'auto_apply',
    confidence: result.confidence,
  });

  // 记录到 lastActions
  copilotStore.pushLastAction({
    id: actionMsg.id,
    type: resolved.command,
    scope: resolved.scope,
    docId,
    sectionId: resolved.sectionId ?? undefined,
    sectionTitle: resolved.sectionTitle ?? undefined,
    createdAt: Date.now(),
    undoSnapshotId: snapshotId,
  });

  // 记录 Interaction 事件
  if (resolved.sectionId) {
    if (resolved.command === 'rewrite_section_intro' || resolved.command === 'rewrite_section_chapter') {
      logAiRewriteApplied(docId, resolved.sectionId, {
        actionKind: resolved.command === 'rewrite_section_chapter' ? 'rewrite_chapter' : 'rewrite_intro',
        sectionTitle: resolved.sectionTitle ?? undefined,
      });
    } else if (resolved.command === 'summarize_section') {
      logAiSummaryApplied(docId, resolved.sectionId, {
        sectionTitle: resolved.sectionTitle ?? undefined,
      });
    }
  }

  // 添加成功提示消息
  const assistantSummary = result.assistantText?.trim();
  const successMsg = createAssistantMessage(
    `${assistantSummary || `已完成「${buildActionDescription(resolved)}」`}\n\n✅ 已自动应用到文档，可随时撤销。`
  );
  copilotStore.appendMessage(docId, successMsg);

  // 记录调试快照
  if (__DEV__ && debugSnapshot) {
    debugSnapshot.timings.finishedAt = Date.now();
    debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
    
    const docOpsDetails = formatDocOpsForDebug(result.docOps);
    debugSnapshot.responseMessages = [{
      id: 'resp-0',
      role: 'assistant',
      content: docOpsDetails,
      contentLength: docOpsDetails.length,
    }];
    copilotDebugStore.setSnapshot(debugSnapshot);
  }
}

/**
 * preview 模式：存储待处理结果，显示预览卡片
 */
async function handlePreview(
  result: SectionAiResult,
  resolved: ResolvedCommand,
  docId: string,
  actionMsg: CopilotMessage,
  editor: LexicalEditor,
  sectionAction: SectionAiAction
): Promise<void> {
  const pendingResultId = generateCopilotId('pending');
  
  // 获取预览文本（从 DocOps 中提取）
  let previewText = '';
  let originalText = '';
  
  if (result.docOps && result.docOps.length > 0) {
    // 从 DocOps 中提取新文本
    previewText = result.docOps
      .filter(op => op.type === 'replace_paragraph' || op.type === 'insert_paragraph_after')
      .map(op => (op as any).newText || '')
      .join('\n\n');
    
    // 提取原始文本（如果 SectionContext 可用）
    try {
      const sectionContext = extractSectionContext(editor, resolved.sectionId!);
      originalText = sectionContext.ownParagraphs.map(p => p.text).join('\n\n');
    } catch (e) {
      console.warn('[CopilotBridge] Failed to extract original text:', e);
    }
  }

  // 存储待处理结果
  const pendingResult: PendingSectionResult = {
    id: pendingResultId,
    sectionId: resolved.sectionId!,
    responseMode: 'preview',
    resultJson: JSON.stringify({
      ...result,
      // 附加执行上下文
      _meta: {
        command: resolved.command,
        sectionAction,
        docId,
      }
    }),
    createdAt: Date.now(),
    messageId: actionMsg.id,
  };
  copilotStore.addPendingResult(pendingResult);

  // 更新 action 消息状态
  copilotStore.updateMessageMeta(docId, actionMsg.id, { 
    status: 'pending',
    responseMode: 'preview',
    previewText,
    originalText,
    pendingResultId,
    confidence: result.confidence,
  });

  // 添加预览提示消息
  const assistantSummary = result.assistantText?.trim();
  const previewMsg = createAssistantMessage(
    `${assistantSummary || '我已生成修改建议'}\n\n📝 请查看下方预览，确认后点击「应用到文档」。`
  );
  copilotStore.appendMessage(docId, previewMsg);
}

/**
 * clarify 模式：存储待处理结果，显示澄清问题卡片
 */
async function handleClarify(
  result: SectionAiResult,
  resolved: ResolvedCommand,
  docId: string,
  actionMsg: CopilotMessage,
  sectionAction: SectionAiAction
): Promise<void> {
  const pendingResultId = generateCopilotId('pending');
  
  // 从 uncertainties 中提取第一个不确定项
  const mainUncertainty = result.uncertainties?.[0];
  const clarifyQuestion = mainUncertainty?.reason ?? '有一个关键参数需要你来决定';
  const clarifyOptions = mainUncertainty?.candidateOptions ?? [];
  const clarifyField = mainUncertainty?.field ?? '';

  // 存储待处理结果
  const pendingResult: PendingSectionResult = {
    id: pendingResultId,
    sectionId: resolved.sectionId!,
    responseMode: 'clarify',
    resultJson: JSON.stringify({
      ...result,
      _meta: {
        command: resolved.command,
        sectionAction,
        docId,
      }
    }),
    createdAt: Date.now(),
    messageId: actionMsg.id,
  };
  copilotStore.addPendingResult(pendingResult);

  // 更新 action 消息状态
  copilotStore.updateMessageMeta(docId, actionMsg.id, { 
    status: 'pending',
    responseMode: 'clarify',
    clarifyQuestion,
    clarifyOptions,
    clarifyField,
    pendingResultId,
    confidence: result.confidence,
  });

  // 添加澄清提示消息
  const assistantSummary = result.assistantText?.trim();
  const clarifyMsg = createAssistantMessage(
    `${assistantSummary || '我需要进一步确认你的意图'}\n\n❓ 请在下方选择一个选项，或输入你的具体要求。`
  );
  copilotStore.appendMessage(docId, clarifyMsg);
}

// ==========================================
// v2 新增：Preview 和 Clarify 的用户交互处理
// ==========================================

/**
 * 应用预览中的修改（用户点击「应用到文档」）
 */
export async function applyPreviewResult(pendingResultId: string): Promise<boolean> {
  const pendingResult = copilotStore.getPendingResult(pendingResultId);
  if (!pendingResult || pendingResult.responseMode !== 'preview') {
    console.warn('[CopilotBridge] Invalid pending result for apply:', pendingResultId);
    return false;
  }

  try {
    const stored = JSON.parse(pendingResult.resultJson) as SectionAiResult & {
      _meta: { docId: string; command: string };
    };
    const editor = getCopilotEditor();
    if (!editor) {
      console.error('[CopilotBridge] No editor available');
      return false;
    }

    // 应用 DocOps
    const success = await applyPendingDocOps(editor, stored);
    
    if (success) {
      const docId = stored._meta.docId;
      
      // 更新消息状态
      if (pendingResult.messageId) {
        copilotStore.updateMessageMeta(docId, pendingResult.messageId, {
          status: 'applied',
        });
      }

      // 记录 Interaction 事件
      if (stored.intent?.scope.sectionId) {
        const sectionId = stored.intent.scope.sectionId;
        const tasks = stored.intent.tasks;
        
        if (tasks.some(t => t.type === 'rewrite')) {
          logAiRewriteApplied(docId, sectionId, {
            actionKind: 'rewrite_intro',
          });
        } else if (tasks.some(t => t.type === 'summarize')) {
          logAiSummaryApplied(docId, sectionId);
        }
        
        // 执行高亮任务（mark_key_terms / mark_key_sentences / mark_key_paragraphs）
        if (hasHighlightTasks(tasks)) {
          // 需要获取 editor 实例来执行高亮
          // 由于这里没有 editor 引用，高亮任务将在下次 editor 更新时处理
          // TODO: 考虑通过 event bus 或 store 传递高亮任务到 UI 层执行
          const highlightTasks = filterHighlightTasks(tasks);
          console.log('[CopilotBridge] Highlight tasks pending:', highlightTasks.length);
        }
      }

      // 添加成功消息
      const successMsg = createAssistantMessage('✅ 已应用修改到文档，可随时撤销。');
      copilotStore.appendMessage(docId, successMsg);

      // 清理待处理结果
      copilotStore.removePendingResult(pendingResultId);
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[CopilotBridge] Failed to apply preview:', error);
    return false;
  }
}

/**
 * 取消预览（用户点击「暂不应用」）
 */
export function cancelPreviewResult(pendingResultId: string): void {
  const pendingResult = copilotStore.getPendingResult(pendingResultId);
  if (!pendingResult) return;

  try {
    const stored = JSON.parse(pendingResult.resultJson) as { _meta: { docId: string } };
    const docId = stored._meta.docId;

    // 更新消息状态
    if (pendingResult.messageId) {
      copilotStore.updateMessageMeta(docId, pendingResult.messageId, {
        status: 'reverted',
      });
    }

    // 添加取消消息
    const cancelMsg = createAssistantMessage('已取消本次修改。');
    copilotStore.appendMessage(docId, cancelMsg);

    // 清理待处理结果
    copilotStore.removePendingResult(pendingResultId);
  } catch (error) {
    console.error('[CopilotBridge] Failed to cancel preview:', error);
  }
}

/**
 * 解决澄清问题（用户选择了某个选项）
 */
export async function resolveClarification(
  pendingResultId: string,
  userChoice: string
): Promise<void> {
  const pendingResult = copilotStore.getPendingResult(pendingResultId);
  if (!pendingResult || pendingResult.responseMode !== 'clarify') {
    console.warn('[CopilotBridge] Invalid pending result for clarify:', pendingResultId);
    return;
  }

  try {
    const stored = JSON.parse(pendingResult.resultJson) as SectionAiResult & {
      _meta: { docId: string; command: CopilotCommand; sectionAction: SectionAiAction };
    };
    const editor = getCopilotEditor();
    if (!editor) {
      console.error('[CopilotBridge] No editor available');
      return;
    }

    const docId = stored._meta.docId;
    const sectionAction = stored._meta.sectionAction;
    const sectionId = pendingResult.sectionId;

    // 更新消息状态
    if (pendingResult.messageId) {
      copilotStore.updateMessageMeta(docId, pendingResult.messageId, {
        status: 'applied', // 标记为已处理（不是真正应用，只是表示用户已响应）
      });
    }

    // 清理旧的待处理结果
    copilotStore.removePendingResult(pendingResultId);

    // 添加用户选择的消息
    const userMsg: CopilotMessage = {
      id: generateCopilotId('msg'),
      role: 'user',
      content: userChoice,
      createdAt: Date.now(),
      meta: { docId, sectionId },
    };
    copilotStore.appendMessage(docId, userMsg);

    // 构建澄清选择
    const mainUncertainty = stored.uncertainties?.[0];
    if (!mainUncertainty || !stored.intent) {
      console.error('[CopilotBridge] Missing uncertainty or intent for clarification');
      return;
    }

    const clarification: ClarificationChoice = {
      originalIntent: stored.intent,
      uncertainty: mainUncertainty,
      userChoice,
    };

    // 重新调用 Section AI（带澄清）
    const context: SectionAiContext = {
      editor,
      toast: getToastCallbacks(),
    };

    // 创建新的 action 消息
    const newActionMsg: CopilotMessage = {
      id: generateCopilotId('action'),
      role: 'action',
      content: `正在根据你的选择「${userChoice}」重新处理...`,
      createdAt: Date.now(),
      meta: {
        docId,
        scope: 'section',
        sectionId,
        actionType: stored._meta.command,
        status: 'pending',
      },
    };
    copilotStore.appendMessage(docId, newActionMsg);

    // 调用带澄清的 Section AI
    const newResult = await triggerSectionAiWithClarification(
      sectionAction,
      sectionId,
      context,
      clarification
    );

    // 处理新结果（递归调用 handleSectionAiResult 的逻辑）
    if (newResult.success) {
      const newResponseMode = newResult.responseMode ?? 'auto_apply';
      
      if (newResponseMode === 'auto_apply' && newResult.applied) {
        copilotStore.updateMessageMeta(docId, newActionMsg.id, { status: 'applied' });
        const successMsg = createAssistantMessage(
          `${newResult.assistantText || '已完成修改'}\n\n✅ 已自动应用到文档。`
        );
        copilotStore.appendMessage(docId, successMsg);
      } else if (newResponseMode === 'preview') {
        // 仍然是 preview 模式
        await handlePreview(
          newResult,
          { command: stored._meta.command, docId, sectionId, scope: 'section' } as ResolvedCommand,
          docId,
          newActionMsg,
          editor,
          sectionAction
        );
      } else if (newResponseMode === 'clarify') {
        // 仍然需要澄清（不太可能，但处理以防万一）
        await handleClarify(
          newResult,
          { command: stored._meta.command, docId, sectionId, scope: 'section' } as ResolvedCommand,
          docId,
          newActionMsg,
          sectionAction
        );
      }
    } else {
      copilotStore.updateMessageMeta(docId, newActionMsg.id, { 
        status: 'failed',
        error: newResult.error,
      });
      const failMsg = createAssistantMessage(`执行失败：${newResult.error || '未知错误'}`);
      copilotStore.appendMessage(docId, failMsg);
    }
  } catch (error) {
    console.error('[CopilotBridge] Failed to resolve clarification:', error);
  }
}

// ==========================================
// 复合意图执行
// ==========================================

/**
 * 执行复合意图命令（改写 + 标记重点 / 摘要）
 * 
 * v2 重构：使用 buildDocEditIntentFromCommand 适配层
 * v2.1: 新增 userInput 参数，用于检测 highlightMode（terms vs sentences）
 */
async function runComplexIntentCommand(
  resolved: ResolvedCommand,
  actionMsg: CopilotMessage,
  docId: string,
  editor: LexicalEditor,
  snapshotId?: string,
  userInput?: string
): Promise<void> {
  const sectionId = resolved.sectionId!;
  const options = resolved.options as {
    highlightKeySentences?: boolean;
    highlightCount?: number;
    addSummary?: boolean;
    bulletCount?: number;
    tone?: string;
    length?: string;
    highlightOnly?: boolean; // 🆕 只高亮不改写
  } || {};

  try {
    // 1. 提取 SectionContext
    const sectionContext = extractSectionContext(editor, sectionId);
    if (!sectionContext) {
      copilotStore.updateMessageMeta(docId, actionMsg.id, { status: 'failed' });
      const errorMsg = createAssistantMessage('无法获取章节内容，请确保光标在正确的章节中。');
      copilotStore.appendMessage(docId, errorMsg);
      return;
    }

    // 2. 使用新的适配层构建 DocEditIntent（v2）
    // 🆕 传入 userInput，用于检测 highlightMode（terms vs sentences）
    // 🆕 传入 highlightOnly，用于独立高亮（不改写）
    const intent = buildDocEditIntentFromCommand(resolved.command, {
      docId,
      sectionId,
      tone: options.tone as ToneType | undefined,
      length: options.length as LengthType | undefined,
      highlightCount: options.highlightCount,
      bulletCount: options.bulletCount,
      userInput, // 🆕 用于检测 "重点词语" vs "关键句"
      highlightOnly: options.highlightOnly as boolean | undefined, // 🆕 只高亮不改写
    });
    
    console.log('[CopilotBridge] Built intent from command:', resolved.command, intent);
    console.log('[CopilotBridge] UserInput for highlight detection:', userInput?.slice(0, 50));

    // 3. 构建 DocEditPlan
    const plan = buildDocEditPlanForIntent(intent, sectionContext);
    console.log('[CopilotBridge] DocEditPlan:', plan);

    // 4. 执行 Plan
    const result = await runDocEditPlan(plan);

    // 5. 更新状态
    if (result.success) {
      copilotStore.updateMessageMeta(docId, actionMsg.id, { 
        status: 'applied',
        undoable: !!snapshotId,
        undoSnapshotId: snapshotId,
      });

      // 记录 action
      copilotStore.pushLastAction({
        id: actionMsg.id,
        type: resolved.command,
        scope: 'section',
        docId,
        sectionId,
        sectionTitle: resolved.sectionTitle ?? undefined,
        createdAt: Date.now(),
      });

      // 🆕 记录 Interaction 事件
      logAiComplexApplied(docId, sectionId, {
        actionKind: resolved.command,
        steps: result.stepResults?.map(sr => sr.type),
        sectionTitle: resolved.sectionTitle ?? undefined,
      });

      // 成功消息
      const stepSummary = result.stepResults
        ?.map((sr, i) => `${i + 1}. ${sr.type}: ${sr.success ? '✅' : '❌'}`)
        .join('\n') ?? '';
      
      const successMsg = createAssistantMessage(
        `已完成复合操作：\n${stepSummary}\n\n你可以在文档中查看效果。`
      );
      copilotStore.appendMessage(docId, successMsg);
    } else {
      copilotStore.updateMessageMeta(docId, actionMsg.id, { status: 'failed' });
      const errorMsg = createAssistantMessage(`执行失败：${result.error || '未知错误'}`);
      copilotStore.appendMessage(docId, errorMsg);
    }
  } catch (error) {
    console.error('[CopilotBridge] Complex intent execution failed:', error);
    copilotStore.updateMessageMeta(docId, actionMsg.id, { status: 'failed' });
    const errorMsg = createAssistantMessage(
      `执行复合操作时出错：${error instanceof Error ? error.message : '未知错误'}`
    );
    copilotStore.appendMessage(docId, errorMsg);
  }
}

// ==========================================
// 核心执行函数
// ==========================================

/**
 * 执行 Copilot 命令
 * 
 * @param resolved - 解析后的命令
 * @param userMessage - 触发该命令的用户消息
 */
export async function runCopilotCommand(
  resolved: ResolvedCommand,
  userMessage: CopilotMessage
): Promise<void> {
  const docId = resolved.docId!;

  // 0. 安全检查：无文档
  if (!docId) {
    const errorMsg = createAssistantMessage('请先打开一个文档后再执行此操作。');
    copilotStore.appendMessage(null, errorMsg);
    return;
  }

  // 1. 检查命令是否需要 section
  if (commandNeedsSection(resolved.command) && !resolved.sectionId) {
    const errorMsg = createAssistantMessage(buildContextMissingMessage(resolved.command));
    copilotStore.appendMessage(docId, errorMsg);
    return;
  }

  // 🆕 标记 Section 命令开始执行（防止 EditorContainer 重复触发 selection 流）
  const isSectionCommand = commandNeedsSection(resolved.command);
  if (isSectionCommand) {
    _isSectionCommandRunning = true;
  }

  // 2. 检查命令是否已实现
  if (!isCommandImplemented(resolved.command)) {
    const notImplementedMsg = createAssistantMessage(buildNotImplementedMessage(resolved.command));
    copilotStore.appendMessage(docId, notImplementedMsg);
    return;
  }

  // 3. 检查编辑器是否可用
  const editor = getCopilotEditor();
  if (!editor) {
    const errorMsg = createAssistantMessage('编辑器未就绪，请稍后重试。');
    copilotStore.appendMessage(docId, errorMsg);
    return;
  }

  // 4. 准备快照（如果是 Section 级操作）
  let snapshotId: string | undefined;
  if (commandNeedsSection(resolved.command) && resolved.sectionId) {
    try {
      // 提取当前 Section 上下文
      const sectionContext = extractSectionContext(editor, resolved.sectionId);
      
      // 根据命令类型决定保存范围
      // rewrite_section_intro -> ownParagraphs
      // summarize_section -> subtreeParagraphs (通常总结会覆盖整个小节)
      // rewrite_section_chapter -> subtreeParagraphs
      
      let paragraphsToSave = sectionContext.subtreeParagraphs; // 默认保存整棵树，最安全
      
      // 如果明确是只改导语，可以只存导语（但为了撤销简单，存整个 subtree 也无妨）
      // 当前策略：统一存 subtree，撤销时恢复整个 section
      
      snapshotId = createSectionSnapshot({
        docId,
        sectionId: resolved.sectionId,
        paragraphs: paragraphsToSave,
      });
    } catch (error) {
      console.warn('[CopilotBridge] Failed to create snapshot:', error);
      // 快照失败不阻止操作，只是不能撤销
    }
  }

  // 5. 创建 action 消息（pending 状态）
  const actionMsg: CopilotMessage = {
    id: generateCopilotId('action'),
    role: 'action',
    content: buildActionDescription(resolved),
    createdAt: Date.now(),
    meta: {
      docId,
      scope: resolved.scope,
      sectionId: resolved.sectionId ?? undefined,
      sectionTitle: resolved.sectionTitle ?? undefined,
      actionType: resolved.command,
      status: 'pending',
      undoable: !!snapshotId,
      undoSnapshotId: snapshotId,
    },
  };
  copilotStore.appendMessage(docId, actionMsg);

  // 6. 检查是否是 DocEditPlan 命令（复合命令或独立高亮命令）
  const isDocEditPlanCommand = [
    'rewrite_section_with_highlight',
    'rewrite_section_with_highlight_and_summary',
    'highlight_key_terms', // 独立高亮命令（Primitive: HighlightKeyTerms only）
  ].includes(resolved.command);
  
  if (isDocEditPlanCommand) {
    // DocEditPlan 命令走 primitive 执行流程
    // 🆕 传入用户原始输入，用于检测 highlightMode（terms vs sentences）
    try {
      await runComplexIntentCommand(resolved, actionMsg, docId, editor, snapshotId, userMessage.content);
    } finally {
      // 🆕 清除 Section 命令执行标志
      if (isSectionCommand) {
        _isSectionCommandRunning = false;
      }
    }
    return;
  }

  // 7. 映射到 Section AI Action
  const sectionAction = mapCommandToAction(resolved.command);
  if (!sectionAction) {
    copilotStore.updateMessageMeta(docId, actionMsg.id, { status: 'failed' });
    const errorMsg = createAssistantMessage(`命令 ${resolved.command} 暂未接入执行引擎。`);
    copilotStore.appendMessage(docId, errorMsg);
    return;
  }

  // 7. 构建执行上下文
  const context: SectionAiContext = {
    editor,
    toast: getToastCallbacks(),
  };

  // 7.1 创建调试快照（仅开发模式）
  const __DEV__ = process.env.NODE_ENV === 'development';
  let debugSnapshot: CopilotDebugSnapshot | null = null;
  
  if (__DEV__) {
    debugSnapshot = {
      id: generateDebugId(),
      createdAt: Date.now(),
      model: 'section-ai-action',
      docId,
      scope: resolved.scope,
      sectionId: resolved.sectionId ?? undefined,
      sectionTitle: resolved.sectionTitle ?? undefined,
      requestMessages: [{
        id: 'cmd-0',
        role: 'user',
        content: `命令: ${resolved.command}\n用户输入: ${userMessage.content}`,
        contentLength: userMessage.content.length,
      }],
      responseMessages: [],
      timings: { startedAt: Date.now() },
      usedEnvelope: false,
    };

    // 尝试构建 DocContextEnvelope（如果是 section 级操作）
    if (resolved.sectionId) {
      try {
        const envelope = await buildDocContextEnvelope(
          {
            docId,
            scope: 'section',
            sectionId: resolved.sectionId,
            maxTokens: 8192,
          },
          editor
        );
        debugSnapshot.envelope = envelope;
        debugSnapshot.usedEnvelope = true;

        // 构建模拟的 request messages
        const systemPrompt = buildSystemPromptFromEnvelope(envelope);
        const userPrompt = buildUserPromptFromEnvelope(envelope, userMessage.content);
        debugSnapshot.requestMessages = [
          { id: 'sys-0', role: 'system', content: systemPrompt, contentLength: systemPrompt.length },
          { id: 'usr-0', role: 'user', content: userPrompt, contentLength: userPrompt.length },
        ];
      } catch (err) {
        console.warn('[CopilotBridge] Failed to build envelope for debug:', err);
      }
    }
  }

  // 8. 执行 Section AI Action
  try {
    console.log('[CopilotBridge] Running section AI action:', {
      action: sectionAction,
      sectionId: resolved.sectionId,
      command: resolved.command,
      customPrompt: resolved.options?.refinementPrompt,
    });

    const customPrompt = resolved.options?.refinementPrompt as string | undefined;

    const result: SectionAiResult = await runSectionAiAction(
      sectionAction,
      resolved.sectionId!,
      context,
      {
        rewrite: (resolved.command === 'rewrite_section_intro' || resolved.command === 'rewrite_section_chapter')
          ? { 
              scope: resolved.command === 'rewrite_section_chapter' ? 'chapter' : 'intro',
              customPrompt,
            }
          : undefined,
        summarize: resolved.command === 'summarize_section'
          ? { customPrompt }
          : undefined,
        expand: resolved.command === 'expand_section'
          ? { customPrompt }
          : undefined,
      }
    );

    // 🆕 9. 根据 responseMode 分支处理结果
    await handleSectionAiResult(
      result,
      resolved,
        docId,
      actionMsg,
      snapshotId,
      editor,
      sectionAction,
      debugSnapshot
    );
  } catch (error) {
    console.error('[CopilotBridge] runCopilotCommand error:', error);

    copilotStore.updateMessageMeta(docId, actionMsg.id, { 
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });

    const errorMsg = createAssistantMessage(
      `执行出错：${error instanceof Error ? error.message : '未知错误'}`
    );
    copilotStore.appendMessage(docId, errorMsg);

    // 记录调试快照
    if (__DEV__ && debugSnapshot) {
      debugSnapshot.timings.finishedAt = Date.now();
      debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
      debugSnapshot.error = error instanceof Error ? error.message : String(error);
      copilotDebugStore.setSnapshot(debugSnapshot);
    }
  } finally {
    // 🆕 清除 Section 命令执行标志
    if (isSectionCommand) {
      _isSectionCommandRunning = false;
    }
  }
}

export default runCopilotCommand;

