/**
 * Agent Persistence — saves running agent sessions to localStorage so they
 * survive Xplorer restarts. Terminal sessions (done/error/cancelled) are
 * already saved to session history; this module handles in-flight sessions.
 *
 * - Periodically snapshots RUNNING agent state every 30 seconds
 * - On startup, checks for interrupted sessions and exposes them for resume
 * - Max 5 interrupted sessions saved
 * - Storage key: `xplorer:agent-interrupted-sessions`
 */

import type {
  AgentSessionSummary,
  AgentSessionStatus,
  AgentScopeConfig,
} from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'xplorer:agent-interrupted-sessions';
const SAVE_INTERVAL_MS = 30_000;
const MAX_INTERRUPTED_SESSIONS = 5;
const MAX_MESSAGES_SAVED = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InterruptedMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
}

export interface InterruptedSession {
  /** Original session ID */
  id: string;
  name: string;
  prompt: string;
  model: string;
  provider: string;
  working_directory: string;
  selected_files: string[];
  project_context: string | null;
  scope: AgentScopeConfig | null;
  /** When the session was originally created */
  created_at: number;
  /** When this snapshot was taken */
  saved_at: number;
  /** Last known status before interruption */
  last_status: AgentSessionStatus;
  /** Last N conversation messages */
  messages: InterruptedMessage[];
  /** Files changed so far */
  file_changes: string[];
  /** Estimated cost in USD */
  cost_usd: number;
  /** Tool calls made */
  tool_calls_count: number;
  /** File changes count */
  file_changes_count: number;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const loadInterruptedSessions = (): InterruptedSession[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is InterruptedSession =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as InterruptedSession).id === 'string' &&
        typeof (s as InterruptedSession).prompt === 'string' &&
        typeof (s as InterruptedSession).saved_at === 'number',
    );
  } catch {
    return [];
  }
};

const saveInterruptedSessions = (sessions: InterruptedSession[]): void => {
  try {
    const trimmed = sessions.slice(0, MAX_INTERRUPTED_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    console.warn('[agent-persistence] Failed to save interrupted sessions');
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if there are interrupted sessions from a previous run.
 * Should be called on app startup.
 */
export const getInterruptedSessions = (): InterruptedSession[] => {
  return loadInterruptedSessions();
};

/**
 * Check whether any interrupted sessions exist.
 */
export const hasInterruptedSessions = (): boolean => {
  return loadInterruptedSessions().length > 0;
};

/**
 * Clear all interrupted sessions (used after resume or discard).
 */
export const clearInterruptedSessions = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    console.warn('[agent-persistence] Failed to clear interrupted sessions');
  }
};

/**
 * Remove specific interrupted sessions by ID.
 */
export const removeInterruptedSessions = (idsToRemove: Set<string>): void => {
  const current = loadInterruptedSessions();
  const filtered = current.filter((s) => !idsToRemove.has(s.id));
  if (filtered.length === 0) {
    clearInterruptedSessions();
  } else {
    saveInterruptedSessions(filtered);
  }
};

/**
 * Determine whether a session status is considered "active" (non-terminal).
 */
const isActiveStatus = (status: AgentSessionStatus): boolean =>
  status === 'idle' ||
  status === 'thinking' ||
  status === 'executing' ||
  status === 'waiting_approval';

/**
 * Snapshot currently running sessions for persistence.
 * Called periodically by the persistence timer.
 */
export const snapshotRunningSessions = (
  sessions: AgentSessionSummary[],
  getMessages?: (sessionId: string) => InterruptedMessage[],
  getCost?: (sessionId: string) => number,
  getFileChanges?: (sessionId: string) => string[],
): void => {
  const activeSessions = sessions.filter((s) => isActiveStatus(s.status));

  if (activeSessions.length === 0) {
    // No active sessions -- clear any previous snapshots
    clearInterruptedSessions();
    return;
  }

  const snapshots: InterruptedSession[] = activeSessions
    .slice(0, MAX_INTERRUPTED_SESSIONS)
    .map((session) => ({
      id: session.id,
      name: session.name,
      prompt: session.prompt,
      model: session.model,
      provider: session.provider,
      working_directory: session.working_directory,
      selected_files: session.selected_files,
      project_context: session.project_context,
      scope: session.scope,
      created_at: session.created_at,
      saved_at: Date.now(),
      last_status: session.status,
      messages: (getMessages?.(session.id) ?? []).slice(-MAX_MESSAGES_SAVED),
      file_changes: getFileChanges?.(session.id) ?? [],
      cost_usd: getCost?.(session.id) ?? 0,
      tool_calls_count: session.tool_calls_count,
      file_changes_count: session.file_changes_count,
    }));

  saveInterruptedSessions(snapshots);
};

/**
 * Build resume parameters from an interrupted session.
 * Returns the data needed to recreate a session via the NewAgentForm.
 */
export const buildResumeParams = (
  interrupted: InterruptedSession,
): {
  name: string;
  prompt: string;
  model: string;
  working_directory: string;
  selected_files: string[];
  project_context: string | null;
  scope: AgentScopeConfig | null;
  resumeContext: string;
} => {
  const contextParts: string[] = [
    `[Resumed Session]`,
    `Originally started: ${new Date(interrupted.created_at).toLocaleString()}`,
    `Last saved: ${new Date(interrupted.saved_at).toLocaleString()}`,
    `Files changed: ${interrupted.file_changes_count}`,
    `Tool calls made: ${interrupted.tool_calls_count}`,
  ];

  if (interrupted.messages.length > 0) {
    contextParts.push('');
    contextParts.push('--- Previous conversation (last messages) ---');
    for (const msg of interrupted.messages.slice(-5)) {
      let role = 'Tool';
      if (msg.role === 'user') role = 'User';
      else if (msg.role === 'assistant') role = 'Agent';
      const preview = msg.content.length > 200 ? `${msg.content.slice(0, 200)}...` : msg.content;
      contextParts.push(`${role}: ${preview}`);
    }
  }

  return {
    name: `${interrupted.name} (resumed)`,
    prompt: interrupted.prompt,
    model: interrupted.model,
    working_directory: interrupted.working_directory,
    selected_files: interrupted.selected_files,
    project_context: interrupted.project_context,
    scope: interrupted.scope,
    resumeContext: contextParts.join('\n'),
  };
};

// ---------------------------------------------------------------------------
// Persistence Timer
// ---------------------------------------------------------------------------

let persistenceTimerId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic persistence timer. Call once on app startup.
 * Returns a cleanup function to stop the timer.
 */
export const startPersistenceTimer = (
  getSessions: () => AgentSessionSummary[],
  getMessages?: (sessionId: string) => InterruptedMessage[],
  getCost?: (sessionId: string) => number,
  getFileChanges?: (sessionId: string) => string[],
): (() => void) => {
  // Clear any existing timer
  if (persistenceTimerId !== null) {
    clearInterval(persistenceTimerId);
  }

  persistenceTimerId = setInterval(() => {
    const sessions = getSessions();
    snapshotRunningSessions(sessions, getMessages, getCost, getFileChanges);
  }, SAVE_INTERVAL_MS);

  return () => {
    if (persistenceTimerId !== null) {
      clearInterval(persistenceTimerId);
      persistenceTimerId = null;
    }
  };
};

/**
 * Stop the persistence timer.
 */
export const stopPersistenceTimer = (): void => {
  if (persistenceTimerId !== null) {
    clearInterval(persistenceTimerId);
    persistenceTimerId = null;
  }
};
