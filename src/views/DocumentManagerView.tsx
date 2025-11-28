/**
 * 传统文档管理视图
 * 
 * 【功能】
 * - 左侧目录/空间
 * - 右侧本地文档列表
 * - 双击打开、删除、重命名
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useAppContext } from '../store';
import { LocalDocMeta, getFileExt } from '../store/types';
import './DocumentManagerView.css';

// ==========================================
// Icons
// ==========================================

const DocxIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <rect x="2" y="1" width="16" height="18" rx="2" fill="#2B579A"/>
    <text x="10" y="12" textAnchor="middle" fill="white" fontSize="6" fontWeight="600">W</text>
  </svg>
);

const ExcelIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <rect x="2" y="1" width="16" height="18" rx="2" fill="#217346"/>
    <text x="10" y="12" textAnchor="middle" fill="white" fontSize="6" fontWeight="600">X</text>
  </svg>
);

const PptIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <rect x="2" y="1" width="16" height="18" rx="2" fill="#D24726"/>
    <text x="10" y="12" textAnchor="middle" fill="white" fontSize="6" fontWeight="600">P</text>
  </svg>
);

const PdfIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <rect x="2" y="1" width="16" height="18" rx="2" fill="#FF0000"/>
    <text x="10" y="12" textAnchor="middle" fill="white" fontSize="5" fontWeight="600">PDF</text>
  </svg>
);

const TxtIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <rect x="2" y="1" width="16" height="18" rx="2" fill="#6B7280"/>
    <text x="10" y="12" textAnchor="middle" fill="white" fontSize="6" fontWeight="600">TXT</text>
  </svg>
);

const FolderIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6L7.5 4.5H12.5C13.33 4.5 14 5.17 14 6V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V4.5Z" fill="currentColor"/>
  </svg>
);

const RefreshIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M8 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M4 4h8M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 6v6a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ==========================================
// Helper
// ==========================================

function getDocIcon(ext: LocalDocMeta['ext']): React.ReactNode {
  switch (ext) {
    case 'docx': return <DocxIcon />;
    case 'xlsx': return <ExcelIcon />;
    case 'pptx': return <PptIcon />;
    case 'pdf': return <PdfIcon />;
    case 'txt':
    case 'md':
      return <TxtIcon />;
    default: return <TxtIcon />;
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ==========================================
// Component
// ==========================================

export const DocumentManagerView: React.FC = () => {
  const { state, dispatch, openDocument } = useAppContext();
  const { docs, docsLoading, docsError } = state;
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  /**
   * 加载文档列表
   */
  const loadDocs = useCallback(async () => {
    dispatch({ type: 'SET_DOCS_LOADING', payload: true });
    
    try {
      const result = await window.aiFile?.listDocs?.();
      
      if (result?.success && result.docs) {
        const docMetas: LocalDocMeta[] = result.docs.map((doc: any) => ({
          id: doc.fullPath,
          name: doc.name,
          fullPath: doc.fullPath,
          ext: getFileExt(doc.name),
          updatedAt: doc.updatedAt,
          sizeBytes: doc.sizeBytes,
          createdAt: doc.createdAt,
        }));
        
        dispatch({ type: 'SET_DOCS', payload: docMetas });
      } else {
        dispatch({ type: 'SET_DOCS_ERROR', payload: result?.error || '加载失败' });
      }
    } catch (error) {
      console.error('[DocumentManagerView] Load docs failed:', error);
      dispatch({ type: 'SET_DOCS_ERROR', payload: '加载文档列表失败' });
    } finally {
      dispatch({ type: 'SET_DOCS_LOADING', payload: false });
    }
  }, [dispatch]);

  // 初始加载
  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  /**
   * 双击打开文档
   */
  const handleOpenDoc = useCallback(async (doc: LocalDocMeta) => {
    if (doc.ext !== 'docx') {
      console.log('[DocumentManagerView] Unsupported file type:', doc.ext);
      return;
    }

    try {
      // 使用 AST 导入 API
      const result = await window.aiFormat?.importDocx?.(doc.fullPath);
      
      if (result?.success && (result.ast || result.html)) {
        openDocument({
          id: doc.fullPath,
          filePath: doc.fullPath,
          fileName: doc.name,
          kind: 'docx',
          ast: result.ast,
          html: result.html,
        });
      } else {
        console.error('[DocumentManagerView] Import failed:', result?.error);
      }
    } catch (error) {
      console.error('[DocumentManagerView] Open doc failed:', error);
    }
  }, [openDocument]);

  /**
   * 删除文档
   */
  const handleDeleteDoc = useCallback(async (doc: LocalDocMeta) => {
    if (!confirm(`确定删除「${doc.name}」吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const result = await window.aiFile?.deleteDoc?.(doc.fullPath);
      
      if (result?.success) {
        dispatch({ type: 'REMOVE_DOC', payload: doc.id });
        setSelectedDocId(null);
      } else {
        console.error('[DocumentManagerView] Delete failed:', result?.error);
      }
    } catch (error) {
      console.error('[DocumentManagerView] Delete doc failed:', error);
    }
  }, [dispatch]);

  return (
    <div className="doc-manager-view">
      {/* 左侧空间/目录 */}
      <div className="doc-manager-sidebar">
        <div className="doc-manager-sidebar-section">
          <div className="doc-manager-sidebar-title">空间</div>
          <div className="doc-manager-sidebar-items">
            <div className="doc-manager-sidebar-item active">
              <FolderIcon />
              <span>本地文档</span>
            </div>
          </div>
        </div>
      </div>

      {/* 右侧文档列表 */}
      <div className="doc-manager-main">
        {/* 工具栏 */}
        <div className="doc-manager-toolbar">
          <h2 className="doc-manager-title">本地文档</h2>
          <div className="doc-manager-actions">
            <button
              className="doc-manager-action-btn"
              onClick={loadDocs}
              disabled={docsLoading}
              title="刷新"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        {/* 表格头 */}
        <div className="doc-manager-table-header">
          <div className="doc-col doc-col-name">名称</div>
          <div className="doc-col doc-col-date">修改日期</div>
          <div className="doc-col doc-col-size">大小</div>
          <div className="doc-col doc-col-actions"></div>
        </div>

        {/* 文档列表 */}
        <div className="doc-manager-list">
          {docsLoading && (
            <div className="doc-manager-loading">加载中...</div>
          )}
          
          {docsError && (
            <div className="doc-manager-error">{docsError}</div>
          )}
          
          {!docsLoading && !docsError && docs.length === 0 && (
            <div className="doc-manager-empty">
              <p>暂无文档</p>
              <p className="doc-manager-empty-hint">点击左上角「新建」创建新文档</p>
            </div>
          )}
          
          {docs.map(doc => (
            <div
              key={doc.id}
              className={`doc-manager-row ${selectedDocId === doc.id ? 'selected' : ''}`}
              onClick={() => setSelectedDocId(doc.id)}
              onDoubleClick={() => handleOpenDoc(doc)}
            >
              <div className="doc-col doc-col-name">
                <span className="doc-icon">{getDocIcon(doc.ext)}</span>
                <span className="doc-name">{doc.name}</span>
              </div>
              <div className="doc-col doc-col-date">{formatDate(doc.updatedAt)}</div>
              <div className="doc-col doc-col-size">{formatSize(doc.sizeBytes)}</div>
              <div className="doc-col doc-col-actions">
                <button
                  className="doc-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteDoc(doc);
                  }}
                  title="删除"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DocumentManagerView;

