/**
 * 内联 Mark 切换测试
 * 
 * 验证 toggleBold / toggleItalic 等操作只影响选区内的文本，不影响其他部分
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentEngine, documentEngine } from '../DocumentEngine';
import { createEmptyDocument, createParagraph, createTextRun, DocumentAst } from '../types';
import { createOpMeta, DocOp } from '../../docops/types';

describe('Inline Mark Toggle', () => {
  beforeEach(() => {
    // 清除历史以隔离测试
    documentEngine.clearHistory();
  });

  describe('单段单词加粗', () => {
    it('应该只加粗选中的单词，不影响其他文字', () => {
      // 初始 AST：一个段落 "foo bar baz"
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('foo bar baz')],
        }],
      };

      // 选区覆盖 "bar" (offset 4-7)
      const ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 4,
          endOffset: 7,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);

      expect(result.changed).toBe(true);
      
      // 检查 children 结构
      const block = result.nextAst.blocks[0];
      expect(block.type).toBe('paragraph');
      if (block.type !== 'paragraph') return;

      // 应该有 3 个 text run: "foo ", "bar", " baz"
      expect(block.children.length).toBe(3);

      // "foo " 没有 bold
      expect(block.children[0].type).toBe('text');
      if (block.children[0].type === 'text') {
        expect(block.children[0].text).toBe('foo ');
        expect(block.children[0].marks?.bold).toBeFalsy();
      }

      // "bar" 有 bold
      expect(block.children[1].type).toBe('text');
      if (block.children[1].type === 'text') {
        expect(block.children[1].text).toBe('bar');
        expect(block.children[1].marks?.bold).toBe(true);
      }

      // " baz" 没有 bold
      expect(block.children[2].type).toBe('text');
      if (block.children[2].type === 'text') {
        expect(block.children[2].text).toBe(' baz');
        expect(block.children[2].marks?.bold).toBeFalsy();
      }
    });

    it('应该能加粗句首的单词', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('hello world')],
        }],
      };

      // 选区覆盖 "hello" (offset 0-5)
      const ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 0,
          endOffset: 5,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      const block = result.nextAst.blocks[0];
      if (block.type !== 'paragraph') return;

      expect(block.children.length).toBe(2);
      
      // "hello" 有 bold
      if (block.children[0].type === 'text') {
        expect(block.children[0].text).toBe('hello');
        expect(block.children[0].marks?.bold).toBe(true);
      }

      // " world" 没有 bold
      if (block.children[1].type === 'text') {
        expect(block.children[1].text).toBe(' world');
        expect(block.children[1].marks?.bold).toBeFalsy();
      }
    });

    it('应该能加粗句尾的单词', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('hello world')],
        }],
      };

      // 选区覆盖 "world" (offset 6-11)
      const ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 6,
          endOffset: 11,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      const block = result.nextAst.blocks[0];
      if (block.type !== 'paragraph') return;

      expect(block.children.length).toBe(2);
      
      // "hello " 没有 bold
      if (block.children[0].type === 'text') {
        expect(block.children[0].text).toBe('hello ');
        expect(block.children[0].marks?.bold).toBeFalsy();
      }

      // "world" 有 bold
      if (block.children[1].type === 'text') {
        expect(block.children[1].text).toBe('world');
        expect(block.children[1].marks?.bold).toBe(true);
      }
    });
  });

  describe('多段落加粗互不影响', () => {
    it('加粗不同段落的单词应该互不干扰', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [
          {
            id: 'block-1',
            type: 'paragraph',
            children: [createTextRun('first line')],
          },
          {
            id: 'block-2',
            type: 'paragraph',
            children: [createTextRun('second line')],
          },
        ],
      };

      // 先加粗 p1 中的 "first"
      let ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 0,
          endOffset: 5,
        },
        meta: createOpMeta('user'),
      }];

      let result = documentEngine.applyOps(doc, ops);
      let ast = result.nextAst;

      // 验证 p1 的 "first" 是 bold
      let block1 = ast.blocks[0];
      if (block1.type === 'paragraph') {
        expect(block1.children[0].type).toBe('text');
        if (block1.children[0].type === 'text') {
          expect(block1.children[0].text).toBe('first');
          expect(block1.children[0].marks?.bold).toBe(true);
        }
      }

      // 再加粗 p2 中的 "second"
      ops = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-2',
          startOffset: 0,
          endOffset: 6,
        },
        meta: createOpMeta('user'),
      }];

      result = documentEngine.applyOps(ast, ops);
      ast = result.nextAst;

      // 验证 p1 的 "first" 仍然是 bold
      block1 = ast.blocks[0];
      if (block1.type === 'paragraph') {
        expect(block1.children[0].type).toBe('text');
        if (block1.children[0].type === 'text') {
          expect(block1.children[0].text).toBe('first');
          expect(block1.children[0].marks?.bold).toBe(true);
        }
      }

      // 验证 p2 的 "second" 也是 bold
      const block2 = ast.blocks[1];
      if (block2.type === 'paragraph') {
        expect(block2.children[0].type).toBe('text');
        if (block2.children[0].type === 'text') {
          expect(block2.children[0].text).toBe('second');
          expect(block2.children[0].marks?.bold).toBe(true);
        }
      }
    });
  });

  describe('重复 toggle 同一单词', () => {
    it('连续 toggle 两次应该恢复原状', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('hello world')],
        }],
      };

      // 第一次 toggle: 加粗 "hello"
      let ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 0,
          endOffset: 5,
        },
        meta: createOpMeta('user'),
      }];

      let result = documentEngine.applyOps(doc, ops);
      let block = result.nextAst.blocks[0];
      
      if (block.type === 'paragraph') {
        // 验证 "hello" 是 bold
        if (block.children[0].type === 'text') {
          expect(block.children[0].marks?.bold).toBe(true);
        }
      }

      // 第二次 toggle: 取消 "hello" 的加粗
      ops = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 0,
          endOffset: 5,
        },
        meta: createOpMeta('user'),
      }];

      result = documentEngine.applyOps(result.nextAst, ops);
      block = result.nextAst.blocks[0];
      
      if (block.type === 'paragraph') {
        // 验证 "hello" 不再是 bold
        if (block.children[0].type === 'text') {
          expect(block.children[0].marks?.bold).toBeFalsy();
        }
        
        // 文本应该被合并回单个节点
        // (因为两个相邻节点都没有 bold，应该被合并)
        // 注意：这取决于 mergeAdjacentTextRuns 的实现
      }
    });
  });

  describe('其他 inline marks', () => {
    it('toggleItalic 应该只影响选区', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('foo bar baz')],
        }],
      };

      const ops: DocOp[] = [{
        type: 'ToggleItalic',
        payload: {
          nodeId: 'block-1',
          startOffset: 4,
          endOffset: 7,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      const block = result.nextAst.blocks[0];
      
      if (block.type === 'paragraph') {
        expect(block.children.length).toBe(3);
        
        // "bar" 有 italic
        if (block.children[1].type === 'text') {
          expect(block.children[1].text).toBe('bar');
          expect(block.children[1].marks?.italic).toBe(true);
        }

        // "foo " 没有 italic
        if (block.children[0].type === 'text') {
          expect(block.children[0].marks?.italic).toBeFalsy();
        }
      }
    });

    it('toggleUnderline 应该只影响选区', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('foo bar baz')],
        }],
      };

      const ops: DocOp[] = [{
        type: 'ToggleUnderline',
        payload: {
          nodeId: 'block-1',
          startOffset: 4,
          endOffset: 7,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      const block = result.nextAst.blocks[0];
      
      if (block.type === 'paragraph') {
        expect(block.children.length).toBe(3);
        
        // "bar" 有 underline
        if (block.children[1].type === 'text') {
          expect(block.children[1].text).toBe('bar');
          expect(block.children[1].marks?.underline).toBe(true);
        }
      }
    });
  });

  describe('边界情况', () => {
    it('空选区（startOffset === endOffset）不应该改变任何内容', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('hello world')],
        }],
      };

      const ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 5,
          endOffset: 5, // 空选区
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      
      // 不应该有变化
      expect(result.changed).toBe(false);
    });

    it('选区覆盖整个文本应该工作正常', () => {
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [createTextRun('hello')],
        }],
      };

      const ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 0,
          endOffset: 5,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      const block = result.nextAst.blocks[0];
      
      if (block.type === 'paragraph') {
        expect(block.children.length).toBe(1);
        if (block.children[0].type === 'text') {
          expect(block.children[0].text).toBe('hello');
          expect(block.children[0].marks?.bold).toBe(true);
        }
      }
    });
  });

  describe('保留其他格式', () => {
    it('加粗一个词不应该影响其他词的 italic/underline', () => {
      // 构造一个有多种格式的段落
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'paragraph',
          children: [
            { ...createTextRun('foo '), marks: { italic: true } },
            { ...createTextRun('very'), marks: {} },
            { ...createTextRun(' bar'), marks: { underline: true } },
          ],
        }],
      };

      // 对 "very" 加粗 (offset 4-8)
      const ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 4,
          endOffset: 8,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      const block = result.nextAst.blocks[0];
      
      if (block.type === 'paragraph') {
        // 应该有 3 个 text run
        expect(block.children.length).toBe(3);
        
        // "foo " 仍然是 italic
        if (block.children[0].type === 'text') {
          expect(block.children[0].text).toBe('foo ');
          expect(block.children[0].marks?.italic).toBe(true);
          expect(block.children[0].marks?.bold).toBeFalsy();
        }

        // "very" 现在是 bold
        if (block.children[1].type === 'text') {
          expect(block.children[1].text).toBe('very');
          expect(block.children[1].marks?.bold).toBe(true);
        }

        // " bar" 仍然是 underline
        if (block.children[2].type === 'text') {
          expect(block.children[2].text).toBe(' bar');
          expect(block.children[2].marks?.underline).toBe(true);
          expect(block.children[2].marks?.bold).toBeFalsy();
        }
      }
    });

    it('blockType 不应该被 toggle_mark 改变', () => {
      // 创建一个 H2 标题
      const doc: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [{
          id: 'block-1',
          type: 'heading',
          level: 2,
          children: [createTextRun('Hello Heading')],
        }],
      };

      // 对 "Hello" 加粗
      const ops: DocOp[] = [{
        type: 'ToggleBold',
        payload: {
          nodeId: 'block-1',
          startOffset: 0,
          endOffset: 5,
        },
        meta: createOpMeta('user'),
      }];

      const result = documentEngine.applyOps(doc, ops);
      const block = result.nextAst.blocks[0];
      
      // blockType 应该仍然是 heading level 2
      expect(block.type).toBe('heading');
      if (block.type === 'heading') {
        expect(block.level).toBe(2);
        
        // "Hello" 应该是 bold
        if (block.children[0].type === 'text') {
          expect(block.children[0].text).toBe('Hello');
          expect(block.children[0].marks?.bold).toBe(true);
        }
      }
    });
  });
});

