/**
 * Agent Resume Dialog — modal shown on app startup when interrupted
 * agent sessions are found in localStorage. Users can resume selected
 * sessions or discard them all.
 */
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Play, Trash2, CheckSquare, Square, Folder, FileText } from 'lucide-react';
import {
  type InterruptedSession,
  clearInterruptedSessions,
  removeInterruptedSessions,
  buildResumeParams,
} from './agent-persistence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentResumeDialogProps {
  /** Interrupted sessions found on startup */
  sessions: InterruptedSession[];
  /** Called when user chooses to resume sessions */
  onResume: (sessions: Array<ReturnType<typeof buildResumeParams>>) => void;
  /** Called after resume or discard to close the dialog */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatTimeAgo = (timestamp: number): string => {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

const truncatePrompt = (prompt: string, maxLen = 80): string => {
  if (prompt.length <= maxLen) return prompt;
  return `${prompt.slice(0, maxLen)}...`;
};

/** Extract a short directory name from a full path. */
const shortDir = (dirPath: string): string => {
  const parts = dirPath.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : dirPath;
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.55)',
  backdropFilter: 'blur(4px)',
};

const dialogStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  borderRadius: '12px',
  border: '1px solid var(--xp-border)',
  background: 'var(--xp-surface)',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
  overflow: 'hidden',
  animation: 'fadeSlideIn 0.2s ease-out',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '16px',
  borderBottom: '1px solid var(--xp-border)',
};

const sessionItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  padding: '10px 16px',
  borderBottom: '1px solid var(--xp-border)',
  cursor: 'pointer',
  transition: 'background 0.1s ease',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 16px',
  justifyContent: 'flex-end',
};

const btnBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 14px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  border: 'none',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentResumeDialog = ({ sessions, onResume, onClose }: AgentResumeDialogProps) => {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(sessions.map((s) => s.id)),
  );

  const allSelected = useMemo(
    () => sessions.every((s) => selectedIds.has(s.id)),
    [sessions, selectedIds],
  );

  const noneSelected = useMemo(() => selectedIds.size === 0, [selectedIds]);

  const toggleSession = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sessions.map((s) => s.id)));
    }
  }, [allSelected, sessions]);

  const handleResumeSelected = useCallback(() => {
    const toResume = sessions.filter((s) => selectedIds.has(s.id)).map((s) => buildResumeParams(s));

    if (toResume.length > 0) {
      // Remove resumed sessions from storage; keep un-selected ones
      const resumedIds = new Set(sessions.filter((s) => selectedIds.has(s.id)).map((s) => s.id));
      removeInterruptedSessions(resumedIds);
      onResume(toResume);
    }
    onClose();
  }, [sessions, selectedIds, onResume, onClose]);

  const handleDiscardAll = useCallback(() => {
    clearInterruptedSessions();
    onClose();
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        // Clicking backdrop discards
        handleDiscardAll();
      }
    },
    [handleDiscardAll],
  );

  return (
    <div style={backdropStyle} onClick={handleBackdropClick}>
      {/* Keyframe for animation */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-label={t('agentManager.resume.title')}
      >
        {/* Header */}
        <div style={headerStyle}>
          <AlertTriangle size={18} style={{ color: 'var(--xp-warning, #e0af68)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--xp-text)',
              }}
            >
              {t('agentManager.resume.title')}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--xp-text-muted)',
                marginTop: '2px',
              }}
            >
              {t('agentManager.resume.description', { count: sessions.length })}
            </div>
          </div>
        </div>

        {/* Select all toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            borderBottom: '1px solid var(--xp-border)',
            cursor: 'pointer',
            fontSize: '11px',
            color: 'var(--xp-text-muted)',
          }}
          onClick={toggleAll}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') toggleAll();
          }}
        >
          {allSelected ? (
            <CheckSquare size={14} style={{ color: 'var(--xp-blue, #7aa2f7)' }} />
          ) : (
            <Square size={14} />
          )}
          {t('agentManager.resume.selectAll')}
        </div>

        {/* Session list */}
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {sessions.map((session) => {
            const isSelected = selectedIds.has(session.id);
            return (
              <div
                key={session.id}
                style={{
                  ...sessionItemStyle,
                  background: isSelected ? 'rgba(122, 162, 247, 0.06)' : 'transparent',
                }}
                onClick={() => toggleSession(session.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isSelected
                    ? 'rgba(122, 162, 247, 0.1)'
                    : 'var(--xp-surface-light)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isSelected
                    ? 'rgba(122, 162, 247, 0.06)'
                    : 'transparent';
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') toggleSession(session.id);
                }}
              >
                {/* Checkbox */}
                <div style={{ paddingTop: '2px', flexShrink: 0 }}>
                  {isSelected ? (
                    <CheckSquare size={14} style={{ color: 'var(--xp-blue, #7aa2f7)' }} />
                  ) : (
                    <Square size={14} style={{ color: 'var(--xp-text-muted)' }} />
                  )}
                </div>

                {/* Session info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Name + time */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'var(--xp-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {session.name}
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        color: 'var(--xp-text-muted)',
                        flexShrink: 0,
                      }}
                    >
                      {formatTimeAgo(session.saved_at)}
                    </span>
                  </div>

                  {/* Prompt preview */}
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--xp-text-muted)',
                      marginTop: '2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {truncatePrompt(session.prompt)}
                  </div>

                  {/* Meta: directory + files changed */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '4px',
                      fontSize: '9px',
                      color: 'var(--xp-text-muted)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <Folder size={9} />
                      {shortDir(session.working_directory)}
                    </span>
                    {session.file_changes_count > 0 && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        <FileText size={9} />
                        {t('agentManager.resume.filesChanged', {
                          count: session.file_changes_count,
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer buttons */}
        <div style={footerStyle}>
          <button
            onClick={handleDiscardAll}
            style={{
              ...btnBase,
              background: 'transparent',
              color: 'var(--xp-text-muted)',
              border: '1px solid var(--xp-border)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--xp-surface-light)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Trash2 size={12} />
            {t('agentManager.resume.discardAll')}
          </button>

          <button
            onClick={handleResumeSelected}
            disabled={noneSelected}
            style={{
              ...btnBase,
              background: noneSelected ? 'var(--xp-text-muted)' : 'var(--xp-blue, #7aa2f7)',
              color: '#fff',
              opacity: noneSelected ? 0.5 : 1,
              cursor: noneSelected ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!noneSelected) {
                e.currentTarget.style.background = 'var(--xp-blue-bright, #89b4fa)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = noneSelected
                ? 'var(--xp-text-muted)'
                : 'var(--xp-blue, #7aa2f7)';
            }}
          >
            <Play size={12} />
            {allSelected
              ? t('agentManager.resume.resumeAll')
              : t('agentManager.resume.resumeSelected', { count: selectedIds.size })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentResumeDialog;
