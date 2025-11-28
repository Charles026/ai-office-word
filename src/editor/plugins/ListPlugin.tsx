/**
 * ListPlugin.tsx
 * 
 * 实现 Word 风格的多级列表系统：
 * - 项目符号列表 (bullet)
 * - 编号列表 (numbered)
 * - 多级缩进 (indentLevel 0-5)
 * - Tab/Shift+Tab/Enter/Backspace 键盘行为
 * 
 * 【设计说明】
 * - Lexical 内置的 ListNode/ListItemNode 已支持基本列表
 * - 本插件扩展键盘行为，使其接近 Word
 * - 缩进通过 ListItemNode 的 indent 属性实现
 */

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  KEY_TAB_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  $createParagraphNode,
  LexicalNode,
} from 'lexical';
import {
  $isListNode,
  $isListItemNode,
  ListItemNode,
  $handleListInsertParagraph,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';

// ==========================================
// 常量
// ==========================================

const MAX_INDENT_LEVEL = 5;

// ==========================================
// 辅助函数
// ==========================================

/**
 * 获取选区内所有 ListItemNode
 */
function $getSelectedListItems(): ListItemNode[] {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return [];

  const nodes = selection.getNodes();
  const listItems = new Set<ListItemNode>();

  for (const node of nodes) {
    // 向上查找 ListItemNode
    let current: LexicalNode | null = node;
    while (current !== null) {
      if ($isListItemNode(current)) {
        listItems.add(current);
        break;
      }
      current = current.getParent();
    }
  }

  return Array.from(listItems);
}

/**
 * 检查当前选区是否在列表项中
 */
function $isInListItem(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  const anchorNode = selection.anchor.getNode();
  let current: LexicalNode | null = anchorNode;
  
  while (current !== null) {
    if ($isListItemNode(current)) return true;
    current = current.getParent();
  }
  
  return false;
}

/**
 * 检查光标是否在块首
 */
function $isAtBlockStart(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  
  // 只有当选区折叠且在开头时
  if (!selection.isCollapsed()) return false;
  
  return selection.anchor.offset === 0;
}

/**
 * 获取当前 ListItemNode 的文本内容
 */
function $getListItemText(listItem: ListItemNode): string {
  let text = '';
  listItem.getChildren().forEach(child => {
    text += child.getTextContent();
  });
  return text;
}

// ==========================================
// 列表命令实现
// ==========================================

/**
 * 切换项目符号列表
 */
export function $toggleBulletList(editor: any): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  // 检查是否所有选中块都是 bullet list
  const listItems = $getSelectedListItems();
  const allBullet = listItems.length > 0 && listItems.every(item => {
    const parent = item.getParent();
    return $isListNode(parent) && parent.getListType() === 'bullet';
  });

  if (allBullet) {
    // 移除列表
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
  } else {
    // 转换为项目符号列表
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  }
}

/**
 * 切换编号列表
 */
export function $toggleNumberedList(editor: any): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  // 检查是否所有选中块都是 numbered list
  const listItems = $getSelectedListItems();
  const allNumbered = listItems.length > 0 && listItems.every(item => {
    const parent = item.getParent();
    return $isListNode(parent) && parent.getListType() === 'number';
  });

  if (allNumbered) {
    // 移除列表
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
  } else {
    // 转换为编号列表
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  }
}

/**
 * 增加缩进
 */
export function $increaseIndent(): void {
  const listItems = $getSelectedListItems();
  
  for (const item of listItems) {
    const currentIndent = item.getIndent();
    if (currentIndent < MAX_INDENT_LEVEL) {
      item.setIndent(currentIndent + 1);
    }
  }
}

/**
 * 减少缩进
 */
export function $decreaseIndent(): void {
  const listItems = $getSelectedListItems();
  
  for (const item of listItems) {
    const currentIndent = item.getIndent();
    if (currentIndent > 0) {
      item.setIndent(currentIndent - 1);
    } else {
      // indentLevel == 0，退出列表变为段落
      // 需要将 ListItemNode 的内容移到新的 ParagraphNode
      const paragraph = $createParagraphNode();
      const children = item.getChildren();
      children.forEach(child => {
        paragraph.append(child);
      });
      item.replace(paragraph);
      
      // 清理空的 ListNode
      const parent = item.getParent();
      if ($isListNode(parent) && parent.getChildrenSize() === 0) {
        parent.remove();
      }
    }
  }
}

/**
 * 处理列表中的 Enter 键
 * 返回 true 表示已处理，false 表示使用默认行为
 */
function $handleListEnter(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  if (!selection.isCollapsed()) return false;

  const anchorNode = selection.anchor.getNode();
  
  // 查找包含的 ListItemNode
  let listItem: ListItemNode | null = null;
  let current: LexicalNode | null = anchorNode;
  while (current !== null) {
    if ($isListItemNode(current)) {
      listItem = current;
      break;
    }
    current = current.getParent();
  }

  if (!listItem) return false;

  // 获取列表项文本
  const text = $getListItemText(listItem).trim();

  if (text === '') {
    // 空列表项按 Enter
    const indent = listItem.getIndent();
    
    if (indent > 0) {
      // 有缩进：减少一级
      listItem.setIndent(indent - 1);
      return true;
    } else {
      // 无缩进：退出列表
      const paragraph = $createParagraphNode();
      listItem.replace(paragraph);
      paragraph.select();
      
      // 清理空的 ListNode
      const parent = listItem.getParent();
      if ($isListNode(parent) && parent.getChildrenSize() === 0) {
        parent.remove();
      }
      
      return true;
    }
  }

  // 有内容的列表项，使用 Lexical 内置的列表分割行为
  return $handleListInsertParagraph();
}

// ==========================================
// Plugin Component
// ==========================================

export const ListPlugin: React.FC = () => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Tab 键处理
    const removeTabListener = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        if (!$isInListItem()) return false;

        event.preventDefault();

        if (event.shiftKey) {
          // Shift+Tab: 减少缩进
          editor.update(() => {
            $decreaseIndent();
          });
        } else {
          // Tab: 增加缩进
          editor.update(() => {
            $increaseIndent();
          });
        }

        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    // Enter 键处理
    const removeEnterListener = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.shiftKey) return false; // Shift+Enter 使用默认行为

        return $handleListEnter();
      },
      COMMAND_PRIORITY_LOW
    );

    // Backspace 键处理
    const removeBackspaceListener = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event: KeyboardEvent) => {
        if (!$isAtBlockStart()) return false;
        if (!$isInListItem()) return false;

        const listItems = $getSelectedListItems();
        if (listItems.length !== 1) return false;

        const listItem = listItems[0];
        const indent = listItem.getIndent();

        event.preventDefault();

        editor.update(() => {
          if (indent > 0) {
            // 有缩进：减少一级
            listItem.setIndent(indent - 1);
          } else {
            // 无缩进：退出列表
            const paragraph = $createParagraphNode();
            const children = listItem.getChildren();
            children.forEach(child => {
              paragraph.append(child);
            });
            listItem.replace(paragraph);
            paragraph.selectStart();
          }
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      removeTabListener();
      removeEnterListener();
      removeBackspaceListener();
    };
  }, [editor]);

  return null;
};

export default ListPlugin;

