/**
 * extractSectionContext - 从 Document AST 中抽取 Section 上下文
 * 
 * 【职责】
 * - 定位指定 sectionId 对应的 H1/H2/H3 标题节点
 * - 提取该 section 下的所有段落内容
 * - 区分 ownParagraphs（直属段落）和 subtreeParagraphs（子树所有段落）
 * - 返回结构化的 SectionContext 供 DocAgentRuntime 使用
 * 
 * 【章节层级语义】(v1.1)
 * - H1: 文档根章节（文档标题），包含整篇文档的"导语"
 * - H2: 一级章节
 * - H3: 二级子章节
 * 
 * 【双层结构】
 * - ownParagraphs: 从标题后到第一个子标题之前的段落（导语）
 * - subtreeParagraphs: 整个子树的所有段落（包含子 H2/H3）
 * - childSections: 子 section 的元信息
 * 
 * 【设计原则】
 * - 纯函数，不修改 AST
 * - 只依赖 Lexical AST，不访问 UI/Editor/DOM
 * - 单次遍历，O(n) 复杂度
 * - 不做 AI 调用或 DocOps
 */

import { LexicalEditor, $getRoot, LexicalNode, $isElementNode } from 'lexical';
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text';
// import { $isListItemNode } from '@lexical/list';
import {
  SectionContext,
  SectionLevel,
  ParagraphInfo,
  ParagraphStyle,
  SectionContextError,
  ChildSectionMeta,
} from './types';

// ==========================================
// 开发模式标志
// ==========================================

const __DEV__ = process.env.NODE_ENV === 'development';

// ==========================================
// 辅助函数
// ==========================================

/**
 * 从 HeadingNode 的 tag 获取层级
 */
function getHeadingLevel(node: HeadingNode): SectionLevel | null {
  const tag = node.getTag();
  switch (tag) {
    case 'h1':
      return 1;
    case 'h2':
      return 2;
    case 'h3':
      return 3;
    default:
      return null;
  }
}

/**
 * 检查节点是否为标题节点
 */
function isHeadingNode(node: LexicalNode): node is HeadingNode {
  return $isHeadingNode(node);
}

/**
 * 获取节点的路径（从根到当前节点的 key 链）
 */
function getNodePath(node: LexicalNode): string[] {
  const path: string[] = [];
  let current: LexicalNode | null = node;
  
  while (current) {
    path.unshift(current.getKey());
    current = current.getParent();
  }
  
  return path;
}

/**
 * 判断是否为内容节点（段落、列表项、引用、代码块等）
 */
function isContentNode(node: LexicalNode): boolean {
  const type = node.getType();
  return (
    type === 'paragraph' ||
    type === 'listitem' ||
    type === 'list' ||
    type === 'quote' ||
    type === 'code' ||
    type === 'table' ||
    type === 'tablerow' ||
    type === 'tablecell'
  );
}

/**
 * 提取节点的样式信息
 * 
 * TODO: 完善样式提取逻辑
 */
function extractNodeStyle(node: LexicalNode): ParagraphStyle | undefined {
  // 目前只提取基础样式，后续可扩展
  if (!$isElementNode(node)) {
    return undefined;
  }

  const style: ParagraphStyle = {};
  
  // 尝试获取对齐方式
  const format = (node as any).getFormatType?.();
  if (format) {
    style.textAlign = format as ParagraphStyle['textAlign'];
  }

  // 如果没有任何样式，返回 undefined
  if (Object.keys(style).length === 0) {
    return undefined;
  }

  return style;
}

/**
 * 提取段落信息
 */
function extractParagraphInfo(node: LexicalNode): ParagraphInfo {
  return {
    nodeKey: node.getKey(),
    text: node.getTextContent(),
    nodePath: getNodePath(node),
    nodeType: node.getType(),
    style: extractNodeStyle(node),
  };
}

// ==========================================
// 主函数
// ==========================================

/**
 * 从 Document AST 中抽取 Section 上下文
 * 
 * @param editor - Lexical 编辑器实例
 * @param sectionId - 目标 section 的节点 ID（支持 H1/H2/H3）
 * @returns SectionContext - 结构化的 section 上下文
 * @throws SectionContextError - 当 sectionId 无效或节点类型不正确时
 */
export function extractSectionContext(
  editor: LexicalEditor,
  sectionId: string
): SectionContext {
  let result: SectionContext | null = null;
  let error: Error | null = null;

  editor.getEditorState().read(() => {
    try {
      const root = $getRoot();
      const blockNodes = root.getChildren();
      
      // 1. 定位标题节点
      let titleNodeIndex = -1;
      let titleNode: HeadingNode | null = null;
      
      for (let i = 0; i < blockNodes.length; i++) {
        const node = blockNodes[i];
        if (node.getKey() === sectionId) {
          if (!isHeadingNode(node)) {
            error = new SectionContextError(
              `节点 ${sectionId} 不是标题节点，实际类型: ${node.getType()}`,
              sectionId,
              'NOT_A_HEADING'
            );
            return;
          }
          titleNode = node;
          titleNodeIndex = i;
          break;
        }
      }

      if (!titleNode || titleNodeIndex === -1) {
        error = new SectionContextError(
          `未找到 sectionId: ${sectionId}`,
          sectionId,
          'SECTION_NOT_FOUND'
        );
        return;
      }

      // 2. 获取标题层级 (v1.1: 支持 H1/H2/H3)
      const level = getHeadingLevel(titleNode);
      if (level === null) {
        error = new SectionContextError(
          `无法识别的标题层级: ${titleNode.getTag()}，支持 H1/H2/H3`,
          sectionId,
          'INVALID_HEADING_LEVEL'
        );
        return;
      }

      // 3. 确定 section 结束位置
      let sectionEndIndex = blockNodes.length - 1;
      
      for (let i = titleNodeIndex + 1; i < blockNodes.length; i++) {
        const node = blockNodes[i];
        
        if (isHeadingNode(node)) {
          const nodeLevel = getHeadingLevel(node);
          
          // 遇到同级或更高级标题，section 结束
          // H2 遇到 H1/H2 结束
          // H3 遇到 H1/H2/H3 结束
          if (nodeLevel !== null && nodeLevel <= level) {
            sectionEndIndex = i - 1;
            break;
          }
        }
      }

      // 4. 收集段落信息，区分 own 和 subtree
      const ownParagraphs: ParagraphInfo[] = [];
      const subtreeParagraphs: ParagraphInfo[] = [];
      const childSections: ChildSectionMeta[] = [];
      const rawBlocks: LexicalNode[] = [];
      
      // 当前活跃的子 section（用于追踪）
      let activeChildSection: {
        meta: ChildSectionMeta;
        paragraphs: ParagraphInfo[];
      } | null = null;
      
      for (let i = titleNodeIndex + 1; i <= sectionEndIndex; i++) {
        const node = blockNodes[i];
        rawBlocks.push(node);
        
        // 检查是否为子级标题（H2 under H1, H3 under H2）
        if (isHeadingNode(node)) {
          const nodeLevel = getHeadingLevel(node);
          
          // 如果是直接子标题（level + 1）
          if (nodeLevel !== null && nodeLevel === level + 1) {
            // 结束上一个子 section
            if (activeChildSection) {
              activeChildSection.meta.endIndex = i - 1;
              activeChildSection.meta.ownParagraphCount = activeChildSection.paragraphs.length;
              activeChildSection.meta.totalParagraphCount = activeChildSection.paragraphs.length;
              childSections.push(activeChildSection.meta);
            }
            
            // 开始新的子 section
            activeChildSection = {
              meta: {
                sectionId: node.getKey(),
                level: nodeLevel as SectionLevel,
                titleText: node.getTextContent(),
                startIndex: i,
                endIndex: -1, // 稍后填充
                ownParagraphCount: 0,
                totalParagraphCount: 0,
              },
              paragraphs: [],
            };
            
            // 子标题本身也加入 subtree（作为结构标记）
            const headingInfo = extractParagraphInfo(node);
            subtreeParagraphs.push(headingInfo);
            continue;
          }
          
          // 遇到同级或更高级标题（不应该发生，因为 endIndex 已排除）
          if (nodeLevel !== null && nodeLevel <= level) {
            if (__DEV__) {
              console.warn(
                `[extractSectionContext] 意外遇到同级/更高级标题: ${node.getTextContent()}`
              );
            }
            break;
          }
          
          // v1.2: 其他子 heading（如 H4/H5/H6 或跳级的标题）
          // 不参与正文内容收集，也不触发 warning，静默跳过
          // TODO(copilot-sections): 后续可在这里构建更深层的 childSections 结构
          const headingInfo = extractParagraphInfo(node);
          subtreeParagraphs.push(headingInfo);
          continue;
        }
        
        // 收集内容节点
        if (isContentNode(node)) {
          const paragraphInfo = extractParagraphInfo(node);
          
          // 始终加入 subtree
          subtreeParagraphs.push(paragraphInfo);
          
          if (activeChildSection) {
            // 当前在子 section 内，加入子 section 的段落列表
            activeChildSection.paragraphs.push(paragraphInfo);
          } else {
            // 当前在直属区域（导语），加入 own
            ownParagraphs.push(paragraphInfo);
          }
        } else if (__DEV__) {
          // v1.2: 降级为 debug 日志，不使用 warn
          console.debug(
            `[extractSectionContext] 跳过未知节点类型: ${node.getType()}, key: ${node.getKey()}`
          );
        }
      }
      
      // 5. 结束最后一个子 section
      if (activeChildSection) {
        activeChildSection.meta.endIndex = sectionEndIndex;
        activeChildSection.meta.ownParagraphCount = activeChildSection.paragraphs.length;
        activeChildSection.meta.totalParagraphCount = activeChildSection.paragraphs.length;
        childSections.push(activeChildSection.meta);
      }

      // 6. 计算元信息
      const totalCharCount = subtreeParagraphs.reduce((sum, p) => sum + p.text.length, 0);

      // 7. 构建结果
      result = {
        sectionId,
        titleText: titleNode.getTextContent(),
        titleNodePath: getNodePath(titleNode),
        level: level as SectionLevel,
        
        // 双层段落结构
        ownParagraphs,
        subtreeParagraphs,
        childSections,
        
        // 向后兼容：paragraphs = ownParagraphs
        paragraphs: ownParagraphs,
        
        startIndex: titleNodeIndex,
        endIndex: sectionEndIndex,
        rawBlocks,
        meta: {
          paragraphCount: ownParagraphs.length,
          subtreeParagraphCount: subtreeParagraphs.length,
          childSectionCount: childSections.length,
          totalCharCount,
          extractedAt: Date.now(),
        },
      };

      // 开发模式日志
      if (__DEV__) {
        console.debug(
          `[SectionContext] sectionId=${sectionId}, level=${level}, ` +
          `own=${ownParagraphs.length}, subtree=${subtreeParagraphs.length}, ` +
          `childSections=${childSections.length}`
        );
      }
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }
  });

  // 在 read() 外部抛出错误
  if (error) {
    throw error;
  }

  if (!result) {
    throw new SectionContextError(
      `提取 section 上下文失败: ${sectionId}`,
      sectionId,
      'AST_ACCESS_ERROR'
    );
  }

  return result;
}

// ==========================================
// 便捷方法
// ==========================================

/**
 * 获取 section 的纯文本内容（不含标题）
 */
export function getSectionPlainText(context: SectionContext): string {
  return context.paragraphs.map(p => p.text).join('\n\n');
}

/**
 * 获取 section 的完整文本（含标题）
 */
export function getSectionFullText(context: SectionContext): string {
  // v1.1: 支持 H1/H2/H3
  const titlePrefixes: Record<number, string> = {
    1: '# ',
    2: '## ',
    3: '### ',
  };
  const titlePrefix = titlePrefixes[context.level] || '## ';
  return `${titlePrefix}${context.titleText}\n\n${getSectionPlainText(context)}`;
}

/**
 * 检查 section 是否为空（无段落内容）
 */
export function isSectionEmpty(context: SectionContext): boolean {
  return context.paragraphs.length === 0 || 
    context.paragraphs.every(p => p.text.trim() === '');
}

/**
 * 获取 section 的字符统计
 */
export function getSectionStats(context: SectionContext): {
  paragraphCount: number;
  charCount: number;
  wordCount: number;
} {
  const charCount = context.meta?.totalCharCount ?? 
    context.paragraphs.reduce((sum, p) => sum + p.text.length, 0);
  
  // 简单的中英文混合字数统计
  const text = getSectionPlainText(context);
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const wordCount = chineseChars + englishWords;

  return {
    paragraphCount: context.paragraphs.length,
    charCount,
    wordCount,
  };
}

