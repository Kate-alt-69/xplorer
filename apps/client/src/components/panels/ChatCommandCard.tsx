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

/** Build a one-line summary for a completed command */
const commandSummary = (pendingAction: PendingFileAction): string => {
  const cmd = pendingAction.action.command ?? '';
  const truncatedCmd = cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
  const output = pendingAction.commandOutput;

  if (!output) return truncatedCmd;

  if (output.exit_code === 0) {
    const firstLine = (output.stdout || 'completed').split('\n')[0]?.trim() ?? 'completed';
    const summary = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
    return `${truncatedCmd} — ${summary}`;
  }

  const errLine = (output.stderr || output.stdout || '').split('\n')[0]?.trim() ?? '';
  const errSummary = errLine.length > 60 ? `${errLine.slice(0, 57)}...` : errLine;
  return `${truncatedCmd} — exit code ${output.exit_code}${errSummary ? `: ${errSummary}` : ''}`;
};

export const CommandActionCard = ({ pendingAction, onAllow, onReject }: CommandActionCardProps) => {
  const { action, status } = pendingAction;
  const command = action.command ?? '';
  const cwd = action.cwd || action.path || '';
  const dangerReason = isDangerousCommand(command);
  const unknown = !dangerReason && isUnknownCommand(command);
  const warningLevel = dangerReason ? 'danger' : unknown ? 'unknown' : 'safe';

  const isCompleted = status === 'success' || status === 'rejected' || status === 'error';
  const _isRunning = status === 'approved';
  const [isExpanded, setIsExpanded] = useState(false);

  // Collapsed view for pending commands (click to expand details)
  if (status === 'pending' && !isExpanded) {
    const truncatedCmd = command.length > 50 ? `${command.slice(0, 47)}...` : command;
    return (
      <div
        role="region"
        aria-label={`Terminal command: ${command}`}
        onClick={() => setIsExpanded(true)}
        style={{
          margin: '4px 0',
          border: `1px solid ${warningLevel === 'danger' ? 'rgba(247, 118, 142, 0.5)' : warningLevel === 'unknown' ? 'rgba(224, 175, 104, 0.5)' : 'var(--xp-border)'}`,
          borderRadius: '6px',
          background: 'var(--xp-surface)',
          padding: '6px 10px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
        }}
      >
        <Terminal
          size={13}
          style={{
            color:
              warningLevel === 'danger'
                ? '#f7768e'
                : warningLevel === 'unknown'
                  ? '#e0af68'
                  : 'var(--xp-blue)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: 'var(--xp-text-muted)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <code style={{ color: 'var(--xp-text)', fontFamily: 'monospace', fontSize: '11px' }}>
            {truncatedCmd}
          </code>
        </span>
        {warningLevel === 'danger' && (
          <span
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              background: 'rgba(247, 118, 142, 0.2)',
              color: '#f7768e',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            DANGEROUS
          </span>
        )}
        {warningLevel === 'unknown' && (
          <span
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              background: 'rgba(224, 175, 104, 0.2)',
              color: '#e0af68',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            UNRECOGNIZED
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReject();
          }}
          style={{
            padding: '2px 8px',
            borderRadius: '3px',
            border: '1px solid var(--xp-border)',
            background: 'transparent',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            fontSize: '11px',
            flexShrink: 0,
          }}
        >
          Reject
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAllow();
          }}
          style={{
            padding: '2px 8px',
            borderRadius: '3px',
            border: 'none',
            background:
              warningLevel === 'danger'
                ? '#f7768e'
                : warningLevel === 'unknown'
                  ? '#e0af68'
                  : 'var(--xp-blue)',
            color: warningLevel === 'unknown' ? '#1a1b26' : 'white',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {warningLevel === 'danger' ? 'Run!' : 'Run'}
        </button>
        <ChevronDown size={14} style={{ color: 'var(--xp-text-muted)', flexShrink: 0 }} />
      </div>
    );
  }

  // Collapsed view for completed commands
  if (isCompleted && !isExpanded) {
    const isSuccess = status === 'success' && pendingAction.commandOutput?.exit_code === 0;
    const isRejected = status === 'rejected';

    return (
      <div
        role="region"
        aria-label={`Terminal command: ${command}`}
        onClick={() => setIsExpanded(true)}
        style={{
          margin: '4px 0',
          border: '1px solid var(--xp-border)',
          borderRadius: '6px',
          background: 'var(--xp-surface)',
          padding: '6px 10px',
          fontSize: '12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          opacity: isRejected ? 0.6 : 1,
        }}
        title="Click to expand"
      >
        {isSuccess ? (
          <CheckCircle2 size={13} style={{ flexShrink: 0, color: 'var(--xp-green, #9ece6a)' }} />
        ) : isRejected ? (
          <XCircle size={13} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        ) : (
          <XCircle size={13} style={{ flexShrink: 0, color: 'var(--xp-red, #f7768e)' }} />
        )}
        <Terminal size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            color: 'var(--xp-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {isRejected
            ? `${command.length > 60 ? `${command.slice(0, 57)}...` : command} — rejected`
            : commandSummary(pendingAction)}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
      </div>
    );
  }

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
          cursor: isCompleted ? 'pointer' : undefined,
        }}
        onClick={isCompleted ? () => setIsExpanded(false) : undefined}
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
        <span style={{ fontWeight: 600, color: 'var(--xp-text)' }}>
          {isCompleted ? 'Command' : 'AI wants to run a command'}
        </span>
        {warningLevel === 'unknown' && !isCompleted && (
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
        {dangerReason && !isCompleted && (
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
        {isCompleted && (
          <ChevronUp
            size={14}
            style={{ marginLeft: 'auto', color: 'var(--xp-text-muted)', cursor: 'pointer' }}
          />
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
