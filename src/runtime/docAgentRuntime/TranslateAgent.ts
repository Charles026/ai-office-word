/**
 * TranslateAgent - 整篇文档翻译 Agent
 * 
 * 【功能】
 * 按节获取 HTML → 调用 LLM 翻译 → 用新的 HTML 替换该节，最大程度保留样式和结构。
 * 
 * 【支持模式】
 * - 英文 → 中文（en_to_zh）
 * - 中文 → 英文（zh_to_en）
 */

import { SectionDocOps } from '../../docops/SectionDocOps';
import { 
  DocAgentRuntime, 
  DocAgentContext, 
  DocAgentState,
  SectionHandler,
  SectionHandlerResult,
  DocAgentRuntimeOptions 
} from './DocAgentRuntime';

// ==========================================
// 类型定义
// ==========================================

/** 翻译方向 */
export type TranslateDirection = 'en_to_zh' | 'zh_to_en';

/** TranslateAgent 配置 */
export interface TranslateAgentOptions {
  /** 翻译方向 */
  direction: TranslateDirection;
  /** 状态变化回调 */
  onStateChange?: (state: DocAgentState) => void;
}

// ==========================================
// Section Handler
// ==========================================

/**
 * 创建翻译 Section Handler
 */
function createTranslateSectionHandler(direction: TranslateDirection): SectionHandler {
  return async ({ context, section }): Promise<SectionHandlerResult> => {
    const { docOps, llm } = context;

    // 获取章节 HTML（包含标题）
    const html = docOps.getSectionHtml(section.heading.id, true);
    
    // 只有完全为空时才跳过
    if (!html || html.trim().length === 0) {
      console.log('[TranslateAgent] Skipping empty section:', section.heading.text);
      return 'skipped';
    }

    // 即使只有标题也要翻译（移除了 length < 20 的跳过逻辑）
    console.log('[TranslateAgent] Translating section:', section.heading.text, `(${html.length} chars)`);

    // 调用 LLM 翻译
    const translatedHtml = await llm.translateHtmlSection(html, { direction });

    // 验证翻译结果（降低阈值，因为有些标题翻译后可能很短）
    if (!translatedHtml || translatedHtml.trim().length === 0) {
      throw new Error('翻译结果为空');
    }

    // 替换章节内容
    await docOps.replaceSectionFromHtml(section.heading.id, translatedHtml);

    return 'success';
  };
}

// ==========================================
// TranslateAgent 类
// ==========================================

/**
 * 整篇文档翻译 Agent
 */
export class DocumentTranslateAgent {
  private runtime: DocAgentRuntime;
  private options: TranslateAgentOptions;

  constructor(
    context: DocAgentContext,
    docId: string,
    options: TranslateAgentOptions
  ) {
    this.options = options;

    // 创建 handler
    const handler = createTranslateSectionHandler(options.direction);

    // 创建 runtime
    const runtimeOptions: DocAgentRuntimeOptions = {
      agentType: 'translate',
      meta: {
        direction: options.direction,
        directionLabel: options.direction === 'en_to_zh' ? '英文→中文' : '中文→英文',
      },
      onStateChange: options.onStateChange,
      // 翻译时包含 H1，确保整个文档都被翻译
      includeH1: true,
    };

    this.runtime = new DocAgentRuntime(context, docId, handler, runtimeOptions);
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    return this.runtime.init();
  }

  /**
   * 运行翻译
   */
  async run(): Promise<void> {
    return this.runtime.run();
  }

  /**
   * 取消
   */
  cancel(): void {
    this.runtime.cancel();
  }

  /**
   * 获取状态
   */
  getState(): DocAgentState {
    return this.runtime.getState();
  }

  /**
   * 获取翻译方向
   */
  getDirection(): TranslateDirection {
    return this.options.direction;
  }

  /**
   * 获取翻译方向标签
   */
  getDirectionLabel(): string {
    return this.options.direction === 'en_to_zh' ? '翻译为中文' : '翻译为英文';
  }
}

// ==========================================
// 工厂函数
// ==========================================

/**
 * 创建 DocumentTranslateAgent 实例
 */
export function createDocumentTranslateAgent(
  docOps: SectionDocOps,
  llmApi: {
    translateHtmlSection: (html: string, options: { direction: TranslateDirection }) => Promise<string>;
  },
  docId: string,
  options: TranslateAgentOptions
): DocumentTranslateAgent {
  const context: DocAgentContext = {
    docOps,
    llm: {
      translateHtmlSection: llmApi.translateHtmlSection,
      summarizeSection: async () => '', // 不使用
    },
  };

  return new DocumentTranslateAgent(context, docId, options);
}

