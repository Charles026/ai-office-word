/**
 * Toast 通知组件
 * 
 * 简单的顶部居中通知
 */

import React, { useEffect } from 'react';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // 0 for no auto-dismiss
}

interface ToastProps {
  message: ToastMessage;
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ message, onDismiss }) => {
  useEffect(() => {
    if (message.duration && message.duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(message.id);
      }, message.duration);
      return () => clearTimeout(timer);
    }
  }, [message, onDismiss]);

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    loading: '⟳',
  };

  return (
    <div className={`toast toast-${message.type}`}>
      <span className={`toast-icon ${message.type === 'loading' ? 'spinning' : ''}`}>
        {icons[message.type]}
      </span>
      <span className="toast-content">{message.message}</span>
    </div>
  );
};

export const ToastContainer: React.FC<{ toasts: ToastMessage[], onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} message={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

