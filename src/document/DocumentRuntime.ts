/**
 * DocumentRuntime - 统一文档运行时接口
 * 
 * 【职责】
 * - 为 UI 层提供统一的文档操作接口
 * - 封装 DocumentEngine + HistoryManager
 * - 管理文档状态（AST + Selection + Version）
 * - 提供 undo/redo 能力
 * 
 * 【设计原则】
 * - 所有文档修改都通过此模块
 * - UI 层不直接操作 AST
 * - 操作结果可预测、可追踪
 * 
 * 【与 Lexical 的关系】
 * - DocumentRuntime 是 Source of Truth
 * - Lexical 只是渲染器 + 输入事件源
 * - AST 变更后通过 Reconciler 同步到 Lexical
 */

import { DocumentAst, createEmptyDocument } from './types';
import { DocSelection, createCollapsedSelection } from './selection';
import { DocOp } from '../docops/types';
import { documentEngine, DocumentEngine } from './DocumentEngine';

// ==========================================
// 运行时快照类型
// ==========================================

/**
 * 文档运行时快照
 * 
 * 用于 UI 层读取当前状态
 */
export interface DocumentRuntimeSnapshot {
  /** 当前文档 AST */
  ast: DocumentAst;
  /** 当前选区 */
  selection: DocSelection | null;
  /** 文档版本号（每次修改递增） */
  version: number;
  /** 是否可以撤销 */
  canUndo: boolean;
  /** 是否可以重做 */
  canRedo: boolean;
}

/**
 * 文档运行时接口
 */
export interface IDocumentRuntime {
  /**
   * 获取当前快照
   */
  getSnapshot(): DocumentRuntimeSnapshot;
  
  /**
   * 应用 DocOps
   * 
   * @param docOps - 要应用的操作列表
   * @returns 是否成功
   */
  applyDocOps(docOps: DocOp[]): boolean;
  
  /**
   * 撤销
   */
  undo(): boolean;
  
  /**
   * 重做
   */
  redo(): boolean;
  
  /**
   * 设置选区
   */
  setSelection(selection: DocSelection | null): void;
  
  /**
   * 订阅状态变化
   */
  subscribe(listener: (snapshot: DocumentRuntimeSnapshot) => void): () => void;
}

// ==========================================
// DocumentRuntime 实现
// ==========================================

type RuntimeListener = (snapshot: DocumentRuntimeSnapshot) => void;

export class DocumentRuntime implements IDocumentRuntime {
  private ast: DocumentAst;
  private selection: DocSelection | null = null;
  private engine: DocumentEngine;
  private listeners: Set<RuntimeListener> = new Set();
  
  constructor(initialAst?: DocumentAst) {
    this.ast = initialAst ?? createEmptyDocument();
    this.engine = documentEngine;
    
    // 初始化默认选区（文档开头）
    if (this.ast.blocks.length > 0) {
      this.selection = createCollapsedSelection(this.ast.blocks[0].id, 0);
    }
  }
  
  // ==========================================
  // 状态访问
  // ==========================================
  
  getSnapshot(): DocumentRuntimeSnapshot {
    return {
      ast: this.ast,
      selection: this.selection,
      version: this.ast.version,
      canUndo: this.engine.canUndo(),
      canRedo: this.engine.canRedo(),
    };
  }
  
  getAst(): DocumentAst {
    return this.ast;
  }
  
  getSelection(): DocSelection | null {
    return this.selection;
  }
  
  // ==========================================
  // 状态修改
  // ==========================================
  
  applyDocOps(docOps: DocOp[]): boolean {
    if (docOps.length === 0) {
      return false;
    }
    
    const result = this.engine.applyOps(this.ast, docOps);
    
    if (result.changed) {
      this.ast = result.nextAst;
      this.notify();
      return true;
    }
    
    return false;
  }
  
  undo(): boolean {
    const prevAst = this.engine.undo(this.ast);
    if (prevAst) {
      this.ast = prevAst;
      this.notify();
      return true;
    }
    return false;
  }
  
  redo(): boolean {
    const nextAst = this.engine.redo(this.ast);
    if (nextAst) {
      this.ast = nextAst;
      this.notify();
      return true;
    }
    return false;
  }
  
  setSelection(selection: DocSelection | null): void {
    this.selection = selection;
    // 选区变化不触发 notify（避免频繁更新）
    // 如果需要，可以单独提供 onSelectionChange 回调
  }

  /**
   * 直接设置 AST（不记录历史）
   * 
   * ⚠️ 仅供 CommandBus 内部使用
   * 当命令通过 documentEngine.applyOps 执行后，历史已经记录，
   * 我们只需要更新 runtime 的 AST 引用。
   * 
   * @internal
   */
  _setAstWithoutHistory(ast: DocumentAst): void {
    this.ast = ast;
    this.notify();
  }
  
  /**
   * 重置文档
   * 
   * 用于加载新文档或清空
   */
  reset(newAst?: DocumentAst): void {
    this.ast = newAst ?? createEmptyDocument();
    this.engine.clearHistory();
    
    if (this.ast.blocks.length > 0) {
      this.selection = createCollapsedSelection(this.ast.blocks[0].id, 0);
    } else {
      this.selection = null;
    }
    
    this.notify();
  }
  
  // ==========================================
  // 订阅机制
  // ==========================================
  
  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  
  private notify(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[DocumentRuntime] Listener error:', error);
      }
    });
  }
}

// ==========================================
// 单例导出
// ==========================================

/**
 * 全局文档运行时实例
 * 
 * 注意：这是一个简化的单例模式。
 * 在多文档场景下，应该为每个文档创建独立的 Runtime 实例。
 */
export const documentRuntime = new DocumentRuntime();

// ==========================================
// React Hook（可选）
// ==========================================

import { useSyncExternalStore, useCallback } from 'react';

/**
 * 使用 DocumentRuntime 的 Hook
 */
export function useDocumentRuntime(runtime: DocumentRuntime = documentRuntime) {
  const snapshot = useSyncExternalStore(
    useCallback((cb) => runtime.subscribe(cb), [runtime]),
    () => runtime.getSnapshot(),
    () => runtime.getSnapshot()
  );
  
  return {
    snapshot,
    ast: snapshot.ast,
    selection: snapshot.selection,
    version: snapshot.version,
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    
    // Actions
    applyDocOps: (ops: DocOp[]) => runtime.applyDocOps(ops),
    undo: () => runtime.undo(),
    redo: () => runtime.redo(),
    setSelection: (sel: DocSelection | null) => runtime.setSelection(sel),
    reset: (newAst?: DocumentAst) => runtime.reset(newAst),
  };
}

