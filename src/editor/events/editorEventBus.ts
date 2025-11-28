/**
 * EditorEventBus - 编辑器事件总线
 * 
 * 【职责】
 * - 提供简单的事件发布/订阅机制
 * - 用于将编辑器 GUI 行为传递给 Copilot
 * 
 * 【设计】
 * - 单例模式
 * - 类型安全的事件系统
 * - 支持取消订阅
 */

import type { EditorEvent } from '../../copilot/copilotTypes';

// ==========================================
// 类型定义
// ==========================================

type EditorEventListener = (event: EditorEvent) => void;

// ==========================================
// 事件总线实现
// ==========================================

class EditorEventBusImpl {
  private listeners: Set<EditorEventListener>;
  private isDev: boolean;

  constructor() {
    this.listeners = new Set();
    this.isDev = typeof process !== 'undefined'
      ? process.env.NODE_ENV === 'development'
      : true;
  }

  /**
   * 发送事件
   */
  emit(event: EditorEvent): void {
    if (this.isDev) {
      console.debug('[EditorEventBus] emit:', event.type, event);
    }

    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[EditorEventBus] Listener error:', error);
      }
    });
  }

  /**
   * 订阅事件
   * @returns 取消订阅函数
   */
  subscribe(listener: EditorEventListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取当前监听器数量（调试用）
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * 清除所有监听器（测试用）
   */
  clear(): void {
    this.listeners.clear();
  }
}

// ==========================================
// 单例导出
// ==========================================

export const editorEventBus = new EditorEventBusImpl();

// ==========================================
// 便捷方法
// ==========================================

/**
 * 发送文档打开事件
 */
export function emitDocumentOpened(docId: string): void {
  editorEventBus.emit({
    type: 'document_opened',
    docId,
    createdAt: Date.now(),
  });
}

/**
 * 发送文档关闭事件
 */
export function emitDocumentClosed(docId: string): void {
  editorEventBus.emit({
    type: 'document_closed',
    docId,
    createdAt: Date.now(),
  });
}

/**
 * 发送标题聚焦事件
 */
export function emitHeadingFocused(
  docId: string,
  sectionId: string,
  sectionTitle: string,
  headingLevel?: number
): void {
  editorEventBus.emit({
    type: 'heading_focused',
    docId,
    payload: {
      sectionId,
      sectionTitle,
      headingLevel,
    },
    createdAt: Date.now(),
  });
}

/**
 * 发送标题失焦事件
 */
export function emitHeadingBlurred(docId: string): void {
  editorEventBus.emit({
    type: 'heading_blurred',
    docId,
    createdAt: Date.now(),
  });
}

/**
 * 发送选区变更事件
 */
export function emitSelectionChanged(docId: string, selectionText: string): void {
  editorEventBus.emit({
    type: 'selection_changed',
    docId,
    payload: {
      selectionText,
    },
    createdAt: Date.now(),
  });
}

/**
 * 发送光标移动事件
 */
export function emitCursorMoved(docId: string): void {
  editorEventBus.emit({
    type: 'cursor_moved',
    docId,
    createdAt: Date.now(),
  });
}

/**
 * 发送章节 AI 操作事件
 */
export function emitSectionAiAction(
  docId: string,
  actionType: string,
  sectionId?: string,
  sectionTitle?: string
): void {
  editorEventBus.emit({
    type: 'section_ai_action',
    docId,
    payload: {
      actionType,
      sectionId,
      sectionTitle,
    },
    createdAt: Date.now(),
  });
}

export default editorEventBus;

