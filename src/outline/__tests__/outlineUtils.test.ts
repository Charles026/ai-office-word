/**
 * Outline 工具函数测试
 */

import { describe, it, expect } from 'vitest';
import {
  generateOutlineFromParagraphs,
  buildOutlineTree,
  getSectionRange,
} from '../outlineUtils';

// ==========================================
// Mock 数据
// ==========================================

const mockParagraphs = [
  { id: 'p1', type: 'heading' as const, headingLevel: 1 as const, text: '第一章', index: 0 },
  { id: 'p2', type: 'paragraph' as const, text: '第一章的内容', index: 1 },
  { id: 'p3', type: 'heading' as const, headingLevel: 2 as const, text: '1.1 小节', index: 2 },
  { id: 'p4', type: 'paragraph' as const, text: '1.1 的内容', index: 3 },
  { id: 'p5', type: 'heading' as const, headingLevel: 3 as const, text: '1.1.1 子小节', index: 4 },
  { id: 'p6', type: 'paragraph' as const, text: '1.1.1 的内容', index: 5 },
  { id: 'p7', type: 'heading' as const, headingLevel: 2 as const, text: '1.2 小节', index: 6 },
  { id: 'p8', type: 'paragraph' as const, text: '1.2 的内容', index: 7 },
  { id: 'p9', type: 'heading' as const, headingLevel: 1 as const, text: '第二章', index: 8 },
  { id: 'p10', type: 'paragraph' as const, text: '第二章的内容', index: 9 },
];

// ==========================================
// 测试用例
// ==========================================

describe('generateOutlineFromParagraphs', () => {
  it('应该只提取 heading 类型的段落', () => {
    const outline = generateOutlineFromParagraphs(mockParagraphs);
    
    // mockParagraphs 中有 5 个 heading: p1(H1), p3(H2), p5(H3), p7(H2), p9(H1)
    expect(outline).toHaveLength(5);
    expect(outline.every(item => ['1', '2', '3'].includes(String(item.level)))).toBe(true);
  });

  it('应该保持正确的顺序', () => {
    const outline = generateOutlineFromParagraphs(mockParagraphs);
    
    expect(outline[0].text).toBe('第一章');
    expect(outline[1].text).toBe('1.1 小节');
    expect(outline[2].text).toBe('1.1.1 子小节');
    expect(outline[3].text).toBe('1.2 小节');
    expect(outline[4].text).toBe('第二章');
  });

  it('应该正确设置 position', () => {
    const outline = generateOutlineFromParagraphs(mockParagraphs);
    
    outline.forEach((item, index) => {
      expect(item.position).toBe(index);
    });
  });

  it('应该处理空输入', () => {
    const outline = generateOutlineFromParagraphs([]);
    expect(outline).toHaveLength(0);
  });

  it('应该处理没有 heading 的文档', () => {
    const paragraphsOnly = [
      { id: 'p1', type: 'paragraph' as const, text: '段落1', index: 0 },
      { id: 'p2', type: 'paragraph' as const, text: '段落2', index: 1 },
    ];
    const outline = generateOutlineFromParagraphs(paragraphsOnly);
    expect(outline).toHaveLength(0);
  });
});

describe('buildOutlineTree', () => {
  it('应该正确构建树形结构', () => {
    const flatItems = generateOutlineFromParagraphs(mockParagraphs);
    const tree = buildOutlineTree(flatItems);
    
    // 根级别应该有 2 个 H1
    expect(tree).toHaveLength(2);
    expect(tree[0].text).toBe('第一章');
    expect(tree[1].text).toBe('第二章');
  });

  it('应该正确嵌套子节点', () => {
    const flatItems = generateOutlineFromParagraphs(mockParagraphs);
    const tree = buildOutlineTree(flatItems);
    
    // 第一章应该有 2 个 H2 子节点
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children![0].text).toBe('1.1 小节');
    expect(tree[0].children![1].text).toBe('1.2 小节');
    
    // 1.1 小节应该有 1 个 H3 子节点
    expect(tree[0].children![0].children).toHaveLength(1);
    expect(tree[0].children![0].children![0].text).toBe('1.1.1 子小节');
  });

  it('应该处理空输入', () => {
    const tree = buildOutlineTree([]);
    expect(tree).toHaveLength(0);
  });

  it('应该处理只有一个 heading 的情况', () => {
    const singleItem = [{ id: 'p1', level: 1 as const, text: '唯一标题', position: 0 }];
    const tree = buildOutlineTree(singleItem);
    
    expect(tree).toHaveLength(1);
    expect(tree[0].text).toBe('唯一标题');
  });
});

describe('getSectionRange', () => {
  it('应该正确计算 H1 的章节范围', () => {
    const range = getSectionRange(mockParagraphs, 'p1');
    
    expect(range).not.toBeNull();
    expect(range!.startId).toBe('p1');
    expect(range!.endId).toBe('p9'); // 下一个 H1
    expect(range!.startIndex).toBe(0);
    expect(range!.endIndex).toBe(8);
    // 应该包含 p1 到 p8
    expect(range!.paragraphIds).toHaveLength(8);
    expect(range!.paragraphIds).toContain('p1');
    expect(range!.paragraphIds).toContain('p8');
    expect(range!.paragraphIds).not.toContain('p9');
  });

  it('应该正确计算 H2 的章节范围', () => {
    const range = getSectionRange(mockParagraphs, 'p3');
    
    expect(range).not.toBeNull();
    expect(range!.startId).toBe('p3');
    expect(range!.endId).toBe('p7'); // 下一个 H2
    expect(range!.startIndex).toBe(2);
    expect(range!.endIndex).toBe(6);
    // 应该包含 p3 到 p6（包括 H3 及其内容）
    expect(range!.paragraphIds).toHaveLength(4);
    expect(range!.paragraphIds).toContain('p3');
    expect(range!.paragraphIds).toContain('p5'); // H3 也在范围内
    expect(range!.paragraphIds).toContain('p6');
  });

  it('应该正确计算 H3 的章节范围', () => {
    const range = getSectionRange(mockParagraphs, 'p5');
    
    expect(range).not.toBeNull();
    expect(range!.startId).toBe('p5');
    expect(range!.endId).toBe('p7'); // 遇到 H2 停止
    expect(range!.startIndex).toBe(4);
    expect(range!.endIndex).toBe(6);
    // 应该包含 p5 和 p6
    expect(range!.paragraphIds).toHaveLength(2);
  });

  it('应该正确处理文档末尾的章节', () => {
    const range = getSectionRange(mockParagraphs, 'p9');
    
    expect(range).not.toBeNull();
    expect(range!.startId).toBe('p9');
    expect(range!.endId).toBeNull(); // 文档末尾
    expect(range!.endIndex).toBe(10); // 文档长度
    // 应该包含 p9 和 p10
    expect(range!.paragraphIds).toHaveLength(2);
  });

  it('应该返回 null 如果找不到 heading', () => {
    const range = getSectionRange(mockParagraphs, 'not-exist');
    expect(range).toBeNull();
  });

  it('应该返回 null 如果 ID 对应的不是 heading', () => {
    const range = getSectionRange(mockParagraphs, 'p2'); // p2 是段落
    expect(range).toBeNull();
  });

  it('应该处理只有 heading 没有内容的情况', () => {
    const headingsOnly = [
      { id: 'h1', type: 'heading' as const, headingLevel: 1 as const, text: 'H1', index: 0 },
      { id: 'h2', type: 'heading' as const, headingLevel: 2 as const, text: 'H2', index: 1 },
      { id: 'h3', type: 'heading' as const, headingLevel: 1 as const, text: 'H1-2', index: 2 },
    ];
    
    const range = getSectionRange(headingsOnly, 'h1');
    expect(range).not.toBeNull();
    expect(range!.paragraphIds).toHaveLength(2); // h1 和 h2
    expect(range!.endId).toBe('h3');
  });

  it('应该正确处理多个同级 H2 的情况', () => {
    const range1 = getSectionRange(mockParagraphs, 'p3'); // 1.1 小节
    const range2 = getSectionRange(mockParagraphs, 'p7'); // 1.2 小节
    
    expect(range1!.endId).toBe('p7');
    expect(range2!.endId).toBe('p9'); // 遇到 H1 停止
  });
});

