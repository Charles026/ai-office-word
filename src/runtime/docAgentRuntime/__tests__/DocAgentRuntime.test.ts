/**
 * DocAgentRuntime 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  DocAgentRuntime, 
  DocAgentContext, 
  SectionHandler, 
  DocAgentState,
} from '../DocAgentRuntime';
import { Section, OutlineItem } from '../../../document/section';
import { SectionDocOps } from '../../../docops/SectionDocOps';

// ==========================================
// Mock 数据
// ==========================================

function createMockSection(id: string, title: string, level: 1 | 2 | 3 = 2): Section {
  const heading: OutlineItem = {
    id,
    level,
    text: title,
    index: 0,
  };

  return {
    heading,
    startIndex: 0,
    endIndex: 2,
    paragraphIds: [id, `${id}-content-1`, `${id}-content-2`],
  };
}

function createMockContext(sections: Section[]): DocAgentContext {
  const mockDocOps = {
    getAllSections: vi.fn(() => sections),
    getSectionHtml: vi.fn(() => '<p>Mock HTML content</p>'),
    getSectionText: vi.fn(() => 'Mock text content'),
    replaceSectionFromHtml: vi.fn(() => Promise.resolve()),
    getOutline: vi.fn(() => []),
    getSectionRange: vi.fn(() => null),
    insertSectionSummary: vi.fn(() => Promise.resolve()),
  } as unknown as SectionDocOps;

  return {
    docOps: mockDocOps,
    llm: {
      translateHtmlSection: vi.fn(() => Promise.resolve('<p>Translated</p>')),
      summarizeSection: vi.fn(() => Promise.resolve('Summary')),
    },
  };
}

// ==========================================
// 测试
// ==========================================

describe('DocAgentRuntime', () => {
  let context: DocAgentContext;
  let sections: Section[];

  beforeEach(() => {
    sections = [
      createMockSection('section-1', '第一节'),
      createMockSection('section-2', '第二节'),
      createMockSection('section-3', '第三节'),
    ];
    context = createMockContext(sections);
  });

  describe('init()', () => {
    it('应该初始化步骤列表', async () => {
      const handler: SectionHandler = async () => 'success';
      const runtime = new DocAgentRuntime(context, 'doc-1', handler);

      await runtime.init();

      expect(runtime.state.steps).toHaveLength(3);
      expect(runtime.state.steps.every(s => s.status === 'pending')).toBe(true);
      expect(runtime.state.status).toBe('idle');
    });

    it('处理空章节列表', async () => {
      const emptyContext = createMockContext([]);
      const handler: SectionHandler = async () => 'success';
      const runtime = new DocAgentRuntime(emptyContext, 'doc-1', handler);

      await runtime.init();

      expect(runtime.state.steps).toHaveLength(0);
    });
  });

  describe('run()', () => {
    it('应该串行执行所有步骤', async () => {
      const executionOrder: string[] = [];
      const handler: SectionHandler = async ({ section }) => {
        executionOrder.push(section.heading.id);
        return 'success';
      };

      const runtime = new DocAgentRuntime(context, 'doc-1', handler);
      await runtime.init();
      await runtime.run();

      expect(executionOrder).toEqual(['section-1', 'section-2', 'section-3']);
      expect(runtime.state.status).toBe('success');
      expect(runtime.state.successCount).toBe(3);
    });

    it('应该处理 skipped 状态', async () => {
      const handler: SectionHandler = async ({ section }) => {
        if (section.heading.id === 'section-2') {
          return 'skipped';
        }
        return 'success';
      };

      const runtime = new DocAgentRuntime(context, 'doc-1', handler);
      await runtime.init();
      await runtime.run();

      expect(runtime.state.successCount).toBe(2);
      expect(runtime.state.skippedCount).toBe(1);
      expect(runtime.state.steps[1].status).toBe('skipped');
      expect(runtime.state.status).toBe('success');
    });

    it('应该处理错误并继续执行', async () => {
      const handler: SectionHandler = async ({ section }) => {
        if (section.heading.id === 'section-2') {
          throw new Error('Test error');
        }
        return 'success';
      };

      const runtime = new DocAgentRuntime(context, 'doc-1', handler);
      await runtime.init();
      await runtime.run();

      expect(runtime.state.successCount).toBe(2);
      expect(runtime.state.errorCount).toBe(1);
      expect(runtime.state.steps[1].status).toBe('error');
      expect(runtime.state.steps[1].error).toBe('Test error');
      expect(runtime.state.status).toBe('error');
    });

    it('空步骤列表时应该直接成功', async () => {
      const emptyContext = createMockContext([]);
      const handler: SectionHandler = async () => 'success';
      const runtime = new DocAgentRuntime(emptyContext, 'doc-1', handler);

      await runtime.init();
      await runtime.run();

      expect(runtime.state.status).toBe('success');
    });
  });

  describe('cancel()', () => {
    it('应该在下一个步骤前停止', async () => {
      let stepCount = 0;
      const handler: SectionHandler = async () => {
        stepCount++;
        if (stepCount === 2) {
          // 在第二个步骤后取消
          runtime.cancel();
        }
        return 'success';
      };

      const runtime = new DocAgentRuntime(context, 'doc-1', handler);
      await runtime.init();
      await runtime.run();

      expect(stepCount).toBe(2);
      expect(runtime.state.status).toBe('canceled');
      expect(runtime.state.steps[2].status).toBe('pending');
    });
  });

  describe('onStateChange 回调', () => {
    it('应该在状态变化时调用回调', async () => {
      const stateChanges: DocAgentState[] = [];
      const handler: SectionHandler = async () => 'success';

      const runtime = new DocAgentRuntime(context, 'doc-1', handler, {
        onStateChange: (state) => {
          stateChanges.push({ ...state });
        },
      });

      await runtime.init();
      await runtime.run();

      // init 后一次，每个步骤运行中一次、完成一次，最终一次
      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[stateChanges.length - 1].status).toBe('success');
    });
  });

  describe('getState()', () => {
    it('应该返回状态的副本', async () => {
      const handler: SectionHandler = async () => 'success';
      const runtime = new DocAgentRuntime(context, 'doc-1', handler);

      await runtime.init();

      const state1 = runtime.getState();
      const state2 = runtime.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('agentType 和 meta', () => {
    it('应该保存 agentType 和 meta', async () => {
      const handler: SectionHandler = async () => 'success';
      const runtime = new DocAgentRuntime(context, 'doc-1', handler, {
        agentType: 'translate',
        meta: { direction: 'en_to_zh' },
      });

      await runtime.init();

      expect(runtime.state.agentType).toBe('translate');
      expect(runtime.state.meta).toEqual({ direction: 'en_to_zh' });
    });
  });
});

