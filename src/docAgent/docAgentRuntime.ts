/**
 * DocAgent Runtime - DocEditPlan 执行器（v3 Orchestrator 重构）
 * 
 * 【职责】
 * - 执行 DocEditPlan，将 plan.steps 映射到 Primitive 调用
 * - 🆕 执行 SectionEditMacro，按顺序展开成原子步骤
 * - 协调 LLM 调用和文档修改
 * - 提供可追踪的执行机制
 * 
 * 【v3 Orchestrator 重构】
 * - 组合逻辑放在 Orchestrator 层，不在 Intent 层
 * - 每个 macro.step 独立调用对应的 SectionAI agent
 * - highlight_section 完全独立于 rewrite_section
 * - 统一使用 HighlightSpans primitive 处理高亮
 */

import { LexicalEditor } from 'lexical';
import { 
  DocEditPlan,
  RewriteSectionStep,
  MarkKeySentencesStep,
  MarkKeyTermsStep,
  HighlightSpansStep,
  AppendBulletSummaryStep,
  DocAgentPrimitive,
} from './docEditTypes';
import { 
  IntentTask,
  CanonicalIntent,
  HighlightSpansIntentTask,
} from '../ai/intent/intentTypes';
import { getCopilotEditor } from '../copilot/copilotRuntimeBridge';
import { extractSectionContext } from '../runtime/context';
import type { SectionContext } from '../runtime/context';
import { 
  runSectionAiAction, 
  SectionAiOptions,
  SectionAiResult,
} from '../actions/sectionAiActions';
import {
  getMacroForCommand,
  describeMacro,
  type AtomicStep,
  type AtomicStepKind,
} from './docEditIntentPresets';
import { logAiKeySentencesMarked } from '../interaction';
import {
  executeHighlightSpansPrimitive,
} from './primitives';
import { documentRuntime } from '../document';
import { reconcileAstToLexical } from '../core/commands/LexicalReconciler';
import { createOpMeta, type DocOp } from '../docops/types';

// ==========================================
// 执行结果类型
// ==========================================

export interface DocEditPlanResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  error?: string;
  stepResults?: StepResult[];
}

export interface StepResult {
  type: string;
  success: boolean;
  durationMs?: number;
  error?: string;
}

// ==========================================
// 辅助类型
// ==========================================

interface KeySentenceTarget {
  paragraphKey: string;
  sentenceText: string;
  startOffset: number;
  endOffset: number;
}

// ==========================================
// 常量
// ==========================================

const mockToast = {
  addToast: (msg: string, type: string) => {
    console.log(`[DocEdit Toast] ${type}: ${msg}`);
    return 'mock-id';
  },
  dismissToast: () => {},
};

// ==========================================
// 辅助函数：Task Normalize
// ==========================================

function normalizeDocEditTask(task: IntentTask): IntentTask {
  if (task.type === 'mark_key_terms') {
    return {
      type: 'highlight_spans',
      params: {
        target: 'key_terms',
        sectionId: task.params.sectionId,
        style: task.params.style === 'bold' ? 'bold' : 'default',
        terms: task.params.terms || task.params.targets,
      }
    };
  }
  return task;
}

function normalizeMarkKeyTermsStep(step: MarkKeyTermsStep): HighlightSpansStep {
  return {
    type: 'highlight_spans',
    primitive: DocAgentPrimitive.HighlightSpans,
    target: step.target,
    options: {
      target: 'key_terms',
      style: step.options.style || 'default',
      terms: step.terms
    }
  };
}

// ==========================================
// 核心执行函数
// ==========================================

export async function runDocEditPlan(plan: DocEditPlan): Promise<DocEditPlanResult> {
  console.log('[DocEdit] Starting plan execution:', {
    intentId: plan.intentId,
    intentKind: plan.intentKind,
    sectionId: plan.sectionId,
    steps: plan.steps.map(s => s.type),
  });

  // 验证 Plan
  const validation = validatePlanForExecution(plan);
  if (!validation.valid) {
    return {
      success: false,
      completedSteps: 0,
      totalSteps: plan.steps.length,
      error: validation.error,
    };
  }

  // 获取编辑器
  const editor = getCopilotEditor();
  if (!editor) {
    return {
      success: false,
      completedSteps: 0,
      totalSteps: plan.steps.length,
      error: 'Editor not available',
    };
  }

  const stepResults: StepResult[] = [];
  let latestCanonicalIntent: CanonicalIntent | undefined;

  // 按顺序执行每个步骤
  for (const step of plan.steps) {
    const startTime = Date.now();
    
    try {
      console.log(`[DocEdit] Executing step: ${step.type}`);
      
      switch (step.type) {
        case 'rewrite_section':
          const intent = await executeRewriteSectionStep(editor, plan, step);
          if (intent) {
            latestCanonicalIntent = intent;
          }
          break;
          
        case 'mark_key_terms':
        case 'highlight_spans':
          const spanStep = step.type === 'highlight_spans' ? step : normalizeMarkKeyTermsStep(step as MarkKeyTermsStep);
          await executeHighlightSpansStep(editor, spanStep, latestCanonicalIntent);
          break;

        case 'mark_key_sentences':
          await executeMarkKeySentencesStep(editor, plan, step);
          break;
          
        case 'append_bullet_summary':
          await executeAppendBulletSummaryStep(editor, plan, step);
          break;
          
        default:
          console.warn('[DocEdit] Unknown step type:', (step as any).type);
          throw new Error(`Unknown step type: ${(step as any).type}`);
      }

      stepResults.push({
        type: step.type,
        success: true,
        durationMs: Date.now() - startTime,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DocEdit] Step ${step.type} failed:`, error);
      
      return {
        success: false,
        completedSteps: stepResults.length,
        totalSteps: plan.steps.length,
        error: errorMessage,
        stepResults,
      };
    }
  }

  console.log('[DocEdit] Plan execution completed successfully');
  
  return {
    success: true,
    completedSteps: plan.steps.length,
    totalSteps: plan.steps.length,
    stepResults,
  };
}

/**
 * 验证 Plan 是否可执行
 */
export function validatePlanForExecution(plan: DocEditPlan): { valid: boolean; error?: string } {
  if (!plan.docId) return { valid: false, error: 'Missing docId' };
  if (!plan.sectionId) return { valid: false, error: 'Missing sectionId' };
  if (!plan.steps || plan.steps.length === 0) return { valid: false, error: 'Empty steps' };
  return { valid: true };
}

// ==========================================
// Step 执行器：rewrite_section
// ==========================================

async function executeRewriteSectionStep(
  editor: LexicalEditor,
  plan: DocEditPlan,
  step: RewriteSectionStep
): Promise<CanonicalIntent | undefined> {
  console.log('[DocEdit] Executing primitive: RewriteSection');
  
  const result = await runSectionAiAction(
    'rewrite',
    plan.sectionId,
    {
      editor,
      toast: mockToast as any,
      setAiProcessing: () => {},
    },
    {
      rewrite: {
        tone: step.options.tone,
        length: step.options.length,
        keepStructure: step.options.keepStructure,
      } as SectionAiOptions['rewrite']
    }
  );

  if (!result.success) {
    throw new Error(result.error || 'Rewrite failed');
  }

  console.log('[DocEdit] ✅ Step completed: rewrite_section');
  return result.intent;
}

// ==========================================
// Step 执行器：highlight_spans
// ==========================================

async function executeHighlightSpansStep(
  editor: LexicalEditor,
  step: HighlightSpansStep,
  contextIntent?: CanonicalIntent
): Promise<void> {
  const { sectionId } = step.target;
  const { target } = step.options;
  let terms = step.options.terms;
  let style = step.options.style;

  console.log('[DocEdit] Executing step: highlight_spans', { target, hasTerms: !!terms?.length, hasContext: !!contextIntent });

  // 1. 尝试从 Context Intent 中提取 terms
  if ((!terms || terms.length === 0) && contextIntent) {
    // 尝试从 mark_key_terms 任务中提取
    const markKeyTermsTask = contextIntent.tasks.find(t => t.type === 'mark_key_terms');
    if (markKeyTermsTask && markKeyTermsTask.params) {
      const params = markKeyTermsTask.params as any;
      if (params.terms && Array.isArray(params.terms)) {
        terms = params.terms;
        console.log('[DocEdit] Found terms from mark_key_terms task:', terms?.map((t: any) => t.phrase));
      }
      if (params.style) {
        style = params.style;
      }
    }
    
    // 如果没有 mark_key_terms，尝试 highlight_spans
    if (!terms || terms.length === 0) {
      const tasks = contextIntent.tasks.map(normalizeDocEditTask);
      const highlightTask = tasks.find(t => 
        t.type === 'highlight_spans' && 
        t.params.target === target
      ) as HighlightSpansIntentTask | undefined;
      
      if (highlightTask && highlightTask.params.terms) {
        terms = highlightTask.params.terms;
        style = highlightTask.params.style as any || style;
        console.log('[DocEdit] Found terms from highlight_spans task:', terms.map(t => t.phrase));
      }
    }
  }

  // 2. 如果还是没有 terms，调用 SectionAI highlight agent 获取
  if (!terms || terms.length === 0) {
    console.log('[DocEdit] No terms in context, calling SectionAI highlight agent...');
    
    try {
      const result = await runSectionAiAction(
        'highlight',
        sectionId,
        {
          editor,
          toast: mockToast as any,
          setAiProcessing: () => {},
        },
        {
          highlight: {
            mode: 'terms',
            termCount: 5,
            style: style as any,
          },
        }
      );
      
      if (result.success && result.intent) {
        // 从返回的 intent 中提取 terms
        const markKeyTermsTask = result.intent.tasks.find(t => t.type === 'mark_key_terms');
        if (markKeyTermsTask && markKeyTermsTask.params) {
          const params = markKeyTermsTask.params as any;
          if (params.terms && Array.isArray(params.terms)) {
            terms = params.terms;
            style = params.style || style;
            console.log('[DocEdit] Got terms from SectionAI:', terms?.map((t: any) => t.phrase));
          }
        }
      } else if (!result.success) {
        console.warn('[DocEdit] SectionAI highlight failed:', result.error);
      }
    } catch (error) {
      console.warn('[DocEdit] SectionAI highlight error (will try fallback):', error);
    }
  }

  // 3. 如果 SectionAI 也失败了，使用本地 fallback 提取器
  if (!terms || terms.length === 0) {
    console.log('[DocEdit] Using local fallback term extractor...');
    const sectionContext = extractSectionContext(editor, sectionId);
    if (sectionContext) {
      terms = extractFallbackTerms(sectionContext, 5);
      console.log('[DocEdit] Fallback extracted terms:', terms.map(t => t.phrase));
    }
  }

  // 4. 如果仍然没有 terms，安静地结束
  if (!terms || terms.length === 0) {
    console.log('[DocEdit] No terms found for highlight_spans, skipping (not an error)');
    return;
  }

  // 5. 执行 Primitive 应用高亮
  console.log('[DocEdit] Applying highlight to', terms.length, 'terms with style:', style);
  await executeHighlightSpansPrimitive(editor, {
    sectionId,
    target,
    style,
    terms,
  });
  
  console.log('[DocEdit] ✅ Step completed: highlight_spans');
}

/**
 * 本地 fallback 术语提取器
 * 
 * 当 SectionAI 失败时，使用简单的启发式规则提取关键词
 */
function extractFallbackTerms(
  context: SectionContext, 
  maxTerms: number = 5
): Array<{ phrase: string; occurrence?: number }> {
  const text = context.paragraphs.map(p => p.text).join(' ');
  
  // 简单的启发式：提取大写开头的多词短语（英文）或较长的词组
  const terms: Array<{ phrase: string; occurrence: number }> = [];
  
  // 英文：提取大写开头的词组
  const capitalizedPhrases = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || [];
  for (const phrase of capitalizedPhrases) {
    if (phrase.length >= 5 && phrase.length <= 50 && terms.length < maxTerms) {
      terms.push({ phrase, occurrence: 1 });
    }
  }
  
  // 如果不够，提取较长的单词（可能是术语）
  if (terms.length < maxTerms) {
    const words = text.split(/\s+/).filter(w => 
      w.length >= 6 && 
      /^[A-Za-z]+$/.test(w) &&
      !['should', 'would', 'could', 'their', 'there', 'which', 'about', 'through'].includes(w.toLowerCase())
    );
    
    // 去重并取前几个
    const uniqueWords = [...new Set(words)];
    for (const word of uniqueWords) {
      if (terms.length >= maxTerms) break;
      if (!terms.some(t => t.phrase.toLowerCase().includes(word.toLowerCase()))) {
        terms.push({ phrase: word, occurrence: 1 });
      }
    }
  }
  
  return terms.slice(0, maxTerms);
}

// ==========================================
// Step 执行器：mark_key_sentences (TODO: 迁移至 highlight_spans)
// ==========================================

async function executeMarkKeySentencesStep(
  editor: LexicalEditor,
  plan: DocEditPlan,
  step: MarkKeySentencesStep
): Promise<void> {
  const { sectionId } = step.target;
  const { highlightCount } = step.options;

  console.log('[DocEdit] Executing primitive: HighlightKeySentences', { sectionId, highlightCount });

  const sectionContext = extractSectionContext(editor, sectionId);
  if (!sectionContext) {
    throw new Error('Failed to extract section context');
  }

  const targets = pickKeySentenceTargets(sectionContext, highlightCount);
  
  if (targets.length === 0) {
    console.log('[DocEdit] No key sentences found to mark');
    return;
  }

  console.log('[DocEdit] Found', targets.length, 'key sentences to mark');

  await applyBoldToTargets(editor, targets);

  logAiKeySentencesMarked(plan.docId, sectionId, {
    sentenceCount: targets.length,
    sectionTitle: sectionContext.titleText,
  });
  
  console.log('[DocEdit] ✅ Step completed: mark_key_sentences');
}

function pickKeySentenceTargets(
  context: SectionContext,
  maxCount: number
): KeySentenceTarget[] {
  const targets: KeySentenceTarget[] = [];
  const paragraphs = context.ownParagraphs || context.paragraphs || [];

  for (const para of paragraphs) {
    if (targets.length >= maxCount) break;
    
    const text = para.text.trim();
    if (!text || text.length < 10) continue;

    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) continue;

    const firstSentence = sentences[0];
    if (firstSentence.length < 5) continue;

    const startOffset = text.indexOf(firstSentence);
    if (startOffset === -1) continue;

    targets.push({
      paragraphKey: para.nodeKey,
      sentenceText: firstSentence,
      startOffset,
      endOffset: startOffset + firstSentence.length,
    });
  }

  return targets;
}

function splitIntoSentences(text: string): string[] {
  const sentences = text.split(/(?<=[。！？.!?])\s*/);
  return sentences.filter(s => s.trim().length > 0);
}

/**
 * 应用加粗到目标句子
 * 
 * 【实现方式】
 * 通过 ToggleBold DocOps → DocumentRuntime.applyDocOps() → reconcileAstToLexical()
 * 
 * 这与 highlightSpans.ts 使用相同的 DocOps 写路径
 */
async function applyBoldToTargets(
  editor: LexicalEditor,
  targets: KeySentenceTarget[]
): Promise<void> {
  if (targets.length === 0) {
    console.log('[DocEdit] applyBoldToTargets: No targets to apply');
    return;
  }

  // 构建 ToggleBold DocOps
  const boldOps: DocOp[] = targets.map(t => ({
    type: 'ToggleBold' as const,
    payload: { 
      nodeId: t.paragraphKey, 
      startOffset: t.startOffset, 
      endOffset: t.endOffset, 
      force: true,
    },
    meta: createOpMeta('ai'),
  }));

  console.log('[DocEdit] applyBoldToTargets: Applying %d ToggleBold ops via DocumentRuntime', boldOps.length);

  try {
    const success = documentRuntime.applyDocOps(boldOps);
    
    if (success) {
      console.log('[DocEdit] applyBoldToTargets: ✅ DocOps applied successfully');
      
      // 同步 AST 到 Lexical 渲染
      const snapshot = documentRuntime.getSnapshot();
      reconcileAstToLexical(editor, snapshot.ast, {
        selection: snapshot.selection,
      });
      console.log('[DocEdit] applyBoldToTargets: ✅ Reconciled AST to Lexical');
    } else {
      console.warn('[DocEdit] applyBoldToTargets: ⚠️ DocumentRuntime.applyDocOps returned false');
      console.warn('[DocEdit] Targets:', targets.map(t => ({
        paragraphKey: t.paragraphKey,
        startOffset: t.startOffset,
        endOffset: t.endOffset,
      })));
    }
  } catch (error) {
    console.error('[DocEdit] applyBoldToTargets: Failed to apply DocOps:', error);
    throw error;
  }
}

// ==========================================
// Step 执行器：append_bullet_summary
// ==========================================

async function executeAppendBulletSummaryStep(
  _editor: LexicalEditor,
  _plan: DocEditPlan,
  step: AppendBulletSummaryStep
): Promise<void> {
  console.log('[DocEdit] Executing primitive: AppendSummary', step);
  // TODO: 实现摘要逻辑，这里先占位
  console.log('[DocEdit] ✅ Step completed: append_bullet_summary');
}

// ==========================================
// v3 Orchestrator: Macro 执行器
// ==========================================

/**
 * Macro 执行结果
 */
export interface MacroExecutionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  stepResults: Array<{
    kind: AtomicStepKind;
    success: boolean;
    durationMs?: number;
    error?: string;
    intent?: CanonicalIntent;
  }>;
  error?: string;
}

/**
 * Macro 执行上下文
 */
export interface MacroExecutionContext {
  editor: LexicalEditor;
  sectionId: string;
  toast?: {
    addToast: (message: string, type: 'success' | 'error' | 'info' | 'loading', duration?: number) => string;
    dismissToast: (id: string) => void;
  };
  setAiProcessing?: (processing: boolean) => void;
}

/**
 * 🆕 Orchestrator: 执行 SectionEditMacro
 * 
 * 按顺序展开 macro.steps，逐个执行原子步骤
 * 每个步骤独立调用对应的 SectionAI agent
 * 
 * @param commandKey - Copilot 命令 key（如 'rewrite_section_with_highlight'）
 * @param ctx - 执行上下文
 * @returns MacroExecutionResult
 * 
 * @example
 * ```ts
 * // 命令 A：只改写
 * await runMacroForCommand('rewrite_section_intro', { editor, sectionId: '1624' });
 * // log: [DocEdit] Running rewrite_section for section: 1624
 * 
 * // 命令 B：改写并标重点
 * await runMacroForCommand('rewrite_section_with_highlight', { editor, sectionId: '1624' });
 * // log: [DocEdit] Running rewrite_section for section: 1624
 * // log: [DocEdit] Running highlight_section for section: 1624
 * ```
 */
export async function runMacroForCommand(
  commandKey: string,
  ctx: MacroExecutionContext
): Promise<MacroExecutionResult> {
  const macro = getMacroForCommand(commandKey);
  
  if (!macro) {
    console.error('[DocEdit] No macro found for command:', commandKey);
    return {
      success: false,
      completedSteps: 0,
      totalSteps: 0,
      stepResults: [],
      error: `No macro found for command: ${commandKey}`,
    };
  }
  
  console.log('[DocEdit] ========== Macro Execution Start ==========');
  console.log('[DocEdit] Command:', commandKey);
  console.log('[DocEdit] Macro:', describeMacro(macro));
  console.log('[DocEdit] Section:', ctx.sectionId);
  console.log('[DocEdit] Steps:', macro.steps.map(s => s.kind).join(' → '));
  
  const stepResults: MacroExecutionResult['stepResults'] = [];
  let latestIntent: CanonicalIntent | undefined;
  
  // 按顺序执行每个原子步骤
  for (let i = 0; i < macro.steps.length; i++) {
    const step = macro.steps[i];
    const startTime = Date.now();
    
    console.log(`[DocEdit] -------- Step ${i + 1}/${macro.steps.length}: ${step.kind} --------`);
    console.log(`[DocEdit] Running ${step.kind} for section: ${ctx.sectionId}`);
    
    try {
      const result = await executeAtomicStep(step, ctx, latestIntent);
      
      stepResults.push({
        kind: step.kind,
        success: result.success,
        durationMs: Date.now() - startTime,
        intent: result.intent,
      });
      
      if (!result.success) {
        console.error(`[DocEdit] ❌ Step ${step.kind} failed:`, result.error);
        return {
          success: false,
          completedSteps: i,
          totalSteps: macro.steps.length,
          stepResults,
          error: result.error,
        };
      }
      
      // 保存 intent 供后续步骤使用（如 highlight 需要 rewrite 的结果）
      if (result.intent) {
        latestIntent = result.intent;
      }
      
      console.log(`[DocEdit] ✅ Step ${step.kind} completed in ${Date.now() - startTime}ms`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DocEdit] ❌ Step ${step.kind} threw exception:`, error);
      
      stepResults.push({
        kind: step.kind,
        success: false,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      });
      
      return {
        success: false,
        completedSteps: i,
        totalSteps: macro.steps.length,
        stepResults,
        error: errorMessage,
      };
    }
  }
  
  console.log('[DocEdit] ========== Macro Execution Complete ==========');
  console.log('[DocEdit] All', macro.steps.length, 'steps completed successfully');
  
  return {
    success: true,
    completedSteps: macro.steps.length,
    totalSteps: macro.steps.length,
    stepResults,
  };
}

/**
 * 执行单个原子步骤
 * 
 * @param step - 原子步骤定义
 * @param ctx - 执行上下文
 * @param contextIntent - 前置步骤的 Intent（用于传递上下文）
 */
async function executeAtomicStep(
  step: AtomicStep,
  ctx: MacroExecutionContext,
  _contextIntent?: CanonicalIntent
): Promise<SectionAiResult> {
  const { editor, sectionId, toast, setAiProcessing } = ctx;
  
  // 构建 SectionAI 调用上下文
  const aiContext = {
    editor,
    toast: toast || mockToast as any,
    setAiProcessing,
  };
  
  // 根据 step.kind 映射到 SectionAI action
  switch (step.kind) {
    case 'rewrite_section':
      console.log('[DocEdit] Executing atomic step: rewrite_section');
      return runSectionAiAction('rewrite', sectionId, aiContext, {
        rewrite: {
          tone: step.params?.tone,
          scope: step.params?.scope,
        },
      });
      
    case 'highlight_section':
      console.log('[DocEdit] Executing atomic step: highlight_section (independent of rewrite)');
      // 🆕 highlight_section 完全独立于 rewrite
      // 调用 SectionAI 的 highlight agent（intent-only）
      return runSectionAiAction('highlight', sectionId, aiContext, {
        highlight: {
          mode: step.params?.mode || 'terms',
          termCount: step.params?.termCount || 5,
          style: step.params?.style || 'bold',
        },
      });
      
    case 'summarize_section':
      console.log('[DocEdit] Executing atomic step: summarize_section');
      return runSectionAiAction('summarize', sectionId, aiContext, {
        summarize: {
          // bulletCount 通过 customPrompt 传递，因为 SummarizeSectionOptions 没有这个字段
          customPrompt: step.params?.bulletCount 
            ? `生成 ${step.params.bulletCount} 条要点摘要`
            : undefined,
        },
      });
      
    case 'expand_section':
      console.log('[DocEdit] Executing atomic step: expand_section');
      return runSectionAiAction('expand', sectionId, aiContext, {
        expand: {
          length: step.params?.length || 'medium',
        },
      });
      
    default:
      console.error('[DocEdit] Unknown atomic step kind:', (step as any).kind);
      return {
        success: false,
        error: `Unknown atomic step kind: ${(step as any).kind}`,
      };
  }
}

/**
 * 检查命令是否支持 Macro 执行
 */
export function isMacroCommand(commandKey: string): boolean {
  return !!getMacroForCommand(commandKey);
}
