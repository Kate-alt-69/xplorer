/**
 * File action types, parsing, execution, and inline permission card
 * used by StandaloneChatPanel for AI-driven file operations.
 */
import {
  FileText,
  FolderOpen,
  FilePlus2,
  FileEdit,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileActionType = 'create_file' | 'edit_file' | 'delete_file';

export interface FileAction {
  action: FileActionType;
  path: string;
  content?: string;
}

export interface PendingFileAction {
  id: string;
  action: FileAction;
  status: 'pending' | 'approved' | 'rejected' | 'success' | 'error';
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract just the file name from a full path */
export const basename = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

/** Extract the directory portion from a full path */
const dirname = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join('/') || '/';
};

/** Generate a unique id for pending actions */
export const generateActionId = (): string =>
  `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Check if user has granted "always allow" for AI file operations */
export const isAlwaysAllowed = (): boolean =>
  localStorage.getItem(STORAGE_KEYS.AI_FILE_ACCESS_GRANTED) === 'true';

/** Set "always allow" preference */
export const setAlwaysAllowed = (value: boolean): void => {
  if (value) {
    localStorage.setItem(STORAGE_KEYS.AI_FILE_ACCESS_GRANTED, 'true');
  } else {
    localStorage.removeItem(STORAGE_KEYS.AI_FILE_ACCESS_GRANTED);
  }
};

/**
 * Parse AI response text for file action JSON blocks.
 * Returns the text with action blocks removed, and the extracted actions.
 */
export const parseFileActions = (
  responseText: string,
): { cleanText: string; actions: FileAction[] } => {
  const actions: FileAction[] = [];

  const actionPattern =
    /```(?:json)?\s*\n?\s*(\{[\s\S]*?"action"\s*:\s*"(?:create_file|edit_file|delete_file)"[\s\S]*?\})\s*\n?\s*```/g;

  const barePattern =
    /(?:^|\n)\s*(\{[\s\S]*?"action"\s*:\s*"(?:create_file|edit_file|delete_file)"[\s\S]*?\})(?:\n|$)/g;

  let cleanText = responseText;

  const tryParseAction = (jsonStr: string): FileAction | null => {
    try {
      const parsed: unknown = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && 'action' in parsed && 'path' in parsed) {
        const obj = parsed as Record<string, unknown>;
        const action = obj.action as string;
        if (action === 'create_file' || action === 'edit_file' || action === 'delete_file') {
          return {
            action: action as FileActionType,
            path: obj.path as string,
            content: typeof obj.content === 'string' ? obj.content : undefined,
          };
        }
      }
    } catch {
      // Invalid JSON, skip
    }
    return null;
  };

  // First pass: code-fenced JSON blocks
  let match: RegExpExecArray | null = actionPattern.exec(responseText);
  while (match !== null) {
    const action = tryParseAction(match[1]);
    if (action) {
      actions.push(action);
      cleanText = cleanText.replace(match[0], '');
    }
    match = actionPattern.exec(responseText);
  }

  // Second pass: bare JSON blocks (only if no fenced ones found)
  if (actions.length === 0) {
    let bareMatch: RegExpExecArray | null = barePattern.exec(responseText);
    while (bareMatch !== null) {
      const action = tryParseAction(bareMatch[1]);
      if (action) {
        actions.push(action);
        cleanText = cleanText.replace(bareMatch[1], '');
      }
      bareMatch = barePattern.exec(responseText);
    }
  }

  return { cleanText: cleanText.trim(), actions };
};

/** Execute a file action via TauriAPI */
export const executeFileAction = async (action: FileAction): Promise<void> => {
  switch (action.action) {
    case 'create_file': {
      const dir = dirname(action.path);
      await TauriAPI.createDirRecursive(dir);
      await TauriAPI.createFileWithContent(action.path, action.content ?? '');
      break;
    }
    case 'edit_file': {
      await TauriAPI.createFileWithContent(action.path, action.content ?? '');
      break;
    }
    case 'delete_file': {
      // Use moveToTrash for safety (can be recovered)
      await TauriAPI.moveToTrash(action.path);
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// System prompt addition
// ---------------------------------------------------------------------------

export const FILE_OPS_SYSTEM_PROMPT = `
You can perform file operations directly. When you need to create, edit, or delete a file, include a JSON action block in your response. The user will be asked for permission before the action is executed.

Available actions:
- Create a file: \`{"action": "create_file", "path": "/absolute/path/to/file.txt", "content": "file contents here"}\`
- Edit a file (overwrites): \`{"action": "edit_file", "path": "/absolute/path/to/file.txt", "content": "new file contents"}\`
- Delete a file (moves to trash): \`{"action": "delete_file", "path": "/absolute/path/to/file.txt"}\`

Rules:
- Always use absolute paths.
- You can include multiple action blocks in one response.
- Include an explanation before or after the action block so the user understands what you're doing.
- For edit_file, provide the complete new file content (not a diff).
- The action JSON must be on its own line, not mixed with other text on the same line.
`.trim();

// ---------------------------------------------------------------------------
// File Action Card component
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<FileActionType, string> = {
  create_file: 'Create a file',
  edit_file: 'Edit a file',
  delete_file: 'Delete a file',
};

const ActionIcon = ({ action }: { action: FileActionType }) => {
  switch (action) {
    case 'create_file':
      return <FilePlus2 size={14} />;
    case 'edit_file':
      return <FileEdit size={14} />;
    case 'delete_file':
      return <Trash2 size={14} />;
  }
};

interface FileActionCardProps {
  pendingAction: PendingFileAction;
  onAllow: () => void;
  onReject: () => void;
  onAlwaysAllow: () => void;
}

export const FileActionCard = ({
  pendingAction,
  onAllow,
  onReject,
  onAlwaysAllow,
}: FileActionCardProps) => {
  const { action, status } = pendingAction;
  const fileName = basename(action.path);
  const dirName = dirname(action.path);

  return (
    <div
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
          background: 'var(--xp-surface-light)',
        }}
      >
        <ActionIcon action={action.action} />
        <span style={{ fontWeight: 600, color: 'var(--xp-text)' }}>
          AI Chat wants to {ACTION_LABELS[action.action].toLowerCase()}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* File name */}
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

        {/* Content preview (for create/edit) */}
        {action.content && action.action !== 'delete_file' && (
          <div style={{ marginTop: '4px' }}>
            <div style={{ fontSize: '11px', color: 'var(--xp-text-muted)', marginBottom: '4px' }}>
              Content:
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
        {status === 'pending' && (
          <>
            <button
              onClick={onReject}
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
              color: 'var(--xp-green, #9ece6a)',
              fontSize: '12px',
            }}
          >
            <CheckCircle2 size={14} />
            {action.action === 'delete_file' ? 'Moved to Trash' : 'Done'}
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
          >
            <XCircle size={14} />
            {pendingAction.error ?? 'Failed'}
          </div>
        )}
      </div>
    </div>
  );
};
