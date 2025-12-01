/**
 * DocEdit Plan 构建器（v3 - Primitive 重构）
 * 
 * 【职责】
 * - 把高层 Intent 转成 Primitive 组合的 DocEditPlan
 * - 纯函数：不调用 LLM，不修改全局状态
 * 
 * 【v3 Primitive 重构】
 * - 每个 step 明确对应一个 DocAgent Primitive
 * - Plan 是 primitive 的有序组合
 * - 所有命令都是 primitive 的组合（如 rewrite_section_with_highlight = RewriteSection + HighlightKeyTerms）
 */

import {
  DocEditIntent,
  DocEditPlan,
  DocEditPlanStep,
  RewriteSectionStep,
  MarkKeySentencesStep,
  MarkKeyTermsStep,
  AppendBulletSummaryStep,
  NormalizedDocEditIntent,
  generateIntentId,
  isLegacyIntentKind,
  INTENT_DEFAULTS,
  DocAgentPrimitive,
  type HighlightMode,
} from './docEditTypes';
import { SectionContext } from '../runtime/context/types';

// ==========================================
// 常量
// ==========================================

const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

// ==========================================
// Intent 归一化
// ==========================================

/**
 * 将 DocEditIntent 归一化为 NormalizedDocEditIntent
 * 
 * 处理：
 * 1. 旧版 kind 转换为新版开关
 * 2. 补齐所有缺省参数
 * 3. 处理 @deprecated 字段的兼容
 */
export function normalizeDocEditIntent(intent: DocEditIntent): NormalizedDocEditIntent {
  // 如果是旧版 kind，先转换为新版开关
  if (isLegacyIntentKind(intent.kind)) {
    return normalizeLegacyIntent(intent);
  }

  // 新版 kind（section_edit）：基于子对象开关
  // 处理旧版 semantic.length 兼容（'keep' 视为 'same'）
  const rawLength = intent.rewrite?.length ?? intent.semantic?.length ?? INTENT_DEFAULTS.rewrite.length;
  const normalizedLength = rawLength === 'keep' ? 'same' : rawLength;
  
  const rewrite = {
    enabled: intent.rewrite?.enabled ?? INTENT_DEFAULTS.rewrite.enabled,
    tone: intent.rewrite?.tone 
      ?? intent.semantic?.tone 
      ?? INTENT_DEFAULTS.rewrite.tone,
    length: normalizedLength,
    keepStructure: intent.rewrite?.keepStructure ?? INTENT_DEFAULTS.rewrite.keepStructure,
  };

  // highlight mode 由用户指定或使用默认值
  // 不再根据 behavior.preferences 自动推断，让 LLM 自己理解用户偏好
  const highlightMode: HighlightMode = intent.highlight?.mode ?? INTENT_DEFAULTS.highlight.mode;

  const highlight = {
    enabled: intent.highlight?.enabled 
      ?? intent.formatting?.highlightKeySentences 
      ?? INTENT_DEFAULTS.highlight.enabled,
    mode: highlightMode,
    highlightCount: intent.highlight?.highlightCount 
      ?? intent.formatting?.highlightCount 
      ?? INTENT_DEFAULTS.highlight.highlightCount,
    termCount: intent.highlight?.termCount ?? INTENT_DEFAULTS.highlight.termCount,
    style: intent.highlight?.style ?? INTENT_DEFAULTS.highlight.style,
  };

  const summary = {
    enabled: intent.summary?.enabled ?? INTENT_DEFAULTS.summary.enabled,
    bulletCount: intent.summary?.bulletCount ?? INTENT_DEFAULTS.summary.bulletCount,
    style: intent.summary?.style ?? INTENT_DEFAULTS.summary.style,
  };

  return {
    kind: 'section_edit',
    target: intent.target,
    rewrite,
    highlight,
    summary,
  };
}

/**
 * 将旧版 Intent 转换为归一化格式
 * 
 * @deprecated 用于向后兼容，未来会移除
 * 
 * 注意：旧版 kind 值（如 'rewrite_section_with_highlight_and_summary'）
 * 已从 DocEditIntentKind 类型中移除，这里使用字符串比较进行兼容
 */
function normalizeLegacyIntent(intent: DocEditIntent): NormalizedDocEditIntent {
  if (__DEV__) {
    console.warn('[DocEditPlanner] Legacy intent kind detected:', intent.kind, '- Consider migrating to section_edit');
  }

  // 处理旧版 semantic.length 兼容（'keep' 视为 'same'）
  const rawLength = intent.semantic?.length ?? INTENT_DEFAULTS.rewrite.length;
  const normalizedLength = rawLength === 'keep' ? 'same' : rawLength;

  const baseRewrite = {
    enabled: true,
    tone: intent.semantic?.tone ?? INTENT_DEFAULTS.rewrite.tone,
    length: normalizedLength,
    keepStructure: INTENT_DEFAULTS.rewrite.keepStructure,
  };

  const baseHighlight = {
    enabled: false,
    mode: INTENT_DEFAULTS.highlight.mode,
    highlightCount: INTENT_DEFAULTS.highlight.highlightCount,
    termCount: INTENT_DEFAULTS.highlight.termCount,
    style: INTENT_DEFAULTS.highlight.style,
  };

  const baseSummary = {
    enabled: false,
    bulletCount: INTENT_DEFAULTS.summary.bulletCount,
    style: INTENT_DEFAULTS.summary.style,
  };

  // 使用字符串比较来处理旧版 kind（已从 DocEditIntentKind 类型中移除）
  const kindStr = intent.kind as string;

  if (kindStr === 'rewrite_section_with_highlight_and_summary') {
    return {
      kind: 'section_edit',
      target: intent.target,
      rewrite: baseRewrite,
      highlight: {
        ...baseHighlight,
        enabled: true,
        highlightCount: intent.formatting?.highlightCount ?? INTENT_DEFAULTS.highlight.highlightCount,
      },
      summary: {
        ...baseSummary,
        enabled: true,
        bulletCount: intent.summary?.bulletCount ?? INTENT_DEFAULTS.summary.bulletCount,
      },
    };
  }

  if (kindStr === 'rewrite_section_plain') {
    return {
      kind: 'section_edit',
      target: intent.target,
      rewrite: baseRewrite,
      highlight: baseHighlight,
      summary: baseSummary,
    };
  }

  if (kindStr === 'summarize_section_plain') {
    return {
      kind: 'section_edit',
      target: intent.target,
      rewrite: { ...baseRewrite, enabled: false },
      highlight: baseHighlight,
      summary: {
        ...baseSummary,
        enabled: true,
        bulletCount: intent.summary?.bulletCount ?? INTENT_DEFAULTS.summary.bulletCount,
      },
    };
  }

  // Fallback: 默认只启用 rewrite
  return {
    kind: 'section_edit',
    target: intent.target,
    rewrite: baseRewrite,
    highlight: baseHighlight,
    summary: baseSummary,
  };
}

// ==========================================
// 核心构建函数
// ==========================================

/**
 * 从 Intent + SectionContext 生成 DocEditPlan
 * 
 * v2 重构：根据子对象开关组合 Plan，不再依赖 kind 字符串
 * 
 * @param intent - 高层业务意图
 * @param sectionContext - 章节上下文（当前版本仅保留参数，未使用）
 * @returns DocEditPlan - 可执行的计划
 * 
 * @example
 * ```ts
 * // 纯改写
 * const intent = {
 *   kind: 'section_edit',
 *   target: { docId: 'doc-1', sectionId: 'sec-7' },
 *   rewrite: { enabled: true, tone: 'formal' },
 * };
 * const plan = buildDocEditPlanForIntent(intent, sectionContext);
 * // plan.steps = [rewrite_section]
 * 
 * // 改写 + 高亮 + 摘要
 * const intent = {
 *   kind: 'section_edit',
 *   target: { docId: 'doc-1', sectionId: 'sec-7' },
 *   rewrite: { enabled: true },
 *   highlight: { enabled: true },
 *   summary: { enabled: true },
 * };
 * const plan = buildDocEditPlanForIntent(intent, sectionContext);
 * // plan.steps = [rewrite_section, mark_key_sentences, append_bullet_summary]
 * ```
 */
export function buildDocEditPlanForIntent(
  intent: DocEditIntent,
  _sectionContext: SectionContext
): DocEditPlan {
  // 1. 归一化 Intent
  const normalized = normalizeDocEditIntent(intent);

  if (__DEV__) {
    console.debug('[DocEditPlanner] Normalized intent:', {
      kind: normalized.kind,
      rewrite: normalized.rewrite.enabled,
      highlight: normalized.highlight.enabled,
      summary: normalized.summary.enabled,
    });
  }

  // 2. 根据开关组合 Steps
  const steps: DocEditPlanStep[] = [];

  // ==========================================
  // Primitive 1: RewriteSection（如果启用）
  // ==========================================
  if (normalized.rewrite.enabled) {
    const rewriteStep: RewriteSectionStep = {
      type: 'rewrite_section',
      primitive: DocAgentPrimitive.RewriteSection,
      target: { sectionId: normalized.target.sectionId },
      options: {
        tone: normalized.rewrite.tone,
        length: normalized.rewrite.length,
        keepStructure: normalized.rewrite.keepStructure,
      },
    };
    steps.push(rewriteStep);
    
    if (__DEV__) {
      console.log('[DocEditPlanner] Added primitive: RewriteSection');
    }
  }

  // ==========================================
  // Primitive 2/3: Highlight（如果启用）
  // ==========================================
  if (normalized.highlight.enabled) {
    const mode = normalized.highlight.mode ?? 'sentences';
    
    if (mode === 'sentences') {
      // Primitive: HighlightKeySentences
      const highlightStep: MarkKeySentencesStep = {
        type: 'mark_key_sentences',
        primitive: DocAgentPrimitive.HighlightKeySentences,
        target: { sectionId: normalized.target.sectionId },
        options: {
          highlightCount: normalized.highlight.highlightCount,
          style: normalized.highlight.style,
        },
      };
      steps.push(highlightStep);
      
      if (__DEV__) {
        console.log('[DocEditPlanner] Added primitive: HighlightKeySentences');
      }
    } else if (mode === 'terms') {
      // Primitive: HighlightKeyTerms
      // 🆕 默认 style 为 'bold'，除非 intent 里明确指定了其他样式
      const highlightStyle = normalized.highlight.style ?? 'bold';
      const termsStep: MarkKeyTermsStep = {
        type: 'mark_key_terms',
        primitive: DocAgentPrimitive.HighlightKeyTerms,
        target: { sectionId: normalized.target.sectionId },
        // terms 将在执行时从 CanonicalIntent 或 fallback 填充
        terms: undefined,
        options: {
          termCount: normalized.highlight.termCount ?? INTENT_DEFAULTS.highlight.termCount,
          maxTermLength: 20,
          markKind: 'key_term',
          style: highlightStyle, // 🆕 传递样式
        },
      };
      steps.push(termsStep);
      
      if (__DEV__) {
        console.log('[DocEditPlanner] Added primitive: HighlightKeyTerms');
      }
    } else if (mode === 'mixed') {
      // 混合：HighlightKeySentences + HighlightKeyTerms
      const sentenceStep: MarkKeySentencesStep = {
        type: 'mark_key_sentences',
        primitive: DocAgentPrimitive.HighlightKeySentences,
        target: { sectionId: normalized.target.sectionId },
        options: {
          highlightCount: Math.min(2, normalized.highlight.highlightCount),
          style: normalized.highlight.style,
        },
      };
      steps.push(sentenceStep);
      
      const termsStep: MarkKeyTermsStep = {
        type: 'mark_key_terms',
        primitive: DocAgentPrimitive.HighlightKeyTerms,
        target: { sectionId: normalized.target.sectionId },
        terms: undefined,
        options: {
          termCount: Math.min(4, normalized.highlight.termCount ?? 4),
          maxTermLength: 20,
          markKind: 'key_term',
          style: normalized.highlight.style ?? 'bold', // 🆕 传递样式
        },
      };
      steps.push(termsStep);
      
      if (__DEV__) {
        console.log('[DocEditPlanner] Added primitives: HighlightKeySentences + HighlightKeyTerms');
      }
    }
  }

  // ==========================================
  // Primitive 4: AppendSummary（如果启用）
  // ==========================================
  if (normalized.summary.enabled) {
    const summaryStep: AppendBulletSummaryStep = {
      type: 'append_bullet_summary',
      primitive: DocAgentPrimitive.AppendSummary,
      target: { sectionId: normalized.target.sectionId },
      options: {
        bulletCount: normalized.summary.bulletCount,
        style: normalized.summary.style,
      },
    };
    steps.push(summaryStep);
    
    if (__DEV__) {
      console.log('[DocEditPlanner] Added primitive: AppendSummary');
    }
  }

  // 3. 如果没有任何步骤，抛出错误
  if (steps.length === 0) {
    throw new Error('[DocEditPlanner] No steps generated. At least one capability must be enabled.');
  }

  // 4. 构建 Plan
  const plan: DocEditPlan = {
    intentId: generateIntentId(),
    intentKind: 'section_edit', // 新版统一为 section_edit
    docId: normalized.target.docId,
    sectionId: normalized.target.sectionId,
    steps,
    meta: {
      createdAt: Date.now(),
      source: 'copilot',
      enabledFeatures: {
        rewrite: normalized.rewrite.enabled,
        highlight: normalized.highlight.enabled,
        summary: normalized.summary.enabled,
      },
    },
  };

  if (__DEV__) {
    logPlanSummary(plan);
  }

  return plan;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 打印 Plan 摘要（调试用）
 */
export function logPlanSummary(plan: DocEditPlan): void {
  console.log(`[DocEditPlan] intentId: ${plan.intentId}`);
  console.log(`[DocEditPlan] kind: ${plan.intentKind}`);
  console.log(`[DocEditPlan] target: doc=${plan.docId}, section=${plan.sectionId}`);
  console.log(`[DocEditPlan] features:`, plan.meta?.enabledFeatures);
  console.log(`[DocEditPlan] steps (${plan.steps.length}):`);
  plan.steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step.type}`, step.options);
  });
}

/**
 * 从 Plan 获取启用的功能列表
 */
export function getEnabledFeatures(plan: DocEditPlan): string[] {
  const features: string[] = [];
  for (const step of plan.steps) {
    switch (step.type) {
      case 'rewrite_section':
        features.push('rewrite');
        break;
      case 'mark_key_sentences':
        features.push('highlight_sentences');
        break;
      case 'mark_key_terms':
        features.push('highlight_terms');
        break;
      case 'append_bullet_summary':
        features.push('summary');
        break;
    }
  }
  return features;
}
