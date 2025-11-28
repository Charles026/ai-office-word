/**
 * AI 新建视图
 * 
 * 【功能】
 * - 传统文档类型按钮（文字/表格/演示/PDF）
 * - 智能文档类型按钮
 * - 搜索条 + AI 初始化
 */

import React, { useState, useCallback } from 'react';
import { useAppContext } from '../store';
import { generateId } from '../store/types';
import { createEmptyDocument } from '../document/types';
import './AiCreateView.css';

// ==========================================
// Icons
// ==========================================

const WordIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="4" y="2" width="24" height="28" rx="3" fill="#2B579A"/>
    <text x="16" y="19" textAnchor="middle" fill="white" fontSize="10" fontWeight="600">W</text>
  </svg>
);

const ExcelIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="4" y="2" width="24" height="28" rx="3" fill="#217346"/>
    <text x="16" y="19" textAnchor="middle" fill="white" fontSize="10" fontWeight="600">X</text>
  </svg>
);

const PowerPointIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="4" y="2" width="24" height="28" rx="3" fill="#D24726"/>
    <text x="16" y="19" textAnchor="middle" fill="white" fontSize="10" fontWeight="600">P</text>
  </svg>
);

const PdfIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="4" y="2" width="24" height="28" rx="3" fill="#FF0000"/>
    <text x="16" y="19" textAnchor="middle" fill="white" fontSize="8" fontWeight="600">PDF</text>
  </svg>
);

const SmartDocIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="4" y="2" width="24" height="28" rx="3" fill="#8B5CF6"/>
    <path d="M16 10l2 4 4 0.5-3 3 0.7 4.5-3.7-2-3.7 2 0.7-4.5-3-3 4-0.5 2-4z" fill="white"/>
  </svg>
);

const SmartSheetIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="4" y="2" width="24" height="28" rx="3" fill="#0EA5E9"/>
    <path d="M10 12h12M10 16h12M10 20h12M14 10v12" stroke="white" strokeWidth="1.5"/>
  </svg>
);

const SmartFormIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect x="4" y="2" width="24" height="28" rx="3" fill="#F97316"/>
    <rect x="9" y="10" width="14" height="3" rx="1" fill="white"/>
    <rect x="9" y="15" width="14" height="3" rx="1" fill="white"/>
    <rect x="9" y="20" width="8" height="3" rx="1" fill="white"/>
  </svg>
);

const SparkleIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2z" fill="currentColor"/>
    <path d="M15 12l0.75 2.25L18 15l-2.25 0.75L15 18l-0.75-2.25L12 15l2.25-0.75L15 12z" fill="currentColor" opacity="0.6"/>
  </svg>
);

// ==========================================
// Component
// ==========================================

export const AiCreateView: React.FC = () => {
  const { openDocument } = useAppContext();
  const [prompt, setPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  /**
   * 创建传统空白文档
   */
  const handleCreateDocument = useCallback(async (_type: 'docx' | 'xlsx' | 'pptx' | 'pdf') => {
    setIsCreating(true);
    
    try {
      // MVP: 所有类型都创建 docx
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
        });
      }
    } catch (error) {
      console.error('[AiCreateView] Failed to create document:', error);
    } finally {
      setIsCreating(false);
    }
  }, [openDocument]);

  /**
   * 创建智能文档（AI 初始化）
   */
  const handleCreateSmartDocument = useCallback(async (type: 'smart-doc' | 'smart-sheet' | 'smart-form') => {
    setIsCreating(true);
    
    try {
      const result = await window.aiFile?.newDocx?.();
      
      if (result) {
        const ast = createEmptyDocument();
        ast.metadata.title = result.fileName;
        
        // 添加占位内容
        if (ast.blocks.length > 0 && ast.blocks[0].type === 'paragraph') {
          (ast.blocks[0] as any).children = [{
            id: generateId(),
            type: 'text' as const,
            text: `这是一个智能${type === 'smart-doc' ? '文档' : type === 'smart-sheet' ? '表格' : '表单'}草稿，将由 AI 协助完善内容。`,
            marks: {},
          }];
        }
        
        openDocument({
          id: result.filePath,
          filePath: result.filePath,
          fileName: result.fileName,
          kind: 'docx',
          ast,
        });
      }
    } catch (error) {
      console.error('[AiCreateView] Failed to create smart document:', error);
    } finally {
      setIsCreating(false);
    }
  }, [openDocument]);

  /**
   * AI 生成文档
   */
  const handleAiGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    
    setIsGenerating(true);
    
    try {
      // 1. 创建新文档
      const result = await window.aiFile?.newDocx?.();
      if (!result) {
        throw new Error('创建文档失败');
      }

      // 2. 调用 AI 生成内容
      const aiResult = await (window.aiDoc as any)?.bootstrapDocument?.({
        prompt: prompt.trim(),
      });

      // 3. 构建 AST
      const ast = createEmptyDocument();
      ast.metadata.title = result.fileName;

      if (aiResult?.success && aiResult.content) {
        // 将 AI 输出转换为 AST blocks
        const lines = aiResult.content.split('\n').filter((l: string) => l.trim());
        ast.blocks = lines.map((line: string) => {
          const trimmed = line.trim();
          
          // 识别标题
          if (trimmed.startsWith('# ')) {
            return {
              id: generateId(),
              type: 'heading' as const,
              level: 1 as const,
              children: [{
                id: generateId(),
                type: 'text' as const,
                text: trimmed.slice(2),
                marks: {},
              }],
            };
          }
          if (trimmed.startsWith('## ')) {
            return {
              id: generateId(),
              type: 'heading' as const,
              level: 2 as const,
              children: [{
                id: generateId(),
                type: 'text' as const,
                text: trimmed.slice(3),
                marks: {},
              }],
            };
          }
          if (trimmed.startsWith('### ')) {
            return {
              id: generateId(),
              type: 'heading' as const,
              level: 3 as const,
              children: [{
                id: generateId(),
                type: 'text' as const,
                text: trimmed.slice(4),
                marks: {},
              }],
            };
          }
          
          // 普通段落
          return {
            id: generateId(),
            type: 'paragraph' as const,
            children: [{
              id: generateId(),
              type: 'text' as const,
              text: trimmed,
              marks: {},
            }],
          };
        });

        if (ast.blocks.length === 0) {
          ast.blocks = [{
            id: generateId(),
            type: 'paragraph' as const,
            children: [],
          }];
        }
      } else {
        // AI 生成失败，添加占位内容
        if (ast.blocks.length > 0 && ast.blocks[0].type === 'paragraph') {
          (ast.blocks[0] as any).children = [{
            id: generateId(),
            type: 'text' as const,
            text: `AI 正在准备内容: ${prompt}`,
            marks: {},
          }];
        }
      }

      // 4. 打开文档
      openDocument({
        id: result.filePath,
        filePath: result.filePath,
        fileName: result.fileName,
        kind: 'docx',
        ast,
      });

      setPrompt('');
    } catch (error) {
      console.error('[AiCreateView] AI generate failed:', error);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, openDocument]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAiGenerate();
    }
  }, [handleAiGenerate]);

  return (
    <div className="ai-create-view">
      <div className="ai-create-content">
        {/* AI 动画图标 */}
        <div className="ai-create-logo">
          <SparkleIcon />
        </div>

        {/* AI 搜索/对话输入 */}
        <div className="ai-create-input-wrapper">
          <input
            type="text"
            className="ai-create-input"
            placeholder="输入你想创建的内容，如：写一篇关于产品发布的方案"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
          />
          <button
            className="ai-create-submit"
            onClick={handleAiGenerate}
            disabled={!prompt.trim() || isGenerating}
          >
            {isGenerating ? '生成中...' : '生成'}
          </button>
        </div>

        {/* 传统文档类型 */}
        <div className="ai-create-section">
          <div className="ai-create-section-title">Office 文档</div>
          <div className="ai-create-buttons">
            <button
              className="ai-create-btn"
              onClick={() => handleCreateDocument('docx')}
              disabled={isCreating}
            >
              <WordIcon />
              <span>文字</span>
            </button>
            <button
              className="ai-create-btn"
              onClick={() => handleCreateDocument('xlsx')}
              disabled={isCreating}
            >
              <ExcelIcon />
              <span>表格</span>
            </button>
            <button
              className="ai-create-btn"
              onClick={() => handleCreateDocument('pptx')}
              disabled={isCreating}
            >
              <PowerPointIcon />
              <span>演示</span>
            </button>
            <button
              className="ai-create-btn"
              onClick={() => handleCreateDocument('pdf')}
              disabled={isCreating}
            >
              <PdfIcon />
              <span>PDF</span>
            </button>
          </div>
        </div>

        {/* 智能文档类型 */}
        <div className="ai-create-section">
          <div className="ai-create-section-title">智能模板</div>
          <div className="ai-create-buttons">
            <button
              className="ai-create-btn smart"
              onClick={() => handleCreateSmartDocument('smart-doc')}
              disabled={isCreating}
            >
              <SmartDocIcon />
              <span>智能文档</span>
            </button>
            <button
              className="ai-create-btn smart"
              onClick={() => handleCreateSmartDocument('smart-sheet')}
              disabled={isCreating}
            >
              <SmartSheetIcon />
              <span>智能表格</span>
            </button>
            <button
              className="ai-create-btn smart"
              onClick={() => handleCreateSmartDocument('smart-form')}
              disabled={isCreating}
            >
              <SmartFormIcon />
              <span>智能表单</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiCreateView;

