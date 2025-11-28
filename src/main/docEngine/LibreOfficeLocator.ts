/**
 * LibreOfficeLocator - LibreOffice 二进制检测工具
 * 
 * 用于在本机查找 LibreOffice 安装路径。
 * 支持 macOS、Windows、Linux 三大平台。
 * 
 * 检测策略：
 * 1. 首先检查用户配置的自定义路径
 * 2. 然后检查各平台的常见安装路径
 * 3. 最后尝试系统 PATH
 * 
 * 参考：
 * - macOS: LibreOffice.app 通常在 /Applications
 * - Windows: 通常在 Program Files 下
 * - Linux: 通过 which 命令或 /usr/bin
 */

import * as fs from 'fs/promises';
// import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * LibreOffice 检测结果
 */
export interface LibreOfficeLocation {
  /** soffice 可执行文件的完整路径 */
  binaryPath: string;
  /** LibreOffice 版本（如果能获取） */
  version?: string;
  /** 安装类型 */
  installType: 'system' | 'user' | 'portable';
}

/**
 * 各平台的 LibreOffice 常见安装路径
 */
const COMMON_PATHS: Record<NodeJS.Platform, string[]> = {
  darwin: [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/Applications/LibreOffice 7.app/Contents/MacOS/soffice',
    `${process.env.HOME}/Applications/LibreOffice.app/Contents/MacOS/soffice`,
  ],
  win32: [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    `${process.env.LOCALAPPDATA}\\Programs\\LibreOffice\\program\\soffice.exe`,
  ],
  linux: [
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice',
    '/snap/bin/libreoffice',
  ],
  // 其他平台暂不支持
  aix: [],
  freebsd: [],
  openbsd: [],
  sunos: [],
  android: [],
  cygwin: [],
  netbsd: [],
  haiku: [],
};

export class LibreOfficeLocator {
  private cachedLocation: LibreOfficeLocation | null = null;
  private searchPerformed = false;

  /**
   * 查找 LibreOffice 二进制文件
   * 
   * @param customPath - 用户指定的自定义路径（可选）
   * @returns LibreOffice 位置信息，找不到返回 null
   * 
   * TODO: 完善各平台的检测逻辑
   * TODO: 添加版本检测
   * TODO: 支持 LibreOfficeKit SDK 路径检测
   */
  async findLibreOfficeBinary(customPath?: string): Promise<LibreOfficeLocation | null> {
    // 如果已经搜索过，返回缓存结果
    if (this.searchPerformed && !customPath) {
      return this.cachedLocation;
    }

    // 1. 首先检查自定义路径
    if (customPath) {
      const result = await this.checkPath(customPath);
      if (result) {
        this.cachedLocation = result;
        this.searchPerformed = true;
        return result;
      }
    }

    // 2. 检查常见安装路径
    const platform = process.platform;
    const paths = COMMON_PATHS[platform] || [];

    for (const p of paths) {
      const result = await this.checkPath(p);
      if (result) {
        this.cachedLocation = result;
        this.searchPerformed = true;
        console.log(`[LibreOfficeLocator] Found LibreOffice at: ${p}`);
        return result;
      }
    }

    // 3. Linux/macOS 上尝试 which 命令
    if (platform === 'linux' || platform === 'darwin') {
      const whichResult = await this.tryWhichCommand();
      if (whichResult) {
        this.cachedLocation = whichResult;
        this.searchPerformed = true;
        return whichResult;
      }
    }

    // 4. Windows 上尝试 where 命令
    if (platform === 'win32') {
      const whereResult = await this.tryWhereCommand();
      if (whereResult) {
        this.cachedLocation = whereResult;
        this.searchPerformed = true;
        return whereResult;
      }
    }

    // 未找到
    this.searchPerformed = true;
    console.warn('[LibreOfficeLocator] LibreOffice not found on this system');
    return null;
  }

  /**
   * 检查指定路径是否存在且可执行
   */
  private async checkPath(binaryPath: string): Promise<LibreOfficeLocation | null> {
    try {
      await fs.access(binaryPath, fs.constants.X_OK);
      
      // TODO: 尝试获取版本信息
      // const version = await this.getVersion(binaryPath);
      
      return {
        binaryPath,
        installType: 'system',
        // version,
      };
    } catch {
      return null;
    }
  }

  /**
   * 尝试使用 which 命令查找 (Linux/macOS)
   */
  private async tryWhichCommand(): Promise<LibreOfficeLocation | null> {
    try {
      const { stdout } = await execAsync('which soffice');
      const binaryPath = stdout.trim();
      if (binaryPath) {
        return {
          binaryPath,
          installType: 'system',
        };
      }
    } catch {
      // which 命令失败，继续
    }
    return null;
  }

  /**
   * 尝试使用 where 命令查找 (Windows)
   */
  private async tryWhereCommand(): Promise<LibreOfficeLocation | null> {
    try {
      const { stdout } = await execAsync('where soffice.exe');
      const binaryPath = stdout.trim().split('\n')[0];
      if (binaryPath) {
        return {
          binaryPath,
          installType: 'system',
        };
      }
    } catch {
      // where 命令失败，继续
    }
    return null;
  }

  /**
   * 获取 LibreOffice 版本（预留）
   * 
   * TODO: 实现版本检测
   * 可以通过 soffice --version 获取
   */
  // @ts-ignore - Reserved for future use
  private async _getVersion(binaryPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(`"${binaryPath}" --version`);
      // 解析版本号，格式通常是 "LibreOffice 7.x.x.x ..."
      const match = stdout.match(/LibreOffice\s+([\d.]+)/);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  /**
   * 清除缓存，强制重新搜索
   */
  clearCache(): void {
    this.cachedLocation = null;
    this.searchPerformed = false;
  }
}

// 单例导出
export const libreOfficeLocator = new LibreOfficeLocator();

