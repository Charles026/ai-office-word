/**
 * DocumentSaveService - 统一的文档保存服务
 * 
 * 【职责】
 * - 提供统一的保存接口
 * - 管理保存状态（saving, dirty, lastSaved）
 * - 实现 Auto-save 逻辑（debounce）
 * - 集成 SnapshotService（手动保存时）
 * 
 * 【设计原则】
 * - 单例模式，全局唯一
 * - 不直接操作 UI，通过回调通知状态变化
 * - 所有 I/O 操作通过 IPC 调用主进程
 * 
 * 【TODO: DocAgent 集成】
 * - 未来可以在保存前/后触发 Agent 钩子
 * - 例如：保存后自动更新摘要、检测格式问题等
 */

// ==========================================
// 类型定义
// ==========================================

/** 保存结果 */
export interface SaveResult {
  ok: boolean;
  error?: string;
  savedAt?: number; // 时间戳
  filePath?: string;
}

/** 保存状态 */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** 文档保存状态 */
export interface DocumentSaveState {
  docId: string;
  status: SaveStatus;
  isDirty: boolean;
  lastSavedAt?: number;
  lastError?: string;
  filePath?: string;
}

/** 状态变化回调 */
export type SaveStateChangeCallback = (state: DocumentSaveState) => void;

/** 保存服务配置 */
export interface DocumentSaveServiceConfig {
  /** Auto-save debounce 延迟（毫秒） */
  autoSaveDelayMs: number;
  /** 是否启用 Auto-save */
  autoSaveEnabled: boolean;
  /** 保存失败后重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒） */
  retryDelayMs: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: DocumentSaveServiceConfig = {
  autoSaveDelayMs: 1500,
  autoSaveEnabled: true,
  maxRetries: 2,
  retryDelayMs: 1000,
};

// ==========================================
// DocumentSaveService 类
// ==========================================

export class DocumentSaveService {
  private config: DocumentSaveServiceConfig;
  private states: Map<string, DocumentSaveState> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private saveInProgress: Map<string, boolean> = new Map();
  private pendingContent: Map<string, unknown> = new Map();
  private listeners: Set<SaveStateChangeCallback> = new Set();

  constructor(config: Partial<DocumentSaveServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================
  // 公开方法
  // ==========================================

  /**
   * 获取文档保存状态
   */
  getState(docId: string): DocumentSaveState {
    return this.states.get(docId) || this.createInitialState(docId);
  }

  /**
   * 标记文档内容已变化（触发 Auto-save）
   */
  markDirty(docId: string, content: unknown, filePath?: string): void {
    const state = this.getState(docId);
    
    // 保存待保存的内容
    this.pendingContent.set(docId, content);
    
    // 更新状态
    this.updateState(docId, {
      isDirty: true,
      status: 'pending',
      filePath: filePath || state.filePath,
    });

    // 如果启用了 Auto-save，设置 debounce timer
    if (this.config.autoSaveEnabled && filePath) {
      this.scheduleAutoSave(docId);
    }
  }

  /**
   * 立即保存文档
   * 
   * @param docId - 文档 ID
   * @param content - 可选，如果不提供则使用 pendingContent
   * @param isManualSave - 是否为手动保存（手动保存会触发快照）
   */
  async saveNow(
    docId: string, 
    content?: unknown, 
    isManualSave: boolean = false
  ): Promise<SaveResult> {
    const state = this.getState(docId);
    
    // 获取要保存的内容
    const contentToSave = content ?? this.pendingContent.get(docId);
    
    // 没有文件路径，需要另存为
    if (!state.filePath) {
      return this.saveAs(docId, contentToSave);
    }

    // 如果已经在保存中，标记需要再次保存
    if (this.saveInProgress.get(docId)) {
      console.log('[DocumentSaveService] Save already in progress, will save again after:', docId);
      return { ok: true }; // 稍后会自动再次保存
    }

    return this.doSave(docId, state.filePath, contentToSave, isManualSave);
  }

  /**
   * 另存为
   */
  async saveAs(docId: string, content: unknown): Promise<SaveResult> {
    const state = this.getState(docId);
    
    this.updateState(docId, { status: 'saving' });

    try {
      const result = await window.aiFormat?.saveAsDocx?.(content, state.filePath);
      
      if (result?.success && result.filePath) {
        const now = Date.now();
        
        this.updateState(docId, {
          status: 'saved',
          isDirty: false,
          lastSavedAt: now,
          filePath: result.filePath,
          lastError: undefined,
        });

        // 清除待保存内容
        this.pendingContent.delete(docId);

        console.log('[DocumentSaveService] Save As successful:', result.filePath);
        
        return { ok: true, savedAt: now, filePath: result.filePath };
      } else {
        throw new Error(result?.error || '保存失败');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      
      this.updateState(docId, {
        status: 'error',
        lastError: errorMsg,
      });

      console.error('[DocumentSaveService] Save As failed:', errorMsg);
      
      return { ok: false, error: errorMsg };
    }
  }

  /**
   * 取消 Auto-save timer
   */
  cancelAutoSave(docId: string): void {
    const timer = this.timers.get(docId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(docId);
    }
  }

  /**
   * 订阅状态变化
   */
  subscribe(callback: SaveStateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DocumentSaveServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 清理文档状态（关闭文档时调用）
   */
  cleanup(docId: string): void {
    this.cancelAutoSave(docId);
    this.states.delete(docId);
    this.pendingContent.delete(docId);
    this.saveInProgress.delete(docId);
  }

  // ==========================================
  // 私有方法
  // ==========================================

  private createInitialState(docId: string): DocumentSaveState {
    const state: DocumentSaveState = {
      docId,
      status: 'idle',
      isDirty: false,
    };
    this.states.set(docId, state);
    return state;
  }

  private updateState(docId: string, updates: Partial<DocumentSaveState>): void {
    const current = this.getState(docId);
    const newState = { ...current, ...updates };
    this.states.set(docId, newState);
    
    // 通知所有监听者
    this.listeners.forEach(cb => cb(newState));
  }

  private scheduleAutoSave(docId: string): void {
    // 取消现有 timer
    this.cancelAutoSave(docId);

    // 设置新 timer
    const timer = setTimeout(() => {
      this.timers.delete(docId);
      
      // 检查是否仍然需要保存
      const state = this.getState(docId);
      if (state.isDirty && state.filePath) {
        this.saveNow(docId).catch(err => {
          console.error('[DocumentSaveService] Auto-save failed:', err);
        });
      }
    }, this.config.autoSaveDelayMs);

    this.timers.set(docId, timer);
  }

  private async doSave(
    docId: string,
    filePath: string,
    content: unknown,
    isManualSave: boolean
  ): Promise<SaveResult> {
    this.saveInProgress.set(docId, true);
    this.updateState(docId, { status: 'saving' });

    let lastError: string | undefined;
    let retries = 0;

    while (retries <= this.config.maxRetries) {
      try {
        console.log('[DocumentSaveService] Saving:', filePath, `(attempt ${retries + 1})`);
        
        const result = await window.aiFormat?.exportDocx?.(filePath, content);
        
        if (result?.success) {
          const now = Date.now();
          
          // 检查在保存期间是否有新的修改
          const currentContent = this.pendingContent.get(docId);
          const stillDirty = currentContent !== undefined && currentContent !== content;
          
          this.updateState(docId, {
            status: 'saved',
            isDirty: stillDirty,
            lastSavedAt: now,
            lastError: undefined,
          });

          // 如果没有新修改，清除待保存内容
          if (!stillDirty) {
            this.pendingContent.delete(docId);
          }

          this.saveInProgress.set(docId, false);

          console.log('[DocumentSaveService] Save successful:', filePath);

          // TODO: 手动保存时触发 SnapshotService.createSnapshot
          if (isManualSave) {
            // 这里将来接入 SnapshotService
            console.log('[DocumentSaveService] Manual save - snapshot will be created');
          }

          // 如果在保存期间有新修改，自动再次保存
          if (stillDirty && this.config.autoSaveEnabled) {
            console.log('[DocumentSaveService] New changes detected, scheduling another save');
            this.scheduleAutoSave(docId);
          }

          return { ok: true, savedAt: now, filePath };
        } else {
          throw new Error(result?.error || '保存失败');
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : '未知错误';
        console.error('[DocumentSaveService] Save attempt failed:', lastError);
        
        retries++;
        
        if (retries <= this.config.maxRetries) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    // 所有重试都失败了
    this.updateState(docId, {
      status: 'error',
      lastError,
    });

    this.saveInProgress.set(docId, false);

    console.error('[DocumentSaveService] All save attempts failed:', lastError);

    return { ok: false, error: lastError };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==========================================
// 单例导出
// ==========================================

export const documentSaveService = new DocumentSaveService();

