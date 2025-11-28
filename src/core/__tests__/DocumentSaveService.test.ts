/**
 * DocumentSaveService 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentSaveService } from '../DocumentSaveService';

// Mock window.aiFormat
const mockExportDocx = vi.fn();
const mockSaveAsDocx = vi.fn();

beforeEach(() => {
  // Setup window mock
  (global as any).window = {
    aiFormat: {
      exportDocx: mockExportDocx,
      saveAsDocx: mockSaveAsDocx,
    },
  };
  
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  delete (global as any).window;
});

describe('DocumentSaveService', () => {
  describe('getState', () => {
    it('应该返回初始状态', () => {
      const service = new DocumentSaveService();
      const state = service.getState('doc-1');
      
      expect(state.docId).toBe('doc-1');
      expect(state.status).toBe('idle');
      expect(state.isDirty).toBe(false);
    });
  });

  describe('markDirty', () => {
    it('应该标记文档为 dirty 并设置 pending 状态', () => {
      const service = new DocumentSaveService();
      
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      
      const state = service.getState('doc-1');
      expect(state.isDirty).toBe(true);
      expect(state.status).toBe('pending');
      expect(state.filePath).toBe('/path/to/doc.docx');
    });

    it('应该在没有 filePath 时不触发 auto-save', () => {
      const service = new DocumentSaveService();
      
      service.markDirty('doc-1', 'content');
      
      const state = service.getState('doc-1');
      expect(state.isDirty).toBe(true);
      expect(state.filePath).toBeUndefined();
    });
  });

  describe('Auto-save debounce', () => {
    it('应该在 debounce 时间后触发保存', async () => {
      mockExportDocx.mockResolvedValue({ success: true });
      
      const service = new DocumentSaveService({ autoSaveDelayMs: 1000 });
      
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      
      // 还没到 debounce 时间
      expect(mockExportDocx).not.toHaveBeenCalled();
      
      // 快进到 debounce 时间后
      await vi.advanceTimersByTimeAsync(1000);
      
      expect(mockExportDocx).toHaveBeenCalledWith('/path/to/doc.docx', 'content');
    });

    it('多次 markDirty 应该只触发一次保存', async () => {
      mockExportDocx.mockResolvedValue({ success: true });
      
      const service = new DocumentSaveService({ autoSaveDelayMs: 1000 });
      
      service.markDirty('doc-1', 'content1', '/path/to/doc.docx');
      vi.advanceTimersByTime(500);
      
      service.markDirty('doc-1', 'content2', '/path/to/doc.docx');
      vi.advanceTimersByTime(500);
      
      service.markDirty('doc-1', 'content3', '/path/to/doc.docx');
      
      await vi.advanceTimersByTimeAsync(1000);
      
      // 只应该保存最后一次的内容
      expect(mockExportDocx).toHaveBeenCalledTimes(1);
      expect(mockExportDocx).toHaveBeenCalledWith('/path/to/doc.docx', 'content3');
    });
  });

  describe('saveNow', () => {
    it('保存成功应该更新状态', async () => {
      mockExportDocx.mockResolvedValue({ success: true });
      
      const service = new DocumentSaveService();
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      
      const result = await service.saveNow('doc-1');
      
      expect(result.ok).toBe(true);
      expect(result.filePath).toBe('/path/to/doc.docx');
      
      const state = service.getState('doc-1');
      expect(state.status).toBe('saved');
      expect(state.isDirty).toBe(false);
      expect(state.lastSavedAt).toBeDefined();
    });

    it('保存失败应该更新错误状态', async () => {
      mockExportDocx.mockResolvedValue({ success: false, error: '磁盘已满' });
      
      const service = new DocumentSaveService({ maxRetries: 0 });
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      
      const result = await service.saveNow('doc-1');
      
      expect(result.ok).toBe(false);
      expect(result.error).toBe('磁盘已满');
      
      const state = service.getState('doc-1');
      expect(state.status).toBe('error');
      expect(state.lastError).toBe('磁盘已满');
    });

    it('没有 filePath 应该调用 saveAs', async () => {
      mockSaveAsDocx.mockResolvedValue({ 
        success: true, 
        filePath: '/new/path/doc.docx' 
      });
      
      const service = new DocumentSaveService();
      service.markDirty('doc-1', 'content');
      
      const result = await service.saveNow('doc-1');
      
      expect(mockSaveAsDocx).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.filePath).toBe('/new/path/doc.docx');
    });
  });

  describe('subscribe', () => {
    it('状态变化时应该通知订阅者', async () => {
      mockExportDocx.mockResolvedValue({ success: true });
      
      const service = new DocumentSaveService();
      const callback = vi.fn();
      
      service.subscribe(callback);
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          docId: 'doc-1',
          status: 'pending',
          isDirty: true,
        })
      );
    });

    it('取消订阅后不应该收到通知', () => {
      const service = new DocumentSaveService();
      const callback = vi.fn();
      
      const unsubscribe = service.subscribe(callback);
      unsubscribe();
      
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('cancelAutoSave', () => {
    it('应该取消 pending 的 auto-save', async () => {
      mockExportDocx.mockResolvedValue({ success: true });
      
      const service = new DocumentSaveService({ autoSaveDelayMs: 1000 });
      
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      vi.advanceTimersByTime(500);
      
      service.cancelAutoSave('doc-1');
      
      await vi.advanceTimersByTimeAsync(1000);
      
      expect(mockExportDocx).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('应该清理文档状态', () => {
      const service = new DocumentSaveService();
      
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      service.cleanup('doc-1');
      
      // cleanup 后 getState 应该返回新的初始状态
      const state = service.getState('doc-1');
      expect(state.isDirty).toBe(false);
      expect(state.status).toBe('idle');
    });
  });

  describe('重试逻辑', () => {
    it('保存失败应该重试指定次数', async () => {
      // 使用真实定时器来测试重试逻辑
      vi.useRealTimers();
      
      mockExportDocx
        .mockResolvedValueOnce({ success: false, error: '网络错误' })
        .mockResolvedValueOnce({ success: false, error: '网络错误' })
        .mockResolvedValueOnce({ success: true });
      
      const service = new DocumentSaveService({ 
        maxRetries: 2,
        retryDelayMs: 10, // 使用短延迟加快测试
      });
      
      service.markDirty('doc-1', 'content', '/path/to/doc.docx');
      
      const result = await service.saveNow('doc-1');
      
      expect(mockExportDocx).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(true);
      
      // 恢复 fake timers
      vi.useFakeTimers();
    });
  });
});

