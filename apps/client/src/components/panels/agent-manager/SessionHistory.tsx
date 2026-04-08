/**
 * Session History — displays a scrollable list of completed agent sessions.
 *
 * Each entry shows: name, relative date, model, duration, files changed,
 * cost, and status badge. Clicking an entry expands it to reveal the full
 * prompt, file list, and final result details.
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Ban,
  Clock,
  FileCode2,
  Wrench,
  Trash2,
} from 'lucide-react';
import type { SessionHistoryEntry } from './use-session-history';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionHistoryProps {
  /** Completed session entries (newest first) */
  entries: SessionHistoryEntry[];
  /** Clear all history */
  onClearAll: () => void;
  /** Remove a single entry */
  onRemoveEntry: (id: string) => void;
  /** Callback when user wants to view diffs for a session */
  onViewDiffs?: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  SessionHistoryEntry['resultStatus'],
  { color: string; label: string; Icon: typeof CheckCircle2 }
> = {
  done: {
    color: 'var(--xp-green, #73daca)',
    label: 'agentManager.sessionHistory.statusDone',
    Icon: CheckCircle2,
  },
  error: {
    color: 'var(--xp-red, #f7768e)',
    label: 'agentManager.sessionHistory.statusError',
    Icon: XCircle,
  },
  cancelled: {
    color: 'var(--xp-text-muted, #888)',
    label: 'agentManager.sessionHistory.statusCancelled',
    Icon: Ban,
  },
};

const formatRelativeDate = (
  epochMs: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string => {
  const diffMs = Date.now() - epochMs;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t('agentManager.timeAgo.justNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('agentManager.timeAgo.minutesAgo', { count: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t('agentManager.timeAgo.hoursAgo', { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return t('agentManager.timeAgo.daysAgo', { count: diffDays });
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const formatDuration = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
};

const formatCostDisplay = (costUsd: number | null): string => {
  if (costUsd == null) return '--';
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.01) return '<$0.01';
  return `$${costUsd.toFixed(2)}`;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusBadge = ({ status }: { status: SessionHistoryEntry['resultStatus'] }) => {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];
  const { Icon } = config;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '9px',
        fontWeight: 600,
        color: config.color,
        background: 'var(--xp-surface-light, rgba(255,255,255,0.05))',
        borderRadius: '3px',
        padding: '1px 5px',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={9} />
      {t(config.label)}
    </span>
  );
};

const HistoryEntry = ({
  entry,
  onRemove,
  onViewDiffs,
}: {
  entry: SessionHistoryEntry;
  onRemove: () => void;
  onViewDiffs?: () => void;
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--xp-border)',
        borderRadius: '6px',
        background: 'var(--xp-surface)',
        overflow: 'hidden',
      }}
    >
      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 8px',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        ) : (
          <ChevronRight size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        )}

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
        >
          {entry.name}
        </span>

        <span
          style={{
            fontSize: '9px',
            color: 'var(--xp-text-muted)',
            flexShrink: 0,
          }}
        >
          {formatRelativeDate(entry.completedAt, t)}
        </span>

        <StatusBadge status={entry.resultStatus} />
      </div>

      {/* Meta row (always visible) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 8px 6px 26px',
          fontSize: '9px',
          color: 'var(--xp-text-muted)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <Clock size={9} />
          {formatDuration(entry.durationMs)}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <FileCode2 size={9} />
          {entry.filesChangedCount} {t('agentManager.sessionHistory.files')}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.model}
        </span>
        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {formatCostDisplay(entry.costUsd)}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: '6px 8px 8px 26px',
            borderTop: '1px solid var(--xp-border)',
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div>
            <span style={{ fontWeight: 500 }}>{t('agentManager.sessionHistory.prompt')}: </span>
            <span style={{ color: 'var(--xp-text)' }}>{entry.prompt}</span>
          </div>
          <div>
            <span style={{ fontWeight: 500 }}>{t('agentManager.sessionHistory.directory')}: </span>
            {entry.workingDirectory}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <span>
              <span style={{ fontWeight: 500 }}>
                {t('agentManager.sessionHistory.toolCalls')}:{' '}
              </span>
              {entry.toolCallsCount}
            </span>
            <span>
              <span style={{ fontWeight: 500 }}>{t('agentManager.sessionHistory.turns')}: </span>
              {entry.turnsCompleted}
            </span>
          </div>

          {entry.errorMessage && (
            <div style={{ color: 'var(--xp-red, #f7768e)' }}>
              <span style={{ fontWeight: 500 }}>{t('agentManager.sessionHistory.error')}: </span>
              {entry.errorMessage}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              marginTop: '4px',
            }}
          >
            {onViewDiffs && entry.filesChangedCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDiffs();
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--xp-border)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  color: 'var(--xp-blue, #7aa2f7)',
                  fontSize: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Wrench size={10} />
                {t('agentManager.sessionHistory.viewChanges')}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title={t('agentManager.sessionHistory.removeEntry')}
              aria-label={t('agentManager.sessionHistory.removeEntry')}
              style={{
                background: 'none',
                border: '1px solid var(--xp-border)',
                borderRadius: '4px',
                padding: '2px 8px',
                cursor: 'pointer',
                color: 'var(--xp-text-muted)',
                fontSize: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                marginLeft: 'auto',
              }}
            >
              <Trash2 size={10} />
              {t('agentManager.sessionHistory.removeEntry')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const SessionHistory = ({
  entries,
  onClearAll,
  onRemoveEntry,
  onViewDiffs,
}: SessionHistoryProps) => {
  const { t } = useTranslation();

  // Force re-render periodically so relative dates update
  const [, setTick] = useState(0);
  useMemo(() => {
    const interval = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: '12px',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          textAlign: 'center',
        }}
      >
        {t('agentManager.sessionHistory.empty')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {/* Header with clear button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 4px 4px',
        }}
      >
        <span
          style={{
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
          }}
        >
          {t('agentManager.sessionHistory.count', { count: entries.length })}
        </span>
        <button
          onClick={onClearAll}
          style={{
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            padding: '2px 8px',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            fontSize: '10px',
          }}
        >
          {t('agentManager.sessionHistory.clearAll')}
        </button>
      </div>

      {/* Scrollable entry list */}
      <div
        style={{
          maxHeight: '400px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        {entries.map((entry) => (
          <HistoryEntry
            key={entry.id}
            entry={entry}
            onRemove={() => onRemoveEntry(entry.id)}
            onViewDiffs={onViewDiffs ? () => onViewDiffs(entry.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
};

export default SessionHistory;
