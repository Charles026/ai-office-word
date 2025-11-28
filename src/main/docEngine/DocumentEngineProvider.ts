/**
 * DocumentEngineProvider - 文档引擎选择器
 * 
 * 根据配置和系统状态返回对应的 DocumentEngine 实现。
 */

import {
  DocumentEngine,
  DocumentEngineType,
  EngineStatus,
} from './DocumentEngine';
import { simpleDocxEngine } from './SimpleDocxEngine';
import { libreOfficeEngine } from './LibreOfficeEngine';
import { appConfig } from '../../config/appConfig';

class DocumentEngineProviderClass {
  private currentEngine: DocumentEngine | null = null;
  private currentType: DocumentEngineType | null = null;
  private initialized = false;
  private _status: EngineStatus | null = null;

  /**
   * 获取当前引擎状态
   */
  get status(): EngineStatus | null {
    return this._status;
  }

  /**
   * 获取当前配置的文档引擎
   */
  async getEngine(): Promise<DocumentEngine> {
    const configuredType = appConfig.documentEngineType;

    if (this.initialized && this.currentType === configuredType && this.currentEngine) {
      return this.currentEngine;
    }

    this.currentEngine = await this.createEngine(configuredType);
    this.currentType = configuredType;
    this.initialized = true;

    console.log(`[DocumentEngineProvider] Using engine: ${this.currentEngine.name}`);
    return this.currentEngine;
  }

  /**
   * 根据类型创建引擎实例
   */
  private async createEngine(type: DocumentEngineType): Promise<DocumentEngine> {
    switch (type) {
      case 'simple':
        this._status = {
          type: 'simple',
          name: simpleDocxEngine.name,
          available: true,
        };
        return simpleDocxEngine;

      case 'libreoffice-cli':
      case 'libreoffice-kit':
        // 初始化 LibreOffice 引擎
        await libreOfficeEngine.initialize();

        if (libreOfficeEngine.available) {
          this._status = {
            type,
            name: libreOfficeEngine.name,
            available: true,
            libreOfficePath: libreOfficeEngine.binaryPath ?? undefined,
          };
          return libreOfficeEngine;
        }

        // LibreOffice 不可用，回退
        console.warn(
          '[DocumentEngineProvider] LibreOffice not available. ' +
          'Falling back to SimpleDocxEngine. ' +
          'Document editing will be limited.'
        );
        
        this._status = {
          type,
          name: 'SimpleDocxEngine (fallback)',
          available: false,
          errorMessage: 'LibreOffice not found. Please install LibreOffice for full editing capabilities.',
        };
        
        return simpleDocxEngine;

      default:
        console.warn(`[DocumentEngineProvider] Unknown engine type: ${type}`);
        this._status = {
          type: 'simple',
          name: simpleDocxEngine.name,
          available: true,
        };
        return simpleDocxEngine;
    }
  }

  /**
   * 获取引擎状态信息
   */
  async getEngineStatus(): Promise<EngineStatus> {
    // 确保引擎已初始化
    await this.getEngine();
    
    return this._status || {
      type: 'simple',
      name: 'Unknown',
      available: false,
    };
  }

  /**
   * 检查 LibreOffice 是否可用
   */
  async isLibreOfficeAvailable(): Promise<boolean> {
    await libreOfficeEngine.initialize();
    return libreOfficeEngine.available;
  }

  /**
   * 获取所有可用的引擎类型
   */
  async getAvailableEngines(): Promise<Array<{
    type: DocumentEngineType;
    name: string;
    available: boolean;
    description: string;
  }>> {
    await libreOfficeEngine.initialize();

    return [
      {
        type: 'simple',
        name: 'Simple (JS)',
        available: true,
        description: '轻量级模式，只支持创建文档，不支持编辑。',
      },
      {
        type: 'libreoffice-cli',
        name: 'LibreOffice (CLI)',
        available: libreOfficeEngine.available,
        description: '通过 LibreOffice 命令行进行文档编辑。支持 docx ↔ html 转换。',
      },
      {
        type: 'libreoffice-kit',
        name: 'LibreOffice (Kit)',
        available: false,
        description: '深度集成模式（开发中）。支持实时渲染和编辑。',
      },
    ];
  }

  getCurrentType(): DocumentEngineType | null {
    return this.currentType;
  }

  reset(): void {
    this.currentEngine = null;
    this.currentType = null;
    this.initialized = false;
    this._status = null;
  }
}

export const DocumentEngineProvider = new DocumentEngineProviderClass();
