/**
 * AI Office - Electron 主进程
 * 
 * 负责：
 * - 创建和管理窗口
 * - 注册 IPC 处理器
 * - 初始化文档引擎
 */

// 加载 .env 文件（必须在其他导入之前）
import * as dotenv from 'dotenv';
dotenv.config();

import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import { registerFileHandlers } from './src/main/ipc/fileHandlers';
import { registerFormatHandlers } from './src/main/ipc/formatHandlers';
import { registerAiHandlers } from './src/main/ipc/aiHandlers';
import { registerAgentLogHandlers } from './src/main/ipc/agentLogHandlers';

function createWindow() {
  const win = new BrowserWindow({
    width: 1289,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    title: 'AI Office',
    backgroundColor: '#00000000',
    transparent: true,
    frame: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 开发模式加载 Vite dev server，生产模式加载打包后的文件
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.setMinimumSize(1024, 640);
}

app.whenReady().then(() => {
  // 注册 IPC 处理器
  registerFileHandlers();
  registerFormatHandlers();
  registerAiHandlers();
  registerAgentLogHandlers();

  // 创建主窗口
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
