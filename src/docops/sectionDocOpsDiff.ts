/**
 * Section DocOps Diff Writer
 * 
 * 【职责】
 * 将 LLM 返回的新段落数组与旧的 SectionContext.paragraphs 进行对齐，
 * 生成一组稳定、安全、可应用的 DocOps。
 * 
 * 【设计原则】
 * - 纯函数：不做 AST 改写，不做 UI 逻辑
 * - 只构造 DocOps 列表，不执行
 * - 使用 nodePath 精准定位，不自己构造 DOM path
 * - 支持 rewrite/summarize/expand 三种模式
 * 
 * 【未来扩展 TODO】
 * - 支持 style diff（字体、颜色等）
 * - 支持 blockquote / list 等特殊段落结构 diff
 * - 支持 semantic diff（按句子、按 token）
 * - 支持 AST patch preview（DevTools 预览）
 */

import { SectionContext, ParagraphInfo } from '../runtime/context/types';
import { AgentKind } from '../runtime/intents/types';

// ==========================================
// 开发模式标志
// ==========================================

const __DEV__ = process.env.NODE_ENV === 'development';

// ==========================================
// DocOps 类型定义（Section Diff 专用）
// ==========================================

/**
 * 替换段落操作
 */
export interface ReplaceParagraphOp {
  type: 'replace_paragraph';
  /** 目标段落的 nodePath */
  targetPath: string[];
  /** 目标段落的 nodeKey */
  targetKey: string;
  /** 新文本内容 */
  newText: string;
  /** 是否保持原样式 */
  preserveStyle: boolean;
  /** 段落索引（用于排序） */
  index: number;
}

/**
 * 在段落后插入新段落操作
 */
export interface InsertParagraphAfterOp {
  type: 'insert_paragraph_after';
  /** 参考段落的 nodePath */
  referencePath: string[];
  /** 参考段落的 nodeKey */
  referenceKey: string;
  /** 新段落文本 */
  newText: string;
  /** 样式（可选） */
  style?: unknown;
  /** 插入索引（用于排序） */
  index: number;
}

/**
 * 删除段落操作
 */
export interface DeleteParagraphOp {
  type: 'delete_paragraph';
  /** 目标段落的 nodePath */
  targetPath: string[];
  /** 目标段落的 nodeKey */
  targetKey: string;
  /** 段落索引（用于排序，删除时倒序） */
  index: number;
}

/**
 * Section DocOps 联合类型
 */
export type SectionDocOp = 
  | ReplaceParagraphOp 
  | InsertParagraphAfterOp 
  | DeleteParagraphOp;

// ==========================================
// 输入类型
// ==========================================

/**
 * LLM 返回的段落结构
 */
export interface LlmParagraph {
  /** 段落索引（从 0 开始） */
  index: number;
  /** 段落文本 */
  text: string;
}

/**
 * Diff 模式
 */
export type DiffMode = 'rewrite' | 'summarize' | 'expand';

/**
 * Diff 选项
 */
export interface DiffOptions {
  /** Diff 模式（根据 Intent Kind 确定） */
  mode: DiffMode;
  /** 是否严格模式（开发环境默认 true） */
  strict?: boolean;
}

// ==========================================
// 错误类型
// ==========================================

/**
 * Diff 错误
 */
export class SectionDiffError extends Error {
  constructor(
    message: string,
    public readonly sectionId: string,
    public readonly oldLength: number,
    public readonly newLength: number,
    public readonly mode: DiffMode
  ) {
    super(message);
    this.name = 'SectionDiffError';
  }
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 从 Intent Kind 获取 Diff 模式
 */
export function getDiffModeFromIntent(kind: AgentKind): DiffMode {
  switch (kind) {
    case 'rewrite_section':
    case 'rewrite':
      return 'rewrite';
    case 'summarize_section':
    case 'summarize':
      return 'summarize';
    case 'expand_section':
      return 'expand';
    default:
      return 'rewrite';
  }
}

/**
 * 验证 newParagraphs 格式
 */
function validateNewParagraphs(
  newParagraphs: LlmParagraph[],
  sectionId: string
): void {
  // 检查是否为数组
  if (!Array.isArray(newParagraphs)) {
    throw new SectionDiffError(
      'newParagraphs 必须是数组',
      sectionId,
      0,
      0,
      'rewrite'
    );
  }

  // 检查 index 是否从 0 开始且递增
  for (let i = 0; i < newParagraphs.length; i++) {
    const p = newParagraphs[i];
    
    if (typeof p.index !== 'number') {
      throw new SectionDiffError(
        `newParagraphs[${i}].index 必须是数字`,
        sectionId,
        0,
        newParagraphs.length,
        'rewrite'
      );
    }

    if (p.index !== i) {
      throw new SectionDiffError(
        `newParagraphs[${i}].index 必须等于 ${i}，实际值: ${p.index}`,
        sectionId,
        0,
        newParagraphs.length,
        'rewrite'
      );
    }

    if (typeof p.text !== 'string') {
      throw new SectionDiffError(
        `newParagraphs[${i}].text 必须是字符串`,
        sectionId,
        0,
        newParagraphs.length,
        'rewrite'
      );
    }
  }
}

/**
 * 验证 rewrite 模式的段落数一致性
 * 
 * 注意：现在 rewrite_section 使用修复层（repairRewriteSectionParagraphs）
 * 来确保段落数一致，因此这里只做断言检查，不再抛出用户可见的错误。
 * 
 * @param strict - 是否在不一致时抛出错误（用于测试）
 */
function validateRewriteMode(
  oldLength: number,
  newLength: number,
  sectionId: string,
  strict: boolean = __DEV__
): void {
  if (oldLength !== newLength) {
    // 如果到达这里，说明修复层没有正常工作，记录错误
    const message = `[SectionDiffWriter] rewrite_section 段落数不一致（应由修复层处理），` +
      `sectionId: ${sectionId}, old: ${oldLength}, new: ${newLength}`;
    
    console.error(message);
    
    // strict 模式下抛出错误（用于测试或开发调试）
    if (strict) {
      throw new SectionDiffError(
        `rewrite_section 模式要求段落数一致，旧: ${oldLength}，新: ${newLength}（修复层未正常工作）`,
        sectionId,
        oldLength,
        newLength,
        'rewrite'
      );
    }
  }
}

/**
 * 验证 summarize 模式的段落数
 */
function validateSummarizeMode(
  oldLength: number,
  newLength: number,
  sectionId: string,
  strict: boolean
): void {
  if (newLength > oldLength) {
    const message = `summarize_section 模式不允许新段落数大于旧段落数，旧: ${oldLength}，新: ${newLength}`;
    
    if (strict) {
      throw new SectionDiffError(message, sectionId, oldLength, newLength, 'summarize');
    } else {
      console.warn(`[SectionDiffWriter] ${message}`);
    }
  }
}

/**
 * 比较两段文本是否相同
 */
function isTextEqual(oldText: string, newText: string): boolean {
  // 去除首尾空白后比较
  return oldText.trim() === newText.trim();
}

/**
 * 对 DocOps 进行排序
 * 
 * 排序规则：
 * 1. 所有 replace 按 index 正序
 * 2. 所有 insert 按 index 正序
 * 3. 所有 delete 按 index 倒序（从后往前删）
 */
function sortDocOps(ops: SectionDocOp[]): SectionDocOp[] {
  const replaceOps: ReplaceParagraphOp[] = [];
  const insertOps: InsertParagraphAfterOp[] = [];
  const deleteOps: DeleteParagraphOp[] = [];

  for (const op of ops) {
    switch (op.type) {
      case 'replace_paragraph':
        replaceOps.push(op);
        break;
      case 'insert_paragraph_after':
        insertOps.push(op);
        break;
      case 'delete_paragraph':
        deleteOps.push(op);
        break;
    }
  }

  // 排序
  replaceOps.sort((a, b) => a.index - b.index);
  insertOps.sort((a, b) => a.index - b.index);
  deleteOps.sort((a, b) => b.index - a.index); // 倒序

  // 合并：replace → insert → delete
  return [...replaceOps, ...insertOps, ...deleteOps];
}

// ==========================================
// 核心 Diff 函数
// ==========================================

/**
 * 构建 rewrite 模式的 DocOps
 * 
 * 注意：调用此函数前应该先通过 repairRewriteSectionParagraphs 修复段落数组，
 * 确保 newParagraphs.length === oldParagraphs.length
 */
function buildRewriteDocOps(
  oldParagraphs: ParagraphInfo[],
  newParagraphs: LlmParagraph[],
  sectionId: string,
  strict: boolean
): SectionDocOp[] {
  // 验证段落数一致性（如果修复层正常工作，这里不会触发）
  validateRewriteMode(oldParagraphs.length, newParagraphs.length, sectionId, strict);

  const ops: SectionDocOp[] = [];

  // 只处理有效的段落对
  const minLength = Math.min(oldParagraphs.length, newParagraphs.length);

  for (let i = 0; i < minLength; i++) {
    const oldP = oldParagraphs[i];
    const newP = newParagraphs[i];

    // 安全检查：确保 newP 存在
    if (!newP || typeof newP.text !== 'string') {
      continue;
    }

    // 文本相同则跳过
    if (isTextEqual(oldP.text, newP.text)) {
      continue;
    }

    // 生成 replace 操作
    ops.push({
      type: 'replace_paragraph',
      targetPath: oldP.nodePath,
      targetKey: oldP.nodeKey,
      newText: newP.text,
      preserveStyle: true,
      index: i,
    });
  }

  return ops;
}

/**
 * 构建 summarize 模式的 DocOps
 */
function buildSummarizeDocOps(
  oldParagraphs: ParagraphInfo[],
  newParagraphs: LlmParagraph[],
  sectionId: string,
  strict: boolean
): SectionDocOp[] {
  validateSummarizeMode(oldParagraphs.length, newParagraphs.length, sectionId, strict);

  const ops: SectionDocOp[] = [];
  const minLen = Math.min(oldParagraphs.length, newParagraphs.length);

  // 1. 处理前 min(len_old, len_new) 部分
  for (let i = 0; i < minLen; i++) {
    const oldP = oldParagraphs[i];
    const newP = newParagraphs[i];

    if (!isTextEqual(oldP.text, newP.text)) {
      ops.push({
        type: 'replace_paragraph',
        targetPath: oldP.nodePath,
        targetKey: oldP.nodeKey,
        newText: newP.text,
        preserveStyle: true,
        index: i,
      });
    }
  }

  // 2. 删除多余的旧段落
  if (oldParagraphs.length > newParagraphs.length) {
    for (let i = newParagraphs.length; i < oldParagraphs.length; i++) {
      const oldP = oldParagraphs[i];
      ops.push({
        type: 'delete_paragraph',
        targetPath: oldP.nodePath,
        targetKey: oldP.nodeKey,
        index: i,
      });
    }
  }

  // 3. 如果 new > old（不应该发生），在非严格模式下忽略
  // 严格模式下在 validateSummarizeMode 中已抛出异常

  return ops;
}

/**
 * 构建 expand 模式的 DocOps
 */
function buildExpandDocOps(
  oldParagraphs: ParagraphInfo[],
  newParagraphs: LlmParagraph[],
  sectionId: string
): SectionDocOp[] {
  const ops: SectionDocOp[] = [];

  // 1. 处理前 old.length 部分
  for (let i = 0; i < oldParagraphs.length; i++) {
    const oldP = oldParagraphs[i];
    const newP = newParagraphs[i];

    // 如果新段落不存在（不应该发生），跳过
    if (!newP) {
      if (__DEV__) {
        console.warn(
          `[SectionDiffWriter] expand 模式下 newParagraphs[${i}] 不存在，跳过`
        );
      }
      continue;
    }

    if (!isTextEqual(oldP.text, newP.text)) {
      ops.push({
        type: 'replace_paragraph',
        targetPath: oldP.nodePath,
        targetKey: oldP.nodeKey,
        newText: newP.text,
        preserveStyle: true,
        index: i,
      });
    }
  }

  // 2. 添加新段落
  if (newParagraphs.length > oldParagraphs.length) {
    // 获取最后一个旧段落作为参考点
    const lastOldP = oldParagraphs[oldParagraphs.length - 1];
    
    // TODO: 如果 section 原本是空段落（极少出现），需要特殊处理
    if (!lastOldP) {
      if (__DEV__) {
        console.warn(
          `[SectionDiffWriter] section ${sectionId} 没有旧段落，无法插入新段落`
        );
      }
      return ops;
    }

    for (let i = oldParagraphs.length; i < newParagraphs.length; i++) {
      const newP = newParagraphs[i];
      ops.push({
        type: 'insert_paragraph_after',
        referencePath: lastOldP.nodePath,
        referenceKey: lastOldP.nodeKey,
        newText: newP.text,
        index: i,
      });
    }
  }

  return ops;
}

// ==========================================
// 主函数
// ==========================================

/**
 * 构建 Section DocOps Diff
 * 
 * 将 LLM 返回的新段落数组与旧的 SectionContext.paragraphs 进行对齐，
 * 生成一组稳定、安全、可应用的 DocOps。
 * 
 * @param context - Section 上下文（来自 extractSectionContext）
 * @param newParagraphs - LLM 返回的新段落数组
 * @param options - Diff 选项
 * @returns DocOps 数组
 * 
 * @example
 * ```ts
 * const context = extractSectionContext(editor, sectionId);
 * const intent = buildRewriteSectionIntent(context);
 * const prompt = buildSectionPrompt({ intent, context });
 * const llmResponse = await llm.chat(prompt);
 * const newParagraphs = JSON.parse(llmResponse).paragraphs;
 * 
 * const docOps = buildSectionDocOpsDiff(context, newParagraphs, {
 *   mode: getDiffModeFromIntent(intent.kind),
 * });
 * 
 * // 然后由 Runtime 执行 docOps
 * ```
 */
export function buildSectionDocOpsDiff(
  context: SectionContext,
  newParagraphs: LlmParagraph[],
  options: DiffOptions
): SectionDocOp[] {
  const { mode, strict = __DEV__ } = options;
  const { sectionId, paragraphs: oldParagraphs } = context;

  // 0. 强校验：newParagraphs 必须是数组
  if (newParagraphs === undefined || newParagraphs === null) {
    const errorMsg = `[SectionDocOpsDiff] newParagraphs is ${newParagraphs}, sectionId: ${sectionId}`;
    console.error(errorMsg);
    
    if (strict) {
      throw new SectionDiffError(
        'newParagraphs 是 undefined 或 null',
        sectionId,
        oldParagraphs?.length ?? 0,
        0,
        mode
      );
    }
    // 非 strict 模式返回空数组
    return [];
  }

  if (!Array.isArray(newParagraphs)) {
    const rawValue = JSON.stringify(newParagraphs).slice(0, 200);
    const errorMsg = `[SectionDocOpsDiff] newParagraphs is not an array, type: ${typeof newParagraphs}, value: ${rawValue}`;
    console.error(errorMsg);
    
    if (strict) {
      throw new SectionDiffError(
        `newParagraphs 不是数组，类型: ${typeof newParagraphs}`,
        sectionId,
        oldParagraphs?.length ?? 0,
        0,
        mode
      );
    }
    // 非 strict 模式返回空数组
    return [];
  }

  // 1. 验证输入（详细校验每个元素）
  validateNewParagraphs(newParagraphs, sectionId);

  // 2. 边界检查：空旧段落 + 非空新段落
  // TODO: 暂时警告，未来需要支持
  if (oldParagraphs.length === 0 && newParagraphs.length > 0) {
    if (__DEV__) {
      console.warn(
        `[SectionDiffWriter] section ${sectionId} 没有旧段落，但有 ${newParagraphs.length} 个新段落`
      );
    }
    return [];
  }

  // 3. 根据模式构建 DocOps
  let ops: SectionDocOp[];

  switch (mode) {
    case 'rewrite':
      ops = buildRewriteDocOps(oldParagraphs, newParagraphs, sectionId, strict);
      break;
    case 'summarize':
      ops = buildSummarizeDocOps(oldParagraphs, newParagraphs, sectionId, strict);
      break;
    case 'expand':
      ops = buildExpandDocOps(oldParagraphs, newParagraphs, sectionId);
      break;
    default:
      ops = buildRewriteDocOps(oldParagraphs, newParagraphs, sectionId, strict);
  }

  // 4. 排序 DocOps
  const sortedOps = sortDocOps(ops);

  // 5. 开发模式日志
  if (__DEV__) {
    console.debug('[SectionDiffWriter]', {
      sectionId,
      mode,
      oldLength: oldParagraphs.length,
      newLength: newParagraphs.length,
      replaceCount: sortedOps.filter(op => op.type === 'replace_paragraph').length,
      insertCount: sortedOps.filter(op => op.type === 'insert_paragraph_after').length,
      deleteCount: sortedOps.filter(op => op.type === 'delete_paragraph').length,
    });
  }

  return sortedOps;
}

// ==========================================
// 便捷方法
// ==========================================

/**
 * 从 Intent Kind 构建 DocOps Diff
 */
export function buildSectionDocOpsDiffFromIntent(
  context: SectionContext,
  newParagraphs: LlmParagraph[],
  intentKind: AgentKind
): SectionDocOp[] {
  return buildSectionDocOpsDiff(context, newParagraphs, {
    mode: getDiffModeFromIntent(intentKind),
  });
}

/**
 * 统计 DocOps
 */
export function countDocOps(ops: SectionDocOp[]): {
  replace: number;
  insert: number;
  delete: number;
  total: number;
} {
  const replace = ops.filter(op => op.type === 'replace_paragraph').length;
  const insert = ops.filter(op => op.type === 'insert_paragraph_after').length;
  const del = ops.filter(op => op.type === 'delete_paragraph').length;

  return {
    replace,
    insert,
    delete: del,
    total: replace + insert + del,
  };
}

/**
 * 检查 DocOps 是否为空（无需修改）
 */
export function isDocOpsEmpty(ops: SectionDocOp[]): boolean {
  return ops.length === 0;
}

