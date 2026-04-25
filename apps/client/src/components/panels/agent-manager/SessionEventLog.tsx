/**
 * Inline event log for an agent session. Shows tool calls, results, text
 * deltas, approvals, and errors as they stream in — so users can see what
 * the agent is actually doing instead of just a count.
 */
import { useRef, useEffect } from 'react';
import { Wrench, FileText, MessageSquare, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useSessionEvents, type SessionEvent } from './use-session-events';

interface SessionEventLogProps {
  sessionId: string;
}

const eventIcon = (event: SessionEvent) => {
  switch (event.type) {
    case 'tool_call':
    case 'tool_result':
      return <Wrench size={10} style={{ color: 'var(--xp-blue)', flexShrink: 0 }} />;
    case 'text_delta':
      return <MessageSquare size={10} style={{ color: 'var(--xp-text-muted)', flexShrink: 0 }} />;
    case 'approval_request':
      return <FileText size={10} style={{ color: '#e0af68', flexShrink: 0 }} />;
    case 'error':
      return <AlertCircle size={10} style={{ color: '#f7768e', flexShrink: 0 }} />;
    default:
      return (
        <CheckCircle2 size={10} style={{ color: 'var(--xp-green, #73daca)', flexShrink: 0 }} />
      );
  }
};

const truncate = (s: string | undefined, n: number): string => {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const renderToolInput = (input?: Record<string, unknown>): string => {
  if (!input) return '';
  // Show the most useful field first: path, command, query
  const path = input.path as string | undefined;
  const command = input.command as string | undefined;
  const query = input.query as string | undefined;
  if (path) return path;
  if (command) return command;
  if (query) return `"${query}"`;
  // Fallback: first string value
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
};

const SessionEventLog = ({ sessionId }: SessionEventLogProps) => {
  const events = useSessionEvents(sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div
        style={{
          padding: '8px',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          textAlign: 'center',
          fontStyle: 'italic',
        }}
      >
        Waiting for output…
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      style={{
        marginTop: '6px',
        padding: '6px',
        maxHeight: '240px',
        overflowY: 'auto',
        background: 'var(--xp-bg, rgba(0,0,0,0.2))',
        border: '1px solid var(--xp-border)',
        borderRadius: '4px',
        fontSize: '10px',
        fontFamily: 'monospace',
        color: 'var(--xp-text)',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
      }}
    >
      {events.map((event) => {
        if (event.type === 'tool_call') {
          return (
            <div
              key={event.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '5px', lineHeight: 1.4 }}
            >
              {eventIcon(event)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xp-blue)', fontWeight: 600 }}>{event.toolName}</span>
                {event.input && (
                  <span style={{ color: 'var(--xp-text-muted)', marginLeft: '6px' }}>
                    {truncate(renderToolInput(event.input), 80)}
                  </span>
                )}
              </div>
            </div>
          );
        }
        if (event.type === 'tool_result') {
          const isError = event.toolStatus === 'error';
          return (
            <div
              key={event.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '5px',
                lineHeight: 1.4,
                paddingLeft: '14px',
                color: isError ? '#f7768e' : 'var(--xp-green, #73daca)',
              }}
            >
              <span style={{ flexShrink: 0 }}>{isError ? '✗' : '✓'}</span>
              <span
                style={{
                  flex: 1,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  opacity: 0.85,
                }}
              >
                {truncate(event.result, 200)}
              </span>
            </div>
          );
        }
        if (event.type === 'text_delta') {
          return (
            <div
              key={event.id}
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--xp-text)',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                padding: '2px 0',
              }}
            >
              {event.text}
            </div>
          );
        }
        if (event.type === 'approval_request') {
          return (
            <div
              key={event.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                color: '#e0af68',
              }}
            >
              {eventIcon(event)}
              <span>
                Awaiting approval{event.message ? `: ${truncate(event.message, 80)}` : '…'}
              </span>
            </div>
          );
        }
        if (event.type === 'error') {
          return (
            <div
              key={event.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '5px',
                color: '#f7768e',
              }}
            >
              {eventIcon(event)}
              <span style={{ flex: 1 }}>{event.message ?? 'Error'}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};

export default SessionEventLog;
