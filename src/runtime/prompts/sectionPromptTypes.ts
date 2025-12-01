/**
 * Section Prompt 类型定义
 * 
 * 【职责】
 * 定义 Prompt Builder 的输入/输出类型。
 * 
 * 【设计原则】
 * - 类型必须可 JSON 序列化
 * - 不包含 AST、DOM、Editor 相关对象
 * - metadata 只存元信息，不存大型结构
 */

import { AgentIntent } from '../intents/types';
import { SectionContext } from '../context/types';

// ==========================================
// Prompt 输入类型
// ==========================================

/**
 * Section Prompt 构建输入
 */
export interface SectionPromptInput {
  /** Agent Intent（已由 Intent Builder 构建） */
  intent: AgentIntent;
  /** Section 上下文（由 extractSectionContext 提取） */
  context: SectionContext;
  /** 文档 ID（可选，用于获取用户行为摘要） */
  docId?: string;
  /** Section ID（可选，用于 v2 行为摘要） */
  sectionId?: string;
  /** Section 标题（可选，用于 v2 行为摘要） */
  sectionTitle?: string;
}

// ==========================================
// Prompt 输出类型
// ==========================================

/**
 * 构建完成的 Prompt
 */
export interface BuiltPrompt {
  /** System Prompt - 模型行为规范 */
  system: string;
  /** User Prompt - 结构化内容 + 任务指令 */
  user: string;
  /** 元数据（仅用于日志和调试，不发送给 LLM） */
  metadata?: PromptMetadata;
}

/**
 * Prompt 元数据
 */
export interface PromptMetadata {
  /** Section ID */
  sectionId: string;
  /** Section 层级（2=H2, 3=H3） */
  sectionLevel: number;
  /** 段落数量 */
  paragraphCount: number;
  /** 估算的 token 数量 */
  estimatedTokens: number;
  /** Prompt 构建时间 */
  builtAt?: number;
  /** Intent Kind */
  intentKind?: string;
}

// ==========================================
// LLM 输出结构（用于解析）
// ==========================================

/**
 * LLM 返回的段落结构
 */
export interface LlmParagraphOutput {
  /** 段落索引 */
  index: number;
  /** 段落文本 */
  text: string;
}

/**
 * LLM 返回的完整结构
 */
export interface LlmSectionOutput {
  /** 段落列表 */
  paragraphs: LlmParagraphOutput[];
}

// ==========================================
// 内部类型（用于 Prompt 构建）
// ==========================================

/**
 * 简化的段落数据（用于 Prompt）
 */
export interface SimplifiedParagraph {
  /** 段落索引 */
  index: number;
  /** 段落文本 */
  text: string;
}

/**
 * 简化的 Section 数据（用于 Prompt）
 */
export interface SimplifiedSection {
  /** 标题文本 */
  title: string;
  /** 层级 */
  level: number;
  /** 段落列表 */
  paragraphs: SimplifiedParagraph[];
}

/**
 * Prompt 构建模式
 */
export type PromptMode = 'rewrite' | 'summarize' | 'expand' | 'highlight';

