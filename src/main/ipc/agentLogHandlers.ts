/**
 * Agent 日志 IPC 处理器
 * 
 * 【职责】
 * - 接收渲染进程发送的 Agent 日志事件
 * - 将日志写入本地 JSONL 文件
 * 
 * 【存储位置】
 * ${userData}/ai-libre/agent-logs.jsonl
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ==========================================
// 配置
// ==========================================

const LOG_DIR_NAME = 'ai-libre';
const LOG_FILE_NAME = 'agent-logs.jsonl';

// ==========================================
// 日志写入器
// ==========================================

class AgentLogWriter {
  private logFilePath: string | null = null;
  private writeStream: fs.WriteStream | null = null;
  private initialized = false;

  /**
   * 初始化日志写入器
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // 获取 userData 路径
      const userDataPath = app.getPath('userData');
      const logDir = path.join(userDataPath, LOG_DIR_NAME);

      // 确保目录存在
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // 设置日志文件路径
      this.logFilePath = path.join(logDir, LOG_FILE_NAME);

      // 创建写入流（追加模式）
      this.writeStream = fs.createWriteStream(this.logFilePath, {
        flags: 'a',
        encoding: 'utf8',
      });

      this.initialized = true;
      console.log('[AgentLogWriter] Initialized, log file:', this.logFilePath);
    } catch (error) {
      console.error('[AgentLogWriter] Failed to initialize:', error);
    }
  }

  /**
   * 写入日志事件
   */
  write(event: unknown): void {
    if (!this.initialized || !this.writeStream) {
      console.warn('[AgentLogWriter] Not initialized, skipping log');
      return;
    }

    try {
      // 序列化为 JSON 并追加换行符
      const line = JSON.stringify(event) + '\n';
      this.writeStream.write(line);
    } catch (error) {
      console.error('[AgentLogWriter] Failed to write log:', error);
    }
  }

  /**
   * 关闭写入器
   */
  close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
    this.initialized = false;
  }

  /**
   * 获取日志文件路径
   */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }
}

// ==========================================
// 单例实例
// ==========================================

const logWriter = new AgentLogWriter();

// ==========================================
// IPC 处理器注册
// ==========================================

/**
 * 注册 Agent 日志 IPC 处理器
 */
export function registerAgentLogHandlers(): void {
  // 初始化日志写入器
  logWriter.init().catch(error => {
    console.error('[agentLogHandlers] Failed to init log writer:', error);
  });

  // 监听日志事件
  ipcMain.on('agent-log:event', (_event, logEvent: unknown) => {
    try {
      // 添加服务器时间戳
      const enrichedEvent = {
        ...logEvent as Record<string, unknown>,
        serverTimestamp: Date.now(),
      };

      // 写入日志
      logWriter.write(enrichedEvent);
    } catch (error) {
      console.error('[agentLogHandlers] Failed to process log event:', error);
    }
  });

  // 提供获取日志文件路径的接口
  ipcMain.handle('agent-log:get-path', () => {
    return logWriter.getLogFilePath();
  });

  console.log('[agentLogHandlers] Agent log IPC handlers registered');
}

/**
 * 注销 Agent 日志 IPC 处理器
 */
export function unregisterAgentLogHandlers(): void {
  ipcMain.removeAllListeners('agent-log:event');
  ipcMain.removeHandler('agent-log:get-path');
  logWriter.close();
  console.log('[agentLogHandlers] Agent log IPC handlers unregistered');
}

// ==========================================
// 导出
// ==========================================

export { logWriter };

