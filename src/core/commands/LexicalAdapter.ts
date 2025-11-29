/**
 * Lexical Command Adapter
 * 
 * Maps abstract editor commands (string IDs) to Lexical specific actions.
 * This serves as the "Command Layer" requested.
 * 
 * ==========================================================================
 * 🔴 ARCHITECTURE NOTE (2025-11)
 * ==========================================================================
 * 
 * 【当前现状】
 * 目前真实主干是：LexicalAdapter → Lexical（直接操作）
 * 而 DocOps / DocumentEngine 尚未接入 UI 主干。
 * 
 * 调用链路：
 *   EditorContainer / Ribbon
 *     → executeEditorCommand(editor, commandId, payload)
 *     → 直接调用 editor.dispatchCommand / editor.update
 *     → Lexical 内部状态变更
 * 
 * 【目标架构】
 * UI / Lexical 事件
 *   → CommandBus.execute(commandId, payload)
 *   → 命令层只负责：解析 selection/context、组装 DocOps 列表
 *   → DocumentEngine.applyDocOps(docOps[])
 *   → 返回新的 DocumentAst + selection
 *   → 映射回 Lexical 编辑器渲染
 * 
 * 【迁移计划】
 * v1: 基础文本/heading/undo/redo 切换到 CommandBus → DocOps → DocumentEngine
 * v2: 列表、复杂块类型、IME、粘贴等
 * 
 * TODO(docops-boundary):
 * - This entire file represents a boundary violation in the "DocOps Runtime" architecture.
 * - It manipulates Lexical state directly, bypassing CommandBus -> DocOps -> DocumentEngine.
 * - Future Goal: UI calls CommandBus -> DocumentEngine updates AST -> Adapter syncs AST to Lexical.
 * 
 * ==========================================================================
 * 
 * 【命令分类】
 * - 文本格式：toggleBold, toggleItalic, toggleUnderline
 * - 块类型：setBlockTypeParagraph, setBlockTypeHeading1/2/3
 * - 列表：toggleBulletList, toggleNumberedList, indentIncrease, indentDecrease
 * - 历史：undo, redo
 * - 编辑：insertText
 */

import { LexicalEditor, FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection, UNDO_COMMAND, REDO_COMMAND, $createParagraphNode, $createTextNode, $isTextNode, $isElementNode, FORMAT_ELEMENT_COMMAND, ElementFormatType, $getRoot, LexicalNode } from 'lexical';
import { $createHeadingNode, HeadingTagType, $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { ParagraphStyle, getStyleConfig } from '../../editor/styles/paragraphStyles';
import { FontOptionKey, resolveFontFamily } from '../../config/fonts';
import { FontSizeKey, getFontSizeValue } from '../../config/typography';
import { LineHeightKey, getLineHeightValue } from '../../config/typography';
import { TextAlignKey } from '../../config/typography';
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  $isListItemNode,
  ListItemNode,
} from '@lexical/list';

// 新路径依赖
import { shouldUseCommandBus, getCommandFeatureFlags } from './featureFlags';
import { commandBus } from './CommandBus';
import { reconcileAstToLexical } from './LexicalReconciler';
import { lexicalSelectionToDocSelection, syncLexicalToRuntime } from './LexicalBridge';

// ==========================================
// 命令 ID 类型
// ==========================================

export type EditorCommandId = 
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  | 'toggleStrikethrough'
  | 'clearFormat'
  // 段落样式（旧命令，保留兼容）
  | 'setBlockTypeParagraph'
  | 'setBlockTypeHeading1'
  | 'setBlockTypeHeading2'
  | 'setBlockTypeHeading3'
  // 段落样式（新统一命令）
  | 'applyParagraphStyle'
  // 字体命令
  | 'setFont'
  | 'setFontSize'
  // 段落排版
  | 'setTextAlign'
  | 'setLineHeight'
  | 'undo'
  | 'redo'
  | 'insertText'
  // AI 命令
  | 'replaceSelection'
  | 'insertAfterSelection'
  | 'replaceSectionContent'
  | 'insertAfterSection'
  // 列表命令
  | 'toggleBulletList'
  | 'toggleNumberedList'
  | 'indentIncrease'
  | 'indentDecrease';

// ==========================================
// 列表辅助函数
// ==========================================

const MAX_INDENT_LEVEL = 5;

/**
 * 获取选区内所有 ListItemNode
 */
function $getSelectedListItems(): ListItemNode[] {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return [];

  const nodes = selection.getNodes();
  const listItems = new Set<ListItemNode>();

  for (const node of nodes) {
    let current = node;
    while (current !== null) {
      if ($isListItemNode(current)) {
        listItems.add(current as ListItemNode);
        break;
      }
      current = current.getParent() as any;
    }
  }

  return Array.from(listItems);
}

/**
 * 检查是否所有选中块都是指定类型的列表
 */
function $isAllListType(listType: 'bullet' | 'number'): boolean {
  const listItems = $getSelectedListItems();
  if (listItems.length === 0) return false;
  
  return listItems.every(item => {
    const parent = item.getParent();
    return $isListNode(parent) && parent.getListType() === listType;
  });
}

// ==========================================
// CommandBus 新路径执行
// ==========================================

/**
 * 判断命令是否为 inline format 类型
 */
function isInlineFormatCommand(commandId: string): boolean {
  return ['toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrikethrough'].includes(commandId);
}

/**
 * 判断命令是否为 history 类型
 */
function isHistoryCommand(commandId: string): boolean {
  return commandId === 'undo' || commandId === 'redo';
}

/**
 * 边界违规检测结果
 */
interface BoundaryViolation {
  flagName: string;
  commandId: string;
}

/**
 * 检测 feature flag 开启时是否意外进入 legacy 分支
 * 
 * 当 feature flag 开启时，对应的命令应该由 CommandBus 完全处理，
 * 不应该进入 legacy 分支。如果进入了，说明边界收紧有漏洞。
 * 
 * @param commandId - 命令 ID
 * @param flags - 当前 feature flags
 * @returns 如果检测到违规，返回违规信息；否则返回 null
 */
function detectBoundaryViolation(
  commandId: string,
  flags: ReturnType<typeof getCommandFeatureFlags>
): BoundaryViolation | null {
  // 检查 format 命令
  if (isInlineFormatCommand(commandId) && flags.useCommandBusForFormat) {
    return { flagName: 'useCommandBusForFormat', commandId };
  }
  
  // 检查 history 命令
  if (isHistoryCommand(commandId) && flags.useCommandBusForHistory) {
    return { flagName: 'useCommandBusForHistory', commandId };
  }
  
  // 检查 block type 命令
  const blockTypeCommands = ['setBlockTypeParagraph', 'setBlockTypeHeading1', 'setBlockTypeHeading2', 'setBlockTypeHeading3'];
  if (blockTypeCommands.includes(commandId) && flags.useCommandBusForBlockType) {
    return { flagName: 'useCommandBusForBlockType', commandId };
  }
  
  // 检查 edit 命令
  const editCommands = ['insertText', 'deleteRange', 'splitBlock', 'insertLineBreak'];
  if (editCommands.includes(commandId) && flags.useCommandBusForEdit) {
    return { flagName: 'useCommandBusForEdit', commandId };
  }
  
  return null;
}

/**
 * 通过 CommandBus 执行命令
 * 
 * 【流程】
 * 1. 从 Lexical 同步当前状态到 DocumentRuntime（undo/redo 除外）
 * 2. 通过 CommandBus 执行命令
 * 3. 将结果同步回 Lexical
 * 
 * 【重要：边界收紧】(2025-11)
 * - 当 featureFlag 开启时，命令只走 CommandBus → DocOps → DocumentEngine
 * - 失败时不再 fallback 到 Lexical，而是 no-op + warn
 * - 这确保了数据一致性：AST 和 Lexical 状态保持同步
 * 
 * @param editor - Lexical 编辑器实例
 * @param commandId - 命令 ID
 * @param payload - 命令参数
 * @returns 执行结果对象 { handled: boolean, success: boolean }
 */
interface CommandExecutionResult {
  /** 命令是否被处理（true = 不需要 fallback） */
  handled: boolean;
  /** 命令是否执行成功 */
  success: boolean;
}

function executeCommandViaCommandBus(
  editor: LexicalEditor,
  commandId: string,
  payload?: any
): CommandExecutionResult {
  const flags = getCommandFeatureFlags();
  
  try {
    const runtime = commandBus.getRuntime();
    const historyCmd = isHistoryCommand(commandId);
    
    // ==========================================
    // History 命令特殊处理
    // ==========================================
    if (historyCmd && flags.useCommandBusForHistory) {
      const snapshot = runtime.getSnapshot();
      
      // 检查是否有历史可操作
      if (commandId === 'undo' && !snapshot.canUndo) {
        console.log(`[LexicalAdapter] No DocumentRuntime history to undo (no-op)`);
        // 🔴 不再 fallback 到 Lexical，直接 no-op
        return { handled: true, success: false };
      }
      if (commandId === 'redo' && !snapshot.canRedo) {
        console.log(`[LexicalAdapter] No DocumentRuntime history to redo (no-op)`);
        // 🔴 不再 fallback 到 Lexical，直接 no-op
        return { handled: true, success: false };
      }
      
      // 执行 undo/redo
      const result = commandBus.executeWithRuntime(commandId as any);
      
      if (result.success) {
        reconcileAstToLexical(editor, result.nextAst, {
          selection: result.nextSelection,
        });
        console.log(`[LexicalAdapter] DocumentRuntime ${commandId} succeeded`);
        return { handled: true, success: true };
      }
      
      console.warn(`[LexicalAdapter] DocumentRuntime ${commandId} failed:`, result.error);
      return { handled: true, success: false };
    }
    
    // ==========================================
    // 其他命令：先同步状态，再执行
    // ==========================================
    if (!historyCmd) {
      syncLexicalToRuntime(editor, runtime);
    }
    
    // 映射 LexicalAdapter 命令 ID 到 CommandBus 命令 ID
    const busCommandId = mapToBusCommandId(commandId);
    if (!busCommandId) {
      console.warn(`[LexicalAdapter] No CommandBus mapping for: ${commandId}`);
      return { handled: false, success: false };
    }

    // 转换 payload
    const busPayload = mapPayload(commandId, payload);

    // 执行命令
    const result = commandBus.executeWithRuntime(busCommandId as any, busPayload);

    if (result.success) {
      // 将结果同步回 Lexical
      reconcileAstToLexical(editor, result.nextAst, {
        selection: result.nextSelection,
      });
      
      console.log(`[LexicalAdapter] CommandBus path succeeded for: ${commandId}`);
      return { handled: true, success: true };
    }

    // 🔴 对于 inline format 命令，失败时不再 fallback
    if (isInlineFormatCommand(commandId) && flags.useCommandBusForFormat) {
      console.warn(`[LexicalAdapter] CommandBus failed for ${commandId}, no fallback (DocOps boundary enforced):`, result.error);
      return { handled: true, success: false };
    }

    console.warn(`[LexicalAdapter] CommandBus execution failed:`, result.error);
    return { handled: false, success: false };
  } catch (error) {
    console.error(`[LexicalAdapter] CommandBus path error:`, error);
    
    // 🔴 对于受 feature flag 保护的命令，不允许 fallback
    const flags = getCommandFeatureFlags();
    if (isInlineFormatCommand(commandId) && flags.useCommandBusForFormat) {
      console.warn(`[LexicalAdapter] Error in ${commandId}, no fallback (DocOps boundary enforced)`);
      return { handled: true, success: false };
    }
    if (isHistoryCommand(commandId) && flags.useCommandBusForHistory) {
      console.warn(`[LexicalAdapter] Error in ${commandId}, no fallback (DocOps boundary enforced)`);
      return { handled: true, success: false };
    }
    
    return { handled: false, success: false };
  }
}

/**
 * 映射 LexicalAdapter 命令 ID 到 CommandBus 命令 ID
 */
function mapToBusCommandId(lexicalCommandId: string): string | null {
  const mapping: Record<string, string> = {
    // 文本格式
    'toggleBold': 'toggleBold',
    'toggleItalic': 'toggleItalic',
    'toggleUnderline': 'toggleUnderline',
    'toggleStrikethrough': 'toggleStrike', // 注意命名差异
    
    // 块级格式
    'setBlockTypeParagraph': 'setBlockTypeParagraph',
    'setBlockTypeHeading1': 'setBlockTypeHeading1',
    'setBlockTypeHeading2': 'setBlockTypeHeading2',
    'setBlockTypeHeading3': 'setBlockTypeHeading3',
    
    // 历史
    'undo': 'undo',
    'redo': 'redo',
    
    // 编辑
    'insertText': 'insertText',
  };

  return mapping[lexicalCommandId] ?? null;
}

/**
 * 转换 payload 格式
 */
function mapPayload(commandId: string, payload: any): any {
  switch (commandId) {
    case 'insertText':
      return { text: payload };
    default:
      return payload;
  }
}

export const executeEditorCommand = (editor: LexicalEditor, commandId: string, payload?: any) => {
  // ==========================================
  // 🆕 Feature Flag: 使用 CommandBus 新路径
  // ==========================================
  if (shouldUseCommandBus(commandId)) {
    const result = executeCommandViaCommandBus(editor, commandId, payload);
    if (result.handled) {
      // 命令已被 CommandBus 处理（无论成功与否），不再 fallback
      if (!result.success) {
        console.log(`[LexicalAdapter] Command "${commandId}" was handled but failed (no fallback)`);
      }
      return;
    }
    // 命令未被处理（可能是命令未注册），允许 fallback 到旧路径
    console.warn(`[LexicalAdapter] CommandBus did not handle "${commandId}", falling back to legacy path`);
  }

  // ==========================================
  // 旧路径：直接操作 Lexical
  // 
  // ⚠️ LEGACY ONLY: 当对应的 feature flag 开启时，
  // 这些旧路径应该永远不会被执行到。
  // 如果执行到了，说明边界收紧有漏洞！
  // ==========================================
  
  // 🚨 边界监控：检测 feature flag 开启时意外进入 legacy 分支
  const flags = getCommandFeatureFlags();
  const boundaryViolation = detectBoundaryViolation(commandId, flags);
  if (boundaryViolation) {
    console.error(
      `[docops-boundary-legacy-hit] 🚨 BOUNDARY VIOLATION: ` +
      `Command "${commandId}" entered legacy path while ${boundaryViolation.flagName}=true. ` +
      `This should NEVER happen. Please report this bug.`
    );
    // 阻止执行 legacy 代码，避免悄悄绕过 DocOps
    return;
  }

  switch (commandId) {
    // ==========================================
    // LEGACY ONLY: Editing
    // ==========================================
    case 'insertText':
      // TODO(docops-boundary): 待迁移到 useCommandBusForEdit
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText(payload);
        }
      });
      break;

    // ==========================================
    // LEGACY ONLY: Text Formatting
    // 仅当 useCommandBusForFormat=false 时执行
    // ==========================================
    case 'toggleBold':
      console.warn('[LexicalAdapter] LEGACY PATH: toggleBold via Lexical');
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
      break;
    case 'toggleItalic':
      console.warn('[LexicalAdapter] LEGACY PATH: toggleItalic via Lexical');
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
      break;
    case 'toggleUnderline':
      console.warn('[LexicalAdapter] LEGACY PATH: toggleUnderline via Lexical');
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
      break;
    case 'toggleStrikethrough':
      console.warn('[LexicalAdapter] LEGACY PATH: toggleStrikethrough via Lexical');
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');
      break;
    case 'clearFormat':
      // LEGACY ONLY: 目前 clearFormat 未实现 DocOps 路径
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const formats: Array<'bold' | 'italic' | 'underline' | 'strikethrough'> = ['bold', 'italic', 'underline', 'strikethrough'];
          formats.forEach(format => {
            if (selection.hasFormat(format)) {
              selection.toggleFormat(format);
            }
          });
        }
      });
      break;

    // ==========================================
    // LEGACY ONLY: History
    // 仅当 useCommandBusForHistory=false 时执行
    // ==========================================
    case 'undo':
      console.warn('[LexicalAdapter] LEGACY PATH: undo via Lexical UNDO_COMMAND');
      editor.dispatchCommand(UNDO_COMMAND, undefined);
      break;
    case 'redo':
      console.warn('[LexicalAdapter] LEGACY PATH: redo via Lexical REDO_COMMAND');
      editor.dispatchCommand(REDO_COMMAND, undefined);
      break;

    // AI 改写 - 替换选区内容
    case 'replaceSelection':
      replaceSelection(editor, payload as string);
      break;

    // AI 总结 - 在选区后插入新段落
    case 'insertAfterSelection':
      insertAfterSelection(editor, payload as string);
      break;

    // 章节级 AI - 替换章节内容
    case 'replaceSectionContent':
      replaceSectionContent(editor, payload);
      break;

    // 章节级 AI - 在章节后插入内容
    case 'insertAfterSection':
      insertAfterSection(editor, payload);
      break;

    // Block Formatting
    case 'setBlockTypeParagraph':
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createParagraphNode());
        }
      });
      break;
    case 'setBlockTypeHeading1':
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode('h1'));
        }
      });
      break;
    case 'setBlockTypeHeading2':
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode('h2'));
        }
      });
      break;
    case 'setBlockTypeHeading3':
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode('h3'));
        }
      });
      break;

    // ==========================================
    // 段落样式命令（统一入口）
    // ==========================================
    
    case 'applyParagraphStyle':
      applyParagraphStyle(editor, payload as ParagraphStyle);
      break;

    // ==========================================
    // 字体命令
    // ==========================================
    
    case 'setFont':
      applyFont(editor, payload as FontOptionKey);
      break;

    case 'setFontSize':
      applyFontSize(editor, payload as FontSizeKey);
      break;

    // ==========================================
    // 段落排版命令
    // ==========================================

    case 'setTextAlign':
      applyTextAlign(editor, payload as TextAlignKey);
      break;

    case 'setLineHeight':
      applyLineHeight(editor, payload as LineHeightKey);
      break;

    // ==========================================
    // 列表命令
    // ==========================================
    
    case 'toggleBulletList':
      editor.update(() => {
        if ($isAllListType('bullet')) {
          editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        } else {
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        }
      });
      break;

    case 'toggleNumberedList':
      editor.update(() => {
        if ($isAllListType('number')) {
          editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        } else {
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        }
      });
      break;

    case 'indentIncrease':
      editor.update(() => {
        const listItems = $getSelectedListItems();
        for (const item of listItems) {
          const currentIndent = item.getIndent();
          if (currentIndent < MAX_INDENT_LEVEL) {
            item.setIndent(currentIndent + 1);
          }
        }
      });
      break;

    case 'indentDecrease':
      editor.update(() => {
        const listItems = $getSelectedListItems();
        for (const item of listItems) {
          const currentIndent = item.getIndent();
          if (currentIndent > 0) {
            item.setIndent(currentIndent - 1);
          } else {
            // indentLevel == 0，退出列表变为段落
            const paragraph = $createParagraphNode();
            const children = item.getChildren();
            children.forEach(child => {
              paragraph.append(child);
            });
            item.replace(paragraph);
          }
        }
      });
      break;

    default:
      console.warn(`[LexicalAdapter] Unknown command: ${commandId}`);
  }
};

// ==========================================
// 段落样式应用
// ==========================================

/**
 * 应用段落样式
 * 
 * 将当前选区覆盖的所有段落设置为指定样式。
 * 行为类似 Word：不是 toggle，而是覆盖式设置。
 */
export function applyParagraphStyle(editor: LexicalEditor, style: ParagraphStyle): void {
  const config = getStyleConfig(style);
  
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    if (config.blockType === 'heading' && config.headingLevel) {
      const tag = `h${config.headingLevel}` as HeadingTagType;
      $setBlocksType(selection, () => $createHeadingNode(tag));
    } else {
      $setBlocksType(selection, () => $createParagraphNode());
    }
  });
}

// ==========================================
// 字体应用
// ==========================================

/**
 * 解析 CSS 样式字符串为 Map
 */
function parseStyleString(style: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!style) return map;
  
  const parts = style.split(';');
  for (const part of parts) {
    const colonIndex = part.indexOf(':');
    if (colonIndex > 0) {
      const key = part.slice(0, colonIndex).trim();
      const value = part.slice(colonIndex + 1).trim();
      if (key && value) {
        map.set(key, value);
      }
    }
  }
  return map;
}

/**
 * 将 Map 转换为 CSS 样式字符串
 */
function stringifyStyleMap(map: Map<string, string>): string {
  const parts: string[] = [];
  map.forEach((value, key) => {
    parts.push(`${key}: ${value}`);
  });
  return parts.join('; ');
}

/**
 * 应用字体到选区
 * 
 * @param editor - Lexical 编辑器实例
 * @param fontKey - 字体选项键
 */
export function applyFont(editor: LexicalEditor, fontKey: FontOptionKey): void {
  const fontFamily = resolveFontFamily(fontKey);
  
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    
    if (selection.isCollapsed()) {
      // 折叠选区：设置输入态样式
      const currentStyle = selection.style || '';
      const styleMap = parseStyleString(currentStyle);
      
      if (fontFamily) {
        styleMap.set('font-family', fontFamily);
      } else {
        styleMap.delete('font-family');
      }
      
      selection.setStyle(stringifyStyleMap(styleMap));
    } else {
      // 非折叠选区：对选中的文字应用字体
      const nodes = selection.getNodes();
      
      for (const node of nodes) {
        if ($isTextNode(node)) {
          const currentStyle = node.getStyle() || '';
          const styleMap = parseStyleString(currentStyle);
          
          if (fontFamily) {
            styleMap.set('font-family', fontFamily);
          } else {
            styleMap.delete('font-family');
          }
          
          node.setStyle(stringifyStyleMap(styleMap));
        }
      }
    }
  });
}

// ==========================================
// 字号应用
// ==========================================

/**
 * 应用字号到选区
 */
export function applyFontSize(editor: LexicalEditor, sizeKey: FontSizeKey): void {
  const fontSize = getFontSizeValue(sizeKey);
  
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    
    if (selection.isCollapsed()) {
      const currentStyle = selection.style || '';
      const styleMap = parseStyleString(currentStyle);
      styleMap.set('font-size', fontSize);
      selection.setStyle(stringifyStyleMap(styleMap));
    } else {
      const nodes = selection.getNodes();
      for (const node of nodes) {
        if ($isTextNode(node)) {
          const currentStyle = node.getStyle() || '';
          const styleMap = parseStyleString(currentStyle);
          styleMap.set('font-size', fontSize);
          node.setStyle(stringifyStyleMap(styleMap));
        }
      }
    }
  });
}

// ==========================================
// 段落对齐
// ==========================================

/**
 * 应用对齐方式到段落
 */
export function applyTextAlign(editor: LexicalEditor, align: TextAlignKey): void {
  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, align as ElementFormatType);
}

// ==========================================
// 行距应用
// ==========================================

/**
 * 应用行距到段落
 * 
 * 注意：Lexical 不直接支持行距，我们通过 CSS 样式实现
 */
export function applyLineHeight(editor: LexicalEditor, lineHeightKey: LineHeightKey): void {
  const lineHeight = getLineHeightValue(lineHeightKey);
  
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    
    // 获取选中的块级节点
    const nodes = selection.getNodes();
    const blocks = new Set<any>();
    
    for (const node of nodes) {
      const topLevel = node.getTopLevelElementOrThrow();
      blocks.add(topLevel);
    }
    
    // 对每个块应用行距
    blocks.forEach(block => {
      if ($isElementNode(block)) {
        // 使用 style 属性设置行距
        const currentStyle = (block as any).getStyle?.() || '';
        const styleMap = parseStyleString(currentStyle);
        styleMap.set('line-height', String(lineHeight));
        (block as any).setStyle?.(stringifyStyleMap(styleMap));
      }
    });
  });
}

// ==========================================
// AI 改写 - 替换选区
// ==========================================

/**
 * 替换选区内容
 * 
 * 用于 AI 改写功能。
 * - 删除当前选区内容
 * - 插入新文本
 * - 保持段落样式不变
 * - 作为单次操作进入 Undo 栈
 * 
 * @param editor - Lexical 编辑器实例
 * @param newText - 替换后的文本
 */
export function replaceSelection(editor: LexicalEditor, newText: string): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      console.warn('[LexicalAdapter] replaceSelection: No range selection');
      return;
    }

    if (selection.isCollapsed()) {
      console.warn('[LexicalAdapter] replaceSelection: Selection is collapsed');
      return;
    }

    // 删除选区内容并插入新文本
    // Lexical 的 insertText 会自动处理选区删除
    selection.insertText(newText);
    
    console.log('[LexicalAdapter] replaceSelection: Replaced with', newText.length, 'chars');
  }, { tag: 'ai-rewrite' }); // 添加标签用于识别这次更新
}

/**
 * 在选区后插入新段落
 * 
 * 用于 AI 总结功能。
 * - 不修改原有选区内容
 * - 在选区末尾所在段落之后插入新段落
 * - 新段落带有"总结："前缀
 * - 作为单次操作进入 Undo 栈
 * 
 * @param editor - Lexical 编辑器实例
 * @param text - 要插入的文本（摘要内容）
 */
export function insertAfterSelection(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      console.warn('[LexicalAdapter] insertAfterSelection: No range selection');
      return;
    }

    // 获取选区末尾所在的顶级块节点
    const focusNode = selection.focus.getNode();
    const topLevelElement = focusNode.getTopLevelElementOrThrow();

    // 创建新的段落节点
    const summaryParagraph = $createParagraphNode();
    
    // 创建带有"总结："前缀的文本节点
    const prefixText = $createTextNode('总结：');
    prefixText.setFormat('bold'); // 前缀加粗
    
    const contentText = $createTextNode(text);
    
    summaryParagraph.append(prefixText);
    summaryParagraph.append(contentText);

    // 在顶级块节点之后插入新段落
    topLevelElement.insertAfter(summaryParagraph);

    // 将光标移动到新段落末尾
    summaryParagraph.selectEnd();
    
    console.log('[LexicalAdapter] insertAfterSelection: Inserted summary paragraph');
  }, { tag: 'ai-summarize' }); // 添加标签用于识别这次更新
}

// ==========================================
// 章节级 AI 操作
// ==========================================

interface ReplaceSectionPayload {
  headingId: string;
  newContent: string;
  /** 是否也替换标题内容 */
  replaceHeading?: boolean;
  /** 新的标题文本（仅当 replaceHeading=true 时使用） */
  newHeadingText?: string;
  range?: {
    startIndex: number;
    endIndex: number;
    paragraphIds: string[];
  };
}

interface InsertAfterSectionPayload {
  headingId: string;
  text: string;
}

/**
 * 获取标题级别
 */
function getHeadingLevel(node: LexicalNode): number | null {
  if ($isHeadingNode(node)) {
    const tag = (node as HeadingNode).getTag();
    switch (tag) {
      case 'h1': return 1;
      case 'h2': return 2;
      case 'h3': return 3;
      default: return null;
    }
  }
  return null;
}

/**
 * 替换章节内容
 * 
 * 用于章节级 AI 改写功能。
 * - 找到指定 heading
 * - 可选：替换标题内容
 * - 删除 heading 之后、下一个同级或更高级别 heading 之前的所有内容
 * - 插入新内容
 * - 作为单次操作进入 Undo 栈
 */
export function replaceSectionContent(editor: LexicalEditor, payload: ReplaceSectionPayload): void {
  const { headingId, newContent, replaceHeading, newHeadingText } = payload;
  
  editor.update(() => {
    const root = $getRoot();
    const children = root.getChildren();
    
    // 找到目标 heading
    let headingIndex = -1;
    let headingNode: LexicalNode | null = null;
    let headingLevel: number | null = null;
    
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.getKey() === headingId) {
        headingIndex = i;
        headingNode = node;
        headingLevel = getHeadingLevel(node);
        break;
      }
    }
    
    if (headingIndex === -1 || headingLevel === null || !headingNode) {
      console.warn('[LexicalAdapter] replaceSectionContent: Heading not found:', headingId);
      return;
    }
    
    // 如果需要替换标题内容
    if (replaceHeading && newHeadingText && $isHeadingNode(headingNode)) {
      // 清空标题节点的内容，插入新文本
      const headingElement = headingNode as HeadingNode;
      headingElement.clear();
      const newTextNode = $createTextNode(newHeadingText);
      headingElement.append(newTextNode);
      console.log('[LexicalAdapter] replaceSectionContent: Updated heading text');
    }
    
    // 找到章节结束位置
    let endIndex = children.length;
    for (let i = headingIndex + 1; i < children.length; i++) {
      const node = children[i];
      const level = getHeadingLevel(node);
      if (level !== null && level <= headingLevel) {
        endIndex = i;
        break;
      }
    }
    
    // 收集要删除的节点（不包括 heading 本身）
    const nodesToRemove: LexicalNode[] = [];
    for (let i = headingIndex + 1; i < endIndex; i++) {
      nodesToRemove.push(children[i]);
    }
    
    console.log('[LexicalAdapter] replaceSectionContent:', {
      headingIndex,
      endIndex,
      nodesToRemove: nodesToRemove.length,
      newContentLength: newContent?.length || 0,
      replaceHeading,
      newHeadingText: newHeadingText?.slice(0, 50),
    });
    
    // 先删除所有旧内容
    for (const node of nodesToRemove) {
      node.remove();
    }
    
    // 如果有新内容，创建新的段落并插入到 heading 后面
    if (newContent && newContent.trim()) {
      // 按换行符分割，支持多段落
      const lines = newContent.split(/\n+/).filter(line => line.trim());
      
      let lastInsertedNode: LexicalNode = headingNode;
      
      for (const line of lines) {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(line.trim());
        paragraph.append(textNode);
        lastInsertedNode.insertAfter(paragraph);
        lastInsertedNode = paragraph;
      }
      
      console.log('[LexicalAdapter] replaceSectionContent: Done, inserted', lines.length, 'paragraphs');
    } else {
      console.log('[LexicalAdapter] replaceSectionContent: Done, no content to insert');
    }
  }, { tag: 'ai-section-rewrite' });
}

/**
 * 在章节后插入内容
 * 
 * 用于章节级 AI 总结功能。
 * - 找到指定 heading 的章节末尾
 * - 在该位置插入新的摘要段落
 * - 不修改原有内容
 */
export function insertAfterSection(editor: LexicalEditor, payload: InsertAfterSectionPayload): void {
  const { headingId, text } = payload;
  
  editor.update(() => {
    const root = $getRoot();
    const children = root.getChildren();
    
    // 找到目标 heading
    let headingIndex = -1;
    let headingLevel: number | null = null;
    
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.getKey() === headingId) {
        headingIndex = i;
        headingLevel = getHeadingLevel(node);
        break;
      }
    }
    
    if (headingIndex === -1 || headingLevel === null) {
      console.warn('[LexicalAdapter] insertAfterSection: Heading not found:', headingId);
      return;
    }
    
    // 找到章节结束位置
    let endIndex = children.length - 1;
    for (let i = headingIndex + 1; i < children.length; i++) {
      const node = children[i];
      const level = getHeadingLevel(node);
      if (level !== null && level <= headingLevel) {
        endIndex = i - 1;
        break;
      }
    }
    
    // 在章节末尾插入摘要段落
    const lastNodeInSection = children[endIndex];
    
    const summaryParagraph = $createParagraphNode();
    const prefixText = $createTextNode('总结：');
    prefixText.setFormat('bold');
    const contentText = $createTextNode(text);
    summaryParagraph.append(prefixText);
    summaryParagraph.append(contentText);
    
    lastNodeInSection.insertAfter(summaryParagraph);
    
    console.log('[LexicalAdapter] insertAfterSection: Inserted summary after section');
  }, { tag: 'ai-section-summarize' });
}

