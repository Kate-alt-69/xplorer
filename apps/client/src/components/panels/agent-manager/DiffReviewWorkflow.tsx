/**
 * Diff Review Workflow — modal overlay that wraps UnifiedDiffReview.
 *
 * Shown when an agent completes work and the user clicks "Review Changes"
 * from the completion notification or session history. Provides:
 *
 *   - Full-screen overlay with scrollable diff view
 *   - "Accept & Commit" / "Reject All" / "Cherry-pick" bulk actions
 *   - Integration with git staging + commit
 *   - Wired to agent completion notification events
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, GitCommit, RotateCcw, CheckCircle2 } from 'lucide-react';
import UnifiedDiffReview, { type FileDiff } from './UnifiedDiffReview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffReviewWorkflowProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Close the modal */
  onClose: () => void;
  /** Agent session name */
  sessionName: string;
  /** Agent session ID */
  sessionId: string;
  /** File diffs to review */
  files: FileDiff[];
  /** Called when user accepts files (stages + commits) */
  onAcceptAndCommit?: (filePaths: string[], commitMessage: string) => void;
  /** Called when user rejects all (reverts files) */
  onRejectAll?: (filePaths: string[]) => void;
  /** Called when user opens a file in the editor */
  onEditFile?: (filePath: string) => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(6px)',
  animation: 'fadeIn 0.15s ease-out',
};

const modalStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: '900px',
  maxHeight: 'calc(100vh - 80px)',
  margin: '40px auto',
  borderRadius: '12px',
  border: '1px solid var(--xp-border)',
  background: 'var(--xp-surface)',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
  overflow: 'hidden',
  flex: '1 1 0%',
  minHeight: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '12px 16px',
  borderBottom: '1px solid var(--xp-border)',
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  flex: '1 1 0%',
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  padding: '8px 12px',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 16px',
  borderTop: '1px solid var(--xp-border)',
  flexShrink: 0,
  justifyContent: 'flex-end',
};

const btnBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 14px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  transition: 'background 0.15s ease',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DiffReviewWorkflow = ({
  isOpen,
  onClose,
  sessionName,
  sessionId: _sessionId,
  files,
  onAcceptAndCommit,
  onRejectAll,
  onEditFile,
}: DiffReviewWorkflowProps) => {
  const { t } = useTranslation();
  const [acceptedFiles, setAcceptedFiles] = useState<Set<string>>(() => new Set());
  const [rejectedFiles, setRejectedFiles] = useState<Set<string>>(() => new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [committed, setCommitted] = useState(false);

  // Default commit message
  useEffect(() => {
    if (isOpen && !commitMessage) {
      setCommitMessage(`feat: apply changes from agent "${sessionName}"`);
    }
  }, [isOpen, sessionName, commitMessage]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setAcceptedFiles(new Set());
      setRejectedFiles(new Set());
      setCommitted(false);
    }
  }, [isOpen]);

  // Close on Escape
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

  const handleAcceptFile = useCallback((filePath: string) => {
    setAcceptedFiles((prev) => {
      const next = new Set(prev);
      next.add(filePath);
      return next;
    });
    setRejectedFiles((prev) => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  const handleRejectFile = useCallback((filePath: string) => {
    setRejectedFiles((prev) => {
      const next = new Set(prev);
      next.add(filePath);
      return next;
    });
    setAcceptedFiles((prev) => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  const handleAcceptAll = useCallback(() => {
    const allPaths = new Set(files.map((f) => f.filePath));
    setAcceptedFiles(allPaths);
    setRejectedFiles(new Set());
  }, [files]);

  const handleRejectAllFiles = useCallback(() => {
    const allPaths = new Set(files.map((f) => f.filePath));
    setRejectedFiles(allPaths);
    setAcceptedFiles(new Set());
  }, [files]);

  const handleCommit = useCallback(() => {
    const filesToCommit = Array.from(acceptedFiles);
    if (filesToCommit.length === 0) return;
    onAcceptAndCommit?.(filesToCommit, commitMessage || 'Apply agent changes');
    setCommitted(true);
  }, [acceptedFiles, commitMessage, onAcceptAndCommit]);

  const handleRejectAllAndClose = useCallback(() => {
    const allPaths = files.map((f) => f.filePath);
    onRejectAll?.(allPaths);
    onClose();
  }, [files, onRejectAll, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const pendingCount = useMemo(() => {
    const decided = acceptedFiles.size + rejectedFiles.size;
    return files.length - decided;
  }, [files.length, acceptedFiles.size, rejectedFiles.size]);

  if (!isOpen) return null;

  return (
    <div style={backdropStyle} onClick={handleBackdropClick}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-label={t('agentManager.diffReview.title')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={headerStyle}>
          <GitCommit size={16} style={{ color: 'var(--xp-blue, #7aa2f7)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--xp-text)' }}>
              {t('agentManager.diffWorkflow.title')}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--xp-text-muted)', marginTop: '1px' }}>
              {sessionName} — {t('agentManager.diffReview.filesChanged', { count: files.length })}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--xp-text-muted)',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — the diff review */}
        <div style={bodyStyle}>
          {committed ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                flex: 1,
                color: 'var(--xp-green, #73daca)',
              }}
            >
              <CheckCircle2 size={40} />
              <div style={{ fontSize: '14px', fontWeight: 600 }}>
                {t('agentManager.diffWorkflow.committed')}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--xp-text-muted)' }}>
                {t('agentManager.diffWorkflow.committedDetail', {
                  count: acceptedFiles.size,
                })}
              </div>
            </div>
          ) : (
            <UnifiedDiffReview
              files={files}
              onAcceptFile={handleAcceptFile}
              onRejectFile={handleRejectFile}
              onEditFile={onEditFile}
              onAcceptAll={handleAcceptAll}
              onRejectAll={handleRejectAllFiles}
            />
          )}
        </div>

        {/* Footer */}
        {!committed && (
          <div style={footerStyle}>
            {/* Commit message input */}
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={t('agentManager.diffWorkflow.commitMessagePlaceholder')}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-bg)',
                color: 'var(--xp-text)',
                fontSize: '12px',
                outline: 'none',
              }}
            />

            {/* Status */}
            {pendingCount > 0 && (
              <span style={{ fontSize: '10px', color: 'var(--xp-text-muted)', flexShrink: 0 }}>
                {pendingCount} {t('agentManager.diffReview.pending')}
              </span>
            )}

            {/* Reject all */}
            <button
              onClick={handleRejectAllAndClose}
              style={{
                ...btnBase,
                background: 'transparent',
                border: '1px solid var(--xp-red, #f7768e)',
                color: 'var(--xp-red, #f7768e)',
              }}
            >
              <RotateCcw size={12} />
              {t('agentManager.diffWorkflow.rejectAndRevert')}
            </button>

            {/* Accept & Commit */}
            <button
              onClick={handleCommit}
              disabled={acceptedFiles.size === 0}
              style={{
                ...btnBase,
                background:
                  acceptedFiles.size > 0 ? 'var(--xp-green, #73daca)' : 'var(--xp-surface-light)',
                color: acceptedFiles.size > 0 ? '#1a1b26' : 'var(--xp-text-muted)',
                cursor: acceptedFiles.size > 0 ? 'pointer' : 'not-allowed',
                opacity: acceptedFiles.size > 0 ? 1 : 0.5,
              }}
            >
              <GitCommit size={12} />
              {t('agentManager.diffWorkflow.acceptAndCommit')}
              {acceptedFiles.size > 0 && ` (${acceptedFiles.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiffReviewWorkflow;
