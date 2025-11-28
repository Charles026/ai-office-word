/**
 * TranslateAgent 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentTranslateAgent } from '../TranslateAgent';
import { DocAgentContext } from '../DocAgentRuntime';
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
    // 返回足够长的 HTML（>= 20 字符）
    getSectionHtml: vi.fn(() => '<p>Hello World, this is a longer content for testing.</p>'),
    getSectionText: vi.fn(() => 'Hello World, this is a longer content for testing.'),
    replaceSectionFromHtml: vi.fn(() => Promise.resolve()),
    getOutline: vi.fn(() => []),
    getSectionRange: vi.fn(() => null),
    insertSectionSummary: vi.fn(() => Promise.resolve()),
  } as unknown as SectionDocOps;

  return {
    docOps: mockDocOps,
    llm: {
      // 返回足够长的翻译结果（>= 10 字符）
      translateHtmlSection: vi.fn(() => Promise.resolve('<p>你好世界，这是一段较长的测试内容。</p>')),
      summarizeSection: vi.fn(() => Promise.resolve('Summary')),
    },
  };
}

// ==========================================
// 测试
// ==========================================

describe('DocumentTranslateAgent', () => {
  let context: DocAgentContext;
  let sections: Section[];

  beforeEach(() => {
    sections = [
      createMockSection('section-1', 'Introduction'),
      createMockSection('section-2', 'Methods'),
      createMockSection('section-3', 'Conclusion'),
    ];
    context = createMockContext(sections);
  });

  describe('初始化', () => {
    it('应该正确初始化', async () => {
      const agent = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'en_to_zh',
      });

      await agent.init();

      const state = agent.getState();
      expect(state.steps).toHaveLength(3);
      expect(state.agentType).toBe('translate');
      expect(state.meta?.direction).toBe('en_to_zh');
    });

    it('应该返回正确的方向标签', () => {
      const agentZh = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'en_to_zh',
      });
      expect(agentZh.getDirectionLabel()).toBe('翻译为中文');

      const agentEn = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'zh_to_en',
      });
      expect(agentEn.getDirectionLabel()).toBe('翻译为英文');
    });
  });

  describe('运行', () => {
    it('应该翻译所有章节', async () => {
      const agent = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'en_to_zh',
      });

      await agent.init();
      await agent.run();

      const state = agent.getState();
      expect(state.status).toBe('success');
      expect(state.successCount).toBe(3);
      expect(state.errorCount).toBe(0);
    });

    it('应该正确设置翻译方向', async () => {
      const agent = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'zh_to_en',
      });

      expect(agent.getDirection()).toBe('zh_to_en');
      expect(agent.getDirectionLabel()).toBe('翻译为英文');
    });

    it('有错误时应该标记为错误状态', async () => {
      // 让所有翻译都失败
      (context.llm.translateHtmlSection as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Translation failed')
      );

      const agent = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'en_to_zh',
      });

      await agent.init();
      await agent.run();

      const state = agent.getState();
      expect(state.status).toBe('error');
      expect(state.errorCount).toBe(3);
      expect(state.successCount).toBe(0);
    });
  });

  describe('取消', () => {
    it('应该支持取消操作', async () => {
      const agent = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'en_to_zh',
      });

      await agent.init();
      
      // 初始化后立即取消
      agent.cancel();
      await agent.run();

      const state = agent.getState();
      expect(state.status).toBe('canceled');
      // 取消后不应该有成功的步骤
      expect(state.successCount).toBe(0);
    });
  });

  describe('状态回调', () => {
    it('应该在状态变化时调用回调', async () => {
      const stateChanges: any[] = [];

      const agent = new DocumentTranslateAgent(context, 'doc-1', {
        direction: 'en_to_zh',
        onStateChange: (state) => {
          stateChanges.push({ ...state });
        },
      });

      await agent.init();
      await agent.run();

      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[stateChanges.length - 1].status).toBe('success');
    });
  });
});

