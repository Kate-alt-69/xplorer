/**
 * Cross-Directory Agent View — groups agent sessions by their working
 * directory so users can see and manage agents across multiple projects.
 *
 * Each directory group shows a header with the path, summary stats
 * (agent count, file changes, cost), and a "Navigate" button to switch
 * the main file browser to that folder. Agent cards are nested inside.
 */
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Navigation,
  Square,
  Trash2,
  Loader2,
  AlertCircle,
  Activity,
  Plus,
} from 'lucide-react';
import type { AgentSessionSummary, AgentSessionStatus } from '@/lib/tauri-api-types';
import type { SessionCostEntry } from './use-cost-tracking';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DirectoryGroup {
  /** Absolute working directory path */
  directory: string;
  /** Display name (last path segment) */
  label: string;
  /** Sessions running in this directory */
  sessions: AgentSessionSummary[];
  /** Number of active (non-terminal) sessions */
  activeCount: number;
  /** Total file changes across sessions in this directory */
  totalFileChanges: number;
  /** Estimated total cost (USD) for sessions in this directory */
  totalCost: number;
}

interface CrossDirectoryViewProps {
  /** All agent sessions across directories */
  sessions: AgentSessionSummary[];
  /** Cost entries keyed by session ID */
  sessionCosts: Map<string, SessionCostEntry>;
  /** Format cost for display */
  formatCost: (costUsd: number) => string;
  /** Navigate the main file browser to a directory */
  onNavigateToDirectory?: (directory: string) => void;
  /** Stop an active agent session */
  onStopSession?: (sessionId: string) => void;
  /** Remove a completed/errored/cancelled session */
  onRemoveSession?: (sessionId: string) => void;
  /** Launch a new agent in a specific directory */
  onLaunchInDirectory?: (directory: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isSessionActive = (status: AgentSessionStatus): boolean =>
  status === 'thinking' ||
  status === 'executing' ||
  status === 'waiting_approval' ||
  status === 'idle';

const isSessionTerminal = (status: AgentSessionStatus): boolean =>
  status === 'done' || status === 'error' || status === 'cancelled';

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

/** Extract a short display label from a full path */
const directoryLabel = (dir: string): string => {
  const segments = dir.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : dir;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatBadge = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
      fontSize: '9px',
      color: color ?? 'var(--xp-text-muted)',
      background: 'var(--xp-surface-light, rgba(255,255,255,0.05))',
      borderRadius: '3px',
      padding: '1px 5px',
      whiteSpace: 'nowrap',
    }}
  >
    <span style={{ fontWeight: 500 }}>{label}</span>
    {value}
  </span>
);

interface AgentCardMiniProps {
  session: AgentSessionSummary;
  onStop?: () => void;
  onRemove?: () => void;
}

const AgentCardMini = ({ session, onStop, onRemove }: AgentCardMiniProps) => {
  const { t } = useTranslation();
  const active = isSessionActive(session.status);
  const terminal = isSessionTerminal(session.status);
  const statusColor = SESSION_STATUS_COLORS[session.status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        borderRadius: '4px',
        background: 'var(--xp-bg)',
        opacity: terminal ? 0.65 : 1,
      }}
    >
      {/* Status dot */}
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
          animation: active ? 'pulse 2s infinite' : undefined,
        }}
      />

      {/* Name */}
      <span
        style={{
          flex: 1,
          fontSize: '11px',
          color: 'var(--xp-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={session.prompt}
      >
        {session.name}
      </span>

      {/* Status label */}
      <span
        style={{
          fontSize: '9px',
          color: statusColor,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          flexShrink: 0,
        }}
      >
        {active && session.status !== 'waiting_approval' && (
          <Loader2 size={8} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        )}
        {session.status === 'error' && <AlertCircle size={8} style={{ flexShrink: 0 }} />}
        {t(SESSION_STATUS_LABELS[session.status])}
      </span>

      {/* Elapsed time */}
      <span
        style={{
          fontSize: '9px',
          color: 'var(--xp-text-muted)',
          flexShrink: 0,
        }}
      >
        {formatElapsed(session.created_at)}
      </span>

      {/* Stop button */}
      {active && onStop && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          title={t('agentManager.activeAgents.stop')}
          aria-label={t('agentManager.activeAgents.stop')}
          style={{
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '3px',
            padding: '1px 3px',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <Square size={8} />
        </button>
      )}

      {/* Remove button */}
      {terminal && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={t('agentManager.activeAgents.remove')}
          aria-label={t('agentManager.activeAgents.remove')}
          style={{
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '3px',
            padding: '1px 3px',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <Trash2 size={8} />
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const CrossDirectoryView = ({
  sessions,
  sessionCosts,
  formatCost,
  onNavigateToDirectory,
  onStopSession,
  onRemoveSession,
  onLaunchInDirectory,
}: CrossDirectoryViewProps) => {
  const { t } = useTranslation();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());

  // Group sessions by working_directory
  const directoryGroups: DirectoryGroup[] = useMemo(() => {
    const groupMap = new Map<string, AgentSessionSummary[]>();

    for (const session of sessions) {
      const dir = session.working_directory || '/';
      const existing = groupMap.get(dir);
      if (existing) {
        existing.push(session);
      } else {
        groupMap.set(dir, [session]);
      }
    }

    const groups: DirectoryGroup[] = [];

    for (const [dir, dirSessions] of groupMap) {
      let totalFileChanges = 0;
      let totalCost = 0;
      let activeCount = 0;

      for (const s of dirSessions) {
        totalFileChanges += s.file_changes_count;
        if (isSessionActive(s.status)) {
          activeCount += 1;
        }
        const costEntry = sessionCosts.get(s.id);
        if (costEntry) {
          totalCost += costEntry.costUsd;
        }
      }

      groups.push({
        directory: dir,
        label: directoryLabel(dir),
        sessions: dirSessions,
        activeCount,
        totalFileChanges,
        totalCost,
      });
    }

    // Sort: directories with active agents first, then alphabetically
    groups.sort((a, b) => {
      if (a.activeCount > 0 && b.activeCount === 0) return -1;
      if (a.activeCount === 0 && b.activeCount > 0) return 1;
      return a.directory.localeCompare(b.directory);
    });

    return groups;
  }, [sessions, sessionCosts]);

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  if (directoryGroups.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          textAlign: 'center',
        }}
      >
        {t('agentManager.crossDirectory.noSessions')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Summary header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 0',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
        }}
      >
        <Activity size={10} style={{ flexShrink: 0 }} />
        <span>
          {t('agentManager.crossDirectory.summary', {
            directories: directoryGroups.length,
            agents: sessions.length,
          })}
        </span>
      </div>

      {/* Directory groups */}
      {directoryGroups.map((group) => {
        const isExpanded = expandedDirs.has(group.directory);
        const hasActive = group.activeCount > 0;

        return (
          <div
            key={group.directory}
            style={{
              border: '1px solid var(--xp-border)',
              borderRadius: '6px',
              overflow: 'hidden',
              background: 'var(--xp-surface)',
            }}
          >
            {/* Directory header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px',
                cursor: 'pointer',
                background: hasActive ? 'rgba(115, 218, 202, 0.05)' : 'transparent',
              }}
              onClick={() => toggleDir(group.directory)}
            >
              {isExpanded ? (
                <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
              ) : (
                <ChevronRight size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
              )}

              <FolderOpen
                size={12}
                style={{
                  flexShrink: 0,
                  color: hasActive ? 'var(--xp-green, #73daca)' : 'var(--xp-text-muted)',
                }}
              />

              {/* Directory label */}
              <span
                style={{
                  flex: 1,
                  fontSize: '11px',
                  fontWeight: 500,
                  color: 'var(--xp-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={group.directory}
              >
                {group.label}
              </span>

              {/* Stats badges */}
              <StatBadge
                label={t('agentManager.crossDirectory.agents')}
                value={String(group.sessions.length)}
                color={hasActive ? 'var(--xp-green, #73daca)' : undefined}
              />

              {group.totalFileChanges > 0 && (
                <StatBadge
                  label={t('agentManager.crossDirectory.files')}
                  value={String(group.totalFileChanges)}
                />
              )}

              {group.totalCost > 0 && <StatBadge label="" value={formatCost(group.totalCost)} />}

              {/* Launch new agent in this directory */}
              {onLaunchInDirectory && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onLaunchInDirectory(group.directory);
                  }}
                  title={t('agentManager.crossDirectory.launchHere')}
                  aria-label={t('agentManager.crossDirectory.launchHere')}
                  style={{
                    background: 'none',
                    border: '1px solid var(--xp-green, #73daca)',
                    borderRadius: '4px',
                    padding: '2px 5px',
                    cursor: 'pointer',
                    color: 'var(--xp-green, #73daca)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    fontSize: '9px',
                    flexShrink: 0,
                  }}
                >
                  <Plus size={8} />
                </button>
              )}

              {/* Navigate button */}
              {onNavigateToDirectory && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToDirectory(group.directory);
                  }}
                  title={t('agentManager.crossDirectory.navigate')}
                  aria-label={t('agentManager.crossDirectory.navigate')}
                  style={{
                    background: 'none',
                    border: '1px solid var(--xp-border)',
                    borderRadius: '4px',
                    padding: '2px 5px',
                    cursor: 'pointer',
                    color: 'var(--xp-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '9px',
                    flexShrink: 0,
                  }}
                >
                  <Navigation size={8} />
                  {t('agentManager.crossDirectory.navigateShort')}
                </button>
              )}
            </div>

            {/* Full directory path (shown when collapsed for context) */}
            {!isExpanded && group.directory !== group.label && (
              <div
                style={{
                  padding: '0 8px 4px 30px',
                  fontSize: '9px',
                  color: 'var(--xp-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {group.directory}
              </div>
            )}

            {/* Expanded: agent cards */}
            {isExpanded && (
              <div
                style={{
                  padding: '4px 6px 6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  borderTop: '1px solid var(--xp-border)',
                }}
              >
                {/* Full path */}
                <div
                  style={{
                    fontSize: '9px',
                    color: 'var(--xp-text-muted)',
                    padding: '2px 2px 4px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group.directory}
                </div>

                {group.sessions.map((session) => (
                  <AgentCardMini
                    key={session.id}
                    session={session}
                    onStop={onStopSession ? () => onStopSession(session.id) : undefined}
                    onRemove={onRemoveSession ? () => onRemoveSession(session.id) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CrossDirectoryView;
