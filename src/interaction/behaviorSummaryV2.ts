/**
 * Behavior Summary V2 Builder
 * 
 * 【职责】
 * 基于 InteractionLog 生成用户行为摘要，供 LLM 使用。
 * 
 * 【v2 设计原则】
 * - 只提供客观的行为数据，不做偏好推断
 * - 让 LLM 自己根据行为数据判断用户偏好
 * - textSummary 只陈述事实，不出现"更常""更偏好"等结论性词语
 * 
 * 【数据结构】
 * - BehaviorMetrics: 行为统计数据
 * - BehaviorContext: 结构化上下文（只包含事实）
 * - textSummary: 自然语言描述 + 使用说明
 */

import { interactionLog } from './interactionLog';
import type {
  InteractionEvent,
  AiRewriteMeta,
  AiKeySentencesMarkedMeta,
  AiKeyTermsMarkedMeta,
  UserInlineFormatMeta,
} from './interactionTypes';

// ==========================================
// 常量
// ==========================================

const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

// ==========================================
// 类型定义
// ==========================================

/**
 * 行为统计指标（纯事实数据）
 */
export interface BehaviorMetrics {
  // AI 操作
  rewriteCount: number;
  summaryCount: number;
  aiKeySentenceCount: number;
  aiKeyTermCount: number;
  
  // 用户操作
  undoCount: number;
  userInlineTermsCount: number;         // 短选区格式操作（wordCount <= 4）
  userInlineSentenceFormatCount: number; // 长选区格式操作（wordCount >= 8）
  
  // 最后一次操作
  lastActionKind: string | null;
  lastActionTs: number | null;
  
  // 语气信息
  lastRewriteTone: string | null;
}

/**
 * 编辑统计信息
 */
export interface BehaviorEditsInfo {
  /** AI 重写次数 */
  rewriteCount: number;
  /** 撤销次数 */
  undoCount: number;
  /** 最后一次操作类型 */
  lastActionKind?: string;
  /** 最后一次操作时间 */
  lastActionTs?: number;
}

/**
 * 焦点信息
 */
export interface BehaviorFocus {
  docId: string;
  sectionId: string;
  sectionTitle?: string;
}

/**
 * 行为上下文（结构化，只包含事实数据）
 * 
 * 注意：不包含任何偏好推断，让 LLM 自己判断
 */
export interface BehaviorContext {
  focus: BehaviorFocus;
  edits: BehaviorEditsInfo;
  /** 详细的行为统计指标 */
  metrics: BehaviorMetrics;
}

/**
 * 构建参数
 */
export interface BuildBehaviorSummaryV2Params {
  docId: string;
  scope: 'section';
  sectionId: string;
  sectionTitle?: string;
  /** 时间窗口（毫秒），默认 10 分钟 */
  windowMs?: number;
  /** 最大事件数量，默认 50 */
  limit?: number;
}

/**
 * 构建结果
 */
export interface BuildBehaviorSummaryV2Result {
  /** 自然语言摘要（给 System Prompt 用） */
  textSummary: string;
  /** 结构化上下文（给调试/日志用） */
  behaviorContext: BehaviorContext | null;
}

// ==========================================
// 核心函数
// ==========================================

/**
 * 构建 BehaviorSummary v2
 * 
 * 设计原则：只提供事实数据，不做偏好推断
 * 
 * @param params - 构建参数
 * @returns BuildBehaviorSummaryV2Result - 包含 textSummary 和 behaviorContext
 */
export function buildBehaviorSummaryV2(params: BuildBehaviorSummaryV2Params): BuildBehaviorSummaryV2Result {
  const {
    docId,
    sectionId,
    sectionTitle,
    windowMs = 10 * 60 * 1000,
    limit = 50,
  } = params;

  // 1. 拉取最近事件
  const allEvents = interactionLog.getRecentInteractions({
    docId,
    windowMs,
    limit,
  });

  if (__DEV__) {
    console.log(`[BehaviorSummaryV2] Events for docId ${docId}: total=${allEvents.length}`);
  }

  // 2. 过滤出与 sectionId 相关的事件
  const sectionEvents = allEvents.filter(
    event => event.sectionId === sectionId
  );

  if (__DEV__) {
    console.log(`[BehaviorSummaryV2] Events for section ${sectionId}: ${sectionEvents.length}`);
  }

  // 3. 如果没有相关事件，返回空
  if (sectionEvents.length === 0 && allEvents.length === 0) {
    if (__DEV__) {
      console.log('[BehaviorSummaryV2] No events found, returning empty result');
    }
    return {
      textSummary: '',
      behaviorContext: null,
    };
  }

  // 4. 计算聚合指标
  const metrics = computeMetrics(sectionEvents, allEvents);

  if (__DEV__) {
    console.log('[BehaviorSummaryV2] Metrics:', metrics);
  }

  // 5. 构建 BehaviorContext（只包含事实数据）
  const behaviorContext: BehaviorContext = {
    focus: {
      docId,
      sectionId,
      sectionTitle,
    },
    edits: {
      rewriteCount: metrics.rewriteCount,
      undoCount: metrics.undoCount,
      lastActionKind: metrics.lastActionKind ?? undefined,
      lastActionTs: metrics.lastActionTs ?? undefined,
    },
    metrics,
  };

  // 6. 构建 textSummary（只描述事实 + 使用说明）
  const textSummary = buildTextSummary({
    sectionTitle,
    metrics,
    windowMinutes: Math.round(windowMs / 60000),
  });

  if (__DEV__) {
    console.log(`[BehaviorSummaryV2] textSummary length: ${textSummary.length}`);
  }

  return {
    textSummary,
    behaviorContext,
  };
}

// ==========================================
// 指标计算
// ==========================================

/**
 * 计算行为指标（纯统计，不做任何推断）
 */
function computeMetrics(
  sectionEvents: InteractionEvent[],
  allEvents: InteractionEvent[]
): BehaviorMetrics {
  const metrics: BehaviorMetrics = {
    rewriteCount: 0,
    summaryCount: 0,
    aiKeySentenceCount: 0,
    aiKeyTermCount: 0,
    undoCount: 0,
    userInlineTermsCount: 0,
    userInlineSentenceFormatCount: 0,
    lastActionKind: null,
    lastActionTs: null,
    lastRewriteTone: null,
  };

  // 处理 section 相关事件
  for (const event of sectionEvents) {
    switch (event.kind) {
      case 'ai.section_rewrite.applied': {
        metrics.rewriteCount++;
        const meta = event.meta as AiRewriteMeta | undefined;
        if (meta?.tone) {
          metrics.lastRewriteTone = meta.tone;
        }
        break;
      }
      case 'ai.section_summary.applied':
        metrics.summaryCount++;
        break;
      case 'ai.key_sentences.marked': {
        const meta = event.meta as AiKeySentencesMarkedMeta | undefined;
        metrics.aiKeySentenceCount += meta?.sentenceCount ?? 1;
        break;
      }
      case 'ai.key_terms.marked': {
        const meta = event.meta as AiKeyTermsMarkedMeta | undefined;
        metrics.aiKeyTermCount += meta?.termCount ?? 1;
        break;
      }
      case 'ai.section_rewrite.undone':
      case 'user.undo':
        metrics.undoCount++;
        break;
      case 'user.inline_format.applied': {
        const meta = event.meta as UserInlineFormatMeta | undefined;
        const wordCount = meta?.wordCount ?? 0;
        if (wordCount <= 4) {
          metrics.userInlineTermsCount++;
        } else if (wordCount >= 8) {
          metrics.userInlineSentenceFormatCount++;
        }
        break;
      }
    }
  }

  // 获取最后一次操作（从所有事件中获取）
  if (allEvents.length > 0) {
    const lastEvent = allEvents[0];
    metrics.lastActionKind = lastEvent.kind;
    metrics.lastActionTs = lastEvent.timestamp;
  }

  return metrics;
}

// ==========================================
// 文本摘要构建
// ==========================================

interface TextSummaryParams {
  sectionTitle?: string;
  metrics: BehaviorMetrics;
  windowMinutes: number;
}

/**
 * 构建自然语言摘要
 * 
 * 设计原则：
 * - 只客观描述用户做了什么
 * - 不出现"更常""更偏好""倾向于"等结论性词语
 * - 让 LLM 自己根据这些数据判断用户偏好
 */
function buildTextSummary(params: TextSummaryParams): string {
  const { sectionTitle, metrics, windowMinutes } = params;
  const lines: string[] = [];

  // 第一行：当前小节 + 时间窗口
  const sectionName = sectionTitle ? `小节「${sectionTitle}」` : '当前小节';
  lines.push(`最近 ${windowMinutes} 分钟，你主要在编辑${sectionName}。`);

  // 第二部分：编辑行为
  const editParts: string[] = [];
  if (metrics.rewriteCount > 0) {
    editParts.push(`使用 AI 重写了 ${metrics.rewriteCount} 次`);
  }
  if (metrics.undoCount > 0) {
    editParts.push(`撤销过 ${metrics.undoCount} 次`);
  }
  if (editParts.length > 0) {
    lines.push(`在这一小节中，你${editParts.join('，并')}。`);
  }

  // 第三部分：重点标记行为（分开描述，让 LLM 自己判断）
  if (metrics.userInlineTermsCount > 0) {
    lines.push(`你手动对 ${metrics.userInlineTermsCount} 段短语（通常是 2～4 个词）应用了加粗/高亮。`);
  }
  if (metrics.userInlineSentenceFormatCount > 0) {
    lines.push(`你手动对 ${metrics.userInlineSentenceFormatCount} 句长句应用了加粗/高亮。`);
  }
  if (metrics.aiKeySentenceCount > 0) {
    lines.push(`AI 为你标记了 ${metrics.aiKeySentenceCount} 句关键句。`);
  }
  if (metrics.aiKeyTermCount > 0) {
    lines.push(`AI 为你标记了 ${metrics.aiKeyTermCount} 个关键词语。`);
  }

  // 语气信息（如果有）
  if (metrics.lastRewriteTone) {
    lines.push(`最近一次重写采用了「${toneLabel(metrics.lastRewriteTone)}」语气。`);
  }

  // 如果没有足够信息，返回空
  if (lines.length === 1 && metrics.rewriteCount === 0 && metrics.undoCount === 0) {
    return '';
  }

  return lines.join('\n');
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
    case 'polished':
      return '精炼';
    default:
      return tone;
  }
}

// ==========================================
// 导出辅助函数（用于测试）
// ==========================================

export const __internal = {
  computeMetrics,
  buildTextSummary,
  toneLabel,
};
