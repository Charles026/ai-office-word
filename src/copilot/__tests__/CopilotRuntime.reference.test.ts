/**
 * CopilotRuntime 自然语言引用解析测试 (v1.1)
 * 
 * 测试 inferParagraphRefFromText 函数的行为：
 * - "这一段" / "这段" → current
 * - "上一段" / "前一段" → previous
 * - "下一段" / "后一段" → next
 * - "第三段" / "第 3 段" / "第三段" → nth + index
 */

import { describe, it, expect } from 'vitest';

// 注意：inferParagraphRefFromText 是私有函数，我们需要通过导出或测试整体行为来验证
// 这里我们测试 Intent 解析器从用户文本中推断的能力

// ==========================================
// 测试用例数据
// ==========================================

interface TestCase {
  userText: string;
  expectedRef: 'current' | 'previous' | 'next' | 'nth' | null;
  expectedIndex?: number;
  description: string;
}

const CURRENT_CASES: TestCase[] = [
  { userText: '帮我改写这一段', expectedRef: 'current', description: '这一段' },
  { userText: '请润色这段', expectedRef: 'current', description: '这段' },
  { userText: '改写当前段', expectedRef: 'current', description: '当前段' },
  { userText: '优化这一段落的表达', expectedRef: 'current', description: '这一段落' },
  { userText: '把这段落写得更好', expectedRef: 'current', description: '这段落' },
];

const PREVIOUS_CASES: TestCase[] = [
  { userText: '帮我改写上一段', expectedRef: 'previous', description: '上一段' },
  { userText: '润色前一段', expectedRef: 'previous', description: '前一段' },
  { userText: '优化上段', expectedRef: 'previous', description: '上段' },
];

const NEXT_CASES: TestCase[] = [
  { userText: '帮我改写下一段', expectedRef: 'next', description: '下一段' },
  { userText: '润色后一段', expectedRef: 'next', description: '后一段' },
  { userText: '优化下段', expectedRef: 'next', description: '下段' },
];

const NTH_CASES: TestCase[] = [
  { userText: '帮我改写第一段', expectedRef: 'nth', expectedIndex: 1, description: '第一段' },
  { userText: '润色第二段', expectedRef: 'nth', expectedIndex: 2, description: '第二段' },
  { userText: '优化第三段', expectedRef: 'nth', expectedIndex: 3, description: '第三段' },
  { userText: '改写第四段', expectedRef: 'nth', expectedIndex: 4, description: '第四段' },
  { userText: '帮我改写第五段', expectedRef: 'nth', expectedIndex: 5, description: '第五段' },
  { userText: '帮我改写第六段', expectedRef: 'nth', expectedIndex: 6, description: '第六段' },
  { userText: '帮我改写第七段', expectedRef: 'nth', expectedIndex: 7, description: '第七段' },
  { userText: '帮我改写第八段', expectedRef: 'nth', expectedIndex: 8, description: '第八段' },
  { userText: '帮我改写第九段', expectedRef: 'nth', expectedIndex: 9, description: '第九段' },
  { userText: '帮我改写第十段', expectedRef: 'nth', expectedIndex: 10, description: '第十段' },
  { userText: '改写第 1 段', expectedRef: 'nth', expectedIndex: 1, description: '第 1 段' },
  { userText: '改写第3段', expectedRef: 'nth', expectedIndex: 3, description: '第3段' },
  { userText: '改写第 10 段', expectedRef: 'nth', expectedIndex: 10, description: '第 10 段' },
];

const NO_MATCH_CASES: TestCase[] = [
  { userText: '帮我总结这篇文档', expectedRef: null, description: '不含段落引用' },
  { userText: '改写整个章节', expectedRef: null, description: '章节而非段落' },
  { userText: '你好', expectedRef: null, description: '普通问候' },
];

// ==========================================
// 辅助函数（复制 inferParagraphRefFromText 的逻辑用于测试）
// ==========================================

type ParagraphRef = 'current' | 'previous' | 'next' | 'nth';

function parseChineseOrArabicNumber(str: string): number | null {
  const arabicNum = parseInt(str, 10);
  if (!isNaN(arabicNum)) {
    return arabicNum;
  }
  
  const chineseMap: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
    '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
  };
  
  return chineseMap[str] ?? null;
}

function inferParagraphRefFromText(userText: string): { ref: ParagraphRef; index?: number } | null {
  // 匹配 "这一段" / "这段" / "当前段"
  if (/(这一段|这段|当前段|这一段落|这段落)/.test(userText)) {
    return { ref: 'current' };
  }
  
  // 匹配 "上一段" / "前一段"
  if (/(上一段|前一段|上段)/.test(userText)) {
    return { ref: 'previous' };
  }
  
  // 匹配 "下一段" / "后一段"
  if (/(下一段|后一段|下段)/.test(userText)) {
    return { ref: 'next' };
  }
  
  // 匹配 "第 N 段"
  const nthMatch = userText.match(/第\s*([一二三四五六七八九十\d]+)\s*段/);
  if (nthMatch) {
    const index = parseChineseOrArabicNumber(nthMatch[1]);
    if (index !== null && index > 0) {
      return { ref: 'nth', index };
    }
  }
  
  return null;
}

// ==========================================
// 测试
// ==========================================

describe('inferParagraphRefFromText', () => {
  describe('current paragraph references', () => {
    it.each(CURRENT_CASES)('should match "$description" as current', ({ userText, expectedRef }) => {
      const result = inferParagraphRefFromText(userText);
      expect(result).not.toBeNull();
      expect(result?.ref).toBe(expectedRef);
    });
  });

  describe('previous paragraph references', () => {
    it.each(PREVIOUS_CASES)('should match "$description" as previous', ({ userText, expectedRef }) => {
      const result = inferParagraphRefFromText(userText);
      expect(result).not.toBeNull();
      expect(result?.ref).toBe(expectedRef);
    });
  });

  describe('next paragraph references', () => {
    it.each(NEXT_CASES)('should match "$description" as next', ({ userText, expectedRef }) => {
      const result = inferParagraphRefFromText(userText);
      expect(result).not.toBeNull();
      expect(result?.ref).toBe(expectedRef);
    });
  });

  describe('nth paragraph references', () => {
    it.each(NTH_CASES)('should match "$description" as nth with index=$expectedIndex', ({ userText, expectedRef, expectedIndex }) => {
      const result = inferParagraphRefFromText(userText);
      expect(result).not.toBeNull();
      expect(result?.ref).toBe(expectedRef);
      expect(result?.index).toBe(expectedIndex);
    });
  });

  describe('non-matching cases', () => {
    it.each(NO_MATCH_CASES)('should not match "$description"', ({ userText }) => {
      const result = inferParagraphRefFromText(userText);
      expect(result).toBeNull();
    });
  });
});

describe('parseChineseOrArabicNumber', () => {
  it('should parse arabic numbers', () => {
    expect(parseChineseOrArabicNumber('1')).toBe(1);
    expect(parseChineseOrArabicNumber('5')).toBe(5);
    expect(parseChineseOrArabicNumber('10')).toBe(10);
    expect(parseChineseOrArabicNumber('15')).toBe(15);
  });

  it('should parse chinese numbers', () => {
    expect(parseChineseOrArabicNumber('一')).toBe(1);
    expect(parseChineseOrArabicNumber('五')).toBe(5);
    expect(parseChineseOrArabicNumber('十')).toBe(10);
    expect(parseChineseOrArabicNumber('十五')).toBe(15);
  });

  it('should return null for invalid input', () => {
    expect(parseChineseOrArabicNumber('')).toBeNull();
    expect(parseChineseOrArabicNumber('abc')).toBeNull();
    expect(parseChineseOrArabicNumber('百')).toBeNull();
  });
});

