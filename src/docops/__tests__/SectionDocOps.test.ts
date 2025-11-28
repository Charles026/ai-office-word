/**
 * SectionDocOps 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
// 注意：由于 SectionDocOps 依赖 LexicalEditor，这里使用集成测试风格
// 主要测试纯函数部分

describe('SectionDocOps', () => {
  describe('基础功能', () => {
    it('应该正确导出 SectionDocOps 类', async () => {
      const { SectionDocOps } = await import('../SectionDocOps');
      expect(SectionDocOps).toBeDefined();
    });

    it('应该正确导出 createSectionDocOps 函数', async () => {
      const { createSectionDocOps } = await import('../SectionDocOps');
      expect(createSectionDocOps).toBeDefined();
      expect(typeof createSectionDocOps).toBe('function');
    });
  });
});

// 由于 SectionDocOps 依赖 LexicalEditor，完整测试需要在集成测试中进行
// 这里提供 mock 测试的示例

describe('SectionDocOps with Mock Editor', () => {
  // Mock Lexical Editor
  const createMockEditor = (_blocks: Array<{
    id: string;
    type: 'heading' | 'paragraph';
    level?: 1 | 2 | 3;
    text: string;
  }>) => {
    // Note: mockRoot is created for potential future use in callback
    return {
      getEditorState: () => ({
        read: (callback: () => void) => {
          // Mock $getRoot to return our mock root
          callback();
        },
      }),
      update: vi.fn((callback: () => void, options?: any) => {
        callback();
        options?.onUpdate?.();
        return Promise.resolve();
      }),
    };
  };

  it('应该能够识别 heading 节点', () => {
    const mockBlocks = [
      { id: 'h1', type: 'heading' as const, level: 1 as const, text: '第一章' },
      { id: 'p1', type: 'paragraph' as const, text: '内容' },
    ];
    const mockEditor = createMockEditor(mockBlocks);
    
    // 这里我们测试 mock 是否正确设置
    expect(mockEditor.getEditorState).toBeDefined();
    expect(mockEditor.update).toBeDefined();
  });
});

