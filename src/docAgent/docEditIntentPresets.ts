/**
 * DocEdit Intent Presets - 命令到 Macro 的适配层（v3 重构）
 * 
 * 【v3 设计原则】
 * - 只保留原子意图，组合逻辑放在 Orchestrator 层
 * - SectionEditMacro 描述"步骤组合"，不引入新的 SectionAgentKind
 * - preset 只描述"组合关系"，由 Orchestrator 展开执行
 * 
 * 【使用方式】
 * ```ts
 * // 从命令 key 获取 macro
 * const macro = getMacroForCommand('rewrite_section_with_highlight');
 * // macro.steps = [{ kind: 'rewrite_section' }, { kind: 'highlight_section' }]
 * 
 * // Orchestrator 展开执行
 * for (const step of macro.steps) {
 *   await runAtomicStep(step);
 * }
 * ```
 */

import {
  DocEditIntent,
  DocEditTarget,
  ToneType,
  LengthType,
  HighlightMode,
  HighlightStyle,
  INTENT_DEFAULTS,
} from './docEditTypes';
import type { RewriteTone } from '../runtime/intents/types';

// ==========================================
// v3: SectionEditMacro - 原子步骤组合
// ==========================================

/**
 * 原子步骤类型（v3）
 * 
 * 只有原子意图，不包含混合意图
 */
export type AtomicStepKind = 
  | 'rewrite_section'    // 改写
  | 'highlight_section'  // 高亮（独立操作）
  | 'summarize_section'  // 总结（预留）
  | 'expand_section';    // 扩写（预留）

/**
 * 改写步骤参数
 */
export interface RewriteStepParams {
  /** 语气（使用 runtime/intents/types.ts 中的 RewriteTone 类型） */
  tone?: RewriteTone;
  keepStructure?: boolean;
  scope?: 'intro' | 'chapter';
}

/**
 * 高亮步骤参数
 */
export interface HighlightStepParams {
  /** 高亮模式：terms / sentences */
  mode?: 'terms' | 'sentences';
  /** 高亮样式 */
  style?: HighlightStyle;
  /** 词语数量（mode=terms 时有效） */
  termCount?: number;
  /** 句子数量（mode=sentences 时有效） */
  sentenceCount?: number;
}

/**
 * 原子步骤定义
 */
export type AtomicStep = 
  | { kind: 'rewrite_section'; params?: RewriteStepParams }
  | { kind: 'highlight_section'; params?: HighlightStepParams }
  | { kind: 'summarize_section'; params?: { bulletCount?: number } }
  | { kind: 'expand_section'; params?: { length?: 'short' | 'medium' | 'long' } };

/**
 * SectionEditMacro - 原子步骤组合（v3 核心类型）
 * 
 * 每个 Copilot 命令对应一个 Macro，Macro 是原子步骤的有序组合
 * Orchestrator 按顺序执行 steps，每个 step 独立调用对应的 SectionAI agent
 */
export interface SectionEditMacro {
  /** 原子步骤序列（顺序执行） */
  steps: AtomicStep[];
  /** 是否允许改写（用于 UI 状态判断） */
  rewriteEnabled: boolean;
  /** 是否允许高亮（用于 UI 状态判断） */
  highlightEnabled: boolean;
  /** 描述（用于日志/调试） */
  description?: string;
}

// ==========================================
// Macro 定义表
// ==========================================

/**
 * 命令到 Macro 的映射表
 * 
 * 【设计原则】
 * - 每个命令对应一个 Macro
 * - Macro 只描述步骤组合，不做实际执行
 * - 实际执行由 Orchestrator 负责
 */
const COMMAND_TO_MACRO: Record<string, SectionEditMacro> = {
  // ========== 原子命令 ==========
  
  /** 只改写（原子操作） */
  'rewrite_section': {
    steps: [{ kind: 'rewrite_section' }],
    rewriteEnabled: true,
    highlightEnabled: false,
    description: '只改写',
  },
  
  /** 只改写导语 */
  'rewrite_section_intro': {
    steps: [{ kind: 'rewrite_section', params: { scope: 'intro' } }],
    rewriteEnabled: true,
    highlightEnabled: false,
    description: '改写导语',
  },
  
  /** 整章改写 */
  'rewrite_section_chapter': {
    steps: [{ kind: 'rewrite_section', params: { scope: 'chapter' } }],
    rewriteEnabled: true,
    highlightEnabled: false,
    description: '整章改写',
  },
  
  /** 只高亮（原子操作，独立于改写） */
  'highlight_section': {
    steps: [{ kind: 'highlight_section', params: { mode: 'terms', termCount: 5 } }],
    rewriteEnabled: false,
    highlightEnabled: true,
    description: '只高亮',
  },
  
  /** 标记重点词语并加粗 */
  'highlight_key_terms': {
    steps: [{ kind: 'highlight_section', params: { style: 'bold', mode: 'terms', termCount: 5 } }],
    rewriteEnabled: false,
    highlightEnabled: true,
    description: '标记重点词语（加粗）',
  },
  
  /** 总结章节 */
  'summarize_section': {
    steps: [{ kind: 'summarize_section', params: { bulletCount: 3 } }],
    rewriteEnabled: false,
    highlightEnabled: false,
    description: '总结章节',
  },
  
  /** 扩写章节 */
  'expand_section': {
    steps: [{ kind: 'expand_section', params: { length: 'medium' } }],
    rewriteEnabled: true,
    highlightEnabled: false,
    description: '扩写章节',
  },
  
  // ========== 组合命令（由原子步骤组成） ==========
  
  /** 改写 + 高亮 */
  'rewrite_and_highlight': {
    steps: [
      { kind: 'rewrite_section' },
      { kind: 'highlight_section', params: { style: 'bold', mode: 'terms', termCount: 4 } },
    ],
    rewriteEnabled: true,
    highlightEnabled: true,
    description: '改写并高亮重点',
  },
  
  /** @deprecated 改写 + 标记重点（向后兼容） */
  'rewrite_section_with_highlight': {
    steps: [
      { kind: 'rewrite_section' },
      { kind: 'highlight_section', params: { style: 'bold', mode: 'terms', termCount: 4 } },
    ],
    rewriteEnabled: true,
    highlightEnabled: true,
    description: '[deprecated] 改写并标记重点',
  },
  
  /** @deprecated 改写 + 标记重点 + 摘要（向后兼容） */
  'rewrite_section_with_highlight_and_summary': {
    steps: [
      { kind: 'rewrite_section' },
      { kind: 'highlight_section', params: { style: 'bold', mode: 'terms', termCount: 4 } },
      { kind: 'summarize_section', params: { bulletCount: 3 } },
    ],
    rewriteEnabled: true,
    highlightEnabled: true,
    description: '[deprecated] 改写、高亮并摘要',
  },
};

// ==========================================
// 核心函数
// ==========================================

/**
 * 获取命令对应的 Macro（v3 核心函数）
 * 
 * @param commandKey - Copilot 命令 key
 * @returns SectionEditMacro，或 undefined 如果命令不存在
 */
export function getMacroForCommand(commandKey: string): SectionEditMacro | undefined {
  return COMMAND_TO_MACRO[commandKey];
}

/**
 * 检查命令是否有对应的 Macro
 */
export function hasMacro(commandKey: string): boolean {
  return commandKey in COMMAND_TO_MACRO;
}

/**
 * 获取所有支持的命令 key
 */
export function getSupportedCommandKeys(): string[] {
  return Object.keys(COMMAND_TO_MACRO);
}

/**
 * 描述 Macro 的步骤（用于日志）
 */
export function describeMacro(macro: SectionEditMacro): string {
  const stepNames = macro.steps.map(s => s.kind).join(' → ');
  return `[${stepNames}]`;
}

// ==========================================
// 向后兼容：旧版 Preset 系统
// ==========================================

/**
 * 预设名称（@deprecated，使用 getMacroForCommand 代替）
 */
export type IntentPresetName =
  | 'rewritePlain'
  | 'rewriteWithHighlight'
  | 'rewriteWithHighlightAndSummary'
  | 'rewriteWithSummary'
  | 'highlightOnly'
  | 'summaryOnly';

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

/**
 * 预设配置表（@deprecated）
 */
const PRESETS: Record<IntentPresetName, {
  rewrite: boolean;
  highlight: boolean;
  summary: boolean;
}> = {
  rewritePlain: { rewrite: true, highlight: false, summary: false },
  rewriteWithHighlight: { rewrite: true, highlight: true, summary: false },
  rewriteWithHighlightAndSummary: { rewrite: true, highlight: true, summary: true },
  rewriteWithSummary: { rewrite: true, highlight: false, summary: true },
  highlightOnly: { rewrite: false, highlight: true, summary: false },
  summaryOnly: { rewrite: false, highlight: false, summary: true },
};

/**
 * Copilot 命令 key 到预设名的映射（@deprecated）
 */
const COMMAND_TO_PRESET: Record<string, IntentPresetName> = {
  'rewrite_section_with_highlight': 'rewriteWithHighlight',
  'rewrite_section_with_highlight_and_summary': 'rewriteWithHighlightAndSummary',
  'highlight_key_terms': 'highlightOnly',
  'highlight_section': 'highlightOnly',
  'rewrite_section_plain': 'rewritePlain',
  'rewrite_section_intro': 'rewritePlain',
  'rewrite_section_chapter': 'rewritePlain',
  'summarize_section': 'summaryOnly',
};

/**
 * 从用户输入检测高亮模式
 */
function detectHighlightModeFromInput(userInput?: string): HighlightMode {
  if (!userInput) return 'sentences';
  
  const input = userInput.toLowerCase();
  
  const termsPatterns = [
    '重点词语', '重点单词', '重点词', '关键词', '关键单词',
    '核心术语', '专业术语', '重要词语', '重要单词',
    '几个词', '个词语', '个单词', '个词', '加粗', '标粗',
    'key terms', 'keywords', 'key phrases', 'key words', 'bold',
  ];
  
  const sentencesPatterns = [
    '关键句', '重要句子', '核心观点句', '主题句', '重点句',
    'key sentences', 'important sentences',
  ];
  
  const hasTermsKeyword = termsPatterns.some(p => input.includes(p));
  const hasSentencesKeyword = sentencesPatterns.some(p => input.includes(p));
  
  if (hasTermsKeyword && hasSentencesKeyword) return 'mixed';
  if (hasTermsKeyword) return 'terms';
  if (hasSentencesKeyword) return 'sentences';
  if (/\d+\s*[-–~]\s*\d+\s*个/.test(input) || /\d+\s*个/.test(input)) return 'terms';
  
  return 'sentences';
}

/**
 * @deprecated 使用 getMacroForCommand + Orchestrator 代替
 * 
 * 从 Copilot 命令 key 创建 DocEditIntent
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
 * @deprecated 使用 getMacroForCommand + Orchestrator 代替
 * 
 * 根据预设名创建 DocEditIntent
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
  if (preset.rewrite && !context.highlightOnly) {
    intent.rewrite = {
      enabled: true,
      tone: context.tone ?? INTENT_DEFAULTS.rewrite.tone,
      length: context.length ?? INTENT_DEFAULTS.rewrite.length,
      keepStructure: context.keepStructure ?? INTENT_DEFAULTS.rewrite.keepStructure,
    };
  } else {
    intent.rewrite = { enabled: false };
    console.log('[IntentPresets] Rewrite disabled (preset.rewrite:', preset.rewrite, ', highlightOnly:', context.highlightOnly, ')');
  }
  
  // 配置 highlight
  if (preset.highlight) {
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

/**
 * @deprecated 使用 getMacroForCommand 代替
 */
export function isCommandSupportedForIntent(commandKey: string): boolean {
  return commandKey in COMMAND_TO_PRESET || commandKey in COMMAND_TO_MACRO;
}

/**
 * @deprecated
 */
export function getPresetNames(): IntentPresetName[] {
  return Object.keys(PRESETS) as IntentPresetName[];
}

/**
 * @deprecated
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

/**
 * 创建自定义 Intent（@deprecated）
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
