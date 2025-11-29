/**
 * Feature Flags 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCommandFeatureFlags,
  setCommandFeatureFlags,
  resetCommandFeatureFlags,
  shouldUseCommandBus,
} from '../featureFlags';

describe('Command Feature Flags', () => {
  beforeEach(() => {
    resetCommandFeatureFlags();
  });

  describe('getCommandFeatureFlags', () => {
    it('should return default flags (all false)', () => {
      const flags = getCommandFeatureFlags();
      
      expect(flags.useCommandBusForFormat).toBe(false);
      expect(flags.useCommandBusForBlockType).toBe(false);
      expect(flags.useCommandBusForHistory).toBe(false);
      expect(flags.useCommandBusForEdit).toBe(false);
    });

    it('should return a copy (not the original object)', () => {
      const flags1 = getCommandFeatureFlags();
      const flags2 = getCommandFeatureFlags();
      
      expect(flags1).not.toBe(flags2);
      expect(flags1).toEqual(flags2);
    });
  });

  describe('setCommandFeatureFlags', () => {
    it('should update specific flags', () => {
      setCommandFeatureFlags({ useCommandBusForFormat: true });
      
      const flags = getCommandFeatureFlags();
      expect(flags.useCommandBusForFormat).toBe(true);
      expect(flags.useCommandBusForBlockType).toBe(false);
    });

    it('should support partial updates', () => {
      setCommandFeatureFlags({ useCommandBusForFormat: true });
      setCommandFeatureFlags({ useCommandBusForHistory: true });
      
      const flags = getCommandFeatureFlags();
      expect(flags.useCommandBusForFormat).toBe(true);
      expect(flags.useCommandBusForHistory).toBe(true);
      expect(flags.useCommandBusForBlockType).toBe(false);
    });
  });

  describe('resetCommandFeatureFlags', () => {
    it('should reset all flags to default', () => {
      setCommandFeatureFlags({
        useCommandBusForFormat: true,
        useCommandBusForBlockType: true,
        useCommandBusForHistory: true,
        useCommandBusForEdit: true,
      });

      resetCommandFeatureFlags();

      const flags = getCommandFeatureFlags();
      expect(flags.useCommandBusForFormat).toBe(false);
      expect(flags.useCommandBusForBlockType).toBe(false);
      expect(flags.useCommandBusForHistory).toBe(false);
      expect(flags.useCommandBusForEdit).toBe(false);
    });
  });

  describe('shouldUseCommandBus', () => {
    it('should return false for all commands when flags are off', () => {
      expect(shouldUseCommandBus('toggleBold')).toBe(false);
      expect(shouldUseCommandBus('setBlockTypeHeading1')).toBe(false);
      expect(shouldUseCommandBus('undo')).toBe(false);
      expect(shouldUseCommandBus('insertText')).toBe(false);
    });

    it('should return true for format commands when useCommandBusForFormat is on', () => {
      setCommandFeatureFlags({ useCommandBusForFormat: true });
      
      expect(shouldUseCommandBus('toggleBold')).toBe(true);
      expect(shouldUseCommandBus('toggleItalic')).toBe(true);
      expect(shouldUseCommandBus('toggleUnderline')).toBe(true);
      expect(shouldUseCommandBus('toggleStrikethrough')).toBe(true);
      
      // Other commands should still be false
      expect(shouldUseCommandBus('undo')).toBe(false);
      expect(shouldUseCommandBus('insertText')).toBe(false);
    });

    it('should return true for block type commands when useCommandBusForBlockType is on', () => {
      setCommandFeatureFlags({ useCommandBusForBlockType: true });
      
      expect(shouldUseCommandBus('setBlockTypeParagraph')).toBe(true);
      expect(shouldUseCommandBus('setBlockTypeHeading1')).toBe(true);
      expect(shouldUseCommandBus('setBlockTypeHeading2')).toBe(true);
      expect(shouldUseCommandBus('setBlockTypeHeading3')).toBe(true);
      
      // Other commands should still be false
      expect(shouldUseCommandBus('toggleBold')).toBe(false);
    });

    it('should return true for history commands when useCommandBusForHistory is on', () => {
      setCommandFeatureFlags({ useCommandBusForHistory: true });
      
      expect(shouldUseCommandBus('undo')).toBe(true);
      expect(shouldUseCommandBus('redo')).toBe(true);
      
      // Other commands should still be false
      expect(shouldUseCommandBus('toggleBold')).toBe(false);
    });

    it('should return true for edit commands when useCommandBusForEdit is on', () => {
      setCommandFeatureFlags({ useCommandBusForEdit: true });
      
      expect(shouldUseCommandBus('insertText')).toBe(true);
      expect(shouldUseCommandBus('deleteRange')).toBe(true);
      expect(shouldUseCommandBus('splitBlock')).toBe(true);
      expect(shouldUseCommandBus('insertLineBreak')).toBe(true);
      
      // Other commands should still be false
      expect(shouldUseCommandBus('toggleBold')).toBe(false);
    });

    it('should return false for unknown commands', () => {
      setCommandFeatureFlags({
        useCommandBusForFormat: true,
        useCommandBusForBlockType: true,
        useCommandBusForHistory: true,
        useCommandBusForEdit: true,
      });
      
      expect(shouldUseCommandBus('unknownCommand')).toBe(false);
      expect(shouldUseCommandBus('replaceSelection')).toBe(false);
      expect(shouldUseCommandBus('toggleBulletList')).toBe(false);
    });
  });
});

