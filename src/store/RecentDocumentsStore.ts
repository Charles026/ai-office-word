/**
 * RecentDocumentsStore - 最近文档持久化存储
 * 
 * 【职责】
 * - 持久化最近打开的文档列表
 * - 支持崩溃恢复检测
 * - 管理文档打开/关闭状态
 * 
 * 【存储位置】
 * - Electron: ${userData}/ai-libre/recentDocuments.json
 * - 开发模式: localStorage fallback
 * 
 * 【TODO: DocAgent 集成】
 * - 可以基于最近文档生成「智能文档推荐」
 * - 分析文档打开频率、编辑时长等统计
 */

// ==========================================
// 类型定义
// ==========================================

/** 最近文档条目 */
export interface RecentDocumentEntry {
  /** 内部文档 ID */
  id: string;
  /** 本地文件路径 */
  path: string;
  /** UI 展示用的文件名 */
  displayName: string;
  /** 最后打开时间（ISO 字符串） */
  lastOpenedAt: string;
  /** 最后关闭时间（ISO 字符串，可选） */
  lastClosedAt?: string;
  /** 关闭时是否有未保存修改 */
  wasDirtyOnLastClose: boolean;
}

/** 最近文档状态 */
export interface RecentDocumentsState {
  /** 文档列表 */
  documents: RecentDocumentEntry[];
  /** 应用上次正常退出时间 */
  lastNormalExitAt?: string;
}

/** 初始状态 */
const INITIAL_STATE: RecentDocumentsState = {
  documents: [],
};

/** 最大保存条目数 */
const MAX_RECENT_DOCUMENTS = 20;

/** 存储 key */
const STORAGE_KEY = 'ai-libre-recent-documents';

// ==========================================
// RecentDocumentsStore 类
// ==========================================

export class RecentDocumentsStore {
  private state: RecentDocumentsState = INITIAL_STATE;
  private storagePath: string | null = null;
  private isElectron: boolean = false;

  constructor() {
    // 检测运行环境
    this.isElectron = typeof window !== 'undefined' && 
                      !!(window as any).electronAPI?.getAppPath;
  }

  // ==========================================
  // 公开方法
  // ==========================================

  /**
   * 初始化：设置存储路径
   */
  async init(): Promise<void> {
    if (this.isElectron) {
      try {
        // 通过 IPC 获取 userData 路径
        const userDataPath = await (window as any).electronAPI?.getAppPath?.('userData');
        if (userDataPath) {
          this.storagePath = `${userDataPath}/ai-libre/recentDocuments.json`;
          console.log('[RecentDocumentsStore] Storage path:', this.storagePath);
        }
      } catch (error) {
        console.warn('[RecentDocumentsStore] Failed to get userData path, using localStorage');
      }
    }
  }

  /**
   * 加载最近文档列表
   */
  async load(): Promise<RecentDocumentsState> {
    try {
      if (this.storagePath && this.isElectron) {
        // Electron 环境：从文件读取
        const data = await (window as any).electronAPI?.readFile?.(this.storagePath);
        if (data) {
          this.state = JSON.parse(data);
          console.log('[RecentDocumentsStore] Loaded from file:', this.state.documents.length, 'documents');
        }
      } else {
        // 浏览器环境：从 localStorage 读取
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          this.state = JSON.parse(saved);
          console.log('[RecentDocumentsStore] Loaded from localStorage:', this.state.documents.length, 'documents');
        }
      }
    } catch (error) {
      console.error('[RecentDocumentsStore] Failed to load:', error);
      this.state = INITIAL_STATE;
    }

    return this.state;
  }

  /**
   * 保存最近文档列表
   */
  async save(): Promise<void> {
    try {
      const data = JSON.stringify(this.state, null, 2);

      if (this.storagePath && this.isElectron) {
        // Electron 环境：写入文件
        await (window as any).electronAPI?.writeFile?.(this.storagePath, data);
      } else {
        // 浏览器环境：写入 localStorage
        localStorage.setItem(STORAGE_KEY, data);
      }

      console.log('[RecentDocumentsStore] Saved:', this.state.documents.length, 'documents');
    } catch (error) {
      console.error('[RecentDocumentsStore] Failed to save:', error);
    }
  }

  /**
   * 获取当前状态
   */
  getState(): RecentDocumentsState {
    return { ...this.state };
  }

  /**
   * 获取最近文档列表（按打开时间降序）
   */
  getDocuments(): RecentDocumentEntry[] {
    return [...this.state.documents].sort((a, b) => 
      new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    );
  }

  /**
   * 更新或插入文档条目（打开文档时调用）
   */
  async upsertEntry(entry: Omit<RecentDocumentEntry, 'lastOpenedAt' | 'wasDirtyOnLastClose'>): Promise<void> {
    const now = new Date().toISOString();
    
    // 查找是否已存在
    const existingIndex = this.state.documents.findIndex(d => d.path === entry.path);
    
    const newEntry: RecentDocumentEntry = {
      ...entry,
      lastOpenedAt: now,
      wasDirtyOnLastClose: false,
    };

    if (existingIndex >= 0) {
      // 更新现有条目
      this.state.documents[existingIndex] = newEntry;
    } else {
      // 添加新条目
      this.state.documents.unshift(newEntry);
      
      // 限制最大条目数
      if (this.state.documents.length > MAX_RECENT_DOCUMENTS) {
        this.state.documents = this.state.documents.slice(0, MAX_RECENT_DOCUMENTS);
      }
    }

    await this.save();
  }

  /**
   * 标记文档已关闭
   */
  async markClosed(docId: string, wasDirty: boolean): Promise<void> {
    const doc = this.state.documents.find(d => d.id === docId);
    if (doc) {
      doc.lastClosedAt = new Date().toISOString();
      doc.wasDirtyOnLastClose = wasDirty;
      await this.save();
      console.log('[RecentDocumentsStore] Marked closed:', doc.displayName, { wasDirty });
    }
  }

  /**
   * 标记应用正常退出
   */
  async markNormalExit(): Promise<void> {
    this.state.lastNormalExitAt = new Date().toISOString();
    await this.save();
    console.log('[RecentDocumentsStore] Marked normal exit');
  }

  /**
   * 检查是否有需要恢复的文档
   */
  getDocumentsNeedingRecovery(): RecentDocumentEntry[] {
    return this.state.documents.filter(d => d.wasDirtyOnLastClose);
  }

  /**
   * 清除恢复标记
   */
  async clearRecoveryFlag(docId: string): Promise<void> {
    const doc = this.state.documents.find(d => d.id === docId);
    if (doc) {
      doc.wasDirtyOnLastClose = false;
      await this.save();
    }
  }

  /**
   * 移除文档条目
   */
  async removeEntry(docId: string): Promise<void> {
    const index = this.state.documents.findIndex(d => d.id === docId);
    if (index >= 0) {
      this.state.documents.splice(index, 1);
      await this.save();
    }
  }

  /**
   * 检查路径是否仍然存在
   */
  async validatePaths(): Promise<void> {
    if (!this.isElectron) return;

    const validDocs: RecentDocumentEntry[] = [];
    
    for (const doc of this.state.documents) {
      try {
        const exists = await (window as any).electronAPI?.fileExists?.(doc.path);
        if (exists) {
          validDocs.push(doc);
        } else {
          console.log('[RecentDocumentsStore] Removing missing file:', doc.path);
        }
      } catch {
        validDocs.push(doc); // 保守处理：检查失败时保留
      }
    }

    if (validDocs.length !== this.state.documents.length) {
      this.state.documents = validDocs;
      await this.save();
    }
  }
}

// ==========================================
// 单例导出
// ==========================================

export const recentDocumentsStore = new RecentDocumentsStore();

