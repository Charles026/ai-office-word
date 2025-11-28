/**
 * AI Office 主应用
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import './styles.css';
import { LiquidGlassFilter } from './LiquidGlassFilter';
import { AppProvider, useAppContext } from './store';
import { NewDocView, OpenDocView, DocumentManagerView } from './views';
import { EditorContainer, EditorContainerRef } from './canvas/EditorContainer';
import { DocumentSurface } from './canvas/DocumentSurface';
import { Ribbon, DEFAULT_TABS, RibbonCommandId } from './ribbon';
import { Icon } from './components/Icon';
import { ToastContainer, ToastMessage } from './components/Toast';
import { DocAgentPanel } from './components/DocAgentPanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SaveStatusBar } from './components/SaveStatusBar';
import { RecoveryDialog } from './components/RecoveryDialog';
import { FontOptionKey } from './config/fonts';
import { FontSizeKey, LineHeightKey, TextAlignKey } from './config/typography';
import { OutlinePane, OutlineItem } from './outline';
import { LexicalEditor } from 'lexical';
import { DocumentSummarizerAgent, DocumentSummarizerState, createDocumentSummarizerAgent } from './runtime/DocumentSummarizerAgent';
import { 
  DocumentTranslateAgent, 
  DocAgentState,
  TranslateDirection 
} from './runtime/docAgentRuntime/index';
import { createSectionDocOps } from './docops/SectionDocOps';
import { documentSaveService, SaveStatus, snapshotService } from './core';
import { recentDocumentsStore, RecentDocumentEntry } from './store/RecentDocumentsStore';
import { runSectionAiAction, subscribeAiProcessing, SectionAiAction } from './actions';
import { AiSectionActions } from './ribbon/ai';
// Copilot
import { CopilotPanel, initCopilotContextListener, copilotStore } from './copilot';
import { setCopilotEditor, setCopilotToast } from './copilot/copilotRuntimeBridge';
import { emitDocumentOpened, emitDocumentClosed } from './editor/events';

// 使用别名避免命名冲突
type TranslateAgentState = DocAgentState;

// ==========================================
// Custom Icons (Specific UI assets)
// ==========================================

const DocxIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="2" y="1" width="16" height="18" rx="2" fill="#2B579A"/>
    <text x="10" y="12" textAnchor="middle" fill="white" fontSize="6" fontWeight="600">W</text>
  </svg>
);

// ==========================================
// Navigation Item
// ==========================================

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick }) => (
  <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
    <span className="nav-item-icon">{icon}</span>
    <span className="nav-item-label">{label}</span>
  </button>
);

// ==========================================
// File Tab Item (Sidebar)
// ==========================================

interface FileTabItemProps {
  fileName: string;
  isActive: boolean;
  isDirty?: boolean;
  onClick: () => void;
  onClose: () => void;
}

const FileTabItem: React.FC<FileTabItemProps> = ({ fileName, isActive, isDirty, onClick, onClose }) => (
  <div className={`file-tab-item ${isActive ? 'active' : ''}`} onClick={onClick} role="button" tabIndex={0}>
    <span className="file-tab-icon"><DocxIcon /></span>
    <span className="file-tab-name">
      {fileName}
      {isDirty && <span className="file-tab-dirty">•</span>}
    </span>
    <button
      className="file-tab-close"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      aria-label="关闭文档"
    >
      ×
    </button>
  </div>
);

// ==========================================
// Main Content
// ==========================================

const AppContent: React.FC = () => {
  const { state, dispatch, setView, closeDocument, openDocument } = useAppContext();
  const { currentView, openTabs, activeTabId } = state;
  
  // Editor ref for command forwarding
  const editorRef = useRef<EditorContainerRef>(null);
  
  // Track active commands for button highlighting
  const [activeCommands, setActiveCommands] = useState<RibbonCommandId[]>([]);
  
  // Ribbon Tab state
  const [activeRibbonTab, setActiveRibbonTab] = useState('home');

  // Toast notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  
  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'loading' = 'info', duration: number = 3000): string => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // 获取当前激活的文档 Tab
  const activeTab = currentView.type === 'doc' 
    ? openTabs.find(t => t.id === currentView.docId)
    : null;

  // Auto-save 状态
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const editorContentRef = useRef<string>('');

  // 崩溃恢复状态
  const [recoveryDocuments, setRecoveryDocuments] = useState<RecentDocumentEntry[]>([]);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);

  // Copilot 面板状态
  const [showCopilot, setShowCopilot] = useState(false);

  // 初始化服务
  useEffect(() => {
    const initServices = async () => {
      try {
        // 初始化最近文档存储
        await recentDocumentsStore.init();
        await recentDocumentsStore.load();
        
        // 初始化快照服务
        await snapshotService.init();

        // 初始化 Copilot 上下文监听器
        initCopilotContextListener();
        
        // 检查是否有需要恢复的文档
        const docsNeedingRecovery = recentDocumentsStore.getDocumentsNeedingRecovery();
        if (docsNeedingRecovery.length > 0) {
          setRecoveryDocuments(docsNeedingRecovery);
          setShowRecoveryDialog(true);
        }
        
        console.log('[App] Services initialized');
      } catch (error) {
        console.error('[App] Failed to initialize services:', error);
      }
    };
    
    initServices();

    // 应用退出时标记正常退出
    const handleBeforeUnload = () => {
      recentDocumentsStore.markNormalExit();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // 订阅 DocumentSaveService 状态变化
  useEffect(() => {
    if (!activeTab?.id) return;

    const unsubscribe = documentSaveService.subscribe((state) => {
      if (state.docId === activeTab.id) {
        setSaveStatus(state.status);
        setLastSavedAt(state.lastSavedAt);
        setSaveError(state.lastError);
        
        // 同步 dirty 状态到 store
        if (state.isDirty !== activeTab.isDirty) {
          dispatch({ 
            type: 'SET_TAB_DIRTY', 
            payload: { id: activeTab.id, isDirty: state.isDirty } 
          });
        }
      }
    });

    // 获取当前状态
    const currentState = documentSaveService.getState(activeTab.id);
    setSaveStatus(currentState.status);
    setLastSavedAt(currentState.lastSavedAt);
    setSaveError(currentState.lastError);

    return () => unsubscribe();
  }, [activeTab?.id, activeTab?.isDirty, dispatch]);

  // 文档打开时更新最近文档记录
  useEffect(() => {
    if (activeTab?.filePath) {
      recentDocumentsStore.upsertEntry({
        id: activeTab.id,
        path: activeTab.filePath,
        displayName: activeTab.fileName,
      });
    }
  }, [activeTab?.id, activeTab?.filePath, activeTab?.fileName]);

  // 同步 activeTab 变化到 Copilot Store 并发出 EditorEvent
  useEffect(() => {
    if (activeTab?.id) {
      // 设置 Copilot 的当前文档
      copilotStore.setActiveDoc(activeTab.id);
      // 发出文档打开事件
      emitDocumentOpened(activeTab.id);
    } else {
      // 没有激活文档时，重置 Copilot 上下文
      copilotStore.setActiveDoc(null);
    }
  }, [activeTab?.id]);

  // 用于延迟调用的 ref（避免循环依赖）
  const translateDocumentRef = useRef<(direction: TranslateDirection) => void>();
  const summarizeAllRef = useRef<() => void>();

  // 处理 Ribbon 命令 - 统一命令总线
  const handleRibbonCommand = useCallback((cmd: RibbonCommandId) => {
    // 文件操作
    switch (cmd) {
      case 'file:new':
        setView({ type: 'new' });
        return;
      case 'file:open':
        // Simulate open dialog click behavior
        handleNavClick('open');
        return;
      case 'file:save':
        // Get content from editor and save
        if (editorRef.current && activeTab) {
          // We'll get content via onSave callback
          editorRef.current.executeCommand(cmd);
        }
        return;
      case 'file:save-as':
        // Get content from editor and save-as
        if (editorRef.current && activeTab) {
          editorRef.current.executeCommand(cmd);
        }
        return;
      case 'view:toggle-outline':
        // 切换大纲面板
        setShowOutline(prev => !prev);
        return;
      case 'view:toggle-copilot':
        // 切换 Copilot 面板
        setShowCopilot(prev => !prev);
        return;
      case 'ai:translate-doc-zh':
        // 整篇翻译为中文
        translateDocumentRef.current?.('en_to_zh');
        return;
      case 'ai:translate-doc-en':
        // 整篇翻译为英文
        translateDocumentRef.current?.('zh_to_en');
        return;
      case 'ai:summarize-doc':
        // 逐节总结
        summarizeAllRef.current?.();
        return;
    }
    
    // 所有其他命令转发给 EditorContainer
    if (editorRef.current) {
      editorRef.current.executeCommand(cmd);
    }
  }, [setView, activeTab]);

  // 导航点击处理
  const handleNavClick = useCallback(async (type: 'new' | 'open' | 'files') => {
    if (type === 'open') {
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
        console.error('[App] Failed to open document:', error);
      }
      return;
    }
    
    setView({ type });
  }, [setView, openDocument]);

  // 处理文档 Tab 点击 (Sidebar)
  const handleTabClick = useCallback((tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tabId });
  }, [dispatch]);

  // 处理内容变更 (Dirty state + Auto-save)
  const handleDirty = useCallback((content?: string) => {
    if (activeTabId && activeTab) {
      dispatch({ type: 'SET_TAB_DIRTY', payload: { id: activeTabId, isDirty: true } });
      
      // 触发 Auto-save
      if (content !== undefined) {
        editorContentRef.current = content;
        documentSaveService.markDirty(activeTabId, content, activeTab.filePath);
      }
    }
  }, [activeTabId, activeTab, dispatch]);

  // 处理保存（使用 DocumentSaveService，手动保存会创建快照）
  const handleSave = useCallback(async (content: any, isSaveAs: boolean = false) => {
    if (!activeTab) {
      addToast('没有打开的文档', 'error');
      return;
    }

    // 取消 pending 的 auto-save
    documentSaveService.cancelAutoSave(activeTab.id);

    // 显示加载提示
    const loadingToastId = addToast('正在保存...', 'loading', 0);

    try {
      let result;
      let savedFilePath: string | undefined;

      if (isSaveAs || !activeTab.filePath) {
        // 另存为或新文档首次保存
        console.log('[App] Save As:', isSaveAs ? 'explicit' : 'no filePath');
        result = await window.aiFormat?.saveAsDocx?.(content, activeTab.filePath);
        savedFilePath = result?.filePath;
      } else {
        // 直接保存到现有路径
        console.log('[App] Saving document:', activeTab.filePath);
        result = await window.aiFormat?.exportDocx?.(activeTab.filePath, content);
        savedFilePath = activeTab.filePath;
      }
      
      dismissToast(loadingToastId);

      if (result?.success) {
        // 如果是另存为，更新 tab 的文件路径
        if (savedFilePath && savedFilePath !== activeTab.filePath) {
          dispatch({
            type: 'UPDATE_TAB',
            payload: {
              id: activeTab.id,
              updates: {
                filePath: savedFilePath,
                fileName: savedFilePath.split(/[/\\]/).pop() || 'Untitled.docx',
              },
            },
          });
        }
        
        dispatch({ type: 'SET_TAB_DIRTY', payload: { id: activeTab.id, isDirty: false } });
        
        // 更新 DocumentSaveService 状态
        documentSaveService.getState(activeTab.id);
        
        // 手动保存时创建快照
        if (savedFilePath) {
          try {
            await snapshotService.createSnapshot(activeTab.id, savedFilePath);
            console.log('[App] Snapshot created for:', savedFilePath);
          } catch (snapshotError) {
            console.warn('[App] Failed to create snapshot:', snapshotError);
            // 快照失败不影响保存结果
          }
        }
        
        addToast('已保存', 'success');
        console.log('[App] Document saved successfully:', savedFilePath);
      } else {
        const errorMsg = result?.error || '未知错误';
        addToast(`保存失败: ${errorMsg}`, 'error');
        console.error('[App] Save failed:', errorMsg);
      }
    } catch (error) {
      dismissToast(loadingToastId);
      const errorMsg = error instanceof Error ? error.message : String(error);
      addToast(`保存出错: ${errorMsg}`, 'error');
      console.error('[App] Save error:', error);
    }
  }, [activeTab, dispatch, addToast, dismissToast]);

  // 处理崩溃恢复
  const handleRecover = useCallback(async (docId: string) => {
    const doc = recoveryDocuments.find(d => d.id === docId);
    if (!doc) return;

    try {
      // 打开文档
      const result = await window.aiFormat?.importDocx?.(doc.path);
      if (result?.success) {
        openDocument({
          id: doc.id,
          filePath: doc.path,
          fileName: doc.displayName,
          kind: 'docx',
          html: result.html,
        });
        
        // 清除恢复标记
        await recentDocumentsStore.clearRecoveryFlag(docId);
        setRecoveryDocuments(prev => prev.filter(d => d.id !== docId));
        
        addToast(`已恢复：${doc.displayName}`, 'success');
      }
    } catch (error) {
      console.error('[App] Failed to recover document:', error);
      addToast(`恢复失败：${doc.displayName}`, 'error');
    }

    // 如果没有更多需要恢复的文档，关闭对话框
    if (recoveryDocuments.length <= 1) {
      setShowRecoveryDialog(false);
    }
  }, [recoveryDocuments, openDocument, addToast]);

  const handleIgnoreRecovery = useCallback(async (docId: string) => {
    await recentDocumentsStore.clearRecoveryFlag(docId);
    setRecoveryDocuments(prev => prev.filter(d => d.id !== docId));
    
    if (recoveryDocuments.length <= 1) {
      setShowRecoveryDialog(false);
    }
  }, [recoveryDocuments]);

  const handleIgnoreAllRecovery = useCallback(async () => {
    for (const doc of recoveryDocuments) {
      await recentDocumentsStore.clearRecoveryFlag(doc.id);
    }
    setRecoveryDocuments([]);
    setShowRecoveryDialog(false);
  }, [recoveryDocuments]);

  // 文档关闭时更新最近文档记录
  const handleCloseDocument = useCallback((docId: string) => {
    const tab = openTabs.find(t => t.id === docId);
    if (tab) {
      // 标记关闭状态
      recentDocumentsStore.markClosed(docId, tab.isDirty || false);
      
      // 清理 DocumentSaveService 状态
      documentSaveService.cleanup(docId);

      // 发出文档关闭事件
      emitDocumentClosed(docId);
    }
    
    closeDocument(docId);
  }, [openTabs, closeDocument]);

  // 字体状态
  const [currentFontKey, setCurrentFontKey] = useState<FontOptionKey | null>(null);
  const [isMixedFont, setIsMixedFont] = useState(false);

  // 处理字体变更
  const handleFontChange = useCallback((fontKey: FontOptionKey) => {
    if (editorRef.current) {
      editorRef.current.applyFont(fontKey);
    }
  }, []);

  // 字号状态
  const [currentFontSize, setCurrentFontSize] = useState<FontSizeKey | null>(null);
  const [isMixedFontSize, setIsMixedFontSize] = useState(false);

  // 对齐状态
  const [currentTextAlign, setCurrentTextAlign] = useState<TextAlignKey | null>('left');

  // 行距状态
  const [currentLineHeight, setCurrentLineHeight] = useState<LineHeightKey | null>(null);
  const [isMixedLineHeight, setIsMixedLineHeight] = useState(false);

  // Outline 状态
  const [showOutline, setShowOutline] = useState(true);
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const [lexicalEditor, setLexicalEditor] = useState<LexicalEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // 文档切换时重置编辑器相关状态
  useEffect(() => {
    // 清空大纲和编辑器引用，等待新文档加载后重新生成
    setOutlineItems([]);
    setActiveOutlineId(null);
    setLexicalEditor(null);
    // 同时清空 Copilot 的编辑器引用
    setCopilotEditor(null);
  }, [activeTab?.id]);

  // DocAgent 状态（Summarizer）
  const [docAgentState, setDocAgentState] = useState<DocumentSummarizerState | null>(null);
  const [showDocAgentPanel, setShowDocAgentPanel] = useState(false);
  const docAgentRef = useRef<DocumentSummarizerAgent | null>(null);

  // TranslateAgent 状态
  const [translateAgentState, setTranslateAgentState] = useState<TranslateAgentState | null>(null);
  const translateAgentRef = useRef<DocumentTranslateAgent | null>(null);

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: React.ReactNode;
    onConfirm: () => void;
  } | null>(null);

  // 处理字号变更
  const handleFontSizeChange = useCallback((size: FontSizeKey) => {
    if (editorRef.current) {
      editorRef.current.applyFontSize(size);
    }
  }, []);

  // 处理对齐变更
  const handleTextAlignChange = useCallback((align: TextAlignKey) => {
    if (editorRef.current) {
      editorRef.current.applyTextAlign(align);
    }
  }, []);

  // 处理行距变更
  const handleLineHeightChange = useCallback((lineHeight: LineHeightKey) => {
    if (editorRef.current) {
      editorRef.current.applyLineHeight(lineHeight);
    }
  }, []);

  // 处理 Outline 项点击
  const handleOutlineItemClick = useCallback((id: string) => {
    setActiveOutlineId(id);
    // 滚动到对应位置
    if (editorContainerRef.current) {
      const element = editorContainerRef.current.querySelector(`[data-lexical-node-key="${id}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, []);

  // AI 处理状态
  const [isAiProcessingState, setIsAiProcessingState] = useState(false);

  // 订阅 AI 处理状态变化
  useEffect(() => {
    const unsubscribe = subscribeAiProcessing(setIsAiProcessingState);
    return unsubscribe;
  }, []);

  // 处理章节 AI 操作（统一入口）
  const handleSectionAction = useCallback(async (action: string, headingId: string) => {
    console.log('[App] Section action:', action, headingId);
    
    if (!lexicalEditor) {
      addToast('编辑器未就绪', 'error');
      return;
    }

    // 映射旧的 action 字符串到新的 SectionAiAction
    let sectionAction: SectionAiAction;
    switch (action) {
      case 'rewrite':
      case 'rewrite-formal':
      case 'rewrite-concise':
        sectionAction = 'rewrite';
        break;
      case 'summarize':
        sectionAction = 'summarize';
        break;
      case 'expand':
        sectionAction = 'expand';
        break;
      case 'translate-en':
      case 'translate-zh':
        // 翻译暂时用 rewrite 代替，未来可扩展
        addToast('章节翻译功能开发中', 'info');
        return;
      default:
        sectionAction = 'rewrite';
    }

    // 调用统一的 Section AI 动作
    await runSectionAiAction(sectionAction, headingId, {
      editor: lexicalEditor,
      toast: { addToast, dismissToast },
      setAiProcessing: setIsAiProcessingState,
    });
  }, [lexicalEditor, addToast, dismissToast]);

  // 处理逐节总结
  const handleSummarizeAll = useCallback(() => {
    if (!lexicalEditor) {
      addToast('编辑器未就绪', 'error');
      return;
    }

    // 检查是否已有任务在运行
    if (docAgentRef.current && docAgentState?.overallStatus === 'running') {
      addToast('已有逐节总结任务在运行', 'info');
      return;
    }

    // 确认对话框
    const confirmed = window.confirm(
      '将为每个二级/三级标题下的内容生成摘要，并在该节末尾插入「本节总结」段落。\n\n' +
      '此操作不会删除原文，可通过撤销恢复。\n\n' +
      '是否继续？'
    );

    if (!confirmed) return;

    // 创建并启动 Agent
    const agent = createDocumentSummarizerAgent(
      lexicalEditor,
      { minHeadingLevel: 2, language: 'zh' },
      (state) => {
        setDocAgentState(state);
        
        // 任务完成时显示提示
        if (state.overallStatus === 'success') {
          addToast(`已为 ${state.successCount} 个章节生成总结`, 'success');
        } else if (state.overallStatus === 'error') {
          addToast(`完成，但有 ${state.errorCount} 个章节失败`, 'error');
        } else if (state.overallStatus === 'canceled') {
          addToast('已取消逐节总结', 'info');
        }
      }
    );

    docAgentRef.current = agent;
    setShowDocAgentPanel(true);
    
    // 启动任务
    agent.run().catch(error => {
      console.error('[App] DocAgent error:', error);
      addToast('逐节总结失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error');
    });
  }, [lexicalEditor, docAgentState, addToast]);

  // 取消逐节总结
  const handleCancelDocAgent = useCallback(() => {
    if (docAgentRef.current) {
      docAgentRef.current.cancel();
    }
  }, []);

  // 关闭 DocAgent 面板
  const handleCloseDocAgentPanel = useCallback(() => {
    setShowDocAgentPanel(false);
    // 如果任务已完成，清理状态
    if (docAgentState?.overallStatus !== 'running') {
      setDocAgentState(null);
      docAgentRef.current = null;
    }
  }, [docAgentState]);

  // 处理整篇翻译
  const handleTranslateDocument = useCallback((direction: TranslateDirection) => {
    if (!lexicalEditor) {
      addToast('编辑器未就绪', 'error');
      return;
    }

    // 检查是否已有任务在运行
    if (translateAgentRef.current && translateAgentState?.status === 'running') {
      addToast('已有翻译任务在运行', 'info');
      return;
    }

    const directionLabel = direction === 'en_to_zh' ? '翻译为中文' : '翻译为英文';

    // 显示确认对话框
    setConfirmDialog({
      open: true,
      title: `整篇文档${directionLabel}`,
      description: (
        <div>
          <p>将按章节翻译整篇文档：</p>
          <ul>
            <li>尽量保留原文的样式和格式</li>
            <li>翻译结果会直接覆盖原文</li>
            <li>可通过「撤销」恢复</li>
          </ul>
          <p style={{ marginTop: 12 }}>是否继续？</p>
        </div>
      ),
      onConfirm: () => {
        setConfirmDialog(null);
        startTranslateAgent(direction);
      },
    });
  }, [lexicalEditor, translateAgentState, addToast]);

  // 启动翻译 Agent
  const startTranslateAgent = useCallback((direction: TranslateDirection) => {
    if (!lexicalEditor) return;

    const docOps = createSectionDocOps(lexicalEditor);
    
    // 创建 LLM API 适配器（通过 IPC 调用）
    const llmApi = {
      translateHtmlSection: async (html: string, options: { direction: TranslateDirection }): Promise<string> => {
        const response = await window.aiDoc?.translateHtmlSection(html, options.direction);
        if (!response?.success || !response.text) {
          throw new Error(response?.error || '翻译失败');
        }
        return response.text;
      },
    };

    // 创建 Agent
    const agent = new DocumentTranslateAgent(
      {
        docOps,
        llm: {
          translateHtmlSection: llmApi.translateHtmlSection,
          summarizeSection: async () => '',
        },
      },
      activeTab?.id || 'doc',
      {
        direction,
        onStateChange: (state: TranslateAgentState) => {
          setTranslateAgentState(state);

          // 任务完成时显示提示
          if (state.status === 'success') {
            addToast(`已翻译 ${state.successCount} 个章节`, 'success');
          } else if (state.status === 'error') {
            addToast(`翻译完成，但有 ${state.errorCount} 个章节失败`, 'error');
          } else if (state.status === 'canceled') {
            addToast('已取消翻译', 'info');
          }
        },
      }
    );

    translateAgentRef.current = agent;
    setShowDocAgentPanel(true);

    // 初始化并运行
    agent.init().then(() => {
      return agent.run();
    }).catch((error: Error | unknown) => {
      console.error('[App] TranslateAgent error:', error);
      addToast('翻译失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error');
    });
  }, [lexicalEditor, activeTab, addToast]);

  // 取消翻译
  const handleCancelTranslate = useCallback(() => {
    if (translateAgentRef.current) {
      translateAgentRef.current.cancel();
    }
  }, []);

  // 关闭确认对话框
  const handleCloseConfirmDialog = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  // 更新 ref（避免循环依赖）
  translateDocumentRef.current = handleTranslateDocument;
  summarizeAllRef.current = handleSummarizeAll;

  // 处理编辑器就绪
  const handleEditorReady = useCallback((editor: LexicalEditor) => {
    setLexicalEditor(editor);
    // 同时更新 Copilot 的编辑器引用
    setCopilotEditor(editor);
  }, []);

  // 同步 Toast 回调到 Copilot
  useEffect(() => {
    setCopilotToast({ addToast, dismissToast });
    return () => setCopilotToast(null);
  }, [addToast, dismissToast]);

  // 处理 Outline 更新
  // 使用 ref 存储当前文档 ID，避免闭包问题
  const currentDocIdRef = useRef<string | null>(null);
  currentDocIdRef.current = activeTab?.id ?? null;

  const handleOutlineUpdate = useCallback((items: OutlineItem[], docId?: string) => {
    // 如果传入了 docId，验证是否是当前文档
    // 如果没传 docId，直接更新（兼容旧调用方式）
    if (docId && docId !== currentDocIdRef.current) {
      console.log('[App] Ignoring outline update for non-active doc:', docId, 'current:', currentDocIdRef.current);
      return;
    }
    setOutlineItems(items);
  }, []);

  // 处理编辑器状态变化
  const handleEditorStateChange = useCallback((state: {
    activeCommands: RibbonCommandId[];
    canUndo: boolean;
    canRedo: boolean;
    hasSelection: boolean;
    currentFontKey?: FontOptionKey | null;
    isMixedFont?: boolean;
    currentFontSize?: FontSizeKey | null;
    isMixedFontSize?: boolean;
    currentTextAlign?: TextAlignKey | null;
    currentLineHeight?: LineHeightKey | null;
    isMixedLineHeight?: boolean;
  }) => {
    setActiveCommands(state.activeCommands);
    setCurrentFontKey(state.currentFontKey ?? null);
    setIsMixedFont(state.isMixedFont ?? false);
    setCurrentFontSize(state.currentFontSize ?? null);
    setIsMixedFontSize(state.isMixedFontSize ?? false);
    setCurrentTextAlign(state.currentTextAlign ?? 'left');
    setCurrentLineHeight(state.currentLineHeight ?? null);
    setIsMixedLineHeight(state.isMixedLineHeight ?? false);
  }, []);

  // 计算禁用的命令
  const getDisabledCommands = useCallback((): RibbonCommandId[] => {
    const disabled: RibbonCommandId[] = [];
    
    if (!activeTab || currentView.type !== 'doc') {
      disabled.push(
        'file:save', 'file:save-as',
        'edit:undo', 'edit:redo',
        'clipboard:cut', 'clipboard:copy', 'clipboard:paste', 'clipboard:format-painter',
        'font:bold', 'font:italic', 'font:underline', 'font:strikethrough', 'font:clear-format',
        'paragraph:align-left', 'paragraph:align-center', 'paragraph:align-right',
        'paragraph:list-bullet', 'paragraph:list-number',
        'style:heading-1', 'style:heading-2', 'style:heading-3', 'style:paragraph',
        'ai:rewrite',
        'tools:show-paragraph-marks'
      );
    }
    return disabled;
  }, [activeTab, currentView]);

  // 渲染编辑视图
  const renderEditorView = () => {
    if (!activeTab) {
      return <NewDocView />;
    }

    return (
      <div className="editor-view">
        {/* Ribbon Zone */}
        <div className="ribbon-zone">
          <Ribbon
            tabs={DEFAULT_TABS}
            activeTabId={activeRibbonTab}
            onTabChange={setActiveRibbonTab}
            onCommand={handleRibbonCommand}
            activeCommands={activeCommands}
            disabledCommands={getDisabledCommands()}
            currentFontKey={currentFontKey}
            isMixedFont={isMixedFont}
            onFontChange={handleFontChange}
            currentFontSize={currentFontSize}
            isMixedFontSize={isMixedFontSize}
            onFontSizeChange={handleFontSizeChange}
            currentTextAlign={currentTextAlign}
            onTextAlignChange={handleTextAlignChange}
            currentLineHeight={currentLineHeight}
            isMixedLineHeight={isMixedLineHeight}
            onLineHeightChange={handleLineHeightChange}
            showOutline={showOutline}
          />
          {/* Section AI Actions - Ribbon 扩展 */}
          <div className="ribbon-section-ai">
            <AiSectionActions
              editor={lexicalEditor}
              isProcessing={isAiProcessingState}
              onAction={handleSectionAction}
              onShowMessage={(msg) => addToast(msg, 'info')}
            />
          </div>
        </div>
        
        {/* Document Workspace with Outline */}
        <div className="document-workspace-with-outline">
          {/* Outline Pane */}
          {showOutline && (
            <OutlinePane
              items={outlineItems}
              activeItemId={activeOutlineId}
              onItemClick={handleOutlineItemClick}
              onSectionAction={handleSectionAction}
              onSummarizeAll={handleSummarizeAll}
              visible={showOutline}
              onClose={() => setShowOutline(false)}
            />
          )}
          
          {/* Document Workspace */}
          <div className="document-workspace" ref={editorContainerRef}>
            <DocumentSurface>
              <EditorContainer
                ref={editorRef}
                key={activeTab.id}
                initialHtml={activeTab.html}
                initialAst={activeTab.ast}
                documentId={activeTab.id}
                onDirty={handleDirty}
                onSave={handleSave}
                onStateChange={handleEditorStateChange}
                onEditorReady={handleEditorReady}
                onOutlineUpdate={handleOutlineUpdate}
              />
            </DocumentSurface>
            
            {/* 保存状态栏 */}
            <SaveStatusBar
              status={saveStatus}
              isDirty={activeTab.isDirty || false}
              lastSavedAt={lastSavedAt}
              error={saveError}
              visible={true}
            />
          </div>
        </div>
      </div>
    );
  };

  // 渲染主内容
  const renderMainContent = () => {
    switch (currentView.type) {
      case 'new':
        return <NewDocView />;
      case 'open':
        return <OpenDocView />;
      case 'files':
        return <DocumentManagerView />;
      case 'doc':
        return renderEditorView();
      default:
        return <NewDocView />;
    }
  };

  return (
    <>
      <LiquidGlassFilter />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      
      {/* DocAgent 任务面板 */}
      <DocAgentPanel
        state={docAgentState}
        translateState={translateAgentState}
        onCancel={translateAgentState ? handleCancelTranslate : handleCancelDocAgent}
        onClose={handleCloseDocAgentPanel}
        visible={showDocAgentPanel}
      />

      {/* 确认对话框 */}
      {confirmDialog && (
        <ConfirmDialog
          open={confirmDialog.open}
          title={confirmDialog.title}
          description={confirmDialog.description}
          onConfirm={confirmDialog.onConfirm}
          onCancel={handleCloseConfirmDialog}
          confirmText="开始"
          cancelText="取消"
        />
      )}

      <div className="ai-shell">
        {/* 顶部工具栏 */}
        <header className="ai-top-chrome">
          <div className="ai-top-chrome-left">
            <div className="traffic-light-spacer" />
            <span className="ai-title">AI Office</span>
          </div>
          <div className="ai-top-chrome-right">
            <button 
              className={`copilot-toggle-btn ${showCopilot ? 'active' : ''}`}
              onClick={() => setShowCopilot(prev => !prev)}
              title="Copilot"
              aria-label="切换 Copilot 面板"
            >
              <Icon name="Sparkles" size={16} />
              <span>Copilot</span>
            </button>
          </div>
        </header>

        {/* 主体区域 */}
        <div className="ai-body">
          {/* 左侧导航栏 */}
          <nav className="ai-sidebar">
            {/* 主导航 */}
            <div className="sidebar-nav">
              <NavItem
                icon={<Icon name="Plus" size={20} />}
                label="新建"
                active={currentView.type === 'new'}
                onClick={() => handleNavClick('new')}
              />
              <NavItem
                icon={<Icon name="FolderOpen" size={20} />}
                label="打开"
                active={currentView.type === 'open'}
                onClick={() => handleNavClick('open')}
              />
              <NavItem
                icon={<Icon name="FileText" size={20} />}
                label="文件"
                active={currentView.type === 'files'}
                onClick={() => handleNavClick('files')}
              />
            </div>

            {/* 分隔线 */}
            {openTabs.length > 0 && <div className="sidebar-divider" />}

            {/* 打开的文档 */}
            {openTabs.length > 0 && (
              <div className="sidebar-section">
                <div className="sidebar-section-title">打开的文档</div>
                <div className="file-tab-list">
                  {openTabs.map(tab => (
                    <FileTabItem
                      key={tab.id}
                      fileName={tab.fileName}
                      isActive={currentView.type === 'doc' && currentView.docId === tab.id}
                      isDirty={tab.isDirty}
                      onClick={() => handleTabClick(tab.id)}
                      onClose={() => handleCloseDocument(tab.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 底部个人入口 */}
            <div className="sidebar-footer">
              <button className="user-avatar" onClick={() => console.log('User profile')}>
                <span>木</span>
              </button>
            </div>
          </nav>

          {/* 右侧主画布 */}
          <main className="ai-canvas">
            {renderMainContent()}
          </main>

          {/* Copilot 侧边栏 */}
          <CopilotPanel 
            visible={showCopilot} 
            onClose={() => setShowCopilot(false)} 
          />
        </div>
      </div>

      {/* 崩溃恢复对话框 */}
      <RecoveryDialog
        open={showRecoveryDialog}
        documents={recoveryDocuments}
        onRecover={handleRecover}
        onIgnore={handleIgnoreRecovery}
        onIgnoreAll={handleIgnoreAllRecovery}
        onClose={() => setShowRecoveryDialog(false)}
      />
    </>
  );
};

import { ErrorBoundary } from './components/ErrorBoundary';

// ==========================================
// App with Provider
// ==========================================

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
};

export default App;
