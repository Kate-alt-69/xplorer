/**
 * Action Audit Log for the AI agent.
 * Logs every action the agent performs (or attempts) with timestamps,
 * action types, paths, results, and approval info.
 *
 * Stored in localStorage with auto-eviction of oldest entries (max 500).
 * Accessible via `/audit` slash command.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditResult = 'success' | 'rejected' | 'failed' | 'blocked';

export interface AuditEntry {
  id: string;
  timestamp: number;
  actionType: string;
  path: string;
  /** Optional destination for move/rename/copy */
  destination?: string;
  /** Optional command string for run_command */
  command?: string;
  result: AuditResult;
  /** Who/what approved or blocked this action */
  approvedBy: 'user' | 'auto' | 'security-rule' | 'rate-limit' | 'none';
  /** Error message if result is 'failed' or 'blocked' */
  errorMessage?: string;
  /** The security rule that blocked the action, if any */
  blockedByRule?: string;
  /** Session identifier to group actions in a multi-step operation */
  sessionId?: string;
}

/** Summary of actions performed in a session */
export interface ActionSummary {
  filesCreated: number;
  filesEdited: number;
  filesDeleted: number;
  filesMoved: number;
  filesCopied: number;
  filesRenamed: number;
  directoriesCreated: number;
  commandsExecuted: number;
  actionsRejected: number;
  actionsBlocked: number;
  totalActions: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

let currentSessionId: string | null = null;
let sessionStartTime: number | null = null;

const generateId = (): string => `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const startSession = (): string => {
  currentSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  sessionStartTime = Date.now();
  return currentSessionId;
};

export const endSession = (): ActionSummary | null => {
  if (!currentSessionId || sessionStartTime === null) return null;
  const entries = getSessionEntries(currentSessionId);
  const summary = buildSummary(entries, sessionStartTime);
  currentSessionId = null;
  sessionStartTime = null;
  return summary;
};

export const getCurrentSessionId = (): string | null => currentSessionId;

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

export const loadAuditLog = (): AuditEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AI_AUDIT_LOG);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AuditEntry[];
  } catch {
    return [];
  }
};

const saveAuditLog = (entries: AuditEntry[]): void => {
  try {
    // Keep only the most recent MAX_ENTRIES
    const trimmed = entries.slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEYS.AI_AUDIT_LOG, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable
  }
};

// ---------------------------------------------------------------------------
// Public API — logging
// ---------------------------------------------------------------------------

/**
 * Log an action to the audit log.
 */
export const logAction = (
  actionType: string,
  path: string,
  result: AuditResult,
  approvedBy: AuditEntry['approvedBy'],
  extra?: {
    destination?: string;
    command?: string;
    errorMessage?: string;
    blockedByRule?: string;
  },
): AuditEntry => {
  const entry: AuditEntry = {
    id: generateId(),
    timestamp: Date.now(),
    actionType,
    path,
    result,
    approvedBy,
    destination: extra?.destination,
    command: extra?.command,
    errorMessage: extra?.errorMessage,
    blockedByRule: extra?.blockedByRule,
    sessionId: currentSessionId ?? undefined,
  };

  const entries = loadAuditLog();
  entries.unshift(entry);
  saveAuditLog(entries);
  return entry;
};

// ---------------------------------------------------------------------------
// Public API — querying
// ---------------------------------------------------------------------------

/**
 * Get the most recent N audit entries.
 */
export const getRecentEntries = (count = 50): AuditEntry[] => loadAuditLog().slice(0, count);

/**
 * Get entries for a specific session.
 */
export const getSessionEntries = (sessionId: string): AuditEntry[] =>
  loadAuditLog().filter((e) => e.sessionId === sessionId);

/**
 * Clear all audit entries.
 */
export const clearAuditLog = (): void => {
  localStorage.removeItem(STORAGE_KEYS.AI_AUDIT_LOG);
};

/**
 * Get count of actions performed in the last N minutes.
 */
export const getActionCountSince = (sinceMs: number): number => {
  const cutoff = Date.now() - sinceMs;
  return loadAuditLog().filter((e) => e.timestamp >= cutoff && e.result === 'success').length;
};

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

const ACTION_TYPE_TO_SUMMARY_KEY: Record<string, keyof ActionSummary> = {
  create_file: 'filesCreated',
  edit_file: 'filesEdited',
  delete_file: 'filesDeleted',
  move_file: 'filesMoved',
  copy_file: 'filesCopied',
  rename_file: 'filesRenamed',
  create_directory: 'directoriesCreated',
  run_command: 'commandsExecuted',
};

const buildSummary = (entries: AuditEntry[], startTime: number): ActionSummary => {
  const summary: ActionSummary = {
    filesCreated: 0,
    filesEdited: 0,
    filesDeleted: 0,
    filesMoved: 0,
    filesCopied: 0,
    filesRenamed: 0,
    directoriesCreated: 0,
    commandsExecuted: 0,
    actionsRejected: 0,
    actionsBlocked: 0,
    totalActions: entries.length,
    durationMs: Date.now() - startTime,
  };

  for (const entry of entries) {
    if (entry.result === 'rejected') {
      summary.actionsRejected++;
      continue;
    }
    if (entry.result === 'blocked') {
      summary.actionsBlocked++;
      continue;
    }
    if (entry.result === 'success') {
      const key = ACTION_TYPE_TO_SUMMARY_KEY[entry.actionType];
      if (
        key &&
        key !== 'totalActions' &&
        key !== 'durationMs' &&
        key !== 'actionsRejected' &&
        key !== 'actionsBlocked'
      ) {
        (summary[key] as number)++;
      }
    }
  }

  return summary;
};

// ---------------------------------------------------------------------------
// Formatting helpers for /audit command display
// ---------------------------------------------------------------------------

const RESULT_ICONS: Record<AuditResult, string> = {
  success: 'OK',
  rejected: 'REJECTED',
  failed: 'FAILED',
  blocked: 'BLOCKED',
};

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

/**
 * Format the audit log for display as a chat message.
 */
export const formatAuditLogDisplay = (count = 25): string => {
  const entries = getRecentEntries(count);
  const total = loadAuditLog().length;

  if (entries.length === 0) {
    return '**Action Audit Log**\n\nNo actions recorded yet.';
  }

  const lines: string[] = ['**Action Audit Log**\n'];
  lines.push(`Showing ${entries.length} of ${total} total entries.\n`);
  lines.push('| Time | Action | Path | Result | Approved By |');
  lines.push('|------|--------|------|--------|-------------|');

  for (const entry of entries) {
    const time = formatTimestamp(entry.timestamp);
    const action = entry.actionType;
    const path = entry.path.length > 40 ? `...${entry.path.slice(-37)}` : entry.path;
    const result = RESULT_ICONS[entry.result];
    const approver = entry.approvedBy;
    const extra = entry.blockedByRule ? ` (${entry.blockedByRule})` : '';
    lines.push(`| ${time} | ${action} | \`${path}\` | ${result}${extra} | ${approver} |`);
  }

  // Add summary stats
  const successCount = entries.filter((e) => e.result === 'success').length;
  const rejectedCount = entries.filter((e) => e.result === 'rejected').length;
  const blockedCount = entries.filter((e) => e.result === 'blocked').length;
  const failedCount = entries.filter((e) => e.result === 'failed').length;

  lines.push('');
  lines.push(
    `**Summary:** ${successCount} succeeded, ${rejectedCount} rejected, ${blockedCount} blocked, ${failedCount} failed`,
  );

  return lines.join('\n');
};

/**
 * Format a session summary as a chat message card.
 */
export const formatSessionSummary = (summary: ActionSummary): string => {
  const lines: string[] = [];
  lines.push('**Session Summary**\n');

  const items: Array<[string, number]> = [];
  if (summary.filesCreated > 0) items.push(['files created', summary.filesCreated]);
  if (summary.filesEdited > 0) items.push(['files edited', summary.filesEdited]);
  if (summary.filesDeleted > 0) items.push(['files deleted', summary.filesDeleted]);
  if (summary.filesMoved > 0) items.push(['files moved', summary.filesMoved]);
  if (summary.filesCopied > 0) items.push(['files copied', summary.filesCopied]);
  if (summary.filesRenamed > 0) items.push(['files renamed', summary.filesRenamed]);
  if (summary.directoriesCreated > 0) {
    items.push(['directories created', summary.directoriesCreated]);
  }
  if (summary.commandsExecuted > 0) items.push(['commands executed', summary.commandsExecuted]);
  if (summary.actionsRejected > 0) items.push(['actions rejected', summary.actionsRejected]);
  if (summary.actionsBlocked > 0) items.push(['actions blocked', summary.actionsBlocked]);

  if (items.length === 0) {
    lines.push('No actions performed in this session.');
  } else {
    for (const [label, count] of items) {
      lines.push(`- ${count} ${label}`);
    }
  }

  lines.push(
    `- **Total:** ${summary.totalActions} actions in ${formatDuration(summary.durationMs)}`,
  );

  return lines.join('\n');
};
