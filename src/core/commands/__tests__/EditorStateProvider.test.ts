/**
 * EditorStateProvider 测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EditorStateProvider,
  getEditorStateProvider,
  resetEditorStateProvider,
  LexicalStateReport,
} from '../EditorStateProvider';
import { setCommandFeatureFlags, resetCommandFeatureFlags } from '../featureFlags';
import { DocumentRuntime } from '../../../document/DocumentRuntime';
import { createEmptyDocument } from '../../../document/types';

describe('EditorStateProvider', () => {
  let provider: EditorStateProvider;
  let runtime: DocumentRuntime;

  beforeEach(() => {
    resetCommandFeatureFlags();
    runtime = new DocumentRuntime(createEmptyDocument());
    provider = new EditorStateProvider(runtime);
  });

  afterEach(() => {
    provider.dispose();
    resetEditorStateProvider();
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const state = provider.getState();
      
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(false);
      expect(state.hasSelection).toBe(false);
      expect(state._sources.history).toBe('lexical');
    });

    it('should use Lexical state when feature flag is off', () => {
      const lexicalState: LexicalStateReport = {
        canUndo: true,
        canRedo: true,
        hasSelection: true,
        activeFormats: ['toggleBold'],
      };

      provider.updateLexicalState(lexicalState);
      const state = provider.getState();

      expect(state.canUndo).toBe(true);
      expect(state.canRedo).toBe(true);
      expect(state.hasSelection).toBe(true);
      expect(state._sources.history).toBe('lexical');
    });

    it('should use Runtime state when feature flag is on', () => {
      setCommandFeatureFlags({ useCommandBusForHistory: true });

      // Lexical says canUndo=true, but Runtime says canUndo=false
      const lexicalState: LexicalStateReport = {
        canUndo: true,
        canRedo: true,
        hasSelection: false,
        activeFormats: [],
      };

      provider.updateLexicalState(lexicalState);
      const state = provider.getState();

      // Should use Runtime's value (false, since no operations yet)
      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(false);
      expect(state._sources.history).toBe('runtime');
    });
  });

  describe('subscribe', () => {
    it('should notify listeners when Lexical state updates', () => {
      const listener = vi.fn();
      provider.subscribe(listener);

      const lexicalState: LexicalStateReport = {
        canUndo: true,
        canRedo: false,
        hasSelection: true,
        activeFormats: [],
      };

      provider.updateLexicalState(lexicalState);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        canUndo: true,
        canRedo: false,
        hasSelection: true,
      }));
    });

    it('should allow unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = provider.subscribe(listener);

      unsubscribe();

      provider.updateLexicalState({
        canUndo: true,
        canRedo: false,
        hasSelection: false,
        activeFormats: [],
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('global provider', () => {
    it('should return the same instance', () => {
      const provider1 = getEditorStateProvider();
      const provider2 = getEditorStateProvider();
      
      expect(provider1).toBe(provider2);
    });

    it('should reset on resetEditorStateProvider', () => {
      const provider1 = getEditorStateProvider();
      resetEditorStateProvider();
      const provider2 = getEditorStateProvider();
      
      expect(provider1).not.toBe(provider2);
    });
  });
});

