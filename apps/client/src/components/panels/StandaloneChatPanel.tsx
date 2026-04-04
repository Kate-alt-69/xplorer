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
import ChatHistoryView from './ChatHistoryView';
import ChatContextHeader from './ChatContextHeader';
import { DragOverlay, AttachedFilesBar } from './ChatDropZone';

/** Max bytes of file content to include in AI context (~10 KB). */
const MAX_FILE_CONTENT_LENGTH = 10_000;

/** Max total context for multi-file reads (~30 KB split across files). */
const MAX_MULTI_FILE_TOTAL = 30_000;

/** Max number of files to read content for at once. */
const MAX_MULTI_FILE_COUNT = 5;

/** Max directory entries to include in context injection */
const MAX_DIR_CONTEXT_ENTRIES = 50;

/** Max agent loop iterations (to prevent runaway loops) */
const MAX_AGENT_ITERATIONS = 5;

/** Get the lowercase extension from a file path (without the dot). */
const getExt = (filePath: string): string => {
  const name = basename(filePath);
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : name.toLowerCase();
};

/** Read file content for AI context. Tries text first, then document extraction. */
const readFileForAIContext = async (
  file: { name: string; path: string; is_dir: boolean },
  maxLength = MAX_FILE_CONTENT_LENGTH,
): Promise<{ name: string; path: string; file_type: string; content?: string }> => {
  const ext = getExt(file.path);

  if (file.is_dir) {
    return { name: file.name, path: file.path, file_type: 'directory' };
  }

  // Try reading as plain text first
  try {
    let content = await TauriAPI.readTextFile(file.path);
    if (content.length > maxLength) {
      content = `${content.slice(0, maxLength)}\n\n[... truncated at ${Math.round(maxLength / 1000)}KB ...]`;
    }
    if (content.trim().length > 0) {
      return { name: file.name, path: file.path, file_type: ext, content };
    }
  } catch {
    // Not a text file -- try document extraction
  }

  // Try document extraction (PDF, DOCX, XLSX, PPTX, etc.)
  try {
    let content = await TauriAPI.extractDocumentText(file.path);
    if (content.length > maxLength) {
      content = `${content.slice(0, maxLength)}\n\n[... truncated at ${Math.round(maxLength / 1000)}KB ...]`;
    }
    if (content.trim().length > 0) {
      return { name: file.name, path: file.path, file_type: ext, content };
    }
  } catch {
    // Document extraction not available for this format
  }

  return {
    name: file.name,
    path: file.path,
    file_type: ext || 'unknown',
    content: `[File: ${file.name} (${ext || 'unknown'} format)]`,
  };
};

/**
 * Read multiple files for AI context. Distributes the byte budget across files
 * so that the total context stays manageable.
 */
const readMultipleFilesForAIContext = async (
  files: Array<{ name: string; path: string; is_dir: boolean }>,
): Promise<Array<{ name: string; path: string; file_type: string; content?: string }>> => {
  const nonDirFiles = files.filter((f) => !f.is_dir);
  const filesToRead = nonDirFiles.slice(0, MAX_MULTI_FILE_COUNT);
  if (filesToRead.length === 0) return [];

  const perFileLimit = Math.floor(MAX_MULTI_FILE_TOTAL / filesToRead.length);
  const results = await Promise.allSettled(
    filesToRead.map((f) => readFileForAIContext(f, perFileLimit)),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof readFileForAIContext>>> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value);
};

// ---------------------------------------------------------------------------
// Xplorer state helpers
// ---------------------------------------------------------------------------

interface XplorerState {
  currentPath?: string;
  selectedFiles?: Array<{ name: string; path: string; is_dir: boolean }>;
  editorSelection?: {
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
  } | null;
}

const getXplorerState = (): XplorerState | undefined =>
  (window as unknown as { __xplorer_state__?: XplorerState }).__xplorer_state__;

/** Build directory listing context string */
const buildDirectoryContext = async (dirPath: string): Promise<string> => {
  try {
    const entries = await TauriAPI.readDirectory(dirPath);
    const total = entries.length;
    const shown = entries.slice(0, MAX_DIR_CONTEXT_ENTRIES);
    const lines = shown.map((e) => `  ${e.is_dir ? '[dir]' : `[${getExt(e.path)}]`} ${e.name}`);
    let result = `Directory listing of ${dirPath} (${total} items):\n${lines.join('\n')}`;
    if (total > MAX_DIR_CONTEXT_ENTRIES) {
      result += `\n  ... and ${total - MAX_DIR_CONTEXT_ENTRIES} more items`;
    }
    return result;
  } catch {
    return `Directory: ${dirPath} (could not read listing)`;
  }
};

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
      fileContexts: Array<{ name: string; path: string; file_type: string; content?: string }>,
      agentLoopContext?: string,
    ): Promise<string> => {
      let systemContent =
        "You are an AI agent inside the Xplorer file manager. You can observe the user's filesystem, understand their context, and take actions to help them manage files.";
      systemContent += `\n\n${FILE_OPS_SYSTEM_PROMPT}`;

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
    [includeSelection],
  );

  // ---------------------------------------------------------------------------
  // Agent loop
  // ---------------------------------------------------------------------------

  const runAgentLoop = useCallback(
    async (
      initialMessages: Array<{ role: string; content: string }>,
      xState: XplorerState | undefined,
      fileContexts: Array<{ name: string; path: string; file_type: string; content?: string }>,
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

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading) return;

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
    [input, isLoading, messages, droppedFiles, scrollToBottom, runAgentLoop],
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--xp-text-muted)',
              fontSize: '13px',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '28px' }}>&#x1F4AC;</span>
            <span>Ask anything about your files</span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--xp-text-muted)',
                maxWidth: '220px',
                textAlign: 'center',
              }}
            >
              I can browse directories, search files, create, edit, move, rename, and organize your
              files.
            </span>
            {selectedFiles.length > 0 && (
              <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)' }}>
                {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} in context
              </span>
            )}
            <span
              style={{
                fontSize: '11px',
                color: 'var(--xp-text-muted)',
                marginTop: '4px',
                opacity: 0.7,
              }}
            >
              Drag files here to add them as context
            </span>
          </div>
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

              {msg.content && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    background: msg.role === 'user' ? 'var(--xp-blue)' : 'var(--xp-surface-light)',
                    color: msg.role === 'user' ? 'white' : 'var(--xp-text)',
                    marginLeft: msg.role === 'user' ? '20%' : '0',
                    marginRight: msg.role === 'assistant' ? '20%' : '0',
                    whiteSpace: msg.role === 'user' ? 'pre-wrap' : undefined,
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.role === 'assistant' ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
              )}

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
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={
            droppedFiles.length > 0
              ? `Ask about ${droppedFiles.length} attached file${droppedFiles.length !== 1 ? 's' : ''}...`
              : 'Ask about your files...'
          }
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--xp-border)',
            background: 'var(--xp-bg)',
            color: 'var(--xp-text)',
            fontSize: '13px',
            outline: 'none',
          }}
        />
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
