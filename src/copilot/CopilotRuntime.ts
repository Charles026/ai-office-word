/**
 * CopilotRuntime - Copilot 运行时核心
 * 
 * 【职责】
 * - 维护 CopilotSessionState
 * - 准备 DocContextEnvelope + BehaviorSummary
 * - 调用 LLM 并解析 Intent
 * - 根据 Intent 决定执行聊天或编辑操作
 * 
 * 【设计原则】
 * - 不直接操作 Lexical / DocumentEngine
 * - 所有文档编辑通过 applySectionEdit 桥接现有 Section AI 路径
 * - 保持良好的日志便于调试
 */

import type { LexicalEditor } from 'lexical';
import type {
  CopilotSessionState,
  CopilotModelOutput,
  CopilotIntent,
  CopilotRuntimeScope,
  CopilotUserPrefs,
} from './copilotRuntimeTypes';
import { createDefaultSessionState } from './copilotRuntimeTypes';
import {
  buildCopilotSystemPrompt,
  parseCopilotModelOutput,
  isIntentExecutable,
  describeIntent,
} from './copilotIntentParser';
import { buildDocContextEnvelope } from '../docContext';
import type { DocContextEnvelope } from '../docContext';
import { buildRecentBehaviorSummary } from '../interaction';
import type { BehaviorSummary } from '../interaction';
import {
  runSectionAiAction,
  type SectionAiAction,
  type SectionAiContext,
  type SectionAiResult,
} from '../actions/sectionAiActions';
import { copilotStore } from './copilotStore';
import { copilotDebugStore } from './copilotDebugStore';
import { generateDebugId } from './copilotDebugTypes';
import type { CopilotDebugSnapshot, DebugMessage } from './copilotDebugTypes';

// ==========================================
// 常量
// ==========================================

const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

const DEFAULT_MAX_TOKENS = 8192;
const BEHAVIOR_WINDOW_MS = 10 * 60 * 1000; // 10 分钟

// ==========================================
// 依赖接口
// ==========================================

/**
 * CopilotRuntime 依赖
 */
export interface CopilotRuntimeDeps {
  /** LLM 聊天接口 */
  chatWithLLM: (messages: Array<{ role: string; content: string }>) => Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }>;
  
  /** 获取 Lexical 编辑器实例 */
  getEditor: () => LexicalEditor | null;
  
  /** Toast 回调 */
  toast?: {
    addToast: (message: string, type: 'success' | 'error' | 'info' | 'loading', duration?: number) => string;
    dismissToast: (id: string) => void;
  };
}

/**
 * runTurn 返回结果
 */
export interface CopilotTurnResult {
  /** 给用户的回复文本 */
  replyText: string;
  /** 解析出的 Intent（可能为空） */
  intent?: CopilotIntent;
  /** 是否执行了文档编辑 */
  executed: boolean;
  /** 执行结果（仅当 executed=true） */
  editResult?: SectionAiResult;
  /** 错误信息（如果有） */
  error?: string;
}

// ==========================================
// CopilotRuntime 类
// ==========================================

/**
 * Copilot 运行时
 * 
 * 在 UI 与底层 AI/DocOps 之间的协调层。
 */
export class CopilotRuntime {
  private state: CopilotSessionState;
  private deps: CopilotRuntimeDeps;
  
  constructor(deps: CopilotRuntimeDeps, initialDocId?: string) {
    this.deps = deps;
    this.state = createDefaultSessionState(initialDocId || '');
    
    if (__DEV__) {
      console.log('[CopilotRuntime] Initialized with docId:', initialDocId);
    }
  }
  
  // ==========================================
  // State 访问器
  // ==========================================
  
  /**
   * 获取当前会话状态
   */
  getSessionState(): CopilotSessionState {
    return { ...this.state };
  }
  
  /**
   * 更新会话状态
   */
  updateSessionState(patch: Partial<CopilotSessionState>): void {
    this.state = { ...this.state, ...patch };
    
    if (__DEV__) {
      console.debug('[CopilotRuntime] State updated:', patch);
    }
  }
  
  /**
   * 设置当前文档
   */
  setDocId(docId: string): void {
    this.state.docId = docId;
    // 切换文档时重置为 document scope
    this.state.scope = 'document';
    this.state.focusSectionId = undefined;
    this.state.lastTask = undefined;
  }
  
  /**
   * 设置聚焦范围
   */
  setScope(scope: CopilotRuntimeScope, sectionId?: string): void {
    this.state.scope = scope;
    if (scope === 'section' && sectionId) {
      this.state.focusSectionId = sectionId;
    } else if (scope === 'document') {
      this.state.focusSectionId = undefined;
    }
  }
  
  /**
   * 设置用户偏好
   */
  setUserPrefs(prefs: Partial<CopilotUserPrefs>): void {
    this.state.userPrefs = { ...this.state.userPrefs, ...prefs };
  }
  
  // ==========================================
  // 核心方法：runTurn
  // ==========================================
  
  /**
   * 执行一轮对话
   * 
   * 流程：
   * 1. 读取当前 SessionState
   * 2. 构建 DocContextEnvelope
   * 3. 可选：获取 BehaviorSummary
   * 4. 构建 System Prompt + User Message
   * 5. 调用 LLM
   * 6. 解析 Intent
   * 7. mode=edit → 执行编辑；mode=chat → 只返回回复
   * 
   * @param userText - 用户输入
   * @returns CopilotTurnResult
   */
  async runTurn(userText: string): Promise<CopilotTurnResult> {
    const { docId, scope, focusSectionId } = this.state;
    
    if (__DEV__) {
      console.log('[CopilotRuntime] runTurn started:', {
        userText: userText.slice(0, 50),
        docId,
        scope,
        focusSectionId,
      });
    }
    
    // 初始化调试快照
    const debugSnapshot: CopilotDebugSnapshot = {
      id: generateDebugId(),
      createdAt: Date.now(),
      model: 'copilot-runtime',
      docId,
      scope,
      sectionId: focusSectionId,
      requestMessages: [],
      responseMessages: [],
      timings: { startedAt: Date.now() },
      usedEnvelope: false,
    };
    
    try {
      // 1. 检查基本条件
      if (!docId) {
        return {
          replyText: '请先打开一个文档。',
          executed: false,
          error: 'No document open',
        };
      }
      
      const editor = this.deps.getEditor();
      if (!editor) {
        return {
          replyText: '编辑器未就绪，请稍后重试。',
          executed: false,
          error: 'Editor not ready',
        };
      }
      
      // 2. 构建 DocContextEnvelope
      let envelope: DocContextEnvelope;
      try {
        envelope = await buildDocContextEnvelope(
          {
            docId,
            scope: scope,
            sectionId: scope === 'section' ? focusSectionId : undefined,
            maxTokens: DEFAULT_MAX_TOKENS,
          },
          editor
        );
        debugSnapshot.envelope = envelope;
        debugSnapshot.usedEnvelope = true;
        
        if (__DEV__) {
          console.debug('[CopilotRuntime] Envelope built:', {
            scope: envelope.scope,
            title: envelope.global.title,
            focusSection: envelope.focus.sectionTitle,
          });
        }
      } catch (envelopeError) {
        if (__DEV__) {
          console.error('[CopilotRuntime] Failed to build envelope:', envelopeError);
        }
        return {
          replyText: '无法获取文档上下文，请重试。',
          executed: false,
          error: `Envelope build failed: ${envelopeError}`,
        };
      }
      
      // 3. 获取行为摘要
      let behaviorSummary: BehaviorSummary | undefined;
      try {
        behaviorSummary = buildRecentBehaviorSummary({
          docId,
          windowMs: BEHAVIOR_WINDOW_MS,
        });
        
        if (__DEV__ && behaviorSummary.stats.eventCount > 0) {
          console.debug('[CopilotRuntime] Behavior summary:', {
            eventCount: behaviorSummary.stats.eventCount,
            bullets: behaviorSummary.bullets,
          });
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[CopilotRuntime] Failed to build behavior summary:', err);
        }
        // 行为摘要失败不阻止流程
      }
      
      // 4. 构建 Prompt
      const systemPrompt = buildCopilotSystemPrompt(this.state, envelope, behaviorSummary);
      const userPrompt = this.buildUserPrompt(userText, envelope);
      
      // 记录请求消息
      const requestMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      debugSnapshot.requestMessages = requestMessages.map((msg, idx) => ({
        id: `req-${idx}`,
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
        contentLength: msg.content.length,
      }));
      
      // 5. 调用 LLM
      if (__DEV__) {
        console.log('[CopilotRuntime] Calling LLM...');
      }
      
      const llmResponse = await this.deps.chatWithLLM(requestMessages);
      
      debugSnapshot.timings.finishedAt = Date.now();
      debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
      
      if (!llmResponse.success || !llmResponse.content) {
        debugSnapshot.error = llmResponse.error || 'LLM call failed';
        this.saveDebugSnapshot(debugSnapshot);
        
        return {
          replyText: `抱歉，AI 响应失败：${llmResponse.error || '未知错误'}`,
          executed: false,
          error: llmResponse.error,
        };
      }
      
      // 记录响应
      debugSnapshot.responseMessages = [{
        id: 'resp-0',
        role: 'assistant',
        content: llmResponse.content,
        contentLength: llmResponse.content.length,
      }];
      
      // 🆕 DEV: 打印原始 LLM 输出（便于调试 Intent 解析）
      if (__DEV__) {
        console.log('[CopilotRuntime] ========== LLM RAW OUTPUT ==========');
        console.log(llmResponse.content.slice(0, 1000));
        if (llmResponse.content.length > 1000) {
          console.log('... (truncated, total length:', llmResponse.content.length, ')');
        }
        console.log('[CopilotRuntime] ====================================');
      }
      
      // 6. 解析 Intent
      const parsed = parseCopilotModelOutput(llmResponse.content);
      
      if (__DEV__) {
        console.log('[CopilotRuntime] Parsed output:', {
          hasIntent: !!parsed.intent,
          intentMode: parsed.intent?.mode,
          intentAction: parsed.intent?.action,
          targetScope: parsed.intent?.target?.scope,
          targetSectionId: parsed.intent?.target?.sectionId,
          replyTextLength: parsed.replyText.length,
          replyTextPreview: parsed.replyText.slice(0, 100),
        });
      }
      
      // 记录解析结果
      if (parsed.intent) {
        debugSnapshot.canonicalIntent = {
          intentId: `copilot-${Date.now()}`,
          scope: {
            level: parsed.intent.target.scope,
            sectionId: parsed.intent.target.sectionId,
          },
          tasks: [{
            type: parsed.intent.action as any,
            target: parsed.intent.target.scope,
          }],
          responseMode: parsed.intent.mode === 'edit' ? 'auto_apply' : 'auto_apply',
        } as any;
      }
      
      // 7. 根据 Intent 决定行为
      if (parsed.intent && parsed.intent.mode === 'edit' && isIntentExecutable(parsed.intent)) {
        // 执行编辑操作
        const editResult = await this.executeEditIntent(parsed.intent, editor);
        
        // 更新 lastTask
        this.state.lastTask = parsed.intent.action;
        
        this.saveDebugSnapshot(debugSnapshot);
        
        return {
          replyText: parsed.replyText,
          intent: parsed.intent,
          executed: editResult.success,
          editResult,
          error: editResult.error,
        };
      }
      
      // 纯聊天模式
      this.saveDebugSnapshot(debugSnapshot);
      
      return {
        replyText: parsed.replyText,
        intent: parsed.intent,
        executed: false,
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      if (__DEV__) {
        console.error('[CopilotRuntime] runTurn error:', error);
      }
      
      debugSnapshot.error = errorMsg;
      debugSnapshot.timings.finishedAt = Date.now();
      debugSnapshot.timings.totalMs = debugSnapshot.timings.finishedAt - debugSnapshot.timings.startedAt;
      this.saveDebugSnapshot(debugSnapshot);
      
      return {
        replyText: `抱歉，发生了错误：${errorMsg}`,
        executed: false,
        error: errorMsg,
      };
    }
  }
  
  // ==========================================
  // 内部方法
  // ==========================================
  
  /**
   * 构建用户消息
   */
  private buildUserPrompt(userText: string, envelope: DocContextEnvelope): string {
    const parts: string[] = [`用户指令：${userText}`];
    
    // 如果是 section scope，提供章节内容
    if (envelope.scope === 'section' && envelope.focus.text) {
      parts.push(`\n当前章节内容：\n${envelope.focus.text}`);
    }
    
    return parts.join('\n');
  }
  
  /**
   * 执行编辑 Intent
   * 
   * 桥接现有的 Section AI 路径
   */
  private async executeEditIntent(
    intent: CopilotIntent,
    editor: LexicalEditor
  ): Promise<SectionAiResult> {
    const { action, target } = intent;
    
    if (__DEV__) {
      console.log('[CopilotRuntime] Executing edit intent:', describeIntent(intent));
    }
    
    // 映射 CopilotAction → SectionAiAction
    let sectionAction: SectionAiAction;
    switch (action) {
      case 'rewrite_section':
        sectionAction = 'rewrite';
        break;
      case 'summarize_section':
        sectionAction = 'summarize';
        break;
      default:
        return {
          success: false,
          error: `不支持的操作类型: ${action}`,
        };
    }
    
    // 检查 sectionId
    const sectionId = target.sectionId || this.state.focusSectionId;
    if (!sectionId) {
      return {
        success: false,
        error: '未指定目标章节',
      };
    }
    
    // 构建执行上下文
    const context: SectionAiContext = {
      editor,
      toast: this.deps.toast || {
        addToast: (msg, type) => {
          if (__DEV__) console.log(`[Toast] ${type}: ${msg}`);
          return 'mock-toast';
        },
        dismissToast: () => {},
      },
    };
    
    // 调用现有的 Section AI
    try {
      const result = await runSectionAiAction(sectionAction, sectionId, context);
      
      if (__DEV__) {
        console.log('[CopilotRuntime] Edit result:', {
          success: result.success,
          responseMode: result.responseMode,
          applied: result.applied,
        });
      }
      
      return result;
    } catch (error) {
      if (__DEV__) {
        console.error('[CopilotRuntime] Edit execution failed:', error);
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * 保存调试快照
   */
  private saveDebugSnapshot(snapshot: CopilotDebugSnapshot): void {
    if (__DEV__) {
      copilotDebugStore.setSnapshot(snapshot);
    }
  }
}

// ==========================================
// 工厂函数
// ==========================================

/**
 * 创建 CopilotRuntime 实例
 * 
 * 使用默认的 window.aiDoc.chat 作为 LLM 接口
 */
export function createCopilotRuntime(
  getEditor: () => LexicalEditor | null,
  toast?: CopilotRuntimeDeps['toast'],
  initialDocId?: string
): CopilotRuntime {
  const deps: CopilotRuntimeDeps = {
    chatWithLLM: async (messages) => {
      if (typeof window !== 'undefined' && window.aiDoc?.chat) {
        try {
          const response = await window.aiDoc.chat({ messages });
          return {
            success: response.success,
            content: response.content,
            error: response.error,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'LLM 调用失败',
          };
        }
      }
      return {
        success: false,
        error: 'LLM 服务不可用',
      };
    },
    getEditor,
    toast,
  };
  
  return new CopilotRuntime(deps, initialDocId);
}

