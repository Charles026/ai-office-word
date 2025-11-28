/**
 * DocEdit Intent Presets - 命令到 Intent 的适配层
 * 
 * 【职责】
 * - 将 Copilot 命令 key 映射为结构化的 DocEditIntent
 * - 保持 UI/命令层与 Intent 层解耦
 * - 支持预设和自定义两种模式
 * 
 * 【使用方式】
 * ```ts
 * // 从命令 key 创建 Intent
 * const intent = buildDocEditIntentFromCommand('rewrite_section_with_highlight', {
 *   docId: 'doc-1',
 *   sectionId: 'sec-7',
 * });
 * 
 * // 从预设创建 Intent
 * const intent = getIntentPreset('rewriteWithHighlight', {
 *   docId: 'doc-1',
 *   sectionId: 'sec-7',
 * });
 * ```
 */

import {
  DocEditIntent,
  DocEditTarget,
  ToneType,
  LengthType,
  INTENT_DEFAULTS,
} from './docEditTypes';

// ==========================================
// 预设名称类型
// ==========================================

/**
 * 预设名称
 */
export type IntentPresetName =
  | 'rewritePlain'
  | 'rewriteWithHighlight'
  | 'rewriteWithHighlightAndSummary'
  | 'rewriteWithSummary'
  | 'highlightOnly'
  | 'summaryOnly';

// ==========================================
// 上下文类型
// ==========================================

/**
 * Intent 构建上下文
 */
export interface IntentBuildContext {
  /** 文档 ID */
  docId: string;
  /** 章节 ID */
  sectionId: string;
  /** 语气（可选） */
  tone?: ToneType;
  /** 长度（可选） */
  length?: LengthType;
  /** 高亮数量（可选） */
  highlightCount?: number;
  /** 摘要条数（可选） */
  bulletCount?: number;
  /** 是否保持结构（可选） */
  keepStructure?: boolean;
}

// ==========================================
// 预设配置
// ==========================================

/**
 * 预设配置表
 * 
 * 每个预设定义了 rewrite/highlight/summary 的开关状态
 */
const PRESETS: Record<IntentPresetName, {
  rewrite: boolean;
  highlight: boolean;
  summary: boolean;
}> = {
  rewritePlain: {
    rewrite: true,
    highlight: false,
    summary: false,
  },
  rewriteWithHighlight: {
    rewrite: true,
    highlight: true,
    summary: false,
  },
  rewriteWithHighlightAndSummary: {
    rewrite: true,
    highlight: true,
    summary: true,
  },
  rewriteWithSummary: {
    rewrite: true,
    highlight: false,
    summary: true,
  },
  highlightOnly: {
    rewrite: false,
    highlight: true,
    summary: false,
  },
  summaryOnly: {
    rewrite: false,
    highlight: false,
    summary: true,
  },
};

/**
 * Copilot 命令 key 到预设名的映射
 */
const COMMAND_TO_PRESET: Record<string, IntentPresetName> = {
  // 复合命令
  'rewrite_section_with_highlight': 'rewriteWithHighlight',
  'rewrite_section_with_highlight_and_summary': 'rewriteWithHighlightAndSummary',
  
  // 简单命令（未来扩展）
  'rewrite_section_plain': 'rewritePlain',
  'rewrite_section_intro': 'rewritePlain',
  'rewrite_section_chapter': 'rewritePlain',
  'summarize_section': 'summaryOnly',
};

// ==========================================
// 核心函数
// ==========================================

/**
 * 从 Copilot 命令 key 创建 DocEditIntent
 * 
 * @param commandKey - Copilot 命令 key
 * @param context - 构建上下文
 * @returns DocEditIntent
 * 
 * @example
 * ```ts
 * const intent = buildDocEditIntentFromCommand('rewrite_section_with_highlight', {
 *   docId: 'doc-1',
 *   sectionId: 'sec-7',
 *   tone: 'formal',
 * });
 * ```
 */
export function buildDocEditIntentFromCommand(
  commandKey: string,
  context: IntentBuildContext
): DocEditIntent {
  const presetName = COMMAND_TO_PRESET[commandKey];
  
  if (!presetName) {
    console.warn(`[IntentPresets] Unknown command key: ${commandKey}, using default preset`);
    return getIntentPreset('rewritePlain', context);
  }
  
  return getIntentPreset(presetName, context);
}

/**
 * 根据预设名创建 DocEditIntent
 * 
 * @param presetName - 预设名称
 * @param context - 构建上下文
 * @returns DocEditIntent
 */
export function getIntentPreset(
  presetName: IntentPresetName,
  context: IntentBuildContext
): DocEditIntent {
  const preset = PRESETS[presetName];
  
  if (!preset) {
    throw new Error(`[IntentPresets] Unknown preset: ${presetName}`);
  }
  
  const target: DocEditTarget = {
    docId: context.docId,
    sectionId: context.sectionId,
  };
  
  const intent: DocEditIntent = {
    kind: 'section_edit',
    target,
  };
  
  // 配置 rewrite
  if (preset.rewrite) {
    intent.rewrite = {
      enabled: true,
      tone: context.tone ?? INTENT_DEFAULTS.rewrite.tone,
      length: context.length ?? INTENT_DEFAULTS.rewrite.length,
      keepStructure: context.keepStructure ?? INTENT_DEFAULTS.rewrite.keepStructure,
    };
  }
  
  // 配置 highlight
  if (preset.highlight) {
    intent.highlight = {
      enabled: true,
      highlightCount: context.highlightCount ?? INTENT_DEFAULTS.highlight.highlightCount,
    };
  }
  
  // 配置 summary
  if (preset.summary) {
    intent.summary = {
      enabled: true,
      bulletCount: context.bulletCount ?? INTENT_DEFAULTS.summary.bulletCount,
    };
  }
  
  return intent;
}

/**
 * 创建自定义 Intent
 * 
 * 用于不通过预设，直接指定开关的场景
 * 
 * @param context - 构建上下文
 * @param options - 能力开关
 */
export function buildCustomIntent(
  context: IntentBuildContext,
  options: {
    rewrite?: boolean;
    highlight?: boolean;
    summary?: boolean;
  }
): DocEditIntent {
  const target: DocEditTarget = {
    docId: context.docId,
    sectionId: context.sectionId,
  };
  
  const intent: DocEditIntent = {
    kind: 'section_edit',
    target,
  };
  
  if (options.rewrite !== false) {
    intent.rewrite = {
      enabled: options.rewrite ?? true,
      tone: context.tone ?? INTENT_DEFAULTS.rewrite.tone,
      length: context.length ?? INTENT_DEFAULTS.rewrite.length,
      keepStructure: context.keepStructure ?? INTENT_DEFAULTS.rewrite.keepStructure,
    };
  }
  
  if (options.highlight) {
    intent.highlight = {
      enabled: true,
      highlightCount: context.highlightCount ?? INTENT_DEFAULTS.highlight.highlightCount,
    };
  }
  
  if (options.summary) {
    intent.summary = {
      enabled: true,
      bulletCount: context.bulletCount ?? INTENT_DEFAULTS.summary.bulletCount,
    };
  }
  
  return intent;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 检查命令是否支持 Intent 预设
 */
export function isCommandSupportedForIntent(commandKey: string): boolean {
  return commandKey in COMMAND_TO_PRESET;
}

/**
 * 获取所有支持的命令 key
 */
export function getSupportedCommandKeys(): string[] {
  return Object.keys(COMMAND_TO_PRESET);
}

/**
 * 获取所有预设名
 */
export function getPresetNames(): IntentPresetName[] {
  return Object.keys(PRESETS) as IntentPresetName[];
}

/**
 * 获取预设的能力开关描述
 */
export function describePreset(presetName: IntentPresetName): string {
  const preset = PRESETS[presetName];
  if (!preset) return 'Unknown preset';
  
  const features: string[] = [];
  if (preset.rewrite) features.push('改写');
  if (preset.highlight) features.push('标记重点');
  if (preset.summary) features.push('生成摘要');
  
  return features.join(' + ') || '无操作';
}

