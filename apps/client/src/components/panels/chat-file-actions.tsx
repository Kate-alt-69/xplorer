/**
 * File action types, parsing, execution, and undo logic
 * used by StandaloneChatPanel for AI-driven file operations.
 *
 * Supports mutating actions (create, edit, delete, rename, move, copy, mkdir),
 * read-only agent actions (list_directory, search_files, open_file) that feed
 * results back into the agent loop, and terminal command execution (run_command).
 *
 * UI components: FileActionCard + BatchActionCard in ChatActionCards.tsx,
 * CommandActionCard in ChatCommandCard.tsx.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
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
  | 'open_file'
  | 'open_extension'
  | 'run_command';

/** Actions that modify the filesystem and need permission */
export type MutatingActionType = Exclude<
  FileActionType,
  'list_directory' | 'search_files' | 'open_file' | 'open_extension'
>;

/** Actions that are read-only and can auto-execute to feed context back */
export type ReadOnlyActionType = 'list_directory' | 'search_files' | 'open_file' | 'open_extension';

/** Actions that always require explicit user permission (never auto-execute) */
export type AlwaysAskActionType = 'run_command';

export const ALWAYS_ASK_ACTIONS: ReadonlySet<string> = new Set<string>(['run_command']);

export const READONLY_ACTIONS: ReadonlySet<string> = new Set<string>([
  'list_directory',
  'search_files',
  'open_file',
  'open_extension',
]);

export interface FileAction {
  action: FileActionType;
  path: string;
  content?: string;
  /** Destination path for rename/move/copy */
  destination?: string;
  /** Search query for search_files */
  query?: string;
  /** Shell command string for run_command */
  command?: string;
  /** Working directory for run_command (defaults to path) */
  cwd?: string;
  /** Extension ID for open_extension action */
  extension_id?: string;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out?: boolean;
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
  /** Output from run_command execution */
  commandOutput?: CommandOutput;
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

/** Check whether an action type always requires explicit user permission (never auto-execute) */
export const isAlwaysAskAction = (actionType: string): boolean =>
  ALWAYS_ASK_ACTIONS.has(actionType);

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
  'open_extension',
  'run_command',
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
      if (parsed && typeof parsed === 'object' && 'action' in parsed) {
        const obj = parsed as Record<string, unknown>;
        const action = obj.action as string;
        const validActions = new Set(ALL_ACTION_NAMES.split('|'));
        if (!validActions.has(action)) return null;

        // run_command requires "command" instead of "path"
        if (action === 'run_command') {
          const cmd = typeof obj.command === 'string' ? obj.command : undefined;
          if (!cmd) return null;
          let cwdValue = '';
          if (typeof obj.cwd === 'string') cwdValue = obj.cwd;
          else if (typeof obj.path === 'string') cwdValue = obj.path;
          return {
            action: action as FileActionType,
            path: cwdValue,
            command: cmd,
            cwd: cwdValue || undefined,
          };
        }

        // open_extension requires "extension_id"
        if (action === 'open_extension') {
          const extId = typeof obj.extension_id === 'string' ? obj.extension_id : undefined;
          if (!extId) return null;
          return {
            action: action as FileActionType,
            path: typeof obj.path === 'string' ? obj.path : '',
            extension_id: extId,
          };
        }

        // All other actions require "path"
        if (!('path' in obj)) return null;
        return {
          action: action as FileActionType,
          path: obj.path as string,
          content: typeof obj.content === 'string' ? obj.content : undefined,
          destination: typeof obj.destination === 'string' ? obj.destination : undefined,
          query: typeof obj.query === 'string' ? obj.query : undefined,
        };
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

// ---------------------------------------------------------------------------
// Command safety helpers
// ---------------------------------------------------------------------------

/** Patterns that indicate a dangerous shell command */
const DANGEROUS_COMMAND_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force)\b/i, reason: 'Recursive force deletion' },
  { pattern: /\brm\s+-[a-zA-Z]*f/i, reason: 'Force deletion' },
  { pattern: /\bsudo\b/i, reason: 'Privilege escalation' },
  { pattern: /\bformat\b/i, reason: 'Disk formatting' },
  { pattern: /\bmkfs\b/i, reason: 'Filesystem creation' },
  { pattern: /\bdd\b/i, reason: 'Raw disk write' },
  { pattern: /\bchmod\s+777\b/i, reason: 'Overly permissive file permissions' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'System shutdown/reboot' },
  { pattern: /\b(kill|killall|pkill)\s+-9\b/i, reason: 'Force process termination' },
  { pattern: />\s*\/dev\//i, reason: 'Writing to device file' },
  { pattern: /\|\s*(sh|bash|zsh)\b/i, reason: 'Piping to shell' },
];

/**
 * Strip common stderr/stdout redirect-to-/dev/null patterns before checking
 * for dangerous metacharacters, so `2>/dev/null`, `2>&1`, `>/dev/null` etc.
 * don't trigger false positives.
 */
const stripSafeRedirects = (command: string): string =>
  command.replace(/\s*[12]?>(?:\/dev\/null|&[12])\s*/g, ' ');

/** Check if a command matches dangerous patterns. Returns the reason or undefined. */
export const isDangerousCommand = (command: string): string | undefined => {
  const cleaned = stripSafeRedirects(command);
  for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(cleaned)) return reason;
  }
  return undefined;
};

/** Common safe commands that get normal permission prompt */
const KNOWN_SAFE_COMMANDS = new Set([
  'ls',
  'dir',
  'cat',
  'head',
  'tail',
  'echo',
  'pwd',
  'cd',
  'whoami',
  'hostname',
  'uname',
  'date',
  'which',
  'where',
  'type',
  'grep',
  'wc',
  'sort',
  'uniq',
  'file',
  'stat',
  'df',
  'du',
  'printenv',
  'set',
  'mkdir',
  'cp',
  'mv',
  'rm',
  'touch',
  'chmod',
  'chown',
  'ln',
  'basename',
  'dirname',
  'tr',
  'cut',
  'sed',
  'awk',
  'diff',
  'tar',
  'zip',
  'unzip',
  'gzip',
  'curl',
  'wget',
  'tree',
  'git',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'bunx',
  'node',
  'deno',
  'python',
  'python3',
  'pip',
  'pip3',
  'uv',
  'uvx',
  'cargo',
  'rustc',
  'rustup',
  'rustfmt',
  'go',
  'make',
  'cmake',
  'gcc',
  'g++',
  'clang',
  'docker',
  'docker-compose',
  'kubectl',
  'ssh',
  'scp',
  'rsync',
  'java',
  'javac',
  'mvn',
  'gradle',
  'ruby',
  'gem',
  'bundle',
  'swift',
  'dotnet',
  'gh',
  'jq',
  'yq',
  'bat',
  'rg',
  'fd',
  'fzf',
  'htop',
  'top',
  'ps',
  'open',
  'xdg-open',
  'start',
]);

/** Check if a command is NOT in the known-safe list. Returns true for unknown commands. */
export const isUnknownCommand = (command: string): boolean => {
  const binary = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const name =
    binary
      .split('/')
      .pop()
      ?.split('\\')
      .pop()
      ?.replace(/\.exe$/, '') ?? binary;
  return !KNOWN_SAFE_COMMANDS.has(name);
};

/** Default timeout for command execution (30 seconds) */
const COMMAND_TIMEOUT_MS = 30_000;

/** Execute a run_command action. Returns a CommandOutput. */
export const executeRunCommand = async (action: FileAction): Promise<CommandOutput> => {
  const cmd = action.command;
  if (!cmd) throw new Error('run_command requires a "command" field');
  const cwd = action.cwd || action.path || '/';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

  try {
    const resultPromise = TauriAPI.executeCommand(cmd, cwd);

    // Race the command against the timeout
    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Command timed out after 30 seconds'));
        });
      }),
    ]);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out')) {
      return {
        stdout: '',
        stderr: `Command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds`,
        exit_code: -1,
        timed_out: true,
      };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
    case 'open_extension': {
      // Dynamically import to avoid circular dependency
      const { executeOpenExtension } = await import('./chat-extension-awareness');
      return await executeOpenExtension(action.extension_id ?? '', action.path || undefined);
    }
    case 'run_command': {
      // Command execution is handled separately via executeRunCommand
      // This case exists so TypeScript is exhaustive
      const output = await executeRunCommand(action);
      const parts: string[] = [];
      if (output.stdout) parts.push(`stdout:\n${output.stdout}`);
      if (output.stderr) parts.push(`stderr:\n${output.stderr}`);
      parts.push(`exit code: ${output.exit_code}`);
      if (output.timed_out) parts.push('(timed out)');
      return parts.join('\n');
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
  // Commands cannot be undone
  if (pa.action.action === 'run_command') return false;
  // edit_file can only be undone if we captured previous content
  if (pa.action.action === 'edit_file' && pa.previousContent === undefined) return false;
  return true;
};

/** Alias for consistency with existing call sites */
const formatSize = formatFileSize;

// ---------------------------------------------------------------------------
// System prompt addition
// ---------------------------------------------------------------------------

/** Detect OS for system prompt */
const getOSName = (): string => {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macOS';
  if (ua.includes('win')) return 'Windows';
  if (ua.includes('linux')) return 'Linux';
  return 'Unknown';
};

export const FILE_OPS_SYSTEM_PROMPT = `
You are an AI agent inside the Xplorer file manager. You can observe the filesystem and take actions on it.
The user is running ${getOSName()}.

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

### Terminal Commands (always require explicit permission)
- Run a shell command: \`{"action": "run_command", "command": "npm install", "cwd": "/absolute/path/to/project"}\`
  - The command output (stdout, stderr, exit code) will be returned to you so you can see the results and iterate.
  - Commands have a 30-second timeout.
  - Prefer safe, non-destructive commands (ls, cat, git status, npm list, etc.).
  - Avoid destructive commands (rm -rf, sudo, format, etc.) -- they will be flagged as dangerous.
  - Always provide "cwd" so the command runs in the right directory.
  - Use commands appropriate for ${getOSName()}.

### Read-Only Actions (auto-execute)
- List a directory: \`{"action": "list_directory", "path": "/absolute/path/to/dir"}\`
- Search for files: \`{"action": "search_files", "path": "/search/root/path", "query": "*.txt"}\`
- Navigate to / open a file: \`{"action": "open_file", "path": "/absolute/path/to/file_or_dir"}\`
- Open a file in an extension: \`{"action": "open_extension", "extension_id": "extension-id", "path": "/absolute/path/to/file"}\`
  - Only use this when you know the extension is installed (check the Installed Extensions section).
  - The extension_id must match an installed extension. The path is optional for panel-only extensions.

## Task Plans (for complex multi-step requests)
When the user asks for something complex that involves 3+ distinct steps (e.g., "organize this folder, rename files by date, and generate a README"), generate a task plan INSTEAD of doing everything at once.

Wrap the plan in a \`\`\`task_plan code block with this JSON format:

\`\`\`task_plan
{
  "title": "Short plan title",
  "steps": [
    { "description": "List directory contents", "prompt": "List all files in the current directory to understand what we're working with" },
    { "description": "Create subfolders by type", "prompt": "Create folders: images/, documents/, code/ in the current directory" },
    { "description": "Move files to folders", "prompt": "Move each file to its appropriate subfolder based on extension" }
  ]
}
\`\`\`

Rules for task plans:
- Only generate a plan for requests with 3+ distinct operations
- Each step's "prompt" should be a self-contained instruction the AI can execute independently
- Each step's "description" is a short human-readable label for the progress UI
- The user will see the plan and can approve, edit, or cancel before execution starts
- Steps execute one-by-one; the user can pause between steps
- Do NOT include action blocks in the same response as a task plan -- the plan replaces them

## Rules
- Always use absolute paths.
- You can include multiple action blocks in one response.
- Include a brief explanation before action blocks so the user understands the plan.
- For edit_file, provide the complete new file content (not a diff).
- For rename/move/copy, both "path" (source) and "destination" are required.
- The action JSON must be on its own line, not mixed with other text on the same line.
- For simple multi-step tasks (1-2 actions), just include the action blocks directly.
- For complex multi-step tasks (3+ distinct operations), generate a task_plan block instead.
- After completing actions, suggest logical next steps the user might want.
- When using run_command, explain what the command does and why you're running it.
`.trim();
