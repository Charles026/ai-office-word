/**
 * Interaction Log - 用户交互事件日志
 * 
 * 【职责】
 * - 记录用户对文档的交互事件
 * - 提供按文档、时间窗口查询事件的能力
 * - 维护最近 N 条事件，避免内存无限增长
 * 
 * 【设计】
 * - 使用模块级单例，整个应用共享一个日志实例
 * - 只保留最近 200 条事件
 * - 提供简单的订阅机制，方便调试
 */

import type {
  InteractionEvent,
  InteractionKind,
  InteractionMeta,
} from './interactionTypes';
import { createInteractionEvent } from './interactionTypes';

// Re-export for convenience
export type { InteractionEvent };

// ==========================================
// 配置常量
// ==========================================

/** 最大保留事件数量 */
const MAX_EVENTS = 200;

/** 开发模式标识 */
const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

// ==========================================
// 日志状态
// ==========================================

interface InteractionLogState {
  /** 事件列表（最新的在前面） */
  events: InteractionEvent[];
}

// ==========================================
// InteractionLog 实现
// ==========================================

class InteractionLogStore {
  private state: InteractionLogState;
  private listeners: Set<(events: InteractionEvent[]) => void>;

  constructor() {
    this.state = {
      events: [],
    };
    this.listeners = new Set();
  }

  // ----------------------------------------
  // 核心 API
  // ----------------------------------------

  /**
   * 记录一条交互事件
   */
  logInteraction(event: InteractionEvent): void {
    // 添加到队列头部
    this.state.events = [event, ...this.state.events.slice(0, MAX_EVENTS - 1)];

    if (__DEV__) {
      console.log('[InteractionLog] Event logged:', event.kind, {
        docId: event.docId,
        sectionId: event.sectionId,
        meta: event.meta,
      });
    }

    this.notifyListeners();
  }

  /**
   * 快捷方法：记录事件（自动创建 InteractionEvent）
   */
  log(
    kind: InteractionKind,
    docId: string,
    sectionId?: string | null,
    meta?: InteractionMeta
  ): void {
    const event = createInteractionEvent(kind, docId, sectionId, meta);
    this.logInteraction(event);
  }

  /**
   * 获取某文档最近一段时间的事件
   * 
   * @param options.docId - 文档 ID
   * @param options.windowMs - 时间窗口（毫秒），默认 10 分钟
   * @param options.limit - 最大返回数量，默认 50
   */
  getRecentInteractions(options: {
    docId: string;
    windowMs?: number;
    limit?: number;
  }): InteractionEvent[] {
    const { docId, windowMs = 10 * 60 * 1000, limit = 50 } = options;
    const cutoffTime = Date.now() - windowMs;

    return this.state.events
      .filter(event => event.docId === docId && event.timestamp >= cutoffTime)
      .slice(0, limit);
  }

  /**
   * 获取某章节最近的事件
   */
  getRecentSectionInteractions(options: {
    docId: string;
    sectionId: string;
    windowMs?: number;
    limit?: number;
  }): InteractionEvent[] {
    const { docId, sectionId, windowMs = 10 * 60 * 1000, limit = 20 } = options;
    const cutoffTime = Date.now() - windowMs;

    return this.state.events
      .filter(
        event =>
          event.docId === docId &&
          event.sectionId === sectionId &&
          event.timestamp >= cutoffTime
      )
      .slice(0, limit);
  }

  /**
   * 获取最近 N 条事件（宽松版，不按 docId/时间过滤）
   * 
   * 用于快速验证事件链路是否正常工作
   */
  getRecentEventsLoose(options: { limit?: number } = {}): InteractionEvent[] {
    const { limit = 20 } = options;
    return this.state.events.slice(0, limit);
  }

  /**
   * 获取所有事件（调试用）
   */
  getAllEvents(): InteractionEvent[] {
    return [...this.state.events];
  }

  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.state.events.length;
  }

  /**
   * 清空所有事件
   */
  clearInteractions(): void {
    this.state.events = [];
    if (__DEV__) {
      console.log('[InteractionLog] Cleared all events');
    }
    this.notifyListeners();
  }

  /**
   * 清空某文档的事件
   */
  clearDocInteractions(docId: string): void {
    this.state.events = this.state.events.filter(event => event.docId !== docId);
    if (__DEV__) {
      console.log('[InteractionLog] Cleared events for doc:', docId);
    }
    this.notifyListeners();
  }

  // ----------------------------------------
  // 订阅机制
  // ----------------------------------------

  /**
   * 订阅事件变化
   */
  subscribe(listener: (events: InteractionEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state.events));
  }

  // ----------------------------------------
  // 统计辅助
  // ----------------------------------------

  /**
   * 统计某文档某时间段内的事件类型分布
   */
  getEventStats(docId: string, windowMs: number = 10 * 60 * 1000): Record<InteractionKind, number> {
    const events = this.getRecentInteractions({ docId, windowMs, limit: MAX_EVENTS });
    const stats: Partial<Record<InteractionKind, number>> = {};

    for (const event of events) {
      stats[event.kind] = (stats[event.kind] || 0) + 1;
    }

    return stats as Record<InteractionKind, number>;
  }

  /**
   * 获取某文档最常访问的章节
   */
  getMostActiveSection(docId: string, windowMs: number = 10 * 60 * 1000): string | null {
    const events = this.getRecentInteractions({ docId, windowMs, limit: MAX_EVENTS });
    const sectionCounts: Record<string, number> = {};

    for (const event of events) {
      if (event.sectionId) {
        sectionCounts[event.sectionId] = (sectionCounts[event.sectionId] || 0) + 1;
      }
    }

    let maxCount = 0;
    let mostActive: string | null = null;

    for (const [sectionId, count] of Object.entries(sectionCounts)) {
      if (count > maxCount) {
        maxCount = count;
        mostActive = sectionId;
      }
    }

    return mostActive;
  }
}

// ==========================================
// 导出单例
// ==========================================

/** 全局交互日志实例 */
export const interactionLog = new InteractionLogStore();

// ==========================================
// React Hook（可选）
// ==========================================

import { useState, useEffect } from 'react';

/**
 * React Hook: 获取最近的交互事件
 */
export function useRecentInteractions(docId: string, windowMs: number = 10 * 60 * 1000) {
  const [events, setEvents] = useState<InteractionEvent[]>([]);

  useEffect(() => {
    // 初始获取
    setEvents(interactionLog.getRecentInteractions({ docId, windowMs }));

    // 订阅更新
    const unsubscribe = interactionLog.subscribe(() => {
      setEvents(interactionLog.getRecentInteractions({ docId, windowMs }));
    });

    return unsubscribe;
  }, [docId, windowMs]);

  return events;
}

// ==========================================
// 便捷函数（用于埋点）
// ==========================================

/**
 * 记录 Section 焦点变化
 */
export function logSectionFocusChanged(
  docId: string,
  toSectionId: string,
  options?: {
    fromSectionId?: string | null;
    fromSectionTitle?: string | null;
    toSectionTitle?: string | null;
  }
): void {
  interactionLog.log('section.focus_changed', docId, toSectionId, {
    fromSectionId: options?.fromSectionId,
    fromSectionTitle: options?.fromSectionTitle,
    toSectionTitle: options?.toSectionTitle,
  });
}

/**
 * 记录 Section 重命名
 */
export function logSectionRenamed(
  docId: string,
  sectionId: string,
  titleBefore: string,
  titleAfter: string
): void {
  interactionLog.log('section.renamed', docId, sectionId, {
    titleBefore,
    titleAfter,
  });
}

/**
 * 记录 AI 重写应用
 */
export function logAiRewriteApplied(
  docId: string,
  sectionId: string,
  options?: {
    actionKind?: 'rewrite_intro' | 'rewrite_chapter' | 'rewrite_with_highlight';
    tone?: 'formal' | 'casual' | 'neutral';
    length?: 'keep' | 'shorter' | 'longer';
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.section_rewrite.applied', docId, sectionId, {
    actionKind: options?.actionKind ?? 'rewrite_intro',
    tone: options?.tone,
    length: options?.length,
    sectionTitle: options?.sectionTitle,
  });
}

/**
 * 记录 AI 重写撤销
 */
export function logAiRewriteUndone(
  docId: string,
  sectionId: string,
  options?: {
    originalActionKind?: string;
    reason?: string;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.section_rewrite.undone', docId, sectionId, {
    originalActionKind: options?.originalActionKind ?? 'rewrite',
    reason: options?.reason,
    sectionTitle: options?.sectionTitle,
  });
}

/**
 * 记录 AI 总结应用
 */
export function logAiSummaryApplied(
  docId: string,
  sectionId: string,
  options?: {
    sectionTitle?: string;
    bulletCount?: number;
  }
): void {
  interactionLog.log('ai.section_summary.applied', docId, sectionId, {
    sectionTitle: options?.sectionTitle,
    bulletCount: options?.bulletCount,
  });
}

/**
 * 记录 AI 复合操作应用
 */
export function logAiComplexApplied(
  docId: string,
  sectionId: string,
  options?: {
    actionKind?: string;
    steps?: string[];
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.section_complex.applied', docId, sectionId, {
    actionKind: options?.actionKind ?? 'complex',
    steps: options?.steps,
    sectionTitle: options?.sectionTitle,
  });
}

/**
 * 记录文档保存
 */
export function logDocSaved(docId: string, saveType: 'manual' | 'auto' = 'manual'): void {
  interactionLog.log('doc.saved', docId, null, { saveType });
}

/**
 * 记录版本快照创建
 */
export function logVersionSnapshotCreated(
  docId: string,
  snapshotId: string,
  description?: string
): void {
  interactionLog.log('doc.version_snapshot_created', docId, null, {
    snapshotId,
    description,
  });
}

// ==========================================
// v2 新增便捷函数
// ==========================================

/**
 * 记录 AI 标记关键句
 */
export function logAiKeySentencesMarked(
  docId: string,
  sectionId: string,
  options: {
    sentenceCount: number;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.key_sentences.marked', docId, sectionId, {
    sentenceCount: options.sentenceCount,
    sectionTitle: options.sectionTitle,
  });
}

/**
 * 记录 AI 标记关键词语
 */
export function logAiKeyTermsMarked(
  docId: string,
  sectionId: string,
  options: {
    termCount: number;
    avgTermLength?: number;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.key_terms.marked', docId, sectionId, {
    termCount: options.termCount,
    avgTermLength: options.avgTermLength,
    sectionTitle: options.sectionTitle,
  });
}

/**
 * 记录用户手动格式操作
 */
export function logUserInlineFormat(
  docId: string,
  sectionId: string | null,
  options: {
    format: 'bold' | 'italic' | 'underline' | 'highlight' | 'strikethrough';
    charLength: number;
    wordCount?: number;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('user.inline_format.applied', docId, sectionId, {
    format: options.format,
    charLength: options.charLength,
    wordCount: options.wordCount,
    sectionTitle: options.sectionTitle,
  });
}

/**
 * 记录用户撤销操作
 */
export function logUserUndo(
  docId: string,
  sectionId: string | null,
  options?: {
    targetKind?: string;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('user.undo', docId, sectionId, {
    targetKind: options?.targetKind,
    sectionTitle: options?.sectionTitle,
  });
}

/**
 * 记录用户更改标题级别
 */
export function logUserHeadingChanged(
  docId: string,
  sectionId: string,
  options: {
    levelBefore: number;
    levelAfter: number;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('user.heading_changed', docId, sectionId, {
    levelBefore: options.levelBefore,
    levelAfter: options.levelAfter,
    sectionTitle: options.sectionTitle,
  });
}

/**
 * 记录系统快照创建
 */
export function logSystemSnapshotCreated(
  docId: string,
  sectionId: string | null,
  options: {
    snapshotId: string;
    reason?: 'before_ai_action' | 'manual' | 'auto_backup';
    relatedActionKind?: string;
  }
): void {
  interactionLog.log('system.snapshot.created', docId, sectionId, {
    snapshotId: options.snapshotId,
    reason: options.reason,
    relatedActionKind: options.relatedActionKind,
  });
}

/**
 * 记录 AI 选区改写
 */
export function logAiSelectionRewriteApplied(
  docId: string,
  sectionId: string | null,
  options?: {
    charLength?: number;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.selection_rewrite.applied', docId, sectionId, {
    charLength: options?.charLength,
    sectionTitle: options?.sectionTitle,
  });
}

// ==========================================
// v2 Intent Protocol 便捷函数
// ==========================================

/**
 * 记录 AI 生成 Intent
 */
export function logAiIntentGenerated(
  docId: string,
  sectionId: string | null,
  options: {
    intentId: string;
    responseMode: 'auto_apply' | 'preview' | 'clarify';
    confidence?: number;
    uncertaintiesCount?: number;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.intent.generated', docId, sectionId, {
    intentId: options.intentId,
    responseMode: options.responseMode,
    confidence: options.confidence,
    uncertaintiesCount: options.uncertaintiesCount,
    sectionTitle: options.sectionTitle,
  });
}

/**
 * 记录 UI 展示澄清问题
 */
export function logAiIntentClarifyShown(
  docId: string,
  sectionId: string | null,
  options: {
    intentId: string;
    uncertaintyField: string;
    candidateOptions?: string[];
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.intent.clarify.shown', docId, sectionId, {
    intentId: options.intentId,
    uncertaintyField: options.uncertaintyField,
    candidateOptions: options.candidateOptions,
    sectionTitle: options.sectionTitle,
  });
}

/**
 * 记录用户选择澄清选项
 */
export function logAiIntentClarifyResolved(
  docId: string,
  sectionId: string | null,
  options: {
    intentId: string;
    uncertaintyField: string;
    userChoice: string;
    isCustomInput?: boolean;
    sectionTitle?: string;
  }
): void {
  interactionLog.log('ai.intent.clarify.resolved', docId, sectionId, {
    intentId: options.intentId,
    uncertaintyField: options.uncertaintyField,
    userChoice: options.userChoice,
    isCustomInput: options.isCustomInput,
    sectionTitle: options.sectionTitle,
  });
}

