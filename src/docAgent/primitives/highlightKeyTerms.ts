/**
 * HighlightKeyTerms Primitive
 * 
 * 【职责】
 * - 在指定 section 的词语/短语范围上应用 InlineMark 高亮
 * - 只生成 InlineMark DocOps，不直接修改文本样式
 * 
 * 【输入】
 * - sectionId: 目标 section
 * - terms: 词语列表（必须来自 CanonicalIntent，不做 fallback）
 * - style: 可选样式（'default' | 'bold' | 'underline' 等）
 * 
 * 【输出】
 * - 一组 apply_inline_mark DocOps
 * 
 * 【禁止】
 * - 本地 fallback 提词（CanonicalIntent 没给就跳过）
 * - 直接使用 Lexical bold/italic 命令
 * - 直接修改文本内容
 */

import type { LexicalEditor } from 'lexical';
import type { DocOp } from '../../docops/types';
import type { InlineMark, InlineMarkStyle } from '../../document/inlineMark';
import type {
  HighlightKeyTermsInput,
  HighlightKeyTermsOutput,
} from '../docEditTypes';
import {
  createInlineMarkFromPhrase,
} from '../../document/inlineMark';
import { extractSectionContext } from '../../runtime/context';

// ==========================================
// Primitive 执行器
// ==========================================

/**
 * 执行 HighlightKeyTerms Primitive
 * 
 * 严格信任 CanonicalIntent 提供的 terms，不做 fallback
 * 只生成 InlineMark DocOps，视觉样式由渲染层决定
 * 
 * @param editor - Lexical 编辑器实例
 * @param input - Primitive 输入（terms 必须由 CanonicalIntent 提供）
 * @returns Primitive 输出（marks + DocOps）
 */
export async function executeHighlightKeyTermsPrimitive(
  editor: LexicalEditor,
  input: HighlightKeyTermsInput
): Promise<HighlightKeyTermsOutput> {
  const { sectionId, terms, markKind = 'key_term', style = 'default' } = input;
  
  // 🔍 日志：显示要标记的词语和样式
  console.log('[Primitive:HighlightKeyTerms] 📝 要标记的词语:', terms.map(t => `"${t.phrase}"`).join(', '));
  console.log('[Primitive:HighlightKeyTerms] 样式:', style);
  console.log('[Primitive:HighlightKeyTerms] Executing with:', {
    sectionId,
    termCount: terms.length,
    style,
  });

  // 检查：如果没有 terms，直接返回（不做 fallback）
  if (!terms || terms.length === 0) {
    console.warn('[Primitive:HighlightKeyTerms] ⚠️ No terms provided by CanonicalIntent, skipping');
    return {
      marks: [],
      appliedOpsCount: 0,
      notFoundTerms: [],
    };
  }

  // 1. 获取 Section 上下文
  const sectionContext = extractSectionContext(editor, sectionId);
  if (!sectionContext) {
    console.error('[Primitive:HighlightKeyTerms] Section not found:', sectionId);
    return {
      marks: [],
      appliedOpsCount: 0,
      notFoundTerms: terms.map(t => t.phrase),
    };
  }

  // 2. 构建 section 纯文本
  const paragraphs = sectionContext.ownParagraphs || sectionContext.paragraphs || [];
  const sectionText = paragraphs.map(p => p.text).join('\n');
  
  console.log('[Primitive:HighlightKeyTerms] Section text length:', sectionText.length);

  // 3. 将 style 映射到 InlineMarkStyle
  const inlineMarkStyle = mapStyleToInlineMarkStyle(style);

  // 4. 为每个 term 创建 InlineMark
  const marks: InlineMark[] = [];
  const notFoundTerms: string[] = [];
  const ops: DocOp[] = [];

  for (const term of terms) {
    // markKind 映射到 InlineMarkKind
    const inlineMarkKind = markKind === 'important' ? 'key_term' : markKind;
    
    const mark = createInlineMarkFromPhrase(
      sectionId,
      sectionText,
      term.phrase,
      term.occurrence ?? 1,
      inlineMarkKind,
      inlineMarkStyle
    );

    if (mark) {
      // 如果 style 是 'bold'，在 meta 中标记
      if (style === 'bold') {
        mark.metadata = { ...mark.metadata, format: 'bold' };
      }
      
      marks.push(mark);
      
      // 创建 ApplyInlineMark DocOp
      const op: DocOp = {
        type: 'ApplyInlineMark',
        payload: { mark },
        meta: {
          source: 'ai',
          timestamp: Date.now(),
        },
      };
      ops.push(op);
      
      console.log('[Primitive:HighlightKeyTerms] ✅ Created mark for:', term.phrase);
    } else {
      notFoundTerms.push(term.phrase);
      console.warn('[Primitive:HighlightKeyTerms] ⚠️ Term not found in section:', term.phrase);
    }
  }

  console.log('[Primitive:HighlightKeyTerms] Created', marks.length, 'InlineMarks,', 
    notFoundTerms.length, 'not found');

  // 5. 应用 DocOps（通过 DocumentEngine）
  // TODO: 当 DocumentEngine 完全集成 InlineMark 后，这里调用 engine.applyOps(ops)
  if (ops.length > 0) {
    console.log('[Primitive:HighlightKeyTerms] Generated DocOps:', ops.length);
    // TODO: await documentEngine.applyOps(ops);
  }

  // ❌ 不再在 primitive 内部应用 bold
  // 视觉样式由渲染层根据 mark.style 和 mark.metadata.format 决定

  return {
    marks,
    appliedOpsCount: ops.length,
    notFoundTerms,
  };
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 将 CanonicalIntent 的 style 映射到 InlineMarkStyle
 */
function mapStyleToInlineMarkStyle(style: string): InlineMarkStyle {
  switch (style) {
    case 'bold':
      return 'highlight'; // InlineMark 用 highlight，渲染时根据 meta.format 决定是否加粗
    case 'underline':
      return 'underline';
    case 'background':
      return 'highlight';
    default:
      return 'highlight'; // 默认高亮
  }
}
