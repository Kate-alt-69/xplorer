/**
 * Hook encapsulating file action execution, undo, and batch permission
 * callbacks for the AI chat agent panel.
 *
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import { useCallback } from 'react';
import {
  executeFileAction,
  executeRunCommand,
  captureFileForUndo,
  undoFileAction,
  isAlwaysAllowed,
  isReadOnlyAction,
  isAlwaysAskAction,
  setAlwaysAllowed,
  type PendingFileAction,
  type CommandOutput,
} from './chat-file-actions';
import { type RuntimeChatMessage } from './ChatMessageBubble';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SetMessages = React.Dispatch<React.SetStateAction<RuntimeChatMessage[]>>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useChatActions = (
  messagesRef: React.RefObject<RuntimeChatMessage[]>,
  setMessages: SetMessages,
  scrollToBottom: () => void,
) => {
  // -----------------------------------------------------------------------
  // Status updater (shared by single + batch actions)
  // -----------------------------------------------------------------------

  const updateActionStatus = useCallback(
    (
      messageIndex: number,
      actionId: string,
      status: PendingFileAction['status'],
      extra?: { error?: string; result?: string },
    ) => {
      setMessages((prev) => {
        const updated = [...prev];
        const msg = updated[messageIndex];
        if (msg?.fileActions) {
          msg.fileActions = msg.fileActions.map((a) =>
            a.id === actionId ? { ...a, status, ...extra } : a,
          );
        }
        return updated;
      });
    },
    [setMessages],
  );

  // -----------------------------------------------------------------------
  // Single action handlers
  // -----------------------------------------------------------------------

  /** Update command output on a pending action */
  const updateCommandOutput = useCallback(
    (messageIndex: number, actionId: string, commandOutput: CommandOutput) => {
      setMessages((prev) => {
        const updated = [...prev];
        const msg = updated[messageIndex];
        if (msg?.fileActions) {
          msg.fileActions = msg.fileActions.map((a) =>
            a.id === actionId ? { ...a, commandOutput } : a,
          );
        }
        return updated;
      });
    },
    [setMessages],
  );

  const handleExecuteAction = useCallback(
    async (messageIndex: number, actionId: string) => {
      updateActionStatus(messageIndex, actionId, 'approved');
      const action = messagesRef.current?.[messageIndex]?.fileActions?.find(
        (a) => a.id === actionId,
      );
      if (!action) return;
      try {
        // run_command has special handling for output capture
        if (action.action.action === 'run_command') {
          const cmdOutput = await executeRunCommand(action.action);
          updateCommandOutput(messageIndex, actionId, cmdOutput);
          const resultSummary = [
            cmdOutput.stdout ? `stdout:\n${cmdOutput.stdout}` : '',
            cmdOutput.stderr ? `stderr:\n${cmdOutput.stderr}` : '',
            `exit code: ${cmdOutput.exit_code}`,
            cmdOutput.timed_out ? '(timed out)' : '',
          ]
            .filter(Boolean)
            .join('\n');
          updateActionStatus(messageIndex, actionId, 'success', { result: resultSummary });

          // Inject a hidden context message so the AI sees command output in future turns.
          // isContextInjection hides it from the UI; isCommandResult keeps it in API history.
          const cmdName = action.action.command ?? 'command';
          const cwdStr = action.action.cwd || action.action.path || '';
          const contextContent = `[Command result for \`${cmdName}\` in ${cwdStr}]\nExit code: ${cmdOutput.exit_code}${cmdOutput.stdout ? `\nstdout:\n${cmdOutput.stdout.slice(0, 10000)}` : ''}${cmdOutput.stderr ? `\nstderr:\n${cmdOutput.stderr.slice(0, 5000)}` : ''}${cmdOutput.timed_out ? '\n(command timed out)' : ''}`;
          setMessages((prev) => [
            ...prev,
            {
              role: 'user',
              content: contextContent,
              isContextInjection: true,
              isCommandResult: true,
            },
          ]);

          scrollToBottom();
          return;
        }

        const previousContent = await captureFileForUndo(action.action);
        if (previousContent !== undefined) {
          setMessages((prev) => {
            const updated = [...prev];
            const msg = updated[messageIndex];
            if (msg?.fileActions) {
              msg.fileActions = msg.fileActions.map((a) =>
                a.id === actionId ? { ...a, previousContent } : a,
              );
            }
            return updated;
          });
        }
        const result = await executeFileAction(action.action);
        updateActionStatus(messageIndex, actionId, 'success', { result });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        updateActionStatus(messageIndex, actionId, 'error', { error: errorMsg });
      }
      scrollToBottom();
    },
    [messagesRef, setMessages, scrollToBottom, updateActionStatus, updateCommandOutput],
  );

  const handleUndoAction = useCallback(
    async (messageIndex: number, actionId: string) => {
      const msg = messagesRef.current?.[messageIndex];
      const pa = msg?.fileActions?.find((a) => a.id === actionId);
      if (!pa) return;
      try {
        await undoFileAction(pa);
        setMessages((prev) => {
          const updated = [...prev];
          const m = updated[messageIndex];
          if (m?.fileActions) {
            m.fileActions = m.fileActions.map((a) =>
              a.id === actionId ? { ...a, undone: true } : a,
            );
          }
          return updated;
        });
      } catch (err) {
        console.error('Undo failed:', err);
      }
      scrollToBottom();
    },
    [messagesRef, setMessages, scrollToBottom],
  );

  const handleRejectAction = useCallback(
    (messageIndex: number, actionId: string) => {
      updateActionStatus(messageIndex, actionId, 'rejected');
      scrollToBottom();
    },
    [scrollToBottom, updateActionStatus],
  );

  const handleAlwaysAllow = useCallback(
    async (messageIndex: number, actionId: string) => {
      setAlwaysAllowed(true);
      await handleExecuteAction(messageIndex, actionId);
    },
    [handleExecuteAction],
  );

  // -----------------------------------------------------------------------
  // Batch action handlers
  // -----------------------------------------------------------------------

  const handleBatchAllowAll = useCallback(
    async (messageIndex: number) => {
      const msg = messagesRef.current?.[messageIndex];
      if (!msg?.fileActions) return;
      for (const pa of msg.fileActions) {
        if (pa.status === 'pending' && !isReadOnlyAction(pa.action.action)) {
          updateActionStatus(messageIndex, pa.id, 'approved');
          try {
            const previousContent = await captureFileForUndo(pa.action);
            if (previousContent !== undefined) {
              setMessages((prev) => {
                const updated = [...prev];
                const m = updated[messageIndex];
                if (m?.fileActions) {
                  m.fileActions = m.fileActions.map((a) =>
                    a.id === pa.id ? { ...a, previousContent } : a,
                  );
                }
                return updated;
              });
            }
            const result = await executeFileAction(pa.action);
            updateActionStatus(messageIndex, pa.id, 'success', { result });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            updateActionStatus(messageIndex, pa.id, 'error', { error: errorMsg });
          }
        }
      }
      scrollToBottom();
    },
    [messagesRef, setMessages, scrollToBottom, updateActionStatus],
  );

  const handleBatchRejectAll = useCallback(
    (messageIndex: number) => {
      const msg = messagesRef.current?.[messageIndex];
      if (!msg?.fileActions) return;
      for (const pa of msg.fileActions) {
        if (pa.status === 'pending' && !isReadOnlyAction(pa.action.action)) {
          updateActionStatus(messageIndex, pa.id, 'rejected');
        }
      }
      scrollToBottom();
    },
    [messagesRef, scrollToBottom, updateActionStatus],
  );

  const handleBatchAlwaysAllow = useCallback(
    async (messageIndex: number) => {
      setAlwaysAllowed(true);
      await handleBatchAllowAll(messageIndex);
    },
    [handleBatchAllowAll],
  );

  // -----------------------------------------------------------------------
  // Auto-execute read-only + always-allowed actions
  // -----------------------------------------------------------------------

  const autoExecuteActions = useCallback(
    async (
      msgIndex: number,
      pendingActions: PendingFileAction[],
    ): Promise<{ readOnlyResults: string[]; hasRemainingPending: boolean }> => {
      const readOnlyResults: string[] = [];
      let hasRemainingPending = false;

      for (const pa of pendingActions) {
        // run_command NEVER auto-executes -- always requires explicit user permission
        if (isAlwaysAskAction(pa.action.action)) {
          hasRemainingPending = true;
        } else if (isReadOnlyAction(pa.action.action)) {
          updateActionStatus(msgIndex, pa.id, 'approved');
          try {
            const result = await executeFileAction(pa.action);
            updateActionStatus(msgIndex, pa.id, 'success', { result });
            if (result) readOnlyResults.push(result);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            updateActionStatus(msgIndex, pa.id, 'error', { error: errorMsg });
            readOnlyResults.push(`Error executing ${pa.action.action}: ${errorMsg}`);
          }
        } else if (isAlwaysAllowed()) {
          updateActionStatus(msgIndex, pa.id, 'approved');
          try {
            const result = await executeFileAction(pa.action);
            updateActionStatus(msgIndex, pa.id, 'success', { result });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            updateActionStatus(msgIndex, pa.id, 'error', { error: errorMsg });
          }
        } else {
          hasRemainingPending = true;
        }
      }
      scrollToBottom();
      return { readOnlyResults, hasRemainingPending };
    },
    [scrollToBottom, updateActionStatus],
  );

  return {
    updateActionStatus,
    handleExecuteAction,
    handleUndoAction,
    handleRejectAction,
    handleAlwaysAllow,
    handleBatchAllowAll,
    handleBatchRejectAll,
    handleBatchAlwaysAllow,
    autoExecuteActions,
  };
};
