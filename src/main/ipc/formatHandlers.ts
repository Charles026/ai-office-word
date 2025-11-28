/**
 * 格式转换 IPC 处理器
 * 
 * 【职责】
 * 处理渲染进程发来的格式转换请求：
 * - format:import-docx: 导入 docx 为 AST
 * - format:export-docx: 将 AST 导出为 docx
 * 
 * 【数据流】
 * 导入：renderer 请求 → 主进程调用 FormatEngine → 返回 AST
 * 导出：renderer 发送 AST → 主进程调用 FormatEngine → 写入文件
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import { DocumentAst } from '../../document/types';
import { libreOfficeFormatEngine } from '../../format/libreoffice';
// import { serializeDocument, deserializeDocument } from '../../format/types';
import { appConfig, getDocumentsDirectory } from '../../config/appConfig';

// ==========================================
// 类型定义
// ==========================================

export interface ImportDocxResult {
  success: boolean;
  ast?: DocumentAst;
  html?: string; // Add html
  warnings?: string[];
  filePath?: string;
  fileName?: string;
  error?: string;
}

export interface ExportDocxResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

// ==========================================
// IPC Handlers
// ==========================================

export function registerFormatHandlers(): void {
  /**
   * 导入 docx 文件为 AST
   * 
   * 流程：
   * 1. 接收文件路径
   * 2. 调用 FormatEngine.importFromDocx()
   * 3. 返回 AST 和警告
   */
  ipcMain.handle('format:import-docx', async (_event, args: { filePath: string }): Promise<ImportDocxResult> => {
    const { filePath } = args;
    
    console.log(`[formatHandlers] Importing docx: ${filePath}`);

    try {
      const result = await libreOfficeFormatEngine.importFromDocx(filePath);
      
      console.log(`[formatHandlers] Import complete: ${result.warnings.length} warnings`);
      
      return {
        success: true,
        ast: result.ast,
        html: result.html,
        warnings: result.warnings,
        filePath,
        fileName: path.basename(filePath),
      };
    } catch (error) {
      console.error('[formatHandlers] Import failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * 将 AST 或 HTML 导出为 docx
   */
  ipcMain.handle('format:export-docx', async (_event, args: { filePath: string; ast?: DocumentAst; html?: string }): Promise<ExportDocxResult> => {
    const { filePath, ast, html } = args;
    
    console.log(`[formatHandlers] Exporting docx: ${filePath}`);

    try {
      let result;
      
      if (html) {
        // HTML 优先
        result = await libreOfficeFormatEngine.exportHtmlToDocx(html, filePath);
      } else if (ast) {
        // AST 回退
        result = await libreOfficeFormatEngine.exportToDocx(ast, filePath);
      } else {
        throw new Error('No content to export');
      }
      
      if (result.success) {
        console.log(`[formatHandlers] Export complete: ${filePath}`);
        return {
          success: true,
          filePath: result.outputPath,
        };
      } else {
        return {
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      console.error('[formatHandlers] Export failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * 打开文件对话框并导入
   */
  ipcMain.handle('format:open-and-import', async (event): Promise<ImportDocxResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: 'No window' };
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '打开文档',
      defaultPath: appConfig.defaultDocumentDirectory || getDocumentsDirectory(),
      filters: [
        { name: 'Word 文档', extensions: ['docx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false };
    }

    const filePath = filePaths[0];

    try {
      const result = await libreOfficeFormatEngine.importFromDocx(filePath);
      
      return {
        success: true,
        ast: result.ast,
        html: result.html,
        warnings: result.warnings,
        filePath,
        fileName: path.basename(filePath),
      };
    } catch (error) {
      console.error('[formatHandlers] Open and import failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * 另存为（显示文件选择对话框）
   */
  ipcMain.handle('format:save-as-docx', async (event, args: { ast?: DocumentAst; html?: string; defaultPath?: string }): Promise<ExportDocxResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: 'No window' };
    }

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '另存为',
      defaultPath: args.defaultPath || appConfig.defaultDocumentDirectory || getDocumentsDirectory(),
      filters: [
        { name: 'Word 文档', extensions: ['docx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (canceled || !filePath) {
      return { success: false, error: 'User canceled' };
    }

    let finalPath = filePath;
    if (!finalPath.toLowerCase().endsWith('.docx')) {
      finalPath = `${finalPath}.docx`;
    }

    // 使用现有的导出逻辑
    try {
      let result;
      
      if (args.html) {
        result = await libreOfficeFormatEngine.exportHtmlToDocx(args.html, finalPath);
      } else if (args.ast) {
        result = await libreOfficeFormatEngine.exportToDocx(args.ast, finalPath);
      } else {
        return { success: false, error: 'No content to export' };
      }
      
      if (result.success) {
        return {
          success: true,
          filePath: result.outputPath,
        };
      } else {
        return {
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * 检查格式引擎状态
   */
  ipcMain.handle('format:get-status', async (): Promise<{ available: boolean; engine: string }> => {
    const available = await libreOfficeFormatEngine.isAvailable();
    
    return {
      available,
      engine: libreOfficeFormatEngine.name,
    };
  });

  console.log('[formatHandlers] Format IPC handlers registered');
}

export function unregisterFormatHandlers(): void {
  ipcMain.removeHandler('format:import-docx');
  ipcMain.removeHandler('format:export-docx');
  ipcMain.removeHandler('format:save-as-docx');
  ipcMain.removeHandler('format:open-and-import');
  ipcMain.removeHandler('format:get-status');
}

