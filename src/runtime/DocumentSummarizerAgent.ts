/**
 * DocumentSummarizerAgent - 文档级逐节总结 Agent
 * 
 * 【功能】
 * 从 Outline 中获取每个 Section → 调 LLM 总结 → 在对应 Section 末尾插入「本节总结」
 * 
 * 【设计原则】
 * - 单文件、单 Agent 的任务管线
 * - 串行处理，避免并发冲突
 * - 支持取消和错误恢复
 * - 所有修改支持 Undo/Redo
 */

import { LexicalEditor } from 'lexical';
import { SectionDocOps, createSectionDocOps } from '../docops/SectionDocOps';
import { Section } from '../document/section';

// LLM 响应类型（与 LlmService 保持一致）
interface LlmResponse {
  success: boolean;
  text?: string;
  error?: string;
  latencyMs?: number;
}

// ==========================================
// 类型定义
// ==========================================

export type SectionTaskStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface SectionSummaryTask {
  /** 章节信息 */
  section: Section;
  /** 任务状态 */
  status: SectionTaskStatus;
  /** 错误信息 */
  error?: string;
  /** 生成的总结文本 */
  summaryText?: string;
  /** 处理耗时（毫秒） */
  latencyMs?: number;
}

export type AgentOverallStatus = 'idle' | 'running' | 'success' | 'error' | 'canceled';

export interface DocumentSummarizerState {
  /** 文档 ID（可选，用于识别） */
  docId?: string;
  /** 所有任务 */
  tasks: SectionSummaryTask[];
  /** 整体状态 */
  overallStatus: AgentOverallStatus;
  /** 当前正在处理的任务索引 */
  currentIndex: number;
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 成功计数 */
  successCount: number;
  /** 失败计数 */
  errorCount: number;
  /** 跳过计数（内容太少） */
  skippedCount: number;
}

export interface AgentOptions {
  /** 最小标题级别（默认 2，即 H2/H3） */
  minHeadingLevel?: 1 | 2 | 3;
  /** 最小章节内容长度（低于此长度跳过） */
  minContentLength?: number;
  /** 总结语言 */
  language?: 'zh' | 'en';
  /** 总结风格 */
  style?: 'formal' | 'casual';
}

export type StateChangeCallback = (state: DocumentSummarizerState) => void;

// ==========================================
// Prompt 模板
// ==========================================

// System prompt for summarization (kept for reference)
// const SUMMARIZE_SYSTEM_PROMPT = `你是一个专业的文档摘要助手。...`;

function buildSummarizePrompt(sectionTitle: string, sectionText: string, language: 'zh' | 'en'): string {
  const langInstruction = language === 'zh' 
    ? '请用中文总结' 
    : 'Please summarize in English';
  
  return `${langInstruction}。

章节标题：${sectionTitle}

章节内容：
${sectionText}

请直接输出 2-3 句话的摘要：`;
}

// ==========================================
// DocumentSummarizerAgent 类
// ==========================================

export class DocumentSummarizerAgent {
  private docOps: SectionDocOps;
  private state: DocumentSummarizerState;
  private options: Required<AgentOptions>;
  private onStateChange?: StateChangeCallback;
  private isCanceled: boolean = false;

  constructor(
    editor: LexicalEditor,
    options: AgentOptions = {},
    onStateChange?: StateChangeCallback
  ) {
    this.docOps = createSectionDocOps(editor);
    this.onStateChange = onStateChange;
    
    // 默认选项
    this.options = {
      minHeadingLevel: options.minHeadingLevel || 2,
      minContentLength: options.minContentLength || 50,
      language: options.language || 'zh',
      style: options.style || 'formal',
    };

    // 初始状态
    this.state = {
      tasks: [],
      overallStatus: 'idle',
      currentIndex: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
    };
  }

  /**
   * 获取当前状态
   */
  getState(): DocumentSummarizerState {
    return { ...this.state };
  }

  /**
   * 初始化 Agent
   * 
   * 扫描文档生成任务列表
   */
  initialize(): void {
    const sections = this.docOps.getAllSections();
    
    this.state.tasks = sections.map(section => ({
      section,
      status: 'pending' as SectionTaskStatus,
    }));
    
    this.state.currentIndex = 0;
    this.state.successCount = 0;
    this.state.errorCount = 0;
    this.state.skippedCount = 0;
    
    console.log('[DocumentSummarizerAgent] Initialized with', this.state.tasks.length, 'sections');
    this.notifyStateChange();
  }

  /**
   * 运行 Agent
   * 
   * 串行处理每个章节
   */
  async run(): Promise<void> {
    if (this.state.tasks.length === 0) {
      console.warn('[DocumentSummarizerAgent] No tasks to process');
      return;
    }

    this.state.overallStatus = 'running';
    this.state.startTime = Date.now();
    this.isCanceled = false;
    this.notifyStateChange();

    console.log('[DocumentSummarizerAgent] Starting run...');

    for (let i = 0; i < this.state.tasks.length; i++) {
      if (this.isCanceled) {
        console.log('[DocumentSummarizerAgent] Canceled at task', i);
        break;
      }

      this.state.currentIndex = i;
      await this.processTask(i);
      this.notifyStateChange();
    }

    // 确定最终状态
    this.state.endTime = Date.now();
    
    if (this.isCanceled) {
      this.state.overallStatus = 'canceled';
    } else if (this.state.errorCount > 0) {
      this.state.overallStatus = 'error';
    } else {
      this.state.overallStatus = 'success';
    }

    console.log('[DocumentSummarizerAgent] Finished:', {
      status: this.state.overallStatus,
      success: this.state.successCount,
      errors: this.state.errorCount,
      skipped: this.state.skippedCount,
      duration: this.state.endTime - (this.state.startTime || 0),
    });

    this.notifyStateChange();
  }

  /**
   * 取消运行
   */
  cancel(): void {
    this.isCanceled = true;
    console.log('[DocumentSummarizerAgent] Cancel requested');
  }

  /**
   * 通过 IPC 调用 LLM
   */
  private async callLlm(userPrompt: string): Promise<LlmResponse> {
    // 使用 window.aiDoc API（通过 preload 暴露）
    if (typeof window !== 'undefined' && window.aiDoc?.summarizeSection) {
      return window.aiDoc.summarizeSection(userPrompt, {
        language: this.options.language,
        style: this.options.style,
      });
    }
    
    // 如果 API 不可用，返回错误
    return {
      success: false,
      error: 'LLM 服务不可用（IPC 未初始化）',
    };
  }

  /**
   * 处理单个任务
   */
  private async processTask(index: number): Promise<void> {
    const task = this.state.tasks[index];
    const { section } = task;

    task.status = 'running';
    this.notifyStateChange();

    const startTime = Date.now();

    try {
      // 获取章节内容
      const sectionText = this.docOps.getSectionText(section.heading.id);
      
      if (!sectionText || sectionText.length < this.options.minContentLength) {
        console.log('[DocumentSummarizerAgent] Skipping section (content too short):', section.heading.text);
        task.status = 'skipped';
        task.error = '内容过少，跳过总结';
        this.state.skippedCount++;
        return;
      }

      // 调用 LLM（通过 IPC）
      const prompt = buildSummarizePrompt(section.heading.text, sectionText, this.options.language);
      const response = await this.callLlm(prompt);

      if (!response.success || !response.text) {
        throw new Error(response.error || 'LLM 返回空响应');
      }

      // 插入总结
      await this.docOps.insertSectionSummary(section.heading.id, response.text);

      task.status = 'success';
      task.summaryText = response.text;
      task.latencyMs = Date.now() - startTime;
      this.state.successCount++;

      console.log('[DocumentSummarizerAgent] Success:', section.heading.text, `(${task.latencyMs}ms)`);

    } catch (error) {
      task.status = 'error';
      task.error = error instanceof Error ? error.message : '未知错误';
      task.latencyMs = Date.now() - startTime;
      this.state.errorCount++;

      console.error('[DocumentSummarizerAgent] Error processing section:', section.heading.text, error);
    }
  }

  /**
   * 通知状态变化
   */
  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }
}

// ==========================================
// 工厂函数
// ==========================================

/**
 * 创建并初始化 DocumentSummarizerAgent
 */
export function createDocumentSummarizerAgent(
  editor: LexicalEditor,
  options?: AgentOptions,
  onStateChange?: StateChangeCallback
): DocumentSummarizerAgent {
  const agent = new DocumentSummarizerAgent(editor, options, onStateChange);
  agent.initialize();
  return agent;
}

