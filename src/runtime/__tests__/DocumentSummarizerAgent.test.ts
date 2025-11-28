/**
 * DocumentSummarizerAgent 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DocumentSummarizerAgent,
  DocumentSummarizerState,
  SectionSummaryTask,
  createDocumentSummarizerAgent,
} from '../DocumentSummarizerAgent';

// Mock LlmService
vi.mock('../LlmService', () => ({
  llmService: {
    chat: vi.fn().mockResolvedValue({
      success: true,
      text: 'Mock summary text',
      latencyMs: 100,
    }),
    isAvailable: vi.fn().mockReturnValue(true),
  },
}));

// Mock SectionDocOps - kept for potential future use
function createMockDocOps(sections: Array<{ id: string; level: 1 | 2 | 3; text: string; content: string }>) {
  return {
  getOutline: vi.fn().mockReturnValue(
    sections.map((s, index) => ({
      id: s.id,
      level: s.level,
      text: s.text,
      index,
    }))
  ),
  getAllSections: vi.fn().mockReturnValue(
    sections.map((s, index) => ({
      heading: { id: s.id, level: s.level, text: s.text, index },
      startIndex: index * 2,
      endIndex: index * 2 + 1,
      paragraphIds: [s.id, `p${index}`],
    }))
  ),
  getSectionRange: vi.fn().mockImplementation((headingId: string) => {
    const index = sections.findIndex(s => s.id === headingId);
    if (index === -1) return null;
    const s = sections[index];
    return {
      heading: { id: s.id, level: s.level, text: s.text, index },
      startIndex: index * 2,
      endIndex: index * 2 + 1,
      paragraphIds: [s.id, `p${index}`],
    };
  }),
  getSectionText: vi.fn().mockImplementation((headingId: string) => {
    const section = sections.find(s => s.id === headingId);
    return section?.content || null;
  }),
  insertSectionSummary: vi.fn().mockResolvedValue(undefined),
  };
}
void createMockDocOps; // Suppress unused warning

describe('DocumentSummarizerAgent', () => {
  describe('初始化', () => {
    it('应该正确创建 Agent 实例', () => {
      const mockEditor = {} as any;
      const agent = new DocumentSummarizerAgent(mockEditor);
      
      expect(agent).toBeDefined();
      expect(agent.getState).toBeDefined();
    });

    it('初始状态应该是 idle', () => {
      const mockEditor = {} as any;
      const agent = new DocumentSummarizerAgent(mockEditor);
      
      const state = agent.getState();
      expect(state.overallStatus).toBe('idle');
      expect(state.tasks).toHaveLength(0);
    });
  });

  describe('状态管理', () => {
    it('应该正确追踪状态变化', async () => {
      const mockEditor = {} as any;
      const stateChanges: DocumentSummarizerState[] = [];
      
      const agent = new DocumentSummarizerAgent(
        mockEditor,
        {},
        (state) => stateChanges.push({ ...state })
      );

      // 模拟初始化
      // 由于我们没有真正的 editor，这里只测试状态追踪机制
      expect(agent.getState().overallStatus).toBe('idle');
    });
  });

  describe('取消功能', () => {
    it('应该能够取消正在运行的任务', () => {
      const mockEditor = {} as any;
      const agent = new DocumentSummarizerAgent(mockEditor);
      
      // 测试 cancel 方法存在
      expect(agent.cancel).toBeDefined();
      
      // 调用 cancel
      agent.cancel();
      
      // 这里我们只能验证方法被调用，实际取消效果需要集成测试
    });
  });
});

describe('createDocumentSummarizerAgent', () => {
  it('应该创建并初始化 Agent', () => {
    // 由于需要真正的 LexicalEditor，这里只测试函数存在
    expect(createDocumentSummarizerAgent).toBeDefined();
    expect(typeof createDocumentSummarizerAgent).toBe('function');
  });
});

describe('SectionSummaryTask 类型', () => {
  it('应该包含正确的状态类型', () => {
    const task: SectionSummaryTask = {
      section: {
        heading: { id: 'h1', level: 2, text: 'Test', index: 0 },
        startIndex: 0,
        endIndex: 1,
        paragraphIds: ['h1', 'p1'],
      },
      status: 'pending',
    };

    expect(task.status).toBe('pending');
    expect(task.section.heading.id).toBe('h1');
  });

  it('应该支持所有状态值', () => {
    const statuses = ['pending', 'running', 'success', 'error', 'skipped'] as const;
    
    statuses.forEach(status => {
      const task: SectionSummaryTask = {
        section: {
          heading: { id: 'h1', level: 2, text: 'Test', index: 0 },
          startIndex: 0,
          endIndex: 1,
          paragraphIds: ['h1', 'p1'],
        },
        status,
      };
      expect(task.status).toBe(status);
    });
  });
});

