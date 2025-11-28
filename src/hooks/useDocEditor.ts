/**
 * useDocEditor - 文档编辑器状态管理 Hook
 * 
 * 管理当前激活文档的编辑状态：
 * - HTML 内容加载
 * - 保存操作
 * - 错误处理
 * - 缓存机制
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ==========================================
// 类型定义
// ==========================================

interface DocEditorState {
  /** HTML 内容 */
  html: string | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否正在保存 */
  saving: boolean;
  /** 错误信息 */
  error: EditorError | null;
  /** LibreOffice 是否可用 */
  libreOfficeAvailable: boolean | null;
}

interface EditorError {
  code: string;
  message: string;
  details?: string;
}

interface OpenFileTab {
  id: string;
  filePath: string;
  fileName: string;
  kind: 'docx';
}

// ==========================================
// Hook 实现
// ==========================================

export function useDocEditor(activeTab: OpenFileTab | null) {
  // 状态
  const [state, setState] = useState<DocEditorState>({
    html: null,
    loading: false,
    saving: false,
    error: null,
    libreOfficeAvailable: null,
  });

  // 缓存：存储已加载文档的 HTML
  const htmlCache = useRef<Map<string, string>>(new Map());

  // 当前加载的文件路径（用于防止竞态）
  const currentLoadingPath = useRef<string | null>(null);

  /**
   * 检查 LibreOffice 可用性
   */
  const checkLibreOfficeStatus = useCallback(async () => {
    try {
      const status = await window.aiEditor.getStatus();
      setState(prev => ({
        ...prev,
        libreOfficeAvailable: status.libreOfficeAvailable,
      }));
      return status.libreOfficeAvailable;
    } catch (error) {
      console.error('[useDocEditor] Failed to check LibreOffice status:', error);
      setState(prev => ({
        ...prev,
        libreOfficeAvailable: false,
      }));
      return false;
    }
  }, []);

  /**
   * 加载文档
   */
  const loadDocument = useCallback(async (filePath: string) => {
    // 检查缓存
    const cached = htmlCache.current.get(filePath);
    if (cached) {
      setState(prev => ({
        ...prev,
        html: cached,
        loading: false,
        error: null,
      }));
      return;
    }

    // 设置加载状态
    currentLoadingPath.current = filePath;
    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const result = await window.aiEditor.openDocxForEdit(filePath);
      
      // 检查是否仍然是当前请求
      if (currentLoadingPath.current !== filePath) {
        return; // 已经切换到其他文档
      }

      // 缓存 HTML
      htmlCache.current.set(filePath, result.html);

      setState(prev => ({
        ...prev,
        html: result.html,
        loading: false,
        error: null,
      }));

      console.log(`[useDocEditor] Loaded document: ${filePath}`);
    } catch (error: any) {
      // 检查是否仍然是当前请求
      if (currentLoadingPath.current !== filePath) {
        return;
      }

      console.error('[useDocEditor] Failed to load document:', error);

      setState(prev => ({
        ...prev,
        html: null,
        loading: false,
        error: {
          code: error.code || 'UNKNOWN_ERROR',
          message: error.message || '加载文档失败',
          details: error.details,
        },
      }));
    }
  }, []);

  /**
   * 保存文档
   */
  const saveDocument = useCallback(async (filePath: string, html: string) => {
    setState(prev => ({ ...prev, saving: true }));

    try {
      await window.aiEditor.saveDocx(filePath, html);
      
      // 更新缓存
      htmlCache.current.set(filePath, html);

      setState(prev => ({
        ...prev,
        html,
        saving: false,
        error: null,
      }));

      console.log(`[useDocEditor] Saved document: ${filePath}`);
      return true;
    } catch (error: any) {
      console.error('[useDocEditor] Failed to save document:', error);

      setState(prev => ({
        ...prev,
        saving: false,
        error: {
          code: error.code || 'UNKNOWN_ERROR',
          message: error.message || '保存文档失败',
          details: error.details,
        },
      }));

      return false;
    }
  }, []);

  /**
   * 清除错误
   */
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  /**
   * 清除缓存
   */
  const clearCache = useCallback((filePath?: string) => {
    if (filePath) {
      htmlCache.current.delete(filePath);
    } else {
      htmlCache.current.clear();
    }
  }, []);

  /**
   * 强制重新加载当前文档
   */
  const reloadDocument = useCallback(async () => {
    if (activeTab) {
      // 清除当前文档的缓存
      htmlCache.current.delete(activeTab.filePath);
      await loadDocument(activeTab.filePath);
    }
  }, [activeTab, loadDocument]);

  // 初始化：检查 LibreOffice 状态
  useEffect(() => {
    checkLibreOfficeStatus();
  }, [checkLibreOfficeStatus]);

  // 当 activeTab 变化时加载文档
  useEffect(() => {
    if (activeTab && state.libreOfficeAvailable) {
      loadDocument(activeTab.filePath);
    } else if (!activeTab) {
      // 清除状态
      currentLoadingPath.current = null;
      setState(prev => ({
        ...prev,
        html: null,
        loading: false,
        error: null,
      }));
    }
  }, [activeTab, state.libreOfficeAvailable, loadDocument]);

  return {
    // 状态
    html: state.html,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    libreOfficeAvailable: state.libreOfficeAvailable,
    
    // 操作
    loadDocument,
    saveDocument,
    reloadDocument,
    clearError,
    clearCache,
    checkLibreOfficeStatus,
  };
}

export default useDocEditor;

