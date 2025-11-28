/**
 * 排版配置模块
 * 
 * 定义字号、行距等排版选项。
 */

// ==========================================
// 字号配置
// ==========================================

export type FontSizeKey = '10' | '11' | '12' | '14' | '16' | '18' | '20' | '24' | '28' | '32' | '36';

export interface FontSizeOption {
  key: FontSizeKey;
  label: string;
  value: string; // CSS value
  px: number;
}

export const FONT_SIZE_OPTIONS: FontSizeOption[] = [
  { key: '10', label: '10', value: '10px', px: 10 },
  { key: '11', label: '11', value: '11px', px: 11 },
  { key: '12', label: '12', value: '12px', px: 12 },
  { key: '14', label: '14', value: '14px', px: 14 },
  { key: '16', label: '16', value: '16px', px: 16 },
  { key: '18', label: '18', value: '18px', px: 18 },
  { key: '20', label: '20', value: '20px', px: 20 },
  { key: '24', label: '24', value: '24px', px: 24 },
  { key: '28', label: '28', value: '28px', px: 28 },
  { key: '32', label: '32', value: '32px', px: 32 },
  { key: '36', label: '36', value: '36px', px: 36 },
];

export const DEFAULT_FONT_SIZE: FontSizeKey = '16';

export function getFontSizeOption(key: FontSizeKey): FontSizeOption | undefined {
  return FONT_SIZE_OPTIONS.find(opt => opt.key === key);
}

export function getFontSizeValue(key: FontSizeKey): string {
  return getFontSizeOption(key)?.value || '16px';
}

/**
 * 从 CSS 值匹配字号键
 */
export function matchFontSize(cssValue: string): FontSizeKey | null {
  if (!cssValue) return null;
  
  // 提取数字
  const match = cssValue.match(/(\d+)/);
  if (!match) return null;
  
  const px = parseInt(match[1], 10);
  
  // 找最接近的
  let closest: FontSizeOption | null = null;
  let minDiff = Infinity;
  
  for (const opt of FONT_SIZE_OPTIONS) {
    const diff = Math.abs(opt.px - px);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }
  
  // 如果差距太大，返回 null
  if (minDiff > 2) return null;
  
  return closest?.key || null;
}

// ==========================================
// 行距配置
// ==========================================

export type LineHeightKey = '1.0' | '1.15' | '1.5' | '2.0';

export interface LineHeightOption {
  key: LineHeightKey;
  label: string;
  value: number;
}

export const LINE_HEIGHT_OPTIONS: LineHeightOption[] = [
  { key: '1.0', label: '单倍', value: 1.0 },
  { key: '1.15', label: '1.15', value: 1.15 },
  { key: '1.5', label: '1.5 倍', value: 1.5 },
  { key: '2.0', label: '双倍', value: 2.0 },
];

export const DEFAULT_LINE_HEIGHT: LineHeightKey = '1.5';

export function getLineHeightOption(key: LineHeightKey): LineHeightOption | undefined {
  return LINE_HEIGHT_OPTIONS.find(opt => opt.key === key);
}

export function getLineHeightValue(key: LineHeightKey): number {
  return getLineHeightOption(key)?.value || 1.5;
}

/**
 * 从数值匹配行距键
 */
export function matchLineHeight(value: number): LineHeightKey | null {
  if (!value) return null;
  
  // 找最接近的
  let closest: LineHeightOption | null = null;
  let minDiff = Infinity;
  
  for (const opt of LINE_HEIGHT_OPTIONS) {
    const diff = Math.abs(opt.value - value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }
  
  // 如果差距太大，返回 null
  if (minDiff > 0.1) return null;
  
  return closest?.key || null;
}

// ==========================================
// 对齐方式配置
// ==========================================

export type TextAlignKey = 'left' | 'center' | 'right' | 'justify';

export interface TextAlignOption {
  key: TextAlignKey;
  label: string;
  icon: string; // Icon name
}

export const TEXT_ALIGN_OPTIONS: TextAlignOption[] = [
  { key: 'left', label: '左对齐', icon: 'AlignLeft' },
  { key: 'center', label: '居中', icon: 'AlignCenter' },
  { key: 'right', label: '右对齐', icon: 'AlignRight' },
  { key: 'justify', label: '两端对齐', icon: 'AlignJustify' },
];

export const DEFAULT_TEXT_ALIGN: TextAlignKey = 'left';

export function getTextAlignOption(key: TextAlignKey): TextAlignOption | undefined {
  return TEXT_ALIGN_OPTIONS.find(opt => opt.key === key);
}

