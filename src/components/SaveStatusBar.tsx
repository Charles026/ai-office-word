/**
 * SaveStatusBar - 保存状态指示器
 * 
 * 在编辑器底部显示当前文档的保存状态。
 * 
 * 【功能】
 * - 显示保存状态：已保存、正在保存、保存失败
 * - 显示最后保存时间
 * - 未保存时显示警告
 */

import React from 'react';
import { SaveStatus } from '../core/DocumentSaveService';
import './SaveStatusBar.css';

// ==========================================
// 类型定义
// ==========================================

interface SaveStatusBarProps {
  /** 保存状态 */
  status: SaveStatus;
  /** 是否有未保存的修改 */
  isDirty: boolean;
  /** 最后保存时间（时间戳） */
  lastSavedAt?: number;
  /** 错误信息 */
  error?: string;
  /** 是否可见 */
  visible?: boolean;
}

// ==========================================
// 辅助函数
// ==========================================

function formatLastSaved(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 5000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  
  const date = new Date(timestamp);
  const today = new Date();
  
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  
  return date.toLocaleString('zh-CN', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function getStatusInfo(status: SaveStatus, isDirty: boolean): { 
  icon: string; 
  text: string; 
  className: string 
} {
  switch (status) {
    case 'saving':
      return { icon: '○', text: '正在保存...', className: 'saving' };
    case 'pending':
      return { icon: '●', text: '有未保存的更改', className: 'pending' };
    case 'error':
      return { icon: '✕', text: '保存失败', className: 'error' };
    case 'saved':
      return isDirty 
        ? { icon: '●', text: '有未保存的更改', className: 'pending' }
        : { icon: '✓', text: '已保存', className: 'saved' };
    default:
      return isDirty
        ? { icon: '●', text: '有未保存的更改', className: 'pending' }
        : { icon: '–', text: '', className: 'idle' };
  }
}

// ==========================================
// 组件
// ==========================================

export const SaveStatusBar: React.FC<SaveStatusBarProps> = ({
  status,
  isDirty,
  lastSavedAt,
  error,
  visible = true,
}) => {
  if (!visible) return null;

  const statusInfo = getStatusInfo(status, isDirty);
  
  return (
    <div className={`save-status-bar ${statusInfo.className}`}>
      <span className="save-status-icon">{statusInfo.icon}</span>
      <span className="save-status-text">
        {statusInfo.text}
        {status === 'saved' && !isDirty && lastSavedAt && (
          <span className="save-status-time">
            （{formatLastSaved(lastSavedAt)}）
          </span>
        )}
        {status === 'error' && error && (
          <span className="save-status-error" title={error}>
            ：{error.slice(0, 20)}{error.length > 20 ? '...' : ''}
          </span>
        )}
      </span>
    </div>
  );
};

export default SaveStatusBar;

