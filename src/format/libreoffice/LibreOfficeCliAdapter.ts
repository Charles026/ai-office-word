/**
 * LibreOffice CLI 适配器
 * 
 * 【职责】
 * 封装所有与 LibreOffice soffice 命令行工具的交互：
 * - docx → HTML 转换
 * - HTML → docx 转换
 * - 二进制查找和验证
 * 
 * 【禁止事项】
 * - 此模块只能在 Electron 主进程中使用
 * - 不允许在 React/渲染进程中导入
 * - 不允许直接处理 AST（只处理文件格式）
 * 
 * 【设计说明】
 * 所有 CLI 调用都集中在此模块，便于：
 * - 统一错误处理
 * - 统一超时和资源管理
 * - 未来替换为 LibreOfficeKit
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';

const execAsync = promisify(exec);

// ==========================================
// 类型定义
// ==========================================

export interface ConversionResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface LibreOfficeStatus {
  available: boolean;
  binaryPath?: string;
  version?: string;
  error?: string;
}

// ==========================================
// 错误类型
// ==========================================

export class LibreOfficeNotFoundError extends Error {
  readonly code = 'LIBREOFFICE_NOT_FOUND';
  
  constructor(message = 'LibreOffice is not installed or not found') {
    super(message);
    this.name = 'LibreOfficeNotFoundError';
  }
}

export class ConversionError extends Error {
  readonly code = 'CONVERSION_FAILED';
  
  constructor(message: string, public readonly details?: string) {
    super(message);
    this.name = 'ConversionError';
  }
}

// ==========================================
// LibreOffice 路径配置
// ==========================================

const MACOS_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/Applications/LibreOffice 7.app/Contents/MacOS/soffice',
  `${process.env.HOME}/Applications/LibreOffice.app/Contents/MacOS/soffice`,
];

const WINDOWS_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];

const LINUX_PATHS = [
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/local/bin/soffice',
  '/opt/libreoffice/program/soffice',
];

// ==========================================
// LibreOfficeCliAdapter 实现
// ==========================================

export class LibreOfficeCliAdapter {
  private binaryPath: string | null = null;
  private initialized = false;
  private tempDir: string | null = null;

  /**
   * 初始化适配器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 查找 LibreOffice
    this.binaryPath = await this.findBinary();
    
    if (!this.binaryPath) {
      console.warn('[LibreOfficeCliAdapter] LibreOffice not found');
    } else {
      console.log(`[LibreOfficeCliAdapter] Found at: ${this.binaryPath}`);
    }

    // 确保临时目录
    this.tempDir = await this.ensureTempDir();
    
    this.initialized = true;
  }

  /**
   * 检查 LibreOffice 是否可用
   */
  async getStatus(): Promise<LibreOfficeStatus> {
    await this.initialize();

    if (!this.binaryPath) {
      return {
        available: false,
        error: 'LibreOffice not found on this system',
      };
    }

    try {
      const version = await this.getVersion();
      return {
        available: true,
        binaryPath: this.binaryPath,
        version,
      };
    } catch (error) {
      return {
        available: true,
        binaryPath: this.binaryPath,
        error: 'Could not determine version',
      };
    }
  }

  /**
   * 将 docx 转换为 HTML
   * 
   * @param docxPath - 源 docx 文件路径
   * @returns 生成的 HTML 文件路径
   */
  async convertDocxToHtml(docxPath: string): Promise<string> {
    await this.initialize();
    
    if (!this.binaryPath) {
      throw new LibreOfficeNotFoundError();
    }

    if (!this.tempDir) {
      throw new ConversionError('Temp directory not available');
    }

    // 验证源文件存在
    await this.validateFileExists(docxPath);

    // 生成唯一的输出目录（避免冲突）
    const timestamp = Date.now();
    const uniqueDir = path.join(this.tempDir, `convert_${timestamp}`);
    await fs.mkdir(uniqueDir, { recursive: true });

    try {
      // 执行转换
      // 使用 HTML:EmbedImages 格式嵌入图片
      await this.runCommand([
        '--headless',
        '--convert-to', 'html:HTML:EmbedImages',
        '--outdir', uniqueDir,
        docxPath,
      ]);

      // 查找生成的 HTML 文件
      const baseName = path.basename(docxPath, path.extname(docxPath));
      const htmlPath = path.join(uniqueDir, `${baseName}.html`);

      await this.validateFileExists(htmlPath);

      console.log(`[LibreOfficeCliAdapter] Converted: ${docxPath} → ${htmlPath}`);
      return htmlPath;
    } catch (error) {
      // 清理失败的临时目录
      await fs.rm(uniqueDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * 将 HTML 转换为 docx
   * 
   * @param htmlPath - 源 HTML 文件路径
   * @param outputPath - 目标 docx 文件路径
   */
  async convertHtmlToDocx(htmlPath: string, outputPath: string): Promise<void> {
    await this.initialize();
    
    if (!this.binaryPath) {
      throw new LibreOfficeNotFoundError();
    }

    if (!this.tempDir) {
      throw new ConversionError('Temp directory not available');
    }

    // 验证源文件存在
    await this.validateFileExists(htmlPath);

    // 使用 HTML 文件所在目录作为输出目录，避免时间戳不匹配
    const htmlDir = path.dirname(htmlPath);
    const baseName = path.basename(htmlPath, path.extname(htmlPath));

    try {
      // 执行转换 - 输出到 HTML 文件同目录
      await this.runCommand([
        '--headless',
        '--convert-to', 'docx:"MS Word 2007 XML"',
        '--outdir', htmlDir,
        htmlPath,
      ]);

      // 查找生成的 docx 文件
      const tempDocxPath = path.join(htmlDir, `${baseName}.docx`);

      await this.validateFileExists(tempDocxPath);

      // 移动到目标路径
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });
      await fs.copyFile(tempDocxPath, outputPath);
      
      // 清理临时 docx
      await fs.unlink(tempDocxPath).catch(() => {});

      console.log(`[LibreOfficeCliAdapter] Converted: ${htmlPath} → ${outputPath}`);
    } catch (error) {
      console.error(`[LibreOfficeCliAdapter] Conversion failed:`, error);
      throw error;
    }
  }

  /**
   * 读取 HTML 文件内容
   */
  async readHtmlFile(htmlPath: string): Promise<string> {
    const content = await fs.readFile(htmlPath, 'utf-8');
    return content;
  }

  /**
   * 写入 HTML 文件
   * 
   * @returns 临时 HTML 文件路径
   */
  async writeTempHtmlFile(html: string, baseName: string = 'document'): Promise<string> {
    await this.initialize();
    
    if (!this.tempDir) {
      throw new ConversionError('Temp directory not available');
    }

    const timestamp = Date.now();
    const fileName = `${baseName}_${timestamp}.html`;
    const filePath = path.join(this.tempDir, fileName);

    await fs.writeFile(filePath, html, 'utf-8');
    
    return filePath;
  }

  /**
   * 清理临时文件
   */
  async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // 忽略清理错误
    }
  }

  // ==========================================
  // 内部方法
  // ==========================================

  /**
   * 查找 LibreOffice 二进制
   */
  private async findBinary(): Promise<string | null> {
    const platform = process.platform;
    let paths: string[] = [];

    switch (platform) {
      case 'darwin':
        paths = MACOS_PATHS;
        break;
      case 'win32':
        paths = WINDOWS_PATHS;
        break;
      case 'linux':
        paths = LINUX_PATHS;
        break;
    }

    // 检查常见路径
    for (const p of paths) {
      try {
        await fs.access(p, fs.constants.X_OK);
        return p;
      } catch {
        continue;
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
      // 命令失败
    }

    return null;
  }

  /**
   * 获取 LibreOffice 版本
   */
  private async getVersion(): Promise<string> {
    if (!this.binaryPath) {
      throw new LibreOfficeNotFoundError();
    }

    try {
      const { stdout } = await execAsync(`"${this.binaryPath}" --version`);
      const match = stdout.match(/LibreOffice\s+([\d.]+)/i);
      return match?.[1] ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * 确保临时目录存在
   */
  private async ensureTempDir(): Promise<string> {
    const userDataPath = app.getPath('userData');
    const tempDir = path.join(userDataPath, 'format-temp');
    
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * 执行 soffice 命令
   */
  private async runCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
    if (!this.binaryPath) {
      throw new LibreOfficeNotFoundError();
    }

    // 构建命令（处理路径中的空格）
    const quotedArgs = args.map(arg => {
      // 如果参数已经包含引号，不再添加
      if (arg.includes('"')) {
        return arg;
      }
      // 如果参数包含空格且不是选项，加引号
      if (arg.includes(' ') && !arg.startsWith('--')) {
        return `"${arg}"`;
      }
      return arg;
    });

    const command = `"${this.binaryPath}" ${quotedArgs.join(' ')}`;
    
    console.log(`[LibreOfficeCliAdapter] Executing: ${command}`);

    try {
      const result = await execAsync(command, {
        timeout: 60000, // 60秒超时
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      
      return result;
    } catch (error: any) {
      if (error.killed) {
        throw new ConversionError('Command timed out', command);
      }
      throw new ConversionError(
        'Command failed',
        error.stderr || error.message
      );
    }
  }

  /**
   * 验证文件存在
   */
  private async validateFileExists(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw new ConversionError(`File not found: ${filePath}`);
    }
  }
}

// 导出单例
export const libreOfficeCliAdapter = new LibreOfficeCliAdapter();

