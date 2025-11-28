/**
 * AiRuntime - AI 运行时
 * 
 * 【层级职责】
 * AI Runtime / Copilot 层负责：
 * - 协调 AI 模型调用
 * - 管理自然语言到 Intent 的转换
 * - 处理流式输出和多轮对话
 * 
 * 【禁止事项】
 * - 不允许在此层直接修改 DocumentAst
 * - 不允许在此层访问文件系统
 * - 当前阶段只实现代理到 DocOpsEngine
 * 
 * 【未来实现】
 * - 接入 OpenAI / Claude / 本地模型
 * - 支持流式输出 (streaming)
 * - 支持 function calling
 * - 支持多轮对话上下文
 */

import { DocOp } from '../docops/types';
import { DocumentAst } from '../document/types';
import { AiIntent, AiContext, AiRuntimeResponse } from './types';
import { docOpsEngine, DocOpsEngine } from '../docops/DocOpsEngine';

// ==========================================
// AiRuntime 接口
// ==========================================

export interface AiRuntime {
  /**
   * 提交 Intent 获取 DocOps
   * 
   * 这是主要的 AI 交互入口。
   * 接收用户意图，返回文档操作序列。
   */
  submitIntent(intent: AiIntent, ast: DocumentAst): Promise<DocOp[]>;

  /**
   * 提交自然语言查询（预留）
   * 
   * 未来用于：
   * - 直接输入自然语言
   * - 解析为 Intent
   * - 返回 DocOps
   */
  submitNaturalLanguage?(
    query: string,
    ast: DocumentAst,
    context?: AiContext
  ): Promise<{
    intent: AiIntent;
    ops: DocOp[];
    response: AiRuntimeResponse;
  }>;

  /**
   * 检查 AI 服务状态
   */
  getStatus(): Promise<{
    available: boolean;
    model?: string;
    error?: string;
  }>;
}

// ==========================================
// Stub 实现
// ==========================================

/**
 * AiRuntime 的 Stub 实现
 * 
 * 当前只代理到 DocOpsEngine，返回基本的操作。
 * 
 * 未来需要：
 * 1. 接入真实的 LLM API
 * 2. 实现自然语言解析
 * 3. 支持流式输出
 * 4. 管理对话上下文
 */
export class StubAiRuntime implements AiRuntime {
  private engine: DocOpsEngine;

  constructor(engine: DocOpsEngine = docOpsEngine) {
    this.engine = engine;
  }

  /**
   * 提交 Intent
   * 
   * 当前实现：直接代理到 DocOpsEngine
   * 
   * 未来实现：
   * 1. 检查 Intent 是否需要 LLM 处理
   * 2. 如果需要，调用 LLM API
   * 3. 解析 LLM 响应为 DocOps
   * 4. 返回操作序列
   */
  async submitIntent(intent: AiIntent, ast: DocumentAst): Promise<DocOp[]> {
    console.log('[AiRuntime] Submitting intent:', intent.type);

    try {
      const ops = await this.engine.generateOpsFromIntent(intent, ast);
      console.log(`[AiRuntime] Generated ${ops.length} ops`);
      return ops;
    } catch (error) {
      console.error('[AiRuntime] Error generating ops:', error);
      return [];
    }
  }

  /**
   * 自然语言处理（预留）
   */
  async submitNaturalLanguage(
    query: string,
    _ast: DocumentAst,
    _context?: AiContext
  ): Promise<{
    intent: AiIntent;
    ops: DocOp[];
    response: AiRuntimeResponse;
  }> {
    // TODO: 实现自然语言解析
    // 1. 调用 LLM 解析用户意图
    // 2. 转换为 AiIntent
    // 3. 生成 DocOps

    console.log('[AiRuntime] Natural language processing not implemented');
    console.log('[AiRuntime] Query:', query);

    // 返回空结果
    return {
      intent: {
        type: 'custom',
        payload: { custom: { rawQuery: query } },
      },
      ops: [],
      response: {
        success: false,
        error: 'Natural language processing not yet implemented',
      },
    };
  }

  /**
   * 获取运行时状态
   */
  async getStatus(): Promise<{
    available: boolean;
    model?: string;
    error?: string;
  }> {
    // TODO: 检查 LLM API 可用性
    return {
      available: false,
      error: 'AI Runtime is in stub mode. LLM integration not yet implemented.',
    };
  }
}

// 默认导出单例
export const aiRuntime = new StubAiRuntime();

