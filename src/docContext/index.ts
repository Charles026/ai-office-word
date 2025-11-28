/**
 * DocContext 模块导出
 * 
 * 提供统一的文档上下文构建能力。
 */

// 类型
export * from './docContextTypes';

// 主函数
export {
  buildDocContextEnvelope,
  buildSystemPromptFromEnvelope,
  buildUserPromptFromEnvelope,
  type BuildSystemPromptOptions,
} from './docContextEngine';

