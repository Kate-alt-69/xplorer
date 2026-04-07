/**
 * Hook for tracking file changes per agent session.
 *
 * Subscribes to Tauri `fs-change` events and the `xplorer-external-agent`
 * custom DOM events, grouping every change by the agent session that is
 * most likely responsible (based on working directory overlap and timing).
 *
 * All data is kept in-memory (no localStorage) — session-scoped.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import type { AgentSessionSummary } from '@/lib/tauri-api-types';
import type { ExternalAgent } from './TerminalAgentDetector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileChangeType = 'created' | 'modified' | 'deleted';

export interface TrackedFileChange {
  /** Absolute file path */
  path: string;
  /** File name (last segment) */
  name: string;
  /** Kind of change */
  changeType: FileChangeType;
  /** Epoch-ms when the change was detected */
  timestamp: number;
}

export interface AgentFileChanges {
  /** Agent session id (cloud session id or external agent id) */
  agentId: string;
  /** Human-friendly agent label */
  agentName: string;
  /** Working directory the agent operates in */
  workingDirectory: string;
  /** Ordered list of file changes (newest first) */
  changes: TrackedFileChange[];
}

export interface UseFileChangesResult {
  /** Map of agentId -> AgentFileChanges */
  changesByAgent: Map<string, AgentFileChanges>;
  /** Get changes for a specific agent */
  getChangesForAgent: (agentId: string) => TrackedFileChange[];
  /** Total change count across all agents */
  totalChangeCount: number;
  /** Clear all tracked changes */
  clearAll: () => void;
  /** Clear changes for a specific agent */
  clearForAgent: (agentId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cap per-agent change list to prevent unbounded memory growth */
const MAX_CHANGES_PER_AGENT = 200;

/** Map fs-change event_type strings to our simplified enum */
const mapEventKind = (raw: string): FileChangeType | null => {
  const lower = raw.toLowerCase();
  if (lower.includes('create') || lower.includes('add')) return 'created';
  if (lower.includes('modify') || lower.includes('write') || lower.includes('change')) {
    return 'modified';
  }
  if (lower.includes('remove') || lower.includes('delete') || lower.includes('unlink')) {
    return 'deleted';
  }
  return 'modified'; // fallback — most file-system events are modifications
};

/** Extract the file name from an absolute path */
const extractName = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

/** Check whether `filePath` lives under (or equals) `directory` */
const isUnderDirectory = (filePath: string, directory: string): boolean => {
  if (!directory) return false;
  const normFile = filePath.replace(/\\/g, '/').toLowerCase();
  const normDir = directory.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  return normFile.startsWith(`${normDir}/`) || normFile === normDir;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useFileChanges = (
  /** Cloud agent sessions from the Rust backend */
  sessions: AgentSessionSummary[],
): UseFileChangesResult => {
  const [changesByAgent, setChangesByAgent] = useState<Map<string, AgentFileChanges>>(new Map());

  // Keep a mutable ref to external agents so the fs-change listener always
  // sees the latest set without re-subscribing.
  const externalAgentsRef = useRef<ExternalAgent[]>([]);
  const sessionsRef = useRef<AgentSessionSummary[]>(sessions);
  sessionsRef.current = sessions;

  // ------- Listen for external agent detection events -------
  useEffect(() => {
    const handleExternalAgent = (e: Event) => {
      const { agent, action } = (
        e as CustomEvent<{ agent: ExternalAgent; action: 'detected' | 'updated' | 'exited' }>
      ).detail;

      if (action === 'detected') {
        externalAgentsRef.current = [...externalAgentsRef.current, agent];
        // Initialise an entry
        setChangesByAgent((prev) => {
          if (prev.has(agent.id)) return prev;
          const next = new Map(prev);
          next.set(agent.id, {
            agentId: agent.id,
            agentName: agent.displayName,
            workingDirectory: agent.workingDirectory,
            changes: [],
          });
          return next;
        });
      } else if (action === 'updated') {
        externalAgentsRef.current = externalAgentsRef.current.map((a) =>
          a.id === agent.id ? agent : a,
        );
      } else if (action === 'exited') {
        // Keep the data — just stop tracking new events for this agent
        externalAgentsRef.current = externalAgentsRef.current.filter((a) => a.id !== agent.id);
      }
    };

    window.addEventListener('xplorer-external-agent', handleExternalAgent);
    return () => window.removeEventListener('xplorer-external-agent', handleExternalAgent);
  }, []);

  // ------- Initialise entries for cloud sessions -------
  useEffect(() => {
    setChangesByAgent((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const session of sessions) {
        if (!next.has(session.id)) {
          next.set(session.id, {
            agentId: session.id,
            agentName: session.name,
            workingDirectory: session.working_directory,
            changes: [],
          });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  // ------- Subscribe to fs-change Tauri events -------
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        unlisten = await TauriAPI.listenToEvent<{
          watcher_id?: string;
          path: string;
          event_type?: string;
          kind?: string;
          timestamp?: number;
        }>('fs-change', (event) => {
          const filePath = event.path;
          const changeType = mapEventKind(event.event_type || event.kind || 'modify');
          if (!changeType) return;

          const now = event.timestamp || Date.now();
          const change: TrackedFileChange = {
            path: filePath,
            name: extractName(filePath),
            changeType,
            timestamp: now,
          };

          // Determine which agent(s) own this change based on working directory
          const matchedAgentIds: string[] = [];

          // Check cloud sessions
          for (const session of sessionsRef.current) {
            const isActive =
              session.status === 'thinking' ||
              session.status === 'executing' ||
              session.status === 'waiting_approval';
            if (isActive && isUnderDirectory(filePath, session.working_directory)) {
              matchedAgentIds.push(session.id);
            }
          }

          // Check external agents
          for (const ext of externalAgentsRef.current) {
            if (
              ext.status === 'active' &&
              ext.workingDirectory &&
              isUnderDirectory(filePath, ext.workingDirectory)
            ) {
              matchedAgentIds.push(ext.id);
            }
          }

          if (matchedAgentIds.length === 0) return;

          setChangesByAgent((prev) => {
            const next = new Map(prev);
            for (const agentId of matchedAgentIds) {
              const existing = next.get(agentId);
              if (!existing) continue;

              // De-duplicate: if the same path already exists within the last 2s, update it
              const recentIdx = existing.changes.findIndex(
                (c) => c.path === filePath && now - c.timestamp < 2000,
              );

              let updatedChanges: TrackedFileChange[];
              if (recentIdx >= 0) {
                updatedChanges = [...existing.changes];
                updatedChanges[recentIdx] = change;
              } else {
                updatedChanges = [change, ...existing.changes].slice(0, MAX_CHANGES_PER_AGENT);
              }

              next.set(agentId, { ...existing, changes: updatedChanges });
            }
            return next;
          });
        });
      } catch (err) {
        console.warn('[FileChangeTracker] Failed to subscribe to fs-change events:', err);
      }
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, []);

  // ------- Public API -------

  const getChangesForAgent = useCallback(
    (agentId: string): TrackedFileChange[] => changesByAgent.get(agentId)?.changes ?? [],
    [changesByAgent],
  );

  const totalChangeCount = Array.from(changesByAgent.values()).reduce(
    (sum, entry) => sum + entry.changes.length,
    0,
  );

  const clearAll = useCallback(() => {
    setChangesByAgent((prev) => {
      const next = new Map<string, AgentFileChanges>();
      for (const [id, entry] of prev) {
        next.set(id, { ...entry, changes: [] });
      }
      return next;
    });
  }, []);

  const clearForAgent = useCallback((agentId: string) => {
    setChangesByAgent((prev) => {
      const entry = prev.get(agentId);
      if (!entry || entry.changes.length === 0) return prev;
      const next = new Map(prev);
      next.set(agentId, { ...entry, changes: [] });
      return next;
    });
  }, []);

  return {
    changesByAgent,
    getChangesForAgent,
    totalChangeCount,
    clearAll,
    clearForAgent,
  };
};
