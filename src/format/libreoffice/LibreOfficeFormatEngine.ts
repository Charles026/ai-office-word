/**
 * LibreOfficeFormatEngine - 基于 LibreOffice 的格式转换引擎
 * 
 * 【职责】
 * 实现 FormatEngine 接口，提供 docx ↔ AST 的转换能力：
 * - importFromDocx: docx → HTML → AST
 * - exportToDocx: AST → HTML → docx
 * 
 * 【数据流】
 * 导入：docx --[LibreOffice CLI]--> HTML --[htmlToAst]--> AST
 * 导出：AST --[astToHtml]--> HTML --[LibreOffice CLI]--> docx
 * 
 * 【禁止事项】
 * - 此模块只能在 Electron 主进程中使用
 * - 不允许在 React/渲染进程中导入
 * - 不允许直接修改 AST（只进行格式转换）
 */

import * as path from 'path';
import { DocumentAst } from '../../document/types';
import { FormatEngine, ImportResult, ExportOptions, ExportResult } from '../types';
import { htmlToAst } from '../html/htmlToAst';
import { astToHtml } from '../html/astToHtml';
import { libreOfficeCliAdapter } from './LibreOfficeCliAdapter';

// ==========================================
// LibreOfficeFormatEngine 实现
// ==========================================

export class LibreOfficeFormatEngine implements FormatEngine {
  readonly name = 'LibreOfficeFormatEngine';

  /**
   * 检查引擎是否可用
   */
  async isAvailable(): Promise<boolean> {
    const status = await libreOfficeCliAdapter.getStatus();
    return status.available;
  }

  /**
   * 从 docx 导入为 AST
   * 
   * 流程：
   * 1. 调用 LibreOffice CLI 将 docx 转换为 HTML
   * 2. 读取 HTML 文件内容
   * 3. 使用 htmlToAst 解析为 AST
   * 4. 清理临时文件
   * 5. 返回 AST 和警告信息
   */
  async importFromDocx(filePath: string): Promise<ImportResult> {
    console.log(`[LibreOfficeFormatEngine] Importing: ${filePath}`);

    let htmlPath: string | null = null;

    try {
      // 1. docx → HTML
      htmlPath = await libreOfficeCliAdapter.convertDocxToHtml(filePath);

      // 2. 读取 HTML
      const htmlContent = await libreOfficeCliAdapter.readHtmlFile(htmlPath);

      // 3. HTML → AST
      const { ast, warnings } = htmlToAst(htmlContent);

      // 更新元数据
      ast.metadata.title = path.basename(filePath, '.docx');

      console.log(`[LibreOfficeFormatEngine] Import complete: ${warnings.length} warnings`);

      return {
        ast,
        html: htmlContent, // Include HTML for Lexical
        warnings,
        sourceInfo: {
          filePath,
          format: 'docx',
          fileSize: 0, // TODO: 获取实际文件大小
        },
      };
    } finally {
      // 4. 清理临时文件
      if (htmlPath) {
        await libreOfficeCliAdapter.cleanupTempFile(htmlPath);
        // 也清理包含 HTML 的目录
        const htmlDir = path.dirname(htmlPath);
        try {
          const fs = await import('fs/promises');
          await fs.rm(htmlDir, { recursive: true, force: true });
        } catch {
          // 忽略清理错误
        }
      }
    }
  }

  /**
   * 将 AST 导出为 docx
   * 
   * 流程：
   * 1. 使用 astToHtml 将 AST 序列化为 HTML
   * 2. 将 HTML 写入临时文件
   * 3. 调用 LibreOffice CLI 将 HTML 转换为 docx
   * 4. 清理临时文件
   */
  async exportToDocx(
    ast: DocumentAst,
    targetPath: string,
    _options?: ExportOptions
  ): Promise<ExportResult> {
    console.log(`[LibreOfficeFormatEngine] Exporting to: ${targetPath}`);

    let htmlPath: string | null = null;

    try {
      // 1. AST → HTML
      const htmlContent = astToHtml(ast, {
        fullDocument: true,
        title: ast.metadata.title,
      });

      // 2. 写入临时 HTML 文件
      const baseName = path.basename(targetPath, '.docx');
      htmlPath = await libreOfficeCliAdapter.writeTempHtmlFile(htmlContent, baseName);

      // 3. HTML → docx
      await libreOfficeCliAdapter.convertHtmlToDocx(htmlPath, targetPath);

      console.log(`[LibreOfficeFormatEngine] Export complete: ${targetPath}`);

      return {
        success: true,
        outputPath: targetPath,
      };
    } catch (error) {
      console.error('[LibreOfficeFormatEngine] Export failed:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      // 4. 清理临时文件
      if (htmlPath) {
        await libreOfficeCliAdapter.cleanupTempFile(htmlPath);
      }
    }
  }

  /**
   * 将 HTML 导出为 docx
   */
  async exportHtmlToDocx(
    html: string,
    targetPath: string,
    _options?: ExportOptions
  ): Promise<ExportResult> {
    console.log(`[LibreOfficeFormatEngine] Exporting HTML to: ${targetPath}`);

    let htmlPath: string | null = null;

    try {
      // 1. 写入临时 HTML 文件
      const baseName = path.basename(targetPath, '.docx');
      // 包装 HTML 以确保正确编码和样式
      const wrappedHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: "Times New Roman", serif; font-size: 12pt; }
            h1 { font-size: 24pt; font-weight: bold; }
            h2 { font-size: 18pt; font-weight: bold; }
            h3 { font-size: 14pt; font-weight: bold; }
          </style>
        </head>
        <body>
          ${html}
        </body>
        </html>
      `;
      
      htmlPath = await libreOfficeCliAdapter.writeTempHtmlFile(wrappedHtml, baseName);

      // 2. HTML → docx
      await libreOfficeCliAdapter.convertHtmlToDocx(htmlPath, targetPath);

      console.log(`[LibreOfficeFormatEngine] Export complete: ${targetPath}`);

      return {
        success: true,
        outputPath: targetPath,
      };
    } catch (error) {
      console.error('[LibreOfficeFormatEngine] Export failed:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      // 3. 清理临时文件
      if (htmlPath) {
        await libreOfficeCliAdapter.cleanupTempFile(htmlPath);
      }
    }
  }

  /**
   * 从 HTML 字符串导入（用于测试）
   */
  async importFromHtml(html: string): Promise<ImportResult> {
    const { ast, warnings } = htmlToAst(html);
    return { ast, warnings };
  }

  /**
   * 导出为 HTML 字符串（用于测试）
   */
  exportToHtml(ast: DocumentAst): string {
    return astToHtml(ast, { fullDocument: true });
  }
}

// 导出单例
export const libreOfficeFormatEngine = new LibreOfficeFormatEngine();
