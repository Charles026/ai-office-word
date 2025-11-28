/**
 * CopilotContextListener - 上下文监听器
 * 
 * 【职责】
 * - 订阅 EditorEvent
 * - 更新 CopilotContext
 * - 连接 Editor GUI 行为与 Copilot 上下文
 * 
 * 【Phase 2】
 * - 只做读取和更新，不夹杂 UI/LLM 逻辑
 */

import { editorEventBus } from '../editor/events/editorEventBus';
import { copilotStore } from './copilotStore';
import { EditorEvent } from './copilotTypes';
import { logSectionFocusChanged } from '../interaction';

// ==========================================
// 监听器状态
// ==========================================

let isInitialized = false;
let unsubscribe: (() => void) | null = null;

// ==========================================
// 事件处理
// ==========================================

/**
 * 处理编辑器事件，更新 CopilotContext
 */
function handleEditorEvent(event: EditorEvent): void {
  const currentContext = copilotStore.getContext();
  const currentDocId = currentContext.docId;

  switch (event.type) {
    case 'document_opened':
      // 打开文档：设置为当前激活文档，scope 为 document
      copilotStore.setActiveDoc(event.docId);
      copilotStore.updateContext({
        scope: 'document',
        sectionId: null,
        sectionTitle: null,
        selectionSnippet: null,
      });
      break;

    case 'document_closed':
      // 关闭文档
      if (event.docId === currentDocId) {
        // 如果关闭的是当前文档，重置上下文
        copilotStore.setActiveDoc(null);
      }
      break;

    case 'heading_focused':
      // 聚焦到标题：切换到 section scope
      if (event.docId === currentDocId) {
        const newSectionId = event.payload?.sectionId ?? null;
        const newSectionTitle = event.payload?.sectionTitle ?? null;
        
        // 🆕 记录 Section 焦点变化
        if (newSectionId && newSectionId !== currentContext.sectionId) {
          logSectionFocusChanged(event.docId, newSectionId, {
            fromSectionId: currentContext.sectionId,
            fromSectionTitle: currentContext.sectionTitle,
            toSectionTitle: newSectionTitle,
          });
        }
        
        copilotStore.updateContext({
          scope: 'section',
          sectionId: newSectionId,
          sectionTitle: newSectionTitle,
          selectionSnippet: null,
        });
      }
      break;

    case 'heading_blurred':
      // 离开标题区域：回到 document scope
      if (event.docId === currentDocId) {
        // 只有当前是 section scope 时才切换
        if (currentContext.scope === 'section') {
          copilotStore.updateContext({
            scope: 'document',
            sectionId: null,
            sectionTitle: null,
          });
        }
      }
      break;

    case 'selection_changed':
      // 选区变更：切换到 selection scope
      if (event.docId === currentDocId) {
        const selectionText = event.payload?.selectionText;
        
        // 只有选区文本超过一定长度才切换
        if (selectionText && selectionText.length > 10) {
          // 截断选区文本
          const snippet = selectionText.length > 100
            ? selectionText.slice(0, 100) + '...'
            : selectionText;
          
          copilotStore.updateContext({
            scope: 'selection',
            selectionSnippet: snippet,
            // 保留 section 信息（选区可能在某个 section 内）
          });
        } else if (!selectionText || selectionText.length === 0) {
          // 取消选区：回到之前的 scope
          if (currentContext.scope === 'selection') {
            copilotStore.updateContext({
              scope: currentContext.sectionId ? 'section' : 'document',
              selectionSnippet: null,
            });
          }
        }
      }
      break;

    case 'cursor_moved':
      // 光标移动：如果之前是 selection，可能需要清除
      // 这里可以根据需要添加逻辑
      break;

    case 'section_ai_action':
      // 记录 AI 操作
      if (event.docId === currentDocId && event.payload?.actionType) {
        copilotStore.pushLastAction({
          id: `action-${Date.now()}`,
          type: event.payload.actionType,
          scope: currentContext.scope,
          docId: event.docId,
          sectionId: event.payload?.sectionId,
          sectionTitle: event.payload?.sectionTitle,
          createdAt: Date.now(),
        });
      }
      break;

    default:
      // 未知事件类型，忽略
      break;
  }
}

// ==========================================
// 初始化
// ==========================================

/**
 * 初始化 Copilot 上下文监听器
 * 
 * 应该在应用启动时调用一次（例如在主 React 根组件挂载时）
 */
export function initCopilotContextListener(): void {
  if (isInitialized) {
    console.warn('[CopilotContextListener] Already initialized');
    return;
  }

  console.log('[CopilotContextListener] Initializing...');

  // 订阅编辑器事件
  unsubscribe = editorEventBus.subscribe(handleEditorEvent);
  isInitialized = true;

  console.log('[CopilotContextListener] Initialized');
}

/**
 * 销毁监听器（用于测试或热重载）
 */
export function destroyCopilotContextListener(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  isInitialized = false;
  console.log('[CopilotContextListener] Destroyed');
}

/**
 * 检查是否已初始化
 */
export function isCopilotContextListenerInitialized(): boolean {
  return isInitialized;
}

export default initCopilotContextListener;

