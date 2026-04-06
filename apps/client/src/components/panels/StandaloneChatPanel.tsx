import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { AgentService } from '@/lib/agent-service';
import { useChatActions } from './use-chat-actions';
import {
  type SavedConversation,
  generateConversationId,
  deriveConversationTitle,
  loadChatHistory,
  saveChatHistory,
} from './chat-history';
import { QUICK_ACTIONS, QuickActionsBar, type QuickAction } from './chat-quick-actions';
import { type XplorerState, type FileContext, getXplorerState } from './chat-context-helpers';
import ChatContextHeader from './ChatContextHeader';
import ChatWelcome from './ChatWelcome';
import ChatFilePathCard from './ChatFilePathCard';
import ChatMessageBubble, { type RuntimeChatMessage } from './ChatMessageBubble';
import ChatSlashInput from './ChatSlashInput';
import { DragOverlay, AttachedFilesBar } from './ChatDropZone';
import { useStreamingText, type StreamingEntry } from './use-streaming-text';
import { type WorkspaceContext, detectWorkspaceContext } from './chat-workspace-awareness';
import { useProactiveAgent } from './use-proactive-agent';
import ProactiveSuggestionCard from './ProactiveSuggestionCard';
import { recordFolderVisit } from './chat-agent-memory';
import { detectAndLearnCorrection } from './chat-correction-learning';
import ChatFeedbackButtons from './ChatFeedbackButtons';
import { useChatBranching } from './use-chat-branching';
import { BranchForkIndicator } from './ChatBranchTabs';
import { useTaskPlan } from './use-task-plan';
import { exportChatAsHtml } from './chat-export-html';
import { isMessagePinned } from './chat-pinning';
import ChatMessageContextMenu from './ChatMessageContextMenu';
import { startSession, endSession, formatSessionSummary } from './chat-audit-log';
import { useChatFeedback } from './use-chat-feedback';
import {
  buildSystemPrompt as buildSystemPromptFn,
  exportChatAsMarkdown,
} from './chat-system-prompt';
import {
  dispatchSlashCommand,
  useSaveCodeAsFile,
  buildDroppedFiles,
  buildFileContext,
  buildHistoryMessages,
  IMAGE_EXTENSIONS,
} from './use-chat-send';
import { useAgentLoop } from './use-agent-loop';

// ---------------------------------------------------------------------------
// Lazy-loaded heavy components (reduces initial bundle)
// ---------------------------------------------------------------------------

const ChatHistoryView = lazy(() => import('./ChatHistoryView'));
const ChatBranchTabs = lazy(() => import('./ChatBranchTabs'));
const TaskPlanCard = lazy(() => import('./TaskPlanCard'));
const ChatPinnedMessages = lazy(() => import('./ChatPinnedMessages'));

/** Fallback spinner for lazy-loaded components */
const LazyFallback = () => (
  <div
    style={{
      padding: '12px',
      textAlign: 'center',
      color: 'var(--xp-text-muted)',
      fontSize: '12px',
    }}
  >
    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
  </div>
);

// ---------------------------------------------------------------------------
// Virtual scrolling constants
// ---------------------------------------------------------------------------

/** Messages beyond this count use windowed rendering */
const VIRTUAL_SCROLL_THRESHOLD = 60;
/** Overscan: extra messages rendered above/below viewport */
const OVERSCAN_COUNT = 8;

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

  // File action handlers (extracted to use-chat-actions.ts)

  // Use a ref to always access the latest messages without stale closures
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sendMessageRef = useRef<((text?: string) => Promise<void>) | null>(null);

  const {
    handleExecuteAction,
    handleUndoAction,
    handleRejectAction,
    handleAlwaysAllow,
    handleBatchAllowAll,
    handleBatchRejectAll,
    handleBatchAlwaysAllow,
    autoExecuteActions,
  } = useChatActions(messagesRef, setMessages, scrollToBottom, () => {
    // After an action completes (success or failure), continue the AI conversation.
    // Use sendMessageRef to avoid circular dependency (sendMessage defined later).
    setTimeout(() => {
      sendMessageRef.current?.(
        'Continue based on the action results above. If something failed, suggest an alternative approach. If everything succeeded, summarize what was done and suggest next steps.',
      );
    }, 500);
  });

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

  // Pinning, feedback, and context menu (extracted to use-chat-feedback.ts)
  const {
    pinnedMessages,
    handlePinMessage,
    handleUnpinMessage,
    handleJumpToMessage,
    feedbackMap,
    handlePositiveFeedback,
    handleNegativeFeedback,
    contextMenu,
    handleMessageContextMenu,
    closeContextMenu,
  } = useChatFeedback(messages, currentPath, currentConversationId, scrollRef);

  // Build system prompt with full context (delegated to chat-system-prompt.ts)

  const buildSystemPrompt = useCallback(
    async (
      xState: XplorerState | undefined,
      fileContexts: FileContext[],
      agentLoopContext?: string,
    ): Promise<string> =>
      buildSystemPromptFn({
        xState,
        fileContexts,
        workspaceCtx,
        includeSelection,
        agentLoopContext,
      }),
    [includeSelection, workspaceCtx],
  );

  // Agent loop + plan execution (extracted to use-agent-loop.ts)

  const { runAgentLoop, executePlanSteps } = useAgentLoop({
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
  });

  // Chat export handlers

  const exportChatMarkdown = useCallback(() => {
    exportChatAsMarkdown(messages);
  }, [messages]);

  const exportChatHtml = useCallback(() => {
    if (messages.length === 0) return;
    exportChatAsHtml({ messages, currentPath, model });
  }, [messages, currentPath, model]);

  // Save code as file (extracted to use-chat-send.ts)

  const handleSaveCodeAsFile = useSaveCodeAsFile(setMessages);

  // Send message (slash dispatch extracted to use-chat-send.ts)

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading) return;

      // Dispatch slash commands without calling the AI
      const slashResult = dispatchSlashCommand(text, {
        messages,
        messagesRef,
        currentPath,
        currentConversationId,
        exportChatHtml,
        exportChatMarkdown,
        handlePinMessage,
        isMessagePinnedFn: isMessagePinned,
      });
      if (slashResult) {
        if (slashResult.redirectPrompt) {
          setInput('');
          return sendMessage(slashResult.redirectPrompt);
        }
        slashResult.sideEffect?.();
        if (slashResult.appendMessages) {
          setMessages((prev) => [...prev, ...slashResult.appendMessages!]);
        }
        setInput('');
        return;
      }

      const xState = getXplorerState();

      // Detect user corrections and learn preferences
      {
        const lastAiMsg = [...messages]
          .reverse()
          .find((m) => m.role === 'assistant' && !m.isContextInjection);
        if (lastAiMsg) {
          detectAndLearnCorrection(text, lastAiMsg.content, currentPath);
        }
      }

      // Dropped files take priority over xplorer selection
      const filesToRead =
        droppedFiles.length > 0 ? [...droppedFiles] : [...(xState?.selectedFiles ?? [])];

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
          const result = await buildFileContext(filesToRead, text);
          fileContexts = result.fileContexts;
          compareContext = result.compareContext;

          // Attach image contexts to the user message if available
          if (result.imageContexts.length > 0) {
            const updatedUserMsg: ChatMessage = {
              ...userMsg,
              imageContexts: result.imageContexts,
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

      const historyMsgs = buildHistoryMessages(newMessages, text, compareContext);

      // Start audit session for this agent interaction
      startSession();
      await runAgentLoop(historyMsgs, xState, fileContexts, newMessages);

      // End audit session and show summary if meaningful actions were performed
      const sessionSummary = endSession();
      if (sessionSummary && sessionSummary.totalActions > 0) {
        const summaryText = formatSessionSummary(sessionSummary);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: summaryText, isContextInjection: true },
        ]);
      }

      setIsLoading(false);
      scrollToBottom();
    },
    [
      input,
      isLoading,
      messages,
      droppedFiles,
      currentPath,
      scrollToBottom,
      runAgentLoop,
      exportChatHtml,
      exportChatMarkdown,
      handlePinMessage,
      currentConversationId,
    ],
  );
  sendMessageRef.current = sendMessage;

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

  // File path click handler — navigate to file in Xplorer

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

  // Keyboard shortcuts (Ctrl+L clear, Escape cancel/close)

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

  // Drag & drop handlers

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

    const files = buildDroppedFiles(e);
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

  // Proactive suggestion action

  const handleProactiveSuggestionAction = useCallback(
    (prompt: string) => {
      dismissProactiveSuggestion();
      sendMessage(prompt);
    },
    [dismissProactiveSuggestion, sendMessage],
  );

  // Quick actions

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

  // Render: History view

  // ---------------------------------------------------------------------------
  // Virtual scrolling for long chat histories
  // ---------------------------------------------------------------------------

  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: VIRTUAL_SCROLL_THRESHOLD,
  });

  const useVirtualScroll = messages.length > VIRTUAL_SCROLL_THRESHOLD;

  const handleMessagesScroll = useCallback(() => {
    if (!useVirtualScroll || !scrollRef.current) return;
    const el = scrollRef.current;
    const scrollTop = el.scrollTop;
    const clientHeight = el.clientHeight;
    const scrollHeight = el.scrollHeight;
    const totalMessages = messages.length;

    // Estimate which messages are visible based on scroll position
    const avgMsgHeight = scrollHeight / totalMessages || 80;
    const startIdx = Math.max(0, Math.floor(scrollTop / avgMsgHeight) - OVERSCAN_COUNT);
    const endIdx = Math.min(
      totalMessages,
      Math.ceil((scrollTop + clientHeight) / avgMsgHeight) + OVERSCAN_COUNT,
    );

    setVisibleRange((prev) => {
      if (prev.start === startIdx && prev.end === endIdx) return prev;
      return { start: startIdx, end: endIdx };
    });
  }, [useVirtualScroll, messages.length]);

  // Reset visible range when messages change (always show latest)
  useEffect(() => {
    if (useVirtualScroll) {
      setVisibleRange({
        start: Math.max(0, messages.length - VIRTUAL_SCROLL_THRESHOLD),
        end: messages.length,
      });
    }
  }, [messages.length, useVirtualScroll]);

  // Memoize the visible messages slice to avoid re-renders
  const visibleMessages = useMemo(() => {
    if (!useVirtualScroll) return messages.map((msg, i) => ({ msg, originalIndex: i }));
    return messages
      .map((msg, i) => ({ msg, originalIndex: i }))
      .slice(visibleRange.start, visibleRange.end);
  }, [messages, useVirtualScroll, visibleRange.start, visibleRange.end]);

  if (showHistory) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <ChatHistoryView
          chatHistory={chatHistory}
          currentConversationId={currentConversationId}
          onBack={() => setShowHistory(false)}
          onLoad={loadConversation}
          onDelete={deleteConversation}
        />
      </Suspense>
    );
  }

  // Render: Main chat view

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

      {/* Branch tabs (lazy) */}
      {showBranchTabs && (
        <Suspense fallback={<LazyFallback />}>
          <ChatBranchTabs
            branchState={branchState}
            onSwitchBranch={handleSwitchBranch}
            onDeleteBranch={handleDeleteBranch}
            onRenameBranch={handleRenameBranch}
          />
        </Suspense>
      )}

      {/* Pinned messages section (lazy) */}
      {pinnedMessages.length > 0 && (
        <Suspense fallback={<LazyFallback />}>
          <ChatPinnedMessages
            pinnedMessages={pinnedMessages}
            onUnpin={handleUnpinMessage}
            onJumpToMessage={handleJumpToMessage}
          />
        </Suspense>
      )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        style={{ flex: 1, overflowY: 'auto', padding: '8px' }}
        onScroll={useVirtualScroll ? handleMessagesScroll : undefined}
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

        {/* Spacer for virtual scroll — approximates height of skipped messages */}
        {useVirtualScroll && visibleRange.start > 0 && (
          <div style={{ height: `${visibleRange.start * 80}px` }} aria-hidden="true" />
        )}

        {visibleMessages.map(({ msg, originalIndex: i }) => {
          const displayText =
            msg.role === 'assistant' && !msg.isContextInjection
              ? getVisibleText(`msg-${i}`) || msg.content
              : msg.content;

          const branchCount = getMessageBranchCount(i);

          return (
            <div
              key={`msg-${i}`}
              data-msg-index={i}
              onContextMenu={(e) => handleMessageContextMenu(e, i)}
            >
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
              {/* Feedback buttons on assistant messages */}
              {msg.role === 'assistant' && !msg.isContextInjection && msg.content && !isLoading && (
                <ChatFeedbackButtons
                  messageIndex={i}
                  existingFeedback={feedbackMap[i] ?? null}
                  onPositive={handlePositiveFeedback}
                  onNegative={handleNegativeFeedback}
                />
              )}
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

        {/* Spacer for virtual scroll — approximates height of messages after viewport */}
        {useVirtualScroll && visibleRange.end < messages.length && (
          <div
            style={{ height: `${(messages.length - visibleRange.end) * 80}px` }}
            aria-hidden="true"
          />
        )}

        {/* Task Plan Card (lazy) */}
        {taskPlan.activePlan && (
          <Suspense fallback={<LazyFallback />}>
            <TaskPlanCard
              plan={taskPlan.activePlan}
              onApprove={executePlanSteps}
              onEdit={taskPlan.editPlan}
              onCancel={taskPlan.cancelPlan}
              onPause={taskPlan.pausePlan}
              onResume={taskPlan.resumePlan}
            />
          </Suspense>
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

      {/* Context menu for message pinning */}
      {contextMenu && (
        <ChatMessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isPinned={isMessagePinned(currentConversationId || 'unsaved', contextMenu.messageIndex)}
          onPin={() => handlePinMessage(contextMenu.messageIndex)}
          onCopy={() => {
            const msg = messages[contextMenu.messageIndex];
            if (msg) {
              navigator.clipboard.writeText(msg.content).catch(() => {
                // Clipboard API may not be available
              });
            }
          }}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
};

export default StandaloneChatPanel;
