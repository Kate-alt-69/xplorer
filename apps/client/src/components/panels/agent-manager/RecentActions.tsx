/**
 * Recent Actions log — shows recent AI actions from the audit log
 * with timestamps, results, and undo support.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, CheckCircle, XCircle, AlertTriangle, ShieldX } from 'lucide-react';
import {
  loadAuditLog,
  type AuditEntry,
  type AuditResult,
} from '@/components/panels/chat-audit-log';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentActionsProps {
  /** Max items to display */
  maxItems?: number;
  /** Called when user wants to undo a specific action */
  onUndo?: (entry: AuditEntry) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESULT_ICON: Record<AuditResult, React.ReactNode> = {
  success: <CheckCircle size={12} style={{ color: 'var(--xp-green, #73daca)' }} />,
  rejected: <XCircle size={12} style={{ color: 'var(--xp-text-muted)' }} />,
  failed: <AlertTriangle size={12} style={{ color: 'var(--xp-error, #f7768e)' }} />,
  blocked: <ShieldX size={12} style={{ color: 'var(--xp-warning, #e0af68)' }} />,
};

const RESULT_LABEL_KEY: Record<AuditResult, string> = {
  success: 'agentManager.recentActions.success',
  rejected: 'agentManager.recentActions.rejected',
  failed: 'agentManager.recentActions.failed',
  blocked: 'agentManager.recentActions.blocked',
};

const ACTION_LABELS: Record<string, string> = {
  create_file: 'agentManager.recentActions.actionCreate',
  edit_file: 'agentManager.recentActions.actionEdit',
  delete_file: 'agentManager.recentActions.actionDelete',
  move_file: 'agentManager.recentActions.actionMove',
  copy_file: 'agentManager.recentActions.actionCopy',
  rename_file: 'agentManager.recentActions.actionRename',
  create_directory: 'agentManager.recentActions.actionCreateDir',
  run_command: 'agentManager.recentActions.actionCommand',
};

const formatTimeAgo = (
  timestamp: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t('agentManager.timeAgo.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('agentManager.timeAgo.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('agentManager.timeAgo.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('agentManager.timeAgo.daysAgo', { count: days });
};

const shortenPath = (path: string, maxLen = 30): string => {
  if (path.length <= maxLen) return path;
  const parts = path.split(/[/\\]/);
  const filename = parts[parts.length - 1];
  if (filename.length >= maxLen - 4) return `...${filename.slice(-(maxLen - 3))}`;
  return `.../${filename}`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RecentActions = ({ maxItems = 30, onUndo }: RecentActionsProps) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  // Load entries on mount and set up a refresh interval
  useEffect(() => {
    const load = () => {
      const all = loadAuditLog();
      setEntries(all.slice(0, maxItems));
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [maxItems]);

  const handleUndo = useCallback(
    (entry: AuditEntry) => {
      onUndo?.(entry);
    },
    [onUndo],
  );

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
        {t('agentManager.recentActions.empty')}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
      }}
    >
      {entries.map((entry) => {
        const actionKey = ACTION_LABELS[entry.actionType];
        const actionLabel = actionKey ? t(actionKey) : entry.actionType;
        const canUndo = entry.result === 'success' && onUndo != null;

        return (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 6px',
              borderRadius: '3px',
              fontSize: '11px',
              color: 'var(--xp-text)',
              transition: 'background 0.1s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--xp-surface-light)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* Result icon */}
            <span style={{ flexShrink: 0, display: 'flex' }}>{RESULT_ICON[entry.result]}</span>

            {/* Action + path */}
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${actionLabel}: ${entry.path}`}
            >
              <span style={{ fontWeight: 500 }}>{actionLabel}</span>{' '}
              <span style={{ color: 'var(--xp-text-muted)' }}>{shortenPath(entry.path)}</span>
            </span>

            {/* Result badge */}
            <span
              style={{
                fontSize: '9px',
                color: 'var(--xp-text-muted)',
                flexShrink: 0,
              }}
              title={t(RESULT_LABEL_KEY[entry.result])}
            >
              {formatTimeAgo(entry.timestamp, t)}
            </span>

            {/* Undo button (only for successful actions) */}
            {canUndo && (
              <button
                onClick={() => handleUndo(entry)}
                title={t('agentManager.recentActions.undo')}
                aria-label={t('agentManager.recentActions.undo')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px',
                  cursor: 'pointer',
                  color: 'var(--xp-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  borderRadius: '3px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--xp-blue, #7aa2f7)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--xp-text-muted)';
                }}
              >
                <RotateCcw size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default RecentActions;
