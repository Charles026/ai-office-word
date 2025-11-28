/**
 * Window 类型声明
 */

import { DocumentAst } from '../document/types';
import { DocSelection, DocOp } from '../docops/types';

// ==========================================
// 文件 API 类型
// ==========================================

interface FileResult {
  filePath: string;
  fileName: string;
}

interface EngineInfo {
  current: {
    name: string;
    available: boolean;
    type: string | null;
  };
  available: Array<{
    type: string;
    name: string;
    available: boolean;
    description: string;
  }>;
}

interface AiFileAPI {
  newDocx(): Promise<FileResult | null>;
  openDocx(): Promise<FileResult | null>;
  getEngineInfo(): Promise<EngineInfo>;
  listDocs(directory?: string): Promise<{
    success: boolean;
    docs?: Array<{
      name: string;
      fullPath: string;
      updatedAt: number;
      createdAt: number;
      sizeBytes: number;
    }>;
    error?: string;
  }>;
  deleteDoc(filePath: string): Promise<{ success: boolean; error?: string }>;
  renameDoc(oldPath: string, newName: string): Promise<{ success: boolean; newPath?: string; error?: string }>;
}

// ==========================================
// Electron API 类型（文件系统操作）
// ==========================================

interface ElectronAPI {
  getAppPath(name: 'userData' | 'documents' | 'home'): Promise<string>;
  readFile(filePath: string): Promise<string | null>;
  writeFile(filePath: string, content: string): Promise<boolean>;
  fileExists(filePath: string): Promise<boolean>;
  ensureDir(dirPath: string): Promise<boolean>;
  copyFile(src: string, dest: string): Promise<boolean>;
  readDir(dirPath: string): Promise<string[] | null>;
  deleteFile(filePath: string): Promise<boolean>;
  removeDir(dirPath: string): Promise<boolean>;
  path: {
    join(...paths: string[]): string;
    basename(p: string, ext?: string): string;
    extname(p: string): string;
    dirname(p: string): string;
  };
  /** 发送 Agent 日志事件 */
  sendAgentLog(event: unknown): void;
  /** 获取 Agent 日志文件路径 */
  getAgentLogPath(): Promise<string | null>;
}

// ==========================================
// 格式转换 API 类型（AST 驱动）
// ==========================================

interface ImportDocxResult {
  success: boolean;
  ast?: DocumentAst;
  html?: string; // HTML content
  warnings?: string[];
  filePath?: string;
  fileName?: string;
  error?: string;
}

interface ExportDocxResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

interface FormatStatus {
  available: boolean;
  engine: string;
}

interface AiFormatAPI {
  /**
   * 从 docx 导入为 AST
   */
  importDocx(filePath: string): Promise<ImportDocxResult>;

  /**
   * 将 AST 或 HTML 导出为 docx
   */
  exportDocx(filePath: string, content: any): Promise<ExportDocxResult>;

  /**
   * 另存为（显示文件选择对话框）
   */
  saveAsDocx(content: any, defaultPath?: string): Promise<ExportDocxResult>;

  /**
   * 打开文件对话框并导入
   */
  openAndImport(): Promise<ImportDocxResult>;

  /**
   * 获取格式引擎状态
   */
  getStatus(): Promise<FormatStatus>;
}

// ==========================================
// 编辑器 API 类型（旧版 HTML 模式）
// ==========================================

interface OpenDocForEditResult {
  filePath: string;
  fileName: string;
  html: string;
}

interface EditorStatus {
  libreOfficeAvailable: boolean;
  engineType: string;
  engineName: string;
  errorMessage?: string;
}

interface AiEditorAPI {
  openDocxForEdit(filePath: string): Promise<OpenDocForEditResult>;
  saveDocx(filePath: string, html: string): Promise<boolean>;
  getStatus(): Promise<EditorStatus>;
}

// ==========================================
// AI 文档操作 API 类型
// ==========================================

interface RewriteSelectionRequest {
  ast?: DocumentAst;
  selection?: DocSelection;
  selectionText?: string; // Plain text selection for Lexical integration
  userPrompt: string;
}

interface RewriteSelectionResponse {
  success: boolean;
  newText?: string;
  ops?: DocOp[];
  error?: string;
  latencyMs?: number;
}

interface AiStatus {
  available: boolean;
  model?: string;
  error?: string;
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

// ==========================================
// 章节级 AI 类型
// ==========================================

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

// 总结选项
interface SummarizeSectionOptions {
  language?: 'zh' | 'en';
  style?: 'formal' | 'casual';
}

// LLM 响应
interface LlmResponse {
  success: boolean;
  text?: string;
  error?: string;
  latencyMs?: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AiDocAPI {
  /**
   * AI 改写选区（旧版 API，保留兼容）
   */
  rewriteSelection(request: RewriteSelectionRequest): Promise<RewriteSelectionResponse>;

  /**
   * DocAgent 统一入口（新版 API）- 选区级
   */
  handleSelection(request: DocAgentRequest): Promise<DocAgentResponse>;

  /**
   * DocAgent 统一入口 - 章节级
   */
  handleSection(request: SectionAgentRequest): Promise<DocAgentResponse>;

  /**
   * 总结章节（用于 DocumentSummarizerAgent）
   */
  summarizeSection(text: string, options?: SummarizeSectionOptions): Promise<LlmResponse>;

  /**
   * 翻译 HTML 章节（用于 DocumentTranslateAgent）
   * 
   * 保格式翻译：尽量保留 HTML 结构
   */
  translateHtmlSection(html: string, direction: 'en_to_zh' | 'zh_to_en'): Promise<LlmResponse>;

  /**
   * 通用 Chat 接口
   * 
   * 用于 Section AI 等需要自定义 Prompt 的场景
   */
  chat(request: { messages: ChatMessage[] }): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }>;

  /**
   * 获取 AI 服务状态
   */
  getStatus(): Promise<AiStatus>;
}

// ==========================================
// Window 扩展
// ==========================================

declare global {
  interface Window {
    /**
     * AI Office 文件操作 API
     */
    aiFile: AiFileAPI;

    /**
     * AI Office 格式转换 API（AST 驱动）
     */
    aiFormat: AiFormatAPI;

    /**
     * AI Office 编辑器 API（旧版 HTML 模式）
     */
    aiEditor: AiEditorAPI;

    /**
     * AI Office AI 文档操作 API
     * 
     * 用于 AI 改写、翻译等功能
     */
    aiDoc: AiDocAPI;

    /**
     * Electron API（文件系统操作）
     */
    electronAPI: ElectronAPI;
  }
}

export {};
