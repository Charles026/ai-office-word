/**
 * Section 局部快照存储
 * 
 * 【职责】
 * - 维护 Section 操作前的状态快照
 * - 用于支持 Copilot 操作的撤销 (Undo)
 * 
 * 【设计原则】
 * - 内存存储 (In-memory)，不持久化
 * - 按 snapshotId 索引
 * - 提供简单的增删查接口
 */

import { ParagraphContext } from '../runtime/context/types';

// ==========================================
// 快照类型
// ==========================================

export interface SectionSnapshot {
  /** 快照 ID */
  id: string;
  /** 文档 ID */
  docId: string;
  /** 章节 ID */
  sectionId: string;
  /** 创建时间 */
  createdAt: number;
  /** 快照内容：操作前的段落列表 */
  paragraphs: ParagraphContext[];
}

// ==========================================
// 存储实现 (内存)
// ==========================================

const snapshots = new Map<string, SectionSnapshot>();

// ==========================================
// 导出 API
// ==========================================

/**
 * 创建 Section 快照
 */
export function createSectionSnapshot(args: {
  docId: string;
  sectionId: string;
  paragraphs: ParagraphContext[];
}): string {
  const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  
  const snapshot: SectionSnapshot = {
    id,
    docId: args.docId,
    sectionId: args.sectionId,
    createdAt: Date.now(),
    paragraphs: args.paragraphs,
  };

  snapshots.set(id, snapshot);
  console.log('[CopilotSnapshots] Created snapshot:', id, 'for section:', args.sectionId);
  
  return id;
}

/**
 * 获取 Section 快照
 */
export function getSectionSnapshot(snapshotId: string): SectionSnapshot | null {
  return snapshots.get(snapshotId) || null;
}

/**
 * 删除 Section 快照
 */
export function deleteSectionSnapshot(snapshotId: string): void {
  if (snapshots.delete(snapshotId)) {
    console.log('[CopilotSnapshots] Deleted snapshot:', snapshotId);
  }
}

/**
 * 清理指定文档的所有快照（可选，用于文档关闭时清理）
 */
export function clearDocSnapshots(docId: string): void {
  for (const [id, snap] of snapshots.entries()) {
    if (snap.docId === docId) {
      snapshots.delete(id);
    }
  }
  console.log('[CopilotSnapshots] Cleared snapshots for doc:', docId);
}

