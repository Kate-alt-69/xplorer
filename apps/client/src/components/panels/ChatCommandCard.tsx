/**
 * Command action card for terminal command execution in the AI chat panel.
 * Displays the command, working directory, danger warnings, and terminal-style output.
 *
 * Extracted from ChatActionCards.tsx to stay under the 1000-line limit.
 */
import { useState } from 'react';
import {
  FolderOpen,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { type PendingFileAction, isDangerousCommand, isUnknownCommand } from './chat-file-actions';

// ---------------------------------------------------------------------------
// Command output display (terminal-style)
// ---------------------------------------------------------------------------

const MAX_OUTPUT_DISPLAY = 5000;

const CommandOutputBlock = ({
  output,
}: {
  output: { stdout: string; stderr: string; exit_code: number; timed_out?: boolean };
}) => {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = output.exit_code === 0 && !output.timed_out;
  const fullOutput = [output.stdout, output.stderr].filter(Boolean).join('\n');
  const isTruncated = fullOutput.length > MAX_OUTPUT_DISPLAY;
  const displayOutput = expanded ? fullOutput : fullOutput.slice(0, MAX_OUTPUT_DISPLAY);

  if (!fullOutput && !output.timed_out) {
    return (
      <div
        style={{
          padding: '8px 10px',
          fontFamily: 'monospace',
          fontSize: '11px',
          color: 'var(--xp-text-muted)',
          fontStyle: 'italic',
        }}
      >
        (no output)
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <pre
        style={{
          margin: 0,
          padding: '10px',
          borderRadius: '4px',
          background: '#1a1b26',
          border: `1px solid ${isSuccess ? 'rgba(158, 206, 106, 0.3)' : 'rgba(247, 118, 142, 0.3)'}`,
          fontSize: '11px',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          color: isSuccess ? '#9ece6a' : '#f7768e',
          maxHeight: expanded ? '400px' : '200px',
          overflowY: 'auto',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: '1.5',
        }}
      >
        {displayOutput}
        {isTruncated && !expanded && '\n... (output truncated)'}
      </pre>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          padding: '0 4px',
        }}
      >
        <span>
          Exit code: {output.exit_code}
          {output.timed_out ? ' (timed out)' : ''}
        </span>
        {isTruncated && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '4px',
              border: '1px solid var(--xp-border)',
              background: 'transparent',
              color: 'var(--xp-text-muted)',
              cursor: 'pointer',
              fontSize: '10px',
            }}
          >
            {expanded ? (
              <>
                <ChevronUp size={10} />
                Show less
              </>
            ) : (
              <>
                <ChevronDown size={10} />
                Show full output
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Command action card (terminal command execution)
// ---------------------------------------------------------------------------

interface CommandActionCardProps {
  pendingAction: PendingFileAction;
  onAllow: () => void;
  onReject: () => void;
}

export const CommandActionCard = ({ pendingAction, onAllow, onReject }: CommandActionCardProps) => {
  const { action, status } = pendingAction;
  const command = action.command ?? '';
  const cwd = action.cwd || action.path || '';
  const dangerReason = isDangerousCommand(command);
  const unknown = !dangerReason && isUnknownCommand(command);
  const warningLevel = dangerReason ? 'danger' : unknown ? 'unknown' : 'safe';

  return (
    <div
      role="region"
      aria-label={`Terminal command: ${command}`}
      style={{
        margin: '8px 0',
        border: `1px solid ${warningLevel === 'danger' ? 'rgba(247, 118, 142, 0.5)' : warningLevel === 'unknown' ? 'rgba(224, 175, 104, 0.5)' : 'var(--xp-border)'}`,
        borderRadius: '8px',
        background: 'var(--xp-surface)',
        overflow: 'hidden',
        fontSize: '13px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderBottom: '1px solid var(--xp-border)',
          background:
            warningLevel === 'danger'
              ? 'rgba(247, 118, 142, 0.08)'
              : warningLevel === 'unknown'
                ? 'rgba(224, 175, 104, 0.08)'
                : 'var(--xp-surface-light)',
        }}
      >
        <Terminal
          size={14}
          style={{
            color:
              warningLevel === 'danger'
                ? '#f7768e'
                : warningLevel === 'unknown'
                  ? '#e0af68'
                  : 'var(--xp-blue)',
          }}
        />
        <span style={{ fontWeight: 600, color: 'var(--xp-text)' }}>AI wants to run a command</span>
        {warningLevel === 'unknown' && (
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'rgba(224, 175, 104, 0.2)',
              color: '#e0af68',
              fontWeight: 700,
            }}
          >
            UNRECOGNIZED
          </span>
        )}
        {dangerReason && (
          <span
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'rgba(247, 118, 142, 0.15)',
              color: '#f7768e',
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <AlertTriangle size={10} />
            dangerous
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Command display */}
        <div
          style={{
            padding: '8px 10px',
            borderRadius: '4px',
            background: '#1a1b26',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: '12px',
            color: '#a9b1d6',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <span style={{ color: '#9ece6a', userSelect: 'none' }}>$ </span>
          {command}
        </div>

        {/* Working directory */}
        {cwd && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-text-muted)',
              fontSize: '11px',
            }}
          >
            <FolderOpen size={12} style={{ flexShrink: 0 }} />
            <span
              style={{
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={cwd}
            >
              {cwd}
            </span>
          </div>
        )}

        {/* Unknown command warning */}
        {unknown && status === 'pending' && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '4px',
              background: 'rgba(224, 175, 104, 0.1)',
              border: '1px solid rgba(224, 175, 104, 0.2)',
              color: '#e0af68',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangle size={12} style={{ flexShrink: 0 }} />
            <span>
              This command is not in the recognized safe list. It may still be safe, but please
              review carefully before running.
            </span>
          </div>
        )}

        {/* Danger warning */}
        {dangerReason && status === 'pending' && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '4px',
              background: 'rgba(247, 118, 142, 0.1)',
              border: '1px solid rgba(247, 118, 142, 0.2)',
              color: '#f7768e',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangle size={12} style={{ flexShrink: 0 }} />
            <span>
              <strong>Warning:</strong> {dangerReason}. Review this command carefully before
              allowing it.
            </span>
          </div>
        )}

        {/* Command output (after execution) */}
        {pendingAction.commandOutput && status === 'success' && (
          <CommandOutputBlock output={pendingAction.commandOutput} />
        )}
      </div>

      {/* Action buttons or status */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--xp-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          justifyContent: 'flex-end',
        }}
      >
        {status === 'pending' && (
          <>
            <button
              onClick={onReject}
              aria-label="Reject command execution"
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: '1px solid var(--xp-border)',
                background: 'transparent',
                color: 'var(--xp-text)',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Reject
            </button>
            <button
              onClick={onAllow}
              aria-label="Allow command execution"
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: 'none',
                background:
                  warningLevel === 'danger'
                    ? '#f7768e'
                    : warningLevel === 'unknown'
                      ? '#e0af68'
                      : 'var(--xp-blue)',
                color: warningLevel === 'unknown' ? '#1a1b26' : 'white',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              {warningLevel === 'danger'
                ? 'Run Anyway'
                : warningLevel === 'unknown'
                  ? 'Run (Unverified)'
                  : 'Run'}
            </button>
          </>
        )}

        {status === 'approved' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-text-muted)',
              fontSize: '12px',
            }}
            role="status"
            aria-label="Executing command"
          >
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            Running...
          </div>
        )}

        {status === 'success' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
            }}
            role="status"
          >
            <span
              style={{
                color:
                  pendingAction.commandOutput?.exit_code === 0
                    ? 'var(--xp-green, #9ece6a)'
                    : 'var(--xp-red, #f7768e)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {pendingAction.commandOutput?.exit_code === 0 ? (
                <>
                  <CheckCircle2 size={14} />
                  Completed
                </>
              ) : (
                <>
                  <XCircle size={14} />
                  Failed (exit {pendingAction.commandOutput?.exit_code})
                </>
              )}
            </span>
          </div>
        )}

        {status === 'rejected' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-text-muted)',
              fontSize: '12px',
            }}
            role="status"
          >
            <XCircle size={14} />
            Rejected by user
          </div>
        )}

        {status === 'error' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--xp-red, #f7768e)',
              fontSize: '12px',
            }}
            role="alert"
          >
            <XCircle size={14} />
            {pendingAction.error ?? 'Failed'}
          </div>
        )}
      </div>
    </div>
  );
};
