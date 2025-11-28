/**
 * DocAgentRuntime - 通用文档级 Agent 运行时
 * 
 * 【功能】
 * 提供一个轻量级 runtime，用于跑「遍历所有节 → 对每节调用 handler → 写回」的任务。
 * 
 * 【设计原则】
 * - 串行执行，避免并发冲突
 * - 支持取消和错误恢复
 * - 状态可观测，便于 UI 展示进度
 * - 可复用，不同 Agent（Summarize、Translate、Polish…）基于此 runtime
 */

import { Section } from '../../document/section';
import { SectionDocOps } from '../../docops/SectionDocOps';

// ==========================================
// 类型定义
// ==========================================

/** 步骤状态 */
export type DocAgentStepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

/** 单个步骤 */
export interface DocAgentStep {
  /** 对应的章节 */
  section: Section;
  /** 当前状态 */
  status: DocAgentStepStatus;
  /** 错误信息（仅 status=error 时） */
  error?: string;
  /** 处理耗时（毫秒） */
  latencyMs?: number;
}

/** Agent 整体状态 */
export type DocAgentOverallStatus = 'idle' | 'running' | 'success' | 'error' | 'canceled';

/** Agent 状态 */
export interface DocAgentState {
  /** 文档 ID（可选） */
  docId?: string;
  /** 所有步骤 */
  steps: DocAgentStep[];
  /** 当前正在处理的步骤索引 */
  currentIndex: number;
  /** 整体状态 */
  status: DocAgentOverallStatus;
  /** Agent 类型（用于 UI 区分） */
  agentType?: string;
  /** Agent 配置（自定义参数） */
  meta?: Record<string, unknown>;
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 成功计数 */
  successCount: number;
  /** 失败计数 */
  errorCount: number;
  /** 跳过计数 */
  skippedCount: number;
}

/** Agent 上下文 */
export interface DocAgentContext {
  /** 章节操作接口 */
  docOps: SectionDocOps;
  /** LLM 服务（通过 IPC 调用） */
  llm: {
    translateHtmlSection: (html: string, options: { direction: 'en_to_zh' | 'zh_to_en' }) => Promise<string>;
    summarizeSection: (text: string, options?: { language?: 'zh' | 'en' }) => Promise<string>;
  };
}

/** Handler 返回类型 */
export type SectionHandlerResult = 'success' | 'skipped';

/** 章节处理器 */
export type SectionHandler = (args: {
  context: DocAgentContext;
  docId: string;
  section: Section;
  stepIndex: number;
}) => Promise<SectionHandlerResult>;

/** Runtime 配置 */
export interface DocAgentRuntimeOptions {
  /** 最大并发数（暂时只支持 1） */
  maxConcurrency?: number;
  /** Agent 类型标识 */
  agentType?: string;
  /** 自定义配置 */
  meta?: Record<string, unknown>;
  /** 状态变化回调 */
  onStateChange?: (state: DocAgentState) => void;
  /** 是否包含 H1 级别的章节（默认 false） */
  includeH1?: boolean;
}

// ==========================================
// DocAgentRuntime 类
// ==========================================

/**
 * 通用文档级 Agent 运行时
 */
export class DocAgentRuntime {
  private context: DocAgentContext;
  private docId: string;
  private handler: SectionHandler;
  private options: DocAgentRuntimeOptions;
  private isCanceled: boolean = false;
  
  /** Agent 状态（公开只读） */
  public state: DocAgentState;

  constructor(
    context: DocAgentContext,
    docId: string,
    handler: SectionHandler,
    options: DocAgentRuntimeOptions = {}
  ) {
    this.context = context;
    this.docId = docId;
    this.handler = handler;
    this.options = options;
    
    // 初始化状态
    this.state = {
      docId,
      steps: [],
      currentIndex: -1,
      status: 'idle',
      agentType: options.agentType,
      meta: options.meta,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
    };
  }

  /**
   * 初始化：获取章节列表，准备步骤
   */
  async init(): Promise<void> {
    console.log('[DocAgentRuntime] Initializing...');
    
    // 获取所有章节（根据配置决定是否包含 H1）
    const includeH1 = this.options.includeH1 ?? false;
    const sections = this.context.docOps.getAllSections(includeH1);
    
    if (sections.length === 0) {
      console.warn('[DocAgentRuntime] No sections found');
    }

    // 初始化步骤
    this.state.steps = sections.map(section => ({
      section,
      status: 'pending' as DocAgentStepStatus,
    }));

    console.log('[DocAgentRuntime] Initialized with', sections.length, 'sections (includeH1:', includeH1, ')');
    this.notifyStateChange();
  }

  /**
   * 运行：串行执行所有步骤
   */
  async run(): Promise<void> {
    if (this.state.steps.length === 0) {
      console.warn('[DocAgentRuntime] No steps to process');
      this.state.status = 'success';
      this.notifyStateChange();
      return;
    }

    // 如果在运行前就已取消，直接返回取消状态
    if (this.isCanceled) {
      this.state.status = 'canceled';
      this.state.endTime = Date.now();
      this.notifyStateChange();
      return;
    }

    this.state.status = 'running';
    this.state.startTime = Date.now();
    this.state.currentIndex = 0;
    this.notifyStateChange();

    console.log('[DocAgentRuntime] Starting run...');

    for (let i = 0; i < this.state.steps.length; i++) {
      // 检查是否被取消
      if (this.isCanceled) {
        console.log('[DocAgentRuntime] Canceled at step', i);
        break;
      }

      this.state.currentIndex = i;
      await this.processStep(i);
      this.notifyStateChange();
    }

    // 确定最终状态
    this.state.endTime = Date.now();
    
    if (this.isCanceled) {
      this.state.status = 'canceled';
    } else if (this.state.errorCount > 0) {
      this.state.status = 'error';
    } else {
      this.state.status = 'success';
    }

    const duration = this.state.endTime - (this.state.startTime || 0);
    console.log('[DocAgentRuntime] Finished:', {
      status: this.state.status,
      success: this.state.successCount,
      errors: this.state.errorCount,
      skipped: this.state.skippedCount,
      duration: `${duration}ms`,
    });

    this.notifyStateChange();
  }

  /**
   * 取消运行
   */
  cancel(): void {
    this.isCanceled = true;
    console.log('[DocAgentRuntime] Cancel requested');
  }

  /**
   * 获取当前状态
   */
  getState(): DocAgentState {
    return { ...this.state };
  }

  /**
   * 处理单个步骤
   */
  private async processStep(index: number): Promise<void> {
    const step = this.state.steps[index];
    const { section } = step;

    step.status = 'running';
    this.notifyStateChange();

    const startTime = Date.now();

    try {
      const result = await this.handler({
        context: this.context,
        docId: this.docId,
        section,
        stepIndex: index,
      });

      step.latencyMs = Date.now() - startTime;

      if (result === 'success') {
        step.status = 'success';
        this.state.successCount++;
        console.log('[DocAgentRuntime] Step success:', section.heading.text, `(${step.latencyMs}ms)`);
      } else if (result === 'skipped') {
        step.status = 'skipped';
        this.state.skippedCount++;
        console.log('[DocAgentRuntime] Step skipped:', section.heading.text);
      }

    } catch (error) {
      step.status = 'error';
      step.error = error instanceof Error ? error.message : '未知错误';
      step.latencyMs = Date.now() - startTime;
      this.state.errorCount++;
      console.error('[DocAgentRuntime] Step error:', section.heading.text, step.error);
      // 继续处理下一个步骤，不中断整个流程
    }
  }

  /**
   * 通知状态变化
   */
  private notifyStateChange(): void {
    if (this.options.onStateChange) {
      this.options.onStateChange(this.getState());
    }
  }
}

// ==========================================
// 工厂函数
// ==========================================

/**
 * 创建 DocAgentRuntime 实例
 */
export function createDocAgentRuntime(
  context: DocAgentContext,
  docId: string,
  handler: SectionHandler,
  options?: DocAgentRuntimeOptions
): DocAgentRuntime {
  return new DocAgentRuntime(context, docId, handler, options);
}

