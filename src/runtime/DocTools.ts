/**
 * DocTools - DocAgent 可调用的工具集合
 * 
 * 【职责】
 * - 提供纯函数形式的工具，供 DocAgent 调用
 * - 每个工具职责单一，可独立测试
 * - 不包含 UI 逻辑
 * 
 * 【工具分类】
 * - 选区工具：获取选区文本、上下文
 * - 编辑工具：应用 patch、替换文本
 * - LLM 工具：调用大模型
 * - 文档工具：保存、读取文档状态
 */

import { LlmService, LlmResponse } from './LlmService';

// ==========================================
// 类型定义
// ==========================================

/** 编辑操作 */
export interface EditOperation {
  type: 'replace' | 'insert' | 'delete';
  /** 起始位置（字符索引） */
  start?: number;
  /** 结束位置（字符索引） */
  end?: number;
  /** 新内容 */
  content?: string;
}

/** 选区上下文 */
export interface SelectionContext {
  /** 选区文本 */
  selectionText: string;
  /** 选区前的文本（上下文） */
  beforeText: string;
  /** 选区后的文本（上下文） */
  afterText: string;
  /** 选区所在段落类型 */
  paragraphType?: 'paragraph' | 'heading' | 'list';
}

/** LLM 调用选项 */
export interface LlmCallOptions {
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户消息 */
  userMessage: string;
  /** 温度（可选） */
  temperature?: number;
  /** 最大 tokens（可选） */
  maxTokens?: number;
}

// ==========================================
// 选区工具
// ==========================================

/**
 * 截断文本到指定长度
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * 提取选区上下文
 * 
 * @param fullText - 完整文档文本
 * @param selectionStart - 选区起始位置
 * @param selectionEnd - 选区结束位置
 * @param contextChars - 上下文字符数
 */
export function extractSelectionContext(
  fullText: string,
  selectionStart: number,
  selectionEnd: number,
  contextChars: number = 200
): SelectionContext {
  const selectionText = fullText.slice(selectionStart, selectionEnd);
  const beforeText = truncateText(
    fullText.slice(Math.max(0, selectionStart - contextChars), selectionStart),
    contextChars
  );
  const afterText = truncateText(
    fullText.slice(selectionEnd, selectionEnd + contextChars),
    contextChars
  );

  return {
    selectionText,
    beforeText,
    afterText,
  };
}

/**
 * 验证选区文本
 */
export function validateSelectionText(text: string): { valid: boolean; error?: string } {
  if (!text) {
    return { valid: false, error: '选区为空' };
  }
  if (!text.trim()) {
    return { valid: false, error: '选区只包含空白字符' };
  }
  if (text.length > 5000) {
    return { valid: false, error: `选区文本过长（${text.length} 字符），最大支持 5000 字符` };
  }
  return { valid: true };
}

// ==========================================
// 编辑工具
// ==========================================

/**
 * 应用编辑操作到文本
 * 
 * @param originalText - 原始文本
 * @param edits - 编辑操作列表（按位置从后往前排序）
 */
export function applyEdits(originalText: string, edits: EditOperation[]): string {
  // 按位置从后往前排序，避免位置偏移
  const sortedEdits = [...edits].sort((a, b) => (b.start || 0) - (a.start || 0));
  
  let result = originalText;
  
  for (const edit of sortedEdits) {
    switch (edit.type) {
      case 'replace':
        if (edit.start !== undefined && edit.end !== undefined && edit.content !== undefined) {
          result = result.slice(0, edit.start) + edit.content + result.slice(edit.end);
        }
        break;
      case 'insert':
        if (edit.start !== undefined && edit.content !== undefined) {
          result = result.slice(0, edit.start) + edit.content + result.slice(edit.start);
        }
        break;
      case 'delete':
        if (edit.start !== undefined && edit.end !== undefined) {
          result = result.slice(0, edit.start) + result.slice(edit.end);
        }
        break;
    }
  }
  
  return result;
}

/**
 * 创建替换编辑操作
 */
export function createReplaceEdit(start: number, end: number, content: string): EditOperation {
  return { type: 'replace', start, end, content };
}

/**
 * 创建插入编辑操作
 */
export function createInsertEdit(position: number, content: string): EditOperation {
  return { type: 'insert', start: position, content };
}

// ==========================================
// LLM 工具
// ==========================================

/**
 * 调用 LLM
 */
export async function callLLM(
  llmService: LlmService,
  options: LlmCallOptions
): Promise<LlmResponse> {
  const messages = [
    { role: 'system' as const, content: options.systemPrompt },
    { role: 'user' as const, content: options.userMessage },
  ];

  return llmService.chat(messages);
}

/**
 * 检查 LLM 服务是否可用
 */
export function checkLlmAvailability(llmService: LlmService): { available: boolean; error?: string } {
  if (!llmService.isAvailable()) {
    return {
      available: false,
      error: 'AI 服务未配置。请设置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 环境变量。',
    };
  }
  return { available: true };
}

// ==========================================
// 日志工具
// ==========================================

export interface DocAgentLog {
  timestamp: number;
  action: string;
  intent?: string;
  inputLength?: number;
  outputLength?: number;
  latencyMs?: number;
  success: boolean;
  error?: string;
}

const logs: DocAgentLog[] = [];
const MAX_LOGS = 100;

/**
 * 记录 DocAgent 操作日志
 */
export function logDocAgentAction(log: Omit<DocAgentLog, 'timestamp'>): void {
  const entry: DocAgentLog = {
    ...log,
    timestamp: Date.now(),
  };
  
  logs.push(entry);
  
  // 限制日志数量
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  
  // 输出到控制台
  const prefix = log.success ? '✓' : '✗';
  console.log(`[DocAgent] ${prefix} ${log.action}`, {
    intent: log.intent,
    inputLength: log.inputLength,
    outputLength: log.outputLength,
    latencyMs: log.latencyMs,
    error: log.error,
  });
}

/**
 * 获取最近的日志
 */
export function getRecentLogs(count: number = 10): DocAgentLog[] {
  return logs.slice(-count);
}

/**
 * 清空日志
 */
export function clearLogs(): void {
  logs.length = 0;
}

