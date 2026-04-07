/**
 * Agent Workspace — full-screen dedicated agent workspace mode.
 *
 * Three-column layout:
 *   Left (250px): agent list with status badges, click to select
 *   Center (flex): selected agent's conversation + tool calls
 *   Right (300px): file changes from selected agent with inline diff preview
 * Bottom section: terminal output from the agent (if available)
 * Header: agent name, model, elapsed time, cost, [Pause] [Stop] [Close] buttons
 *
 * Activated via Cmd+Shift+A (registered in MainLayout) or a button.
 * Escape to close, returns to normal Xplorer view.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Pause,
  Square,
  Bot,
  Clock,
  DollarSign,
  FileText,
  Terminal,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import AgentConversationView, {
  type AgentMessage,
  type PendingApproval,
} from './AgentConversationView';
import FileChangeTracker from './FileChangeTracker';
import type { AgentFileChanges } from './use-file-changes';
import type { AgentSessionSummary, AgentSessionStatus } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentWorkspaceProps {
  /** Whether the workspace is visible */
  isOpen: boolean;
  /** Close callback (Escape or close button) */
  onClose: () => void;
  /** All agent sessions */
  sessions: AgentSessionSummary[];
  /** Stop an agent session */
  onStopSession: (sessionId: string) => void;
  /** Remove a completed session */
  onRemoveSession: (sessionId: string) => void;
  /** File changes grouped by agent */
  changesByAgent: Map<string, AgentFileChanges>;
  /** Navigate to a file in the main explorer */
  onNavigateToFile?: (filePath: string) => void;
  /** View diff for a file */
  onViewDiff?: (filePath: string) => void;
  /** Clear file changes for an agent */
  onClearAgentChanges?: (agentId: string) => void;
  /** Conversation messages per session */
  messagesBySession?: Map<string, AgentMessage[]>;
  /** Pending approvals per session */
  approvalsBySession?: Map<string, PendingApproval[]>;
  /** Send a message to an agent */
  onSendMessage?: (sessionId: string, message: string) => void;
  /** Approve a pending action */
  onApprove?: (approvalId: string) => void;
  /** Reject a pending action */
  onReject?: (approvalId: string) => void;
  /** Terminal output lines per session */
  terminalOutputBySession?: Map<string, string[]>;
  /** Cost info: formatCost function */
  formatCost?: (costUsd: number) => string;
  /** Per-session cost in USD */
  costBySession?: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_STATUS_COLORS: Record<AgentSessionStatus, string> = {
  idle: 'var(--xp-text-muted, #888)',
  thinking: 'var(--xp-green, #73daca)',
  executing: 'var(--xp-green, #73daca)',
  waiting_approval: 'var(--xp-warning, #e0af68)',
  done: 'var(--xp-blue, #7aa2f7)',
  error: 'var(--xp-red, #f7768e)',
  cancelled: 'var(--xp-text-muted, #888)',
};

const isSessionActive = (status: AgentSessionStatus): boolean =>
  status === 'thinking' ||
  status === 'executing' ||
  status === 'waiting_approval' ||
  status === 'idle';

const formatElapsed = (startedAt: number): string => {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const AgentListItem = ({
  session,
  isSelected,
  onSelect,
}: {
  session: AgentSessionSummary;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const { t } = useTranslation();
  const statusColor = SESSION_STATUS_COLORS[session.status];
  const active = isSessionActive(session.status);

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        borderLeft: isSelected ? '3px solid var(--xp-blue, #7aa2f7)' : '3px solid transparent',
        background: isSelected ? 'var(--xp-surface-light, rgba(255,255,255,0.05))' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--xp-text)',
        transition: 'background 0.1s ease',
      }}
      title={session.prompt}
    >
      {/* Status dot */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
          animation: active ? 'pulse 2s infinite' : undefined,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.name}
        </div>
        <div
          style={{
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.model} &middot;{' '}
          {t(`agentManager.sessionStatus.${session.status.replace('_', '') as 'idle'}`)}
        </div>
      </div>
      <span
        style={{
          fontSize: '9px',
          color: 'var(--xp-text-muted)',
          flexShrink: 0,
        }}
      >
        {formatElapsed(session.created_at)}
      </span>
    </button>
  );
};

const TerminalOutputSection = ({
  lines,
  expanded,
  onToggle,
}: {
  lines: string[];
  expanded: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <div
      style={{
        borderTop: '1px solid var(--xp-border)',
        background: 'var(--xp-bg, #1a1b26)',
        flexShrink: 0,
      }}
    >
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '6px 12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Terminal size={12} />
        {t('agentManager.workspace.terminalOutput')}
        {lines.length > 0 && (
          <span
            style={{
              fontSize: '9px',
              background: 'var(--xp-surface-light, rgba(255,255,255,0.05))',
              padding: '1px 5px',
              borderRadius: '8px',
            }}
          >
            {lines.length}
          </span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            maxHeight: '150px',
            overflowY: 'auto',
            padding: '4px 12px 8px',
            fontFamily: 'monospace',
            fontSize: '11px',
            lineHeight: 1.5,
            color: 'var(--xp-text-muted)',
          }}
        >
          {lines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '8px 0', fontSize: '10px' }}>
              {t('agentManager.workspace.noTerminalOutput')}
            </div>
          ) : (
            lines.map((line, idx) => <div key={`${idx}-${line.slice(0, 20)}`}>{line}</div>)
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const AgentWorkspace = ({
  isOpen,
  onClose,
  sessions,
  onStopSession,
  onRemoveSession: _onRemoveSession,
  changesByAgent,
  onNavigateToFile,
  onViewDiff,
  onClearAgentChanges,
  messagesBySession = new Map(),
  approvalsBySession = new Map(),
  onSendMessage,
  onApprove,
  onReject,
  terminalOutputBySession = new Map(),
  formatCost,
  costBySession = new Map(),
}: AgentWorkspaceProps) => {
  const { t } = useTranslation();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  // Force re-render every second for elapsed time
  const [, setTick] = useState(0);

  // Auto-select the first session if none selected
  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Keep selection valid
  useEffect(() => {
    if (selectedSessionId && !sessions.find((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(sessions.length > 0 ? sessions[0].id : null);
    }
  }, [sessions, selectedSessionId]);

  // Tick for elapsed time
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const selectedMessages = selectedSessionId
    ? (messagesBySession.get(selectedSessionId) ?? [])
    : [];

  const selectedApprovals = selectedSessionId
    ? (approvalsBySession.get(selectedSessionId) ?? [])
    : [];

  const selectedTerminalOutput = selectedSessionId
    ? (terminalOutputBySession.get(selectedSessionId) ?? [])
    : [];

  const selectedCost = selectedSessionId ? (costBySession.get(selectedSessionId) ?? 0) : 0;

  const selectedFileChanges = useMemo(() => {
    if (!selectedSessionId) return new Map<string, AgentFileChanges>();
    const entry = changesByAgent.get(selectedSessionId);
    if (!entry) return new Map<string, AgentFileChanges>();
    const map = new Map<string, AgentFileChanges>();
    map.set(selectedSessionId, entry);
    return map;
  }, [selectedSessionId, changesByAgent]);

  const handleSendMessage = useCallback(
    (sessionId: string, message: string) => {
      onSendMessage?.(sessionId, message);
    },
    [onSendMessage],
  );

  const handleBack = useCallback(() => {
    // In workspace mode, "back" just deselects
    setSelectedSessionId(null);
  }, []);

  const activeCount = useMemo(
    () => sessions.filter((s) => isSessionActive(s.status)).length,
    [sessions],
  );

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--xp-bg, #1a1b26)',
        color: 'var(--xp-text, #c0caf5)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('agentManager.workspace.title')}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 16px',
          borderBottom: '1px solid var(--xp-border)',
          background: 'var(--xp-surface, #24283b)',
          flexShrink: 0,
        }}
      >
        <Bot size={18} style={{ color: 'var(--xp-blue, #7aa2f7)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedSession ? (
            <>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{selectedSession.name}</div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--xp-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>{selectedSession.model}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Clock size={10} />
                  {formatElapsed(selectedSession.created_at)}
                </span>
                {formatCost && selectedCost > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <DollarSign size={10} />
                    {formatCost(selectedCost)}
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <FileText size={10} />
                  {selectedSession.file_changes_count} {t('agentManager.workspace.changes')}
                </span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: '14px', fontWeight: 600 }}>
              {t('agentManager.workspace.title')}
            </div>
          )}
        </div>

        {/* Active count badge */}
        {activeCount > 0 && (
          <span
            style={{
              background: 'var(--xp-green, #73daca)',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '10px',
              flexShrink: 0,
            }}
          >
            {activeCount} {t('agentManager.workspace.active')}
          </span>
        )}

        {/* Pause/Stop buttons for selected session */}
        {selectedSession && isSessionActive(selectedSession.status) && (
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              onClick={() => onStopSession(selectedSession.id)}
              title={t('agentManager.workspace.pause')}
              aria-label={t('agentManager.workspace.pause')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                background: 'rgba(224, 175, 104, 0.15)',
                border: '1px solid var(--xp-warning, #e0af68)',
                borderRadius: '4px',
                color: 'var(--xp-warning, #e0af68)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              <Pause size={12} />
              {t('agentManager.workspace.pause')}
            </button>
            <button
              onClick={() => onStopSession(selectedSession.id)}
              title={t('agentManager.workspace.stop')}
              aria-label={t('agentManager.workspace.stop')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                background: 'rgba(247, 118, 142, 0.15)',
                border: '1px solid var(--xp-red, #f7768e)',
                borderRadius: '4px',
                color: 'var(--xp-red, #f7768e)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              <Square size={12} />
              {t('agentManager.workspace.stop')}
            </button>
          </div>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          title={t('agentManager.workspace.close')}
          aria-label={t('agentManager.workspace.close')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Main three-column layout ────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flex: '1 1 0%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left column: Agent list (250px) */}
        <div
          style={{
            width: '250px',
            flexShrink: 0,
            borderRight: '1px solid var(--xp-border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--xp-surface, #24283b)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--xp-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              borderBottom: '1px solid var(--xp-border)',
            }}
          >
            {t('agentManager.workspace.agentList')} ({sessions.length})
          </div>
          <div
            style={{
              flex: '1 1 0%',
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            {sessions.length === 0 ? (
              <div
                style={{
                  padding: '24px 12px',
                  textAlign: 'center',
                  color: 'var(--xp-text-muted)',
                  fontSize: '11px',
                }}
              >
                {t('agentManager.activeAgents.noActive')}
              </div>
            ) : (
              sessions.map((session) => (
                <AgentListItem
                  key={session.id}
                  session={session}
                  isSelected={session.id === selectedSessionId}
                  onSelect={() => setSelectedSessionId(session.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Center column: Conversation (flex) */}
        <div
          style={{
            flex: '1 1 0%',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {selectedSession ? (
            <div style={{ flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}>
                <AgentConversationView
                  session={selectedSession}
                  messages={selectedMessages}
                  pendingApprovals={selectedApprovals}
                  onSendMessage={handleSendMessage}
                  onBack={handleBack}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              </div>
              {/* Terminal output section */}
              <TerminalOutputSection
                lines={selectedTerminalOutput}
                expanded={terminalExpanded}
                onToggle={() => setTerminalExpanded((v) => !v)}
              />
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: '12px',
                color: 'var(--xp-text-muted)',
              }}
            >
              <Bot size={48} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: '14px', fontWeight: 500 }}>
                {t('agentManager.workspace.selectAgent')}
              </div>
              <div style={{ fontSize: '11px' }}>{t('agentManager.workspace.selectAgentHint')}</div>
            </div>
          )}
        </div>

        {/* Right column: File changes (300px) */}
        <div
          style={{
            width: '300px',
            flexShrink: 0,
            borderLeft: '1px solid var(--xp-border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--xp-surface, #24283b)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--xp-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              borderBottom: '1px solid var(--xp-border)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FileText size={12} />
            {t('agentManager.workspace.fileChanges')}
          </div>
          <div
            style={{
              flex: '1 1 0%',
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '8px',
            }}
          >
            <FileChangeTracker
              changesByAgent={selectedFileChanges}
              onNavigateToFile={onNavigateToFile}
              onViewDiff={onViewDiff}
              onClearAgent={onClearAgentChanges}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentWorkspace;
