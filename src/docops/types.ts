/**
 * DocOps 核心类型定义
 * 
 * 【层级职责】
 * DocOps Engine 层负责：
 * - 将 AI Intent 转换为原子文档操作指令 (DocOp)
 * - 不直接修改文档，只生成操作序列
 * 
 * 【禁止事项】
 * - 不允许在此层直接修改 DocumentAst
 * - 不允许在此层调用文件系统或 LibreOffice
 * - 不允许在此层直接调用 LLM API（未来通过 Runtime 层代理）
 */

// ==========================================
// 基础类型
// ==========================================

/**
 * 节点唯一标识
 */
export type DocNodeId = string;

/**
 * 文本偏移量
 */
export interface TextOffset {
  /** 在节点内的字符偏移 */
  offset: number;
}

/**
 * 文档选区
 * 
 * 支持 block-level 选择和 text-level 选择
 */
export interface DocSelection {
  /** 选区起始节点 ID */
  anchorNodeId: DocNodeId;
  /** 选区起始偏移（文本节点内） */
  anchorOffset: number;
  /** 选区结束节点 ID */
  focusNodeId: DocNodeId;
  /** 选区结束偏移 */
  focusOffset: number;
  /** 是否折叠（光标状态） */
  isCollapsed: boolean;
}

/**
 * 操作来源
 */
export type DocOpSource = 'user' | 'ai' | 'system' | 'undo' | 'redo';

/**
 * 操作元数据
 */
export interface DocOpMeta {
  /** 操作来源 */
  source: DocOpSource;
  /** 时间戳 */
  timestamp: number;
  /** 可选的操作 ID（用于追踪） */
  opId?: string;
  /** AI 相关的额外信息 */
  aiContext?: {
    intentId?: string;
    confidence?: number;
  };
}

// ==========================================
// 文档操作类型 (DocOp)
// ==========================================

/**
 * 插入段落
 */
export interface InsertParagraphOp {
  type: 'InsertParagraph';
  payload: {
    /** 在哪个节点之后插入（null = 文档开头） */
    afterNodeId: DocNodeId | null;
    /** 初始文本内容（可选） */
    text?: string;
  };
  meta: DocOpMeta;
}

/**
 * 插入文本
 */
export interface InsertTextOp {
  type: 'InsertText';
  payload: {
    /** 目标节点 ID */
    nodeId: DocNodeId;
    /** 插入位置偏移 */
    offset: number;
    /** 插入的文本 */
    text: string;
  };
  meta: DocOpMeta;
}

/**
 * 删除范围
 */
export interface DeleteRangeOp {
  type: 'DeleteRange';
  payload: {
    /** 起始节点 */
    startNodeId: DocNodeId;
    /** 起始偏移 */
    startOffset: number;
    /** 结束节点 */
    endNodeId: DocNodeId;
    /** 结束偏移 */
    endOffset: number;
  };
  meta: DocOpMeta;
}

/**
 * 切换粗体
 */
export interface ToggleBoldOp {
  type: 'ToggleBold';
  payload: {
    /** 目标节点 ID */
    nodeId: DocNodeId;
    /** 起始偏移 */
    startOffset: number;
    /** 结束偏移 */
    endOffset: number;
    /** 强制设置（true=加粗，false=取消，undefined=切换） */
    force?: boolean;
  };
  meta: DocOpMeta;
}

/**
 * 切换斜体
 */
export interface ToggleItalicOp {
  type: 'ToggleItalic';
  payload: {
    nodeId: DocNodeId;
    startOffset: number;
    endOffset: number;
    force?: boolean;
  };
  meta: DocOpMeta;
}

/**
 * 切换下划线
 */
export interface ToggleUnderlineOp {
  type: 'ToggleUnderline';
  payload: {
    nodeId: DocNodeId;
    startOffset: number;
    endOffset: number;
    force?: boolean;
  };
  meta: DocOpMeta;
}

/**
 * 切换删除线
 */
export interface ToggleStrikeOp {
  type: 'ToggleStrike';
  payload: {
    nodeId: DocNodeId;
    startOffset: number;
    endOffset: number;
    force?: boolean;
  };
  meta: DocOpMeta;
}

/**
 * 设置标题级别
 */
export interface SetHeadingLevelOp {
  type: 'SetHeadingLevel';
  payload: {
    nodeId: DocNodeId;
    /** 0 = 普通段落, 1-6 = 标题级别 */
    level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  };
  meta: DocOpMeta;
}

/**
 * 删除节点
 */
export interface DeleteNodeOp {
  type: 'DeleteNode';
  payload: {
    nodeId: DocNodeId;
  };
  meta: DocOpMeta;
}

/**
 * 拆分段落（用于回车）
 * 
 * 在指定位置将 block 拆分为两个
 */
export interface SplitBlockOp {
  type: 'SplitBlock';
  payload: {
    /** 要拆分的节点 ID */
    nodeId: DocNodeId;
    /** 拆分位置偏移 */
    offset: number;
  };
  meta: DocOpMeta;
}

/**
 * 插入软换行（Shift+Enter）
 */
export interface InsertLineBreakOp {
  type: 'InsertLineBreak';
  payload: {
    nodeId: DocNodeId;
    offset: number;
  };
  meta: DocOpMeta;
}

/**
 * 自定义操作（预留扩展）
 */
export interface CustomOp {
  type: 'Custom';
  payload: {
    customType: string;
    data: unknown;
  };
  meta: DocOpMeta;
}

/**
 * 所有 DocOp 的联合类型
 */
export type DocOp =
  | InsertParagraphOp
  | InsertTextOp
  | DeleteRangeOp
  | ToggleBoldOp
  | ToggleItalicOp
  | ToggleUnderlineOp
  | ToggleStrikeOp
  | SetHeadingLevelOp
  | DeleteNodeOp
  | SplitBlockOp
  | InsertLineBreakOp
  | CustomOp;

/**
 * DocOp 类型字符串
 */
export type DocOpType = DocOp['type'];

// ==========================================
// 工具函数
// ==========================================

/**
 * 创建操作元数据
 */
export function createOpMeta(source: DocOpSource = 'user'): DocOpMeta {
  return {
    source,
    timestamp: Date.now(),
    opId: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
}

/**
 * 创建折叠选区（光标）
 */
export function createCollapsedSelection(nodeId: DocNodeId, offset: number): DocSelection {
  return {
    anchorNodeId: nodeId,
    anchorOffset: offset,
    focusNodeId: nodeId,
    focusOffset: offset,
    isCollapsed: true,
  };
}

