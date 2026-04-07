/**
 * Hook for managing multi-session agent runtime state.
 * Polls the backend for session updates and listens for real-time events.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentSessionSummary, CreateSessionParams } from '@/lib/tauri-api-types';
import {
  listAgentSessions,
  createAgentSession,
  stopAgentSession,
  removeAgentSession,
} from '@/lib/tauri-api/agent-sessions';
import { listenToEvent } from '@xplorer/sdk';

const POLL_INTERVAL_MS = 2000;

export interface UseAgentSessionsResult {
  sessions: AgentSessionSummary[];
  loading: boolean;
  error: string | null;
  createSession: (params: CreateSessionParams) => Promise<AgentSessionSummary | null>;
  stopSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const useAgentSessions = (): UseAgentSessionsResult => {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchSessions = useCallback(async () => {
    try {
      const result = await listAgentSessions();
      if (mountedRef.current) {
        setSessions(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    mountedRef.current = true;
    fetchSessions();

    const interval = setInterval(fetchSessions, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchSessions]);

  // Listen for real-time session update events from the backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        unlisten = await listenToEvent('agent-session-update', (_payload: unknown) => {
          // Re-fetch all sessions on any update event for consistency
          fetchSessions();
        });
      } catch {
        // Event listening not available (e.g. in tests)
      }
    };

    setup();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [fetchSessions]);

  const createSession = useCallback(async (params: CreateSessionParams) => {
    try {
      const session = await createAgentSession(params);
      // Refresh sessions list immediately
      setSessions((prev) => [session, ...prev]);
      return session;
    } catch (err) {
      console.error('[AgentSessions] Failed to create session:', err);
      return null;
    }
  }, []);

  const stopSession = useCallback(
    async (sessionId: string) => {
      try {
        await stopAgentSession(sessionId);
        await fetchSessions();
      } catch (err) {
        console.error('[AgentSessions] Failed to stop session:', err);
      }
    },
    [fetchSessions],
  );

  const removeSessionHandler = useCallback(async (sessionId: string) => {
    try {
      await removeAgentSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error('[AgentSessions] Failed to remove session:', err);
    }
  }, []);

  return {
    sessions,
    loading,
    error,
    createSession,
    stopSession,
    removeSession: removeSessionHandler,
    refresh: fetchSessions,
  };
};

export default useAgentSessions;
