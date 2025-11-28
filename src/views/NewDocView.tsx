/**
 * 新建文档视图
 * 
 * 极简的新建页面，只提供新建 docx 功能。
 */

import React, { useState, useCallback } from 'react';
import { useAppContext } from '../store';
import { createEmptyDocument } from '../document/types';
import './AiCreateView.css'; // Reuse styles or create new ones if needed

// Icons
const PlusIcon: React.FC = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const WordIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ marginRight: 8 }}>
    <rect x="3" y="2" width="18" height="20" rx="2" fill="#2B579A"/>
    <text x="12" y="17" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">W</text>
  </svg>
);

export const NewDocView: React.FC = () => {
  const { openDocument } = useAppContext();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateDocx = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const result = await window.aiFile?.newDocx?.();
      
      if (result) {
        const ast = createEmptyDocument();
        ast.metadata.title = result.fileName;
        
        openDocument({
          id: result.filePath,
          filePath: result.filePath,
          fileName: result.fileName,
          kind: 'docx',
          ast,
          html: '', // Empty document
        });
      }
    } catch (error) {
      console.error('[NewDocView] Failed to create document:', error);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, openDocument]);

  return (
    <div className="ai-create-view" style={{ justifyContent: 'center' }}>
      <div className="ai-create-content" style={{ maxWidth: 600, textAlign: 'center', alignItems: 'center' }}>
        <div style={{ 
          width: 80, height: 80, borderRadius: '50%', 
          background: 'rgba(43, 87, 154, 0.1)', color: '#2B579A',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24
        }}>
          <PlusIcon />
        </div>
        
        <h1 style={{ fontSize: 32, fontWeight: 600, marginBottom: 12 }}>新建文档</h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 40, lineHeight: 1.5 }}>
          点击下方按钮，在本地创建一个新的 Word 文档（.docx）<br/>
          开始您的创作之旅。
        </p>

        <button 
          className="btn-primary" 
          style={{ 
            fontSize: 16, padding: '12px 32px', height: 'auto',
            display: 'flex', alignItems: 'center', borderRadius: 12
          }}
          onClick={handleCreateDocx}
          disabled={isCreating}
        >
          <WordIcon />
          {isCreating ? '正在创建...' : '新建文字文档 (.docx)'}
        </button>
      </div>
    </div>
  );
};

