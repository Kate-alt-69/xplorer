/**
 * Shared agent manager state — single React context that provides
 * all agent session state to any view (sidebar, bottom panel, fullscreen).
 *
 * Polls Rust backend for session list, manages local conversation
 * messages/approvals, cost tracking, and file change state. All
 * views consume the same context so state stays in sync.
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import type { AgentSessionSummary, CreateSessionParams } from '@/lib/tauri-api-types';
import type { AgentMessage, PendingApproval } from './AgentConversationView';
import type { SessionCostEntry } from './use-cost-tracking';
import {
  startPersistenceTimer,
  stopPersistenceTimer,
  getInterruptedSessions,
  hasInterruptedSessions,
  type InterruptedSession,
} from './agent-persistence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentManagerState {
  /** All agent sessions from the Rust backend */
  sessions: AgentSessionSummary[];
  /** Whether the session list is loading */
  loading: boolean;
  /** Conversation messages keyed by session ID */
  messagesBySession: Map<string, AgentMessage[]>;
  /** Pending approvals keyed by session ID */
  approvalsBySession: Map<string, PendingApproval[]>;
  /** Cost entries keyed by session ID */
  sessionCosts: Map<string, SessionCostEntry>;
  /** Interrupted sessions found on startup */
  interruptedSessions: InterruptedSession[];
  /** Whether the resume dialog should be shown */
  showResumeDialog: boolean;

  /** Create a new agent session */
  createSession: (params: CreateSessionParams) => Promise<void>;
  /** Stop a running session */
  stopSession: (sessionId: string) => Promise<void>;
  /** Remove a terminal session */
  removeSession: (sessionId: string) => Promise<void>;
  /** Send a message to a session */
  sendMessage: (sessionId: string, message: string) => void;
  /** Approve a pending action */
  approveAction: (approvalId: string) => void;
  /** Reject a pending action */
  rejectAction: (approvalId: string) => void;
  /** Refresh the session list from backend */
  refreshSessions: () => Promise<void>;
  /** Dismiss the resume dialog */
  dismissResumeDialog: () => void;
  /** Format cost for display */
  formatCost: (costUsd: number) => string;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const defaultState: AgentManagerState = {
  sessions: [],
  loading: false,
  messagesBySession: new Map(),
  approvalsBySession: new Map(),
  sessionCosts: new Map(),
  interruptedSessions: [],
  showResumeDialog: false,
  createSession: async () => {},
  stopSession: async () => {},
  removeSession: async () => {},
  sendMessage: () => {},
  approveAction: () => {},
  rejectAction: () => {},
  refreshSessions: async () => {},
  dismissResumeDialog: () => {},
  formatCost: () => '$0.00',
};

export const AgentManagerContext = createContext<AgentManagerState>(defaultState);

/** Hook to access agent manager state from any component. */
export const useAgentManagerState = (): AgentManagerState => {
  const ctx = useContext(AgentManagerContext);
  return ctx;
};

// ---------------------------------------------------------------------------
// Poll interval
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000;

// ---------------------------------------------------------------------------
// Provider hook — returns the state value to pass to the context provider
// ---------------------------------------------------------------------------

/**
 * Core hook that manages all agent state. Use inside AgentManagerProvider.
 * Returns the full AgentManagerState to pass as context value.
 */
export const useAgentManagerProvider = (): AgentManagerState => {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [messagesBySession, setMessagesBySession] = useState<Map<string, AgentMessage[]>>(
    () => new Map(),
  );
  const [approvalsBySession, setApprovalsBySession] = useState<Map<string, PendingApproval[]>>(
    () => new Map(),
  );
  const [sessionCosts, setSessionCosts] = useState<Map<string, SessionCostEntry>>(() => new Map());
  const [interruptedSessions, setInterruptedSessions] = useState<InterruptedSession[]>([]);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch sessions from backend ────────────────────────────────────
  const refreshSessions = useCallback(async () => {
    try {
      const result = await TauriAPI.listAgentSessions();
      setSessions(result);
    } catch (err) {
      console.error('[agent-manager-state] Failed to list sessions:', err);
    }
  }, []);

  // ── Initial load + polling ─────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    refreshSessions().finally(() => setLoading(false));

    pollRef.current = setInterval(() => {
      refreshSessions();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
      }
    };
  }, [refreshSessions]);

  // ── Check interrupted sessions on mount ────────────────────────────
  useEffect(() => {
    if (hasInterruptedSessions()) {
      const interrupted = getInterruptedSessions();
      setInterruptedSessions(interrupted);
      setShowResumeDialog(true);
    }
  }, []);

  // ── Start persistence timer ────────────────────────────────────────
  useEffect(() => {
    const getMessages = (
      sessionId: string,
    ): Array<{ role: 'user' | 'assistant' | 'tool'; content: string; timestamp: number }> => {
      const msgs = messagesBySession.get(sessionId);
      if (!msgs) return [];
      return msgs.map((m) => {
        let role: 'user' | 'assistant' | 'tool' = 'tool';
        if (m.role === 'user') role = 'user';
        else if (m.role === 'assistant') role = 'assistant';
        return {
          role,
          content: m.content,
          timestamp: m.timestamp ?? Date.now(),
        };
      });
    };

    const getCost = (sessionId: string): number => {
      const entry = sessionCosts.get(sessionId);
      return entry?.costUsd ?? 0;
    };

    const cleanup = startPersistenceTimer(() => sessions, getMessages, getCost);

    return () => {
      cleanup();
      stopPersistenceTimer();
    };
  }, [sessions, messagesBySession, sessionCosts]);

  // ── Create session ─────────────────────────────────────────────────
  const createSession = useCallback(
    async (params: CreateSessionParams) => {
      try {
        await TauriAPI.createAgentSession(params);
        await refreshSessions();
      } catch (err) {
        console.error('[agent-manager-state] Failed to create session:', err);
      }
    },
    [refreshSessions],
  );

  // ── Stop session ───────────────────────────────────────────────────
  const stopSession = useCallback(
    async (sessionId: string) => {
      try {
        await TauriAPI.stopAgentSession(sessionId);
        await refreshSessions();
      } catch (err) {
        console.error('[agent-manager-state] Failed to stop session:', err);
      }
    },
    [refreshSessions],
  );

  // ── Remove session ─────────────────────────────────────────────────
  const removeSession = useCallback(async (sessionId: string) => {
    try {
      await TauriAPI.removeAgentSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setMessagesBySession((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      setApprovalsBySession((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      setSessionCosts((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
    } catch (err) {
      console.error('[agent-manager-state] Failed to remove session:', err);
    }
  }, []);

  // ── Send message ───────────────────────────────────────────────────
  const sendMessage = useCallback((sessionId: string, message: string) => {
    const newMsg: AgentMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };

    setMessagesBySession((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId) ?? [];
      next.set(sessionId, [...existing, newMsg]);
      return next;
    });

    // Dispatch event for the conversation view to handle actual API call
    window.dispatchEvent(
      new CustomEvent('xplorer-agent-send-message', {
        detail: { sessionId, message },
      }),
    );
  }, []);

  // ── Approve / reject ───────────────────────────────────────────────
  const approveAction = useCallback((approvalId: string) => {
    window.dispatchEvent(new CustomEvent('xplorer-agent-approve', { detail: { approvalId } }));
  }, []);

  const rejectAction = useCallback((approvalId: string) => {
    window.dispatchEvent(new CustomEvent('xplorer-agent-reject', { detail: { approvalId } }));
  }, []);

  // ── Dismiss resume dialog ──────────────────────────────────────────
  const dismissResumeDialog = useCallback(() => {
    setShowResumeDialog(false);
    setInterruptedSessions([]);
  }, []);

  // ── Format cost helper ─────────────────────────────────────────────
  const formatCost = useCallback((costUsd: number): string => {
    if (costUsd < 0.01) return '<$0.01';
    return `$${costUsd.toFixed(2)}`;
  }, []);

  // ── Listen for external state updates ──────────────────────────────
  useEffect(() => {
    const handleMessageUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | {
            sessionId: string;
            messages: AgentMessage[];
          }
        | undefined;
      if (!detail) return;
      setMessagesBySession((prev) => {
        const next = new Map(prev);
        next.set(detail.sessionId, detail.messages);
        return next;
      });
    };

    const handleCostUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | {
            sessionId: string;
            cost: SessionCostEntry;
          }
        | undefined;
      if (!detail) return;
      setSessionCosts((prev) => {
        const next = new Map(prev);
        next.set(detail.sessionId, detail.cost);
        return next;
      });
    };

    const handleApprovalUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | {
            sessionId: string;
            approvals: PendingApproval[];
          }
        | undefined;
      if (!detail) return;
      setApprovalsBySession((prev) => {
        const next = new Map(prev);
        next.set(detail.sessionId, detail.approvals);
        return next;
      });
    };

    window.addEventListener('xplorer-agent-messages-update', handleMessageUpdate);
    window.addEventListener('xplorer-agent-cost-update', handleCostUpdate);
    window.addEventListener('xplorer-agent-approvals-update', handleApprovalUpdate);

    return () => {
      window.removeEventListener('xplorer-agent-messages-update', handleMessageUpdate);
      window.removeEventListener('xplorer-agent-cost-update', handleCostUpdate);
      window.removeEventListener('xplorer-agent-approvals-update', handleApprovalUpdate);
    };
  }, []);

  return useMemo(
    () => ({
      sessions,
      loading,
      messagesBySession,
      approvalsBySession,
      sessionCosts,
      interruptedSessions,
      showResumeDialog,
      createSession,
      stopSession,
      removeSession,
      sendMessage,
      approveAction,
      rejectAction,
      refreshSessions,
      dismissResumeDialog,
      formatCost,
    }),
    [
      sessions,
      loading,
      messagesBySession,
      approvalsBySession,
      sessionCosts,
      interruptedSessions,
      showResumeDialog,
      createSession,
      stopSession,
      removeSession,
      sendMessage,
      approveAction,
      rejectAction,
      refreshSessions,
      dismissResumeDialog,
      formatCost,
    ],
  );
};
