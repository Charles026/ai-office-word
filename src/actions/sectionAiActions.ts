/**
 * Section AI Actions - 统一的 Section 级 AI 操作入口 (v2)
 * 
 * 【职责】
 * - 提供 UI 层调用 Section AI 的统一入口
 * - 管理 Loading 状态
 * - 处理错误和 Toast 提示
 * 
 * 【设计原则】
 * - UI 层不允许直接调用 Runtime 或 DocOps
 * - 所有 Section AI 操作必须通过此模块
 * - 统一的 Loading 和错误处理
 * 
 * 【调用链路】
 * UI → runSectionAiAction → extractSectionContext → IntentBuilder 
 *    → buildSectionPrompt → DocAgentRuntime.run → DocOps Diff → applyDocOps
 * 
 * 【v2 新增：处事原则与不确定性协议】
 * - 支持 responseMode: auto_apply / preview / clarify
 * - 返回 confidence / uncertainties 供 UI 呈现
 * - clarify 模式支持澄清问题和用户选择
 */

import { 
  LexicalEditor, 
  $getNodeByKey, 
  $createParagraphNode, 
  $createTextNode,
  $isElementNode,
  $isTextNode
} from 'lexical';
import { extractSectionContext, getParagraphsForScope } from '../runtime/context';
import type { SectionContext, ParagraphInfo } from '../runtime/context';
import {
  buildRewriteSectionIntent,
  buildSummarizeSectionIntent,
  buildExpandSectionIntent,
  assignIntentId,
} from '../runtime/intents';
import type {
  RewriteSectionOptions,
  SummarizeSectionOptions,
  ExpandSectionOptions,
  SectionScope,
} from '../runtime/intents';
import { buildSectionPrompt } from '../runtime/prompts';
import type { LlmParagraphOutput } from '../runtime/prompts/sectionPromptTypes';
import {
  buildSectionDocOpsDiff,
  getDiffModeFromIntent,
} from '../docops/sectionDocOpsDiff';
import type { SectionDocOp, ReplaceParagraphOp, InsertParagraphAfterOp } from '../docops/sectionDocOpsDiff';
import {
  repairRewriteSectionParagraphsWithDetails,
} from '../docops/rewriteSectionRepair';
import {
  logAiRewriteApplied,
  logAiSummaryApplied,
  logAiIntentGenerated,
} from '../interaction';
import { copilotStore } from '../copilot/copilotStore';
import { copilotDebugStore } from '../copilot/copilotDebugStore';
import { generateDebugId } from '../copilot/copilotDebugTypes';
import type { CopilotDebugSnapshot, DebugMessage } from '../copilot/copilotDebugTypes';
import { parseCanonicalIntent, IntentParseError } from '../ai/intent/intentSchema';
import type {
  CanonicalIntent,
  CopilotResponseMode,
  IntentUncertainty,
} from '../ai/intent/intentTypes';
import { parseDocOpsPlan, validateDocOpsPlan } from '../ai/docops/docOpsSchema';
import type { DocOpsPlan } from '../ai/docops/docOpsTypes';

// ==========================================
// 类型定义
// ==========================================

/**
 * Section AI 操作类型
 */
export type SectionAiAction = 'rewrite' | 'summarize' | 'expand';

/**
 * Section AI 操作选项
 */
export interface SectionAiOptions {
  /** 重写选项 */
  rewrite?: RewriteSectionOptions;
  /** 总结选项 */
  summarize?: SummarizeSectionOptions;
  /** 扩写选项 */
  expand?: ExpandSectionOptions;
}

/**
 * Toast 回调类型
 */
export interface ToastCallbacks {
  addToast: (message: string, type: 'success' | 'error' | 'info' | 'loading', duration?: number) => string;
  dismissToast: (id: string) => void;
}

/**
 * Section AI 执行上下文
 */
export interface SectionAiContext {
  /** Lexical 编辑器实例 */
  editor: LexicalEditor;
  /** Toast 回调 */
  toast: ToastCallbacks;
  /** 设置 AI 处理状态 */
  setAiProcessing?: (processing: boolean) => void;
}

/**
 * Section AI 执行结果 (v2)
 * 
 * 新增：responseMode / confidence / uncertainties 字段
 */
export interface SectionAiResult {
  success: boolean;
  docOps?: SectionDocOp[];
  intent?: CanonicalIntent;
  docOpsPlan?: DocOpsPlan;
  assistantText?: string;
  error?: string;
  /**
   * Copilot 建议的响应模式
   * - auto_apply: 已直接应用修改
   * - preview: 需要 UI 展示预览供用户确认
   * - clarify: 需要 UI 展示澄清问题
   */
  responseMode?: CopilotResponseMode;
  /**
   * LLM 对意图理解的信心度 (0~1)
   */
  confidence?: number;
  /**
   * LLM 认为不确定的部分（用于 clarify 模式）
   */
  uncertainties?: IntentUncertainty[];
  /**
   * 是否已应用修改（仅在 auto_apply 模式下为 true）
   */
  applied?: boolean;
}

// ==========================================
// 全局状态
// ==========================================

let _isAiProcessing = false;
let _processingListeners: Array<(processing: boolean) => void> = [];

/**
 * 获取 AI 处理状态
 */
export function isAiProcessing(): boolean {
  return _isAiProcessing;
}

/**
 * 订阅 AI 处理状态变化
 */
export function subscribeAiProcessing(listener: (processing: boolean) => void): () => void {
  _processingListeners.push(listener);
  return () => {
    _processingListeners = _processingListeners.filter(l => l !== listener);
  };
}

/**
 * 设置 AI 处理状态
 */
function setAiProcessing(processing: boolean): void {
  _isAiProcessing = processing;
  _processingListeners.forEach(l => l(processing));
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 获取操作的中文名称
 */
function getActionLabel(action: SectionAiAction): string {
  const labels: Record<SectionAiAction, string> = {
    rewrite: '重写',
    summarize: '总结',
    expand: '扩写',
  };
  return labels[action];
}

/**
 * 获取成功消息
 */
function getSuccessMessage(action: SectionAiAction): string {
  const messages: Record<SectionAiAction, string> = {
    rewrite: '章节已重写',
    summarize: '章节已总结',
    expand: '章节已扩写',
  };
  return messages[action];
}

/**
 * 调用 LLM 服务
 */
async function callLlm(
  systemPrompt: string,
  userPrompt: string
): Promise<{ success: boolean; text?: string; error?: string }> {
  // 通过 IPC 调用主进程的 LLM 服务
  if (typeof window !== 'undefined' && window.aiDoc) {
    try {
      // 使用 chat API
      const response = await window.aiDoc.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      
      // chat API 返回 content 字段，转换为 text
      return {
        success: response.success,
        text: response.content,
        error: response.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '调用 LLM 失败',
      };
    }
  }
  
  return {
    success: false,
    error: 'LLM 服务不可用',
  };
}

/**
 * LLM 解析错误
 */
class LlmParseError extends Error {
  constructor(
    message: string,
    public readonly rawSnippet: string,
    public readonly parseDetails?: string
  ) {
    super(message);
    this.name = 'LlmParseError';
  }
}

interface ParsedSectionAiProtocol {
  assistantText: string;
  intent: CanonicalIntent;
  docOpsPlan: DocOpsPlan;
  paragraphs: LlmParagraphOutput[];
}

function extractParagraphsFromPlan(plan: DocOpsPlan): LlmParagraphOutput[] {
  for (const op of plan.ops) {
    if (op.type === 'replace_range') {
      const payload = op.payload as { paragraphs?: Array<{ index: number; text: string }> };
      if (!payload?.paragraphs) continue;
      const paragraphs: LlmParagraphOutput[] = [];
      for (const para of payload.paragraphs) {
        if (typeof para.index === 'number' && typeof para.text === 'string') {
          paragraphs.push({ index: para.index, text: para.text });
        }
      }
      if (paragraphs.length > 0) {
        return paragraphs;
      }
    }
  }
  return [];
}

/**
 * 去除 JSON 字符串中的 Markdown 代码块包装
 * 
 * 例如：
 * ```json
 * { "foo": "bar" }
 * ```
 * 会被转换为：
 * { "foo": "bar" }
 */
function stripMarkdownCodeBlock(text: string): string {
  let result = text.trim();
  
  // 去除开头的 ```json 或 ``` 标记
  result = result.replace(/^```(?:json|JSON)?\s*\n?/m, '');
  
  // 去除结尾的 ``` 标记
  result = result.replace(/\n?```\s*$/m, '');
  
  return result.trim();
}

function parseStructuredLlmResponse(text: string): ParsedSectionAiProtocol {
  const rawSnippet = text.slice(0, 400);
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const intentMarker = '[intent]';
  const docopsMarker = '[docops]';

  const intentIndex = lower.indexOf(intentMarker);
  const docopsIndex = lower.indexOf(docopsMarker);

  if (intentIndex === -1 || docopsIndex === -1 || docopsIndex <= intentIndex) {
    throw new LlmParseError(
      'AI 返回缺少 [intent] 或 [docops] 模块',
      rawSnippet,
      'Expected blocks: [assistant] [intent] [docops]'
    );
  }

  const assistantSegment = trimmed
    .slice(0, intentIndex)
    .replace(/^\s*\[assistant\]\s*/i, '')
    .trim();
  
  // 🆕 去除可能的 Markdown 代码块包装
  const intentSegment = stripMarkdownCodeBlock(
    trimmed.slice(intentIndex + intentMarker.length, docopsIndex)
  );
  const docopsSegment = stripMarkdownCodeBlock(
    trimmed.slice(docopsIndex + docopsMarker.length)
  );

  if (!intentSegment) {
    throw new LlmParseError('AI 返回的 [intent] 内容为空', rawSnippet);
  }
  if (!docopsSegment) {
    throw new LlmParseError('AI 返回的 [docops] 内容为空', rawSnippet);
  }

  let canonicalIntent: CanonicalIntent;
  try {
    const intentJson = JSON.parse(intentSegment);
    canonicalIntent = parseCanonicalIntent(intentJson);
  } catch (error) {
    // 🆕 增强错误信息，显示原始内容片段和 Zod 错误详情
    const errorDetail = error instanceof Error ? error.message : String(error);
    const errorCause = error instanceof IntentParseError ? error.cause : undefined;
    
    console.error('[SectionAI] Intent parse error:', {
      errorDetail,
      errorCause: JSON.stringify(errorCause, null, 2),
      intentSegmentPreview: intentSegment.slice(0, 300),
    });
    throw new LlmParseError(
      '解析 CanonicalIntent 失败',
      intentSegment.slice(0, 200),
      `${errorDetail} ${errorCause ? JSON.stringify(errorCause) : ''}`
    );
  }

  let docOpsPlan: DocOpsPlan;
  try {
    const planJson = JSON.parse(docopsSegment);
    docOpsPlan = parseDocOpsPlan(planJson);
  } catch (error) {
    // 🆕 增强错误信息
    const errorDetail = error instanceof Error ? error.message : String(error);
    console.error('[SectionAI] DocOps parse error:', {
      errorDetail,
      docopsSegmentPreview: docopsSegment.slice(0, 300),
    });
    throw new LlmParseError(
      '解析 DocOpsPlan 失败',
      docopsSegment.slice(0, 200),
      errorDetail
    );
  }

  const validation = validateDocOpsPlan(docOpsPlan);
  if (!validation.valid) {
    throw new LlmParseError(
      'DocOpsPlan 结构校验失败',
      docopsSegment.slice(0, 200),
      validation.errors.join('; ')
    );
  }

  if (docOpsPlan.intentId && canonicalIntent.intentId && docOpsPlan.intentId !== canonicalIntent.intentId) {
    throw new LlmParseError(
      'DocOpsPlan.intentId 与 CanonicalIntent.intentId 不一致',
      docopsSegment.slice(0, 200),
      `intentId mismatch: ${docOpsPlan.intentId} !== ${canonicalIntent.intentId}`
    );
  }

  const paragraphs = extractParagraphsFromPlan(docOpsPlan);
  if (paragraphs.length === 0) {
    throw new LlmParseError(
      'DocOpsPlan 缺少可用的 paragraphs 数据',
      docopsSegment.slice(0, 200),
      'replace_range.payload.paragraphs 数组不能为空'
    );
  }

  return {
    assistantText: assistantSegment,
    intent: canonicalIntent,
    docOpsPlan,
    paragraphs,
  };
}

/**
 * 应用 DocOps 到编辑器
 */
export async function applyDocOps(
  editor: LexicalEditor,
  docOps: SectionDocOp[]
): Promise<void> {
  // TODO(docops-boundary):
  // - 这里直接操作 Lexical 节点，绕过了 DocumentEngine 和 CommandBus
  // - 目标：将 DocOps 转换为标准 DocumentEngine 调用，或通过 CommandBus 执行
  // - 目前仅标记，保留 Lexical 操作以维持 UI 功能

  // 使用 Lexical 的 update 方法应用修改
  return new Promise((resolve, reject) => {
    editor.update(
      () => {
        try {
          console.log('[SectionAI] Applying DocOps:', docOps.length);
          
          for (const op of docOps) {
            console.log('[SectionAI] DocOp:', op.type, op);
            
            if (op.type === 'replace_paragraph') {
              const replaceOp = op as ReplaceParagraphOp;
              // 替换段落
              const node = $getNodeByKey(replaceOp.targetKey);
              if (node && $isElementNode(node)) {
                // 尝试获取第一个文本节点的样式，以便继承
                let format = 0;
                let style = '';
                const firstChild = node.getFirstChild();
                if ($isTextNode(firstChild)) {
                  format = firstChild.getFormat();
                  style = firstChild.getStyle();
                }

                // 清空原有内容
                node.clear();
                
                // 插入新文本并应用样式
                const newTextNode = $createTextNode(op.newText);
                if (format) newTextNode.setFormat(format);
                if (style) newTextNode.setStyle(style);
                
                node.append(newTextNode);
              } else {
                console.warn('[SectionAI] Replace target not found or invalid:', replaceOp.targetKey);
              }
            } else if (op.type === 'insert_paragraph_after') {
              const insertOp = op as InsertParagraphAfterOp;
              // 在目标后插入新段落
              const targetNode = $getNodeByKey(insertOp.referenceKey);
              if (targetNode) {
                const newParagraph = $createParagraphNode();
                
                // 尝试继承目标段落的样式
                // TODO: 检查是否应该继承
                
                newParagraph.append($createTextNode(insertOp.newText));
                targetNode.insertAfter(newParagraph);
              } else {
                console.warn('[SectionAI] Insert target not found:', insertOp.referenceKey);
              }
            } else if (op.type === 'delete_paragraph') {
              // 删除段落
              const node = $getNodeByKey(op.targetKey);
              if (node) {
                node.remove();
              } else {
                console.warn('[SectionAI] Delete target not found:', op.targetKey);
              }
            }
          }
          
          resolve();
        } catch (error) {
          console.error('[SectionAI] Failed to apply ops:', error);
          reject(error);
        }
      },
      { discrete: true }
    );
  });
}

// ==========================================
// 核心执行函数
// ==========================================

/**
 * 执行 Section AI 操作
 * 
 * 这是所有 UI 入口的统一调用点。
 * 
 * @param action - 操作类型（rewrite/summarize/expand）
 * @param sectionId - 目标 Section 的节点 ID（Lexical nodeKey）
 * @param context - 执行上下文（包含 editor、toast 等）
 * @param options - 操作选项
 * @returns 执行结果
 * 
 * @example
 * ```tsx
 * // 在 UI 组件中调用
 * const handleRewrite = async () => {
 *   await runSectionAiAction('rewrite', sectionId, {
 *     editor: lexicalEditor,
 *     toast: { addToast, dismissToast },
 *   });
 * };
 * ```
 */
export async function runSectionAiAction(
  action: SectionAiAction,
  sectionId: string,
  context: SectionAiContext,
  options?: SectionAiOptions
): Promise<SectionAiResult> {
  const { editor, toast, setAiProcessing: setProcessing } = context;
  const { addToast, dismissToast } = toast;
  const actionLabel = getActionLabel(action);

  // 检查是否已有任务在运行
  if (_isAiProcessing) {
    addToast('已有 AI 任务在运行，请稍候', 'info');
    return { success: false, error: '已有任务在运行' };
  }

  // 开启 Loading
  setAiProcessing(true);
  setProcessing?.(true);
  const loadingToastId = addToast(`正在${actionLabel}章节...`, 'loading', 0);

  const __DEV_SNAPSHOT__ = process.env.NODE_ENV === 'development';
  let debugSnapshot: CopilotDebugSnapshot | null = null;
  let snapshotCommitted = false;
  const commitSnapshot = () => {
    if (!snapshotCommitted && __DEV_SNAPSHOT__ && debugSnapshot) {
      copilotDebugStore.setSnapshot(debugSnapshot);
      snapshotCommitted = true;
    }
  };

  try {
    // 1. 提取 Section 上下文
    console.log('[SectionAI] Extracting context for section:', sectionId);
    let sectionContext;
    
    try {
      sectionContext = extractSectionContext(editor, sectionId);
    } catch (extractError) {
      console.error('[SectionAI] Failed to extract section context:', extractError);
      throw new Error(`提取章节上下文失败: ${extractError instanceof Error ? extractError.message : String(extractError)}`);
    }
    
    if (!sectionContext) {
      throw new Error('无法提取章节上下文');
    }

    // 验证 sectionContext 结构
    if (!sectionContext.paragraphs) {
      console.error('[SectionAI] sectionContext.paragraphs is undefined:', sectionContext);
      throw new Error('章节上下文结构无效：paragraphs 字段缺失');
    }

    // 检查是否为空章节
    if (sectionContext.paragraphs.length === 0) {
      throw new Error('章节内容为空，无法执行操作');
    }

    console.log('[SectionAI] Section context:', {
      sectionId: sectionContext.sectionId,
      level: sectionContext.level,
      paragraphCount: sectionContext.paragraphs.length,
      titleText: sectionContext.titleText,
    });

    // 2. 构建 Intent
    let intentBody;
    switch (action) {
      case 'rewrite':
        intentBody = buildRewriteSectionIntent(sectionContext, options?.rewrite);
        break;
      case 'summarize':
        intentBody = buildSummarizeSectionIntent(sectionContext, options?.summarize);
        break;
      case 'expand':
        intentBody = buildExpandSectionIntent(sectionContext, options?.expand);
        break;
      default:
        throw new Error(`不支持的操作类型: ${action}`);
    }

    const intent = assignIntentId(intentBody);
    console.log('[SectionAI] Intent built:', intent.id, intent.kind);

    // 3. 构建 Prompt（🆕 传递 docId 以获取用户行为摘要）
    const currentDocId = copilotStore.getContext().docId;
    console.log('[SectionAI] Building prompt with docId:', currentDocId);
    const prompt = buildSectionPrompt({ intent, context: sectionContext, docId: currentDocId ?? undefined });
    console.log('[SectionAI] Prompt built, estimated tokens:', prompt.metadata?.estimatedTokens);

    // 🆕 创建调试快照（用于 Inspector 显示 Section AI 的 prompt）
    if (__DEV_SNAPSHOT__) {
      const requestMessages: DebugMessage[] = [
        { id: 'sys-0', role: 'system', content: prompt.system, contentLength: prompt.system.length },
        { id: 'usr-0', role: 'user', content: prompt.user, contentLength: prompt.user.length },
      ];
      
      debugSnapshot = {
        id: generateDebugId(),
        createdAt: Date.now(),
        model: 'section-ai',
        docId: currentDocId,
        scope: 'section',
        sectionId,
        sectionTitle: sectionContext.titleText,
        requestMessages,
        responseMessages: [],
        timings: { startedAt: Date.now() },
        usedEnvelope: false,
      };
    }

    // 4. 调用 LLM
    const llmResponse = await callLlm(prompt.system, prompt.user);
    
    if (!llmResponse.success || !llmResponse.text) {
      // 🆕 记录失败快照
      if (__DEV_SNAPSHOT__ && debugSnapshot) {
        debugSnapshot.timings.finishedAt = Date.now();
        debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
        debugSnapshot.error = llmResponse.error || 'LLM 调用失败';
      }
      commitSnapshot();
      throw new Error(llmResponse.error || 'LLM 调用失败');
    }

    console.log('[SectionAI] LLM response received, length:', llmResponse.text.length);
    
    // 🆕 记录成功快照
    if (__DEV_SNAPSHOT__ && debugSnapshot) {
      debugSnapshot.timings.finishedAt = Date.now();
      debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
      debugSnapshot.responseMessages = [{
        id: 'resp-0',
        role: 'assistant',
        content: llmResponse.text,
        contentLength: llmResponse.text.length,
      }];
    }

    // 5. 解析结构化输出（会抛出 LlmParseError）
    let protocolOutput: ParsedSectionAiProtocol | null = null;
    try {
      protocolOutput = parseStructuredLlmResponse(llmResponse.text);
    } catch (parseError) {
      if (parseError instanceof LlmParseError) {
        console.error('[SectionAI] LLM parse error:', {
          message: parseError.message,
          rawSnippet: parseError.rawSnippet,
          parseDetails: parseError.parseDetails,
        });
        throw new Error(`AI 返回格式异常: ${parseError.message}`);
      }
      throw parseError;
    }

    if (!protocolOutput) {
      throw new Error('AI 返回无法解析');
    }

    const __DEV__ = process.env.NODE_ENV === 'development';
    
    if (__DEV__) {
      console.debug('[SectionAI] Parsed CanonicalIntent:', protocolOutput.intent);
      console.debug('[SectionAI] Parsed DocOpsPlan ops:', protocolOutput.docOpsPlan.ops.length);
    }

    if (__DEV_SNAPSHOT__ && debugSnapshot) {
      debugSnapshot.canonicalIntent = protocolOutput.intent;
      debugSnapshot.docOpsPlan = protocolOutput.docOpsPlan;
      debugSnapshot.assistantResponse = protocolOutput.assistantText;
      if (protocolOutput.assistantText) {
        debugSnapshot.responseMessages = [
          ...(debugSnapshot.responseMessages || []),
          {
            id: 'resp-1',
            role: 'assistant',
            content: protocolOutput.assistantText,
            contentLength: protocolOutput.assistantText.length,
          },
        ];
      }
      copilotDebugStore.setSnapshot(debugSnapshot);
    }

    // 5.1 🆕 提取 v2 字段：responseMode / confidence / uncertainties
    const responseMode: CopilotResponseMode = protocolOutput.intent.responseMode ?? 'auto_apply';
    const confidence = protocolOutput.intent.confidence;
    const uncertainties = protocolOutput.intent.uncertainties;

    if (__DEV__) {
      console.debug('[SectionAI] v2 Protocol:', {
        responseMode,
        confidence,
        uncertaintiesCount: uncertainties?.length ?? 0,
      });
    }

    // 🆕 记录 Intent 生成事件
    const activeDocIdForLog = copilotStore.getContext().docId;
    if (activeDocIdForLog) {
      logAiIntentGenerated(activeDocIdForLog, sectionId, {
        intentId: protocolOutput.intent.intentId,
        responseMode,
        confidence,
        uncertaintiesCount: uncertainties?.length,
        sectionTitle: sectionContext.titleText ?? undefined,
      });
    }

    // 5.2 🆕 如果是 clarify 模式，不应用 DocOps，直接返回结果供 UI 处理
    if (responseMode === 'clarify') {
      console.log('[SectionAI] Clarify mode - not applying DocOps');
      
      dismissToast(loadingToastId);
      addToast('AI 需要进一步确认您的意图', 'info');

      commitSnapshot();

      return {
        success: true,
        intent: protocolOutput.intent,
        docOpsPlan: protocolOutput.docOpsPlan,
        assistantText: protocolOutput.assistantText,
        responseMode: 'clarify',
        confidence,
        uncertainties,
        applied: false,
      };
    }
    
    // 6. 根据 scope 选择目标段落
    // rewrite 时根据 scope 选择 own 或 subtree；其他操作使用 own
    const rewriteScope: SectionScope = options?.rewrite?.scope ?? 'intro';
    const targetParagraphs: ParagraphInfo[] = 
      action === 'rewrite' 
        ? getParagraphsForScope(sectionContext, rewriteScope)
        : sectionContext.ownParagraphs;
    
    const oldCount = targetParagraphs.length;
    const newCount = protocolOutput.paragraphs.length;
    
    if (__DEV__) {
      console.debug('[SectionAI] scope=', rewriteScope, 'oldCount=', oldCount, 'newCount=', newCount);
    }

    console.log('[SectionAI] Parsed output:', newCount, 'paragraphs');

    // 7. 根据操作类型处理段落
    let finalParagraphs = protocolOutput.paragraphs;
    
    if (action === 'rewrite') {
      // rewrite_section: 使用修复层确保段落数量一致
      // 需要创建一个临时的 context，使用选定的段落
      const scopedContext: SectionContext = {
        ...sectionContext,
        paragraphs: targetParagraphs,
        ownParagraphs: targetParagraphs,
        subtreeParagraphs: targetParagraphs,
      };
      
      const repairResult = repairRewriteSectionParagraphsWithDetails(
        scopedContext,
        protocolOutput.paragraphs
      );
      
      finalParagraphs = repairResult.paragraphs;
      
      if (repairResult.wasRepaired) {
        console.log('[SectionAI] Rewrite paragraphs repaired:', repairResult.repairDetails);
        
        if (__DEV__ && repairResult.repairDetails) {
          const { originalCount, targetCount, validNewCount, fallbackIndices } = repairResult.repairDetails;
          console.debug(
            `[SectionAI] Repair details: original=${originalCount}, target=${targetCount}, ` +
            `valid=${validNewCount}, fallback=${fallbackIndices.length}`
          );
        }
      }
    } else if (action === 'summarize') {
      // summarize_section: 截取过多的段落
      if (newCount > oldCount) {
        console.warn(`[SectionAI] Summarize returned more paragraphs than original: ${newCount} > ${oldCount}`);
        finalParagraphs = protocolOutput.paragraphs.slice(0, oldCount);
        console.warn(`[SectionAI] Truncated to ${oldCount} paragraphs`);
      }
    }
    // expand_section: 允许段落增加，无需特殊处理

    // 8. 构建 DocOps Diff
    // 使用 scoped context 确保 Diff 针对正确的段落
    const scopedContextForDiff: SectionContext = {
      ...sectionContext,
      paragraphs: targetParagraphs,
      ownParagraphs: targetParagraphs,
      subtreeParagraphs: targetParagraphs,
    };
    
    const docOps = buildSectionDocOpsDiff(
      scopedContextForDiff,
      finalParagraphs,
      { mode: getDiffModeFromIntent(intent.kind) }
    );

    console.log('[SectionAI] DocOps built:', docOps.length);

    // 🆕 7. 根据 responseMode 决定是否应用 DocOps
    if (responseMode === 'preview') {
      // preview 模式：不自动应用，返回结果供 UI 预览
      console.log('[SectionAI] Preview mode - returning DocOps without applying');
      
      dismissToast(loadingToastId);
      addToast('已生成预览，请确认后应用', 'info');

      commitSnapshot();

      return {
        success: true,
        docOps,
        intent: protocolOutput.intent,
        docOpsPlan: protocolOutput.docOpsPlan,
        assistantText: protocolOutput.assistantText,
        responseMode: 'preview',
        confidence,
        uncertainties,
        applied: false,
      };
    }

    // auto_apply 模式：自动应用 DocOps
    if (docOps.length > 0) {
      await applyDocOps(editor, docOps);
      console.log('[SectionAI] DocOps applied (auto_apply mode)');
    } else {
      console.log('[SectionAI] No changes needed');
    }

    // 8. 成功提示
    dismissToast(loadingToastId);
    addToast(getSuccessMessage(action), 'success');

    // 9. 记录交互事件（用于行为摘要）
    const activeDocId = copilotStore.getContext().docId;
    console.log('[SectionAI] Recording interaction event:', { activeDocId, action, sectionId });
    if (activeDocId) {
      if (action === 'rewrite') {
        logAiRewriteApplied(activeDocId, sectionId, {
          actionKind: options?.rewrite?.scope === 'chapter' ? 'rewrite_chapter' : 'rewrite_intro',
          sectionTitle: sectionContext.titleText ?? undefined,
        });
        console.log('[SectionAI] Logged ai.section_rewrite.applied');
      } else if (action === 'summarize') {
        logAiSummaryApplied(activeDocId, sectionId, {
          sectionTitle: sectionContext.titleText ?? undefined,
        });
        console.log('[SectionAI] Logged ai.section_summary.applied');
      }
      // expand 操作暂不记录，可以后续扩展
    } else {
      console.warn('[SectionAI] No activeDocId, skipping interaction event');
    }

    commitSnapshot();

    return { 
      success: true, 
      docOps,
      intent: protocolOutput.intent,
      docOpsPlan: protocolOutput.docOpsPlan,
      assistantText: protocolOutput.assistantText,
      responseMode: 'auto_apply',
      confidence,
      uncertainties,
      applied: true,
    };
  } catch (error) {
    // 错误处理
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SectionAI Error]', error);

    dismissToast(loadingToastId);
    addToast(`${actionLabel}失败: ${errorMessage}`, 'error');

    if (__DEV_SNAPSHOT__ && debugSnapshot) {
      debugSnapshot.error = errorMessage;
    }
    if (typeof commitSnapshot === 'function') {
      commitSnapshot();
    }

    return { success: false, error: errorMessage };
  } finally {
    // 关闭 Loading
    setAiProcessing(false);
    setProcessing?.(false);
  }
}

// ==========================================
// 便捷方法
// ==========================================

/**
 * 执行章节重写
 */
export async function rewriteSection(
  sectionId: string,
  context: SectionAiContext,
  options?: RewriteSectionOptions
): Promise<SectionAiResult> {
  return runSectionAiAction('rewrite', sectionId, context, { rewrite: options });
}

/**
 * 执行章节总结
 */
export async function summarizeSection(
  sectionId: string,
  context: SectionAiContext,
  options?: SummarizeSectionOptions
): Promise<SectionAiResult> {
  return runSectionAiAction('summarize', sectionId, context, { summarize: options });
}

/**
 * 执行章节扩写
 */
export async function expandSection(
  sectionId: string,
  context: SectionAiContext,
  options?: ExpandSectionOptions
): Promise<SectionAiResult> {
  return runSectionAiAction('expand', sectionId, context, { expand: options });
}

// ==========================================
// v2 新增：Preview 模式和 Clarify 模式支持
// ==========================================

/**
 * 应用待处理的 DocOps（用于 preview 模式确认后）
 * 
 * @param editor - Lexical 编辑器实例
 * @param pendingResult - 之前返回的 SectionAiResult（responseMode=preview）
 * @returns 是否成功应用
 */
export async function applyPendingDocOps(
  editor: LexicalEditor,
  pendingResult: SectionAiResult
): Promise<boolean> {
  if (!pendingResult.docOps || pendingResult.docOps.length === 0) {
    console.warn('[SectionAI] No pending DocOps to apply');
    return false;
  }

  try {
    await applyDocOps(editor, pendingResult.docOps);
    console.log('[SectionAI] Pending DocOps applied successfully');
    
    // 记录交互事件
    const activeDocId = copilotStore.getContext().docId;
    if (activeDocId && pendingResult.intent?.scope.sectionId) {
      const sectionId = pendingResult.intent.scope.sectionId;
      const tasks = pendingResult.intent.tasks;
      
      if (tasks.some(t => t.type === 'rewrite')) {
        logAiRewriteApplied(activeDocId, sectionId, {
          actionKind: 'rewrite_intro',
        });
      } else if (tasks.some(t => t.type === 'summarize')) {
        logAiSummaryApplied(activeDocId, sectionId);
      }
    }
    
    return true;
  } catch (error) {
    console.error('[SectionAI] Failed to apply pending DocOps:', error);
    return false;
  }
}

/**
 * Clarify 模式：用户选择后的重新调用参数
 */
export interface ClarificationChoice {
  /** 原始意图 */
  originalIntent: CanonicalIntent;
  /** 被澄清的不确定性 */
  uncertainty: IntentUncertainty;
  /** 用户选择的选项（来自 candidateOptions）或自定义输入 */
  userChoice: string;
}

/**
 * 带澄清的 Section AI 调用（用于 clarify 模式用户选择后）
 * 
 * 将用户选择作为附加约束，重新调用 Section AI
 * 
 * @param action - 操作类型
 * @param sectionId - Section ID
 * @param context - 执行上下文
 * @param clarification - 澄清信息
 * @param options - 操作选项
 */
export async function triggerSectionAiWithClarification(
  action: SectionAiAction,
  sectionId: string,
  context: SectionAiContext,
  clarification: ClarificationChoice,
  options?: SectionAiOptions
): Promise<SectionAiResult> {
  const { uncertainty, userChoice } = clarification;
  
  // 构造澄清后的 customPrompt，追加用户选择
  const clarificationPrompt = `
补充说明：对于之前提到的不确定点「${uncertainty.field}」（原因：${uncertainty.reason}），
用户选择了：${userChoice}。
请据此重新生成 Intent 和 DocOpsPlan，并将 responseMode 设为 "auto_apply" 或 "preview"（不要再次 clarify）。
`;

  // 合并到选项中
  const mergedOptions: SectionAiOptions = {
    ...options,
    rewrite: options?.rewrite ? {
      ...options.rewrite,
      customPrompt: (options.rewrite.customPrompt || '') + clarificationPrompt,
    } : { customPrompt: clarificationPrompt } as any,
    summarize: options?.summarize ? {
      ...options.summarize,
      customPrompt: (options.summarize.customPrompt || '') + clarificationPrompt,
    } : { customPrompt: clarificationPrompt } as any,
    expand: options?.expand ? {
      ...options.expand,
      customPrompt: (options.expand.customPrompt || '') + clarificationPrompt,
    } : { customPrompt: clarificationPrompt } as any,
  };

  console.log('[SectionAI] Triggering with clarification:', {
    field: uncertainty.field,
    userChoice,
  });

  return runSectionAiAction(action, sectionId, context, mergedOptions);
}

