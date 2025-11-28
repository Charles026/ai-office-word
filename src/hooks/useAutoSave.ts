/**
 * useAutoSave - Auto-save Hook
 * 
 * 【功能】
 * - 监听文档内容变化
 * - debounce 自动保存
 * - 管理保存状态
 * - 集成 DocumentSaveService
 * 
 * 【用法】
 * ```tsx
 * const { saveStatus, isDirty, lastSavedAt, triggerSave, forceSave } = useAutoSave({
 *   docId: activeTab?.id,
 *   content: editorContent,
 *   filePath: activeTab?.filePath,
 *   enabled: true,
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  documentSaveService, 
  DocumentSaveState, 
  SaveStatus, 
  SaveResult 
} from '../core/DocumentSaveService';
import { snapshotService } from '../core/SnapshotService';

// ==========================================
// 类型定义
// ==========================================

interface UseAutoSaveOptions {
  /** 文档 ID */
  docId?: string;
  /** 文档内容 */
  content?: unknown;
  /** 文件路径 */
  filePath?: string;
  /** 是否启用 Auto-save */
  enabled?: boolean;
  /** 内容变化回调（用于更新 Redux/Context 状态） */
  onDirtyChange?: (isDirty: boolean) => void;
  /** 保存成功回调 */
  onSaveSuccess?: (result: SaveResult) => void;
  /** 保存失败回调 */
  onSaveError?: (error: string) => void;
}

interface UseAutoSaveResult {
  /** 当前保存状态 */
  saveStatus: SaveStatus;
  /** 是否有未保存的修改 */
  isDirty: boolean;
  /** 最后保存时间 */
  lastSavedAt?: number;
  /** 最后错误信息 */
  lastError?: string;
  /** 触发保存（会 debounce） */
  triggerSave: (newContent: unknown) => void;
  /** 立即保存（不 debounce，手动保存用） */
  forceSave: (createSnapshot?: boolean) => Promise<SaveResult>;
}

// ==========================================
// Hook 实现
// ==========================================

export function useAutoSave(options: UseAutoSaveOptions): UseAutoSaveResult {
  const {
    docId,
    content,
    filePath,
    enabled = true,
    onDirtyChange,
    onSaveSuccess,
    onSaveError,
  } = options;

  // 状态
  const [saveState, setSaveState] = useState<DocumentSaveState>({
    docId: docId || '',
    status: 'idle',
    isDirty: false,
  });

  // Refs
  const contentRef = useRef(content);
  const lastDocIdRef = useRef(docId);

  // 更新 contentRef
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // 订阅 DocumentSaveService 状态变化
  useEffect(() => {
    if (!docId) return;

    const unsubscribe = documentSaveService.subscribe((state) => {
      if (state.docId === docId) {
        setSaveState(state);
        
        // 通知 dirty 状态变化
        if (onDirtyChange) {
          onDirtyChange(state.isDirty);
        }

        // 处理保存结果
        if (state.status === 'saved' && state.lastSavedAt) {
          onSaveSuccess?.({ ok: true, savedAt: state.lastSavedAt });
        } else if (state.status === 'error' && state.lastError) {
          onSaveError?.(state.lastError);
        }
      }
    });

    // 初始化状态
    setSaveState(documentSaveService.getState(docId));

    return () => {
      unsubscribe();
    };
  }, [docId, onDirtyChange, onSaveSuccess, onSaveError]);

  // 文档切换时清理
  useEffect(() => {
    if (lastDocIdRef.current && lastDocIdRef.current !== docId) {
      documentSaveService.cleanup(lastDocIdRef.current);
    }
    lastDocIdRef.current = docId;
  }, [docId]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (docId) {
        documentSaveService.cancelAutoSave(docId);
      }
    };
  }, [docId]);

  // 触发保存（会 debounce）
  const triggerSave = useCallback((newContent: unknown) => {
    if (!docId || !enabled) return;

    contentRef.current = newContent;
    documentSaveService.markDirty(docId, newContent, filePath);
  }, [docId, filePath, enabled]);

  // 立即保存（不 debounce）
  const forceSave = useCallback(async (createSnapshot: boolean = true): Promise<SaveResult> => {
    if (!docId) {
      return { ok: false, error: '没有打开的文档' };
    }

    // 取消 pending 的 auto-save
    documentSaveService.cancelAutoSave(docId);

    // 执行保存
    const result = await documentSaveService.saveNow(
      docId, 
      contentRef.current, 
      createSnapshot
    );

    // 如果成功且需要创建快照
    if (result.ok && createSnapshot && result.filePath) {
      try {
        await snapshotService.createSnapshot(docId, result.filePath);
      } catch (error) {
        console.error('[useAutoSave] Failed to create snapshot:', error);
        // 快照失败不影响保存结果
      }
    }

    return result;
  }, [docId]);

  return {
    saveStatus: saveState.status,
    isDirty: saveState.isDirty,
    lastSavedAt: saveState.lastSavedAt,
    lastError: saveState.lastError,
    triggerSave,
    forceSave,
  };
}

export default useAutoSave;

