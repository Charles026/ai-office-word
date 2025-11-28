/**
 * LibreOfficeEngine - LibreOffice CLI 文档引擎实现
 * 
 * 通过 soffice --headless 命令实现文档操作：
 * - docx → html 转换（用于编辑）
 * - html → docx 转换（用于保存）
 * 
 * 适用场景：
 * - 本地单文件编辑
 * - 不需要实时协作的场景
 * 
 * 限制：
 * - 转换质量不会 100% 等同于 Word
 * - 不适合巨大文档或高频实时协作
 * 
 * 未来扩展：
 * - 可改用 LibreOfficeKit 或 Collabora Online 的 tile 渲染
 * - 支持更好的格式保真度
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';

import {
  DocumentEngine,
  CreateBlankDocxOptions,
  CreateDocxResult,
  OpenDocForEditingResult,
  OpenedDocumentHandle,
  ExportPreviewOptions,
  LibreOfficeNotAvailableError,
  DocumentConversionError,
} from './DocumentEngine';
import { simpleDocxEngine } from './SimpleDocxEngine';

const execAsync = promisify(exec);

// ==========================================
// LibreOffice 路径配置
// ==========================================

/**
 * macOS 上 LibreOffice 的常见安装路径
 */
const MACOS_LIBREOFFICE_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/Applications/LibreOffice 7.app/Contents/MacOS/soffice',
  `${process.env.HOME}/Applications/LibreOffice.app/Contents/MacOS/soffice`,
];

/**
 * Windows 上 LibreOffice 的常见安装路径
 */
const WINDOWS_LIBREOFFICE_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];

/**
 * Linux 上 LibreOffice 的常见安装路径
 */
const LINUX_LIBREOFFICE_PATHS = [
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/local/bin/soffice',
  '/opt/libreoffice/program/soffice',
];

// ==========================================
// LibreOfficeEngine 实现
// ==========================================

export class LibreOfficeEngine implements DocumentEngine {
  readonly name = 'LibreOfficeEngine';
  
  private _available = false;
  private _binaryPath: string | null = null;
  private _initialized = false;
  private _tempDir: string | null = null;

  get available(): boolean {
    return this._available;
  }

  get binaryPath(): string | null {
    return this._binaryPath;
  }

  /**
   * 初始化引擎
   * 
   * 检测 LibreOffice 是否安装，并准备临时目录。
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    // 查找 LibreOffice 二进制
    this._binaryPath = await this.findLibreOfficeBinary();
    this._available = this._binaryPath !== null;

    if (this._available) {
      console.log(`[LibreOfficeEngine] Found LibreOffice at: ${this._binaryPath}`);
      
      // 确保临时目录存在
      this._tempDir = await this.ensureTempDir();
      console.log(`[LibreOfficeEngine] Temp directory: ${this._tempDir}`);
    } else {
      console.warn(
        '[LibreOfficeEngine] LibreOffice not found. ' +
        'Document editing features will be limited. ' +
        'Please install LibreOffice from https://www.libreoffice.org/'
      );
    }

    this._initialized = true;
  }

  /**
   * 查找 LibreOffice 二进制文件
   * 
   * 搜索顺序：
   * 1. 平台特定的常见安装路径
   * 2. 系统 PATH（通过 which/where 命令）
   */
  private async findLibreOfficeBinary(): Promise<string | null> {
    const platform = process.platform;
    let paths: string[] = [];

    switch (platform) {
      case 'darwin':
        paths = MACOS_LIBREOFFICE_PATHS;
        break;
      case 'win32':
        paths = WINDOWS_LIBREOFFICE_PATHS;
        break;
      case 'linux':
        paths = LINUX_LIBREOFFICE_PATHS;
        break;
    }

    // 检查常见路径
    for (const p of paths) {
      try {
        await fs.access(p, fs.constants.X_OK);
        return p;
      } catch {
        // 继续检查下一个路径
      }
    }

    // 尝试 which/where 命令
    try {
      const cmd = platform === 'win32' ? 'where soffice.exe' : 'which soffice';
      const { stdout } = await execAsync(cmd);
      const binaryPath = stdout.trim().split('\n')[0];
      if (binaryPath) {
        await fs.access(binaryPath, fs.constants.X_OK);
        return binaryPath;
      }
    } catch {
      // 命令失败，继续
    }

    return null;
  }

  /**
   * 确保临时目录存在
   * 
   * 返回用于中间文件（HTML/ODT）的临时目录路径。
   * macOS: ~/Library/Application Support/AIOffice/tmp
   * Windows: %APPDATA%/AIOffice/tmp
   * Linux: ~/.config/AIOffice/tmp
   */
  private async ensureTempDir(): Promise<string> {
    const userDataPath = app.getPath('userData');
    const tempDir = path.join(userDataPath, 'tmp');
    
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * 运行 soffice 命令
   * 
   * @param args - 命令参数
   * @param options - 执行选项
   */
  private async runSoffice(
    args: string[],
    options: { timeout?: number; cwd?: string } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    if (!this._binaryPath) {
      throw new LibreOfficeNotAvailableError();
    }

    const { timeout = 60000, cwd } = options;

    // 构建命令
    // 注意：路径中可能有空格，需要正确处理
    const command = `"${this._binaryPath}" ${args.join(' ')}`;
    
    console.log(`[LibreOfficeEngine] Executing: ${command}`);

    try {
      const result = await execAsync(command, {
        timeout,
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      
      return result;
    } catch (error: any) {
      console.error('[LibreOfficeEngine] Command failed:', error);
      
      if (error.killed) {
        throw new DocumentConversionError(
          'LibreOffice command timed out',
          `Command: ${command}`
        );
      }
      
      throw new DocumentConversionError(
        'LibreOffice command failed',
        error.stderr || error.message
      );
    }
  }

  /**
   * 生成唯一的临时文件名
   */
  private generateTempFileName(originalName: string, extension: string): string {
    const timestamp = Date.now();
    const baseName = path.basename(originalName, path.extname(originalName));
    // 移除文件名中的特殊字符
    const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safeName}_${timestamp}.${extension}`;
  }

  // ==========================================
  // DocumentEngine 接口实现
  // ==========================================

  /**
   * 创建空白 docx 文档
   * 
   * 委托给 SimpleDocxEngine 实现。
   */
  async createBlankDocx(
    filePath: string,
    options?: CreateBlankDocxOptions
  ): Promise<CreateDocxResult> {
    // 直接委托给 SimpleDocxEngine
    return simpleDocxEngine.createBlankDocx(filePath, options);
  }

  /**
   * 打开文档进行编辑
   * 
   * 流程：
   * 1. 检查 LibreOffice 可用性
   * 2. 将 docx 复制到临时目录（避免污染原文件）
   * 3. 调用 soffice --headless --convert-to html
   * 4. 读取生成的 HTML 内容
   * 5. 返回结果
   */
  async openDocForEditing(filePath: string): Promise<OpenDocForEditingResult> {
    // 确保初始化
    await this.initialize();

    if (!this._available || !this._binaryPath) {
      throw new LibreOfficeNotAvailableError();
    }

    if (!this._tempDir) {
      throw new DocumentConversionError('Temp directory not available');
    }

    const fileName = path.basename(filePath);
    
    // 验证源文件存在
    try {
      await fs.access(filePath);
    } catch {
      throw new DocumentConversionError(`File not found: ${filePath}`);
    }

    // 生成临时文件名
    const tempDocxName = this.generateTempFileName(fileName, 'docx');
    const tempDocxPath = path.join(this._tempDir, tempDocxName);

    // 复制 docx 到临时目录
    await fs.copyFile(filePath, tempDocxPath);
    console.log(`[LibreOfficeEngine] Copied to temp: ${tempDocxPath}`);

    // 调用 LibreOffice 转换为 HTML
    try {
      await this.runSoffice([
        '--headless',
        '--convert-to', 'html:HTML:EmbedImages',
        '--outdir', `"${this._tempDir}"`,
        `"${tempDocxPath}"`,
      ]);
    } catch (error) {
      // 清理临时文件
      await fs.unlink(tempDocxPath).catch(() => {});
      throw error;
    }

    // 查找生成的 HTML 文件
    const htmlFileName = path.basename(tempDocxPath, '.docx') + '.html';
    const htmlPath = path.join(this._tempDir, htmlFileName);

    // 验证 HTML 文件生成成功
    try {
      await fs.access(htmlPath);
    } catch {
      throw new DocumentConversionError(
        'HTML conversion failed - output file not found',
        `Expected: ${htmlPath}`
      );
    }

    // 读取 HTML 内容
    const htmlContent = await fs.readFile(htmlPath, 'utf-8');
    console.log(`[LibreOfficeEngine] Converted to HTML: ${htmlPath} (${htmlContent.length} bytes)`);

    // 清理临时 docx 文件（保留 HTML 供后续使用）
    await fs.unlink(tempDocxPath).catch(() => {});

    return {
      filePath,
      fileName,
      htmlPath,
      htmlContent,
    };
  }

  /**
   * 从 HTML 保存回 docx
   * 
   * 流程：
   * 1. 将 HTML 写入临时文件
   * 2. 调用 soffice --headless --convert-to docx
   * 3. 将生成的 docx 覆盖原文件
   * 
   * 注意：
   * - HTML → docx 的转换质量不会 100% 等同于 Word
   * - 这是第一阶段实现，未来可改用 LibreOfficeKit 提升保真度
   * - 可考虑 html → odt → docx 的两步转换以提高兼容性（TODO）
   */
  async saveDocFromHtml(filePath: string, htmlContent: string): Promise<void> {
    // 确保初始化
    await this.initialize();

    if (!this._available || !this._binaryPath) {
      throw new LibreOfficeNotAvailableError();
    }

    if (!this._tempDir) {
      throw new DocumentConversionError('Temp directory not available');
    }

    const fileName = path.basename(filePath);
    
    // 生成临时 HTML 文件名
    const tempHtmlName = this.generateTempFileName(fileName, 'html');
    const tempHtmlPath = path.join(this._tempDir, tempHtmlName);

    // 写入 HTML 到临时文件
    await fs.writeFile(tempHtmlPath, htmlContent, 'utf-8');
    console.log(`[LibreOfficeEngine] Wrote temp HTML: ${tempHtmlPath}`);

    // 调用 LibreOffice 转换为 docx
    try {
      await this.runSoffice([
        '--headless',
        '--convert-to', 'docx:"MS Word 2007 XML"',
        '--outdir', `"${this._tempDir}"`,
        `"${tempHtmlPath}"`,
      ]);
    } catch (error) {
      // 清理临时文件
      await fs.unlink(tempHtmlPath).catch(() => {});
      throw error;
    }

    // 查找生成的 docx 文件
    const tempDocxName = path.basename(tempHtmlPath, '.html') + '.docx';
    const tempDocxPath = path.join(this._tempDir, tempDocxName);

    // 验证 docx 文件生成成功
    try {
      await fs.access(tempDocxPath);
    } catch {
      // 清理临时 HTML 文件
      await fs.unlink(tempHtmlPath).catch(() => {});
      throw new DocumentConversionError(
        'docx conversion failed - output file not found',
        `Expected: ${tempDocxPath}`
      );
    }

    // 备份原文件（可选，防止数据丢失）
    const backupPath = `${filePath}.backup`;
    try {
      await fs.copyFile(filePath, backupPath);
    } catch {
      // 原文件可能不存在（新建的情况），忽略
    }

    // 覆盖原文件
    try {
      await fs.copyFile(tempDocxPath, filePath);
      console.log(`[LibreOfficeEngine] Saved docx: ${filePath}`);
      
      // 成功后删除备份
      await fs.unlink(backupPath).catch(() => {});
    } catch (error) {
      // 恢复备份
      try {
        await fs.copyFile(backupPath, filePath);
      } catch {
        // 恢复失败，保留备份文件
      }
      throw new DocumentConversionError(
        'Failed to save docx file',
        (error as Error).message
      );
    }

    // 清理临时文件
    await fs.unlink(tempHtmlPath).catch(() => {});
    await fs.unlink(tempDocxPath).catch(() => {});
  }

  /**
   * 打开已有文档（预留实现）
   */
  async openDocx(filePath: string): Promise<OpenedDocumentHandle> {
    // TODO: 未来接 LibreOfficeKit 时实现
    // 当前返回简单的句柄
    const fileName = path.basename(filePath);
    
    await fs.access(filePath);

    return {
      filePath,
      fileName,
      editable: this._available,
      async close() {},
    };
  }

  /**
   * 导出文档预览（预留实现）
   * 
   * 未来实现：
   * - soffice --headless --convert-to png/pdf
   * - 或使用 LOK tiled rendering API
   */
  async exportPreview(
    _filePath: string,
    _options: ExportPreviewOptions
  ): Promise<Buffer | string> {
    // TODO: 实现预览导出
    // 未来实现：soffice --headless --convert-to png/pdf
    // 或使用 LOK tiled rendering API
    throw new Error(
      '[LibreOfficeEngine] exportPreview is not yet implemented. ' +
      'This will be available in a future version.'
    );
  }
}

// 单例导出
export const libreOfficeEngine = new LibreOfficeEngine();
