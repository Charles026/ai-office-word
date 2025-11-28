/**
 * Behavior Summary Builder
 * 
 * 【职责】
 * 基于 InteractionLog 生成用户行为摘要，供 LLM 使用。
 * 
 * 【设计】
 * - 规则版实现（不用 LLM）
 * - 生成 3～5 条 bullet，控制在 100～200 字
 * - 摘要内容：最近访问的章节、AI 操作次数、撤销操作等
 */

import { interactionLog } from './interactionLog';
import {
  InteractionEvent,
  AiRewriteMeta,
  UndoMeta,
} from './interactionTypes';

// ==========================================
// 类型定义
// ==========================================

/**
 * 行为摘要结果
 */
export interface BehaviorSummary {
  /** 直接给 LLM 的一段自然语言摘要 */
  summaryText: string;
  /** 分条 bullet（调试用） */
  bullets: string[];
  /** 统计信息 */
  stats: {
    /** 时间窗口内的事件数量 */
    eventCount: number;
    /** 涉及的章节数量 */
    sectionCount: number;
    /** AI 操作数量 */
    aiOperationCount: number;
    /** 撤销操作数量 */
    undoCount: number;
  };
}

/**
 * 章节活动统计
 */
interface SectionActivity {
  sectionId: string;
  title: string | null;
  focusCount: number;
  rewriteCount: number;
  summaryCount: number;
  undoCount: number;
  lastActiveTime: number;
}

// ==========================================
// 核心函数
// ==========================================

/**
 * 构建最近行为摘要
 * 
 * @param options.docId - 文档 ID（宽松模式下可选）
 * @param options.windowMs - 时间窗口（毫秒），默认 10 分钟
 * @param options.loose - 宽松模式：不按 docId/时间过滤，直接取最近 N 条事件
 */
const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

export function buildRecentBehaviorSummary(options: {
  docId: string;
  windowMs?: number;
  loose?: boolean;  // 🆕 宽松模式开关
  looseLimit?: number;  // 宽松模式下取多少条事件
}): BehaviorSummary {
  const { docId, windowMs = 10 * 60 * 1000, loose = true, looseLimit = 30 } = options;
  
  // DEV: 调试日志 - 显示当前日志总数
  const allEvents = interactionLog.getAllEvents();
  if (__DEV__) {
    console.log('[BehaviorSummary] Total events in log:', allEvents.length);
  }

  // 🆕 宽松模式：直接取最近 N 条事件，不按 docId/时间过滤
  let events: InteractionEvent[];
  if (loose) {
    events = interactionLog.getRecentEventsLoose({ limit: looseLimit });
    if (__DEV__) {
      console.log('[BehaviorSummary] Using LOOSE mode, got events:', events.length);
    }
  } else {
    events = interactionLog.getRecentInteractions({ docId, windowMs, limit: 100 });
    if (__DEV__) {
      console.log('[BehaviorSummary] Using STRICT mode, filtered events for docId:', events.length);
    }
  }

  if (events.length === 0) {
    if (__DEV__) {
      console.log('[BehaviorSummary] No events found, returning empty summary');
    }
    return {
      summaryText: '',
      bullets: [],
      stats: {
        eventCount: 0,
        sectionCount: 0,
        aiOperationCount: 0,
        undoCount: 0,
      },
    };
  }

  // 1. 统计章节活动
  const sectionActivities = analyzeSectionActivities(events);

  // 2. 统计 AI 操作
  const aiStats = analyzeAiOperations(events);

  // 3. 统计撤销操作
  const undoEvents = events.filter(e => e.kind === 'ai.section_rewrite.undone');

  // 4. 检查是否有保存/快照
  const saveEvents = events.filter(e => e.kind === 'doc.saved');
  const snapshotEvents = events.filter(e => e.kind === 'doc.version_snapshot_created');

  // 5. 生成 bullets
  const bullets: string[] = [];
  const windowMinutes = Math.round(windowMs / 60000);

  // Bullet 1: 最近活跃的章节
  const activeSections = Object.values(sectionActivities)
    .sort((a, b) => (b.focusCount + b.rewriteCount * 2) - (a.focusCount + a.rewriteCount * 2))
    .slice(0, 3);

  if (activeSections.length > 0) {
    const sectionNames = activeSections
      .map(s => s.title ? `「${s.title}」` : `章节${s.sectionId.slice(-4)}`)
      .join('、');
    bullets.push(`最近 ${windowMinutes} 分钟主要在编辑 ${sectionNames}`);
  }

  // Bullet 2: AI 重写统计
  if (aiStats.rewriteCount > 0) {
    const rewriteDetails: string[] = [];
    for (const [sectionId, count] of Object.entries(aiStats.rewriteBySectionId)) {
      const activity = sectionActivities[sectionId];
      const name = activity?.title ? `「${activity.title}」` : `章节${sectionId.slice(-4)}`;
      rewriteDetails.push(`${name}被重写了 ${count} 次`);
    }
    if (rewriteDetails.length > 0) {
      bullets.push(rewriteDetails.slice(0, 2).join('，'));
    }
    // 添加语气信息
    if (aiStats.lastRewriteTone) {
      bullets.push(`最近一次重写采用了「${toneLabel(aiStats.lastRewriteTone)}」语气`);
    }
  }

  // Bullet 3: 撤销操作
  if (undoEvents.length > 0) {
    const undoSections = undoEvents
      .map(e => {
        const meta = e.meta as UndoMeta | undefined;
        return meta?.sectionTitle ? `「${meta.sectionTitle}」` : null;
      })
      .filter(Boolean);
    if (undoSections.length > 0) {
      bullets.push(`用户撤销了 ${undoEvents.length} 次 AI 操作（涉及 ${[...new Set(undoSections)].join('、')}）`);
    } else {
      bullets.push(`用户撤销了 ${undoEvents.length} 次 AI 操作`);
    }
  }

  // Bullet 4: AI 总结
  if (aiStats.summaryCount > 0) {
    bullets.push(`生成了 ${aiStats.summaryCount} 次章节摘要`);
  }

  // Bullet 5: 保存/快照
  if (snapshotEvents.length > 0) {
    bullets.push(`本次写作创建了 ${snapshotEvents.length} 个版本快照`);
  } else if (saveEvents.length > 0) {
    bullets.push(`文档已保存 ${saveEvents.length} 次`);
  }

  // 6. 如果 bullets 为空但有事件，生成一个基础摘要
  if (bullets.length === 0 && events.length > 0) {
    const latestEvent = events[0];
    bullets.push(`最近共有 ${events.length} 条操作记录`);
    if (latestEvent.sectionId) {
      const title = extractSectionTitle(latestEvent);
      bullets.push(`最新操作：${eventKindLabel(latestEvent.kind)}（${title || latestEvent.sectionId.slice(-6)}）`);
    }
  }

  // 7. 生成 summaryText
  const summaryText = bullets.length > 0 
    ? `用户最近的文档操作：\n${bullets.map(b => `- ${b}`).join('\n')}`
    : '';

  // DEV: 调试日志 - 显示生成的摘要
  if (__DEV__) {
    console.log('[BehaviorSummary] Used events for summary:', events.length);
    console.log('[BehaviorSummary] summaryText (first 100 chars):', summaryText.slice(0, 100));
  }

  return {
    summaryText,
    bullets,
    stats: {
      eventCount: events.length,
      sectionCount: Object.keys(sectionActivities).length,
      aiOperationCount: aiStats.rewriteCount + aiStats.summaryCount + aiStats.complexCount,
      undoCount: undoEvents.length,
    },
  };
}

/**
 * 事件类型标签
 */
function eventKindLabel(kind: string): string {
  switch (kind) {
    case 'section.focus_changed': return '切换章节';
    case 'section.renamed': return '重命名';
    case 'ai.section_rewrite.applied': return 'AI 重写';
    case 'ai.section_rewrite.undone': return '撤销重写';
    case 'ai.section_summary.applied': return 'AI 总结';
    case 'ai.section_complex.applied': return 'AI 复合操作';
    case 'doc.saved': return '保存文档';
    case 'doc.version_snapshot_created': return '创建快照';
    default: return kind;
  }
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 分析章节活动
 */
function analyzeSectionActivities(events: InteractionEvent[]): Record<string, SectionActivity> {
  const activities: Record<string, SectionActivity> = {};

  for (const event of events) {
    if (!event.sectionId) continue;

    if (!activities[event.sectionId]) {
      activities[event.sectionId] = {
        sectionId: event.sectionId,
        title: extractSectionTitle(event),
        focusCount: 0,
        rewriteCount: 0,
        summaryCount: 0,
        undoCount: 0,
        lastActiveTime: event.timestamp,
      };
    }

    const activity = activities[event.sectionId];
    activity.lastActiveTime = Math.max(activity.lastActiveTime, event.timestamp);

    // 更新标题（取最新的）
    const title = extractSectionTitle(event);
    if (title) {
      activity.title = title;
    }

    switch (event.kind) {
      case 'section.focus_changed':
        activity.focusCount++;
        break;
      case 'ai.section_rewrite.applied':
        activity.rewriteCount++;
        break;
      case 'ai.section_summary.applied':
        activity.summaryCount++;
        break;
      case 'ai.section_rewrite.undone':
        activity.undoCount++;
        break;
    }
  }

  return activities;
}

/**
 * 分析 AI 操作
 */
function analyzeAiOperations(events: InteractionEvent[]): {
  rewriteCount: number;
  summaryCount: number;
  complexCount: number;
  rewriteBySectionId: Record<string, number>;
  lastRewriteTone: string | null;
} {
  let rewriteCount = 0;
  let summaryCount = 0;
  let complexCount = 0;
  const rewriteBySectionId: Record<string, number> = {};
  let lastRewriteTone: string | null = null;

  for (const event of events) {
    switch (event.kind) {
      case 'ai.section_rewrite.applied': {
        rewriteCount++;
        if (event.sectionId) {
          rewriteBySectionId[event.sectionId] = (rewriteBySectionId[event.sectionId] || 0) + 1;
        }
        const meta = event.meta as AiRewriteMeta | undefined;
        if (meta?.tone) {
          lastRewriteTone = meta.tone;
        }
        break;
      }
      case 'ai.section_summary.applied':
        summaryCount++;
        break;
      case 'ai.section_complex.applied':
        complexCount++;
        break;
    }
  }

  return {
    rewriteCount,
    summaryCount,
    complexCount,
    rewriteBySectionId,
    lastRewriteTone,
  };
}

/**
 * 从事件中提取章节标题
 */
function extractSectionTitle(event: InteractionEvent): string | null {
  const meta = event.meta as any;
  if (!meta) return null;

  // 不同事件类型的标题字段
  return meta.sectionTitle 
    || meta.toSectionTitle 
    || meta.titleAfter 
    || null;
}

/**
 * 语气标签
 */
function toneLabel(tone: string): string {
  switch (tone) {
    case 'formal':
      return '正式';
    case 'casual':
      return '轻松';
    case 'neutral':
      return '中性';
    default:
      return tone;
  }
}

// ==========================================
// 英文版摘要（可选）
// ==========================================

/**
 * 构建英文行为摘要
 */
export function buildRecentBehaviorSummaryEN(options: {
  docId: string;
  windowMs?: number;
}): string {
  const summary = buildRecentBehaviorSummary(options);
  
  if (summary.bullets.length === 0) {
    return '';
  }

  const windowMinutes = Math.round((options.windowMs || 600000) / 60000);
  const parts: string[] = [];

  parts.push(`In the last ${windowMinutes} minutes:`);

  if (summary.stats.sectionCount > 0) {
    parts.push(`The user has been editing ${summary.stats.sectionCount} section(s).`);
  }

  if (summary.stats.aiOperationCount > 0) {
    parts.push(`${summary.stats.aiOperationCount} AI operation(s) were applied.`);
  }

  if (summary.stats.undoCount > 0) {
    parts.push(`${summary.stats.undoCount} AI operation(s) were undone.`);
  }

  return parts.join(' ');
}

