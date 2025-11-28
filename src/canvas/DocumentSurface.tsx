/**
 * DocumentSurface - Word 风格文档表面
 * 
 * 【视觉设计】
 * - 灰色背景 + 白色页面
 * - A4 宽度居中
 * - 轻微阴影效果
 * - 接近 Word/Pages 的视觉
 */

import React from 'react';
import './DocumentSurface.css';

interface DocumentSurfaceProps {
  children: React.ReactNode;
}

export const DocumentSurface: React.FC<DocumentSurfaceProps> = ({ children }) => {
  return (
    <div className="document-surface">
      <div className="document-page">
        {children}
      </div>
    </div>
  );
};

export default DocumentSurface;

