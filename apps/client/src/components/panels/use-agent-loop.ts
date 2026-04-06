/**
 * Hook encapsulating the agent loop and task plan execution logic.
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import { useCallback } from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import {
  parseFileActions,
  generateActionId,
  type PendingFileAction,
  type FileAction,
} from './chat-file-actions';
import {
  MAX_AGENT_ITERATIONS,
  type XplorerState,
  type FileContext,
  getXplorerState,
} from './chat-context-helpers';
import { parseAndSaveMemories } from './chat-agent-memory';
import { parseTaskPlan, useTaskPlan } from './use-task-plan';
import { startSession, endSession, formatSessionSummary } from './chat-audit-log';
import type { RuntimeChatMessage } from './ChatMessageBubble';

/** Inferred return type of the useTaskPlan hook */
type UseTaskPlanReturn = ReturnType<typeof useTaskPlan>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = RuntimeChatMessage;

interface AgentLoopDeps {
  model: string;
  abortRef: React.MutableRefObject<boolean>;
  messagesRef: React.RefObject<ChatMessage[]>;
  taskPlan: UseTaskPlanReturn;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsLoading: (v: boolean) => void;
  setAgentStep: (v: string) => void;
  scrollToBottom: () => void;
  autoExecuteActions: (
    msgIndex: number,
    pendingActions: PendingFileAction[],
  ) => Promise<{ readOnlyResults: string[]; hasRemainingPending: boolean }>;
  buildSystemPrompt: (
    xState: XplorerState | undefined,
    fileContexts: FileContext[],
    agentLoopContext?: string,
  ) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useAgentLoop = (deps: AgentLoopDeps) => {
  const {
    model,
    abortRef,
    messagesRef,
    taskPlan,
    setMessages,
    setIsLoading,
    setAgentStep,
    scrollToBottom,
    autoExecuteActions,
    buildSystemPrompt,
  } = deps;

  /** Max time (ms) for a single agent iteration before we bail out. */
  const ITERATION_TIMEOUT_MS = 60_000;

  // -----------------------------------------------------------------------
  // Core agent loop
  // -----------------------------------------------------------------------

  const runAgentLoop = useCallback(
    async (
      initialMessages: Array<{ role: string; content: string }>,
      xState: XplorerState | undefined,
      fileContexts: FileContext[],
      currentMsgs: ChatMessage[],
    ) => {
      let loopMessages = [...initialMessages];
      let iteration = 0;
      let messagesSnapshot = [...currentMsgs];
      const fc = fileContexts.length > 0 ? fileContexts[0] : null;
      const primaryFileContext = fc
        ? {
            name: fc.name,
            path: fc.path,
            file_type: fc.file_type,
            content: fc.content,
            image_base64: fc.imageBase64,
            image_mime_type: fc.imageMimeType,
          }
        : null;

      while (iteration < MAX_AGENT_ITERATIONS && !abortRef.current) {
        iteration++;

        const agentLoopContext =
          iteration > 1
            ? loopMessages
                .filter((m) => m.role === 'tool_result')
                .map((m) => m.content)
                .join('\n\n')
            : undefined;

        const systemContent = await buildSystemPrompt(xState, fileContexts, agentLoopContext);
        const apiMsgs = [
          { role: 'system', content: systemContent },
          ...loopMessages.filter((m) => m.role !== 'tool_result' && m.role !== 'system'),
        ];

        if (iteration > 1) setAgentStep(`Agent iteration ${iteration}...`);

        try {
          const response = await Promise.race([
            TauriAPI.chatWithAI(model || 'claude-sonnet-4-20250514', apiMsgs, primaryFileContext),
            new Promise<never>((_resolve, reject) =>
              setTimeout(
                () => reject(new Error('Agent iteration timed out (60s)')),
                ITERATION_TIMEOUT_MS,
              ),
            ),
          ]);
          if (abortRef.current) break;

          // Check for a task_plan block before parsing file actions
          const planResult = parseTaskPlan(response);
          if (planResult) {
            const memoryCleanText = parseAndSaveMemories(
              planResult.cleanText,
              xState?.currentPath ?? '',
            );
            if (memoryCleanText) {
              messagesSnapshot = [
                ...messagesSnapshot,
                { role: 'assistant', content: memoryCleanText },
              ];
              setMessages(messagesSnapshot);
            }
            taskPlan.setPlan(planResult.plan);
            scrollToBottom();
            break;
          }

          const { cleanText, actions } = parseFileActions(response);
          const memoryCleanText = parseAndSaveMemories(
            cleanText || (actions.length > 0 ? '' : response),
            xState?.currentPath ?? '',
          );
          const pendingActions: PendingFileAction[] = actions.map((a: FileAction) => ({
            id: generateActionId(),
            action: a,
            status: 'pending' as const,
          }));

          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: memoryCleanText,
            fileActions: pendingActions.length > 0 ? pendingActions : undefined,
          };

          messagesSnapshot = [...messagesSnapshot, assistantMsg];
          setMessages(messagesSnapshot);
          scrollToBottom();

          if (pendingActions.length === 0) break;

          const msgIndex = messagesSnapshot.length - 1;
          const { readOnlyResults, hasRemainingPending } = await autoExecuteActions(
            msgIndex,
            pendingActions,
          );

          if (readOnlyResults.length > 0 && !hasRemainingPending) {
            loopMessages = [
              ...loopMessages,
              { role: 'assistant', content: response },
              { role: 'tool_result', content: readOnlyResults.join('\n\n') },
            ];
          } else {
            break;
          }
        } catch (err) {
          messagesSnapshot = [...messagesSnapshot, { role: 'assistant', content: `Error: ${err}` }];
          setMessages(messagesSnapshot);
          break;
        }
      }
      setAgentStep('');
    },
    [
      model,
      abortRef,
      scrollToBottom,
      autoExecuteActions,
      buildSystemPrompt,
      taskPlan,
      setMessages,
      setAgentStep,
    ],
  );

  // -----------------------------------------------------------------------
  // Plan step execution
  // -----------------------------------------------------------------------

  const executePlanSteps = useCallback(async () => {
    const plan = taskPlan.activePlan;
    if (!plan) return;

    taskPlan.approvePlan();
    setIsLoading(true);
    abortRef.current = false;

    startSession();
    const xState = getXplorerState();

    for (let i = 0; i < plan.steps.length; i++) {
      if (taskPlan.isCancelled.current || abortRef.current) break;

      // Wait while paused
      while (taskPlan.isPaused.current) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (taskPlan.isCancelled.current || abortRef.current) break;
      }
      if (taskPlan.isCancelled.current || abortRef.current) break;

      const step = plan.steps[i];
      taskPlan.startStep(i);
      setAgentStep(`Plan step ${i + 1}/${plan.steps.length}: ${step.description}`);

      const stepUserMsg: ChatMessage = {
        role: 'user',
        content: step.prompt,
        isContextInjection: true,
      };
      setMessages((prev) => [...prev, stepUserMsg]);

      const historyMsgs = (messagesRef.current ?? [])
        .filter((m) => !m.isContextInjection || m.isCommandResult)
        .map((m) => ({ role: m.role, content: m.content }));
      historyMsgs.push({ role: 'user', content: step.prompt });

      try {
        const systemContent = await buildSystemPrompt(xState, []);
        const apiMsgs = [
          { role: 'system', content: systemContent },
          ...historyMsgs.filter((m) => m.role !== 'system'),
        ];

        const response = await TauriAPI.chatWithAI(
          model || 'claude-sonnet-4-20250514',
          apiMsgs,
          null,
        );

        if (taskPlan.isCancelled.current || abortRef.current) break;

        const { cleanText, actions } = parseFileActions(response);
        const memoryCleanText = parseAndSaveMemories(
          cleanText || (actions.length > 0 ? '' : response),
          xState?.currentPath ?? '',
        );

        const pendingActions: PendingFileAction[] = actions.map((a: FileAction) => ({
          id: generateActionId(),
          action: a,
          status: 'pending' as const,
        }));

        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: memoryCleanText,
          fileActions: pendingActions.length > 0 ? pendingActions : undefined,
        };

        setMessages((prev) => [...prev, assistantMsg]);
        scrollToBottom();

        if (pendingActions.length > 0) {
          const msgIndex = (messagesRef.current ?? []).length - 1;
          await autoExecuteActions(msgIndex, pendingActions);
        }

        const resultSummary =
          memoryCleanText.length > 100 ? `${memoryCleanText.slice(0, 100)}...` : memoryCleanText;
        taskPlan.completeStep(i, resultSummary || 'Done');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        taskPlan.failStep(i, errorMsg);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Step ${i + 1} failed: ${errorMsg}` },
        ]);
        break;
      }

      scrollToBottom();
    }

    const planSessionSummary = endSession();
    if (planSessionSummary && planSessionSummary.totalActions > 0) {
      const summaryText = formatSessionSummary(planSessionSummary);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: summaryText, isContextInjection: true },
      ]);
    }

    setIsLoading(false);
    setAgentStep('');
    scrollToBottom();
  }, [
    taskPlan,
    model,
    abortRef,
    messagesRef,
    scrollToBottom,
    autoExecuteActions,
    buildSystemPrompt,
    setMessages,
    setIsLoading,
    setAgentStep,
  ]);

  return { runAgentLoop, executePlanSteps };
};
