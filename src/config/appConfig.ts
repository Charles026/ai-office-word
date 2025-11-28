/**
 * AI Office 应用配置
 * 
 * 集中管理应用级别的配置项。
 * 未来可以扩展为从配置文件/环境变量读取。
 */

import { DocumentEngineType } from '../main/docEngine/DocumentEngine';

/**
 * 应用配置接口
 */
export interface AppConfig {
  /**
   * 文档引擎类型
   * 
   * - "simple": 轻量级模式，使用 JS 文档库（docx npm 包）
   *   - 优点：无外部依赖，启动快
   *   - 缺点：功能有限，不支持高保真渲染
   *   - 适用：快速创建文档，简单编辑
   * 
   * - "libreoffice-cli": LibreOffice 命令行模式
   *   - 优点：支持格式转换、PDF 导出、预览生成
   *   - 缺点：需要本地安装 LibreOffice，操作较慢
   *   - 适用：需要高保真输出的场景
   *   - 实现方式：通过 soffice --headless 命令
   * 
   * - "libreoffice-kit": LibreOfficeKit 深度集成模式（开发中）
   *   - 优点：支持 tiled rendering，可实现真正的文档编辑器
   *   - 缺点：需要编译 LibreOfficeKit 绑定，较复杂
   *   - 适用：需要完整文档编辑能力的场景
   *   - 实现方式：通过 LibreOfficeKit C/C++ API
   * 
   * 默认值：'simple'
   */
  documentEngineType: DocumentEngineType;

  /**
   * 默认文档保存目录
   * 
   * 新建文档时的默认保存位置。
   * 如果为空，使用系统文档目录。
   */
  defaultDocumentDirectory?: string;

  /**
   * 默认新建文档名称
   */
  defaultDocumentName: string;

  /**
   * 是否启用 LibreOffice 自动检测
   * 
   * 如果为 true，应用启动时会检测 LibreOffice 是否安装。
   * 检测结果用于决定是否启用相关功能。
   */
  autoDetectLibreOffice: boolean;

  /**
   * LibreOffice 自定义路径（可选）
   * 
   * 如果系统中 LibreOffice 安装在非标准位置，
   * 可以在这里指定 soffice 可执行文件的路径。
   */
  libreOfficePath?: string;
}

/**
 * 默认配置
 */
export const appConfig: AppConfig = {
  // 使用 LibreOffice CLI 模式以支持文档编辑
  documentEngineType: 'libreoffice-cli',

  // 默认文档名称
  defaultDocumentName: 'New Document.docx',

  // 启用 LibreOffice 自动检测
  autoDetectLibreOffice: true,

  // LibreOffice 路径（留空表示自动检测）
  libreOfficePath: undefined,

  // 默认文档目录（留空表示使用系统文档目录）
  defaultDocumentDirectory: undefined,
};

/**
 * 更新配置
 * 
 * TODO: 未来实现配置持久化
 * - 保存到 ~/.ai-office/config.json
 * - 或使用 electron-store
 */
export function updateConfig(updates: Partial<AppConfig>): void {
  Object.assign(appConfig, updates);
  
  // TODO: 持久化到配置文件
  // await fs.writeFile(configPath, JSON.stringify(appConfig, null, 2));
}

/**
 * 获取系统文档目录
 */
export function getDocumentsDirectory(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  
  switch (process.platform) {
    case 'darwin':
      return `${home}/Documents`;
    case 'win32':
      return `${home}\\Documents`;
    default:
      return `${home}/Documents`;
  }
}

