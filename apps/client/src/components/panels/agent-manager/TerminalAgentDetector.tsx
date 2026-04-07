/**
 * Terminal Agent Detector — monitors PTY terminal output for
 * Claude Code, Codex, and other AI agents running in Xplorer's
 * integrated terminal tabs.
 *
 * When an external agent is detected, it emits events so the
 * Agent Manager can display them alongside built-in agents.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Eye, EyeOff, FileText } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import type { PtyOutputPayload } from '@/lib/tauri-api/pty';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExternalAgentType = 'claude-code' | 'codex' | 'aider' | 'unknown';

export type ExternalAgentStatus = 'active' | 'idle' | 'exited';

export interface ExternalAgent {
  id: string;
  type: ExternalAgentType;
  displayName: string;
  terminalSessionId: string;
  terminalLabel: string;
  workingDirectory: string;
  status: ExternalAgentStatus;
  detectedAt: number;
  lastActivityAt: number;
  filesChanged: string[];
}

export interface TerminalAgentDetectorProps {
  /** Suppress rendered output (hook-only mode) */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

const CLAUDE_CODE_PATTERNS = [
  /Claude Code v[\d.]/i,
  /claude>/,
  /Opus 4/i,
  /Sonnet 4/i,
  /claude-opus/i,
  /claude-sonnet/i,
  /╭─.*claude/i,
  /\bclaude\s+code\b/i,
];

const CODEX_PATTERNS = [/Codex CLI/i, /codex>/, /\bcodex\b.*v[\d.]/i, /openai\/codex/i];

const AIDER_PATTERNS = [/\baider\b.*v[\d.]/i, /aider>/i, /Aider chat/i];

const GENERIC_AI_PATTERNS = [
  /\bagent\s+loop\b/i,
  /\btool\s+call\b/i,
  /\bthinking\.\.\.\b/i,
  /\b(reading|writing|editing)\s+file\b/i,
];

/** Idle timeout: if no output for 30s, mark as idle */
const IDLE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const detectAgentType = (text: string): ExternalAgentType | null => {
  for (const pat of CLAUDE_CODE_PATTERNS) {
    if (pat.test(text)) return 'claude-code';
  }
  for (const pat of CODEX_PATTERNS) {
    if (pat.test(text)) return 'codex';
  }
  for (const pat of AIDER_PATTERNS) {
    if (pat.test(text)) return 'aider';
  }
  for (const pat of GENERIC_AI_PATTERNS) {
    if (pat.test(text)) return 'unknown';
  }
  return null;
};

const getDisplayName = (type: ExternalAgentType): string => {
  switch (type) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex CLI';
    case 'aider':
      return 'Aider';
    case 'unknown':
      return 'AI Agent';
  }
};

/** Detect file paths mentioned in terminal output */
const FILE_PATH_RE =
  /(?:(?:reading|writing|editing|created|modified|deleted)\s+)?(?:file\s+)?['"`]?((?:\/|[A-Z]:\\)[\w/.\\-]+\.\w+)['"`]?/gi;

const extractFilePaths = (text: string): string[] => {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  // Reset lastIndex to ensure global regex works correctly
  FILE_PATH_RE.lastIndex = 0;
  while ((m = FILE_PATH_RE.exec(text)) !== null) {
    if (m[1]) matches.push(m[1]);
  }
  return matches;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TerminalAgentDetector = ({ hidden }: TerminalAgentDetectorProps) => {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Map<string, ExternalAgent>>(new Map());
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);
  const idleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Broadcast detected agents to the Agent Manager
  const emitAgentUpdate = useCallback(
    (agent: ExternalAgent, action: 'detected' | 'updated' | 'exited') => {
      window.dispatchEvent(
        new CustomEvent('xplorer-external-agent', {
          detail: { agent, action },
        }),
      );
    },
    [],
  );

  // Mark an agent as idle after timeout
  const scheduleIdleCheck = useCallback(
    (sessionId: string) => {
      const existing = idleTimersRef.current.get(sessionId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        setAgents((prev) => {
          const next = new Map(prev);
          const agent = next.get(sessionId);
          if (agent && agent.status === 'active') {
            const updated = { ...agent, status: 'idle' as const };
            next.set(sessionId, updated);
            emitAgentUpdate(updated, 'updated');
          }
          return next;
        });
      }, IDLE_TIMEOUT_MS);

      idleTimersRef.current.set(sessionId, timer);
    },
    [emitAgentUpdate],
  );

  // Process PTY output and detect agents
  const handlePtyOutput = useCallback(
    (payload: PtyOutputPayload) => {
      if (!monitoringEnabled) return;

      const { session_id, data } = payload;
      // Strip ANSI escape codes for pattern matching
      // eslint-disable-next-line no-control-regex
      const cleanData = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

      setAgents((prev) => {
        const existing = prev.get(session_id);

        if (existing) {
          // Already tracking — update activity and check for file paths
          const filePaths = extractFilePaths(cleanData);
          const newFiles = filePaths.filter((f) => !existing.filesChanged.includes(f));

          const updated: ExternalAgent = {
            ...existing,
            status: 'active',
            lastActivityAt: Date.now(),
            filesChanged:
              newFiles.length > 0
                ? [...existing.filesChanged, ...newFiles].slice(-100)
                : existing.filesChanged,
          };
          const next = new Map(prev);
          next.set(session_id, updated);
          emitAgentUpdate(updated, 'updated');
          scheduleIdleCheck(session_id);
          return next;
        }

        // Try to detect a new agent
        const agentType = detectAgentType(cleanData);
        if (!agentType) return prev;

        const newAgent: ExternalAgent = {
          id: `ext-${session_id}`,
          type: agentType,
          displayName: getDisplayName(agentType),
          terminalSessionId: session_id,
          terminalLabel: `Terminal (${session_id.slice(-6)})`,
          workingDirectory: '',
          status: 'active',
          detectedAt: Date.now(),
          lastActivityAt: Date.now(),
          filesChanged: extractFilePaths(cleanData),
        };

        const next = new Map(prev);
        next.set(session_id, newAgent);
        emitAgentUpdate(newAgent, 'detected');
        scheduleIdleCheck(session_id);
        return next;
      });
    },
    [monitoringEnabled, emitAgentUpdate, scheduleIdleCheck],
  );

  // Listen to PTY output
  useEffect(() => {
    if (!monitoringEnabled) return;

    let unlisten: (() => void) | undefined;
    TauriAPI.listenToPtyOutput((payload: PtyOutputPayload) => {
      handlePtyOutput(payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [monitoringEnabled, handlePtyOutput]);

  // Listen to PTY exit to mark agents as exited
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    TauriAPI.listenToPtyExit((sessionId: string) => {
      setAgents((prev) => {
        const agent = prev.get(sessionId);
        if (!agent) return prev;

        const updated = { ...agent, status: 'exited' as const };
        const next = new Map(prev);
        next.set(sessionId, updated);
        emitAgentUpdate(updated, 'exited');
        return next;
      });

      // Clear idle timer
      const timer = idleTimersRef.current.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        idleTimersRef.current.delete(sessionId);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [emitAgentUpdate]);

  // Cleanup idle timers on unmount
  useEffect(() => {
    const timers = idleTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const toggleMonitoring = useCallback(() => {
    setMonitoringEnabled((v) => !v);
  }, []);

  const dismissAgent = useCallback(
    (sessionId: string) => {
      setAgents((prev) => {
        const agent = prev.get(sessionId);
        if (agent) emitAgentUpdate(agent, 'exited');
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
    },
    [emitAgentUpdate],
  );

  if (hidden) return null;

  const agentList = Array.from(agents.values());
  const activeCount = agentList.filter((a) => a.status === 'active').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 0',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: 'var(--xp-text-muted)',
          }}
        >
          <Terminal size={12} />
          <span>{t('agentManager.externalAgents.title')}</span>
          {activeCount > 0 && (
            <span
              style={{
                background: 'var(--xp-cyan, #7dcfff)',
                color: '#fff',
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '8px',
              }}
            >
              {activeCount}
            </span>
          )}
        </div>
        <button
          onClick={toggleMonitoring}
          title={
            monitoringEnabled
              ? t('agentManager.externalAgents.disableMonitoring')
              : t('agentManager.externalAgents.enableMonitoring')
          }
          aria-label={
            monitoringEnabled
              ? t('agentManager.externalAgents.disableMonitoring')
              : t('agentManager.externalAgents.enableMonitoring')
          }
          style={{
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            padding: '2px 6px',
            cursor: 'pointer',
            color: monitoringEnabled ? 'var(--xp-green, #73daca)' : 'var(--xp-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10px',
          }}
        >
          {monitoringEnabled ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
      </div>

      {/* Agent list */}
      {agentList.length === 0 ? (
        <div
          style={{
            padding: '8px',
            color: 'var(--xp-text-muted)',
            fontSize: '10px',
            textAlign: 'center',
          }}
        >
          {monitoringEnabled
            ? t('agentManager.externalAgents.noDetected')
            : t('agentManager.externalAgents.monitoringOff')}
        </div>
      ) : (
        agentList.map((agent) => {
          const statusColor =
            agent.status === 'active'
              ? 'var(--xp-green, #73daca)'
              : agent.status === 'idle'
                ? 'var(--xp-warning, #e0af68)'
                : 'var(--xp-text-muted)';

          return (
            <div
              key={agent.id}
              style={{
                border: '1px solid var(--xp-border)',
                borderRadius: '6px',
                padding: '8px',
                background: 'var(--xp-surface)',
              }}
            >
              {/* Row 1: Name + status */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {/* Status dot */}
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: statusColor,
                    flexShrink: 0,
                    animation: agent.status === 'active' ? 'pulse 2s infinite' : undefined,
                  }}
                />

                <span
                  style={{
                    flex: 1,
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--xp-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {agent.displayName}
                </span>

                <span
                  style={{
                    fontSize: '9px',
                    color: statusColor,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                  }}
                >
                  {t(`agentManager.externalAgents.status.${agent.status}`)}
                </span>

                <button
                  onClick={() => dismissAgent(agent.terminalSessionId)}
                  title={t('agentManager.externalAgents.dismiss')}
                  aria-label={t('agentManager.externalAgents.dismiss')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--xp-text-muted)',
                    padding: '0 2px',
                    fontSize: '14px',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>

              {/* Row 2: Terminal tab */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginTop: '4px',
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                }}
              >
                <Terminal size={10} />
                <span>{agent.terminalLabel}</span>
              </div>

              {/* Row 3: Files changed */}
              {agent.filesChanged.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginTop: '4px',
                    fontSize: '10px',
                    color: 'var(--xp-text-muted)',
                  }}
                >
                  <FileText size={10} />
                  <span>
                    {t('agentManager.externalAgents.filesChanged', {
                      count: agent.filesChanged.length,
                    })}
                  </span>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default TerminalAgentDetector;
