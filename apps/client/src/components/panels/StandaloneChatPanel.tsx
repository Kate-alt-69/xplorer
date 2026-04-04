import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, FileText, FolderOpen, Code2, X, Loader2 } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { AgentService } from '@/lib/agent-service';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import {
  FileActionCard,
  parseFileActions,
  executeFileAction,
  generateActionId,
  isAlwaysAllowed,
  setAlwaysAllowed,
  basename,
  FILE_OPS_SYSTEM_PROMPT,
  type PendingFileAction,
} from './chat-file-actions';

/** Max bytes of file content to include in AI context (~10 KB). */
const MAX_FILE_CONTENT_LENGTH = 10_000;

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
    // Not a text file — try document extraction
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
// Chat message type
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: string;
  content: string;
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
  const [model, setModel] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

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
      error?: string,
    ) => {
      setMessages((prev) => {
        const updated = [...prev];
        const msg = updated[messageIndex];
        if (msg?.fileActions) {
          msg.fileActions = msg.fileActions.map((a) =>
            a.id === actionId ? { ...a, status, ...(error ? { error } : {}) } : a,
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
        await executeFileAction(action.action);
        updateActionStatus(messageIndex, actionId, 'success');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        updateActionStatus(messageIndex, actionId, 'error', errorMsg);
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
  // Auto-execute actions when "always allow" is enabled
  // ---------------------------------------------------------------------------

  const autoExecuteActions = useCallback(
    async (msgIndex: number, pendingActions: PendingFileAction[]) => {
      for (const pa of pendingActions) {
        updateActionStatus(msgIndex, pa.id, 'approved');
        try {
          await executeFileAction(pa.action);
          updateActionStatus(msgIndex, pa.id, 'success');
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          updateActionStatus(msgIndex, pa.id, 'error', errorMsg);
        }
      }
      scrollToBottom();
    },
    [scrollToBottom, updateActionStatus],
  );

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const xState = getXplorerState();

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
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

    let systemContent =
      'You are an AI assistant inside the Xplorer file manager. Help with file operations, code understanding, and general questions.';

    // Add file operations capability
    systemContent += `\n\n${FILE_OPS_SYSTEM_PROMPT}`;

    if (fileContext?.content) {
      systemContent +=
        '\n\nThe user has a file selected and its contents have been loaded automatically. You can answer questions about the file directly.';
    }

    if (includeSelection && xState?.editorSelection) {
      const sel = xState.editorSelection;
      systemContent += `\n\n[Selected code in ${sel.filePath} lines ${sel.startLine}-${sel.endLine}]\n\`\`\`\n${sel.text}\n\`\`\``;
    }
    if (xState?.currentPath) {
      systemContent += `\n\n[Current directory: ${xState.currentPath}]`;
    }
    if (selectedFileList.length > 0) {
      const fileList = selectedFileList
        .map((f) => `  - ${f.name} (${f.path})${f.is_dir ? ' [directory]' : ''}`)
        .join('\n');
      systemContent += `\n\n[Currently selected files]\n${fileList}`;
    }

    // Build message history for API (strip fileActions, keep role+content only)
    const allMsgs = [
      { role: 'system', content: systemContent },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: userMsg.role, content: userMsg.content },
    ];

    try {
      const response = await TauriAPI.chatWithAI(
        model || 'claude-sonnet-4-20250514',
        allMsgs,
        fileContext,
      );

      // Parse file actions from the response
      const { cleanText, actions } = parseFileActions(response);

      const pendingActions: PendingFileAction[] = actions.map((a) => ({
        id: generateActionId(),
        action: a,
        status: 'pending' as const,
      }));

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: cleanText || (actions.length > 0 ? '' : response),
        fileActions: pendingActions.length > 0 ? pendingActions : undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If "always allow" is enabled, auto-execute all actions
      if (isAlwaysAllowed() && pendingActions.length > 0) {
        // The assistant message is appended after the user message, so its index
        // is messages.length + 1 (messages is the state before this send).
        const msgIndex = messages.length + 1;
        // Use setTimeout(0) to let React commit the state update first
        setTimeout(() => autoExecuteActions(msgIndex, pendingActions), 0);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [input, isLoading, messages, model, scrollToBottom, includeSelection, autoExecuteActions]);

  const hasContext = currentPath || selectedFiles.length > 0 || editorSelection;

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
            {selectedFiles.length > 0 && (
              <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)' }}>
                {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} in context
              </span>
            )}
          </div>
        )}
        {messages.map((msg, i) => (
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
        ))}
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
            {isReadingFile ? 'Reading file...' : 'Thinking...'}
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
