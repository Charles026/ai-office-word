/**
 * StylePlugin.tsx
 * 
 * 实现 Word 风格的段落样式行为：
 * - Enter 键在标题后自动切换到正文样式
 * - 样式状态报告给父组件
 * 
 * 【设计说明】
 * - 标题段落按 Enter 后，新段落自动变为正文
 * - 这是 Word/WPS 的标准行为
 */

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import { $isListItemNode } from '@lexical/list';

export const StylePlugin: React.FC = () => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Enter 键处理：标题后新建段落自动变为正文
    const removeEnterListener = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        // Shift+Enter 使用默认行为（软换行）
        if (event?.shiftKey) return false;

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        if (!selection.isCollapsed()) return false;

        const anchorNode = selection.anchor.getNode();
        const topLevelElement = anchorNode.getTopLevelElementOrThrow();

        // 如果在列表中，不处理（由 ListPlugin 处理）
        let current = anchorNode;
        while (current !== null) {
          if ($isListItemNode(current)) {
            return false;
          }
          current = current.getParent() as any;
        }

        // 如果在标题中
        if ($isHeadingNode(topLevelElement)) {
          // 检查光标是否在末尾
          const anchorOffset = selection.anchor.offset;
          const anchorNodeText = anchorNode.getTextContent();
          
          // 简化判断：如果光标在节点末尾
          const isAtEnd = anchorOffset === anchorNodeText.length && 
                          anchorNode.getNextSibling() === null;

          if (isAtEnd) {
            // 在标题末尾按 Enter：创建新的正文段落
            event?.preventDefault();
            
            editor.update(() => {
              const newParagraph = $createParagraphNode();
              topLevelElement.insertAfter(newParagraph);
              newParagraph.select();
            });
            
            return true;
          }
        }

        // 其他情况使用默认行为
        return false;
      },
      COMMAND_PRIORITY_LOW
    );

    return () => {
      removeEnterListener();
    };
  }, [editor]);

  return null;
};

export default StylePlugin;

