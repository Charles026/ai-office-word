/**
 * DocOps Adapter
 * 
 * 负责将高层操作（SectionDocOp）转换为底层原子操作（DocOp）。
 */

import {
  DocOp,
  DocOpMeta,
  createOpMeta,
} from './types';
import {
  SectionDocOp,
  ReplaceParagraphOp,
  InsertParagraphAfterOp,
  DeleteParagraphOp,
} from './sectionDocOpsDiff';

/**
 * 将 SectionDocOp 转换为 DocOp 序列
 * 
 * @param sectionOps - 章节级操作列表
 * @param source - 操作来源（默认 'ai'）
 */
export function convertSectionOpsToDocOps(
  sectionOps: SectionDocOp[],
  source: DocOpMeta['source'] = 'ai'
): DocOp[] {
  const ops: DocOp[] = [];
  const meta = createOpMeta(source);

  for (const op of sectionOps) {
    switch (op.type) {
      case 'replace_paragraph':
        ops.push(...convertReplaceParagraph(op, meta));
        break;
      case 'insert_paragraph_after':
        ops.push(...convertInsertParagraphAfter(op, meta));
        break;
      case 'delete_paragraph':
        ops.push(...convertDeleteParagraph(op, meta));
        break;
    }
  }

  return ops;
}

function convertReplaceParagraph(op: ReplaceParagraphOp, meta: DocOpMeta): DocOp[] {
  // 使用新增加的 ReplaceBlockTextOp
  return [{
    type: 'ReplaceBlockText',
    payload: {
      nodeId: op.targetKey,
      text: op.newText,
    },
    meta,
  }];
}

function convertInsertParagraphAfter(op: InsertParagraphAfterOp, meta: DocOpMeta): DocOp[] {
  return [{
    type: 'InsertParagraph',
    payload: {
      afterNodeId: op.referenceKey,
      text: op.newText,
    },
    meta,
  }];
}

function convertDeleteParagraph(op: DeleteParagraphOp, meta: DocOpMeta): DocOp[] {
  return [{
    type: 'DeleteNode',
    payload: {
      nodeId: op.targetKey,
    },
    meta,
  }];
}
