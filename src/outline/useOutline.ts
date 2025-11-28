/**
 * useOutline - Outline 状态管理 Hook
 * 
 * 【职责】
 * - 从编辑器状态生成 Outline
 * - 管理活跃项和折叠状态
 * - 处理滚动同步
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { LexicalEditor } from 'lexical';
import { OutlineState, initialOutlineState } from './types';
import { generateOutlineFromEditor, findActiveHeading, scrollToHeading } from './outlineUtils';

export interface UseOutlineOptions {
  /** Lexical 编辑器实例 */
  editor: LexicalEditor | null;
  /** 编辑器容器元素 */
  containerRef?: React.RefObject<HTMLElement>;
  /** 是否启用滚动同步 */
  enableScrollSync?: boolean;
}

export interface UseOutlineReturn {
  /** Outline 状态 */
  state: OutlineState;
  /** 刷新 Outline */
  refresh: () => void;
  /** 点击项 */
  handleItemClick: (id: string) => void;
  /** 切换折叠 */
  toggleCollapse: (id: string) => void;
}

export function useOutline(options: UseOutlineOptions): UseOutlineReturn {
  const { editor, containerRef, enableScrollSync = true } = options;
  
  const [state, setState] = useState<OutlineState>(initialOutlineState);
  const scrollSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 刷新 Outline
  const refresh = useCallback(() => {
    if (!editor) {
      setState(prev => ({ ...prev, items: [], loading: false }));
      return;
    }

    setState(prev => ({ ...prev, loading: true }));

    try {
      const items = generateOutlineFromEditor(editor);
      setState(prev => ({
        ...prev,
        items,
        loading: false,
        // 如果当前活跃项不在新列表中，清除它
        activeItemId: items.some(item => item.id === prev.activeItemId)
          ? prev.activeItemId
          : items[0]?.id || null,
      }));
    } catch (error) {
      console.error('[useOutline] Failed to generate outline:', error);
      setState(prev => ({ ...prev, items: [], loading: false }));
    }
  }, [editor]);

  // 监听编辑器状态变化
  useEffect(() => {
    if (!editor) return;

    // 初始刷新
    refresh();

    // 监听编辑器更新
    const unregister = editor.registerUpdateListener(() => {
      // 使用 debounce 避免频繁更新
      if (scrollSyncTimeoutRef.current) {
        clearTimeout(scrollSyncTimeoutRef.current);
      }
      scrollSyncTimeoutRef.current = setTimeout(() => {
        refresh();
      }, 300);
    });

    return () => {
      unregister();
      if (scrollSyncTimeoutRef.current) {
        clearTimeout(scrollSyncTimeoutRef.current);
      }
    };
  }, [editor, refresh]);

  // 滚动同步
  useEffect(() => {
    if (!enableScrollSync || !containerRef?.current || state.items.length === 0) {
      return;
    }

    const container = containerRef.current;

    const handleScroll = () => {
      const activeId = findActiveHeading(state.items, container);
      if (activeId && activeId !== state.activeItemId) {
        setState(prev => ({ ...prev, activeItemId: activeId }));
      }
    };

    // 使用 passive 事件监听器提高性能
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [enableScrollSync, containerRef, state.items, state.activeItemId]);

  // 点击项
  const handleItemClick = useCallback((id: string) => {
    setState(prev => ({ ...prev, activeItemId: id }));

    // 滚动到对应位置
    if (containerRef?.current) {
      scrollToHeading(id, containerRef.current);
    }
  }, [containerRef]);

  // 切换折叠
  const toggleCollapse = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      collapsedItems: {
        ...prev.collapsedItems,
        [id]: !prev.collapsedItems[id],
      },
    }));
  }, []);

  return {
    state,
    refresh,
    handleItemClick,
    toggleCollapse,
  };
}

export default useOutline;

