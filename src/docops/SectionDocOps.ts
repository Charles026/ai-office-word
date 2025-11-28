/**
 * SectionDocOps - 章节级文档操作 API
 * 
 * 为 DocAgent 提供统一的章节级文档操作接口。
 * 
 * 【职责】
 * - 获取文档大纲
 * - 获取章节文本 / HTML
 * - 替换章节 HTML
 * - 在章节末尾插入总结
 * 
 * 【设计原则】
 * - 所有操作通过编辑器命令执行，支持 Undo/Redo
 * - 操作是原子的，失败时抛出错误
 */

import { LexicalEditor, $getRoot, $createParagraphNode, $createTextNode, LexicalNode, $isElementNode, $isTextNode } from 'lexical';
import { $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { $generateNodesFromDOM } from '@lexical/html';
import { OutlineItem, Section, HeadingLevel } from '../document/section';

// ==========================================
// 类型定义
// ==========================================

export interface SectionDocOpsOptions {
  /** 编辑器实例 */
  editor: LexicalEditor;
}

export interface InsertSummaryOptions {
  /** 总结段落的样式 */
  style?: 'normal' | 'quote' | 'summaryBlock';
  /** 前缀文本 */
  prefix?: string;
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 从 Lexical 节点获取标题级别
 */
function getHeadingLevelFromNode(node: LexicalNode): HeadingLevel | null {
  if ($isHeadingNode(node)) {
    const tag = (node as HeadingNode).getTag();
    switch (tag) {
      case 'h1': return 1;
      case 'h2': return 2;
      case 'h3': return 3;
      default: return null;
    }
  }
  return null;
}

/**
 * 从编辑器获取所有块级节点信息
 */
interface BlockInfo {
  id: string;
  type: 'heading' | 'paragraph' | 'list' | 'other';
  headingLevel?: HeadingLevel;
  text: string;
  index: number;
}

function getBlocksFromEditor(editor: LexicalEditor): BlockInfo[] {
  const blocks: BlockInfo[] = [];
  
  editor.getEditorState().read(() => {
    const root = $getRoot();
    const children = root.getChildren();
    
    children.forEach((node, index) => {
      if (!$isElementNode(node)) return;
      
      const id = node.getKey();
      const text = node.getTextContent();
      
      if ($isHeadingNode(node)) {
        const level = getHeadingLevelFromNode(node);
        if (level) {
          blocks.push({
            id,
            type: 'heading',
            headingLevel: level,
            text,
            index,
          });
        }
      } else {
        const nodeType = node.getType();
        blocks.push({
          id,
          type: nodeType === 'paragraph' ? 'paragraph' : nodeType === 'list' ? 'list' : 'other',
          text,
          index,
        });
      }
    });
  });
  
  return blocks;
}

// ==========================================
// SectionDocOps 类
// ==========================================

export class SectionDocOps {
  private editor: LexicalEditor;

  constructor(options: SectionDocOpsOptions) {
    this.editor = options.editor;
  }

  /**
   * 获取文档大纲
   * 
   * @param minLevel - 最小标题级别（默认 2，即只获取 H2 及以下）
   * @returns OutlineItem[] - 大纲项列表
   */
  getOutline(minLevel: HeadingLevel = 2): OutlineItem[] {
    const blocks = getBlocksFromEditor(this.editor);
    const items: OutlineItem[] = [];
    let position = 0;

    for (const block of blocks) {
      if (block.type === 'heading' && block.headingLevel && block.headingLevel >= minLevel) {
        items.push({
          id: block.id,
          level: block.headingLevel,
          text: block.text,
          index: block.index,
        });
        position++;
      }
    }

    return items;
  }

  /**
   * 获取完整文档大纲（包括 H1）
   * 
   * @returns OutlineItem[] - 包含 H1、H2、H3 的大纲项列表
   */
  getFullOutline(): OutlineItem[] {
    return this.getOutline(1);
  }

  /**
   * 获取章节范围
   * 
   * @param headingId - 标题 ID
   * @returns Section | null - 章节信息
   */
  getSectionRange(headingId: string): Section | null {
    const blocks = getBlocksFromEditor(this.editor);
    
    // 找到目标 heading
    const startIndex = blocks.findIndex(b => b.id === headingId);
    if (startIndex === -1) return null;
    
    const startBlock = blocks[startIndex];
    if (startBlock.type !== 'heading' || !startBlock.headingLevel) return null;
    
    const headingLevel = startBlock.headingLevel;
    const paragraphIds: string[] = [headingId];
    
    // 向后扫描，找到章节结束位置
    let endIndex = blocks.length - 1;
    
    for (let i = startIndex + 1; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === 'heading' && block.headingLevel && block.headingLevel <= headingLevel) {
        endIndex = i - 1;
        break;
      }
      paragraphIds.push(block.id);
    }

    return {
      heading: {
        id: startBlock.id,
        level: headingLevel,
        text: startBlock.text,
        index: startIndex,
      },
      startIndex,
      endIndex,
      paragraphIds,
    };
  }

  /**
   * 获取章节纯文本内容（不含标题）
   * 
   * @param headingId - 标题 ID
   * @returns string | null - 章节纯文本
   */
  getSectionText(headingId: string): string | null {
    const section = this.getSectionRange(headingId);
    if (!section) return null;

    const blocks = getBlocksFromEditor(this.editor);
    const contentBlocks = blocks.slice(section.startIndex + 1, section.endIndex + 1);
    
    return contentBlocks.map(b => b.text).join('\n\n');
  }

  /**
   * 获取章节 HTML 内容（包含标题）
   * 
   * 用于「保格式翻译」：尽量保留 <b>、<i>、列表等 inline/块级结构。
   * 
   * @param headingId - 标题 ID
   * @param includeHeading - 是否包含标题（默认 true）
   * @returns string | null - 章节 HTML
   */
  getSectionHtml(headingId: string, includeHeading: boolean = true): string | null {
    const section = this.getSectionRange(headingId);
    if (!section) return null;

    let html = '';
    
    this.editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      
      const startIdx = includeHeading ? section.startIndex : section.startIndex + 1;
      const endIdx = section.endIndex + 1;
      
      const sectionNodes = children.slice(startIdx, endIdx);
      
      // 为每个节点生成 HTML
      const htmlParts: string[] = [];
      
      for (const node of sectionNodes) {
        if ($isElementNode(node)) {
          // 手动处理节点，生成 HTML
          const nodeType = node.getType();
          const textContent = node.getTextContent();
          
          if ($isHeadingNode(node)) {
            const tag = (node as HeadingNode).getTag();
            htmlParts.push(`<${tag}>${this.getNodeInnerHtml(node)}</${tag}>`);
          } else if (nodeType === 'paragraph') {
            htmlParts.push(`<p>${this.getNodeInnerHtml(node)}</p>`);
          } else if (nodeType === 'list') {
            // 列表需要特殊处理
            htmlParts.push(this.getListHtml(node));
          } else {
            htmlParts.push(`<p>${textContent}</p>`);
          }
        }
      }
      
      html = htmlParts.join('\n');
    });
    
    return html;
  }

  /**
   * 获取节点内部 HTML（处理格式化文本）
   */
  private getNodeInnerHtml(node: LexicalNode): string {
    if (!$isElementNode(node)) {
      return node.getTextContent();
    }

    const children = node.getChildren();
    let html = '';

    for (const child of children) {
      if ($isTextNode(child)) {
        let text = child.getTextContent();
        const format = child.getFormat();
        
        // 应用格式
        if (format & 1) text = `<b>${text}</b>`; // bold
        if (format & 2) text = `<i>${text}</i>`; // italic
        if (format & 4) text = `<s>${text}</s>`; // strikethrough
        if (format & 8) text = `<u>${text}</u>`; // underline
        if (format & 16) text = `<code>${text}</code>`; // code
        
        html += text;
      } else if ($isElementNode(child)) {
        // 递归处理子元素
        html += this.getNodeInnerHtml(child);
      }
    }

    return html;
  }

  /**
   * 获取列表节点的 HTML
   */
  private getListHtml(node: LexicalNode): string {
    // 简化实现：遍历列表项
    if (!$isElementNode(node)) return '';
    
    const children = node.getChildren();
    const items = children.map(child => {
      const text = $isElementNode(child) ? this.getNodeInnerHtml(child) : child.getTextContent();
      return `<li>${text}</li>`;
    }).join('\n');
    
    // 检测是有序还是无序列表
    const nodeType = node.getType();
    const tag = nodeType === 'number' ? 'ol' : 'ul';
    
    return `<${tag}>\n${items}\n</${tag}>`;
  }

  /**
   * 用新的 HTML 替换章节内容
   * 
   * 保持标题层级不变，替换标题后面的所有内容。
   * 
   * @param headingId - 标题 ID
   * @param newHtml - 新的 HTML 内容（应包含标题）
   */
  replaceSectionFromHtml(headingId: string, newHtml: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const section = this.getSectionRange(headingId);
      if (!section) {
        reject(new Error(`Section not found: ${headingId}`));
        return;
      }

      this.editor.update(() => {
        const root = $getRoot();
        const children = root.getChildren();
        
        // 获取当前章节的节点
        const headingNode = children[section.startIndex];
        const lastNodeInSection = children[section.endIndex];
        
        if (!headingNode || !lastNodeInSection) {
          throw new Error('Cannot find section nodes');
        }

        // 解析新的 HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(newHtml, 'text/html');
        const newNodes = $generateNodesFromDOM(this.editor, doc);
        
        if (newNodes.length === 0) {
          throw new Error('Failed to parse new HTML');
        }

        // 移除旧的内容节点（保留标题之后的节点，从标题后一个开始删除）
        for (let i = section.endIndex; i > section.startIndex; i--) {
          const nodeToRemove = children[i];
          if (nodeToRemove) {
            nodeToRemove.remove();
          }
        }

        // 分离标题和内容节点
        let newHeadingNode: LexicalNode | null = null;
        const contentNodes: LexicalNode[] = [];
        
        for (const node of newNodes) {
          if ($isHeadingNode(node) && !newHeadingNode) {
            newHeadingNode = node;
          } else if ($isElementNode(node)) {
            contentNodes.push(node);
          }
        }

        // 如果新 HTML 包含标题，更新标题文本
        if (newHeadingNode && $isHeadingNode(newHeadingNode) && $isHeadingNode(headingNode)) {
          const headingElement = headingNode as HeadingNode;
          const newHeadingElement = newHeadingNode as HeadingNode;
          
          // 清空旧标题内容
          const headingChildren = headingElement.getChildren();
          for (const child of headingChildren) {
            child.remove();
          }
          
          // 复制新标题的内容到旧标题
          const newHeadingChildren = newHeadingElement.getChildren();
          for (const child of newHeadingChildren) {
            headingElement.append(child);
          }
        }

        // 在标题后插入新内容
        let insertAfterNode = headingNode;
        for (const node of contentNodes) {
          insertAfterNode.insertAfter(node);
          insertAfterNode = node;
        }

        console.log('[SectionDocOps] Replaced section:', section.heading.text, 
          `(${contentNodes.length} new nodes)`);
      }, {
        tag: 'section-replace',
        onUpdate: () => resolve(),
      });
    });
  }

  /**
   * 在章节末尾插入总结段落
   * 
   * @param headingId - 标题 ID
   * @param summary - 总结文本
   * @param options - 插入选项
   */
  insertSectionSummary(
    headingId: string,
    summary: string,
    options: InsertSummaryOptions = {}
  ): Promise<void> {
    const { prefix = '📝 本节总结：' } = options;
    
    return new Promise((resolve, reject) => {
      const section = this.getSectionRange(headingId);
      if (!section) {
        reject(new Error(`Section not found: ${headingId}`));
        return;
      }

      this.editor.update(() => {
        const root = $getRoot();
        const children = root.getChildren();
        
        // 找到章节末尾的节点
        const lastNodeInSection = children[section.endIndex];
        if (!lastNodeInSection) {
          throw new Error('Cannot find last node in section');
        }

        // 创建总结段落
        const summaryParagraph = $createParagraphNode();
        
        // 添加前缀（加粗）
        const prefixText = $createTextNode(prefix);
        prefixText.setFormat('bold');
        summaryParagraph.append(prefixText);
        
        // 添加总结内容
        const contentText = $createTextNode(summary);
        summaryParagraph.append(contentText);
        
        // 给段落添加标记，便于后续识别
        // 注意：Lexical 原生不支持 data-attribute，这里用 CSS class 模拟
        // 实际可以通过自定义节点实现
        
        // 在章节末尾插入
        lastNodeInSection.insertAfter(summaryParagraph);
        
        console.log('[SectionDocOps] Inserted summary after section:', section.heading.text);
      }, { 
        tag: 'section-summary-insert',
        onUpdate: () => resolve(),
      });
    });
  }

  /**
   * 获取所有章节
   * 
   * @param includeH1 - 是否包含 H1 级别（默认 false，只获取 H2/H3）
   * @returns Section[] - 所有章节
   */
  getAllSections(includeH1: boolean = false): Section[] {
    const minLevel = includeH1 ? 1 : 2;
    const outline = this.getOutline(minLevel);
    const sections: Section[] = [];

    for (const item of outline) {
      const section = this.getSectionRange(item.id);
      if (section) {
        sections.push(section);
      }
    }

    return sections;
  }

  /**
   * 获取整个文档的 HTML（用于全文翻译）
   * 
   * @returns string - 文档完整 HTML
   */
  getFullDocumentHtml(): string {
    let html = '';
    
    this.editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      
      const htmlParts: string[] = [];
      
      for (const node of children) {
        if ($isElementNode(node)) {
          const nodeType = node.getType();
          
          if ($isHeadingNode(node)) {
            const tag = (node as HeadingNode).getTag();
            htmlParts.push(`<${tag}>${this.getNodeInnerHtml(node)}</${tag}>`);
          } else if (nodeType === 'paragraph') {
            htmlParts.push(`<p>${this.getNodeInnerHtml(node)}</p>`);
          } else if (nodeType === 'list') {
            htmlParts.push(this.getListHtml(node));
          } else {
            const text = node.getTextContent();
            if (text.trim()) {
              htmlParts.push(`<p>${text}</p>`);
            }
          }
        }
      }
      
      html = htmlParts.join('\n');
    });
    
    return html;
  }

  /**
   * 用新的 HTML 替换整个文档内容
   * 
   * @param newHtml - 新的 HTML 内容
   */
  replaceFullDocumentFromHtml(newHtml: string): Promise<void> {
    return new Promise((resolve) => {
      this.editor.update(() => {
        const root = $getRoot();
        
        // 清空当前内容
        root.clear();
        
        // 解析新的 HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(newHtml, 'text/html');
        const newNodes = $generateNodesFromDOM(this.editor, doc);
        
        if (newNodes.length === 0) {
          // 如果解析失败，至少保留一个空段落
          const emptyParagraph = $createParagraphNode();
          root.append(emptyParagraph);
          console.warn('[SectionDocOps] Failed to parse new HTML, created empty paragraph');
        } else {
          // 添加新节点
          for (const node of newNodes) {
            if ($isElementNode(node)) {
              root.append(node);
            }
          }
          console.log('[SectionDocOps] Replaced full document:', newNodes.length, 'nodes');
        }
      }, {
        tag: 'full-document-replace',
        onUpdate: () => resolve(),
      });
    });
  }
}

// ==========================================
// 工厂函数
// ==========================================

/**
 * 创建 SectionDocOps 实例
 */
export function createSectionDocOps(editor: LexicalEditor): SectionDocOps {
  return new SectionDocOps({ editor });
}

