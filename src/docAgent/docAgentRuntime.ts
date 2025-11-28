/**
 * DocAgent Runtime - DocEditPlan 执行器
 * 
 * 【职责】
 * - 执行 DocEditPlan，将 plan.steps 映射到 DocOps 流程
 * - 协调 LLM 调用和文档修改
 * - 提供可追踪的执行机制
 * 
 * 【v2 重构】
 * - 支持 'section_edit' 类型的 Intent（根据开关组合 Steps）
 * - 向后兼容旧版 kind（如 'rewrite_section_with_highlight_and_summary'）
 * 
 * 【当前版本】
 * - `rewrite_section` 使用 LLM 改写
 * - `mark_key_sentences` 使用简单规则（前 N 个句子），非语义关键句
 * - `append_bullet_summary` 使用 LLM 生成短句
 * 
 * 【后续迭代】
 * - 使用 LLM tool calling 选出真正关键句
 * - 将 Plan 执行过程对接 Copilot 的 Action log / Undo 体系
 * - 扩展到 multi-section Plan
 */

import { 
  LexicalEditor, 
  $getNodeByKey, 
  $createParagraphNode, 
  $createTextNode,
  $isElementNode,
  $isTextNode,
} from 'lexical';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { 
  DocEditPlan,
  DocEditIntent,
  RewriteSectionStep,
  MarkKeySentencesStep,
  AppendBulletSummaryStep,
} from './docEditTypes';
import { getCopilotEditor } from '../copilot/copilotRuntimeBridge';
import { extractSectionContext } from '../runtime/context';
import type { SectionContext } from '../runtime/context';
import { 
  runSectionAiAction, 
  SectionAiContext,
} from '../actions/sectionAiActions';
import { logAiKeySentencesMarked } from '../interaction';

// ==========================================
// 执行结果类型
// ==========================================

/**
 * Plan 执行结果
 */
export interface DocEditPlanResult {
  /** 是否成功 */
  success: boolean;
  /** 已完成的步骤数 */
  completedSteps: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 错误信息（如果失败） */
  error?: string;
  /** 各步骤的执行结果 */
  stepResults?: StepResult[];
}

/**
 * 单步执行结果
 */
export interface StepResult {
  /** 步骤类型 */
  type: string;
  /** 是否成功 */
  success: boolean;
  /** 耗时（毫秒） */
  durationMs?: number;
  /** 错误信息 */
  error?: string;
}

// ==========================================
// 辅助类型
// ==========================================

/**
 * 关键句目标
 */
interface KeySentenceTarget {
  paragraphKey: string;
  sentenceText: string;
  startOffset: number;
  endOffset: number;
}

// ==========================================
// 常量
// ==========================================

// 简单的 Toast 回调（用于 runSectionAiAction）
const mockToast = {
  addToast: (msg: string, type: string) => {
    console.log(`[DocEdit Toast] ${type}: ${msg}`);
    return 'mock-id';
  },
  dismissToast: () => {},
};

// ==========================================
// 核心执行函数
// ==========================================

/**
 * 执行 DocEditPlan
 * 
 * @param plan - 要执行的 DocEditPlan
 * @returns Promise<DocEditPlanResult> - 执行结果
 */
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

  // v2: 支持 section_edit 和旧版兼容的 kind
  const supportedKinds = [
    'section_edit', // v2 新版
    'rewrite_section_with_highlight_and_summary', // v1 旧版（向后兼容）
    'rewrite_section_plain',
    'summarize_section_plain',
  ];
  
  if (!supportedKinds.includes(plan.intentKind)) {
    return {
      success: false,
      completedSteps: 0,
      totalSteps: plan.steps.length,
      error: `Unsupported intentKind: ${plan.intentKind}`,
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
  let completedSteps = 0;

  // 按顺序执行每个步骤
  for (const step of plan.steps) {
    const startTime = Date.now();
    
    try {
      console.log(`[DocEdit] Executing step: ${step.type}`);
      
      switch (step.type) {
        case 'rewrite_section':
          await executeRewriteSectionStep(editor, plan, step);
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
      completedSteps++;
      
      const duration = Date.now() - startTime;
      console.log(`[DocEdit] ✅ Step completed: ${step.type} (${duration}ms)`);
      console.log(`[DocEdit] Progress: ${completedSteps}/${plan.steps.length} steps completed`);

    } catch (error) {
      console.error(`[DocEdit] Step failed: ${step.type}`, error);
      
      stepResults.push({
        type: step.type,
        success: false,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      // 当前 MVP：遇到错误时中断
      return {
        success: false,
        completedSteps,
        totalSteps: plan.steps.length,
        error: `Step ${step.type} failed: ${error instanceof Error ? error.message : String(error)}`,
        stepResults,
      };
    }
  }

  console.log('[DocEdit] Plan execution completed successfully');

  return {
    success: true,
    completedSteps,
    totalSteps: plan.steps.length,
    stepResults,
  };
}

// ==========================================
// Step 执行器：rewrite_section
// ==========================================

/**
 * 执行改写步骤 - 复用现有的 Section AI 能力
 */
async function executeRewriteSectionStep(
  editor: LexicalEditor,
  _plan: DocEditPlan,
  step: RewriteSectionStep
): Promise<void> {
  const { sectionId } = step.target;
  const { tone, length, keepStructure } = step.options;

  console.log('[DocEdit] Rewriting section:', {
    sectionId,
    tone,
    length,
    keepStructure,
  });

  // 构建 Section AI 上下文
  const context: SectionAiContext = {
    editor,
    toast: mockToast,
  };

  // 调用现有的 Section AI 改写能力
  // 对于复杂意图，改写整个 section（chapter），而不是只改导语（intro）
  const result = await runSectionAiAction('rewrite', sectionId, context, {
    rewrite: {
      tone: tone as any, // 类型兼容
      scope: 'chapter', // 改写整个 section（使用 chapter scope）
      // keepStructure 通过 prompt 提示，当前版本不需要额外处理
    },
  });

  if (!result.success) {
    throw new Error(result.error || 'Rewrite section failed');
  }
}

// ==========================================
// Step 执行器：mark_key_sentences
// ==========================================

/**
 * 执行关键句标记步骤 - 简单规则版 MVP
 * 
 * 策略：从前往后遍历段落，取前 N 个非空段落的第一句，加粗
 */
async function executeMarkKeySentencesStep(
  editor: LexicalEditor,
  plan: DocEditPlan,
  step: MarkKeySentencesStep
): Promise<void> {
  const { sectionId } = step.target;
  const { highlightCount } = step.options;

  console.log('[DocEdit] Marking key sentences:', { sectionId, highlightCount });

  // 1. 获取 Section 上下文
  const sectionContext = extractSectionContext(editor, sectionId);
  if (!sectionContext) {
    throw new Error('Failed to extract section context');
  }

  // 2. 找到候选句子
  const targets = pickKeySentenceTargets(sectionContext, highlightCount);
  
  if (targets.length === 0) {
    console.log('[DocEdit] No key sentences found to mark');
    return;
  }

  console.log('[DocEdit] Found', targets.length, 'key sentences to mark');

  // 3. 应用加粗格式
  await applyBoldToTargets(editor, targets);

  // 4. 🆕 记录事件到 InteractionLog（用于 BehaviorSummary v2）
  logAiKeySentencesMarked(plan.docId, sectionId, {
    sentenceCount: targets.length,
    sectionTitle: sectionContext.titleText,
  });
}

/**
 * 从 Section 中选取关键句目标
 * 
 * 简单策略：每个段落的第一句
 */
function pickKeySentenceTargets(
  context: SectionContext,
  maxCount: number
): KeySentenceTarget[] {
  const targets: KeySentenceTarget[] = [];
  const paragraphs = context.ownParagraphs || context.paragraphs || [];

  for (const para of paragraphs) {
    if (targets.length >= maxCount) break;
    
    const text = para.text.trim();
    if (!text || text.length < 10) continue; // 跳过太短的段落

    // 简单的句子分割
    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) continue;

    const firstSentence = sentences[0];
    if (firstSentence.length < 5) continue; // 跳过太短的句子

    // 找到句子在原文中的位置
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

/**
 * 将文本分割成句子
 */
function splitIntoSentences(text: string): string[] {
  // 按中英文句号、问号、感叹号分割
  const sentences = text.split(/(?<=[。！？.!?])\s*/);
  return sentences.filter(s => s.trim().length > 0);
}

/**
 * 对目标句子应用加粗格式
 */
async function applyBoldToTargets(
  editor: LexicalEditor,
  targets: KeySentenceTarget[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    editor.update(
      () => {
        try {
          for (const target of targets) {
            const paragraphNode = $getNodeByKey(target.paragraphKey);
            if (!paragraphNode || !$isElementNode(paragraphNode)) {
              console.warn('[DocEdit] Paragraph not found:', target.paragraphKey);
              continue;
            }

            // 遍历段落的子节点，找到包含目标句子的 TextNode
            const children = paragraphNode.getChildren();
            let currentOffset = 0;

            for (const child of children) {
              if (!$isTextNode(child)) continue;

              const textContent = child.getTextContent();
              const nodeStart = currentOffset;
              const nodeEnd = currentOffset + textContent.length;

              // 检查是否与目标范围重叠
              if (nodeEnd > target.startOffset && nodeStart < target.endOffset) {
                // 计算在当前节点内的范围
                const localStart = Math.max(0, target.startOffset - nodeStart);
                const localEnd = Math.min(textContent.length, target.endOffset - nodeStart);

                // 如果整个节点都在范围内，直接设置格式
                if (localStart === 0 && localEnd === textContent.length) {
                  child.setFormat(child.getFormat() | 1); // 1 = bold
                } else {
                  // 需要分割节点
                  // 简化处理：如果部分重叠，就给整个节点加粗
                  child.setFormat(child.getFormat() | 1);
                }
              }

              currentOffset = nodeEnd;
            }
          }

          resolve();
        } catch (error) {
          reject(error);
        }
      },
      { discrete: true }
    );
  });
}

// ==========================================
// Step 执行器：append_bullet_summary
// ==========================================

/**
 * 执行追加 Bullet 摘要步骤
 */
async function executeAppendBulletSummaryStep(
  editor: LexicalEditor,
  _plan: DocEditPlan,
  step: AppendBulletSummaryStep
): Promise<void> {
  const { sectionId } = step.target;
  const { bulletCount } = step.options;

  console.log('[DocEdit] Appending bullet summary:', { sectionId, bulletCount });

  // 1. 获取 Section 上下文
  const sectionContext = extractSectionContext(editor, sectionId);
  if (!sectionContext) {
    throw new Error('Failed to extract section context');
  }

  // 2. 构建 Section 纯文本
  const plainText = buildPlainTextFromSection(sectionContext);
  if (!plainText || plainText.length < 50) {
    console.log('[DocEdit] Section too short for summary');
    return;
  }

  // 3. 调用 LLM 生成 bullet 摘要
  const bullets = await generateSectionSummaryBullets(plainText, bulletCount);
  if (!bullets || bullets.length === 0) {
    console.log('[DocEdit] No bullets generated');
    return;
  }

  console.log('[DocEdit] Generated', bullets.length, 'bullets');

  // 4. 追加 bullet list 到 section 末尾
  await appendBulletListToSection(editor, sectionContext, bullets);
}

/**
 * 从 Section 构建纯文本
 */
function buildPlainTextFromSection(context: SectionContext): string {
  const paragraphs = context.subtreeParagraphs || context.ownParagraphs || context.paragraphs || [];
  return paragraphs.map(p => p.text).join('\n\n');
}

/**
 * 调用 LLM 生成 bullet 摘要
 */
async function generateSectionSummaryBullets(
  text: string,
  bulletCount: number
): Promise<string[]> {
  const systemPrompt = `你是一个文档摘要助手。根据给定的文本，生成简洁的要点摘要。

要求：
- 生成恰好 ${bulletCount} 条要点
- 每条要点一句话，不超过 30 个字
- 只输出 JSON 数组，不要其他内容
- 格式：["要点1", "要点2", "要点3"]`;

  const userPrompt = `请为以下内容生成 ${bulletCount} 条要点摘要：

${text.slice(0, 2000)}`;

  try {
    const response = await window.aiDoc?.chat?.({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    if (!response?.success || !response.content) {
      console.error('[DocEdit] LLM call failed:', response?.error);
      return [];
    }

    // 解析 JSON
    const content = response.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[DocEdit] Failed to parse bullets JSON:', content);
      return [];
    }

    const bullets = JSON.parse(jsonMatch[0]) as string[];
    return bullets.filter(b => typeof b === 'string' && b.length > 0);

  } catch (error) {
    console.error('[DocEdit] Generate bullets error:', error);
    return [];
  }
}

/**
 * 追加 bullet list 到 section 末尾
 */
async function appendBulletListToSection(
  editor: LexicalEditor,
  context: SectionContext,
  bullets: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    editor.update(
      () => {
        try {
          // 找到 section 的最后一个段落
          const paragraphs = context.subtreeParagraphs || context.ownParagraphs || context.paragraphs || [];
          if (paragraphs.length === 0) {
            console.warn('[DocEdit] No paragraphs in section');
            resolve();
            return;
          }

          const lastPara = paragraphs[paragraphs.length - 1];
          const lastNode = $getNodeByKey(lastPara.nodeKey);
          
          if (!lastNode) {
            console.warn('[DocEdit] Last paragraph node not found');
            resolve();
            return;
          }

          // 创建分隔段落（可选：添加一个空行或小标题）
          const separatorPara = $createParagraphNode();
          separatorPara.append($createTextNode(''));
          lastNode.insertAfter(separatorPara);

          // 创建小标题
          const summaryTitle = $createParagraphNode();
          const titleText = $createTextNode('📌 要点总结');
          titleText.setFormat(1); // bold
          summaryTitle.append(titleText);
          separatorPara.insertAfter(summaryTitle);

          // 创建 bullet list
          const listNode = $createListNode('bullet');
          
          for (const bullet of bullets) {
            const listItem = $createListItemNode();
            listItem.append($createTextNode('• ' + bullet));
            listNode.append(listItem);
          }

          summaryTitle.insertAfter(listNode);

          console.log('[DocEdit] Bullet list appended successfully');
          resolve();
        } catch (error) {
          console.error('[DocEdit] Failed to append bullet list:', error);
          reject(error);
        }
      },
      { discrete: true }
    );
  });
}

// ==========================================
// 验证函数
// ==========================================

/**
 * 验证 Plan 是否可执行
 */
export function validatePlanForExecution(plan: DocEditPlan): { valid: boolean; error?: string } {
  if (!plan.docId) {
    return { valid: false, error: 'Plan missing docId' };
  }
  if (!plan.sectionId) {
    return { valid: false, error: 'Plan missing sectionId' };
  }
  if (!plan.steps || plan.steps.length === 0) {
    return { valid: false, error: 'Plan has no steps' };
  }
  return { valid: true };
}

// ==========================================
// 测试辅助函数
// ==========================================

/**
 * 创建测试用的复杂意图并执行
 * 
 * 用于验证端到端流程
 * 
 * @example
 * ```ts
 * // 在控制台或调试按钮中调用
 * import { testComplexIntentExecution } from './docAgent';
 * await testComplexIntentExecution('doc-123', 'section-abc');
 * ```
 */
export async function testComplexIntentExecution(
  docId: string,
  sectionId: string
): Promise<DocEditPlanResult> {
  // 延迟导入避免循环依赖
  const { buildDocEditPlanForIntent } = await import('./docEditPlanner');
  const { extractSectionContext: getContext } = await import('../runtime/context');
  
  const editor = getCopilotEditor();
  if (!editor) {
    return {
      success: false,
      completedSteps: 0,
      totalSteps: 0,
      error: 'Editor not available',
    };
  }

  // 获取 SectionContext
  const sectionContext = getContext(editor, sectionId);
  if (!sectionContext) {
    return {
      success: false,
      completedSteps: 0,
      totalSteps: 0,
      error: 'Section not found',
    };
  }

  // 构造测试 Intent（v2 格式：使用子对象开关）
  const intent: DocEditIntent = {
    kind: 'section_edit',
    target: { docId, sectionId },
    rewrite: {
      enabled: true,
      tone: 'formal',
      length: 'same',
      keepStructure: true,
    },
    highlight: {
      enabled: true,
      highlightCount: 2,
    },
    summary: {
      enabled: true,
      bulletCount: 3,
    },
  };

  console.log('[DocEdit Test] Building plan for intent (v2 format):', {
    kind: intent.kind,
    rewrite: intent.rewrite?.enabled,
    highlight: intent.highlight?.enabled,
    summary: intent.summary?.enabled,
  });

  // 构建 Plan
  const plan = buildDocEditPlanForIntent(intent, sectionContext);
  console.log('[DocEdit Test] Generated plan:', {
    intentId: plan.intentId,
    intentKind: plan.intentKind,
    steps: plan.steps.map(s => s.type),
    features: plan.meta?.enabledFeatures,
  });

  // 执行 Plan
  return runDocEditPlan(plan);
}
