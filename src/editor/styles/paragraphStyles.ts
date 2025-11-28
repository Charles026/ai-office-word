/**
 * 段落样式配置
 * 
 * 定义 Word 风格的段落样式系统。
 * 所有样式属性集中配置，便于统一管理和扩展。
 * 
 * 【样式层级】
 * - normal: 正文，默认样式
 * - heading1: 标题 1，最大标题
 * - heading2: 标题 2，次级标题
 * - heading3: 标题 3，三级标题
 * 
 * 【扩展预留】
 * - quote: 引用
 * - code: 代码块
 * - caption: 图表标题
 */

// ==========================================
// 类型定义
// ==========================================

export type ParagraphStyle = 'normal' | 'heading1' | 'heading2' | 'heading3';

export interface ParagraphStyleConfig {
  /** 样式 ID */
  id: ParagraphStyle;
  /** 显示名称 */
  label: string;
  /** 快捷键提示 */
  shortcut?: string;
  /** 对应的 HTML 标签 */
  htmlTag: 'p' | 'h1' | 'h2' | 'h3';
  /** 对应的 Lexical blockType */
  blockType: 'paragraph' | 'heading';
  /** 标题级别（仅 heading 类型） */
  headingLevel?: 1 | 2 | 3;
  /** 排版属性 */
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: number;
    lineHeight: number;
    /** 段前距 (px) */
    spacingBefore: number;
    /** 段后距 (px) */
    spacingAfter: number;
    /** 默认对齐 */
    alignment: 'left' | 'center' | 'right';
    /** 文字颜色 */
    color: string;
  };
}

// ==========================================
// 样式配置
// ==========================================

export const PARAGRAPH_STYLES: Record<ParagraphStyle, ParagraphStyleConfig> = {
  normal: {
    id: 'normal',
    label: '正文',
    shortcut: '⌘⌥0',
    htmlTag: 'p',
    blockType: 'paragraph',
    typography: {
      fontFamily: '"Times New Roman", "SimSun", serif',
      fontSize: '16px',
      fontWeight: 400,
      lineHeight: 1.6,
      spacingBefore: 0,
      spacingAfter: 12,
      alignment: 'left',
      color: '#1d1d1f',
    },
  },
  heading1: {
    id: 'heading1',
    label: '标题 1',
    shortcut: '⌘⌥1',
    htmlTag: 'h1',
    blockType: 'heading',
    headingLevel: 1,
    typography: {
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '28px',
      fontWeight: 700,
      lineHeight: 1.3,
      spacingBefore: 24,
      spacingAfter: 12,
      alignment: 'left',
      color: '#1d1d1f',
    },
  },
  heading2: {
    id: 'heading2',
    label: '标题 2',
    shortcut: '⌘⌥2',
    htmlTag: 'h2',
    blockType: 'heading',
    headingLevel: 2,
    typography: {
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '22px',
      fontWeight: 600,
      lineHeight: 1.35,
      spacingBefore: 20,
      spacingAfter: 10,
      alignment: 'left',
      color: '#1d1d1f',
    },
  },
  heading3: {
    id: 'heading3',
    label: '标题 3',
    shortcut: '⌘⌥3',
    htmlTag: 'h3',
    blockType: 'heading',
    headingLevel: 3,
    typography: {
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '18px',
      fontWeight: 600,
      lineHeight: 1.4,
      spacingBefore: 16,
      spacingAfter: 8,
      alignment: 'left',
      color: '#1d1d1f',
    },
  },
};

// ==========================================
// 辅助函数
// ==========================================

/**
 * 获取样式配置
 */
export function getStyleConfig(style: ParagraphStyle): ParagraphStyleConfig {
  return PARAGRAPH_STYLES[style] || PARAGRAPH_STYLES.normal;
}

/**
 * 根据 HTML 标签获取样式
 */
export function getStyleFromHtmlTag(tag: string): ParagraphStyle {
  switch (tag.toLowerCase()) {
    case 'h1':
      return 'heading1';
    case 'h2':
      return 'heading2';
    case 'h3':
      return 'heading3';
    case 'p':
    default:
      return 'normal';
  }
}

/**
 * 根据 Lexical 节点类型获取样式
 */
export function getStyleFromBlockType(blockType: string, headingLevel?: number): ParagraphStyle {
  if (blockType === 'heading') {
    switch (headingLevel) {
      case 1:
        return 'heading1';
      case 2:
        return 'heading2';
      case 3:
        return 'heading3';
      default:
        return 'heading1';
    }
  }
  return 'normal';
}

/**
 * 获取所有样式列表（用于下拉菜单）
 */
export function getAllStyles(): ParagraphStyleConfig[] {
  return Object.values(PARAGRAPH_STYLES);
}

/**
 * 生成样式的 CSS 变量
 */
export function generateStyleCSSVars(style: ParagraphStyle): Record<string, string> {
  const config = getStyleConfig(style);
  const { typography } = config;
  
  return {
    '--paragraph-font-family': typography.fontFamily,
    '--paragraph-font-size': typography.fontSize,
    '--paragraph-font-weight': String(typography.fontWeight),
    '--paragraph-line-height': String(typography.lineHeight),
    '--paragraph-spacing-before': `${typography.spacingBefore}px`,
    '--paragraph-spacing-after': `${typography.spacingAfter}px`,
    '--paragraph-color': typography.color,
  };
}

