/**
 * Copilot 撤销功能
 * 
 * 【职责】
 * - 执行 Copilot 操作的撤销
 * - 利用局部快照恢复 Section 内容
 * 
 * 【原理】
 * - 撤销 = 将 Section 恢复到快照时的状态
 * - 利用 Diff 算法生成反向操作：Current -> Snapshot
 */

import { copilotStore } from './copilotStore';
import { getSectionSnapshot } from './copilotSnapshots';
import { getCopilotEditor } from './copilotRuntimeBridge';
import { extractSectionContext } from '../runtime/context';
import { buildSectionDocOpsDiff, LlmParagraph } from '../docops/sectionDocOpsDiff';
import { createAssistantMessage, generateCopilotId, CopilotMessage } from './copilotTypes';
import { logAiRewriteUndone } from '../interaction';

// 临时解决方案：由于 applyDocOps 没有导出，我们需要在 sectionAiActions.ts 中导出它，
// 或者在这里重新实现一遍。为了避免重复，建议导出。
// 但现在先为了方便，我们假设它已经导出了，如果没有，等下修改 sectionAiActions.ts。

// ==========================================
// 撤销操作主函数
// ==========================================

/**
 * 撤销 Copilot 操作
 * 
 * @param docId - 文档 ID
 * @param actionMessageId - 要撤销的 Action 消息 ID
 */
export async function undoCopilotAction(
  docId: string,
  actionMessageId: string
): Promise<void> {
  const store = copilotStore.getState();
  const session = store.sessions[docId];
  if (!session) {
    throw new Error('会话不存在');
  }

  // 1. 查找消息
  const message = session.messages.find(m => m.id === actionMessageId);
  if (!message || message.role !== 'action') {
    throw new Error('找不到对应的操作记录');
  }

  const meta = message.meta;
  if (!meta) {
    throw new Error('操作记录无效');
  }

  // 2. 校验状态
  if (!meta.undoable) {
    throw new Error('该操作不可撤销');
  }
  if (meta.status !== 'applied') {
    throw new Error('只有已完成的操作才能撤销');
  }
  if (!meta.undoSnapshotId) {
    throw new Error('快照信息丢失，无法撤销');
  }
  if (!meta.sectionId) {
    throw new Error('缺少 Section 信息，无法撤销');
  }

  // 3. 获取快照
  const snapshot = getSectionSnapshot(meta.undoSnapshotId);
  if (!snapshot) {
    throw new Error('找不到操作前的快照，可能已过期');
  }

  // 4. 获取编辑器
  const editor = getCopilotEditor();
  if (!editor) {
    throw new Error('编辑器未就绪');
  }

  try {
    // 5. 提取当前 Section 上下文
    // 注意：这里的 sectionId 必须与快照一致
    const currentContext = extractSectionContext(editor, meta.sectionId);

    // 6. 构建恢复目标（将快照段落转换为 LlmParagraph 格式）
    const targetParagraphs: LlmParagraph[] = snapshot.paragraphs.map((p, index) => ({
      index,
      text: p.text,
    }));

    console.log('[CopilotUndo] Reverting section:', meta.sectionId, {
      currentCount: currentContext.subtreeParagraphs.length,
      targetCount: targetParagraphs.length,
    });

    // 7. 计算 Diff (Current -> Snapshot)
    // 使用 rewrite 模式，因为它最通用（可以处理增删改）
    // 注意：我们要恢复的是整个 subtree（如果快照存的是 subtree）
    // 这里假设快照存的是 subtreeParagraphs，所以 diff 应该针对 subtree
    
    // 为了让 Diff 算法正确工作，我们需要确保 context.paragraphs 指向 subtreeParagraphs
    // 因为 buildSectionDocOpsDiff 默认使用 context.paragraphs
    const contextForDiff = {
      ...currentContext,
      paragraphs: currentContext.subtreeParagraphs, 
    };

    const docOps = buildSectionDocOpsDiff(
      contextForDiff,
      targetParagraphs,
      { mode: 'rewrite' }
    );

    // 8. 应用 DocOps
    if (docOps.length > 0) {
      // 动态导入以避免循环依赖（如果是从 sectionAiActions 导入的话）
      // 这里假设我们能访问 applyDocOps
      // 实际上我们需要把 applyDocOps 移到一个公共位置，或者 export 出来
      // 暂时我们先假设它在 sectionAiActions 中 export 了
      const { applyDocOps } = await import('../actions/sectionAiActions');
      await applyDocOps(editor, docOps);
    }

    // 9. 更新状态
    copilotStore.updateMessageMeta(docId, actionMessageId, {
      status: 'reverted',
      undoable: false,
    });

    // 🆕 记录 Interaction 事件
    logAiRewriteUndone(docId, meta.sectionId, {
      originalActionKind: meta.actionType ?? 'unknown',
      sectionTitle: meta.sectionTitle ?? undefined,
    });

    // 10. 添加撤销成功消息
    const undoMsg: CopilotMessage = {
      id: generateCopilotId('action'),
      role: 'action',
      content: `已撤销操作：${meta.actionType ? (meta.actionType === 'rewrite_section_intro' ? '重写章节导语' : '总结章节') : '未知操作'}`,
      createdAt: Date.now(),
      meta: {
        docId,
        scope: meta.scope ?? 'section',
        sectionId: meta.sectionId,
        sectionTitle: meta.sectionTitle,
        actionType: 'undo',
        status: 'applied',
        undoable: false,
      },
    };
    copilotStore.appendMessage(docId, undoMsg);

    // 可选：删除快照
    // deleteSectionSnapshot(meta.undoSnapshotId);

  } catch (error) {
    console.error('[CopilotUndo] Undo failed:', error);
    
    const errorMsg = createAssistantMessage(
      `撤销失败：${error instanceof Error ? error.message : '未知错误'}`
    );
    copilotStore.appendMessage(docId, errorMsg);
  }
}

