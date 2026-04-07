/**
 * Unified Diff Review — shows all files modified by an agent session
 * in a single scrollable view with accept/reject controls.
 *
 * Reuses the LCS-based diff computation from ChatDiffPreview.
 * This is the key trust-building feature: users see everything
 * before committing agent work.
 */
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle, Pencil, ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'same' | 'add' | 'remove';
  lineNumber: { old?: number; new?: number };
  text: string;
}

export interface FileDiff {
  /** Absolute file path */
  filePath: string;
  /** File name (last segment) */
  fileName: string;
  /** Original content before agent changes */
  previousContent: string;
  /** New content after agent changes */
  newContent: string;
}

type FileDecision = 'pending' | 'accepted' | 'rejected';

interface UnifiedDiffReviewProps {
  /** List of file diffs to review */
  files: FileDiff[];
  /** Called when user accepts a file (keep changes) */
  onAcceptFile: (filePath: string) => void;
  /** Called when user rejects a file (revert via git checkout) */
  onRejectFile: (filePath: string) => void;
  /** Called when user wants to edit a file (open in editor) */
  onEditFile?: (filePath: string) => void;
  /** Called when user accepts all files */
  onAcceptAll: () => void;
  /** Called when user rejects all files */
  onRejectAll: () => void;
}

// ---------------------------------------------------------------------------
// Diff computation (reused from ChatDiffPreview)
// ---------------------------------------------------------------------------

const MAX_DIFF_LINES = 200;

const computeLineDiff = (oldText: string, newText: string): DiffLine[] => {
  const oldLines = oldText.split('\n').slice(0, MAX_DIFF_LINES);
  const newLines = newText.split('\n').slice(0, MAX_DIFF_LINES);

  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'same', lineNumber: { old: i, new: j }, text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', lineNumber: { new: j }, text: newLines[j - 1] });
      j--;
    } else if (i > 0) {
      result.unshift({ type: 'remove', lineNumber: { old: i }, text: oldLines[i - 1] });
      i--;
    }
  }

  return result;
};

const countChanges = (diff: DiffLine[]): { additions: number; removals: number } => {
  let additions = 0;
  let removals = 0;
  for (const line of diff) {
    if (line.type === 'add') additions++;
    if (line.type === 'remove') removals++;
  }
  return { additions, removals };
};

// ---------------------------------------------------------------------------
// Styling helpers
// ---------------------------------------------------------------------------

const diffLineBg = (type: DiffLine['type']): string => {
  if (type === 'add') return 'rgba(158, 206, 106, 0.1)';
  if (type === 'remove') return 'rgba(247, 118, 142, 0.1)';
  return 'transparent';
};

const diffLineBorder = (type: DiffLine['type']): string => {
  if (type === 'add') return '2px solid var(--xp-green, #9ece6a)';
  if (type === 'remove') return '2px solid var(--xp-red, #f7768e)';
  return '2px solid transparent';
};

const diffLineColor = (type: DiffLine['type']): string => {
  if (type === 'add') return 'var(--xp-green, #9ece6a)';
  if (type === 'remove') return 'var(--xp-red, #f7768e)';
  return 'var(--xp-text)';
};

const diffLinePrefix = (type: DiffLine['type']): string => {
  if (type === 'add') return '+';
  if (type === 'remove') return '-';
  return ' ';
};

const DECISION_COLORS: Record<FileDecision, string> = {
  pending: 'var(--xp-text-muted)',
  accepted: 'var(--xp-green, #9ece6a)',
  rejected: 'var(--xp-red, #f7768e)',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const FileDiffSection = ({
  file,
  decision,
  onAccept,
  onReject,
  onEdit,
}: {
  file: FileDiff;
  decision: FileDecision;
  onAccept: () => void;
  onReject: () => void;
  onEdit?: () => void;
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const diff = useMemo(
    () => computeLineDiff(file.previousContent, file.newContent),
    [file.previousContent, file.newContent],
  );
  const { additions, removals } = useMemo(() => countChanges(diff), [diff]);

  // Show changed lines + context when collapsed
  const contextLines = 3;
  const changedIndices = useMemo(() => {
    const indices = new Set<number>();
    diff.forEach((line, idx) => {
      if (line.type !== 'same') {
        for (
          let k = Math.max(0, idx - contextLines);
          k <= Math.min(diff.length - 1, idx + contextLines);
          k++
        ) {
          indices.add(k);
        }
      }
    });
    return indices;
  }, [diff]);

  const visibleDiff = expanded ? diff : diff.filter((_, idx) => changedIndices.has(idx));
  const hasHiddenLines = !expanded && visibleDiff.length < diff.length;

  const isDecided = decision !== 'pending';

  const resolveDecisionLabel = (): string | null => {
    if (decision === 'accepted') return t('agentManager.diffReview.accepted');
    if (decision === 'rejected') return t('agentManager.diffReview.rejected');
    return null;
  };
  const decisionLabel = resolveDecisionLabel();

  return (
    <div
      style={{
        border: `1px solid ${isDecided ? DECISION_COLORS[decision] : 'var(--xp-border)'}`,
        borderRadius: '6px',
        background: 'var(--xp-surface)',
        overflow: 'hidden',
        opacity: isDecided ? 0.75 : 1,
        transition: 'opacity 0.2s, border-color 0.2s',
      }}
    >
      {/* File header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 10px',
          borderBottom: expanded ? '1px solid var(--xp-border)' : 'none',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        ) : (
          <ChevronRight size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        )}

        <FileCode2 size={13} style={{ flexShrink: 0, color: 'var(--xp-blue, #7aa2f7)' }} />

        <span
          style={{
            flex: 1,
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--xp-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={file.filePath}
        >
          {file.fileName}
        </span>

        {/* Change stats */}
        {additions > 0 && (
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--xp-green, #9ece6a)' }}>
            +{additions}
          </span>
        )}
        {removals > 0 && (
          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--xp-red, #f7768e)' }}>
            -{removals}
          </span>
        )}

        {/* Decision badge */}
        {decisionLabel && (
          <span
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: DECISION_COLORS[decision],
              background: 'var(--xp-surface-light, rgba(255,255,255,0.05))',
              borderRadius: '3px',
              padding: '1px 5px',
            }}
          >
            {decisionLabel}
          </span>
        )}

        {/* Per-file action buttons */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onAccept}
            disabled={decision === 'accepted'}
            title={t('agentManager.diffReview.acceptFile')}
            aria-label={t('agentManager.diffReview.acceptFile')}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              cursor: decision === 'accepted' ? 'default' : 'pointer',
              color: decision === 'accepted' ? 'var(--xp-green, #9ece6a)' : 'var(--xp-text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              fontSize: '10px',
              opacity: decision === 'accepted' ? 0.6 : 1,
            }}
          >
            <CheckCircle2 size={10} />
            {t('agentManager.diffReview.acceptFile')}
          </button>
          <button
            onClick={onReject}
            disabled={decision === 'rejected'}
            title={t('agentManager.diffReview.rejectFile')}
            aria-label={t('agentManager.diffReview.rejectFile')}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              cursor: decision === 'rejected' ? 'default' : 'pointer',
              color: decision === 'rejected' ? 'var(--xp-red, #f7768e)' : 'var(--xp-text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              fontSize: '10px',
              opacity: decision === 'rejected' ? 0.6 : 1,
            }}
          >
            <XCircle size={10} />
            {t('agentManager.diffReview.rejectFile')}
          </button>
          {onEdit && (
            <button
              onClick={onEdit}
              title={t('agentManager.diffReview.editFile')}
              aria-label={t('agentManager.diffReview.editFile')}
              style={{
                background: 'none',
                border: '1px solid var(--xp-border)',
                borderRadius: '4px',
                padding: '2px 6px',
                cursor: 'pointer',
                color: 'var(--xp-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '10px',
              }}
            >
              <Pencil size={10} />
              {t('agentManager.diffReview.editFile')}
            </button>
          )}
        </div>
      </div>

      {/* Diff lines */}
      {expanded && (
        <div
          style={{
            maxHeight: '300px',
            overflowY: 'auto',
            fontSize: '11px',
            fontFamily: 'monospace',
          }}
        >
          {visibleDiff.map((line, idx) => (
            <div
              key={idx} // eslint-disable-line react/no-array-index-key
              style={{
                display: 'flex',
                padding: '0 8px',
                lineHeight: '18px',
                background: diffLineBg(line.type),
                borderLeft: diffLineBorder(line.type),
              }}
            >
              <span
                style={{
                  width: '28px',
                  flexShrink: 0,
                  color: 'var(--xp-text-muted)',
                  opacity: 0.5,
                  textAlign: 'right',
                  paddingRight: '6px',
                  userSelect: 'none',
                }}
              >
                {line.lineNumber.old ?? ''}
              </span>
              <span
                style={{
                  width: '28px',
                  flexShrink: 0,
                  color: 'var(--xp-text-muted)',
                  opacity: 0.5,
                  textAlign: 'right',
                  paddingRight: '6px',
                  userSelect: 'none',
                }}
              >
                {line.lineNumber.new ?? ''}
              </span>
              <span
                style={{
                  color: diffLineColor(line.type),
                  whiteSpace: 'pre',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {diffLinePrefix(line.type)}
                {line.text}
              </span>
            </div>
          ))}
          {hasHiddenLines && (
            <div
              style={{
                padding: '4px 8px',
                color: 'var(--xp-text-muted)',
                textAlign: 'center',
                borderTop: '1px dashed var(--xp-border)',
                fontSize: '10px',
                cursor: 'pointer',
              }}
              onClick={() => setExpanded(true)}
            >
              {t('agentManager.diffReview.hiddenLines', {
                count: diff.length - visibleDiff.length,
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const UnifiedDiffReview = ({
  files,
  onAcceptFile,
  onRejectFile,
  onEditFile,
  onAcceptAll,
  onRejectAll,
}: UnifiedDiffReviewProps) => {
  const { t } = useTranslation();

  const [decisions, setDecisions] = useState<Map<string, FileDecision>>(() => {
    const map = new Map<string, FileDecision>();
    for (const file of files) {
      map.set(file.filePath, 'pending');
    }
    return map;
  });

  const handleAcceptFile = useCallback(
    (filePath: string) => {
      setDecisions((prev) => {
        const next = new Map(prev);
        next.set(filePath, 'accepted');
        return next;
      });
      onAcceptFile(filePath);
    },
    [onAcceptFile],
  );

  const handleRejectFile = useCallback(
    (filePath: string) => {
      setDecisions((prev) => {
        const next = new Map(prev);
        next.set(filePath, 'rejected');
        return next;
      });
      onRejectFile(filePath);
    },
    [onRejectFile],
  );

  const handleAcceptAll = useCallback(() => {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        next.set(key, 'accepted');
      }
      return next;
    });
    onAcceptAll();
  }, [onAcceptAll]);

  const handleRejectAll = useCallback(() => {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        next.set(key, 'rejected');
      }
      return next;
    });
    onRejectAll();
  }, [onRejectAll]);

  const pendingCount = useMemo(
    () => Array.from(decisions.values()).filter((d) => d === 'pending').length,
    [decisions],
  );
  const acceptedCount = useMemo(
    () => Array.from(decisions.values()).filter((d) => d === 'accepted').length,
    [decisions],
  );
  const rejectedCount = useMemo(
    () => Array.from(decisions.values()).filter((d) => d === 'rejected').length,
    [decisions],
  );

  if (files.length === 0) {
    return (
      <div
        style={{
          padding: '24px',
          color: 'var(--xp-text-muted)',
          fontSize: '12px',
          textAlign: 'center',
        }}
      >
        {t('agentManager.diffReview.noChanges')}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minHeight: 0,
        flex: '1 1 0%',
      }}
    >
      {/* Top bar with summary and bulk actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          borderRadius: '6px',
          background: 'var(--xp-surface)',
          border: '1px solid var(--xp-border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--xp-text)',
          }}
        >
          {t('agentManager.diffReview.title')}
        </span>

        <span
          style={{
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
          }}
        >
          {t('agentManager.diffReview.filesChanged', { count: files.length })}
        </span>

        {/* Status badges */}
        <div
          style={{
            display: 'flex',
            gap: '6px',
            marginLeft: 'auto',
            alignItems: 'center',
          }}
        >
          {pendingCount > 0 && (
            <span style={{ fontSize: '9px', color: 'var(--xp-text-muted)' }}>
              {pendingCount} {t('agentManager.diffReview.pending')}
            </span>
          )}
          {acceptedCount > 0 && (
            <span style={{ fontSize: '9px', color: 'var(--xp-green, #9ece6a)' }}>
              {acceptedCount} {t('agentManager.diffReview.accepted').toLowerCase()}
            </span>
          )}
          {rejectedCount > 0 && (
            <span style={{ fontSize: '9px', color: 'var(--xp-red, #f7768e)' }}>
              {rejectedCount} {t('agentManager.diffReview.rejected').toLowerCase()}
            </span>
          )}
        </div>

        {/* Bulk action buttons */}
        <button
          onClick={handleAcceptAll}
          style={{
            background: 'var(--xp-green, #9ece6a)',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 10px',
            cursor: 'pointer',
            color: '#1a1b26',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexShrink: 0,
          }}
        >
          <CheckCircle2 size={12} />
          {t('agentManager.diffReview.acceptAll')}
        </button>
        <button
          onClick={handleRejectAll}
          style={{
            background: 'none',
            border: '1px solid var(--xp-red, #f7768e)',
            borderRadius: '4px',
            padding: '4px 10px',
            cursor: 'pointer',
            color: 'var(--xp-red, #f7768e)',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexShrink: 0,
          }}
        >
          <XCircle size={12} />
          {t('agentManager.diffReview.rejectAll')}
        </button>
      </div>

      {/* Scrollable file diff list */}
      <div
        style={{
          overflowY: 'auto',
          flex: '1 1 0%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          paddingBottom: '8px',
        }}
      >
        {files.map((file) => (
          <FileDiffSection
            key={file.filePath}
            file={file}
            decision={decisions.get(file.filePath) ?? 'pending'}
            onAccept={() => handleAcceptFile(file.filePath)}
            onReject={() => handleRejectFile(file.filePath)}
            onEdit={onEditFile ? () => onEditFile(file.filePath) : undefined}
          />
        ))}
      </div>
    </div>
  );
};

export default UnifiedDiffReview;
