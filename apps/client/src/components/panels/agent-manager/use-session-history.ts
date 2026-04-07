/**
 * Hook for persisting completed agent sessions to localStorage.
 *
 * When an agent session transitions to a terminal state (done, error,
 * cancelled), a summary record is saved. Users can review past work
 * through the SessionHistory component.
 *
 * Max 50 sessions stored; oldest are auto-evicted.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import type { AgentSessionSummary, AgentSessionStatus } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionHistoryEntry {
  /** Unique session identifier */
  id: string;
  /** Human-readable session name */
  name: string;
  /** Original prompt sent to the agent */
  prompt: string;
  /** Model used (e.g. "claude-sonnet-4-20250514") */
  model: string;
  /** Provider (e.g. "anthropic") */
  provider: string;
  /** Terminal status: done | error | cancelled */
  resultStatus: 'done' | 'error' | 'cancelled';
  /** Working directory the agent operated in */
  workingDirectory: string;
  /** Epoch-ms when session was created */
  createdAt: number;
  /** Epoch-ms when session completed */
  completedAt: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Number of files changed by the agent */
  filesChangedCount: number;
  /** Number of tool calls made */
  toolCallsCount: number;
  /** Number of conversation turns */
  turnsCompleted: number;
  /** Estimated cost in USD (if available) */
  costUsd: number | null;
  /** Error message (for error status) */
  errorMessage: string | null;
}

export interface UseSessionHistoryResult {
  /** All stored session history entries (newest first) */
  entries: SessionHistoryEntry[];
  /** Get a specific entry by id */
  getEntry: (id: string) => SessionHistoryEntry | undefined;
  /** Clear all history */
  clearAll: () => void;
  /** Remove a single entry */
  removeEntry: (id: string) => void;
  /** Total number of stored sessions */
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY_ENTRIES = 50;

const TERMINAL_STATUSES: AgentSessionStatus[] = ['done', 'error', 'cancelled'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const loadHistory = (): SessionHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_SESSION_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as SessionHistoryEntry[];
  } catch {
    return [];
  }
};

const saveHistory = (entries: SessionHistoryEntry[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.AGENT_SESSION_HISTORY, JSON.stringify(entries));
  } catch {
    // Storage unavailable — silently fail
  }
};

const isTerminalStatus = (status: AgentSessionStatus): boolean =>
  TERMINAL_STATUSES.includes(status);

const sessionToEntry = (
  session: AgentSessionSummary,
  costUsd: number | null,
): SessionHistoryEntry => ({
  id: session.id,
  name: session.name,
  prompt: session.prompt,
  model: session.model,
  provider: session.provider,
  resultStatus: session.status as 'done' | 'error' | 'cancelled',
  workingDirectory: session.working_directory,
  createdAt: session.created_at,
  completedAt: session.updated_at,
  durationMs: session.updated_at - session.created_at,
  filesChangedCount: session.file_changes_count,
  toolCallsCount: session.tool_calls_count,
  turnsCompleted: session.turns_completed,
  costUsd,
  errorMessage: session.error_message,
});

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSessionHistory = (
  /** Current sessions from the Rust backend */
  sessions: AgentSessionSummary[],
  /** Optional cost lookup for a session */
  getSessionCost?: (sessionId: string) => number | undefined,
): UseSessionHistoryResult => {
  const [entries, setEntries] = useState<SessionHistoryEntry[]>(() => loadHistory());

  // Track which session ids we have already saved so we don't re-save
  const savedIdsRef = useRef<Set<string>>(new Set(entries.map((e) => e.id)));

  // Watch for sessions transitioning to terminal state
  useEffect(() => {
    let changed = false;
    const newEntries = [...entries];

    for (const session of sessions) {
      if (!isTerminalStatus(session.status)) continue;
      if (savedIdsRef.current.has(session.id)) continue;

      const costUsd = getSessionCost?.(session.id) ?? null;
      const entry = sessionToEntry(session, costUsd);
      newEntries.unshift(entry);
      savedIdsRef.current.add(session.id);
      changed = true;
    }

    if (changed) {
      // Trim to max
      const trimmed = newEntries.slice(0, MAX_HISTORY_ENTRIES);
      setEntries(trimmed);
      saveHistory(trimmed);
    }
  }, [sessions, entries, getSessionCost]);

  const getEntry = useCallback(
    (id: string): SessionHistoryEntry | undefined => entries.find((e) => e.id === id),
    [entries],
  );

  const clearAll = useCallback(() => {
    setEntries([]);
    savedIdsRef.current.clear();
    saveHistory([]);
  }, []);

  const removeEntry = useCallback(
    (id: string) => {
      const updated = entries.filter((e) => e.id !== id);
      savedIdsRef.current.delete(id);
      setEntries(updated);
      saveHistory(updated);
    },
    [entries],
  );

  return {
    entries,
    getEntry,
    clearAll,
    removeEntry,
    totalCount: entries.length,
  };
};
