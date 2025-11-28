/**
 * SimpleDocxEngine - 简单文档引擎实现
 * 
 * 使用纯 JavaScript 的 docx npm 包创建 .docx 文件。
 * 这是轻量级实现，只支持创建，不支持完整的编辑功能。
 * 
 * 限制：
 * - 只能创建新文档
 * - 不支持 docx ↔ html 转换
 * - 不支持文档渲染和预览
 * 
 * 如需完整编辑功能，请使用 LibreOfficeEngine。
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  DocumentEngine,
  CreateBlankDocxOptions,
  CreateDocxResult,
  OpenDocForEditingResult,
  OpenedDocumentHandle,
  ExportPreviewOptions,
  LibreOfficeNotAvailableError,
} from './DocumentEngine';

export class SimpleDocxEngine implements DocumentEngine {
  readonly name = 'SimpleDocxEngine';
  readonly available = true;

  /**
   * 创建空白 docx 文档
   */
  async createBlankDocx(
    filePath: string,
    options?: CreateBlankDocxOptions
  ): Promise<CreateDocxResult> {
    const doc = new Document({
      creator: 'AI Office',
      title: options?.defaultName?.replace(/\.docx$/i, '') || 'New Document',
      description: 'Created by AI Office',
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: '' }),
              ],
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return {
      filePath,
      fileName: path.basename(filePath),
    };
  }

  /**
   * 打开文档进行编辑
   * 
   * SimpleDocxEngine 不支持此操作，需要 LibreOffice。
   */
  async openDocForEditing(_filePath: string): Promise<OpenDocForEditingResult> {
    throw new LibreOfficeNotAvailableError(
      'SimpleDocxEngine does not support document editing. ' +
      'Please install LibreOffice for full editing capabilities.'
    );
  }

  /**
   * 从 HTML 保存回 docx
   * 
   * SimpleDocxEngine 不支持此操作，需要 LibreOffice。
   */
  async saveDocFromHtml(_filePath: string, _htmlContent: string): Promise<void> {
    throw new LibreOfficeNotAvailableError(
      'SimpleDocxEngine does not support saving from HTML. ' +
      'Please install LibreOffice for full editing capabilities.'
    );
  }

  /**
   * 打开已有文档
   */
  async openDocx(filePath: string): Promise<OpenedDocumentHandle> {
    const fileName = path.basename(filePath);
    await fs.access(filePath);

    return {
      filePath,
      fileName,
      editable: false,
      async close() {},
    };
  }

  /**
   * 导出文档预览
   */
  async exportPreview(
    _filePath: string,
    _options: ExportPreviewOptions
  ): Promise<Buffer | string> {
    throw new LibreOfficeNotAvailableError(
      'SimpleDocxEngine does not support preview export. ' +
      'Please install LibreOffice for preview capabilities.'
    );
  }
}

export const simpleDocxEngine = new SimpleDocxEngine();
