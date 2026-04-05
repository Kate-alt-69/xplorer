import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { AgentService } from '@/lib/agent-service';
import {
  parseFileActions,
  generateActionId,
  basename,
  FILE_OPS_SYSTEM_PROMPT,
  type PendingFileAction,
  type FileAction,
} from './chat-file-actions';
import { useChatActions } from './use-chat-actions';
import {
  type SavedConversation,
  generateConversationId,
  deriveConversationTitle,
  loadChatHistory,
  saveChatHistory,
} from './chat-history';
import { QUICK_ACTIONS, QuickActionsBar, type QuickAction } from './chat-quick-actions';
import { SLASH_COMMANDS, matchSlashCommand, LANG_EXTENSIONS } from './chat-slash-commands';
import {
  MAX_AGENT_ITERATIONS,
  IMAGE_EXTENSIONS,
  type XplorerState,
  type FileContext,
  getXplorerState,
  readFileForAIContext,
  readMultipleFilesForAIContext,
  buildDirectoryContext,
} from './chat-context-helpers';
import { handleTemplateSlashCommand } from './chat-action-templates';
import ChatHistoryView from './ChatHistoryView';
import ChatContextHeader from './ChatContextHeader';
import ChatWelcome from './ChatWelcome';
import ChatFilePathCard from './ChatFilePathCard';
import ChatMessageBubble, { type RuntimeChatMessage } from './ChatMessageBubble';
import ChatSlashInput from './ChatSlashInput';
import { DragOverlay, AttachedFilesBar } from './ChatDropZone';
import { useStreamingText, type StreamingEntry } from './use-streaming-text';
import {
  type WorkspaceContext,
  detectWorkspaceContext,
  buildWorkspacePrompt,
} from './chat-workspace-awareness';
import { useProactiveAgent } from './use-proactive-agent';
import ProactiveSuggestionCard from './ProactiveSuggestionCard';
import { buildMemoryPrompt, parseAndSaveMemories, recordFolderVisit } from './chat-agent-memory';
import { handleSpecialSlashCommand } from './chat-special-commands';
import { compareFiles as performFileComparison, isCompareIntent } from './chat-file-compare';
import { useChatBranching } from './use-chat-branching';
import ChatBranchTabs, { BranchForkIndicator } from './ChatBranchTabs';
import { useTaskPlan, parseTaskPlan } from './use-task-plan';
import TaskPlanCard from './TaskPlanCard';

// ---------------------------------------------------------------------------
// Chat message type alias
// ---------------------------------------------------------------------------

type ChatMessage = RuntimeChatMessage;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const StandaloneChatPanel = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [agentStep, setAgentStep] = useState('');
  const [model, setModel] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  // Chat history state
  const [chatHistory, setChatHistory] = useState<SavedConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Drag & drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<
    Array<{ name: string; path: string; is_dir: boolean }>
  >([]);

  // File context state -- updated from __xplorer_state__
  const [currentPath, setCurrentPath] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<
    Array<{ name: string; path: string; is_dir: boolean }>
  >([]);
  const [editorSelection, setEditorSelection] = useState<XplorerState['editorSelection']>(null);
  const [includeSelection, setIncludeSelection] = useState(true);

  // Workspace awareness state
  const [workspaceCtx, setWorkspaceCtx] = useState<WorkspaceContext | null>(null);

  // Multi-step task plan state
  const taskPlan = useTaskPlan();

  // Proactive agent — watches navigation and offers suggestions
  const {
    suggestion: proactiveSuggestion,
    enabled: proactiveEnabled,
    toggleEnabled: toggleProactive,
    dismiss: dismissProactiveSuggestion,
  } = useProactiveAgent(currentPath, workspaceCtx, messages.length > 0, isLoading);

  // Streaming text entries — built from assistant messages
  const streamingEntries = useMemo<StreamingEntry[]>(
    () =>
      messages
        .map((msg, i) => ({ msg, i }))
        .filter(({ msg }) => msg.role === 'assistant' && !msg.isContextInjection && msg.content)
        .map(({ msg, i }) => ({ id: `msg-${i}`, fullText: msg.content })),
    [messages],
  );
  const {
    getVisibleText,
    isStreaming: isTextStreaming,
    skipAll: skipStreaming,
  } = useStreamingText(streamingEntries);

  // Load chat history on mount
  useEffect(() => {
    setChatHistory(loadChatHistory());
  }, []);

  useEffect(() => {
    AgentService.getSettings()
      .then((s) => {
        if (s.model) setModel(s.model);
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
          if (raw) {
            const s = JSON.parse(raw);
            if (s.aiModel) setModel(s.aiModel);
          }
        } catch {
          /* ignore */
        }
      });
  }, []);

  // Sync file context from __xplorer_state__
  useEffect(() => {
    const syncState = () => {
      const xState = getXplorerState();
      if (!xState) return;
      setCurrentPath(xState.currentPath || '');
      setSelectedFiles(xState.selectedFiles || []);
      setEditorSelection(xState.editorSelection || null);
    };
    syncState();
    const onStateChange = () => syncState();
    window.addEventListener('xplorer-state-change', onStateChange);
    const interval = setInterval(syncState, 1000);
    return () => {
      window.removeEventListener('xplorer-state-change', onStateChange);
      clearInterval(interval);
    };
  }, []);

  // Detect workspace context when currentPath changes
  useEffect(() => {
    if (!currentPath) {
      setWorkspaceCtx(null);
      return;
    }
    let cancelled = false;
    detectWorkspaceContext(currentPath)
      .then((ctx) => {
        if (!cancelled) setWorkspaceCtx(ctx);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceCtx(null);
      });
    // Record folder visit for agent memory
    recordFolderVisit(currentPath);
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  // Auto-save conversation when messages change
  useEffect(() => {
    if (messages.length === 0) return;

    const timer = setTimeout(() => {
      const convId = currentConversationId || generateConversationId();
      if (!currentConversationId) {
        setCurrentConversationId(convId);
      }

      const title = deriveConversationTitle(messages);
      const now = Date.now();

      setChatHistory((prev) => {
        const existingIdx = prev.findIndex((c) => c.id === convId);
        const conv: SavedConversation = {
          id: convId,
          title,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            isContextInjection: m.isContextInjection,
            isCommandResult: m.isCommandResult,
            droppedFiles: m.droppedFiles,
          })),
          createdAt: existingIdx >= 0 ? prev[existingIdx].createdAt : now,
          updatedAt: now,
        };

        let updated: SavedConversation[];
        if (existingIdx >= 0) {
          updated = [...prev];
          updated[existingIdx] = conv;
        } else {
          updated = [conv, ...prev];
        }

        updated.sort((a, b) => b.updatedAt - a.updatedAt);
        saveChatHistory(updated);
        return updated;
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [messages, currentConversationId]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);

  // Auto-scroll during streaming text reveal
  useEffect(() => {
    if (isTextStreaming) {
      const interval = setInterval(scrollToBottom, 100);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isTextStreaming, scrollToBottom]);

  // ---------------------------------------------------------------------------
  // File action handlers (extracted to use-chat-actions.ts)
  // ---------------------------------------------------------------------------

  // Use a ref to always access the latest messages without stale closures
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const {
    handleExecuteAction,
    handleUndoAction,
    handleRejectAction,
    handleAlwaysAllow,
    handleBatchAllowAll,
    handleBatchRejectAll,
    handleBatchAlwaysAllow,
    autoExecuteActions,
  } = useChatActions(messagesRef, setMessages, scrollToBottom);

  // Conversation branching
  const {
    branchState,
    resetBranches,
    handleCreateBranch,
    handleSwitchBranch,
    handleDeleteBranch,
    handleRenameBranch,
    getMessageBranchCount,
    hasBranches: showBranchTabs,
    isOnMainBranch,
  } = useChatBranching({
    messages,
    setMessages,
    chatHistory,
    currentConversationId,
    scrollToBottom,
  });

  // ---------------------------------------------------------------------------
  // Build system prompt with full context
  // ---------------------------------------------------------------------------

  const buildSystemPrompt = useCallback(
    async (
      xState: XplorerState | undefined,
      fileContexts: FileContext[],
      agentLoopContext?: string,
    ): Promise<string> => {
      let systemContent =
        "You are an AI agent inside the Xplorer file manager. You can observe the user's filesystem, understand their context, and take actions to help them manage files.";
      systemContent += `\n\n${FILE_OPS_SYSTEM_PROMPT}`;

      // Inject workspace awareness (project type, git info, directory overview)
      if (workspaceCtx) {
        const workspacePrompt = buildWorkspacePrompt(workspaceCtx);
        if (workspacePrompt) {
          systemContent += `\n\n${workspacePrompt}`;
        }
      }

      // Inject agent memory (per-folder observations + global preferences)
      if (xState?.currentPath) {
        const memoryPrompt = buildMemoryPrompt(xState.currentPath);
        if (memoryPrompt) {
          systemContent += `\n${memoryPrompt}`;
        }
      }

      if (xState?.currentPath) {
        systemContent += `\n\n## Current Context\n[Current directory: ${xState.currentPath}]`;
        const dirListing = await buildDirectoryContext(xState.currentPath);
        systemContent += `\n\n${dirListing}`;
      }

      const selectedFileList = xState?.selectedFiles ?? [];
      if (selectedFileList.length > 0) {
        const fileList = selectedFileList
          .map((f) => `  - ${f.name} (${f.path})${f.is_dir ? ' [directory]' : ''}`)
          .join('\n');
        systemContent += `\n\n[Currently selected files]\n${fileList}`;
      }

      // Count images vs text files in context
      const imageFiles = fileContexts.filter((fc) => fc.imageBase64);
      const textFiles = fileContexts.filter((fc) => !fc.imageBase64 && fc.content);

      if (imageFiles.length > 0) {
        systemContent += `\n\n[Image${imageFiles.length > 1 ? 's' : ''} loaded] ${imageFiles.map((f) => f.name).join(', ')} — image data is included in the user message for vision analysis. Describe what you see in detail when asked.`;
      }

      if (textFiles.length === 1 && textFiles[0].content) {
        systemContent +=
          '\n\n[File content loaded] The user has a file selected and its contents are available below.';
        systemContent += `\n\nFile: ${textFiles[0].name} (${textFiles[0].file_type})\n\`\`\`\n${textFiles[0].content}\n\`\`\``;
      } else if (textFiles.length > 1) {
        systemContent += `\n\n[Multiple file contents loaded] ${textFiles.length} files in context.`;
        for (const fc of textFiles) {
          if (fc.content) {
            systemContent += `\n\n### ${fc.name} (${fc.file_type})\n\`\`\`\n${fc.content}\n\`\`\``;
          }
        }
      }

      // For non-image files with image context but no base64 (too large), add metadata
      const imageMetadataOnly = fileContexts.filter(
        (fc) => !fc.imageBase64 && fc.content?.startsWith('[Image file:'),
      );
      if (imageMetadataOnly.length > 0) {
        for (const fc of imageMetadataOnly) {
          systemContent += `\n\n${fc.content}`;
        }
      }

      if (includeSelection && xState?.editorSelection) {
        const sel = xState.editorSelection;
        systemContent += `\n\n[Selected code in ${sel.filePath} lines ${sel.startLine}-${sel.endLine}]\n\`\`\`\n${sel.text}\n\`\`\``;
      }

      if (agentLoopContext) {
        systemContent += `\n\n## Results from your previous actions\n${agentLoopContext}`;
        systemContent +=
          '\n\nUse these results to continue with the task. If you have all the information you need, proceed with the final actions. Do not repeat actions you already performed.';
      }

      return systemContent;
    },
    [includeSelection, workspaceCtx],
  );

  // ---------------------------------------------------------------------------
  // Agent loop
  // ---------------------------------------------------------------------------

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
          const response = await TauriAPI.chatWithAI(
            model || 'claude-sonnet-4-20250514',
            apiMsgs,
            primaryFileContext,
          );
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
            // Break out of the loop -- plan execution handled separately
            break;
          }

          const { cleanText, actions } = parseFileActions(response);
          // Parse and save memory tags from the response
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
    [model, scrollToBottom, autoExecuteActions, buildSystemPrompt, taskPlan],
  );

  // ---------------------------------------------------------------------------
  // Plan step execution
  // ---------------------------------------------------------------------------

  const executePlanSteps = useCallback(async () => {
    const plan = taskPlan.activePlan;
    if (!plan) return;

    taskPlan.approvePlan();
    setIsLoading(true);
    abortRef.current = false;

    const xState = getXplorerState();

    for (let i = 0; i < plan.steps.length; i++) {
      // Check cancel / abort
      if (taskPlan.isCancelled.current || abortRef.current) break;

      // Check pause -- wait until resumed
      while (taskPlan.isPaused.current) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (taskPlan.isCancelled.current || abortRef.current) break;
      }
      if (taskPlan.isCancelled.current || abortRef.current) break;

      const step = plan.steps[i];
      taskPlan.startStep(i);
      setAgentStep(`Plan step ${i + 1}/${plan.steps.length}: ${step.description}`);

      // Build messages for this step -- include previous step results as context
      const stepPrompt = step.prompt;
      const stepUserMsg: ChatMessage = {
        role: 'user',
        content: stepPrompt,
        isContextInjection: true,
      };

      setMessages((prev) => [...prev, stepUserMsg]);

      // Run the agent loop for this single step
      const historyMsgs = messagesRef.current
        .filter((m) => !m.isContextInjection || m.isCommandResult)
        .map((m) => ({ role: m.role, content: m.content }));
      historyMsgs.push({ role: 'user', content: stepPrompt });

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

        // Auto-execute read-only actions for context gathering
        if (pendingActions.length > 0) {
          const msgIndex = messagesRef.current.length - 1;
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

    setIsLoading(false);
    setAgentStep('');
    scrollToBottom();
  }, [taskPlan, model, scrollToBottom, autoExecuteActions, buildSystemPrompt]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Chat export handler
  // ---------------------------------------------------------------------------

  const exportChatAsMarkdown = useCallback(() => {
    if (messages.length === 0) return;
    const lines: string[] = ['# Chat Export\n'];
    for (const msg of messages) {
      if (msg.isContextInjection) continue;
      const role = msg.role === 'user' ? 'You' : 'AI';
      lines.push(`## ${role}\n`);
      lines.push(msg.content);
      lines.push('');
    }
    const markdown = lines.join('\n');
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Save code as file handler
  // ---------------------------------------------------------------------------

  const handleSaveCodeAsFile = useCallback(async (code: string, language: string) => {
    const ext = (LANG_EXTENSIONS[language.toLowerCase()] ?? language) || 'txt';
    const xState = getXplorerState();
    const dir = xState?.currentPath ?? '';
    if (!dir) {
      console.warn('No current directory to save file in');
      return;
    }
    const fileName = `untitled.${ext}`;
    const filePath = `${dir}/${fileName}`;
    try {
      await TauriAPI.createFileWithContent(filePath, code);
      // Add a system message to confirm
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Saved code to \`${filePath}\`` },
      ]);
    } catch (err) {
      console.error('Failed to save code as file:', err);
    }
  }, []);

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading) return;

      // Handle special slash commands
      const slashMatch = matchSlashCommand(text);
      if (slashMatch) {
        if (slashMatch.prompt === '__EXPORT_CHAT__') {
          exportChatAsMarkdown();
          setInput('');
          return;
        }
        if (slashMatch.prompt === '__SHOW_HELP__') {
          const helpLines = SLASH_COMMANDS.map((cmd) => `\`${cmd.name}\` -- ${cmd.description}`);
          const helpText = `Available commands:\n${helpLines.join('\n')}\n\nKeyboard shortcuts:\n\`Ctrl+L\` -- Clear chat\n\`Up Arrow\` -- Recall last message\n\`Escape\` -- Cancel agent / close`;
          setMessages((prev) => [
            ...prev,
            { role: 'user', content: text },
            { role: 'assistant', content: helpText },
          ]);
          setInput('');
          return;
        }
        // Handle special commands (/memory, /forget, /compare)
        {
          const specialResult = handleSpecialSlashCommand(slashMatch.prompt, currentPath);
          if (specialResult) {
            if (specialResult.type === 'redirect' && specialResult.redirectPrompt) {
              setInput('');
              return sendMessage(specialResult.redirectPrompt);
            }
            setMessages((prev) => [
              ...prev,
              { role: 'user', content: text },
              { role: 'assistant', content: specialResult.responseText ?? '' },
            ]);
            setInput('');
            return;
          }
        }
        // Handle template slash commands
        {
          const lastActionMsg = [...messagesRef.current]
            .reverse()
            .find(
              (m) => m.role === 'assistant' && m.fileActions?.some((a) => a.status === 'success'),
            );
          const lastSuccessActions =
            lastActionMsg?.fileActions
              ?.filter((a) => a.status === 'success')
              .map((a) => a.action) ?? [];
          const triggerIdx = lastActionMsg ? messagesRef.current.indexOf(lastActionMsg) : -1;
          const triggerPrompt =
            triggerIdx > 0
              ? (messagesRef.current
                  .slice(0, triggerIdx)
                  .reverse()
                  .find((m) => m.role === 'user' && !m.isContextInjection)?.content ?? '')
              : '';
          const tmplResult = handleTemplateSlashCommand(
            slashMatch.prompt,
            lastSuccessActions,
            triggerPrompt,
          );
          if (tmplResult) {
            if (tmplResult.type === 'redirect' && tmplResult.redirectPrompt) {
              setInput('');
              return sendMessage(tmplResult.redirectPrompt);
            }
            setMessages((prev) => [
              ...prev,
              { role: 'user', content: text },
              { role: 'assistant', content: tmplResult.responseText ?? '' },
            ]);
            setInput('');
            return;
          }
        }
        // For other slash commands, use the generated prompt
        return sendMessage(slashMatch.prompt);
      }

      const xState = getXplorerState();

      // Dropped files take priority over xplorer selection
      const filesToRead =
        droppedFiles.length > 0 ? [...droppedFiles] : [...(xState?.selectedFiles ?? [])];

      // Pre-build image contexts for the user message thumbnail strip
      const imageContextsForMsg: Array<{ name: string; path: string; dataUrl: string }> = [];

      const userMsg: ChatMessage = {
        role: 'user',
        content: text,
        droppedFiles:
          droppedFiles.length > 0
            ? droppedFiles.map((f) => ({ name: f.name, path: f.path }))
            : undefined,
      };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput('');
      setIsLoading(true);
      abortRef.current = false;
      scrollToBottom();

      setDroppedFiles([]);

      let fileContexts: FileContext[] = [];
      let compareContext: string | null = null;

      if (filesToRead.length > 0) {
        setIsReadingFile(true);
        try {
          // Detect file comparison intent when exactly 2 files
          if (
            filesToRead.length === 2 &&
            !filesToRead[0].is_dir &&
            !filesToRead[1].is_dir &&
            isCompareIntent(text, 2)
          ) {
            const compResult = await performFileComparison(
              filesToRead[0].path,
              filesToRead[1].path,
            );
            if (compResult.success) {
              compareContext = compResult.contextForAI;
            }
          }

          fileContexts =
            filesToRead.length === 1 && !filesToRead[0].is_dir
              ? [await readFileForAIContext(filesToRead[0])]
              : await readMultipleFilesForAIContext(filesToRead);

          // Build image thumbnail data for the user message
          for (const fc of fileContexts) {
            if (fc.imageBase64 && fc.imageMimeType) {
              imageContextsForMsg.push({
                name: fc.name,
                path: fc.path,
                dataUrl: `data:${fc.imageMimeType};base64,${fc.imageBase64}`,
              });
            }
          }

          // Attach image contexts to the user message if any
          if (imageContextsForMsg.length > 0) {
            const updatedUserMsg: ChatMessage = {
              ...userMsg,
              imageContexts: imageContextsForMsg,
            };
            const updatedMessages = [...messages, updatedUserMsg];
            setMessages(updatedMessages);
            newMessages[newMessages.length - 1] = updatedUserMsg;
          }
        } catch {
          // Silently fall back
        } finally {
          setIsReadingFile(false);
        }
      }

      const historyMsgs = newMessages
        .filter((m) => !m.isContextInjection || m.isCommandResult)
        .map((m) => ({ role: m.role, content: m.content }));

      // Inject file comparison context if detected
      if (compareContext) {
        historyMsgs.push({
          role: 'user',
          content: `[File comparison data]\n${compareContext}`,
        });
      }

      await runAgentLoop(historyMsgs, xState, fileContexts, newMessages);
      setIsLoading(false);
      scrollToBottom();
    },

    [input, isLoading, messages, droppedFiles, scrollToBottom, runAgentLoop, exportChatAsMarkdown],
  );

  const stopAgent = useCallback(() => {
    abortRef.current = true;
    setIsLoading(false);
    setAgentStep('');
    taskPlan.cancelPlan();
  }, [taskPlan]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setAgentStep('');
    setDroppedFiles([]);
    setCurrentConversationId(null);
    resetBranches();
    taskPlan.setPlan(null);
    abortRef.current = false;
  }, [resetBranches, taskPlan]);

  const loadConversation = useCallback((conv: SavedConversation) => {
    setMessages(conv.messages as ChatMessage[]);
    setCurrentConversationId(conv.id);
    setShowHistory(false);
    setDroppedFiles([]);
  }, []);

  const deleteConversation = useCallback(
    (convId: string) => {
      setChatHistory((prev) => {
        const updated = prev.filter((c) => c.id !== convId);
        saveChatHistory(updated);
        return updated;
      });
      if (currentConversationId === convId) clearChat();
    },
    [currentConversationId, clearChat],
  );

  // ---------------------------------------------------------------------------
  // File path click handler — navigate to file in Xplorer
  // ---------------------------------------------------------------------------

  const navigateToFile = useCallback((filePath: string) => {
    const xState = (
      window as unknown as { __xplorer_state__?: { navigateTo: (p: string) => void } }
    ).__xplorer_state__;
    if (!xState?.navigateTo) return;
    // Navigate to the parent directory so the file is visible
    const parts = filePath.split(/[/\\]/);
    parts.pop();
    const parentDir = parts.join('/') || '/';
    xState.navigateTo(parentDir);
  }, []);

  const renderFilePath = useCallback(
    (filePath: string) => <ChatFilePathCard filePath={filePath} onClick={navigateToFile} />,
    [navigateToFile],
  );

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (Ctrl+L clear, Escape cancel/close)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+L or Cmd+L — clear chat
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        clearChat();
        return;
      }
      // Escape — stop agent loop if loading, otherwise blur input
      if (e.key === 'Escape') {
        if (isLoading) {
          e.preventDefault();
          stopAgent();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearChat, isLoading, stopAgent]);

  // ---------------------------------------------------------------------------
  // Drag & drop handlers
  // ---------------------------------------------------------------------------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    let files: Array<{ name: string; path: string; is_dir: boolean }> = [];

    // Xplorer internal drag format
    const xplorerData = e.dataTransfer.getData('application/xplorer-files');
    if (xplorerData) {
      try {
        const parsed: unknown = JSON.parse(xplorerData);
        if (Array.isArray(parsed)) {
          files = parsed.map((f: { name?: string; path?: string; is_dir?: boolean }) => ({
            name: String(f.name ?? basename(String(f.path ?? ''))),
            path: String(f.path ?? ''),
            is_dir: Boolean(f.is_dir),
          }));
        }
      } catch {
        // Invalid JSON
      }
    }

    // Fallback: text/plain with file paths
    if (files.length === 0) {
      const textData = e.dataTransfer.getData('text/plain');
      if (textData) {
        const paths = textData
          .split('\n')
          .map((p) => p.trim())
          .filter((p) => p.startsWith('/') || /^[A-Z]:\\/i.test(p));
        if (paths.length > 0) {
          files = paths.map((p) => ({ name: basename(p), path: p, is_dir: false }));
        }
      }
    }

    // Fallback: browser File API (OS file drag into Tauri)
    if (files.length === 0 && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const filePath = (file as unknown as { path?: string }).path ?? file.name;
        files.push({ name: file.name, path: filePath, is_dir: false });
      }
    }

    if (files.length > 0) {
      setDroppedFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        const newFiles = files.filter((f) => !existing.has(f.path));
        return [...prev, ...newFiles];
      });
    }
  }, []);

  const removeDroppedFile = useCallback((path: string) => {
    setDroppedFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  // ---------------------------------------------------------------------------
  // Proactive suggestion action
  // ---------------------------------------------------------------------------

  const handleProactiveSuggestionAction = useCallback(
    (prompt: string) => {
      dismissProactiveSuggestion();
      sendMessage(prompt);
    },
    [dismissProactiveSuggestion, sendMessage],
  );

  // ---------------------------------------------------------------------------
  // Quick actions
  // ---------------------------------------------------------------------------

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      if (isLoading) return;
      sendMessage(action.prompt);
    },
    [isLoading, sendMessage],
  );

  const hasSelectedImages = useMemo(
    () =>
      selectedFiles.some((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        return IMAGE_EXTENSIONS.has(ext);
      }),
    [selectedFiles],
  );

  const availableQuickActions = useMemo(
    () =>
      QUICK_ACTIONS.filter((action) => {
        if (action.requiresSelection && selectedFiles.length === 0) return false;
        if (action.requiresDirectory && !currentPath) return false;
        if (action.requiresImage && !hasSelectedImages) return false;
        return true;
      }),
    [selectedFiles.length, currentPath, hasSelectedImages],
  );

  // ---------------------------------------------------------------------------
  // Render: History view
  // ---------------------------------------------------------------------------

  if (showHistory) {
    return (
      <ChatHistoryView
        chatHistory={chatHistory}
        currentConversationId={currentConversationId}
        onBack={() => setShowHistory(false)}
        onLoad={loadConversation}
        onDelete={deleteConversation}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Main chat view
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && <DragOverlay />}

      <ChatContextHeader
        currentPath={currentPath}
        selectedFiles={selectedFiles}
        editorSelection={editorSelection}
        includeSelection={includeSelection}
        onToggleSelection={() => setIncludeSelection((v) => !v)}
      />

      {/* Branch tabs */}
      {showBranchTabs && (
        <ChatBranchTabs
          branchState={branchState}
          onSwitchBranch={handleSwitchBranch}
          onDeleteBranch={handleDeleteBranch}
          onRenameBranch={handleRenameBranch}
        />
      )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        style={{ flex: 1, overflowY: 'auto', padding: '8px' }}
      >
        {messages.length === 0 && !isLoading && (
          <ChatWelcome
            currentPath={currentPath}
            selectedFileCount={selectedFiles.length}
            onSendMessage={sendMessage}
            isLoading={isLoading}
          />
        )}

        {/* Proactive suggestion card — shown above messages when available */}
        {proactiveSuggestion && (
          <ProactiveSuggestionCard
            suggestion={proactiveSuggestion}
            onAction={handleProactiveSuggestionAction}
            onDismiss={dismissProactiveSuggestion}
            proactiveEnabled={proactiveEnabled}
            onToggleProactive={toggleProactive}
          />
        )}

        {messages.map((msg, i) => {
          const displayText =
            msg.role === 'assistant' && !msg.isContextInjection
              ? getVisibleText(`msg-${i}`) || msg.content
              : msg.content;

          const branchCount = getMessageBranchCount(i);

          return (
            <div key={`msg-${i}`}>
              <ChatMessageBubble
                message={msg}
                index={i}
                displayText={displayText}
                onExecuteAction={handleExecuteAction}
                onRejectAction={handleRejectAction}
                onAlwaysAllowAction={handleAlwaysAllow}
                onUndoAction={handleUndoAction}
                onBatchAllowAll={handleBatchAllowAll}
                onBatchRejectAll={handleBatchRejectAll}
                onBatchAlwaysAllow={handleBatchAlwaysAllow}
                onSaveCodeAsFile={handleSaveCodeAsFile}
                renderFilePath={renderFilePath}
              />
              {/* Show branch fork indicator on assistant messages (main thread only) */}
              {msg.role === 'assistant' &&
                !msg.isContextInjection &&
                isOnMainBranch &&
                !isLoading && (
                  <BranchForkIndicator
                    branchCount={branchCount}
                    onBranch={() => handleCreateBranch(i)}
                  />
                )}
            </div>
          );
        })}

        {/* Task Plan Card */}
        {taskPlan.activePlan && (
          <TaskPlanCard
            plan={taskPlan.activePlan}
            onApprove={executePlanSteps}
            onEdit={taskPlan.editPlan}
            onCancel={taskPlan.cancelPlan}
            onPause={taskPlan.pausePlan}
            onResume={taskPlan.resumePlan}
          />
        )}

        {isLoading && (
          <div
            style={{
              padding: '8px',
              color: 'var(--xp-text-muted)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            {isReadingFile ? 'Reading file...' : agentStep || 'Thinking...'}
            <button
              onClick={stopAgent}
              title="Stop agent"
              aria-label="Stop AI agent"
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: '1px solid var(--xp-border)',
                borderRadius: '4px',
                padding: '2px 8px',
                color: 'var(--xp-text-muted)',
                cursor: 'pointer',
                fontSize: '11px',
              }}
            >
              Stop
            </button>
          </div>
        )}

        {/* Streaming text indicator (skip button) */}
        {!isLoading && isTextStreaming && (
          <div
            style={{
              padding: '4px 8px',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              onClick={skipStreaming}
              aria-label="Skip text animation and show all"
              style={{
                background: 'none',
                border: '1px solid var(--xp-border)',
                borderRadius: '4px',
                padding: '2px 8px',
                color: 'var(--xp-text-muted)',
                cursor: 'pointer',
                fontSize: '11px',
              }}
            >
              Show all
            </button>
          </div>
        )}
      </div>

      <AttachedFilesBar
        files={droppedFiles}
        onRemove={removeDroppedFile}
        onClearAll={() => setDroppedFiles([])}
      />

      {/* Quick actions bar (only on empty chat) */}
      {messages.length === 0 && (
        <QuickActionsBar
          actions={availableQuickActions}
          isLoading={isLoading}
          onAction={handleQuickAction}
        />
      )}

      <ChatSlashInput
        input={input}
        onInputChange={setInput}
        onSend={() => sendMessage()}
        onShowHistory={() => setShowHistory(true)}
        onClearChat={clearChat}
        isLoading={isLoading}
        hasMessages={messages.length > 0}
        droppedFileCount={droppedFiles.length}
      />
    </div>
  );
};

export default StandaloneChatPanel;
