/**
 * Diff computation and preview component for the AI chat panel.
 * Used to show before/after changes when the AI proposes editing a file.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'same' | 'add' | 'remove';
  lineNumber: { old?: number; new?: number };
  text: string;
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

/** Max lines to diff to prevent perf issues on large files */
const MAX_DIFF_LINES = 200;

/**
 * Compute a simple line-based diff between two strings.
 * Uses a basic LCS (Longest Common Subsequence) approach suitable for
 * short file diffs shown in the UI.
 */
const computeLineDiff = (oldText: string, newText: string): DiffLine[] => {
  const oldLines = oldText.split('\n').slice(0, MAX_DIFF_LINES);
  const newLines = newText.split('\n').slice(0, MAX_DIFF_LINES);

  // Build LCS table
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

  // Backtrack to get diff
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

/** Count changed lines in a diff */
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
// Styling helpers (avoids nested ternaries)
// ---------------------------------------------------------------------------

/** Get background color for a diff line type */
const diffLineBg = (type: DiffLine['type']): string => {
  if (type === 'add') return 'rgba(158, 206, 106, 0.1)';
  if (type === 'remove') return 'rgba(247, 118, 142, 0.1)';
  return 'transparent';
};

/** Get border-left color for a diff line type */
const diffLineBorder = (type: DiffLine['type']): string => {
  if (type === 'add') return '2px solid var(--xp-green, #9ece6a)';
  if (type === 'remove') return '2px solid var(--xp-red, #f7768e)';
  return '2px solid transparent';
};

/** Get text color for a diff line type */
const diffLineColor = (type: DiffLine['type']): string => {
  if (type === 'add') return 'var(--xp-green, #9ece6a)';
  if (type === 'remove') return 'var(--xp-red, #f7768e)';
  return 'var(--xp-text)';
};

/** Get the prefix character for a diff line type */
const diffLinePrefix = (type: DiffLine['type']): string => {
  if (type === 'add') return '+';
  if (type === 'remove') return '-';
  return ' ';
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DiffPreviewProps {
  previousContent: string;
  newContent: string;
}

/**
 * Inline diff preview component for edit_file actions.
 * Shows a before/after diff with add/remove highlighting.
 * Collapsed by default, showing only changed lines with context.
 */
const ChatDiffPreview = ({ previousContent, newContent }: DiffPreviewProps) => {
  const [expanded, setExpanded] = useState(false);
  const diff = computeLineDiff(previousContent, newContent);
  const { additions, removals } = countChanges(diff);

  // Only show changed lines + a few lines of context when collapsed
  const contextLines = 2;
  const changedIndices = new Set<number>();
  diff.forEach((line, idx) => {
    if (line.type !== 'same') {
      for (
        let k = Math.max(0, idx - contextLines);
        k <= Math.min(diff.length - 1, idx + contextLines);
        k++
      ) {
        changedIndices.add(k);
      }
    }
  });

  const visibleDiff = expanded ? diff : diff.filter((_, idx) => changedIndices.has(idx));
  const hasHiddenLines = !expanded && visibleDiff.length < diff.length;

  return (
    <div style={{ marginTop: '4px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '4px',
          fontSize: '11px',
        }}
      >
        <span style={{ color: 'var(--xp-text-muted)' }}>Changes:</span>
        {additions > 0 && <span style={{ color: 'var(--xp-green, #9ece6a)' }}>+{additions}</span>}
        {removals > 0 && <span style={{ color: 'var(--xp-red, #f7768e)' }}>-{removals}</span>}
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: 'var(--xp-blue)',
            cursor: 'pointer',
            fontSize: '11px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            padding: 0,
          }}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded ? 'Collapse' : 'Expand all'}
        </button>
      </div>
      <div
        style={{
          borderRadius: '4px',
          border: '1px solid var(--xp-border)',
          background: 'var(--xp-bg)',
          maxHeight: expanded ? '300px' : '150px',
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
            }}
          >
            {diff.length - visibleDiff.length} unchanged lines hidden
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatDiffPreview;
