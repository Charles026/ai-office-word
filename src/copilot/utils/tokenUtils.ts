/**
 * Token 估算工具
 * 
 * 【职责】
 * - 提供粗略的 token 数估算
 * - 定义 Full-Doc 模式的阈值常量
 * 
 * 【设计】
 * - 非精确估算：约 1 token ≈ 4 chars（适用于中英混合文本）
 * - 阈值可调整：默认 8000 tokens
 * 
 * @version 1.0.0
 */

// ==========================================
// 常量
// ==========================================

/**
 * Full-Doc 模式的 token 阈值
 * 
 * 当文档总 token 数低于此值时，启用 Full-Doc 模式（一次性提供全文给 LLM）
 * 当超过此值时，使用 chunked 模式（只提供结构和预览）
 * 
 * 默认值 8000 是考虑到：
 * - 大多数 LLM 支持 8k-32k context window
 * - System prompt + 用户指令大约占用 1-2k tokens
 * - 留出 6k+ tokens 给文档内容是合理的
 */
export const FULL_DOC_TOKEN_THRESHOLD = 8000;

/**
 * 字符到 token 的估算比例
 * 
 * 约 1 token ≈ 4 chars（适用于中英混合文本）
 * - 纯英文：约 4-5 chars/token
 * - 纯中文：约 1.5-2 chars/token
 * - 中英混合：约 3-4 chars/token
 */
export const CHARS_PER_TOKEN = 4;

// ==========================================
// 估算函数
// ==========================================

/**
 * 估算文本的 token 数
 * 
 * 这是一个非精确的估算，用于快速判断文档规模。
 * 实际 token 数可能因模型和语言而异。
 * 
 * @param text - 输入文本
 * @returns 估算的 token 数
 */
export function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 估算字符数对应的 token 数
 * 
 * 与 estimateTokensForText 相同的逻辑，但接受字符数而非字符串。
 * 用于已经统计好字符数的场景，避免重复遍历字符串。
 * 
 * @param charCount - 字符数
 * @returns 估算的 token 数
 */
export function estimateTokensForCharCount(charCount: number): number {
  if (charCount <= 0) return 0;
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/**
 * 判断文档是否适合 Full-Doc 模式
 * 
 * @param documentTokens - 文档的估算 token 数
 * @param threshold - 阈值（默认使用 FULL_DOC_TOKEN_THRESHOLD）
 * @returns true 表示可以使用 Full-Doc 模式
 */
export function isDocumentSmallEnoughForFullMode(
  documentTokens: number,
  threshold: number = FULL_DOC_TOKEN_THRESHOLD
): boolean {
  return documentTokens < threshold;
}

/**
 * 判断文档文本是否适合 Full-Doc 模式
 * 
 * 便捷方法，直接接受文本字符串。
 * 
 * @param text - 文档全文
 * @param threshold - 阈值（默认使用 FULL_DOC_TOKEN_THRESHOLD）
 * @returns true 表示可以使用 Full-Doc 模式
 */
export function isTextSmallEnoughForFullMode(
  text: string,
  threshold: number = FULL_DOC_TOKEN_THRESHOLD
): boolean {
  const tokens = estimateTokensForText(text);
  return isDocumentSmallEnoughForFullMode(tokens, threshold);
}

