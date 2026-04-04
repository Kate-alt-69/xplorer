import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Send, FileText, Loader2, RotateCcw, History } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { AgentService } from '@/lib/agent-service';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import {
  FileActionCard,
  BatchActionCard,
  parseFileActions,
  executeFileAction,
  captureFileForUndo,
  undoFileAction,
  generateActionId,
  isAlwaysAllowed,
  setAlwaysAllowed,
  isReadOnlyAction,
  basename,
  FILE_OPS_SYSTEM_PROMPT,
  type PendingFileAction,
  type FileAction,
} from './chat-file-actions';
import {
  type SavedConversation,
  type ChatMessage as SavedChatMessage,
  generateConversationId,
  deriveConversationTitle,
  loadChatHistory,
  saveChatHistory,
} from './chat-history';
import { QUICK_ACTIONS, QuickActionsBar, type QuickAction } from './chat-quick-actions';
import {
  SLASH_COMMANDS,
  matchSlashCommand,
  LANG_EXTENSIONS,
  type SlashCommand,
} from './chat-slash-commands';
import {
  MAX_AGENT_ITERATIONS,
  type XplorerState,
  type FileContext,
  getXplorerState,
  readFileForAIContext,
  readMultipleFilesForAIContext,
  buildDirectoryContext,
} from './chat-context-helpers';
import ChatHistoryView from './ChatHistoryView';
import ChatContextHeader from './ChatContextHeader';
import ChatWelcome from './ChatWelcome';
import { DragOverlay, AttachedFilesBar } from './ChatDropZone';
import { useStreamingText, type StreamingEntry } from './use-streaming-text';
import {
  type WorkspaceContext,
  detectWorkspaceContext,
  buildWorkspacePrompt,
} from './chat-workspace-awareness';

// ---------------------------------------------------------------------------
// Chat message type (extends the saved version with runtime-only fields)
// ---------------------------------------------------------------------------

interface ChatMessage extends SavedChatMessage {
  /** Pending file actions attached to this message (assistant only) */
  fileActions?: PendingFileAction[];
}

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
  const [slashSuggestions, setSlashSuggestions] = useState<SlashCommand[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const inputHistoryRef = useRef<string[]>([]);
  const inputHistoryIndexRef = useRef(-1);

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
  // File action handlers
  // ---------------------------------------------------------------------------

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
    [],
  );

  const handleExecuteAction = useCallback(
    async (messageIndex: number, actionId: string) => {
      updateActionStatus(messageIndex, actionId, 'approved');
      const action = messages[messageIndex]?.fileActions?.find((a) => a.id === actionId);
      if (!action) return;
      try {
        // Capture previous content before editing for undo support
        const previousContent = await captureFileForUndo(action.action);
        if (previousContent !== undefined) {
          // Store the previous content on the action for undo
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
    [messages, scrollToBottom, updateActionStatus],
  );

  const handleUndoAction = useCallback(
    async (messageIndex: number, actionId: string) => {
      const msg = messages[messageIndex];
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
    [messages, scrollToBottom],
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

  const handleBatchAllowAll = useCallback(
    async (messageIndex: number) => {
      const msg = messages[messageIndex];
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
    [messages, scrollToBottom, updateActionStatus],
  );

  const handleBatchRejectAll = useCallback(
    (messageIndex: number) => {
      const msg = messages[messageIndex];
      if (!msg?.fileActions) return;
      for (const pa of msg.fileActions) {
        if (pa.status === 'pending' && !isReadOnlyAction(pa.action.action)) {
          updateActionStatus(messageIndex, pa.id, 'rejected');
        }
      }
      scrollToBottom();
    },
    [messages, scrollToBottom, updateActionStatus],
  );

  const handleBatchAlwaysAllow = useCallback(
    async (messageIndex: number) => {
      setAlwaysAllowed(true);
      await handleBatchAllowAll(messageIndex);
    },
    [handleBatchAllowAll],
  );

  // ---------------------------------------------------------------------------
  // Auto-execute read-only actions + "always allow" mutating actions
  // ---------------------------------------------------------------------------

  const autoExecuteActions = useCallback(
    async (
      msgIndex: number,
      pendingActions: PendingFileAction[],
    ): Promise<{ readOnlyResults: string[]; hasRemainingPending: boolean }> => {
      const readOnlyResults: string[] = [];
      let hasRemainingPending = false;

      for (const pa of pendingActions) {
        if (isReadOnlyAction(pa.action.action)) {
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

      if (fileContexts.length === 1 && fileContexts[0].content) {
        systemContent +=
          '\n\n[File content loaded] The user has a file selected and its contents are available below.';
        systemContent += `\n\nFile: ${fileContexts[0].name} (${fileContexts[0].file_type})\n\`\`\`\n${fileContexts[0].content}\n\`\`\``;
      } else if (fileContexts.length > 1) {
        systemContent += `\n\n[Multiple file contents loaded] ${fileContexts.length} files in context.`;
        for (const fc of fileContexts) {
          if (fc.content) {
            systemContent += `\n\n### ${fc.name} (${fc.file_type})\n\`\`\`\n${fc.content}\n\`\`\``;
          }
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
      const primaryFileContext = fileContexts.length > 0 ? fileContexts[0] : null;

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

          const { cleanText, actions } = parseFileActions(response);
          const pendingActions: PendingFileAction[] = actions.map((a: FileAction) => ({
            id: generateActionId(),
            action: a,
            status: 'pending' as const,
          }));

          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: cleanText || (actions.length > 0 ? '' : response),
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
    [model, scrollToBottom, autoExecuteActions, buildSystemPrompt],
  );

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

      // Push to input history
      inputHistoryRef.current = [text, ...inputHistoryRef.current.slice(0, 49)];
      inputHistoryIndexRef.current = -1;
      setSlashSuggestions([]);

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
        // For other slash commands, use the generated prompt
        return sendMessage(slashMatch.prompt);
      }

      const xState = getXplorerState();
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

      // Dropped files take priority over xplorer selection
      const filesToRead =
        droppedFiles.length > 0 ? [...droppedFiles] : [...(xState?.selectedFiles ?? [])];
      setDroppedFiles([]);

      let fileContexts: Array<{
        name: string;
        path: string;
        file_type: string;
        content?: string;
      }> = [];

      if (filesToRead.length > 0) {
        setIsReadingFile(true);
        try {
          fileContexts =
            filesToRead.length === 1 && !filesToRead[0].is_dir
              ? [await readFileForAIContext(filesToRead[0])]
              : await readMultipleFilesForAIContext(filesToRead);
        } catch {
          // Silently fall back
        } finally {
          setIsReadingFile(false);
        }
      }

      const historyMsgs = newMessages
        .filter((m) => !m.isContextInjection)
        .map((m) => ({ role: m.role, content: m.content }));

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
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setAgentStep('');
    setDroppedFiles([]);
    setCurrentConversationId(null);
    abortRef.current = false;
  }, []);

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

  // Slash command suggestions
  useEffect(() => {
    if (input.startsWith('/') && input.length > 0) {
      const trimmed = input.trim().toLowerCase();
      const matches = SLASH_COMMANDS.filter(
        (cmd) => cmd.name.startsWith(trimmed) || cmd.name.startsWith(trimmed.split(' ')[0]),
      );
      setSlashSuggestions(matches.length > 0 && trimmed !== matches[0]?.name ? matches : []);
    } else {
      setSlashSuggestions([]);
    }
  }, [input]);

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
  // Quick actions
  // ---------------------------------------------------------------------------

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      if (isLoading) return;
      sendMessage(action.prompt);
    },
    [isLoading, sendMessage],
  );

  const availableQuickActions = useMemo(
    () =>
      QUICK_ACTIONS.filter((action) => {
        if (action.requiresSelection && selectedFiles.length === 0) return false;
        if (action.requiresDirectory && !currentPath) return false;
        return true;
      }),
    [selectedFiles.length, currentPath],
  );

  const getPendingMutatingCount = (msg: ChatMessage): number =>
    msg.fileActions?.filter((a) => a.status === 'pending' && !isReadOnlyAction(a.action.action))
      .length ?? 0;

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

      {/* Messages area */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {messages.length === 0 && !isLoading && (
          <ChatWelcome
            currentPath={currentPath}
            selectedFileCount={selectedFiles.length}
            onSendMessage={sendMessage}
            isLoading={isLoading}
          />
        )}

        {messages.map((msg, i) => {
          if (msg.isContextInjection) return null;
          const pendingMutatingCount = getPendingMutatingCount(msg);
          const showBatchCard = pendingMutatingCount > 1;

          return (
            <div key={i} style={{ marginBottom: '12px' }}>
              {/* Dropped files indicator on user messages */}
              {msg.droppedFiles && msg.droppedFiles.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    marginBottom: '4px',
                    marginLeft: '20%',
                    justifyContent: 'flex-end',
                  }}
                >
                  {msg.droppedFiles.map((f) => (
                    <span
                      key={f.path}
                      title={f.path}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(122, 162, 247, 0.15)',
                        color: 'var(--xp-blue)',
                        fontSize: '10px',
                      }}
                    >
                      <FileText size={9} style={{ flexShrink: 0 }} />
                      {f.name}
                    </span>
                  ))}
                </div>
              )}

              {msg.content &&
                (() => {
                  const displayText =
                    msg.role === 'assistant' && !msg.isContextInjection
                      ? getVisibleText(`msg-${i}`) || msg.content
                      : msg.content;

                  return (
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        background:
                          msg.role === 'user' ? 'var(--xp-blue)' : 'var(--xp-surface-light)',
                        color: msg.role === 'user' ? 'white' : 'var(--xp-text)',
                        marginLeft: msg.role === 'user' ? '20%' : '0',
                        marginRight: msg.role === 'assistant' ? '20%' : '0',
                        whiteSpace: msg.role === 'user' ? 'pre-wrap' : undefined,
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.role === 'assistant' ? (
                        <MarkdownRenderer
                          content={displayText}
                          onSaveCodeAsFile={handleSaveCodeAsFile}
                        />
                      ) : (
                        displayText
                      )}
                    </div>
                  );
                })()}

              {showBatchCard && msg.fileActions && (
                <BatchActionCard
                  actions={msg.fileActions}
                  onAllowAll={() => handleBatchAllowAll(i)}
                  onRejectAll={() => handleBatchRejectAll(i)}
                  onAlwaysAllow={() => handleBatchAlwaysAllow(i)}
                />
              )}

              {msg.fileActions?.map((pa) => (
                <FileActionCard
                  key={pa.id}
                  pendingAction={pa}
                  onAllow={() => handleExecuteAction(i, pa.id)}
                  onReject={() => handleRejectAction(i, pa.id)}
                  onAlwaysAllow={() => handleAlwaysAllow(i, pa.id)}
                  onUndo={() => handleUndoAction(i, pa.id)}
                />
              ))}
            </div>
          );
        })}

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

      {/* Input bar */}
      <div
        style={{
          borderTop: '1px solid var(--xp-border)',
          padding: '8px',
          display: 'flex',
          gap: '6px',
        }}
      >
        <button
          onClick={() => setShowHistory(true)}
          title="Chat history"
          style={{
            padding: '8px',
            borderRadius: '6px',
            border: '1px solid var(--xp-border)',
            background: 'transparent',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <History size={14} />
        </button>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            title="New chat"
            style={{
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--xp-border)',
              background: 'transparent',
              color: 'var(--xp-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <RotateCcw size={14} />
          </button>
        )}
        <div style={{ flex: 1, position: 'relative' }}>
          {/* Slash command suggestions */}
          {slashSuggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: '4px',
                background: 'var(--xp-surface)',
                border: '1px solid var(--xp-border)',
                borderRadius: '6px',
                overflow: 'hidden',
                zIndex: 10,
              }}
            >
              {slashSuggestions.map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => {
                    setInput(cmd.hasArgs ? `${cmd.name} ` : cmd.name);
                    setSlashSuggestions([]);
                    inputRef.current?.focus();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '6px 10px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--xp-text)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--xp-surface-light)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <code
                    style={{
                      color: 'var(--xp-blue)',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                    }}
                  >
                    {cmd.name}
                  </code>
                  <span style={{ color: 'var(--xp-text-muted)', fontSize: '11px' }}>
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
                return;
              }
              // Up arrow — recall previous input from history
              if (e.key === 'ArrowUp' && !input) {
                e.preventDefault();
                const history = inputHistoryRef.current;
                if (history.length > 0) {
                  const nextIdx = Math.min(inputHistoryIndexRef.current + 1, history.length - 1);
                  inputHistoryIndexRef.current = nextIdx;
                  setInput(history[nextIdx]);
                }
                return;
              }
              // Down arrow — navigate forward in history
              if (e.key === 'ArrowDown' && inputHistoryIndexRef.current >= 0) {
                e.preventDefault();
                const nextIdx = inputHistoryIndexRef.current - 1;
                inputHistoryIndexRef.current = nextIdx;
                setInput(nextIdx >= 0 ? inputHistoryRef.current[nextIdx] : '');
                return;
              }
              // Tab — autocomplete slash command
              if (e.key === 'Tab' && slashSuggestions.length > 0) {
                e.preventDefault();
                const cmd = slashSuggestions[0];
                setInput(cmd.hasArgs ? `${cmd.name} ` : cmd.name);
                setSlashSuggestions([]);
              }
            }}
            placeholder={
              droppedFiles.length > 0
                ? `Ask about ${droppedFiles.length} attached file${droppedFiles.length !== 1 ? 's' : ''}...`
                : 'Ask about your files... (type / for commands)'
            }
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--xp-border)',
              background: 'var(--xp-bg)',
              color: 'var(--xp-text)',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>
        <button
          onClick={() => sendMessage()}
          disabled={isLoading || !input.trim()}
          style={{
            padding: '8px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--xp-blue)',
            color: 'white',
            cursor: 'pointer',
            opacity: isLoading || !input.trim() ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};

export default StandaloneChatPanel;
