/**
 * Copilot 命令定义与解析
 * 
 * 【职责】
 * - 定义 Copilot 支持的文档操作命令
 * - 实现自然语言 → 命令的规则解析逻辑（第一级）
 * - 提供粗类分类（RoughKind）供 LLM Router 使用
 * 
 * 【设计原则】
 * - 自然语言只是入口，真正的权力在 Intent & DocOps
 * - Copilot 是中枢而不是聊天玩具
 * - 规则层只处理「非常确定」的命令，模糊场景交给 LLM Router
 * 
 * 【两级架构】
 * 1. 规则层（本文件）：关键词粗筛，高置信度直接执行
 * 2. LLM Router（intentRouterAgent.ts）：模糊场景精判
 */

import { CopilotScope, CopilotContext } from './copilotTypes';

// ==========================================
// 命令类型定义
// ==========================================

/**
 * Copilot 命令类型（v3 - Atomic Intent 重构）
 * 
 * 【v3 重构原则】
 * 只保留原子命令，组合逻辑通过 SectionEditMacro 在 Orchestrator 层处理
 * 
 * 原子命令：
 * - rewrite_section_intro / rewrite_section_chapter: 改写
 * - summarize_section: 总结
 * - expand_section: 扩写
 * - highlight_section: 高亮（独立操作，不依赖改写）
 * 
 * 混合命令（@deprecated，保留向后兼容）：
 * - rewrite_section_with_highlight → 使用 macro: [rewrite, highlight]
 * - rewrite_section_with_highlight_and_summary → 使用 macro: [rewrite, highlight, summary]
 */
export type CopilotCommand =
  // ========== 选区级命令 ==========
  | 'rewrite_selection'
  | 'summarize_selection'
  | 'translate_selection'
  
  // ========== 章节级原子命令 ==========
  | 'rewrite_section_intro'    // 重写章节导语
  | 'rewrite_section_chapter'  // 整章重写
  | 'summarize_section'        // 总结章节
  | 'expand_section'           // 扩写章节
  | 'highlight_section'        // 🆕 独立高亮（原子操作）
  
  // ========== @deprecated 混合命令（向后兼容） ==========
  /** @deprecated 使用 macro: [rewrite, highlight] 代替 */
  | 'rewrite_section_with_highlight'
  /** @deprecated 使用 macro: [rewrite, highlight, summary] 代替 */
  | 'rewrite_section_with_highlight_and_summary'
  /** @deprecated 使用 highlight_section 代替 */
  | 'highlight_key_terms'
  
  // ========== 文档级命令 ==========
  | 'summarize_document';

/**
 * 粗类枚举 - 用于规则层粗分类和 LLM Router 辅助
 * 
 * 【设计原则】
 * - 只做「非常粗」的意图分类，例如 rewrite / summarize / expand / translate
 * - 不在 rules 层决定：高亮/加粗、词语还是句子、样式等细节
 * - 这些细节由 CanonicalIntent LLM 来理解
 */
export type RoughKind = 'rewrite' | 'summarize' | 'translate' | 'expand' | 'highlight' | 'unknown';

/**
 * 命令解析结果
 */
export interface ResolvedCommand {
  /** 命令类型 */
  command: CopilotCommand;
  /** 实际作用范围（基于上下文修正） */
  scope: CopilotScope;
  /** 关联文档 ID */
  docId: string | null;
  /** 章节 ID（section 级命令需要） */
  sectionId?: string | null;
  /** 章节标题 */
  sectionTitle?: string | null;
  /** 命令选项（未来可扩展 tone、length 等） */
  options?: Record<string, unknown>;
}

/**
 * 规则解析结果（带置信度）
 */
export interface RuleResolvedCommand extends ResolvedCommand {
  /** 置信度 */
  confidence: 'high' | 'low';
  /** 粗类 */
  roughKind: RoughKind;
}

// ==========================================
// 命令元信息
// ==========================================

/**
 * 命令描述映射（用于生成 action 消息）
 */
export const COMMAND_LABELS: Record<CopilotCommand, string> = {
  // 选区级
  rewrite_selection: '重写选区',
  summarize_selection: '总结选区',
  translate_selection: '翻译选区',
  // 章节级原子命令
  rewrite_section_intro: '重写章节导语',
  rewrite_section_chapter: '重写整章',
  summarize_section: '总结章节',
  expand_section: '扩写章节',
  highlight_section: '标记重点',  // 🆕 独立高亮
  // @deprecated 混合命令（向后兼容）
  rewrite_section_with_highlight: '改写并标记重点',
  rewrite_section_with_highlight_and_summary: '改写、标记重点并生成摘要',
  highlight_key_terms: '标记重点词语',
  // 文档级
  summarize_document: '总结文档',
};

/**
 * 命令是否需要 sectionId
 */
export function commandNeedsSection(command: CopilotCommand): boolean {
  return [
    // 原子命令
    'rewrite_section_intro',
    'rewrite_section_chapter',
    'summarize_section',
    'expand_section',
    'highlight_section',  // 🆕 独立高亮
    // @deprecated 混合命令
    'rewrite_section_with_highlight',
    'rewrite_section_with_highlight_and_summary',
    'highlight_key_terms',
  ].includes(command);
}

/**
 * 命令是否需要选区
 */
export function commandNeedsSelection(command: CopilotCommand): boolean {
  return [
    'rewrite_selection',
    'summarize_selection',
    'translate_selection',
  ].includes(command);
}

/**
 * 命令是否已实现
 */
export function isCommandImplemented(command: CopilotCommand): boolean {
  // 当前已实现的 section 级命令
  return [
    // 原子命令
    'rewrite_section_intro',
    'rewrite_section_chapter',
    'summarize_section',
    'expand_section',
    'highlight_section',  // 🆕 独立高亮
    // @deprecated 混合命令（通过 macro 转换后仍可用）
    'rewrite_section_with_highlight',
    'rewrite_section_with_highlight_and_summary',
    'highlight_key_terms',
  ].includes(command);
}

// ==========================================
// 关键词匹配规则
// ==========================================

interface MatchRule {
  keywords: string[];
  command: CopilotCommand;
  /** 需要的最小 scope */
  minScope?: CopilotScope;
  /** 修饰词（用于区分子类型） */
  modifiers?: {
    keywords: string[];
    command: CopilotCommand;
  }[];
}

/**
 * 复合意图关键词（标记重点、摘要等）
 */
const HIGHLIGHT_KEYWORDS = ['标记重点', '加粗重点', '高亮', '标记', '重点', 'highlight', 'mark key', 'bold'];
const HIGHLIGHT_ONLY_KEYWORDS = [
  '标记重点词语',
  '标记重点单词',
  '重点词语',
  '重点单词',
  '关键词',
  '关键字',
  '高亮一下',
  '标粗',
  '加粗',
  'bold',
  'highlight key terms',
  'mark key terms',
];
const REWRITE_KEYWORDS_FOR_INTENT = [
  '重写', '改写', '润色', '优化', 'rewrite', 'polish', 'make it better', 'make it clearer', '更好', '更正式',
];
const SUMMARY_KEYWORDS = ['生成摘要', '加摘要', '添加摘要', '总结要点', 'add summary', 'bullet summary', 'bullet'];

/**
 * 检查是否包含标记重点意图
 */
function hasHighlightIntent(text: string): boolean {
  return HIGHLIGHT_KEYWORDS.some(kw => text.includes(kw));
}

function hasRewriteIntent(text: string): boolean {
  return REWRITE_KEYWORDS_FOR_INTENT.some(kw => text.includes(kw.toLowerCase()));
}

function isHighlightOnlyIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  const hasHighlight = HIGHLIGHT_ONLY_KEYWORDS.some(kw => normalized.includes(kw.toLowerCase()));
  return hasHighlight && !hasRewriteIntent(normalized);
}

/**
 * 检查是否包含摘要意图
 */
function hasSummaryIntent(text: string): boolean {
  return SUMMARY_KEYWORDS.some(kw => text.includes(kw));
}

const MATCH_RULES: MatchRule[] = [
  // 总结类
  {
    keywords: ['总结', '概括', '总结一下', '总结本节', '总结这个', 'summary', 'summarize', 'summarise'],
    command: 'summarize_section', // 默认 section 级
    modifiers: [
      { keywords: ['选区', '选中', '这段', '这些文字', 'selection', 'selected'], command: 'summarize_selection' },
      { keywords: ['整篇', '全文', '文档', 'document', 'whole doc'], command: 'summarize_document' },
    ],
  },
  // 重写/润色类
  {
    keywords: ['重写', '改写', '润色', '优化', 'polish', 'rewrite', 'make it better', 'make it clearer', '更好', '更正式', '更简洁'],
    command: 'rewrite_section_intro', // 默认 section intro
    modifiers: [
      { keywords: ['选区', '选中', '这段', '这些文字', 'selection', 'selected'], command: 'rewrite_selection' },
      { 
        keywords: [
          '整章', '整个章节', 'whole chapter', 'this chapter', '全章',
          '小点', '每个', '所有', '列表', '包括', '保留', 'all', 'every', 'including', 'keep'
        ], 
        command: 'rewrite_section_chapter' 
      },
    ],
  },
  // 扩写类
  {
    keywords: ['扩写', '展开', '详细一点', '写多一点', 'expand', 'add more detail', 'elaborate', '更详细'],
    command: 'expand_section',
  },
  // 翻译类
  {
    keywords: ['翻译', '译成', '英文', '中文', 'translate', 'into english', 'into chinese', '翻成'],
    command: 'translate_selection', // 默认选区级
  },
];

// ==========================================
// Refinement 关键词规则
// ==========================================

const REFINEMENT_KEYWORDS = [
  '再', '重新', '调整', '修改', '不对', '不行', '换', '更',
  'again', 'retry', 'refine', 'adjust', 'change', 'more'
];

/**
 * 检查是否包含 Refinement 意图
 */
function hasRefinementIntent(text: string): boolean {
  return REFINEMENT_KEYWORDS.some(kw => text.includes(kw));
}

// ==========================================
// 命令解析函数
// ==========================================

/**
 * 解析用户输入为 Copilot 命令
 * 
 * @param userText - 用户输入的原始文本
 * @param context - 当前 Copilot 上下文
 * @returns 解析出的命令，或 null（走普通聊天）
 */
export function resolveCopilotCommand(
  userText: string,
  context: CopilotContext
): ResolvedCommand | null {
  // 0. 无文档上下文，直接返回 null（走纯聊天）
  if (!context.docId) {
    return null;
  }

  // 1. 标准化文本
  const text = userText.toLowerCase();

  // 1.1 只标记/高亮意图（无改写）
  if (isHighlightOnlyIntent(text) && context.sectionId && context.docId) {
    return {
      command: 'highlight_key_terms',
      scope: 'section',
      docId: context.docId,
      sectionId: context.sectionId,
      sectionTitle: context.sectionTitle,
      options: {
        highlightOnly: true,
        originalInput: userText,
      },
    };
  }

  // 2. 尝试 Refinement 解析（优先处理连续对话）
  // 如果当前没有明确的 section 焦点（scope !== 'section'），
  // 或者用户输入明显是 refinement，则尝试复用上一次的上下文
  if (hasRefinementIntent(text)) {
    const lastAction = context.lastActions[context.lastActions.length - 1];
    
    // 检查是否有最近的操作记录（且属于当前文档）
    if (lastAction && lastAction.docId === context.docId) {
      // 如果上一次是 section 级操作，且当前没有聚焦其他 section
      if (lastAction.sectionId && (context.scope !== 'section' || context.sectionId === lastAction.sectionId)) {
        // 复用上一次的 section
        console.log('[CopilotCommands] Refinement detected, reusing section:', lastAction.sectionId);
        
        // 尝试解析当前意图的新命令
        // 例如上次是 summarize，这次说「重写」，则命令变为 rewrite
        // 如果这次只说「再来一次」，则沿用上次命令
        
        let newCommand: CopilotCommand = lastAction.type as CopilotCommand;
        
        // 尝试从当前文本解析新命令
        for (const rule of MATCH_RULES) {
          if (rule.keywords.some(kw => text.includes(kw))) {
            // 如果匹配到了新命令，且该命令支持 section 级
            const cmd = rule.command;
            if (commandNeedsSection(cmd)) {
              newCommand = cmd;
              break;
            }
          }
        }
        
        // 如果是「调整语气」等，通常意味着 rewrite
        if (text.includes('语气') || text.includes('tone') || text.includes('正式') || text.includes('口语')) {
          newCommand = 'rewrite_section_intro'; // 默认重写导语，或者需要根据上次操作类型决定
          if (lastAction.type === 'rewrite_section_chapter') newCommand = 'rewrite_section_chapter';
        }

        return {
          command: newCommand,
          scope: 'section', // 强制为 section
          docId: context.docId,
          sectionId: lastAction.sectionId,
          sectionTitle: lastAction.sectionTitle,
          options: {
            isRefinement: true, // 标记为 refinement
            refinementPrompt: userText, // 将用户的具体要求传给下游
          },
        };
      }
    }
  }

  // 3. 遍历规则匹配（常规解析）
  for (const rule of MATCH_RULES) {
    // ... (原有逻辑)
    // 检查主关键词是否匹配
    const mainMatch = rule.keywords.some(kw => text.includes(kw));
    if (!mainMatch) continue;

    // 找到匹配的规则，检查修饰词
    let matchedCommand = rule.command;
    
    if (rule.modifiers) {
      for (const modifier of rule.modifiers) {
        const modifierMatch = modifier.keywords.some(kw => text.includes(kw));
        if (modifierMatch) {
          matchedCommand = modifier.command;
          break;
        }
      }
    }

    // 🆕 检查复合意图：改写 + 标记重点 / 摘要
    if (matchedCommand === 'rewrite_section_intro' || matchedCommand === 'rewrite_section_chapter') {
      const wantsHighlight = hasHighlightIntent(text);
      const wantsSummary = hasSummaryIntent(text);
      
      if (wantsHighlight && wantsSummary) {
        matchedCommand = 'rewrite_section_with_highlight_and_summary';
        console.log('[CopilotCommands] 复合意图: 改写 + 标记重点 + 摘要');
      } else if (wantsHighlight) {
        matchedCommand = 'rewrite_section_with_highlight';
        console.log('[CopilotCommands] 复合意图: 改写 + 标记重点');
      }
    }

    // 3. 根据上下文修正命令
    const resolved = resolveWithContext(matchedCommand, context);
    if (resolved) {
      console.log('[CopilotCommands] Resolved:', matchedCommand, '→', resolved.command);
      return resolved;
    }
  }

  // 4. 无匹配规则，返回 null
  return null;
}

/**
 * 根据上下文修正命令
 */
function resolveWithContext(
  command: CopilotCommand,
  context: CopilotContext
): ResolvedCommand | null {
  const { docId, scope, sectionId, sectionTitle, selectionSnippet } = context;

  // 处理总结类命令
  if (command === 'summarize_selection' || command === 'summarize_section' || command === 'summarize_document') {
    // 有选区 → summarize_selection
    if (scope === 'selection' && selectionSnippet) {
      return {
        command: 'summarize_selection',
        scope: 'selection',
        docId,
        options: {},
      };
    }
    // 有 section → summarize_section
    if ((scope === 'section' || scope === 'document') && sectionId) {
      return {
        command: 'summarize_section',
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options: {},
      };
    }
    // 否则 → summarize_document（暂未实现，返回 null）
    return null;
  }

  // 处理复合命令（改写 + 标记重点 / 摘要）
  if (command === 'rewrite_section_with_highlight' || command === 'rewrite_section_with_highlight_and_summary') {
    if ((scope === 'section' || scope === 'document') && sectionId) {
      return {
        command,
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options: {
          highlightKeySentences: true,
          highlightCount: 2,
          addSummary: command === 'rewrite_section_with_highlight_and_summary',
          bulletCount: 3,
        },
      };
    }
    return null;
  }

  // 处理重写类命令
  if (command === 'rewrite_selection' || command === 'rewrite_section_intro' || command === 'rewrite_section_chapter') {
    // 有选区 → rewrite_selection
    if (scope === 'selection' && selectionSnippet) {
      return {
        command: 'rewrite_selection',
        scope: 'selection',
        docId,
        options: {},
      };
    }
    // 有 section → 默认 rewrite_section_intro
    if ((scope === 'section' || scope === 'document') && sectionId) {
      return {
        command: command === 'rewrite_section_chapter' ? 'rewrite_section_chapter' : 'rewrite_section_intro',
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options: {},
      };
    }
    // 无上下文
    return null;
  }

  // 处理扩写命令
  if (command === 'expand_section') {
    if (sectionId) {
      return {
        command: 'expand_section',
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options: {},
      };
    }
    return null;
  }

  // 处理翻译命令
  if (command === 'translate_selection') {
    if (scope === 'selection' && selectionSnippet) {
      return {
        command: 'translate_selection',
        scope: 'selection',
        docId,
        options: {},
      };
    }
    // 无选区时暂不支持
    return null;
  }

  return null;
}

/**
 * 构建命令执行前的描述文案
 */
export function buildActionDescription(resolved: ResolvedCommand): string {
  const label = COMMAND_LABELS[resolved.command];
  
  if (resolved.sectionTitle) {
    return `${label}：${resolved.sectionTitle}`;
  }
  
  return label;
}

/**
 * 构建命令不可执行时的提示文案
 */
export function buildContextMissingMessage(command: CopilotCommand): string {
  if (commandNeedsSection(command)) {
    return '当前没有聚焦到某一小节，无法执行该操作。请先将光标移动到对应的标题处。';
  }
  if (commandNeedsSelection(command)) {
    return '当前没有选中任何文本，无法执行该操作。请先选中一段内容。';
  }
  return '无法执行该操作，请检查当前上下文。';
}

/**
 * 构建命令暂未实现的提示文案
 */
export function buildNotImplementedMessage(command: CopilotCommand): string {
  const label = COMMAND_LABELS[command];
  return `「${label}」功能正在开发中，你可以先通过大纲面板的右键菜单或 Ribbon 工具栏按钮来执行类似操作。`;
}

// ==========================================
// 粗类分类函数（第一级：纯字符串规则）
// ==========================================

/**
 * 粗类关键词映射
 * 
 * 【设计原则】
 * - 只做「非常粗」的意图分类
 * - 不匹配「高亮/加粗/重点词语/重点单词」这些细节词汇
 * - 这些细节由 CanonicalIntent LLM 来理解用户意图
 */
const ROUGH_KIND_KEYWORDS: Record<Exclude<RoughKind, 'unknown'>, string[]> = {
  summarize: ['总结', '概括', '总结一下', '总结本节', 'summary', 'summarize', 'summarise'],
  translate: ['翻译', '译成', '英文', '中文', 'translate', 'into english', 'into chinese', '翻成'],
  rewrite: ['重写', '改写', '润色', '优化', 'polish', 'rewrite', 'make it better', 'make it clearer'],
  expand: ['扩写', '展开', '详细一点', '写多一点', 'expand', 'add more detail', 'elaborate', '更详细'],
  highlight: ['标记', '高亮', '加粗', 'bold', 'highlight', 'mark'],
};

/**
 * 获取粗类（纯字符串规则，不依赖上下文）
 * 
 * @param userText - 用户输入
 * @returns 粗类枚举
 */
export function getRoughKind(userText: string): RoughKind {
  const text = userText.toLowerCase();
  
  // 按优先级检查
  for (const [kind, keywords] of Object.entries(ROUGH_KIND_KEYWORDS) as [Exclude<RoughKind, 'unknown'>, string[]][]) {
    if (keywords.some(kw => text.includes(kw))) {
      return kind;
    }
  }
  
  return 'unknown';
}

// ==========================================
// 规则层解析函数（第一级：高置信度解析）
// ==========================================

const __DEV__ = process.env.NODE_ENV !== 'production';

/**
 * 规则层解析命令
 * 
 * 只处理「非常确定」的命令，模糊场景返回 null 或 confidence='low'
 * 
 * @param userText - 用户输入
 * @param context - 当前上下文
 * @returns 规则解析结果（带置信度），或 null
 */
export function resolveCopilotCommandByRules(
  userText: string,
  context: CopilotContext
): RuleResolvedCommand | null {
  // 0. 无文档上下文，直接返回 null
  if (!context.docId) {
    if (__DEV__) console.log('[Rules] No docId, skip');
    return null;
  }

  const text = userText.toLowerCase();
  const roughKind = getRoughKind(userText);
  
  if (__DEV__) {
    console.log('[Rules] Input:', userText.slice(0, 50), '| roughKind:', roughKind);
  }

  // 1. Refinement 场景（复用上一次操作的 section）
  if (hasRefinementIntent(text)) {
    const lastAction = context.lastActions[context.lastActions.length - 1];
    if (lastAction && lastAction.docId === context.docId && lastAction.sectionId) {
      // 复用上一次的 section
      let newCommand: CopilotCommand = lastAction.type as CopilotCommand;
      
      // 根据当前粗类更新命令
      if (roughKind === 'rewrite') newCommand = 'rewrite_section_intro';
      else if (roughKind === 'summarize') newCommand = 'summarize_section';
      else if (roughKind === 'expand') newCommand = 'expand_section';
      
      // 语气调整 → rewrite
      if (text.includes('语气') || text.includes('tone') || text.includes('正式') || text.includes('口语')) {
        newCommand = 'rewrite_section_intro';
      }

      if (__DEV__) {
        console.log('[Rules] Refinement → command:', newCommand, 'section:', lastAction.sectionId);
      }

      return {
        command: newCommand,
        scope: 'section',
        docId: context.docId,
        sectionId: lastAction.sectionId,
        sectionTitle: lastAction.sectionTitle,
        options: { isRefinement: true, refinementPrompt: userText },
        confidence: 'high',
        roughKind,
      };
    }
  }

  // 2. 根据 roughKind + context.scope 决定命令
  const { scope, sectionId, sectionTitle, selectionSnippet, docId } = context;

  // 2.1 Summarize
  if (roughKind === 'summarize') {
    if (scope === 'section' && sectionId) {
      return {
        command: 'summarize_section',
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options: {},
        confidence: 'high',
        roughKind,
      };
    }
    if (scope === 'selection' && selectionSnippet) {
      return {
        command: 'summarize_selection',
        scope: 'selection',
        docId,
        options: {},
        confidence: 'high',
        roughKind,
      };
    }
    // scope = document 或没有明确 section → 低置信度
    return {
      command: 'summarize_document',
      scope: 'document',
      docId,
      options: {},
      confidence: 'low',
      roughKind,
    };
  }

  // 2.2 Rewrite
  if (roughKind === 'rewrite') {
    if (scope === 'section' && sectionId) {
      // 🆕 检查复合意图：改写 + 标记重点 / 摘要
      const wantsHighlight = hasHighlightIntent(text);
      const wantsSummary = hasSummaryIntent(text);
      
      let command: CopilotCommand = 'rewrite_section_intro';
      let options: Record<string, unknown> = {};
      
      if (wantsHighlight && wantsSummary) {
        command = 'rewrite_section_with_highlight_and_summary';
        options = { highlightKeySentences: true, highlightCount: 3, addSummary: true, bulletCount: 3 };
        if (__DEV__) console.log('[Rules] 复合意图: 改写 + 标记重点 + 摘要');
      } else if (wantsHighlight) {
        command = 'rewrite_section_with_highlight';
        options = { highlightKeySentences: true, highlightCount: 3 };
        if (__DEV__) console.log('[Rules] 复合意图: 改写 + 标记重点');
      } else if (wantsSummary) {
        // 只有摘要没有高亮（较少见）
        command = 'rewrite_section_with_highlight_and_summary';
        options = { highlightKeySentences: false, addSummary: true, bulletCount: 3 };
        if (__DEV__) console.log('[Rules] 复合意图: 改写 + 摘要');
      }
      
      return {
        command,
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options,
        confidence: 'high',
        roughKind,
      };
    }
    if (scope === 'selection' && selectionSnippet) {
      return {
        command: 'rewrite_selection',
        scope: 'selection',
        docId,
        options: {},
        confidence: 'high',
        roughKind,
      };
    }
    // 没有明确上下文 → 低置信度
    return null;
  }

  // 2.3 Expand
  if (roughKind === 'expand') {
    if ((scope === 'section' || scope === 'document') && sectionId) {
      return {
        command: 'expand_section',
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options: {},
        confidence: 'high',
        roughKind,
      };
    }
    return null;
  }

  // 2.4 Translate
  if (roughKind === 'translate') {
    if (scope === 'selection' && selectionSnippet) {
      return {
        command: 'translate_selection',
        scope: 'selection',
        docId,
        options: {},
        confidence: 'high',
        roughKind,
      };
    }
    // 翻译通常需要选区，没有选区时返回 null
    return null;
  }

  // 2.5 Highlight (标记/高亮/加粗等) → 只高亮，不改写
  if (roughKind === 'highlight') {
    if ((scope === 'section' || scope === 'document') && sectionId) {
      if (__DEV__) console.log('[Rules] 纯高亮意图 → highlight_key_terms（无改写）');
      return {
        command: 'highlight_key_terms', // 🆕 只高亮，不改写
        scope: 'section',
        docId,
        sectionId,
        sectionTitle,
        options: {
          highlightOnly: true, // 明确标记：只高亮
          letLLMDecide: true,  // 让 LLM 决定具体 terms 和 style
        },
        confidence: 'high',
        roughKind,
      };
    }
    return null;
  }

  // 3. roughKind = 'unknown' → 规则层无法判断
  if (__DEV__) {
    console.log('[Rules] roughKind=unknown, returning null');
  }
  return null;
}

