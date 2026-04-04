/**
 * File action types, parsing, execution, and inline permission card
 * used by StandaloneChatPanel for AI-driven file operations.
 *
 * Supports both mutating actions (create, edit, delete, rename, move, copy, mkdir)
 * and read-only agent actions (list_directory, search_files, open_file) that feed
 * results back into the agent loop.
 */
import { useState } from 'react';
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
} from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileActionType =
  | 'create_file'
  | 'edit_file'
  | 'delete_file'
  | 'rename_file'
  | 'move_file'
  | 'copy_file'
  | 'create_directory'
  | 'list_directory'
  | 'search_files'
  | 'open_file';

/** Actions that modify the filesystem and need permission */
export type MutatingActionType = Exclude<
  FileActionType,
  'list_directory' | 'search_files' | 'open_file'
>;

/** Actions that are read-only and can auto-execute to feed context back */
export type ReadOnlyActionType = 'list_directory' | 'search_files' | 'open_file';

export const READONLY_ACTIONS: ReadonlySet<string> = new Set<string>([
  'list_directory',
  'search_files',
  'open_file',
]);

export interface FileAction {
  action: FileActionType;
  path: string;
  content?: string;
  /** Destination path for rename/move/copy */
  destination?: string;
  /** Search query for search_files */
  query?: string;
}

export interface PendingFileAction {
  id: string;
  action: FileAction;
  status: 'pending' | 'approved' | 'rejected' | 'success' | 'error';
  error?: string;
  /** Result returned by read-only actions (directory listing, search results) */
  result?: string;
  /** Whether undo has been performed */
  undone?: boolean;
  /** Previous content of the file (for edit_file undo) */
  previousContent?: string;
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

/** Check whether an action type is read-only (no permission needed) */
export const isReadOnlyAction = (actionType: string): boolean => READONLY_ACTIONS.has(actionType);

// ---------------------------------------------------------------------------
// All valid action strings for regex matching
// ---------------------------------------------------------------------------

const ALL_ACTION_NAMES = [
  'create_file',
  'edit_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'create_directory',
  'list_directory',
  'search_files',
  'open_file',
].join('|');

/**
 * Parse AI response text for file action JSON blocks.
 * Returns the text with action blocks removed, and the extracted actions.
 */
export const parseFileActions = (
  responseText: string,
): { cleanText: string; actions: FileAction[] } => {
  const actions: FileAction[] = [];

  const actionPattern = new RegExp(
    `\`\`\`(?:json)?\\s*\\n?\\s*(\\{[\\s\\S]*?"action"\\s*:\\s*"(?:${
      ALL_ACTION_NAMES
    })"[\\s\\S]*?\\})\\s*\\n?\\s*\`\`\``,
    'g',
  );

  const barePattern = new RegExp(
    `(?:^|\\n)\\s*(\\{[\\s\\S]*?"action"\\s*:\\s*"(?:${ALL_ACTION_NAMES})"[\\s\\S]*?\\})(?:\\n|$)`,
    'g',
  );

  let cleanText = responseText;

  const tryParseAction = (jsonStr: string): FileAction | null => {
    try {
      const parsed: unknown = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && 'action' in parsed && 'path' in parsed) {
        const obj = parsed as Record<string, unknown>;
        const action = obj.action as string;
        const validActions = new Set(ALL_ACTION_NAMES.split('|'));
        if (validActions.has(action)) {
          return {
            action: action as FileActionType,
            path: obj.path as string,
            content: typeof obj.content === 'string' ? obj.content : undefined,
            destination: typeof obj.destination === 'string' ? obj.destination : undefined,
            query: typeof obj.query === 'string' ? obj.query : undefined,
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

/** Execute a file action via TauriAPI. Returns a result string for read-only actions. */
export const executeFileAction = async (action: FileAction): Promise<string | undefined> => {
  switch (action.action) {
    case 'create_file': {
      const dir = dirname(action.path);
      await TauriAPI.createDirRecursive(dir);
      await TauriAPI.createFileWithContent(action.path, action.content ?? '');
      return undefined;
    }
    case 'edit_file': {
      await TauriAPI.createFileWithContent(action.path, action.content ?? '');
      return undefined;
    }
    case 'delete_file': {
      // Use moveToTrash for safety (can be recovered)
      await TauriAPI.moveToTrash(action.path);
      return undefined;
    }
    case 'rename_file': {
      if (!action.destination) {
        throw new Error('rename_file requires a "destination" field');
      }
      await TauriAPI.rename(action.path, action.destination);
      return undefined;
    }
    case 'move_file': {
      if (!action.destination) {
        throw new Error('move_file requires a "destination" field');
      }
      await TauriAPI.moveFile(action.path, action.destination);
      return undefined;
    }
    case 'copy_file': {
      if (!action.destination) {
        throw new Error('copy_file requires a "destination" field');
      }
      await TauriAPI.copy(action.path, action.destination);
      return undefined;
    }
    case 'create_directory': {
      await TauriAPI.createDirRecursive(action.path);
      return undefined;
    }
    case 'list_directory': {
      const entries = await TauriAPI.readDirectory(action.path);
      const MAX_ENTRIES = 100;
      const lines = entries.slice(0, MAX_ENTRIES).map((e) => {
        const sizeStr = e.is_dir ? '<dir>' : formatSize(e.size);
        return `${e.is_dir ? 'd' : '-'} ${sizeStr.padStart(10)} ${e.name}`;
      });
      if (entries.length > MAX_ENTRIES) {
        lines.push(`... and ${entries.length - MAX_ENTRIES} more items`);
      }
      const header = `Directory: ${action.path} (${entries.length} items)`;
      return `${header}\n${lines.join('\n')}`;
    }
    case 'search_files': {
      const searchQuery = action.query ?? action.path;
      const searchPath = action.query ? action.path : dirname(action.path);
      const results = await TauriAPI.findFiles(searchQuery, searchPath);
      const MAX_RESULTS = 50;
      const lines = results.slice(0, MAX_RESULTS);
      if (results.length > MAX_RESULTS) {
        lines.push(`... and ${results.length - MAX_RESULTS} more results`);
      }
      return `Search results for "${searchQuery}" in ${searchPath} (${results.length} matches):\n${lines.join('\n')}`;
    }
    case 'open_file': {
      // Trigger navigation via the global state
      const xState = (
        window as unknown as { __xplorer_state__?: { navigateTo: (p: string) => void } }
      ).__xplorer_state__;
      if (xState?.navigateTo) {
        // If it looks like a directory, navigate to it
        try {
          const isDir = await TauriAPI.isDir(action.path);
          if (isDir) {
            xState.navigateTo(action.path);
            return `Navigated to directory: ${action.path}`;
          }
        } catch {
          // Not a directory or doesn't exist
        }
        // Navigate to parent directory to show the file
        const parentDir = dirname(action.path);
        xState.navigateTo(parentDir);
        return `Navigated to ${parentDir} (file: ${basename(action.path)})`;
      }
      return `Cannot navigate: Xplorer state not available`;
    }
  }
};

/**
 * Read the current file content before an edit so undo can restore it.
 * Returns the previous content or undefined if the file doesn't exist.
 */
export const captureFileForUndo = async (action: FileAction): Promise<string | undefined> => {
  if (action.action === 'edit_file') {
    try {
      return await TauriAPI.readTextFile(action.path);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

/**
 * Undo a previously executed file action.
 * - create_file / create_directory -> delete (trash)
 * - delete_file -> restore from trash
 * - rename_file -> rename back
 * - move_file -> move back
 * - copy_file -> delete the copy
 * - edit_file -> restore previous content
 */
export const undoFileAction = async (pa: PendingFileAction): Promise<void> => {
  const { action } = pa;
  switch (action.action) {
    case 'create_file':
    case 'create_directory':
      await TauriAPI.moveToTrash(action.path);
      break;
    case 'delete_file':
      await TauriAPI.restoreFromTrash(action.path);
      break;
    case 'rename_file':
      if (action.destination) {
        await TauriAPI.rename(action.destination, action.path);
      }
      break;
    case 'move_file':
      if (action.destination) {
        await TauriAPI.moveFile(action.destination, action.path);
      }
      break;
    case 'copy_file':
      if (action.destination) {
        await TauriAPI.moveToTrash(action.destination);
      }
      break;
    case 'edit_file':
      if (pa.previousContent !== undefined) {
        await TauriAPI.createFileWithContent(action.path, pa.previousContent);
      }
      break;
    default:
      break;
  }
};

/** Whether a completed action can be undone */
export const canUndoAction = (pa: PendingFileAction): boolean => {
  if (pa.status !== 'success' || pa.undone) return false;
  if (isReadOnlyAction(pa.action.action)) return false;
  // edit_file can only be undone if we captured previous content
  if (pa.action.action === 'edit_file' && pa.previousContent === undefined) return false;
  return true;
};

/** Format bytes into human-readable size */
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

// ---------------------------------------------------------------------------
// System prompt addition
// ---------------------------------------------------------------------------

export const FILE_OPS_SYSTEM_PROMPT = `
You are an AI agent inside the Xplorer file manager. You can observe the filesystem and take actions on it.

## Available Actions
Include JSON action blocks in your response. The user will be asked for permission before mutating actions execute. Read-only actions (list_directory, search_files, open_file) execute automatically to give you more context.

### Mutating Actions (require permission)
- Create a file: \`{"action": "create_file", "path": "/absolute/path/to/file.txt", "content": "file contents here"}\`
- Edit a file (overwrites): \`{"action": "edit_file", "path": "/absolute/path/to/file.txt", "content": "new file contents"}\`
- Delete a file (moves to trash): \`{"action": "delete_file", "path": "/absolute/path/to/file.txt"}\`
- Rename a file/folder: \`{"action": "rename_file", "path": "/absolute/path/old_name.txt", "destination": "/absolute/path/new_name.txt"}\`
- Move a file/folder: \`{"action": "move_file", "path": "/absolute/path/file.txt", "destination": "/absolute/new_path/file.txt"}\`
- Copy a file/folder: \`{"action": "copy_file", "path": "/absolute/path/file.txt", "destination": "/absolute/path/file_copy.txt"}\`
- Create a directory: \`{"action": "create_directory", "path": "/absolute/path/to/new_folder"}\`

### Read-Only Actions (auto-execute)
- List a directory: \`{"action": "list_directory", "path": "/absolute/path/to/dir"}\`
- Search for files: \`{"action": "search_files", "path": "/search/root/path", "query": "*.txt"}\`
- Navigate to / open a file: \`{"action": "open_file", "path": "/absolute/path/to/file_or_dir"}\`

## Rules
- Always use absolute paths.
- You can include multiple action blocks in one response.
- Include a brief explanation before action blocks so the user understands the plan.
- For edit_file, provide the complete new file content (not a diff).
- For rename/move/copy, both "path" (source) and "destination" are required.
- The action JSON must be on its own line, not mixed with other text on the same line.
- For multi-step tasks (e.g., organizing files), use list_directory first to see what's there, then plan your actions.
- After completing actions, suggest logical next steps the user might want.
`.trim();

// ---------------------------------------------------------------------------
// File Action Card component
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
  }
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

  const handleUndo = async () => {
    if (!onUndo) return;
    setUndoing(true);
    onUndo();
  };

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
              fontSize: '12px',
              width: '100%',
              justifyContent: 'flex-end',
            }}
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
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {pendingMutating.map((pa, i) => (
          <div
            key={pa.id}
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
