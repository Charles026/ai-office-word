/**
 * Preload 脚本
 * 
 * 在渲染进程和主进程之间安全地暴露 API。
 */

import { contextBridge, ipcRenderer } from 'electron';

// ==========================================
// 路径操作辅助函数（纯 JS 实现，不依赖 Node path 模块）
// ==========================================

const pathUtils = {
  /**
   * 连接路径
   */
  join: (...paths: string[]): string => {
    return paths
      .map((part, index) => {
        if (index === 0) {
          return part.replace(/\/$/, '');
        }
        return part.replace(/^\//, '').replace(/\/$/, '');
      })
      .filter(part => part.length > 0)
      .join('/');
  },

  /**
   * 获取文件名
   */
  basename: (p: string, ext?: string): string => {
    const parts = p.split(/[/\\]/);
    let name = parts[parts.length - 1] || '';
    if (ext && name.endsWith(ext)) {
      name = name.slice(0, -ext.length);
    }
    return name;
  },

  /**
   * 获取扩展名
   */
  extname: (p: string): string => {
    const basename = pathUtils.basename(p);
    const dotIndex = basename.lastIndexOf('.');
    if (dotIndex <= 0) return '';
    return basename.slice(dotIndex);
  },

  /**
   * 获取目录名
   */
  dirname: (p: string): string => {
    const parts = p.split(/[/\\]/);
    parts.pop();
    return parts.join('/') || '/';
  },
};

// ==========================================
// 文件操作 API
// ==========================================

const aiFileAPI = {
  /**
   * 新建 docx 文档
   */
  newDocx: (): Promise<{ filePath: string; fileName: string } | null> => {
    return ipcRenderer.invoke('file:new-docx');
  },

  /**
   * 打开已有的 docx 文档（仅返回路径）
   */
  openDocx: (): Promise<{ filePath: string; fileName: string } | null> => {
    return ipcRenderer.invoke('file:open-docx');
  },

  /**
   * 获取当前文档引擎信息
   */
  getEngineInfo: (): Promise<{
    current: { name: string; available: boolean; type: string | null };
    available: Array<{ type: string; name: string; available: boolean; description: string }>;
  }> => {
    return ipcRenderer.invoke('file:get-engine-info');
  },

  /**
   * 列出文档目录中的文件
   */
  listDocs: (directory?: string): Promise<{
    success: boolean;
    docs?: Array<{
      name: string;
      fullPath: string;
      updatedAt: number;
      createdAt: number;
      sizeBytes: number;
    }>;
    error?: string;
  }> => {
    return ipcRenderer.invoke('file:list-docs', { directory });
  },

  /**
   * 删除文档
   */
  deleteDoc: (filePath: string): Promise<{
    success: boolean;
    error?: string;
  }> => {
    return ipcRenderer.invoke('file:delete-doc', filePath);
  },

  /**
   * 重命名文档
   */
  renameDoc: (oldPath: string, newName: string): Promise<{
    success: boolean;
    newPath?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('file:rename-doc', { oldPath, newName });
  },
};

// ==========================================
// 格式转换 API（AST 驱动）
// ==========================================

const aiFormatAPI = {
  /**
   * 从 docx 导入为 AST
   * 
   * @param filePath - docx 文件路径
   * @returns { ast, html, warnings, filePath, fileName } 或错误
   */
  importDocx: (filePath: string): Promise<{
    success: boolean;
    ast?: any; // DocumentAst
    html?: string; // HTML content
    warnings?: string[];
    filePath?: string;
    fileName?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('format:import-docx', { filePath });
  },

  /**
   * 将 AST 或 HTML 导出为 docx
   * 
   * @param filePath - 目标文件路径
   * @param content - 文档内容 (AST 或 HTML string)
   */
  exportDocx: (filePath: string, content: any): Promise<{
    success: boolean;
    filePath?: string;
    error?: string;
  }> => {
    const args: any = { filePath };
    if (typeof content === 'string') {
      args.html = content;
    } else {
      args.ast = content;
    }
    return ipcRenderer.invoke('format:export-docx', args);
  },

  /**
   * 另存为（显示文件选择对话框）
   * 
   * @param content - 文档内容 (AST 或 HTML string)
   * @param defaultPath - 默认保存路径（可选）
   */
  saveAsDocx: (content: any, defaultPath?: string): Promise<{
    success: boolean;
    filePath?: string;
    error?: string;
  }> => {
    const args: any = { defaultPath };
    if (typeof content === 'string') {
      args.html = content;
    } else {
      args.ast = content;
    }
    return ipcRenderer.invoke('format:save-as-docx', args);
  },

  /**
   * 打开文件对话框并导入
   */
  openAndImport: (): Promise<{
    success: boolean;
    ast?: any;
    html?: string; // HTML content
    warnings?: string[];
    filePath?: string;
    fileName?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('format:open-and-import');
  },

  /**
   * 获取格式引擎状态
   */
  getStatus: (): Promise<{
    available: boolean;
    engine: string;
  }> => {
    return ipcRenderer.invoke('format:get-status');
  },
};

// ==========================================
// 编辑器 API（旧版 HTML 模式，保留兼容）
// ==========================================

const aiEditorAPI = {
  openDocxForEdit: (filePath: string): Promise<{
    filePath: string;
    fileName: string;
    html: string;
  }> => {
    return ipcRenderer.invoke('editor:open-docx', { filePath });
  },

  saveDocx: (filePath: string, html: string): Promise<boolean> => {
    return ipcRenderer.invoke('editor:save-docx', { filePath, html });
  },

  getStatus: (): Promise<{
    libreOfficeAvailable: boolean;
    engineType: string;
    engineName: string;
    errorMessage?: string;
  }> => {
    return ipcRenderer.invoke('editor:get-status');
  },
};

// ==========================================
// AI 文档操作 API
// ==========================================

interface RewriteSelectionRequest {
  ast?: any; // DocumentAst (optional for Lexical mode)
  selection?: any; // DocSelection (optional for Lexical mode)
  selectionText?: string; // Direct text input for Lexical
  userPrompt: string;
}

interface RewriteSelectionResponse {
  success: boolean;
  newText?: string;
  ops?: any[]; // DocOp[]
  error?: string;
  latencyMs?: number;
}

// ==========================================
// DocAgent 类型（新版 API）
// ==========================================

type RewriteTone = 'formal' | 'concise' | 'friendly';
type TranslateTargetLang = 'en' | 'zh';
type DocAgentAction = 'replace' | 'insertAfter';

interface DocAgentIntent {
  type: 'rewrite' | 'summarize' | 'translate' | 'custom';
  tone?: RewriteTone;
  targetLang?: TranslateTargetLang;
  customPrompt?: string;
}

interface DocAgentRequest {
  selectionText: string;
  intent: DocAgentIntent;
}

interface DocAgentResponse {
  success: boolean;
  text?: string;
  action: DocAgentAction;
  error?: string;
  latencyMs?: number;
}

// 章节级 AI 类型
type SectionIntentType = 'rewriteSection' | 'summarizeSection' | 'translateSection';

interface SectionIntent {
  type: SectionIntentType;
  tone?: RewriteTone;
  targetLang?: TranslateTargetLang;
  userPrompt?: string;
}

interface SectionInfo {
  title: string;
  content: string;
}

interface SectionAgentRequest {
  intent: SectionIntent;
  section: SectionInfo;
}

const aiDocAPI = {
  /**
   * AI 改写选区（旧版 API，保留兼容）
   */
  rewriteSelection: (request: RewriteSelectionRequest): Promise<RewriteSelectionResponse> => {
    return ipcRenderer.invoke('ai:rewrite-selection', request);
  },

  /**
   * DocAgent 统一入口（新版 API）- 选区级
   * 
   * 支持所有 AI 操作：rewrite、summarize、translate、custom
   */
  handleSelection: (request: DocAgentRequest): Promise<DocAgentResponse> => {
    return ipcRenderer.invoke('ai:doc-agent', request);
  },

  /**
   * DocAgent 统一入口 - 章节级
   * 
   * 支持章节级 AI 操作：rewriteSection、summarizeSection、translateSection
   */
  handleSection: (request: SectionAgentRequest): Promise<DocAgentResponse> => {
    return ipcRenderer.invoke('ai:doc-agent-section', request);
  },

  /**
   * 获取 AI 服务状态
   */
  getStatus: (): Promise<{
    available: boolean;
    model?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('ai:get-status');
  },

  /**
   * AI 聊天（不绑定文档）
   */
  chat: (request: {
    messages: Array<{ role: string; content: string }>;
  }): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('ai:chat', request);
  },

  /**
   * AI 生成文档初稿
   */
  bootstrapDocument: (request: {
    prompt: string;
  }): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke('ai:bootstrap-document', request);
  },

  /**
   * 总结章节（用于 DocumentSummarizerAgent）
   */
  summarizeSection: (text: string, options?: {
    language?: 'zh' | 'en';
    style?: 'formal' | 'casual';
  }): Promise<{
    success: boolean;
    text?: string;
    error?: string;
    latencyMs?: number;
  }> => {
    return ipcRenderer.invoke('ai:summarize-section', { text, options });
  },

  /**
   * 翻译 HTML 章节（用于 DocumentTranslateAgent）
   * 
   * 保格式翻译：尽量保留 HTML 结构
   */
  translateHtmlSection: (html: string, direction: 'en_to_zh' | 'zh_to_en'): Promise<{
    success: boolean;
    text?: string;
    error?: string;
    latencyMs?: number;
  }> => {
    return ipcRenderer.invoke('ai:translate-html-section', { html, direction });
  },
};

// ==========================================
// Electron API（文件系统操作，供 RecentDocumentsStore / SnapshotService 使用）
// ==========================================

const electronAPI = {
  /**
   * 获取 Electron 应用路径
   */
  getAppPath: (name: 'userData' | 'documents' | 'home'): Promise<string> => {
    return ipcRenderer.invoke('app:get-path', name);
  },

  /**
   * 读取文件内容
   */
  readFile: (filePath: string): Promise<string | null> => {
    return ipcRenderer.invoke('fs:read-file', filePath);
  },

  /**
   * 写入文件内容
   */
  writeFile: (filePath: string, content: string): Promise<boolean> => {
    return ipcRenderer.invoke('fs:write-file', { filePath, content });
  },

  /**
   * 检查文件是否存在
   */
  fileExists: (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke('fs:file-exists', filePath);
  },

  /**
   * 确保目录存在
   */
  ensureDir: (dirPath: string): Promise<boolean> => {
    return ipcRenderer.invoke('fs:ensure-dir', dirPath);
  },

  /**
   * 复制文件
   */
  copyFile: (src: string, dest: string): Promise<boolean> => {
    return ipcRenderer.invoke('fs:copy-file', { src, dest });
  },

  /**
   * 读取目录内容
   */
  readDir: (dirPath: string): Promise<string[] | null> => {
    return ipcRenderer.invoke('fs:read-dir', dirPath);
  },

  /**
   * 删除文件
   */
  deleteFile: (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke('fs:delete-file', filePath);
  },

  /**
   * 删除目录（递归）
   */
  removeDir: (dirPath: string): Promise<boolean> => {
    return ipcRenderer.invoke('fs:remove-dir', dirPath);
  },

  /**
   * 路径操作（纯 JS 实现）
   */
  path: pathUtils,

  /**
   * 发送 Agent 日志事件
   */
  sendAgentLog: (event: unknown): void => {
    ipcRenderer.send('agent-log:event', event);
  },

  /**
   * 获取 Agent 日志文件路径
   */
  getAgentLogPath: (): Promise<string | null> => {
    return ipcRenderer.invoke('agent-log:get-path');
  },
};

// ==========================================
// 暴露到渲染进程
// ==========================================

contextBridge.exposeInMainWorld('aiFile', aiFileAPI);
contextBridge.exposeInMainWorld('aiFormat', aiFormatAPI);
contextBridge.exposeInMainWorld('aiEditor', aiEditorAPI);
contextBridge.exposeInMainWorld('aiDoc', aiDocAPI);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
