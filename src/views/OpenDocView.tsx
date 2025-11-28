/**
 * 打开文档视图
 * 
 * 调用系统文件选择器打开本地文档。
 */

import React, { useState, useCallback } from 'react';
import { useAppContext } from '../store';
import './AiCreateView.css'; // Reuse styles

// Icons
const FolderOpenIcon: React.FC = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const OpenDocView: React.FC = () => {
  const { openDocument } = useAppContext();
  const [isOpening, setIsOpening] = useState(false);

  const handleOpen = useCallback(async () => {
    if (isOpening) return;
    setIsOpening(true);

    try {
      const result = await window.aiFormat?.openAndImport?.();
      
      if (result?.success && (result.ast || result.html)) {
        openDocument({
          id: result.filePath!,
          filePath: result.filePath!,
          fileName: result.fileName!,
          kind: 'docx',
          ast: result.ast,
          html: result.html,
        });
      }
    } catch (error) {
      console.error('[OpenDocView] Failed to open document:', error);
    } finally {
      setIsOpening(false);
    }
  }, [isOpening, openDocument]);

  return (
    <div className="ai-create-view" style={{ justifyContent: 'center' }}>
      <div className="ai-create-content" style={{ maxWidth: 600, textAlign: 'center', alignItems: 'center' }}>
        <div style={{ 
          width: 80, height: 80, borderRadius: '50%', 
          background: 'rgba(255, 149, 0, 0.1)', color: '#FF9500',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24
        }}>
          <FolderOpenIcon />
        </div>
        
        <h1 style={{ fontSize: 32, fontWeight: 600, marginBottom: 12 }}>打开本地文档</h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 40, lineHeight: 1.5 }}>
          从电脑中选择一个现有的 Word 文档，<br/>
          在 AI Office 中查看或编辑。
        </p>

        <button 
          className="btn-secondary" 
          style={{ 
            fontSize: 16, padding: '12px 32px', height: 'auto',
            borderRadius: 12, background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)'
          }}
          onClick={handleOpen}
          disabled={isOpening}
        >
          {isOpening ? '正在打开...' : '选择文件...'}
        </button>
      </div>
    </div>
  );
};

