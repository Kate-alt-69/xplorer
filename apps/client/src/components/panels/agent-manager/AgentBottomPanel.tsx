/**
 * Agent Bottom Panel — compact agent manager view for the bottom panel.
 *
 * Horizontal layout optimized for shorter height:
 *   Left: compact agent selector (dropdown + status)
 *   Right: selected agent's conversation + actions
 *
 * Shares state with the right sidebar Agent Manager via the same hooks
 * (useAgentSessions, etc.). Renders as a bottom panel tab alongside
 * Terminal, Activity Log, etc.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Square, ChevronDown, Loader2, Send, Maximize2 } from 'lucide-react';
import type { AgentSessionSummary, AgentSessionStatus } from '@/lib/tauri-api-types';
import type { AgentMessage, PendingApproval } from './AgentConversationView';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentBottomPanelProps {
  /** All agent sessions from shared state */
  sessions: AgentSessionSummary[];
  /** Stop an agent session */
  onStopSession: (sessionId: string) => void;
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
  /** Open the full-screen workspace */
  onOpenWorkspace?: () => void;
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
  return `${minutes}m ${remainingSeconds}s`;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CompactAgentCard = ({
  session,
  isSelected,
  onSelect,
}: {
  session: AgentSessionSummary;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const statusColor = SESSION_STATUS_COLORS[session.status];
  const active = isSessionActive(session.status);

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        border: isSelected ? '1px solid var(--xp-blue, #7aa2f7)' : '1px solid var(--xp-border)',
        borderRadius: '4px',
        background: isSelected ? 'rgba(122, 162, 247, 0.1)' : 'var(--xp-surface, #24283b)',
        cursor: 'pointer',
        color: 'var(--xp-text)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        fontSize: '11px',
      }}
    >
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
          maxWidth: '120px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {session.name}
      </span>
      <span style={{ fontSize: '9px', color: 'var(--xp-text-muted)' }}>
        {formatElapsed(session.created_at)}
      </span>
    </button>
  );
};

const CompactMessageView = ({
  messages,
  pendingApprovals,
  onApprove,
  onReject,
}: {
  messages: AgentMessage[];
  pendingApprovals: PendingApproval[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}) => {
  const { t } = useTranslation();

  // Show only the last few messages for compact view
  const recentMessages = messages.slice(-5);

  return (
    <div
      style={{
        flex: '1 1 0%',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '4px 8px',
        fontSize: '11px',
      }}
    >
      {recentMessages.length === 0 ? (
        <div
          style={{
            color: 'var(--xp-text-muted)',
            textAlign: 'center',
            padding: '12px',
            fontSize: '10px',
          }}
        >
          {t('agentManager.conversation.noMessages')}
        </div>
      ) : (
        recentMessages.map((msg) => {
          if (msg.role === 'system') return null;
          const isUser = msg.role === 'user';

          return (
            <div
              key={msg.id}
              style={{
                padding: '3px 0',
                borderBottom: '1px solid var(--xp-border)',
              }}
            >
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  color: isUser ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-green, #73daca)',
                  marginRight: '6px',
                }}
              >
                {isUser ? 'You' : 'Agent'}
              </span>
              <span
                style={{
                  color: 'var(--xp-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {msg.content.slice(0, 200)}
                {msg.content.length > 200 ? '...' : ''}
              </span>
              {msg.streaming && (
                <Loader2
                  size={10}
                  style={{
                    display: 'inline-block',
                    animation: 'spin 1s linear infinite',
                    marginLeft: '4px',
                    verticalAlign: 'middle',
                  }}
                />
              )}
            </div>
          );
        })
      )}

      {/* Pending approvals */}
      {pendingApprovals
        .filter((a) => a.status === 'pending')
        .map((approval) => (
          <div
            key={approval.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 0',
              borderBottom: '1px solid var(--xp-border)',
            }}
          >
            <span
              style={{
                fontSize: '10px',
                color: 'var(--xp-warning, #e0af68)',
                fontWeight: 500,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {approval.description}
            </span>
            {onApprove && (
              <button
                onClick={() => onApprove(approval.id)}
                style={{
                  padding: '2px 6px',
                  borderRadius: '3px',
                  border: '1px solid var(--xp-green, #73daca)',
                  background: 'rgba(115, 218, 202, 0.15)',
                  color: 'var(--xp-green, #73daca)',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 600,
                }}
              >
                Allow
              </button>
            )}
            {onReject && (
              <button
                onClick={() => onReject(approval.id)}
                style={{
                  padding: '2px 6px',
                  borderRadius: '3px',
                  border: '1px solid var(--xp-red, #f7768e)',
                  background: 'rgba(247, 118, 142, 0.15)',
                  color: 'var(--xp-red, #f7768e)',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 600,
                }}
              >
                Deny
              </button>
            )}
          </div>
        ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const AgentBottomPanel = ({
  sessions,
  onStopSession,
  messagesBySession = new Map(),
  approvalsBySession = new Map(),
  onSendMessage,
  onApprove,
  onReject,
  onOpenWorkspace,
}: AgentBottomPanelProps) => {
  const { t } = useTranslation();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // Force re-render every second for elapsed time
  const [, setTick] = useState(0);

  // Auto-select first session
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
    const interval = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(interval);
  }, []);

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

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !selectedSessionId) return;
    onSendMessage?.(selectedSessionId, trimmed);
    setInputValue('');
  }, [inputValue, selectedSessionId, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const activeCount = useMemo(
    () => sessions.filter((s) => isSessionActive(s.status)).length,
    [sessions],
  );

  if (sessions.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          gap: '8px',
        }}
      >
        <Bot size={16} style={{ opacity: 0.5 }} />
        {t('agentManager.bottomPanel.noAgents')}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Top toolbar: agent selector + actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px',
          borderBottom: '1px solid var(--xp-border)',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {/* Horizontal agent cards (if few) or dropdown (if many) */}
        {sessions.length <= 4 ? (
          <div
            style={{
              display: 'flex',
              gap: '4px',
              flex: '1 1 0%',
              overflow: 'hidden',
            }}
          >
            {sessions.map((session) => (
              <CompactAgentCard
                key={session.id}
                session={session}
                isSelected={session.id === selectedSessionId}
                onSelect={() => setSelectedSessionId(session.id)}
              />
            ))}
          </div>
        ) : (
          <div style={{ position: 'relative', flex: '1 1 0%' }}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                border: '1px solid var(--xp-border)',
                borderRadius: '4px',
                background: 'var(--xp-surface)',
                cursor: 'pointer',
                color: 'var(--xp-text)',
                fontSize: '11px',
                width: '100%',
                maxWidth: '300px',
              }}
            >
              {selectedSession && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: SESSION_STATUS_COLORS[selectedSession.status],
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'left',
                }}
              >
                {selectedSession?.name ?? t('agentManager.bottomPanel.selectAgent')}
              </span>
              <ChevronDown size={10} style={{ flexShrink: 0 }} />
            </button>
            {dropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  maxWidth: '300px',
                  zIndex: 100,
                  background: 'var(--xp-surface, #24283b)',
                  border: '1px solid var(--xp-border)',
                  borderRadius: '4px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}
              >
                {sessions.map((session) => {
                  const statusColor = SESSION_STATUS_COLORS[session.status];
                  return (
                    <button
                      key={session.id}
                      onClick={() => {
                        setSelectedSessionId(session.id);
                        setDropdownOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        width: '100%',
                        border: 'none',
                        background:
                          session.id === selectedSessionId
                            ? 'rgba(122, 162, 247, 0.1)'
                            : 'transparent',
                        cursor: 'pointer',
                        color: 'var(--xp-text)',
                        fontSize: '11px',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: statusColor,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {session.name}
                      </span>
                      <span style={{ fontSize: '9px', color: 'var(--xp-text-muted)' }}>
                        {formatElapsed(session.created_at)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Active count badge */}
        {activeCount > 0 && (
          <span
            style={{
              background: 'var(--xp-green, #73daca)',
              color: '#fff',
              fontSize: '9px',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '8px',
              flexShrink: 0,
            }}
          >
            {activeCount}
          </span>
        )}

        {/* Stop button for active session */}
        {selectedSession && isSessionActive(selectedSession.status) && (
          <button
            onClick={() => onStopSession(selectedSession.id)}
            title={t('agentManager.activeAgents.stop')}
            aria-label={t('agentManager.activeAgents.stop')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              padding: '3px 8px',
              border: '1px solid var(--xp-red, #f7768e)',
              borderRadius: '4px',
              background: 'rgba(247, 118, 142, 0.1)',
              cursor: 'pointer',
              color: 'var(--xp-red, #f7768e)',
              fontSize: '10px',
              flexShrink: 0,
            }}
          >
            <Square size={10} />
            {t('agentManager.workspace.stop')}
          </button>
        )}

        {/* Open full workspace */}
        {onOpenWorkspace && (
          <button
            onClick={onOpenWorkspace}
            title={t('agentManager.bottomPanel.openWorkspace')}
            aria-label={t('agentManager.bottomPanel.openWorkspace')}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--xp-text-muted)',
              flexShrink: 0,
            }}
          >
            <Maximize2 size={12} />
          </button>
        )}
      </div>

      {/* Conversation area */}
      <CompactMessageView
        messages={selectedMessages}
        pendingApprovals={selectedApprovals}
        onApprove={onApprove}
        onReject={onReject}
      />

      {/* Input bar */}
      {selectedSession && isSessionActive(selectedSession.status) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            borderTop: '1px solid var(--xp-border)',
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('agentManager.conversation.inputPlaceholder')}
            style={{
              flex: 1,
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '4px 8px',
              background: 'var(--xp-surface)',
              color: 'var(--xp-text)',
              fontSize: '11px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            title={t('agentManager.conversation.sendMessage')}
            aria-label={t('agentManager.conversation.sendMessage')}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 8px',
              borderRadius: '4px',
              border: 'none',
              background: inputValue.trim()
                ? 'var(--xp-blue, #7aa2f7)'
                : 'var(--xp-surface-light, #333)',
              color: inputValue.trim() ? '#fff' : 'var(--xp-text-muted)',
              cursor: inputValue.trim() ? 'pointer' : 'default',
              opacity: inputValue.trim() ? 1 : 0.5,
              flexShrink: 0,
            }}
          >
            <Send size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

export default AgentBottomPanel;
