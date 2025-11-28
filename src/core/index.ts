/**
 * Core 模块导出
 * 
 * 提供核心服务：
 * - DocumentSaveService: 文档保存服务
 * - SnapshotService: 版本快照服务
 */

export {
  DocumentSaveService,
  documentSaveService,
  type SaveResult,
  type SaveStatus,
  type DocumentSaveState,
  type SaveStateChangeCallback,
  type DocumentSaveServiceConfig,
} from './DocumentSaveService';

export {
  SnapshotService,
  snapshotService,
  type SnapshotMeta,
  type SnapshotServiceConfig,
} from './SnapshotService';
