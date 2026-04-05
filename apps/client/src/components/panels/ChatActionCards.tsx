/**
 * File action permission cards for the AI chat panel.
 * Extracted from chat-file-actions.tsx to stay under the 1000-line limit.
 *
 * - FileActionCard: Single action with allow/reject/undo buttons + diff preview
 * - BatchActionCard: Batch permission card for multi-step operations
 */
import { useState, useEffect } from 'react';
import {
  FileText,
  FolderOpen,
  FilePlus2,
  FileEdit,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  FolderPlus,
  ArrowRightLeft,
  Copy,
  PenLine,
  Search,
  List,
  ExternalLink,
  Undo2,
  Terminal,
} from 'lucide-react';
import ChatDiffPreview from './ChatDiffPreview';
import ChatErrorBoundary from './ChatErrorBoundary';
import { TauriAPI } from '@/lib/tauri-api';
import {
  type FileActionType,
  type PendingFileAction,
  basename,
  isReadOnlyAction,
  canUndoAction,
} from './chat-file-actions';

// ---------------------------------------------------------------------------
// Labels & icons
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<FileActionType, string> = {
  create_file: 'Create file',
  edit_file: 'Edit file',
  delete_file: 'Delete file',
  rename_file: 'Rename',
  move_file: 'Move',
  copy_file: 'Copy',
  create_directory: 'Create folder',
  list_directory: 'List directory',
  search_files: 'Search files',
  open_file: 'Open / navigate',
  run_command: 'Run command',
};

const ActionIcon = ({ action }: { action: FileActionType }) => {
  switch (action) {
    case 'create_file':
      return <FilePlus2 size={14} />;
    case 'edit_file':
      return <FileEdit size={14} />;
    case 'delete_file':
      return <Trash2 size={14} />;
    case 'rename_file':
      return <PenLine size={14} />;
    case 'move_file':
      return <ArrowRightLeft size={14} />;
    case 'copy_file':
      return <Copy size={14} />;
    case 'create_directory':
      return <FolderPlus size={14} />;
    case 'list_directory':
      return <List size={14} />;
    case 'search_files':
      return <Search size={14} />;
    case 'open_file':
      return <ExternalLink size={14} />;
    case 'run_command':
      return <Terminal size={14} />;
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the directory portion from a full path */
const dirname = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join('/') || '/';
};

// ---------------------------------------------------------------------------
// Single file action card
// ---------------------------------------------------------------------------

interface FileActionCardProps {
  pendingAction: PendingFileAction;
  onAllow: () => void;
  onReject: () => void;
  onAlwaysAllow: () => void;
  onUndo?: () => void;
}

export const FileActionCard = ({
  pendingAction,
  onAllow,
  onReject,
  onAlwaysAllow,
  onUndo,
}: FileActionCardProps) => {
  const { action, status } = pendingAction;
  const fileName = basename(action.path);
  const dirName = dirname(action.path);
  const isReadOnly = isReadOnlyAction(action.action);
  const hasDestination = action.destination != null;
  const [undoing, setUndoing] = useState(false);
  const showUndo = canUndoAction(pendingAction) && onUndo;

  // Load current file content for diff preview on edit_file actions
  const [existingContent, setExistingContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    if (action.action !== 'edit_file' || status !== 'pending' || !action.content) return;
    let cancelled = false;
    setDiffLoading(true);
    TauriAPI.readTextFile(action.path)
      .then((content) => {
        if (!cancelled) setExistingContent(content);
      })
      .catch(() => {
        // File doesn't exist yet -- no diff to show
        if (!cancelled) setExistingContent(null);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [action.action, action.path, action.content, status]);

  const showDiff =
    action.action === 'edit_file' &&
    status === 'pending' &&
    existingContent !== null &&
    action.content !== undefined &&
    existingContent !== action.content;

  const handleUndo = () => {
    if (!onUndo) return;
    setUndoing(true);
    onUndo();
  };

  return (
    <div
      role="region"
      aria-label={`File action: ${ACTION_LABELS[action.action]} ${fileName}`}
      style={{
        margin: '8px 0',
        border: '1px solid var(--xp-border)',
        borderRadius: '8px',
        background: 'var(--xp-surface)',
        overflow: 'hidden',
        fontSize: '13px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderBottom: '1px solid var(--xp-border)',
          background: isReadOnly ? 'var(--xp-surface)' : 'var(--xp-surface-light)',
        }}
      >
        <ActionIcon action={action.action} />
        <span style={{ fontWeight: 600, color: 'var(--xp-text)' }}>
          {isReadOnly
            ? ACTION_LABELS[action.action]
            : `AI wants to ${ACTION_LABELS[action.action].toLowerCase()}`}
        </span>
        {isReadOnly && (
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'rgba(122, 162, 247, 0.15)',
              color: 'var(--xp-blue)',
              marginLeft: 'auto',
            }}
          >
            auto
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Source path */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--xp-text)',
          }}
        >
          <FileText size={12} style={{ flexShrink: 0, color: 'var(--xp-blue)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{fileName}</span>
        </div>

        {/* Directory */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--xp-text-muted)',
          }}
        >
          <FolderOpen size={12} style={{ flexShrink: 0 }} />
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={dirName}
          >
            {dirName}
          </span>
        </div>

        {/* Destination (for rename/move/copy) */}
        {hasDestination && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-text)',
              marginTop: '4px',
              paddingTop: '4px',
              borderTop: '1px dashed var(--xp-border)',
            }}
          >
            <ArrowRightLeft
              size={12}
              style={{ flexShrink: 0, color: 'var(--xp-green, #9ece6a)' }}
            />
            <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
              {basename(action.destination!)}
            </span>
            <span
              style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--xp-text-muted)' }}
              title={dirname(action.destination!)}
            >
              in {dirname(action.destination!)}
            </span>
          </div>
        )}

        {/* Search query */}
        {action.query && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-text)',
            }}
          >
            <Search size={12} style={{ flexShrink: 0, color: 'var(--xp-blue)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
              &quot;{action.query}&quot;
            </span>
          </div>
        )}

        {/* Diff preview for edit_file with existing file */}
        {showDiff && existingContent !== null && action.content !== undefined && (
          <ChatErrorBoundary label="Diff preview">
            <ChatDiffPreview previousContent={existingContent} newContent={action.content} />
          </ChatErrorBoundary>
        )}

        {/* Diff loading indicator */}
        {action.action === 'edit_file' && diffLoading && status === 'pending' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '4px',
              fontSize: '11px',
              color: 'var(--xp-text-muted)',
            }}
          >
            <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
            Loading diff...
          </div>
        )}

        {/* Content preview (for create_file or edit_file with no existing file) */}
        {action.content && action.action !== 'delete_file' && !showDiff && !diffLoading && (
          <div style={{ marginTop: '4px' }}>
            <div style={{ fontSize: '11px', color: 'var(--xp-text-muted)', marginBottom: '4px' }}>
              {action.action === 'edit_file' && existingContent === null
                ? 'New file content:'
                : 'Content:'}
            </div>
            <pre
              style={{
                margin: 0,
                padding: '8px',
                borderRadius: '4px',
                background: 'var(--xp-bg)',
                border: '1px solid var(--xp-border)',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'var(--xp-text)',
                maxHeight: '120px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {action.content.length > 500
                ? `${action.content.slice(0, 500)}\n... (${action.content.length} chars total)`
                : action.content}
            </pre>
          </div>
        )}

        {action.action === 'delete_file' && (
          <div
            style={{
              marginTop: '4px',
              padding: '6px 8px',
              borderRadius: '4px',
              background: 'rgba(255, 100, 100, 0.1)',
              color: 'var(--xp-red, #f7768e)',
              fontSize: '11px',
            }}
          >
            This file will be moved to Trash (recoverable).
          </div>
        )}

        {/* Result from read-only actions */}
        {pendingAction.result && status === 'success' && (
          <div style={{ marginTop: '4px' }}>
            <pre
              style={{
                margin: 0,
                padding: '8px',
                borderRadius: '4px',
                background: 'var(--xp-bg)',
                border: '1px solid var(--xp-border)',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'var(--xp-text-muted)',
                maxHeight: '150px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {pendingAction.result.length > 1000
                ? `${pendingAction.result.slice(0, 1000)}\n... (truncated)`
                : pendingAction.result}
            </pre>
          </div>
        )}
      </div>

      {/* Action buttons or status */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--xp-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          justifyContent: 'flex-end',
        }}
      >
        {status === 'pending' && !isReadOnly && (
          <>
            <button
              onClick={onReject}
              aria-label={`Reject ${ACTION_LABELS[action.action].toLowerCase()} ${fileName}`}
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: '1px solid var(--xp-border)',
                background: 'transparent',
                color: 'var(--xp-text)',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Reject
            </button>
            <button
              onClick={onAlwaysAllow}
              aria-label="Always allow AI file operations"
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: '1px solid var(--xp-border)',
                background: 'transparent',
                color: 'var(--xp-text-muted)',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Always Allow
            </button>
            <button
              onClick={onAllow}
              aria-label={`Allow ${ACTION_LABELS[action.action].toLowerCase()} ${fileName}`}
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: 'none',
                background: 'var(--xp-blue)',
                color: 'white',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Allow
            </button>
          </>
        )}

        {status === 'approved' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-text-muted)',
              fontSize: '12px',
            }}
            role="status"
            aria-label="Executing action"
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            Executing...
          </div>
        )}

        {status === 'success' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              width: '100%',
              justifyContent: 'flex-end',
            }}
            role="status"
          >
            {pendingAction.undone ? (
              <span
                style={{
                  color: 'var(--xp-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Undo2 size={12} />
                Undone
              </span>
            ) : (
              <>
                <span
                  style={{
                    color: 'var(--xp-green, #9ece6a)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <CheckCircle2 size={14} />
                  {action.action === 'delete_file' ? 'Moved to Trash' : 'Done'}
                </span>
                {showUndo && (
                  <button
                    onClick={handleUndo}
                    disabled={undoing}
                    aria-label={`Undo ${ACTION_LABELS[action.action].toLowerCase()} ${fileName}`}
                    style={{
                      marginLeft: '8px',
                      padding: '3px 10px',
                      borderRadius: '4px',
                      border: '1px solid var(--xp-border)',
                      background: 'transparent',
                      color: 'var(--xp-text-muted)',
                      cursor: undoing ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      opacity: undoing ? 0.5 : 1,
                    }}
                    title="Undo this action"
                  >
                    <Undo2 size={11} />
                    {undoing ? 'Undoing...' : 'Undo'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {status === 'rejected' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-text-muted)',
              fontSize: '12px',
            }}
            role="status"
          >
            <XCircle size={14} />
            Rejected by user
          </div>
        )}

        {status === 'error' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-red, #f7768e)',
              fontSize: '12px',
            }}
            role="alert"
          >
            <XCircle size={14} />
            {pendingAction.error ?? 'Failed'}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Batch permission card for multi-step operations
// ---------------------------------------------------------------------------

interface BatchActionCardProps {
  actions: PendingFileAction[];
  onAllowAll: () => void;
  onRejectAll: () => void;
  onAlwaysAllow: () => void;
}

export const BatchActionCard = ({
  actions,
  onAllowAll,
  onRejectAll,
  onAlwaysAllow,
}: BatchActionCardProps) => {
  const pendingMutating = actions.filter(
    (a) => a.status === 'pending' && !isReadOnlyAction(a.action.action),
  );

  // Don't render batch card if nothing pending
  if (pendingMutating.length === 0) return null;

  return (
    <div
      role="region"
      aria-label={`Batch file actions: ${pendingMutating.length} pending`}
      style={{
        margin: '8px 0',
        border: '1px solid var(--xp-blue)',
        borderRadius: '8px',
        background: 'var(--xp-surface)',
        overflow: 'hidden',
        fontSize: '13px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderBottom: '1px solid var(--xp-border)',
          background: 'rgba(122, 162, 247, 0.1)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--xp-text)' }}>
          AI wants to perform {pendingMutating.length} action
          {pendingMutating.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Action list */}
      <div
        style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}
        role="list"
        aria-label="Pending file actions"
      >
        {pendingMutating.map((pa, i) => (
          <div
            key={pa.id}
            role="listitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 0',
              fontSize: '12px',
              color: 'var(--xp-text)',
            }}
          >
            <span style={{ color: 'var(--xp-text-muted)', width: '18px', textAlign: 'right' }}>
              {i + 1}.
            </span>
            <ActionIcon action={pa.action.action} />
            <span>{ACTION_LABELS[pa.action.action]}</span>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '11px',
                color: 'var(--xp-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {basename(pa.action.path)}
              {pa.action.destination ? ` -> ${basename(pa.action.destination)}` : ''}
            </span>
          </div>
        ))}
      </div>

      {/* Batch action buttons */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--xp-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={onRejectAll}
          aria-label={`Reject all ${pendingMutating.length} actions`}
          style={{
            padding: '5px 12px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background: 'transparent',
            color: 'var(--xp-text)',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Reject All
        </button>
        <button
          onClick={onAlwaysAllow}
          aria-label="Always allow AI file operations"
          style={{
            padding: '5px 12px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background: 'transparent',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Always Allow
        </button>
        <button
          onClick={onAllowAll}
          aria-label={`Allow all ${pendingMutating.length} actions`}
          style={{
            padding: '5px 14px',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--xp-blue)',
            color: 'white',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          Allow All
        </button>
      </div>
    </div>
  );
};
