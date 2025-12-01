/**
 * SectionAI 开发调试工具
 * 
 * 提供手动测试 SectionDocOps → DocOps → DocumentEngine 路径的工具函数
 * 仅在开发模式下使用
 */

import { convertSectionOpsToDocOps } from '../docops/adapter';
import { documentRuntime } from '../document/DocumentRuntime';
import type { SectionDocOp } from '../docops/sectionDocOpsDiff';
import type { DocOp } from '../docops/types';

// ==========================================
// 调试结果类型
// ==========================================

export interface SectionAiTestResult {
  success: boolean;
  error?: string;
  
  // 输入
  sectionDocOps: SectionDocOp[];
  
  // 转换后
  standardDocOps: DocOp[];
  
  // AST 状态
  astBlockIdsBefore: string[];
  astBlockIdsAfter: string[];
  
  // 段落文本 diff
  paragraphDiff: Array<{
    blockId: string;
    before: string;
    after: string;
    changed: boolean;
  }>;
}

// ==========================================
// 核心测试函数
// ==========================================

/**
 * 测试 SectionDocOps → DocOps → DocumentEngine 路径
 * 
 * @param sectionDocOps - 要测试的 SectionDocOps
 * @returns 测试结果
 * 
 * @example
 * // 在控制台中：
 * const result = await window.__docDebug__.testSectionDocOps([{
 *   type: 'replace_paragraph',
 *   targetPath: ['doc', 'some-id'],
 *   targetKey: 'some-id',
 *   newText: '新内容',
 *   preserveStyle: true,
 *   index: 0,
 * }]);
 * console.log(result);
 */
export function testSectionDocOps(sectionDocOps: SectionDocOp[]): SectionAiTestResult {
  // 获取应用前的状态
  const snapshotBefore = documentRuntime.getSnapshot();
  const astBlockIdsBefore = snapshotBefore.ast.blocks.map(b => b.id);
  const paragraphsBefore = snapshotBefore.ast.blocks.map(b => ({
    id: b.id,
    text: b.children?.[0]?.type === 'text' ? (b.children[0] as any).text : '',
  }));

  console.log('='.repeat(60));
  console.log('[DevTools] Testing SectionDocOps → DocOps → DocumentEngine');
  console.log('='.repeat(60));

  // 打印输入
  console.log('\n📥 Input SectionDocOps:');
  sectionDocOps.forEach((op, i) => {
    console.log(`  [${i}] ${op.type}:`);
    console.log(`      targetKey: ${(op as any).targetKey || (op as any).referenceKey}`);
    console.log(`      newText: "${((op as any).newText || '').slice(0, 60)}..."`);
  });

  // 转换
  console.log('\n🔄 Converting to standard DocOps...');
  const standardDocOps = convertSectionOpsToDocOps(sectionDocOps, 'ai');
  
  console.log('\n📤 Converted DocOps:');
  standardDocOps.forEach((op, i) => {
    console.log(`  [${i}] ${op.type}:`);
    console.log(`      nodeId: ${(op.payload as any).nodeId || (op.payload as any).afterNodeId}`);
    console.log(`      text: "${((op.payload as any).text || '').slice(0, 60)}..."`);
  });

  // 打印 AST block IDs
  console.log('\n📊 Current AST Block IDs:');
  astBlockIdsBefore.forEach((id, i) => {
    console.log(`  [${i}] ${id}`);
  });

  // 检查 ID 是否匹配
  console.log('\n🔍 ID Matching Check:');
  const requestedIds = standardDocOps.map(op => (op.payload as any).nodeId || (op.payload as any).afterNodeId);
  requestedIds.forEach(id => {
    const found = astBlockIdsBefore.includes(id);
    console.log(`  ${id}: ${found ? '✅ Found' : '❌ NOT FOUND'}`);
  });

  // 尝试应用
  console.log('\n⚡ Applying DocOps via DocumentRuntime...');
  let success = false;
  let error: string | undefined;

  try {
    success = documentRuntime.applyDocOps(standardDocOps);
    if (success) {
      console.log('  ✅ applyDocOps returned true');
    } else {
      console.log('  ❌ applyDocOps returned false (block not found?)');
      error = 'applyDocOps returned false - block IDs not found in AST';
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.log('  ❌ applyDocOps threw error:', error);
  }

  // 获取应用后的状态
  const snapshotAfter = documentRuntime.getSnapshot();
  const astBlockIdsAfter = snapshotAfter.ast.blocks.map(b => b.id);
  const paragraphsAfter = snapshotAfter.ast.blocks.map(b => ({
    id: b.id,
    text: b.children?.[0]?.type === 'text' ? (b.children[0] as any).text : '',
  }));

  // 计算 diff
  console.log('\n📝 Paragraph Diff:');
  const paragraphDiff = paragraphsBefore.map((before, i) => {
    const after = paragraphsAfter.find(p => p.id === before.id) || { id: before.id, text: '(deleted)' };
    const changed = before.text !== after.text;
    
    if (changed) {
      console.log(`  [${before.id}] CHANGED:`);
      console.log(`    Before: "${before.text.slice(0, 50)}..."`);
      console.log(`    After:  "${after.text.slice(0, 50)}..."`);
    } else {
      console.log(`  [${before.id}] unchanged`);
    }
    
    return {
      blockId: before.id,
      before: before.text,
      after: after.text,
      changed,
    };
  });

  console.log('\n' + '='.repeat(60));
  console.log(`[DevTools] Test ${success ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('='.repeat(60) + '\n');

  return {
    success,
    error,
    sectionDocOps,
    standardDocOps,
    astBlockIdsBefore,
    astBlockIdsAfter,
    paragraphDiff,
  };
}

/**
 * 快速测试：替换第一个段落
 * 
 * @example
 * window.__docDebug__.quickTestReplace('新的段落内容');
 */
export function quickTestReplace(newText: string): SectionAiTestResult {
  const snapshot = documentRuntime.getSnapshot();
  
  if (snapshot.ast.blocks.length === 0) {
    return {
      success: false,
      error: 'No blocks in AST',
      sectionDocOps: [],
      standardDocOps: [],
      astBlockIdsBefore: [],
      astBlockIdsAfter: [],
      paragraphDiff: [],
    };
  }

  const firstBlockId = snapshot.ast.blocks[0].id;
  
  return testSectionDocOps([{
    type: 'replace_paragraph',
    targetPath: ['doc', firstBlockId],
    targetKey: firstBlockId,
    newText,
    preserveStyle: true,
    index: 0,
  }]);
}

/**
 * 显示当前 AST 状态
 * 
 * @example
 * window.__docDebug__.showAstState();
 */
export function showAstState(): void {
  const snapshot = documentRuntime.getSnapshot();
  
  console.log('='.repeat(60));
  console.log('[DevTools] Current AST State');
  console.log('='.repeat(60));
  
  console.log(`\nVersion: ${snapshot.version}`);
  console.log(`Blocks: ${snapshot.ast.blocks.length}`);
  console.log(`Can Undo: ${snapshot.canUndo}`);
  console.log(`Can Redo: ${snapshot.canRedo}`);
  
  console.log('\nBlock Details:');
  snapshot.ast.blocks.forEach((block, i) => {
    const text = block.children?.[0]?.type === 'text' 
      ? (block.children[0] as any).text 
      : '(no text)';
    console.log(`  [${i}] id="${block.id}" type="${block.type}"`);
    console.log(`      text: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
  });
  
  console.log('\n' + '='.repeat(60) + '\n');
}

// ==========================================
// DEV 模式下暴露到 window
// ==========================================

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__docDebug__ = {
    testSectionDocOps,
    quickTestReplace,
    showAstState,
    
    // 便捷访问
    getSnapshot: () => documentRuntime.getSnapshot(),
    getAstBlockIds: () => documentRuntime.getSnapshot().ast.blocks.map(b => b.id),
    
    // 转换工具
    convertOps: convertSectionOpsToDocOps,
  };
  
  console.log('[DevTools] SectionAI debug tools available at window.__docDebug__');
  console.log('[DevTools] Try: __docDebug__.showAstState()');
}

export default {
  testSectionDocOps,
  quickTestReplace,
  showAstState,
};

