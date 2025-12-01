/**
 * HighlightSpans Primitive
 * 
 * 【职责】
 * - 通用高亮能力，替代 HighlightKeyTerms / HighlightKeySentences
 * - 根据 target 类型分发到具体实现
 * - 始终通过 DocOps + DocumentEngine 实现，不直接修改 Lexical
 * 
 * 【输入】
 * - sectionId: 目标 section
 * - target: 高亮目标 ('key_terms', 'key_sentences', ...)
 * - style: 视觉样式
 * - terms: 词语列表 (target='key_terms')
 * 
 * 【输出】
 * - InlineMark DocOps (语义标记)
 * - ToggleBold DocOps (视觉加粗，当 style='bold' 时)
 * 
 * 【重要约束】
 * 后续和「重点词加粗」相关的实现，一律通过 DocOps + DocumentEngine 完成，
 * 不要直接在 primitive 里调用 Lexical 的 FORMAT_TEXT_COMMAND 或手动创建 selection。
 * 可以用 Lexical 做「range 解析」，但"真正的加粗"必须走已有的 DocOps 类型。
 */

import type { LexicalEditor } from 'lexical';
import type { DocOp } from '../../docops/types';
import { createOpMeta } from '../../docops/types';
import type { InlineMark, InlineMarkStyle, TextAnchor } from '../../document/inlineMark';
import type {
  HighlightSpansInput,
  HighlightSpansOutput,
} from '../docEditTypes';
import {
  createInlineMarkFromPhrase,
} from '../../document/inlineMark';
import { documentRuntime } from '../../document';
import { extractSectionContext } from '../../runtime/context';

// ==========================================
// Primitive 执行器
// ==========================================

/**
 * 执行 HighlightSpans Primitive
 * 
 * 通用高亮入口
 */
export async function executeHighlightSpansPrimitive(
  editor: LexicalEditor,
  input: HighlightSpansInput
): Promise<HighlightSpansOutput> {
  const { target } = input;
  
  console.log('[Primitive:HighlightSpans] Executing for target:', target);

  switch (target) {
    case 'key_terms':
      return executeHighlightKeyTerms(editor, input);
    case 'key_sentences':
      console.warn('[Primitive:HighlightSpans] Target "key_sentences" not yet implemented');
      return createEmptyResult();
    case 'risks':
    case 'metrics':
    case 'custom':
      console.warn(`[Primitive:HighlightSpans] Target "${target}" not yet implemented`);
      return createEmptyResult();
    default:
      console.warn(`[Primitive:HighlightSpans] Unknown target "${target}"`);
      return createEmptyResult();
  }
}

// ==========================================
// 具体实现：Highlight Key Terms
// ==========================================

async function executeHighlightKeyTerms(
  editor: LexicalEditor,
  input: HighlightSpansInput
): Promise<HighlightSpansOutput> {
  const { sectionId, terms, style = 'default' } = input;
  
  // 🔍 日志：显示要标记的词语和样式
  console.log('[Primitive:HighlightSpans] 📝 要标记的词语:', terms?.map(t => `"${t.phrase}"`).join(', ') || 'None');
  console.log('[Primitive:HighlightSpans] 样式:', style);

  // 检查：如果没有 terms，直接返回（不做 fallback）
  if (!terms || terms.length === 0) {
    console.warn('[Primitive:HighlightSpans] ⚠️ No terms provided by CanonicalIntent, skipping');
    return createEmptyResult();
  }

  // 1. 获取 Section 上下文
  const sectionContext = extractSectionContext(editor, sectionId);
  if (!sectionContext) {
    console.error('[Primitive:HighlightSpans] Section not found:', sectionId);
    return {
      marks: [],
      appliedOpsCount: 0,
      notFoundTargets: terms.map(t => t.phrase),
    };
  }

  // 2. 构建 section 纯文本
  const paragraphs = sectionContext.ownParagraphs || sectionContext.paragraphs || [];
  const sectionText = paragraphs.map(p => p.text).join('\n');
  
  // 3. 将 style 映射到 InlineMarkStyle
  const inlineMarkStyle = mapStyleToInlineMarkStyle(style);

  // 4. 构建段落偏移映射（用于将 section offset 转换为 block offset）
  const paragraphOffsetMap = buildParagraphOffsetMap(paragraphs);
  console.log('[Primitive:HighlightSpans] 📊 Paragraph offset map:', paragraphOffsetMap);
  
  // 5. 为每个 term 创建 InlineMark 和对应的 DocOps
  const marks: InlineMark[] = [];
  const notFoundTargets: string[] = [];
  const inlineMarkOps: DocOp[] = [];
  const boldOps: DocOp[] = [];

  for (const term of terms) {
    const mark = createInlineMarkFromPhrase(
      sectionId,
      sectionText,
      term.phrase,
      term.occurrence ?? 1,
      'key_term',
      inlineMarkStyle
    );

    if (mark) {
      // 如果 style 是 'bold'，在 meta 中标记
      if (style === 'bold') {
        mark.meta = { ...mark.meta, format: 'bold' };
      }
      
      marks.push(mark);
      
      // 创建 ApplyInlineMark DocOp（语义标记）
      const inlineMarkOp: DocOp = {
        type: 'ApplyInlineMark',
        payload: { mark },
        meta: createOpMeta('ai'),
      };
      inlineMarkOps.push(inlineMarkOp);
      
      // 🆕 如果 style='bold'，创建 ToggleBold DocOp（视觉加粗）
      if (style === 'bold') {
        const boldOpsForTerm = buildBoldOpsFromAnchor(mark.anchor, paragraphOffsetMap);
        boldOps.push(...boldOpsForTerm);
        
        if (boldOpsForTerm.length > 0) {
          console.log('[Primitive:HighlightSpans] 🔵 Created ToggleBold op for:', term.phrase);
        } else {
          console.warn('[Primitive:HighlightSpans] ⚠️ Failed to create ToggleBold op for:', term.phrase);
        }
      }
      
      console.log('[Primitive:HighlightSpans] ✅ Created mark for:', term.phrase, 
        'anchor:', mark.anchor.startOffset, '->', mark.anchor.endOffset);
    } else {
      notFoundTargets.push(term.phrase);
      console.warn('[Primitive:HighlightSpans] ⚠️ Term not found in section:', term.phrase);
    }
  }

  console.log('[Primitive:HighlightSpans] Created', marks.length, 'InlineMarks,', 
    notFoundTargets.length, 'not found');

  // 6. 合并所有 DocOps 并一次性应用
  const allOps = [...inlineMarkOps, ...boldOps];
  
  console.log('[Primitive:HighlightSpans] 📦 Applying %d InlineMarks, %d bold ops', 
    inlineMarkOps.length, boldOps.length);

  if (allOps.length > 0) {
    console.log('[Primitive:HighlightSpans] Applying DocOps via DocumentRuntime:', allOps.length);
    
    try {
      const success = documentRuntime.applyDocOps(allOps);
      if (success) {
        console.log('[Primitive:HighlightSpans] ✅ DocOps applied successfully');
      } else {
        console.warn('[Primitive:HighlightSpans] ⚠️ DocOps application returned false');
      }
    } catch (error) {
      console.error('[Primitive:HighlightSpans] Failed to apply DocOps:', error);
    }
  }

  console.log(
    '[Primitive:HighlightSpans] ✅ Applied %d InlineMarks, %d bold ops',
    inlineMarkOps.length,
    boldOps.length
  );

  return {
    marks,
    appliedOpsCount: allOps.length,
    notFoundTargets,
  };
}

// ==========================================
// 辅助函数
// ==========================================

function createEmptyResult(): HighlightSpansOutput {
  return {
    marks: [],
    appliedOpsCount: 0,
    notFoundTargets: [],
  };
}

/**
 * 段落偏移映射条目
 * 
 * 用于将 section 级别的 offset 转换为 block 级别的 offset
 */
interface ParagraphOffsetEntry {
  /** Document AST 中的 block ID (nodeKey) */
  nodeKey: string;
  /** 该段落在 section 纯文本中的起始偏移 */
  startOffset: number;
  /** 该段落在 section 纯文本中的结束偏移 */
  endOffset: number;
  /** 段落文本长度 */
  textLength: number;
}

/**
 * 从 ParagraphInfo 数组构建段落偏移映射
 * 
 * @param paragraphs - 段落信息数组
 * @returns 段落偏移映射
 */
function buildParagraphOffsetMap(paragraphs: Array<{ nodeKey: string; text: string }>): ParagraphOffsetEntry[] {
  const entries: ParagraphOffsetEntry[] = [];
  let currentOffset = 0;
  
  for (const p of paragraphs) {
    const textLength = p.text.length;
    entries.push({
      nodeKey: p.nodeKey,
      startOffset: currentOffset,
      endOffset: currentOffset + textLength,
      textLength,
    });
    currentOffset += textLength + 1; // +1 for newline between paragraphs
  }
  
  return entries;
}

/**
 * 🆕 从 TextAnchor 构建 ToggleBold DocOps
 * 
 * 复用工具栏加粗的 DocOps 管线（ToggleBold）
 * 
 * 【关键】
 * - TextAnchor 使用的是相对于整个 section 的偏移
 * - ToggleBold 需要的是 nodeId (block ID) 和相对于该 block 的偏移
 * - 这里做的就是这个转换
 * 
 * @param anchor - 文本锚点（section 级别的 offset）
 * @param paragraphMap - 段落偏移映射（用于转换为 block 级别的 offset）
 * @returns ToggleBold DocOps 数组
 */
function buildBoldOpsFromAnchor(
  anchor: TextAnchor,
  paragraphMap: ParagraphOffsetEntry[]
): DocOp[] {
  const ops: DocOp[] = [];
  
  console.log('[buildBoldOpsFromAnchor] 🔍 anchor:', {
    sectionId: anchor.sectionId,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
  });
  
  // 找到包含起始位置的段落
  let startParagraph: ParagraphOffsetEntry | null = null;
  let endParagraph: ParagraphOffsetEntry | null = null;
  
  for (const entry of paragraphMap) {
    // 检查起始位置是否在此段落内
    if (anchor.startOffset >= entry.startOffset && anchor.startOffset < entry.endOffset) {
      startParagraph = entry;
      console.log('[buildBoldOpsFromAnchor] Found start paragraph:', entry.nodeKey, 
        `(${entry.startOffset}-${entry.endOffset})`);
    }
    // 检查结束位置是否在此段落内
    if (anchor.endOffset > entry.startOffset && anchor.endOffset <= entry.endOffset) {
      endParagraph = entry;
      console.log('[buildBoldOpsFromAnchor] Found end paragraph:', entry.nodeKey,
        `(${entry.startOffset}-${entry.endOffset})`);
    }
  }
  
  if (!startParagraph) {
    console.warn('[buildBoldOpsFromAnchor] ⚠️ Could not find paragraph for startOffset:', anchor.startOffset);
    return ops;
  }
  
  if (!endParagraph) {
    console.warn('[buildBoldOpsFromAnchor] ⚠️ Could not find paragraph for endOffset:', anchor.endOffset);
    return ops;
  }
  
  // 如果起始和结束在同一个段落，创建一个 ToggleBold op
  if (startParagraph.nodeKey === endParagraph.nodeKey) {
    const blockStartOffset = anchor.startOffset - startParagraph.startOffset;
    const blockEndOffset = anchor.endOffset - startParagraph.startOffset;
    
    ops.push({
      type: 'ToggleBold',
      payload: {
        nodeId: startParagraph.nodeKey,
        startOffset: blockStartOffset,
        endOffset: blockEndOffset,
        force: true, // 强制加粗，不是切换
      },
      meta: createOpMeta('ai'),
    });
    
    console.log('[buildBoldOpsFromAnchor] ✅ Created ToggleBold op:', {
      nodeId: startParagraph.nodeKey,
      startOffset: blockStartOffset,
      endOffset: blockEndOffset,
    });
  } else {
    // 跨段落的情况：需要为每个涉及的段落创建单独的 op
    console.warn('[buildBoldOpsFromAnchor] ⚠️ Cross-paragraph bold not yet supported:', 
      startParagraph.nodeKey, '->', endParagraph.nodeKey);
    
    // TODO: 实现跨段落加粗
    // 1. 第一个段落：从 startOffset 到段落末尾
    // 2. 中间段落：整个段落
    // 3. 最后一个段落：从段落开头到 endOffset
  }
  
  return ops;
}

/**
 * 将 CanonicalIntent 的 style 映射到 InlineMarkStyle
 */
function mapStyleToInlineMarkStyle(style: string): InlineMarkStyle {
  switch (style) {
    case 'bold':
      return 'highlight'; // InlineMark 用 highlight，视觉加粗通过 ToggleBold DocOp 实现
    case 'underline':
      return 'underline';
    case 'background':
      return 'highlight';
    default:
      return 'highlight'; // 默认高亮
  }
}
