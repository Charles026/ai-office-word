/**
 * 空文档场景测试
 * 
 * 验证 CommandBus → DocOps → DocumentEngine 在空文档场景下的行为
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandBus } from '../CommandBus';
import { DocumentRuntime } from '../../../document/DocumentRuntime';
import { documentEngine } from '../../../document/DocumentEngine';
import { createEmptyDocument, createParagraph, DocumentAst } from '../../../document/types';
import { createCollapsedSelection, createRangeSelection } from '../../../document/selection';

describe('EmptyDocument', () => {
  let runtime: DocumentRuntime;
  let commandBus: CommandBus;

  beforeEach(() => {
    // 每次测试前清空历史
    documentEngine.clearHistory();
    // 创建新的 runtime（使用默认空文档）
    runtime = new DocumentRuntime();
    commandBus = new CommandBus(runtime);
  });

  describe('空 blocks 数组', () => {
    it('toggleBold 在空 AST 上不应崩溃', () => {
      // 创建完全空的 AST
      const emptyAst: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [],
      };
      runtime.reset(emptyAst);

      // 尝试执行 toggleBold，不应抛出异常
      expect(() => {
        commandBus.executeWithRuntime('toggleBold');
      }).not.toThrow();
    });

    it('undo 在空 AST 上不应崩溃', () => {
      const emptyAst: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [],
      };
      runtime.reset(emptyAst);

      // 尝试执行 undo，不应抛出异常
      expect(() => {
        commandBus.executeWithRuntime('undo');
      }).not.toThrow();
    });

    it('redo 在空 AST 上不应崩溃', () => {
      const emptyAst: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [],
      };
      runtime.reset(emptyAst);

      // 尝试执行 redo，不应抛出异常
      expect(() => {
        commandBus.executeWithRuntime('redo');
      }).not.toThrow();
    });
  });

  describe('单个空段落', () => {
    beforeEach(() => {
      // 创建只有一个空段落的 AST
      const emptyParagraph = createParagraph('');
      const ast: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [emptyParagraph],
      };
      runtime.reset(ast);
      runtime.setSelection(createCollapsedSelection(emptyParagraph.id, 0));
    });

    it('toggleBold 在空段落上不应崩溃', () => {
      expect(() => {
        commandBus.executeWithRuntime('toggleBold');
      }).not.toThrow();
    });

    it('toggleItalic 在空段落上不应崩溃', () => {
      expect(() => {
        commandBus.executeWithRuntime('toggleItalic');
      }).not.toThrow();
    });

    it('setBlockTypeHeading1 在空段落上应正常工作', () => {
      const result = commandBus.executeWithRuntime('setBlockTypeHeading1');
      
      expect(result.success).toBe(true);
      
      const newSnapshot = runtime.getSnapshot();
      const block = newSnapshot.ast.blocks[0];
      expect(block.type).toBe('heading');
      if (block.type === 'heading') {
        expect(block.level).toBe(1);
      }
    });
  });

  describe('单个有内容的段落', () => {
    let blockId: string;

    beforeEach(() => {
      // 创建有内容的段落
      const paragraph = {
        ...createParagraph('Hello World'),
        id: 'test-block-1',
      };
      blockId = paragraph.id;
      
      const ast: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [paragraph],
      };
      runtime.reset(ast);
    });

    it('选中部分文字加粗应只影响选区', () => {
      // 选中 "Hello"（0-5）
      runtime.setSelection(createRangeSelection(blockId, 0, blockId, 5));

      const result = commandBus.executeWithRuntime('toggleBold');
      
      expect(result.success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      const block = snapshot.ast.blocks[0];
      
      // 检查 children 中应该有加粗的部分
      if ('children' in block && Array.isArray(block.children)) {
        const boldChild = block.children.find(
          (child: any) => child.type === 'text' && child.marks?.bold
        );
        expect(boldChild).toBeDefined();
        if (boldChild && boldChild.type === 'text') {
          expect(boldChild.text).toBe('Hello');
        }
      }
    });

    it('选中全部文字加粗应影响整段', () => {
      // 选中 "Hello World"（0-11）
      runtime.setSelection(createRangeSelection(blockId, 0, blockId, 11));

      const result = commandBus.executeWithRuntime('toggleBold');
      
      expect(result.success).toBe(true);
      
      const snapshot = runtime.getSnapshot();
      const block = snapshot.ast.blocks[0];
      
      // 检查所有文本都应该加粗
      if ('children' in block && Array.isArray(block.children)) {
        const allBold = block.children.every(
          (child: any) => child.type !== 'text' || child.marks?.bold
        );
        expect(allBold).toBe(true);
      }
    });

    it('undo 应该撤销加粗操作', () => {
      // 选中并加粗
      runtime.setSelection(createRangeSelection(blockId, 0, blockId, 5));
      commandBus.executeWithRuntime('toggleBold');

      // 撤销
      const undoResult = commandBus.executeWithRuntime('undo');
      expect(undoResult.success).toBe(true);

      // 检查加粗被撤销
      const snapshot = runtime.getSnapshot();
      const block = snapshot.ast.blocks[0];
      
      if ('children' in block && Array.isArray(block.children)) {
        const hasBold = block.children.some(
          (child: any) => child.type === 'text' && child.marks?.bold
        );
        expect(hasBold).toBe(false);
      }
    });
  });

  describe('多段落场景', () => {
    let block1Id: string;
    let block2Id: string;

    beforeEach(() => {
      const paragraph1 = {
        ...createParagraph('First paragraph'),
        id: 'test-block-1',
      };
      const paragraph2 = {
        ...createParagraph('Second paragraph'),
        id: 'test-block-2',
      };
      block1Id = paragraph1.id;
      block2Id = paragraph2.id;

      const ast: DocumentAst = {
        ...createEmptyDocument(),
        blocks: [paragraph1, paragraph2],
      };
      runtime.reset(ast);
    });

    it('在不同段落加粗应互不影响', () => {
      // 在段落1加粗 "First"
      runtime.setSelection(createRangeSelection(block1Id, 0, block1Id, 5));
      commandBus.executeWithRuntime('toggleBold');

      // 在段落2加粗 "Second"
      runtime.setSelection(createRangeSelection(block2Id, 0, block2Id, 6));
      commandBus.executeWithRuntime('toggleBold');

      const snapshot = runtime.getSnapshot();
      
      // 检查段落1
      const block1 = snapshot.ast.blocks[0];
      if ('children' in block1 && Array.isArray(block1.children)) {
        const boldChild1 = block1.children.find(
          (child: any) => child.type === 'text' && child.marks?.bold
        );
        expect(boldChild1).toBeDefined();
      }

      // 检查段落2
      const block2 = snapshot.ast.blocks[1];
      if ('children' in block2 && Array.isArray(block2.children)) {
        const boldChild2 = block2.children.find(
          (child: any) => child.type === 'text' && child.marks?.bold
        );
        expect(boldChild2).toBeDefined();
      }
    });
  });
});
