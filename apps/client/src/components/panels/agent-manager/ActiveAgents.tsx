/**
 * Active Agents section — shows currently running AI operations
 * with status, elapsed time, progress, and stop controls.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Square, Loader2 } from 'lucide-react';

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

const formatElapsed = (startedAt: number): string => {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ActiveAgents = ({ agents, onStop }: ActiveAgentsProps) => {
  const { t } = useTranslation();
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  // Force re-render every second to update elapsed time
  const [, setTick] = useState(0);

  useEffect(() => {
    if (agents.length === 0) return;
    const interval = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(interval);
  }, [agents.length]);

  const toggleExpand = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (agents.length === 0) {
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
