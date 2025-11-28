/**
 * DocumentEngine 接口定义
 * 
 * 这是文档内核的抽象层，用于屏蔽底层实现差异。
 * 
 * 当前支持的实现：
 * - SimpleDocxEngine: 使用纯 JS 的 docx 库创建 docx 文件（只支持创建，不支持编辑）
 * - LibreOfficeEngine: 通过 LibreOffice CLI 实现完整的文档操作
 * 
 * 未来计划：
 * - LibreOfficeKit 深度集成：通过 C/C++ API 实现 tiled rendering
 * - Collabora Online 集成：支持实时协作编辑
 */

// import * as path from 'path';

// ==========================================
// 类型定义
// ==========================================

/**
 * 创建空白文档的选项
 */
export interface CreateBlankDocxOptions {
  /** 默认文件名（不含路径） */
  defaultName?: string;
  /** 初始保存目录 */
  initialDirectory?: string;
  /** 文档模板路径（可选） */
  templatePath?: string;
}

/**
 * 创建文档的结果
 */
export interface CreateDocxResult {
  filePath: string;
  fileName: string;
}

/**
 * 打开文档进行编辑的结果
 * 
 * 包含转换后的 HTML 内容，供前端富文本编辑器使用。
 * HTML 是 LibreOffice 从 docx 转换而来的中间格式。
 */
export interface OpenDocForEditingResult {
  /** 原始 docx 文件路径 */
  filePath: string;
  /** 文件名 */
  fileName: string;
  /** 转换后的 HTML 文件路径（在临时目录） */
  htmlPath: string;
  /** HTML 内容（UTF-8 字符串） */
  htmlContent: string;
}

/**
 * 打开文档的句柄（预留，将来接 LibreOfficeKit 时使用）
 */
export interface OpenedDocumentHandle {
  filePath: string;
  fileName: string;
  editable: boolean;
  pageCount?: number;
  close(): Promise<void>;
}

/**
 * 导出预览的选项
 */
export interface ExportPreviewOptions {
  format: 'thumbnail' | 'pdf' | 'png';
  pageIndex?: number;
  width?: number;
  height?: number;
}

/**
 * 文档元数据（预留）
 */
export interface DocumentMetadata {
  filePath: string;
  fileName: string;
  pageCount?: number;
  wordCount?: number;
  lastModified?: Date;
  author?: string;
}

// ==========================================
// 错误类型
// ==========================================

/**
 * LibreOffice 不可用错误
 */
export class LibreOfficeNotAvailableError extends Error {
  readonly code = 'LIBREOFFICE_NOT_FOUND';
  
  constructor(message = 'LibreOffice is not installed or not found on this system') {
    super(message);
    this.name = 'LibreOfficeNotAvailableError';
  }
}

/**
 * 文档转换错误
 */
export class DocumentConversionError extends Error {
  readonly code = 'CONVERSION_FAILED';
  
  constructor(message: string, public readonly details?: string) {
    super(message);
    this.name = 'DocumentConversionError';
  }
}

// ==========================================
// DocumentEngine 接口
// ==========================================

/**
 * 文档引擎抽象接口
 * 
 * 所有文档操作都必须通过此接口进行：
 * - 不允许在 React 或其他地方直接调用 fs/docx/soffice
 * - 便于将来替换为 LibreOfficeKit 或其他实现
 */
export interface DocumentEngine {
  /** 引擎名称 */
  readonly name: string;
  
  /** 引擎是否可用 */
  readonly available: boolean;

  /**
   * 创建空白 docx 文档
   * 
   * @param filePath - 保存路径
   * @param options - 创建选项
   */
  createBlankDocx(filePath: string, options?: CreateBlankDocxOptions): Promise<CreateDocxResult>;

  /**
   * 打开文档进行编辑
   * 
   * 将 docx 转换为 HTML 格式，供前端富文本编辑器使用。
   * 
   * 实现说明：
   * - SimpleDocxEngine: 不支持此操作，抛出错误
   * - LibreOfficeEngine: 调用 soffice --headless --convert-to html
   * 
   * @param filePath - docx 文件路径
   * @returns 包含 HTML 内容的结果对象
   * @throws LibreOfficeNotAvailableError - LibreOffice 未安装
   * @throws DocumentConversionError - 转换失败
   */
  openDocForEditing(filePath: string): Promise<OpenDocForEditingResult>;

  /**
   * 从 HTML 保存回 docx
   * 
   * 将编辑后的 HTML 内容转换回 docx 格式并保存。
   * 
   * 实现说明：
   * - SimpleDocxEngine: 不支持此操作，抛出错误
   * - LibreOfficeEngine: 
   *   1. 将 HTML 写入临时文件
   *   2. 调用 soffice --headless --convert-to docx
   *   3. 覆盖原文件
   * 
   * 注意：HTML → docx 的转换质量不会 100% 等同于 Word，
   * 这是可接受的第一阶段实现。未来可改用 LibreOfficeKit 提升保真度。
   * 
   * @param filePath - 目标 docx 文件路径
   * @param htmlContent - HTML 内容
   * @throws LibreOfficeNotAvailableError - LibreOffice 未安装
   * @throws DocumentConversionError - 转换失败
   */
  saveDocFromHtml(filePath: string, htmlContent: string): Promise<void>;

  /**
   * 打开已有文档（预留，用于 LibreOfficeKit 集成）
   */
  openDocx(filePath: string): Promise<OpenedDocumentHandle>;

  /**
   * 导出文档预览（预留）
   * 
   * 未来实现：
   * - CLI 模式：soffice --headless --convert-to png/pdf
   * - Kit 模式：使用 LOK tiled rendering API
   */
  exportPreview(filePath: string, options: ExportPreviewOptions): Promise<Buffer | string>;

  /**
   * 获取文档元数据（预留）
   * 
   * 用于在左侧 tab 列表中展示页数/修改时间等信息。
   */
  getMetadata?(filePath: string): Promise<DocumentMetadata>;
}

/**
 * 文档引擎类型
 */
export type DocumentEngineType = 'simple' | 'libreoffice-cli' | 'libreoffice-kit';

/**
 * 引擎状态信息
 */
export interface EngineStatus {
  type: DocumentEngineType;
  name: string;
  available: boolean;
  libreOfficePath?: string;
  errorMessage?: string;
}
