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

        {messages.map((msg, i) => {
          const displayText =
            msg.role === 'assistant' && !msg.isContextInjection
              ? getVisibleText(`msg-${i}`) || msg.content
              : msg.content;

          return (
            <ChatMessageBubble
              key={`msg-${i}`}
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
