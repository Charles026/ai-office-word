/**
 * 字体配置模块
 * 
 * 定义 AI Office 支持的字体选项。
 * 使用系统字体栈，确保跨平台兼容性。
 * 
 * 【设计说明】
 * - 不引入外部字体文件，仅使用系统字体
 * - 字体栈包含 macOS、Windows、Linux 的常见字体
 * - 字体选择是字符级格式，不影响段落样式
 */

// ==========================================
// 类型定义
// ==========================================

/**
 * 字体选项键
 * - default: 默认（使用段落样式的字体）
 * - cn_body: 中文正文字体
 * - cn_heading: 中文标题字体
 * - en_body: 英文正文字体
 * - mono: 等宽字体（代码）
 */
export type FontOptionKey = 'default' | 'cn_body' | 'cn_heading' | 'en_body' | 'mono';

/**
 * 字体分组
 */
export type FontGroup = 'System' | 'CN' | 'EN' | 'Mono';

/**
 * 字体选项配置
 */
export interface FontOption {
  /** 逻辑键，存到 editor state */
  key: FontOptionKey;
  /** UI 显示名称 */
  label: string;
  /** CSS font-family 字符串（带 fallback） */
  fontFamily: string;
  /** 分组，用于下拉框分组显示 */
  group: FontGroup;
  /** 是否为默认选项 */
  isDefault?: boolean;
}

// ==========================================
// 字体选项列表
// ==========================================

export const FONT_OPTIONS: FontOption[] = [
  {
    key: 'default',
    label: '默认',
    fontFamily: '', // 空字符串表示使用段落样式默认字体
    group: 'System',
    isDefault: true,
  },
  {
    key: 'cn_body',
    label: '中文正文',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    group: 'CN',
  },
  {
    key: 'cn_heading',
    label: '中文标题',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    group: 'CN',
  },
  {
    key: 'en_body',
    label: 'English Body',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
    group: 'EN',
  },
  {
    key: 'mono',
    label: '等宽（代码）',
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    group: 'Mono',
  },
];

// ==========================================
// 辅助函数
// ==========================================

/**
 * 根据 key 获取字体选项
 */
export function getFontOption(key: FontOptionKey): FontOption | undefined {
  return FONT_OPTIONS.find(opt => opt.key === key);
}

/**
 * 根据 key 获取 font-family
 */
export function resolveFontFamily(key: FontOptionKey): string {
  const option = getFontOption(key);
  return option?.fontFamily || '';
}

/**
 * 根据 font-family 字符串尝试匹配 FontOptionKey
 * 用于 HTML → Editor 映射
 */
export function matchFontFamily(fontFamily: string): FontOptionKey | null {
  if (!fontFamily) return null;
  
  const normalized = fontFamily.toLowerCase();
  
  // 尝试匹配等宽字体
  if (normalized.includes('monospace') || 
      normalized.includes('consolas') || 
      normalized.includes('monaco') ||
      normalized.includes('menlo') ||
      normalized.includes('courier')) {
    return 'mono';
  }
  
  // 尝试匹配中文字体
  if (normalized.includes('pingfang') || 
      normalized.includes('yahei') ||
      normalized.includes('noto sans cjk') ||
      normalized.includes('heiti') ||
      normalized.includes('songti')) {
    // 区分标题和正文（简单判断）
    if (normalized.includes('display') || normalized.includes('bold')) {
      return 'cn_heading';
    }
    return 'cn_body';
  }
  
  // 尝试匹配英文字体
  if (normalized.includes('sf pro') ||
      normalized.includes('segoe') ||
      normalized.includes('roboto') ||
      normalized.includes('helvetica') ||
      normalized.includes('arial')) {
    return 'en_body';
  }
  
  return null;
}

/**
 * 获取按分组组织的字体选项
 */
export function getFontOptionsByGroup(): Record<FontGroup, FontOption[]> {
  const groups: Record<FontGroup, FontOption[]> = {
    System: [],
    CN: [],
    EN: [],
    Mono: [],
  };
  
  for (const option of FONT_OPTIONS) {
    groups[option.group].push(option);
  }
  
  return groups;
}

/**
 * 获取分组的显示名称
 */
export function getGroupLabel(group: FontGroup): string {
  switch (group) {
    case 'System':
      return '系统';
    case 'CN':
      return '中文';
    case 'EN':
      return '英文';
    case 'Mono':
      return '等宽';
    default:
      return group;
  }
}

