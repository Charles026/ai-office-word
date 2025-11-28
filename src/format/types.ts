/**
 * Format/Layout Engine 类型定义
 * 
 * 【层级职责】
 * Format/Layout Engine 层负责：
 * - 文档导入（docx/xlsx/pptx/markdown → AST）
 * - 文档导出（AST → docx/pdf/html）
 * - 分页排版（预留）
 * 
 * 【禁止事项】
 * - 不允许在 React 组件中直接调用此层（通过 IPC）
 * - 不允许修改 DocumentAst（只读取用于导出）
 * - 所有 LibreOffice 调用必须集中在此层的实现中
 */

import { DocumentAst } from '../document/types';

// ==========================================
// 文档格式
// ==========================================

/**
 * 支持的文档格式
 */
export type DocumentFormat = 
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'pdf'
  | 'html'
  | 'markdown'
  | 'odt'
  | 'txt';

// ==========================================
// 导入/导出
// ==========================================

/**
 * 导入结果
 */
export interface ImportResult {
  /** 解析后的 AST */
  ast: DocumentAst;
  /** 原始 HTML 内容（用于 Lexical 编辑器） */
  html?: string;
  /** 导入过程中的警告（如格式丢失、不支持的元素） */
  warnings: string[];
  /** 原始文件信息 */
  sourceInfo?: {
    filePath: string;
    format: DocumentFormat;
    fileSize: number;
  };
}

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 目标格式 */
  format?: DocumentFormat;
  /** 是否覆盖已存在的文件 */
  overwrite?: boolean;
  /** PDF 导出选项（预留） */
  pdfOptions?: {
    pageSize?: 'A4' | 'Letter' | 'Legal';
    orientation?: 'portrait' | 'landscape';
  };
}

/**
 * 导出结果
 */
export interface ExportResult {
  /** 是否成功 */
  success: boolean;
  /** 输出文件路径 */
  outputPath?: string;
  /** 错误信息 */
  error?: string;
}

// ==========================================
// FormatEngine 接口
// ==========================================

/**
 * 格式转换引擎接口
 * 
 * 所有格式转换实现都必须实现此接口。
 */
export interface FormatEngine {
  /** 引擎名称 */
  readonly name: string;

  /**
   * 检查引擎是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 从 docx 导入为 AST
   * 
   * @param filePath - docx 文件路径
   * @returns 导入结果（AST + 警告）
   */
  importFromDocx(filePath: string): Promise<ImportResult>;

  /**
   * 将 AST 导出为 docx
   * 
   * @param ast - 文档 AST
   * @param targetPath - 目标文件路径
   * @param options - 导出选项
   */
  exportToDocx(
    ast: DocumentAst,
    targetPath: string,
    options?: ExportOptions
  ): Promise<ExportResult>;

  /**
   * 将 HTML 导出为 docx
   */
  exportHtmlToDocx?(
    html: string,
    targetPath: string,
    options?: ExportOptions
  ): Promise<ExportResult>;
}

// ==========================================
// 序列化
// ==========================================

/**
 * 序列化的文档（用于 IPC 传输）
 * 
 * AST 通过 IPC 传输时会被 JSON 序列化/反序列化。
 * 这个类型用于明确表示传输的数据结构。
 */
export interface SerializedDocument {
  /** 格式版本（用于兼容性检查） */
  formatVersion: string;
  /** AST 数据 */
  ast: DocumentAst;
  /** 元信息 */
  meta?: {
    exportedAt: number;
    exportedBy: string;
  };
}

/**
 * 当前序列化格式版本
 */
export const SERIALIZATION_VERSION = '1.0.0';

/**
 * 序列化 AST 为可传输的对象
 */
export function serializeDocument(ast: DocumentAst): SerializedDocument {
  return {
    formatVersion: SERIALIZATION_VERSION,
    ast,
    meta: {
      exportedAt: Date.now(),
      exportedBy: 'ai-office',
    },
  };
}

/**
 * 反序列化文档
 */
export function deserializeDocument(data: SerializedDocument): DocumentAst {
  // TODO: 版本兼容性检查
  return data.ast;
}
