/**
 * Active Agents section — shows currently running AI agent sessions
 * with status, elapsed time, model, file changes, and stop/remove controls.
 *
 * Supports both legacy event-driven AgentTask entries and the new
 * multi-session AgentSessionSummary entries from the Rust backend.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Square,
  Loader2,
  Trash2,
  AlertCircle,
  Folder,
} from 'lucide-react';
import type { AgentSessionSummary, AgentSessionStatus } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentTask {
  id: string;
  description: string;
  status: 'thinking' | 'executing' | 'waiting-approval';
  startedAt: number;
  /** Current step label (e.g. "Reading file...") */
  currentStep?: string;
  /** Files being processed */
  files?: string[];
  /** 0-100 progress for multi-step tasks */
  progress?: number;
  /** Total steps for multi-step tasks */
  totalSteps?: number;
  /** Current step index */
  currentStepIndex?: number;
}

interface ActiveAgentsProps {
  agents: AgentTask[];
  onStop: (id: string) => void;
  /** Multi-session agent sessions from the Rust backend */
  sessions?: AgentSessionSummary[];
  /** Stop a multi-session agent */
  onStopSession?: (sessionId: string) => void;
  /** Remove a completed/errored/cancelled session */
  onRemoveSession?: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<AgentTask['status'], string> = {
  thinking: 'var(--xp-green, #73daca)',
  executing: 'var(--xp-green, #73daca)',
  'waiting-approval': 'var(--xp-warning, #e0af68)',
};

const STATUS_LABELS: Record<AgentTask['status'], string> = {
  thinking: 'agentManager.status.thinking',
  executing: 'agentManager.status.executing',
  'waiting-approval': 'agentManager.status.waitingApproval',
};

const SESSION_STATUS_COLORS: Record<AgentSessionStatus, string> = {
  idle: 'var(--xp-text-muted, #888)',
  thinking: 'var(--xp-green, #73daca)',
  executing: 'var(--xp-green, #73daca)',
  waiting_approval: 'var(--xp-warning, #e0af68)',
  done: 'var(--xp-blue, #7aa2f7)',
  error: 'var(--xp-red, #f7768e)',
  cancelled: 'var(--xp-text-muted, #888)',
};

const SESSION_STATUS_LABELS: Record<AgentSessionStatus, string> = {
  idle: 'agentManager.sessionStatus.idle',
  thinking: 'agentManager.sessionStatus.thinking',
  executing: 'agentManager.sessionStatus.executing',
  waiting_approval: 'agentManager.sessionStatus.waitingApproval',
  done: 'agentManager.sessionStatus.done',
  error: 'agentManager.sessionStatus.error',
  cancelled: 'agentManager.sessionStatus.cancelled',
};

const formatElapsed = (startedAt: number): string => {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const isSessionActive = (status: AgentSessionStatus): boolean =>
  status === 'thinking' ||
  status === 'executing' ||
  status === 'waiting_approval' ||
  status === 'idle';

const isSessionTerminal = (status: AgentSessionStatus): boolean =>
  status === 'done' || status === 'error' || status === 'cancelled';

// ---------------------------------------------------------------------------
// Context display sub-component
// ---------------------------------------------------------------------------

/** Extract a short directory name from a full path. */
const shortDir = (dirPath: string): string => {
  const parts = dirPath.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : dirPath;
};

/** Extract project type label from project_context string (first line). */
const extractProjectLabel = (ctx: string | null): string | null => {
  if (!ctx) return null;
  // Look for "## Workspace: <label> project"
  const match = ctx.match(/^## Workspace:\s*(.+?)\s*project/m);
  return match ? match[1].trim() : null;
};

/** Extract git branch from project_context string. */
const extractGitBranch = (ctx: string | null): string | null => {
  if (!ctx) return null;
  const match = ctx.match(/Current branch:\s*(\S+)/);
  return match ? match[1] : null;
};

const SessionContextLine = ({ session }: { session: AgentSessionSummary }) => {
  const dir = shortDir(session.working_directory);
  const projectLabel = extractProjectLabel(session.project_context);
  const gitBranch = extractGitBranch(session.project_context);

  const parts: string[] = [dir];
  if (projectLabel) parts.push(projectLabel);
  if (gitBranch) parts.push(gitBranch);
  if (session.selected_files.length > 0) {
    parts.push(`${session.selected_files.length} files`);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        marginTop: '2px',
        fontSize: '10px',
        color: 'var(--xp-text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <Folder size={9} style={{ flexShrink: 0, opacity: 0.7 }} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={session.working_directory}
      >
        {parts.join(' \u00B7 ')}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ActiveAgents = ({
  agents,
  onStop,
  sessions = [],
  onStopSession,
  onRemoveSession,
}: ActiveAgentsProps) => {
  const { t } = useTranslation();
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  // Force re-render every second to update elapsed time
  const [, setTick] = useState(0);

  const hasAny = agents.length > 0 || sessions.length > 0;

  useEffect(() => {
    if (!hasAny) return;
    const interval = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(interval);
  }, [hasAny]);

  const toggleExpand = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!hasAny) {
    return (
      <div
        style={{
          padding: '12px',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          textAlign: 'center',
        }}
      >
        {t('agentManager.activeAgents.noActive')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {/* Multi-session agents from Rust backend */}
      {sessions.map((session) => {
        const isExpanded = expandedAgents.has(session.id);
        const statusColor = SESSION_STATUS_COLORS[session.status];
        const active = isSessionActive(session.status);
        const terminal = isSessionTerminal(session.status);

        return (
          <div
            key={session.id}
            style={{
              border: '1px solid var(--xp-border)',
              borderRadius: '6px',
              padding: '8px',
              background: 'var(--xp-surface)',
              opacity: terminal ? 0.7 : 1,
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
              onClick={() => toggleExpand(session.id)}
            >
              {isExpanded ? (
                <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
              ) : (
                <ChevronRight size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
              )}

              {/* Status dot */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: statusColor,
                  flexShrink: 0,
                  animation: active ? 'pulse 2s infinite' : undefined,
                }}
              />

              <span
                style={{
                  flex: 1,
                  fontSize: '12px',
                  color: 'var(--xp-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {session.name}
              </span>

              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                  flexShrink: 0,
                }}
              >
                {formatElapsed(session.created_at)}
              </span>

              {/* Stop button — only for active sessions */}
              {active && onStopSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStopSession(session.id);
                  }}
                  title={t('agentManager.activeAgents.stop')}
                  aria-label={t('agentManager.activeAgents.stop')}
                  style={{
                    background: 'none',
                    border: '1px solid var(--xp-border)',
                    borderRadius: '4px',
                    padding: '2px 4px',
                    cursor: 'pointer',
                    color: 'var(--xp-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Square size={10} />
                </button>
              )}

              {/* Remove button — only for terminal sessions */}
              {terminal && onRemoveSession && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSession(session.id);
                  }}
                  title={t('agentManager.activeAgents.remove')}
                  aria-label={t('agentManager.activeAgents.remove')}
                  style={{
                    background: 'none',
                    border: '1px solid var(--xp-border)',
                    borderRadius: '4px',
                    padding: '2px 4px',
                    cursor: 'pointer',
                    color: 'var(--xp-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>

            {/* Context line */}
            <SessionContextLine session={session} />

            {/* Status label + model */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '4px',
                fontSize: '10px',
                color: statusColor,
              }}
            >
              {active && session.status !== 'waiting_approval' && (
                <Loader2
                  size={10}
                  style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}
                />
              )}
              {session.status === 'error' && <AlertCircle size={10} style={{ flexShrink: 0 }} />}
              {t(SESSION_STATUS_LABELS[session.status])}
              <span style={{ color: 'var(--xp-text-muted)', marginLeft: 'auto' }}>
                {session.model}
              </span>
            </div>

            {/* Error message */}
            {session.error_message && (
              <div
                style={{
                  marginTop: '4px',
                  fontSize: '10px',
                  color: 'var(--xp-red, #f7768e)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {session.error_message}
              </div>
            )}

            {/* Expanded details */}
            {isExpanded && (
              <div
                style={{
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--xp-border)',
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <div>
                  <span style={{ fontWeight: 500 }}>
                    {t('agentManager.sessionDetail.prompt')}:{' '}
                  </span>
                  {session.prompt}
                </div>
                <div>
                  <span style={{ fontWeight: 500 }}>
                    {t('agentManager.sessionDetail.directory')}:{' '}
                  </span>
                  {session.working_directory}
                </div>
                <div>
                  <span style={{ fontWeight: 500 }}>
                    {t('agentManager.sessionDetail.toolCalls')}:{' '}
                  </span>
                  {session.tool_calls_count}
                </div>
                <div>
                  <span style={{ fontWeight: 500 }}>
                    {t('agentManager.sessionDetail.fileChanges')}:{' '}
                  </span>
                  {session.file_changes_count}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Legacy event-driven agents */}
      {agents.map((agent) => {
        const isExpanded = expandedAgents.has(agent.id);
        const statusColor = STATUS_COLORS[agent.status];

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
            {/* Header row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
              onClick={() => toggleExpand(agent.id)}
            >
              {isExpanded ? (
                <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
              ) : (
                <ChevronRight size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
              )}

              {/* Status dot */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: statusColor,
                  flexShrink: 0,
                  animation: agent.status !== 'waiting-approval' ? 'pulse 2s infinite' : undefined,
                }}
              />

              <span
                style={{
                  flex: 1,
                  fontSize: '12px',
                  color: 'var(--xp-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {agent.description}
              </span>

              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                  flexShrink: 0,
                }}
              >
                {formatElapsed(agent.startedAt)}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStop(agent.id);
                }}
                title={t('agentManager.activeAgents.stop')}
                aria-label={t('agentManager.activeAgents.stop')}
                style={{
                  background: 'none',
                  border: '1px solid var(--xp-border)',
                  borderRadius: '4px',
                  padding: '2px 4px',
                  cursor: 'pointer',
                  color: 'var(--xp-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <Square size={10} />
              </button>
            </div>

            {/* Status label */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '4px',
                fontSize: '10px',
                color: statusColor,
              }}
            >
              {agent.status !== 'waiting-approval' && (
                <Loader2
                  size={10}
                  style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}
                />
              )}
              {t(STATUS_LABELS[agent.status])}
              {agent.currentStep && (
                <span style={{ color: 'var(--xp-text-muted)' }}> - {agent.currentStep}</span>
              )}
            </div>

            {/* Progress bar */}
            {agent.progress != null && (
              <div
                style={{
                  marginTop: '6px',
                  height: '3px',
                  borderRadius: '2px',
                  background: 'var(--xp-surface-light)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, agent.progress)}%`,
                    background: statusColor,
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            )}

            {/* Steps counter */}
            {agent.totalSteps != null && agent.currentStepIndex != null && (
              <div
                style={{
                  marginTop: '2px',
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                  textAlign: 'right',
                }}
              >
                {t('agentManager.activeAgents.stepProgress', {
                  current: agent.currentStepIndex + 1,
                  total: agent.totalSteps,
                })}
              </div>
            )}

            {/* Expanded details */}
            {isExpanded && agent.files && agent.files.length > 0 && (
              <div
                style={{
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--xp-border)',
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: '2px' }}>
                  {t('agentManager.activeAgents.processingFiles')}
                </div>
                {agent.files.map((file) => (
                  <div
                    key={file}
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      paddingLeft: '8px',
                    }}
                  >
                    {file}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ActiveAgents;
