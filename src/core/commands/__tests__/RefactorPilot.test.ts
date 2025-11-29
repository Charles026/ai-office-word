import { describe, it, expect } from 'vitest';
import { CommandBus } from '../CommandBus';
import { documentEngine } from '../../../document/DocumentEngine';
import { createEmptyDocument, createParagraph, createTextRun } from '../../../document/types';
import { createCollapsedSelection, isCollapsedSelection } from '../../../document/selection';

describe('CommandBus Pilot Refactor', () => {
  const commandBus = new CommandBus();

  it('insertText should update AST via DocumentEngine', () => {
    // 1. Setup initial AST
    const doc = createEmptyDocument();
    const p1 = createParagraph('Hello');
    doc.blocks = [p1];
    
    // 2. Setup Context
    const selection = createCollapsedSelection(p1.id, 5); // End of "Hello"
    const context = { ast: doc, selection };

    // 3. Execute Command
    const result = commandBus.execute('insertText', context, { text: ' World' });

    // 4. Assertions
    expect(result.success).toBe(true);
    expect(result.nextAst).toBeDefined();
    
    // Verify AST update
    const block = result.nextAst.blocks[0];
    expect(block.children[0].text).toBe('Hello World');
    
    // Verify Selection update
    expect(result.nextSelection).toBeDefined();
    expect(result.nextSelection!.focus.offset).toBe(11);
  });

  it('deleteRange should remove text', () => {
    const doc = createEmptyDocument();
    const p1 = createParagraph('Hello World');
    doc.blocks = [p1];

    const context = {
      ast: doc,
      selection: {
        anchor: { blockId: p1.id, offset: 0 },
        focus: { blockId: p1.id, offset: 6 }, // Select "Hello "
        isCollapsed: false,
      }
    };

    const result = commandBus.execute('deleteRange', context, undefined);

    expect(result.success).toBe(true);
    expect(result.nextAst.blocks[0].children[0].text).toBe('World');
    expect(isCollapsedSelection(result.nextSelection!)).toBe(true);
    expect(result.nextSelection!.focus.offset).toBe(0);
  });

  it('splitBlock should create new paragraph', () => {
    const doc = createEmptyDocument();
    const p1 = createParagraph('HelloWorld');
    doc.blocks = [p1];

    const context = {
      ast: doc,
      selection: createCollapsedSelection(p1.id, 5) // Between Hello and World
    };

    const result = commandBus.execute('splitBlock', context, undefined);

    expect(result.success).toBe(true);
    expect(result.nextAst.blocks).toHaveLength(2);
    expect(result.nextAst.blocks[0].children[0].text).toBe('Hello');
    expect(result.nextAst.blocks[1].children[0].text).toBe('World');
  });
});

