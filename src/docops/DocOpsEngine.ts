/**
 * DocOpsEngine - 将 Intent 转换为 DocOps
 * 
 * 【层级职责】
 * DocOps Engine 层负责：
 * - 接收 AI Intent
 * - 生成对应的原子文档操作 (DocOp[])
 * - 不直接修改文档
 * 
 * 【禁止事项】
 * - 不允许在此层直接调用 LLM API（通过 Runtime 代理）
 * - 不允许在此层修改 DocumentAst
 * - 不允许在此层访问文件系统
 * 
 * 【未来实现】
 * - 基于 LLM 的智能操作生成
 * - 复杂意图的分解和组合
 * - 操作优化和合并
 */

import { DocOp, DocSelection, createOpMeta } from './types';
import { DocumentAst, getBlockText, getBlockIndex, isSameBlockSelection } from '../document/types';
import { AiIntent } from '../runtime/types';

// ==========================================
// DocOpsEngine 接口
// ==========================================

export interface DocOpsEngine {
  /**
   * 从 Intent 生成 DocOps
   * 
   * @param intent - AI 意图
   * @param ast - 当前文档 AST（只读，用于上下文）
   * @returns 生成的操作序列
   */
  generateOpsFromIntent(intent: AiIntent, ast: DocumentAst): Promise<DocOp[]>;

  /**
   * 为选区改写生成 DocOps
   * 
   * 策略：
   * 1. DeleteRange - 删除选区内的文本
   * 2. InsertText - 在选区起点插入新文本
   * 
   * @param ast - 当前文档 AST
   * @param selection - 选区
   * @param newText - AI 生成的新文本
   * @returns DocOps 数组
   */
  buildOpsForRewriteSelection(
    ast: DocumentAst,
    selection: DocSelection,
    newText: string
  ): DocOp[];
}

// ==========================================
// Stub 实现
// ==========================================

/**
 * DocOpsEngine 的 Stub 实现
 * 
 * 当前只返回空数组或简单的硬编码示例。
 * 未来需要：
 * 1. 接入 LLM 进行意图理解和操作生成
 * 2. 使用 function calling / tools 来生成结构化的 DocOps
 * 3. 支持多轮对话和上下文理解
 */
export class StubDocOpsEngine implements DocOpsEngine {
  /**
   * 为选区改写生成 DocOps
   * 
   * 【策略】
   * 同一 block 内选区：
   * 1. DeleteRange - 删除 [anchorOffset, focusOffset] 范围
   * 2. InsertText - 在 anchorOffset 位置插入 newText
   * 
   * 跨 block 选区（TODO）：
   * 暂不支持，返回空数组
   */
  buildOpsForRewriteSelection(
    ast: DocumentAst,
    selection: DocSelection,
    newText: string
  ): DocOp[] {
    console.log('[DocOpsEngine] Building ops for rewrite selection');

    // 跨 block 选区暂不支持
    if (!isSameBlockSelection(selection)) {
      console.warn('[DocOpsEngine] Cross-block selection rewrite not yet supported');
      // TODO: 实现跨 block 选区的改写
      // 需要：删除多个 block 的部分内容，可能需要合并 block
      return [];
    }

    const meta = createOpMeta('ai');
    const ops: DocOp[] = [];

    // 确保 start <= end
    const startOffset = Math.min(selection.anchorOffset, selection.focusOffset);
    const endOffset = Math.max(selection.anchorOffset, selection.focusOffset);

    // 验证 block 存在
    const blockIndex = getBlockIndex(ast, selection.anchorNodeId);
    if (blockIndex === -1) {
      console.error('[DocOpsEngine] Block not found:', selection.anchorNodeId);
      return [];
    }

    // Step 1: 删除选区内容
    if (startOffset !== endOffset) {
      ops.push({
        type: 'DeleteRange',
        payload: {
          startNodeId: selection.anchorNodeId,
          startOffset,
          endNodeId: selection.anchorNodeId,
          endOffset,
        },
        meta,
      });
    }

    // Step 2: 插入新文本
    if (newText.length > 0) {
      ops.push({
        type: 'InsertText',
        payload: {
          nodeId: selection.anchorNodeId,
          offset: startOffset,
          text: newText,
        },
        meta,
      });
    }

    console.log(`[DocOpsEngine] Generated ${ops.length} ops for rewrite`);
    return ops;
  }

  async generateOpsFromIntent(intent: AiIntent, ast: DocumentAst): Promise<DocOp[]> {
    console.log('[DocOpsEngine] Generating ops for intent:', intent.type);

    const meta = createOpMeta('ai');

    switch (intent.type) {
      case 'insert_text': {
        // TODO: 未来基于 LLM 生成内容
        const text = intent.payload.prompt ?? 'AI 生成的文本（待实现）';
        const lastBlock = ast.blocks[ast.blocks.length - 1];
        
        if (lastBlock) {
          return [{
            type: 'InsertText',
            payload: {
              nodeId: lastBlock.id,
              offset: getBlockText(lastBlock).length,
              text: ' ' + text,
            },
            meta,
          }];
        }
        return [];
      }

      case 'insert_section': {
        // TODO: 生成带标题的新段落
        return [{
          type: 'InsertParagraph',
          payload: {
            afterNodeId: ast.blocks[ast.blocks.length - 1]?.id ?? null,
            text: '新章节（AI 待实现）',
          },
          meta,
        }];
      }

      case 'format_bold': {
        if (intent.selection && !intent.selection.isCollapsed) {
          return [{
            type: 'ToggleBold',
            payload: {
              nodeId: intent.selection.anchorNodeId,
              startOffset: intent.selection.anchorOffset,
              endOffset: intent.selection.focusOffset,
              force: true,
            },
            meta,
          }];
        }
        return [];
      }

      case 'format_heading': {
        const level = intent.payload.headingLevel ?? 1;
        if (intent.selection) {
          return [{
            type: 'SetHeadingLevel',
            payload: {
              nodeId: intent.selection.anchorNodeId,
              level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6,
            },
            meta,
          }];
        }
        return [];
      }

      case 'delete_selection': {
        if (intent.selection && !intent.selection.isCollapsed) {
          return [{
            type: 'DeleteRange',
            payload: {
              startNodeId: intent.selection.anchorNodeId,
              startOffset: intent.selection.anchorOffset,
              endNodeId: intent.selection.focusNodeId,
              endOffset: intent.selection.focusOffset,
            },
            meta,
          }];
        }
        return [];
      }

      case 'rewrite':
      case 'summarize':
      case 'expand':
      case 'translate':
      case 'fix_grammar':
      case 'change_tone':
        console.log(`[DocOpsEngine] Intent "${intent.type}" requires LLM - not implemented`);
        return [];

      default:
        console.log(`[DocOpsEngine] Unknown intent type: ${intent.type}`);
        return [];
    }
  }
}

// 默认导出单例
export const docOpsEngine = new StubDocOpsEngine();
