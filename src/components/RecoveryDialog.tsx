/**
 * RecoveryDialog - 崩溃恢复对话框
 * 
 * 应用启动时检测到未正常保存的文档时显示。
 */

import React from 'react';
import { RecentDocumentEntry } from '../store/RecentDocumentsStore';
import './RecoveryDialog.css';

// ==========================================
// 类型定义
// ==========================================

interface RecoveryDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 需要恢复的文档列表 */
  documents: RecentDocumentEntry[];
  /** 恢复回调 */
  onRecover: (docId: string) => void;
  /** 忽略回调 */
  onIgnore: (docId: string) => void;
  /** 全部忽略回调 */
  onIgnoreAll: () => void;
  /** 关闭回调 */
  onClose: () => void;
}

// ==========================================
// 组件
// ==========================================

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({
  open,
  documents,
  onRecover,
  onIgnore,
  onIgnoreAll,
  onClose,
}) => {
  if (!open || documents.length === 0) return null;

  return (
    <div className="recovery-dialog-overlay" onClick={onClose}>
      <div className="recovery-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="recovery-dialog-header">
          <div className="recovery-dialog-icon">⚠️</div>
          <h3 className="recovery-dialog-title">检测到未保存的文档</h3>
        </div>
        
        <div className="recovery-dialog-body">
          <p className="recovery-dialog-description">
            上次应用退出时，以下文档可能有未保存的更改：
          </p>
          
          <ul className="recovery-dialog-list">
            {documents.map(doc => (
              <li key={doc.id} className="recovery-dialog-item">
                <div className="recovery-item-info">
                  <span className="recovery-item-name">{doc.displayName}</span>
                  <span className="recovery-item-path" title={doc.path}>
                    {doc.path.length > 50 ? '...' + doc.path.slice(-47) : doc.path}
                  </span>
                </div>
                <div className="recovery-item-actions">
                  <button 
                    className="recovery-btn recovery-btn-recover"
                    onClick={() => onRecover(doc.id)}
                  >
                    恢复
                  </button>
                  <button 
                    className="recovery-btn recovery-btn-ignore"
                    onClick={() => onIgnore(doc.id)}
                  >
                    忽略
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="recovery-dialog-footer">
          <button 
            className="recovery-btn recovery-btn-secondary"
            onClick={onIgnoreAll}
          >
            全部忽略
          </button>
          <button 
            className="recovery-btn recovery-btn-primary"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecoveryDialog;

