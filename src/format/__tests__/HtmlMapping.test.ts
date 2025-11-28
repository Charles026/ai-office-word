/**
 * HTML/AST 映射测试
 * 
 * 测试覆盖：
 * - htmlToAst：p/h1/h2/h3/ul/ol/li/strong/em → AST
 * - astToHtml：AST → HTML 回写
 * - roundtrip：HTML → AST → HTML 大致保持结构
 */

import { describe, it, expect } from 'vitest';
import { htmlToAst } from '../html/htmlToAst';
import { astToHtml } from '../html/astToHtml';
import { getBlockText } from '../../document/types';

describe('HTML → AST 映射', () => {
  // ==========================================
  // 基本块级元素
  // ==========================================

  describe('块级元素', () => {
    it('应该解析 <p> 为 Paragraph', () => {
      const result = htmlToAst('<p>Hello World</p>');
      
      expect(result.warnings).toHaveLength(0);
      expect(result.ast.blocks).toHaveLength(1);
      expect(result.ast.blocks[0].type).toBe('paragraph');
      expect(getBlockText(result.ast.blocks[0])).toBe('Hello World');
    });

    it('应该解析多个 <p>', () => {
      const result = htmlToAst('<p>First</p><p>Second</p>');
      
      expect(result.ast.blocks).toHaveLength(2);
      expect(getBlockText(result.ast.blocks[0])).toBe('First');
      expect(getBlockText(result.ast.blocks[1])).toBe('Second');
    });

    it('应该解析 <h1> 为 Heading level 1', () => {
      const result = htmlToAst('<h1>Title</h1>');
      
      expect(result.ast.blocks).toHaveLength(1);
      expect(result.ast.blocks[0].type).toBe('heading');
      if (result.ast.blocks[0].type === 'heading') {
        expect(result.ast.blocks[0].level).toBe(1);
      }
      expect(getBlockText(result.ast.blocks[0])).toBe('Title');
    });

    it('应该解析 <h2> 和 <h3>', () => {
      const result = htmlToAst('<h2>Heading 2</h2><h3>Heading 3</h3>');
      
      expect(result.ast.blocks).toHaveLength(2);
      
      const h2 = result.ast.blocks[0];
      const h3 = result.ast.blocks[1];
      
      expect(h2.type).toBe('heading');
      expect(h3.type).toBe('heading');
      
      if (h2.type === 'heading') expect(h2.level).toBe(2);
      if (h3.type === 'heading') expect(h3.level).toBe(3);
    });
  });

  // ==========================================
  // 列表
  // ==========================================

  describe('列表', () => {
    it('应该解析 <ul> 为无序列表', () => {
      const result = htmlToAst('<ul><li>Item 1</li><li>Item 2</li></ul>');
      
      expect(result.ast.blocks).toHaveLength(1);
      expect(result.ast.blocks[0].type).toBe('list');
      
      if (result.ast.blocks[0].type === 'list') {
        expect(result.ast.blocks[0].ordered).toBe(false);
        expect(result.ast.blocks[0].items).toHaveLength(2);
      }
    });

    it('应该解析 <ol> 为有序列表', () => {
      const result = htmlToAst('<ol><li>First</li><li>Second</li></ol>');
      
      expect(result.ast.blocks).toHaveLength(1);
      
      if (result.ast.blocks[0].type === 'list') {
        expect(result.ast.blocks[0].ordered).toBe(true);
      }
    });
  });

  // ==========================================
  // 内联样式
  // ==========================================

  describe('内联样式', () => {
    it('应该解析 <strong> 为 bold mark', () => {
      const result = htmlToAst('<p><strong>Bold</strong></p>');
      
      const block = result.ast.blocks[0];
      if (block.type === 'paragraph') {
        expect(block.children).toHaveLength(1);
        if (block.children[0].type === 'text') {
          expect(block.children[0].marks.bold).toBe(true);
          expect(block.children[0].text).toBe('Bold');
        }
      }
    });

    it('应该解析 <b> 为 bold mark', () => {
      const result = htmlToAst('<p><b>Bold</b></p>');
      
      const block = result.ast.blocks[0];
      if (block.type === 'paragraph' && block.children[0].type === 'text') {
        expect(block.children[0].marks.bold).toBe(true);
      }
    });

    it('应该解析 <em> 为 italic mark', () => {
      const result = htmlToAst('<p><em>Italic</em></p>');
      
      const block = result.ast.blocks[0];
      if (block.type === 'paragraph' && block.children[0].type === 'text') {
        expect(block.children[0].marks.italic).toBe(true);
      }
    });

    it('应该解析 <i> 为 italic mark', () => {
      const result = htmlToAst('<p><i>Italic</i></p>');
      
      const block = result.ast.blocks[0];
      if (block.type === 'paragraph' && block.children[0].type === 'text') {
        expect(block.children[0].marks.italic).toBe(true);
      }
    });

    it('应该解析混合样式', () => {
      const result = htmlToAst('<p>Normal <strong>bold</strong> and <em>italic</em></p>');
      
      const block = result.ast.blocks[0];
      if (block.type === 'paragraph') {
        expect(block.children.length).toBeGreaterThanOrEqual(3);
        expect(getBlockText(block)).toContain('bold');
        expect(getBlockText(block)).toContain('italic');
      }
    });
  });

  // ==========================================
  // 不支持的元素
  // ==========================================

  describe('不支持的元素', () => {
    it('<table> 应该生成占位符和警告', () => {
      const result = htmlToAst('<table><tr><td>Cell</td></tr></table>');
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.ast.blocks).toHaveLength(1);
      expect(result.ast.blocks[0].type).toBe('placeholder');
    });

    it('<img> 应该生成占位符', () => {
      const result = htmlToAst('<p>Before</p><img src="test.jpg" /><p>After</p>');
      
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});

// ==========================================
// AST → HTML 映射
// ==========================================

describe('AST → HTML 映射', () => {
  it('应该将 Paragraph 转换为 <p>', () => {
    const result = htmlToAst('<p>Hello</p>');
    const html = astToHtml(result.ast);
    
    expect(html).toContain('<p>');
    expect(html).toContain('Hello');
    expect(html).toContain('</p>');
  });

  it('应该将 Heading 转换为对应标签', () => {
    const result = htmlToAst('<h1>Title</h1>');
    const html = astToHtml(result.ast);
    
    expect(html).toContain('<h1>');
    expect(html).toContain('</h1>');
  });

  it('应该将 bold mark 转换为 <strong>', () => {
    const result = htmlToAst('<p><strong>Bold</strong></p>');
    const html = astToHtml(result.ast);
    
    expect(html).toContain('<strong>');
    expect(html).toContain('</strong>');
  });

  it('应该将 List 转换为 <ul> 或 <ol>', () => {
    const result = htmlToAst('<ul><li>Item</li></ul>');
    const html = astToHtml(result.ast);
    
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
  });

  it('应该生成完整 HTML 文档', () => {
    const result = htmlToAst('<p>Content</p>');
    const html = astToHtml(result.ast, { fullDocument: true });
    
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('<body>');
  });
});

// ==========================================
// Roundtrip 测试
// ==========================================

describe('Roundtrip (HTML → AST → HTML)', () => {
  it('简单段落应该保持结构', () => {
    const original = '<p>Hello World</p>';
    const ast = htmlToAst(original).ast;
    const html = astToHtml(ast);
    
    expect(html).toContain('Hello World');
    expect(html).toContain('<p>');
  });

  it('标题应该保持级别', () => {
    const original = '<h2>Section Title</h2>';
    const ast = htmlToAst(original).ast;
    const html = astToHtml(ast);
    
    expect(html).toContain('<h2>');
    expect(html).toContain('Section Title');
  });

  it('列表应该保持类型', () => {
    const original = '<ol><li>First</li><li>Second</li></ol>';
    const ast = htmlToAst(original).ast;
    const html = astToHtml(ast);
    
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>');
  });

  it('内联样式应该保持', () => {
    const original = '<p><strong>Bold</strong> and <em>italic</em></p>';
    const ast = htmlToAst(original).ast;
    const html = astToHtml(ast);
    
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
  });

  it('复杂文档应该大致保持结构', () => {
    const original = `
      <h1>Document Title</h1>
      <p>Introduction paragraph with <strong>bold</strong> text.</p>
      <h2>Section 1</h2>
      <p>Content of section 1.</p>
      <ul>
        <li>Item A</li>
        <li>Item B</li>
      </ul>
    `;
    
    const ast = htmlToAst(original).ast;
    const html = astToHtml(ast);
    
    // 验证关键结构保持
    expect(html).toContain('<h1>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<p>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>');
    expect(html).toContain('Document Title');
    expect(html).toContain('Section 1');
  });
});

