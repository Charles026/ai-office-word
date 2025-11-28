/**
 * SnapshotService - 版本快照服务
 * 
 * 【职责】
 * - 手动保存时创建版本快照
 * - 管理快照目录（按文档 ID 组织）
 * - 自动清理过旧的快照
 * 
 * 【存储结构】
 * ${userData}/ai-libre/snapshots/<docId>/
 *   ├── 20241127-143022.docx
 *   ├── 20241127-151530.docx
 *   └── ...
 * 
 * 【TODO: DocAgent 集成】
 * - listSnapshots + LLM → 智能版本对比
 * - 自动生成版本变更摘要
 * - 支持语义搜索历史版本
 */

// ==========================================
// 类型定义
// ==========================================

/** 快照元信息 */
export interface SnapshotMeta {
  /** 快照文件名 */
  fileName: string;
  /** 创建时间（ISO 字符串） */
  createdAt: string;
  /** 完整路径 */
  fullPath: string;
  /** 文件大小（字节） */
  sizeBytes?: number;
}

/** 快照服务配置 */
export interface SnapshotServiceConfig {
  /** 每个文档最多保留的快照数量 */
  maxSnapshotsPerDoc: number;
  /** 快照基础目录（相对于 userData） */
  snapshotsDir: string;
}

/** 默认配置 */
const DEFAULT_CONFIG: SnapshotServiceConfig = {
  maxSnapshotsPerDoc: 5,
  snapshotsDir: 'ai-libre/snapshots',
};

// ==========================================
// SnapshotService 类
// ==========================================

export class SnapshotService {
  private config: SnapshotServiceConfig;
  private userDataPath: string | null = null;
  private isElectron: boolean = false;

  constructor(config: Partial<SnapshotServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 检测运行环境
    this.isElectron = typeof window !== 'undefined' && 
                      !!(window as any).electronAPI?.getAppPath;
  }

  // ==========================================
  // 公开方法
  // ==========================================

  /**
   * 初始化：获取 userData 路径
   */
  async init(): Promise<void> {
    if (this.isElectron) {
      try {
        this.userDataPath = await (window as any).electronAPI?.getAppPath?.('userData');
        console.log('[SnapshotService] User data path:', this.userDataPath);
      } catch (error) {
        console.warn('[SnapshotService] Failed to get userData path');
      }
    }
  }

  /**
   * 创建快照
   * 
   * @param docId - 文档 ID
   * @param srcPath - 源文件路径
   */
  async createSnapshot(docId: string, srcPath: string): Promise<SnapshotMeta | null> {
    if (!this.isElectron || !this.userDataPath) {
      console.warn('[SnapshotService] Not in Electron environment, skipping snapshot');
      return null;
    }

    try {
      // 生成快照文件名
      const timestamp = this.formatTimestamp(new Date());
      const ext = this.getExtension(srcPath);
      const fileName = `${timestamp}${ext}`;
      
      // 构建快照目录路径
      const snapshotDir = `${this.userDataPath}/${this.config.snapshotsDir}/${docId}`;
      const snapshotPath = `${snapshotDir}/${fileName}`;

      // 确保目录存在
      await (window as any).electronAPI?.ensureDir?.(snapshotDir);

      // 复制文件
      await (window as any).electronAPI?.copyFile?.(srcPath, snapshotPath);

      console.log('[SnapshotService] Created snapshot:', snapshotPath);

      // 清理旧快照
      await this.pruneSnapshots(docId);

      return {
        fileName,
        createdAt: new Date().toISOString(),
        fullPath: snapshotPath,
      };
    } catch (error) {
      console.error('[SnapshotService] Failed to create snapshot:', error);
      return null;
    }
  }

  /**
   * 列出文档的所有快照
   */
  async listSnapshots(docId: string): Promise<SnapshotMeta[]> {
    if (!this.isElectron || !this.userDataPath) {
      return [];
    }

    try {
      const snapshotDir = `${this.userDataPath}/${this.config.snapshotsDir}/${docId}`;
      
      // 读取目录内容
      const files = await (window as any).electronAPI?.readDir?.(snapshotDir);
      
      if (!files || !Array.isArray(files)) {
        return [];
      }

      // 解析文件名获取时间戳
      const snapshots: SnapshotMeta[] = files
        .filter((f: string) => this.isSnapshotFile(f))
        .map((fileName: string) => ({
          fileName,
          createdAt: this.parseTimestamp(fileName),
          fullPath: `${snapshotDir}/${fileName}`,
        }))
        .sort((a: SnapshotMeta, b: SnapshotMeta) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      return snapshots;
    } catch (error) {
      console.error('[SnapshotService] Failed to list snapshots:', error);
      return [];
    }
  }

  /**
   * 清理过旧的快照
   */
  async pruneSnapshots(docId: string): Promise<void> {
    try {
      const snapshots = await this.listSnapshots(docId);
      
      if (snapshots.length <= this.config.maxSnapshotsPerDoc) {
        return;
      }

      // 删除多余的快照（保留最新的 N 个）
      const toDelete = snapshots.slice(this.config.maxSnapshotsPerDoc);
      
      for (const snapshot of toDelete) {
        await (window as any).electronAPI?.deleteFile?.(snapshot.fullPath);
        console.log('[SnapshotService] Deleted old snapshot:', snapshot.fileName);
      }
    } catch (error) {
      console.error('[SnapshotService] Failed to prune snapshots:', error);
    }
  }

  /**
   * 恢复快照（预留接口）
   * 
   * @param docId - 文档 ID
   * @param snapshotPath - 快照文件路径
   * @param targetPath - 目标路径（当前文档路径）
   */
  async restoreSnapshot(
    docId: string, 
    snapshotPath: string, 
    targetPath: string
  ): Promise<boolean> {
    if (!this.isElectron) {
      console.warn('[SnapshotService] Restore not available in browser');
      return false;
    }

    try {
      // 先备份当前版本
      await this.createSnapshot(docId, targetPath);

      // 用快照覆盖当前文件
      await (window as any).electronAPI?.copyFile?.(snapshotPath, targetPath);

      console.log('[SnapshotService] Restored snapshot:', snapshotPath, '->', targetPath);
      return true;
    } catch (error) {
      console.error('[SnapshotService] Failed to restore snapshot:', error);
      return false;
    }
  }

  /**
   * 删除文档的所有快照
   */
  async deleteAllSnapshots(docId: string): Promise<void> {
    if (!this.isElectron || !this.userDataPath) {
      return;
    }

    try {
      const snapshotDir = `${this.userDataPath}/${this.config.snapshotsDir}/${docId}`;
      await (window as any).electronAPI?.removeDir?.(snapshotDir);
      console.log('[SnapshotService] Deleted all snapshots for:', docId);
    } catch (error) {
      console.error('[SnapshotService] Failed to delete snapshots:', error);
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SnapshotServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ==========================================
  // 私有方法
  // ==========================================

  private formatTimestamp(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    
    return `${y}${m}${d}-${h}${min}${s}`;
  }

  private parseTimestamp(fileName: string): string {
    // 格式: YYYYMMDD-HHmmss.ext
    const match = fileName.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`).toISOString();
    }
    return new Date().toISOString();
  }

  private getExtension(path: string): string {
    const match = path.match(/\.[^.]+$/);
    return match ? match[0] : '.docx';
  }

  private isSnapshotFile(fileName: string): boolean {
    return /^\d{8}-\d{6}\.[a-zA-Z]+$/.test(fileName);
  }
}

// ==========================================
// 单例导出
// ==========================================

export const snapshotService = new SnapshotService();

