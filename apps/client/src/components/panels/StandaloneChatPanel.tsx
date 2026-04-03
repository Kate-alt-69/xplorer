import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, FileText, FolderOpen, Code2, X } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';

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

/** Extract just the file name from a full path */
const basename = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

const StandaloneChatPanel = () => {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) {
        const s = JSON.parse(raw);
        setModel(s.aiModel || 'claude-sonnet-4-20250514');
      }
    } catch {
      /* ignore */
    }
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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const xState = getXplorerState();

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    scrollToBottom();

    let systemContent =
      'You are an AI assistant inside the Xplorer file manager. Help with file operations, code understanding, and general questions.';
    systemContent +=
      '\n\nIf you need to see the contents of a file to answer a question, ask the user to share the file contents with you. You can reference files by their path.';

    if (includeSelection && xState?.editorSelection) {
      const sel = xState.editorSelection;
      systemContent += `\n\n[Selected code in ${sel.filePath} lines ${sel.startLine}-${sel.endLine}]\n\`\`\`\n${sel.text}\n\`\`\``;
    }
    if (xState?.currentPath) {
      systemContent += `\n\n[Current directory: ${xState.currentPath}]`;
    }
    if (xState?.selectedFiles && xState.selectedFiles.length > 0) {
      const fileList = xState.selectedFiles
        .map((f) => `  - ${f.name} (${f.path})${f.is_dir ? ' [directory]' : ''}`)
        .join('\n');
      systemContent += `\n\n[Currently selected files]\n${fileList}`;
    }

    const allMsgs = [{ role: 'system', content: systemContent }, ...messages, userMsg];

    try {
      const response = await TauriAPI.chatWithAI(model || 'claude-sonnet-4-20250514', allMsgs);
      setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [input, isLoading, messages, model, scrollToBottom, includeSelection]);

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
          <div
            key={i}
            style={{
              marginBottom: '12px',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '13px',
              lineHeight: '1.5',
              background: msg.role === 'user' ? 'var(--xp-blue)' : 'var(--xp-surface-light)',
              color: msg.role === 'user' ? 'white' : 'var(--xp-text)',
              marginLeft: msg.role === 'user' ? '20%' : '0',
              marginRight: msg.role === 'assistant' ? '20%' : '0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {msg.content}
          </div>
        ))}
        {isLoading && (
          <div style={{ padding: '8px', color: 'var(--xp-text-muted)', fontSize: '12px' }}>
            Thinking...
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
