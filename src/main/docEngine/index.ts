/**
 * 文档引擎模块导出
 */

// 类型和接口
export type {
  DocumentEngine,
  DocumentEngineType,
  CreateBlankDocxOptions,
  CreateDocxResult,
  OpenDocForEditingResult,
  OpenedDocumentHandle,
  ExportPreviewOptions,
  DocumentMetadata,
  EngineStatus,
} from './DocumentEngine';

// 错误类型
export {
  LibreOfficeNotAvailableError,
  DocumentConversionError,
} from './DocumentEngine';

// 引擎提供者（主要使用入口）
export { DocumentEngineProvider } from './DocumentEngineProvider';

// LibreOffice 检测工具
export { libreOfficeLocator, type LibreOfficeLocation } from './LibreOfficeLocator';
