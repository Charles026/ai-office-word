/**
 * Lexical Editor Context
 * 
 * 暴露编辑器实例和命令接口给上层组件（如 Ribbon）。
 */

import { createContext, useContext } from 'react';
import { LexicalEditor } from 'lexical';

export interface LexicalEditorContextValue {
  editor: LexicalEditor | null;
  applyCommand: (commandId: string, payload?: any) => void;
}

export const LexicalEditorContext = createContext<LexicalEditorContextValue | null>(null);

export function useLexicalEditorContext() {
  const context = useContext(LexicalEditorContext);
  if (!context) {
    throw new Error('useLexicalEditorContext must be used within LexicalEditorProvider');
  }
  return context;
}

