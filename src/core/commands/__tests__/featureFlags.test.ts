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
    it('should return default flags (format and history enabled by default)', () => {
      const flags = getCommandFeatureFlags();
      
      // 2025-12 重构：默认开启 format 和 history，走 DocOps 路径
      expect(flags.useCommandBusForFormat).toBe(true);
      expect(flags.useCommandBusForBlockType).toBe(false);
      expect(flags.useCommandBusForHistory).toBe(true);
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
      // 先改变所有值
      setCommandFeatureFlags({
        useCommandBusForFormat: false,
        useCommandBusForBlockType: true,
        useCommandBusForHistory: false,
        useCommandBusForEdit: true,
      });

      resetCommandFeatureFlags();

      const flags = getCommandFeatureFlags();
      // 2025-12 重构：默认开启 format 和 history
      expect(flags.useCommandBusForFormat).toBe(true);
      expect(flags.useCommandBusForBlockType).toBe(false);
      expect(flags.useCommandBusForHistory).toBe(true);
      expect(flags.useCommandBusForEdit).toBe(false);
    });
  });

  describe('shouldUseCommandBus', () => {
    it('should return true for format and history by default (2025-12 defaults)', () => {
      // 默认情况下 format 和 history 已开启
      expect(shouldUseCommandBus('toggleBold')).toBe(true);
      expect(shouldUseCommandBus('undo')).toBe(true);
      
      // blockType 和 edit 默认关闭
      expect(shouldUseCommandBus('setBlockTypeHeading1')).toBe(false);
      expect(shouldUseCommandBus('insertText')).toBe(false);
    });

    it('should respect format flag when explicitly set', () => {
      // 显式关闭 format
      setCommandFeatureFlags({ useCommandBusForFormat: false });
      
      expect(shouldUseCommandBus('toggleBold')).toBe(false);
      expect(shouldUseCommandBus('toggleItalic')).toBe(false);
      expect(shouldUseCommandBus('toggleUnderline')).toBe(false);
      expect(shouldUseCommandBus('toggleStrikethrough')).toBe(false);
      
      // history 仍然开启（默认值）
      expect(shouldUseCommandBus('undo')).toBe(true);
    });

    it('should return true for block type commands when useCommandBusForBlockType is on', () => {
      setCommandFeatureFlags({ useCommandBusForBlockType: true });
      
      expect(shouldUseCommandBus('setBlockTypeParagraph')).toBe(true);
      expect(shouldUseCommandBus('setBlockTypeHeading1')).toBe(true);
      expect(shouldUseCommandBus('setBlockTypeHeading2')).toBe(true);
      expect(shouldUseCommandBus('setBlockTypeHeading3')).toBe(true);
    });

    it('should respect history flag when explicitly set', () => {
      // 显式关闭 history
      setCommandFeatureFlags({ useCommandBusForHistory: false });
      
      expect(shouldUseCommandBus('undo')).toBe(false);
      expect(shouldUseCommandBus('redo')).toBe(false);
      
      // format 仍然开启（默认值）
      expect(shouldUseCommandBus('toggleBold')).toBe(true);
    });

    it('should return true for edit commands when useCommandBusForEdit is on', () => {
      setCommandFeatureFlags({ useCommandBusForEdit: true });
      
      expect(shouldUseCommandBus('insertText')).toBe(true);
      expect(shouldUseCommandBus('deleteRange')).toBe(true);
      expect(shouldUseCommandBus('splitBlock')).toBe(true);
      expect(shouldUseCommandBus('insertLineBreak')).toBe(true);
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

