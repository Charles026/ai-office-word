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
  HighlightMode,
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
  /** 高亮模式（可选）：sentences / terms / mixed */
  highlightMode?: HighlightMode;
  /** 高亮数量（可选，用于 sentences） */
  highlightCount?: number;
  /** 关键词数量（可选，用于 terms） */
  termCount?: number;
  /** 摘要条数（可选） */
  bulletCount?: number;
  /** 是否保持结构（可选） */
  keepStructure?: boolean;
  /** 用户原始输入（用于关键词检测） */
  userInput?: string;
  /** 只高亮不改写（可选） */
  highlightOnly?: boolean;
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
  
  // 独立高亮命令（Primitive: HighlightKeyTerms only）
  'highlight_key_terms': 'highlightOnly',
  
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
  // 🆕 必须显式设置 enabled，否则 normalize 会默认 true
  if (preset.rewrite && !context.highlightOnly) {
    intent.rewrite = {
      enabled: true,
      tone: context.tone ?? INTENT_DEFAULTS.rewrite.tone,
      length: context.length ?? INTENT_DEFAULTS.rewrite.length,
      keepStructure: context.keepStructure ?? INTENT_DEFAULTS.rewrite.keepStructure,
    };
  } else {
    // 显式禁用 rewrite（防止 normalize 默认启用）
    intent.rewrite = { enabled: false };
    console.log('[IntentPresets] Rewrite disabled (preset.rewrite:', preset.rewrite, ', highlightOnly:', context.highlightOnly, ')');
  }
  
  // 配置 highlight
  if (preset.highlight) {
    // 🆕 根据 context 或 userInput 推断 highlightMode
    const detectedMode = context.highlightMode ?? detectHighlightModeFromInput(context.userInput);
    
    intent.highlight = {
      enabled: true,
      mode: detectedMode,
      highlightCount: context.highlightCount ?? INTENT_DEFAULTS.highlight.highlightCount,
      termCount: context.termCount ?? INTENT_DEFAULTS.highlight.termCount,
    };
    
    console.log('[IntentPresets] Highlight mode:', detectedMode, 'from input:', context.userInput?.slice(0, 50));
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

// ==========================================
// 高亮模式检测
// ==========================================

/**
 * 从用户输入检测高亮模式
 * 
 * 关键词规则：
 * - terms: 重点词语、关键词、核心术语、key terms、keywords
 * - sentences: 关键句、重要句子、key sentences
 * - 默认: sentences
 */
function detectHighlightModeFromInput(userInput?: string): HighlightMode {
  if (!userInput) {
    return 'sentences'; // 默认句子级
  }
  
  const input = userInput.toLowerCase();
  
  // 检测词语级关键词
  const termsPatterns = [
    '重点词语', '重点单词', '重点词',
    '关键词', '关键单词',
    '核心术语', '专业术语',
    '重要词语', '重要单词',
    '几个词', '个词语', '个单词', '个词',
    '加粗', '标粗',
    'key terms', 'keywords', 'key phrases', 'key words',
    'bold',
  ];
  
  // 检测句子级关键词
  const sentencesPatterns = [
    '关键句',
    '重要句子',
    '核心观点句',
    '主题句',
    '重点句',
    'key sentences',
    'important sentences',
  ];
  
  const hasTermsKeyword = termsPatterns.some(p => input.includes(p));
  const hasSentencesKeyword = sentencesPatterns.some(p => input.includes(p));
  
  if (hasTermsKeyword && hasSentencesKeyword) {
    return 'mixed'; // 同时提到两种，用混合模式
  }
  
  if (hasTermsKeyword) {
    return 'terms';
  }
  
  if (hasSentencesKeyword) {
    return 'sentences';
  }
  
  // 默认：如果没有明确关键词，检查是否有数量词 + "个"
  // 例如 "3-5 个" 更可能是指词语
  if (/\d+\s*[-–~]\s*\d+\s*个/.test(input) || /\d+\s*个/.test(input)) {
    // 如果有数量词，倾向于 terms
    return 'terms';
  }
  
  return 'sentences'; // 最终默认
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

