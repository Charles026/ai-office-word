/**
 * DocAgent Primitives - 原子能力模块
 * 
 * 每个 primitive 是一个可复用的原子能力：
 * - RewriteSection: 根据 LLM 输出重写段落
 * - HighlightKeyTerms: 对词语应用 InlineMark 高亮
 * - HighlightKeySentences: 对句子应用高亮
 * - AppendSummary: 追加摘要
 * 
 * 所有 DocEdit 命令都是这些 primitive 的组合。
 */

export {
  executeHighlightKeyTermsPrimitive,
} from './highlightKeyTerms';

export {
  executeHighlightSpansPrimitive,
} from './highlightSpans';

