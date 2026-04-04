import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, FileText, FolderOpen, Code2, X, Loader2, RotateCcw } from 'lucide-react';
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

/** Max bytes of file content to include in AI context (~10 KB). */
const MAX_FILE_CONTENT_LENGTH = 10_000;

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
const readFileForAIContext = async (file: {
  name: string;
  path: string;
  is_dir: boolean;
}): Promise<{ name: string; path: string; file_type: string; content?: string }> => {
  const ext = getExt(file.path);

  if (file.is_dir) {
    return { name: file.name, path: file.path, file_type: 'directory' };
  }

  // Try reading as plain text first
  try {
    let content = await TauriAPI.readTextFile(file.path);
    if (content.length > MAX_FILE_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_FILE_CONTENT_LENGTH)}\n\n[... truncated at 10KB ...]`;
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
    if (content.length > MAX_FILE_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_FILE_CONTENT_LENGTH)}\n\n[... truncated at 10KB ...]`;
    }
    if (content.trim().length > 0) {
      return { name: file.name, path: file.path, file_type: ext, content };
    }
  } catch {
    // Document extraction not available for this format
  }

  // Fallback: send filename and type
  return {
    name: file.name,
    path: file.path,
    file_type: ext || 'unknown',
    content: `[File: ${file.name} (${ext || 'unknown'} format)]`,
  };
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

// ---------------------------------------------------------------------------
// Context builder -- builds rich system context for the agent
// ---------------------------------------------------------------------------

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
// Chat message type
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: string;
  content: string;
  /** Pending file actions attached to this message (assistant only) */
  fileActions?: PendingFileAction[];
  /** Whether this is a system/context injection message (hidden from user) */
  isContextInjection?: boolean;
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

  // File context state -- updated from __xplorer_state__
  const [currentPath, setCurrentPath] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<
    Array<{ name: string; path: string; is_dir: boolean }>
  >([]);
  const [editorSelection, setEditorSelection] = useState<XplorerState['editorSelection']>(null);
  const [includeSelection, setIncludeSelection] = useState(true);

  useEffect(() => {
    // Read model from agent settings (configured in Settings > AI)
    AgentService.getSettings()
      .then((s) => {
        if (s.model) setModel(s.model);
      })
      .catch(() => {
        // Fallback: read from localStorage
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

    // Initial sync
    syncState();

    // Listen for state changes
    const onStateChange = () => syncState();
    window.addEventListener('xplorer-state-change', onStateChange);

    // Also poll periodically for editorSelection changes (set by code-editor extension)
    const interval = setInterval(syncState, 1000);

    return () => {
      window.removeEventListener('xplorer-state-change', onStateChange);
      clearInterval(interval);
    };
  }, []);

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

  // ---------------------------------------------------------------------------
  // Batch action handlers
  // ---------------------------------------------------------------------------

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
  // Returns results from read-only actions for the agent loop.
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
          // Read-only: always auto-execute
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
          // Mutating with "always allow": auto-execute
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
      fileContext: { name: string; path: string; file_type: string; content?: string } | null,
      agentLoopContext?: string,
    ): Promise<string> => {
      let systemContent =
        "You are an AI agent inside the Xplorer file manager. You can observe the user's filesystem, understand their context, and take actions to help them manage files.";

      // Add file operations capability
      systemContent += `\n\n${FILE_OPS_SYSTEM_PROMPT}`;

      // Context: current directory
      if (xState?.currentPath) {
        systemContent += `\n\n## Current Context`;
        systemContent += `\n[Current directory: ${xState.currentPath}]`;

        // Add directory listing
        const dirListing = await buildDirectoryContext(xState.currentPath);
        systemContent += `\n\n${dirListing}`;
      }

      // Context: selected files
      const selectedFileList = xState?.selectedFiles ?? [];
      if (selectedFileList.length > 0) {
        const fileList = selectedFileList
          .map((f) => `  - ${f.name} (${f.path})${f.is_dir ? ' [directory]' : ''}`)
          .join('\n');
        systemContent += `\n\n[Currently selected files]\n${fileList}`;
      }

      // Context: file content loaded
      if (fileContext?.content) {
        systemContent +=
          '\n\n[File content loaded] The user has a file selected and its contents are available below. You can answer questions about it directly.';
        systemContent += `\n\nFile: ${fileContext.name} (${fileContext.file_type})\n\`\`\`\n${fileContext.content}\n\`\`\``;
      }

      // Context: editor selection
      if (includeSelection && xState?.editorSelection) {
        const sel = xState.editorSelection;
        systemContent += `\n\n[Selected code in ${sel.filePath} lines ${sel.startLine}-${sel.endLine}]\n\`\`\`\n${sel.text}\n\`\`\``;
      }

      // Agent loop context (results from previous iteration's read-only actions)
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
  // Agent loop: send message, auto-execute read-only actions, feed results back
  // ---------------------------------------------------------------------------

  const runAgentLoop = useCallback(
    async (
      initialMessages: Array<{ role: string; content: string }>,
      xState: XplorerState | undefined,
      fileContext: { name: string; path: string; file_type: string; content?: string } | null,
      currentMsgs: ChatMessage[],
    ) => {
      let loopMessages = [...initialMessages];
      let iteration = 0;
      let messagesSnapshot = [...currentMsgs];

      while (iteration < MAX_AGENT_ITERATIONS && !abortRef.current) {
        iteration++;

        const agentLoopContext =
          iteration > 1
            ? loopMessages
                .filter((m) => m.role === 'tool_result')
                .map((m) => m.content)
                .join('\n\n')
            : undefined;

        const systemContent = await buildSystemPrompt(xState, fileContext, agentLoopContext);

        // Build API messages -- filter out tool_result messages (those were folded into system prompt)
        const apiMsgs = [
          { role: 'system', content: systemContent },
          ...loopMessages.filter((m) => m.role !== 'tool_result' && m.role !== 'system'),
        ];

        if (iteration > 1) {
          setAgentStep(`Agent iteration ${iteration}...`);
        }

        try {
          const response = await TauriAPI.chatWithAI(
            model || 'claude-sonnet-4-20250514',
            apiMsgs,
            fileContext,
          );

          if (abortRef.current) break;

          // Parse file actions from the response
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

          if (pendingActions.length === 0) {
            // No actions -- agent is done
            break;
          }

          // Auto-execute read-only actions (and "always allow" mutating ones)
          const msgIndex = messagesSnapshot.length - 1;
          const { readOnlyResults, hasRemainingPending } = await autoExecuteActions(
            msgIndex,
            pendingActions,
          );

          if (readOnlyResults.length > 0 && !hasRemainingPending) {
            // Only read-only actions were present -- feed results back for next iteration
            loopMessages = [
              ...loopMessages,
              { role: 'assistant', content: response },
              {
                role: 'tool_result',
                content: readOnlyResults.join('\n\n'),
              },
            ];
            // Continue loop
          } else {
            // Mutating actions pending user approval -- stop the loop
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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const xState = getXplorerState();

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    abortRef.current = false;
    scrollToBottom();

    // Read file contents for selected files (first file only to keep context manageable)
    let fileContext: { name: string; path: string; file_type: string; content?: string } | null =
      null;
    const selectedFileList = xState?.selectedFiles ?? [];

    if (selectedFileList.length > 0 && !selectedFileList[0].is_dir) {
      setIsReadingFile(true);
      try {
        fileContext = await readFileForAIContext(selectedFileList[0]);
      } catch {
        // Silently fall back to no file content
      } finally {
        setIsReadingFile(false);
      }
    }

    // Build message history (strip fileActions and context injection messages)
    const historyMsgs = newMessages
      .filter((m) => !m.isContextInjection)
      .map((m) => ({ role: m.role, content: m.content }));

    // Run the agent loop
    await runAgentLoop(historyMsgs, xState, fileContext, newMessages);

    setIsLoading(false);
    scrollToBottom();
  }, [input, isLoading, messages, scrollToBottom, runAgentLoop]);

  // ---------------------------------------------------------------------------
  // Stop the agent
  // ---------------------------------------------------------------------------

  const stopAgent = useCallback(() => {
    abortRef.current = true;
    setIsLoading(false);
    setAgentStep('');
  }, []);

  // ---------------------------------------------------------------------------
  // Clear chat
  // ---------------------------------------------------------------------------

  const clearChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setAgentStep('');
    abortRef.current = false;
  }, []);

  const hasContext = currentPath || selectedFiles.length > 0 || editorSelection;

  // Count pending mutating actions per message for batch card rendering
  const getPendingMutatingCount = (msg: ChatMessage): number =>
    msg.fileActions?.filter((a) => a.status === 'pending' && !isReadOnlyAction(a.action.action))
      .length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* File context header */}
      {hasContext && (
        <div
          style={{
            borderBottom: '1px solid var(--xp-border)',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontSize: '12px',
            flexShrink: 0,
          }}
        >
          {/* Current directory */}
          {currentPath && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--xp-text-muted)',
              }}
            >
              <FolderOpen size={12} style={{ flexShrink: 0 }} />
              <span
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={currentPath}
              >
                {basename(currentPath)}
              </span>
            </div>
          )}

          {/* Selected files badges */}
          {selectedFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {selectedFiles.slice(0, 5).map((file) => (
                <span
                  key={file.path}
                  title={file.path}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'var(--xp-surface-light)',
                    color: 'var(--xp-text)',
                    fontSize: '11px',
                    maxWidth: '140px',
                  }}
                >
                  <FileText size={10} style={{ flexShrink: 0 }} />
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {file.name}
                  </span>
                </span>
              ))}
              {selectedFiles.length > 5 && (
                <span
                  style={{ fontSize: '11px', color: 'var(--xp-text-muted)', padding: '1px 4px' }}
                >
                  +{selectedFiles.length - 5} more
                </span>
              )}
            </div>
          )}

          {/* Editor selection indicator */}
          {editorSelection && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: includeSelection
                  ? 'rgba(122, 162, 247, 0.15)'
                  : 'var(--xp-surface-light)',
                color: includeSelection ? 'var(--xp-blue)' : 'var(--xp-text-muted)',
              }}
            >
              <Code2 size={11} style={{ flexShrink: 0 }} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {basename(editorSelection.filePath)} L{editorSelection.startLine}-
                {editorSelection.endLine}
              </span>
              <button
                onClick={() => setIncludeSelection((v) => !v)}
                title={
                  includeSelection
                    ? 'Exclude selection from context'
                    : 'Include selection in context'
                }
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 2px',
                  color: 'inherit',
                  fontSize: '11px',
                  opacity: 0.7,
                }}
              >
                {includeSelection ? <X size={10} /> : 'include'}
              </button>
            </div>
          )}
        </div>
      )}

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
            <span style={{ fontSize: '28px' }}>💬</span>
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
          </div>
        )}
        {messages.map((msg, i) => {
          // Skip context injection messages
          if (msg.isContextInjection) return null;

          const pendingMutatingCount = getPendingMutatingCount(msg);
          const showBatchCard = pendingMutatingCount > 1;

          return (
            <div key={i} style={{ marginBottom: '12px' }}>
              {/* Message bubble */}
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

              {/* Batch action card for multi-step operations */}
              {showBatchCard && msg.fileActions && (
                <BatchActionCard
                  actions={msg.fileActions}
                  onAllowAll={() => handleBatchAllowAll(i)}
                  onRejectAll={() => handleBatchRejectAll(i)}
                  onAlwaysAllow={() => handleBatchAlwaysAllow(i)}
                />
              )}

              {/* Inline file action cards */}
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
            <Loader2
              size={12}
              style={{
                animation: 'spin 1s linear infinite',
                flexShrink: 0,
              }}
            />
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
      <div
        style={{
          borderTop: '1px solid var(--xp-border)',
          padding: '8px',
          display: 'flex',
          gap: '6px',
        }}
      >
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            title="Clear chat"
            style={{
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--xp-border)',
              background: 'transparent',
              color: 'var(--xp-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
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
          placeholder="Ask about your files..."
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
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          style={{
            padding: '8px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--xp-blue)',
            color: 'white',
            cursor: 'pointer',
            opacity: isLoading || !input.trim() ? 0.5 : 1,
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};

export default StandaloneChatPanel;
