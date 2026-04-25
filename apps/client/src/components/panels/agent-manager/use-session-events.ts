/**
 * Subscribe to agent-event Tauri events for a specific session.
 * Captures tool calls, tool results, text deltas, and approval requests
 * so the Agent Manager can show real-time output and progress per agent.
 */
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

export interface SessionEvent {
  id: string;
  ts: number;
  type: 'tool_call' | 'tool_result' | 'text_delta' | 'approval_request' | 'status' | 'error';
  toolName?: string;
  toolStatus?: 'pending' | 'running' | 'completed' | 'error';
  input?: Record<string, unknown>;
  result?: string;
  text?: string;
  message?: string;
}

interface AgentEventPayload {
  session_id: string;
  event_type: string;
  text?: string;
  tool_call?: {
    name?: string;
    status?: string;
    input?: Record<string, unknown>;
    result?: string;
  };
  message?: string;
}

const MAX_EVENTS_PER_SESSION = 200;

// Global per-session event store. Persists across component mount/unmount
// so collapsing/re-expanding an agent card retains the history.
const sessionEvents = new Map<string, SessionEvent[]>();
const subscribers = new Map<string, Set<() => void>>();

const notify = (sessionId: string) => {
  subscribers.get(sessionId)?.forEach((cb) => cb());
};

const appendEvent = (sessionId: string, event: SessionEvent) => {
  const list = sessionEvents.get(sessionId) ?? [];
  list.push(event);
  if (list.length > MAX_EVENTS_PER_SESSION) {
    list.splice(0, list.length - MAX_EVENTS_PER_SESSION);
  }
  sessionEvents.set(sessionId, list);
  notify(sessionId);
};

const updateLastTextDelta = (sessionId: string, text: string) => {
  const list = sessionEvents.get(sessionId) ?? [];
  const last = list[list.length - 1];
  if (last && last.type === 'text_delta') {
    last.text = (last.text ?? '') + text;
    last.ts = Date.now();
    notify(sessionId);
    return;
  }
  appendEvent(sessionId, {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    type: 'text_delta',
    text,
  });
};

// Single global listener — set up once and demultiplexes by session_id
let globalListenerSetup = false;
const setupGlobalListener = async () => {
  if (globalListenerSetup) return;
  globalListenerSetup = true;
  await listen<AgentEventPayload>('agent-event', (event) => {
    const payload = event.payload;
    if (!payload || !payload.session_id) return;
    const sid = payload.session_id;

    switch (payload.event_type) {
      case 'tool_call':
        appendEvent(sid, {
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          type: 'tool_call',
          toolName: payload.tool_call?.name,
          toolStatus: 'running',
          input: payload.tool_call?.input,
        });
        break;
      case 'tool_result':
        appendEvent(sid, {
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          type: 'tool_result',
          toolName: payload.tool_call?.name,
          toolStatus: (payload.tool_call?.status as SessionEvent['toolStatus']) ?? 'completed',
          result: payload.tool_call?.result,
        });
        break;
      case 'text_delta':
        if (payload.text) updateLastTextDelta(sid, payload.text);
        break;
      case 'approval_request':
        appendEvent(sid, {
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          type: 'approval_request',
          message: payload.message,
        });
        break;
      case 'error':
        appendEvent(sid, {
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          type: 'error',
          message: payload.message,
        });
        break;
    }
  });
};

export const useSessionEvents = (sessionId: string | null): SessionEvent[] => {
  const [events, setEvents] = useState<SessionEvent[]>(() =>
    sessionId ? (sessionEvents.get(sessionId) ?? []) : [],
  );

  useEffect(() => {
    if (!sessionId) return;
    setupGlobalListener();

    const update = () => setEvents([...(sessionEvents.get(sessionId) ?? [])]);
    update();

    let subs = subscribers.get(sessionId);
    if (!subs) {
      subs = new Set();
      subscribers.set(sessionId, subs);
    }
    subs.add(update);

    return () => {
      const s = subscribers.get(sessionId);
      s?.delete(update);
    };
  }, [sessionId]);

  return events;
};

/** Clear stored events for a session — useful when removing it. */
export const clearSessionEvents = (sessionId: string): void => {
  sessionEvents.delete(sessionId);
  subscribers.get(sessionId)?.forEach((cb) => cb());
};
