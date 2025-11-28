/**
 * 文件操作 IPC 处理器
 * 
 * 处理渲染进程发来的文件相关请求。
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  DocumentEngineProvider,
  LibreOfficeNotAvailableError,
  DocumentConversionError,
} from '../docEngine';
import { appConfig, getDocumentsDirectory } from '../../config/appConfig';

// ==========================================
// 类型定义
// ==========================================

export interface NewDocxResult {
  filePath: string;
  fileName: string;
}

export interface OpenDocForEditResult {
  filePath: string;
  fileName: string;
  html: string;
}

export interface EditorStatus {
  libreOfficeAvailable: boolean;
  engineType: string;
  engineName: string;
  errorMessage?: string;
}

// ==========================================
// IPC Handlers
// ==========================================

export function registerFileHandlers(): void {
  /**
   * 获取 Electron 应用路径
   */
  ipcMain.handle('app:get-path', async (_event, name: 'userData' | 'documents' | 'home'): Promise<string> => {
    switch (name) {
      case 'userData':
        return app.getPath('userData');
      case 'documents':
        return app.getPath('documents');
      case 'home':
        return app.getPath('home');
      default:
        return app.getPath('userData');
    }
  });

  /**
   * 新建 docx 文件
   */
  ipcMain.handle('file:new-docx', async (event): Promise<NewDocxResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const defaultPath = appConfig.defaultDocumentDirectory || getDocumentsDirectory();
    const defaultName = appConfig.defaultDocumentName;

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '新建文档',
      defaultPath: path.join(defaultPath, defaultName),
      filters: [
        { name: 'Word 文档', extensions: ['docx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (canceled || !filePath) return null;

    let finalPath = filePath;
    if (!finalPath.toLowerCase().endsWith('.docx')) {
      finalPath = `${finalPath}.docx`;
    }

    try {
      const engine = await DocumentEngineProvider.getEngine();
      const result = await engine.createBlankDocx(finalPath, {
        defaultName: path.basename(finalPath),
      });

      console.log(`[fileHandlers] Created new document: ${result.filePath}`);
      return result;
    } catch (error) {
      console.error('[fileHandlers] Failed to create document:', error);
      dialog.showErrorBox(
        '创建文档失败',
        `无法创建文档：${error instanceof Error ? error.message : '未知错误'}`
      );
      return null;
    }
  });

  /**
   * 打开已有的 docx 文件
   */
  ipcMain.handle('file:open-docx', async (event): Promise<NewDocxResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '打开文档',
      defaultPath: appConfig.defaultDocumentDirectory || getDocumentsDirectory(),
      filters: [
        { name: 'Word 文档', extensions: ['docx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) return null;

    return {
      filePath: filePaths[0],
      fileName: path.basename(filePaths[0]),
    };
  });

  /**
   * 打开文档进行编辑（转换为 HTML）
   */
  ipcMain.handle('editor:open-docx', async (_event, args: { filePath: string }): Promise<OpenDocForEditResult> => {
    const { filePath } = args;
    
    try {
      const engine = await DocumentEngineProvider.getEngine();
      const result = await engine.openDocForEditing(filePath);

      return {
        filePath: result.filePath,
        fileName: result.fileName,
        html: result.htmlContent,
      };
    } catch (error) {
      console.error('[fileHandlers] Failed to open document for editing:', error);

      if (error instanceof LibreOfficeNotAvailableError) {
        throw {
          code: 'LIBREOFFICE_NOT_FOUND',
          message: 'LibreOffice 未安装或未找到。请安装 LibreOffice 以使用编辑功能。',
        };
      }

      if (error instanceof DocumentConversionError) {
        throw {
          code: 'CONVERSION_FAILED',
          message: `文档转换失败：${error.message}`,
          details: error.details,
        };
      }

      throw {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : '未知错误',
      };
    }
  });

  /**
   * 保存文档（从 HTML 转换回 docx）
   */
  ipcMain.handle('editor:save-docx', async (_event, args: { filePath: string; html: string }): Promise<boolean> => {
    const { filePath, html } = args;
    
    try {
      const engine = await DocumentEngineProvider.getEngine();
      await engine.saveDocFromHtml(filePath, html);

      console.log(`[fileHandlers] Saved document: ${filePath}`);
      return true;
    } catch (error) {
      console.error('[fileHandlers] Failed to save document:', error);

      if (error instanceof LibreOfficeNotAvailableError) {
        throw {
          code: 'LIBREOFFICE_NOT_FOUND',
          message: 'LibreOffice 未安装或未找到。无法保存文档。',
        };
      }

      if (error instanceof DocumentConversionError) {
        throw {
          code: 'CONVERSION_FAILED',
          message: `保存失败：${error.message}`,
          details: error.details,
        };
      }

      throw {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : '未知错误',
      };
    }
  });

  /**
   * 获取编辑器状态（LibreOffice 是否可用等）
   */
  ipcMain.handle('editor:get-status', async (): Promise<EditorStatus> => {
    const status = await DocumentEngineProvider.getEngineStatus();
    const libreOfficeAvailable = await DocumentEngineProvider.isLibreOfficeAvailable();

    return {
      libreOfficeAvailable,
      engineType: status.type,
      engineName: status.name,
      errorMessage: status.errorMessage,
    };
  });

  /**
   * 获取引擎信息
   */
  ipcMain.handle('file:get-engine-info', async () => {
    const engine = await DocumentEngineProvider.getEngine();
    const availableEngines = await DocumentEngineProvider.getAvailableEngines();

    return {
      current: {
        name: engine.name,
        available: engine.available,
        type: DocumentEngineProvider.getCurrentType(),
      },
      available: availableEngines,
    };
  });

  /**
   * 列出文档目录中的文件
   */
  ipcMain.handle('file:list-docs', async (_event, args?: { directory?: string }): Promise<{
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
    try {
      const directory = args?.directory || appConfig.defaultDocumentDirectory || getDocumentsDirectory();
      
      if (!fs.existsSync(directory)) {
        return { success: true, docs: [] };
      }

      const files = fs.readdirSync(directory);
      const supportedExtensions = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.pdf', '.txt', '.md'];
      
      const docs = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return supportedExtensions.includes(ext);
        })
        .map(file => {
          const fullPath = path.join(directory, file);
          try {
            const stats = fs.statSync(fullPath);
            return {
              name: file,
              fullPath,
              updatedAt: stats.mtimeMs,
              createdAt: stats.birthtimeMs,
              sizeBytes: stats.size,
            };
          } catch {
            return null;
          }
        })
        .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      return { success: true, docs };
    } catch (error) {
      console.error('[fileHandlers] Failed to list documents:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '列出文档失败',
      };
    }
  });

  /**
   * 删除文档
   */
  ipcMain.handle('file:delete-doc', async (_event, filePath: string): Promise<{
    success: boolean;
    error?: string;
  }> => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' };
      }

      fs.unlinkSync(filePath);
      console.log(`[fileHandlers] Deleted document: ${filePath}`);
      return { success: true };
    } catch (error) {
      console.error('[fileHandlers] Failed to delete document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除失败',
      };
    }
  });

  /**
   * 重命名文档
   */
  ipcMain.handle('file:rename-doc', async (_event, args: { oldPath: string; newName: string }): Promise<{
    success: boolean;
    newPath?: string;
    error?: string;
  }> => {
    try {
      const { oldPath, newName } = args;
      
      if (!fs.existsSync(oldPath)) {
        return { success: false, error: '文件不存在' };
      }

      const dir = path.dirname(oldPath);
      const ext = path.extname(oldPath);
      const newPath = path.join(dir, newName.endsWith(ext) ? newName : `${newName}${ext}`);

      if (fs.existsSync(newPath)) {
        return { success: false, error: '目标文件已存在' };
      }

      fs.renameSync(oldPath, newPath);
      console.log(`[fileHandlers] Renamed document: ${oldPath} -> ${newPath}`);
      return { success: true, newPath };
    } catch (error) {
      console.error('[fileHandlers] Failed to rename document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '重命名失败',
      };
    }
  });

  // ==========================================
  // 通用文件系统操作（支持 RecentDocumentsStore / SnapshotService）
  // ==========================================

  /**
   * 读取文件内容
   */
  ipcMain.handle('fs:read-file', async (_event, filePath: string): Promise<string | null> => {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error('[fileHandlers] Failed to read file:', filePath, error);
      return null;
    }
  });

  /**
   * 写入文件内容
   */
  ipcMain.handle('fs:write-file', async (_event, args: { filePath: string; content: string }): Promise<boolean> => {
    try {
      const { filePath: targetPath, content } = args;
      const dir = path.dirname(targetPath);
      
      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(targetPath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error('[fileHandlers] Failed to write file:', args.filePath, error);
      return false;
    }
  });

  /**
   * 检查文件是否存在
   */
  ipcMain.handle('fs:file-exists', async (_event, filePath: string): Promise<boolean> => {
    return fs.existsSync(filePath);
  });

  /**
   * 确保目录存在
   */
  ipcMain.handle('fs:ensure-dir', async (_event, dirPath: string): Promise<boolean> => {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (error) {
      console.error('[fileHandlers] Failed to ensure dir:', dirPath, error);
      return false;
    }
  });

  /**
   * 复制文件
   */
  ipcMain.handle('fs:copy-file', async (_event, args: { src: string; dest: string }): Promise<boolean> => {
    try {
      const { src, dest } = args;
      
      // 确保目标目录存在
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      fs.copyFileSync(src, dest);
      console.log('[fileHandlers] Copied file:', src, '->', dest);
      return true;
    } catch (error) {
      console.error('[fileHandlers] Failed to copy file:', args, error);
      return false;
    }
  });

  /**
   * 读取目录内容
   */
  ipcMain.handle('fs:read-dir', async (_event, dirPath: string): Promise<string[] | null> => {
    try {
      if (!fs.existsSync(dirPath)) {
        return [];
      }
      return fs.readdirSync(dirPath);
    } catch (error) {
      console.error('[fileHandlers] Failed to read dir:', dirPath, error);
      return null;
    }
  });

  /**
   * 删除文件
   */
  ipcMain.handle('fs:delete-file', async (_event, filePath: string): Promise<boolean> => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('[fileHandlers] Deleted file:', filePath);
      }
      return true;
    } catch (error) {
      console.error('[fileHandlers] Failed to delete file:', filePath, error);
      return false;
    }
  });

  /**
   * 删除目录（递归）
   */
  ipcMain.handle('fs:remove-dir', async (_event, dirPath: string): Promise<boolean> => {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log('[fileHandlers] Removed dir:', dirPath);
      }
      return true;
    } catch (error) {
      console.error('[fileHandlers] Failed to remove dir:', dirPath, error);
      return false;
    }
  });

  console.log('[fileHandlers] File and editor IPC handlers registered');
}

export function unregisterFileHandlers(): void {
  ipcMain.removeHandler('app:get-path');
  ipcMain.removeHandler('file:new-docx');
  ipcMain.removeHandler('file:open-docx');
  ipcMain.removeHandler('editor:open-docx');
  ipcMain.removeHandler('editor:save-docx');
  ipcMain.removeHandler('editor:get-status');
  ipcMain.removeHandler('file:get-engine-info');
  ipcMain.removeHandler('file:list-docs');
  ipcMain.removeHandler('file:delete-doc');
  ipcMain.removeHandler('file:rename-doc');
  // 通用文件系统操作
  ipcMain.removeHandler('fs:read-file');
  ipcMain.removeHandler('fs:write-file');
  ipcMain.removeHandler('fs:file-exists');
  ipcMain.removeHandler('fs:ensure-dir');
  ipcMain.removeHandler('fs:copy-file');
  ipcMain.removeHandler('fs:read-dir');
  ipcMain.removeHandler('fs:delete-file');
  ipcMain.removeHandler('fs:remove-dir');
}
