import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/storage-keys', () => ({
  STORAGE_KEYS: {
    AGENT_SESSION_HISTORY: 'xplorer:agent-session-history',
  },
}));

import { useSessionHistory } from '@/components/panels/agent-manager/use-session-history';
import type { AgentSessionSummary } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => {
      store[key] = val;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSession = (overrides: Partial<AgentSessionSummary> = {}): AgentSessionSummary => ({
  id: `session-${Math.random().toString(36).slice(2, 8)}`,
  name: 'Test Agent',
  prompt: 'Do something',
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  status: 'done',
  working_directory: '/tmp/test',
  created_at: Date.now() - 60_000,
  updated_at: Date.now(),
  file_changes_count: 3,
  tool_calls_count: 10,
  turns_completed: 5,
  error_message: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSessionHistory', () => {
  describe('initial state', () => {
    it('starts with empty entries when localStorage is empty', () => {
      const { result } = renderHook(() => useSessionHistory([]));
      expect(result.current.entries).toEqual([]);
      expect(result.current.totalCount).toBe(0);
    });

    it('loads existing entries from localStorage', () => {
      const existing = [
        {
          id: 'old-1',
          name: 'Old Agent',
          prompt: 'old prompt',
          model: 'gpt-4o',
          provider: 'openai',
          resultStatus: 'done' as const,
          workingDirectory: '/tmp',
          createdAt: 1000,
          completedAt: 2000,
          durationMs: 1000,
          filesChangedCount: 1,
          toolCallsCount: 2,
          turnsCompleted: 3,
          costUsd: 0.5,
          errorMessage: null,
        },
      ];
      store['xplorer:agent-session-history'] = JSON.stringify(existing);

      const { result } = renderHook(() => useSessionHistory([]));
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].id).toBe('old-1');
    });
  });

  describe('save — terminal session detection', () => {
    it('saves a session when status is "done"', () => {
      const doneSession = makeSession({ id: 'done-1', status: 'done' });
      const { result } = renderHook(() => useSessionHistory([doneSession]));

      // The useEffect should have auto-saved
      expect(result.current.entries.find((e) => e.id === 'done-1')).toBeDefined();
    });

    it('saves a session when status is "error"', () => {
      const errorSession = makeSession({
        id: 'err-1',
        status: 'error',
        error_message: 'Something went wrong',
      });
      const { result } = renderHook(() => useSessionHistory([errorSession]));
      const entry = result.current.entries.find((e) => e.id === 'err-1');
      expect(entry).toBeDefined();
      expect(entry!.errorMessage).toBe('Something went wrong');
    });

    it('saves a session when status is "cancelled"', () => {
      const cancelledSession = makeSession({ id: 'can-1', status: 'cancelled' });
      const { result } = renderHook(() => useSessionHistory([cancelledSession]));
      expect(result.current.entries.find((e) => e.id === 'can-1')).toBeDefined();
    });

    it('does NOT save sessions with non-terminal status', () => {
      const thinkingSession = makeSession({ id: 'th-1', status: 'thinking' });
      const { result } = renderHook(() => useSessionHistory([thinkingSession]));
      expect(result.current.entries.find((e) => e.id === 'th-1')).toBeUndefined();
    });

    it('does not duplicate on re-render with same sessions', () => {
      const session = makeSession({ id: 'dup-1', status: 'done' });
      const { result, rerender } = renderHook(({ sessions }) => useSessionHistory(sessions), {
        initialProps: { sessions: [session] },
      });

      expect(result.current.entries.filter((e) => e.id === 'dup-1')).toHaveLength(1);

      // Re-render with same sessions
      rerender({ sessions: [session] });
      expect(result.current.entries.filter((e) => e.id === 'dup-1')).toHaveLength(1);
    });
  });

  describe('eviction at 50 entries', () => {
    it('trims to 50 entries when more are added', () => {
      // Pre-fill localStorage with 49 entries
      const existing = Array.from({ length: 49 }, (_, i) => ({
        id: `pre-${i}`,
        name: `Agent ${i}`,
        prompt: 'prompt',
        model: 'gpt-4o',
        provider: 'openai',
        resultStatus: 'done' as const,
        workingDirectory: '/tmp',
        createdAt: 1000 + i,
        completedAt: 2000 + i,
        durationMs: 1000,
        filesChangedCount: 0,
        toolCallsCount: 0,
        turnsCompleted: 0,
        costUsd: null,
        errorMessage: null,
      }));
      store['xplorer:agent-session-history'] = JSON.stringify(existing);

      // Add 3 new terminal sessions (total would be 52, trimmed to 50)
      const newSessions = [
        makeSession({ id: 'new-1', status: 'done' }),
        makeSession({ id: 'new-2', status: 'done' }),
        makeSession({ id: 'new-3', status: 'done' }),
      ];

      const { result } = renderHook(() => useSessionHistory(newSessions));
      expect(result.current.totalCount).toBeLessThanOrEqual(50);
    });
  });

  describe('clearAll', () => {
    it('removes all entries and clears localStorage', () => {
      // Pre-populate localStorage so the hook loads entries without needing
      // a terminal session in the `sessions` prop (which would re-add itself
      // after clearAll triggers a re-render via the useEffect).
      const existing = [
        {
          id: 'clear-1',
          name: 'Agent',
          prompt: 'p',
          model: 'gpt-4o',
          provider: 'openai',
          resultStatus: 'done' as const,
          workingDirectory: '/tmp',
          createdAt: 1000,
          completedAt: 2000,
          durationMs: 1000,
          filesChangedCount: 0,
          toolCallsCount: 0,
          turnsCompleted: 0,
          costUsd: null,
          errorMessage: null,
        },
      ];
      store['xplorer:agent-session-history'] = JSON.stringify(existing);

      const { result } = renderHook(() => useSessionHistory([]));

      expect(result.current.totalCount).toBe(1);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.entries).toEqual([]);
      expect(result.current.totalCount).toBe(0);
      const stored = JSON.parse(store['xplorer:agent-session-history']);
      expect(stored).toEqual([]);
    });
  });

  describe('removeEntry', () => {
    it('removes a single entry by ID', () => {
      // Pre-populate via localStorage to avoid the useEffect re-adding
      // sessions that are still in the `sessions` prop.
      const existing = [
        {
          id: 'rem-1',
          name: 'A1',
          prompt: 'p',
          model: 'gpt-4o',
          provider: 'openai',
          resultStatus: 'done' as const,
          workingDirectory: '/tmp',
          createdAt: 1000,
          completedAt: 2000,
          durationMs: 1000,
          filesChangedCount: 0,
          toolCallsCount: 0,
          turnsCompleted: 0,
          costUsd: null,
          errorMessage: null,
        },
        {
          id: 'rem-2',
          name: 'A2',
          prompt: 'p2',
          model: 'gpt-4o',
          provider: 'openai',
          resultStatus: 'done' as const,
          workingDirectory: '/tmp',
          createdAt: 1000,
          completedAt: 2000,
          durationMs: 1000,
          filesChangedCount: 0,
          toolCallsCount: 0,
          turnsCompleted: 0,
          costUsd: null,
          errorMessage: null,
        },
      ];
      store['xplorer:agent-session-history'] = JSON.stringify(existing);

      const { result } = renderHook(() => useSessionHistory([]));

      expect(result.current.entries).toHaveLength(2);

      act(() => {
        result.current.removeEntry('rem-1');
      });

      expect(result.current.entries.find((e) => e.id === 'rem-1')).toBeUndefined();
      expect(result.current.entries.find((e) => e.id === 'rem-2')).toBeDefined();
    });
  });

  describe('getEntry', () => {
    it('returns the entry for a valid ID', () => {
      const session = makeSession({ id: 'get-1', status: 'done', name: 'Finder' });
      const { result } = renderHook(() => useSessionHistory([session]));

      const entry = result.current.getEntry('get-1');
      expect(entry).toBeDefined();
      expect(entry!.name).toBe('Finder');
    });

    it('returns undefined for unknown ID', () => {
      const { result } = renderHook(() => useSessionHistory([]));
      expect(result.current.getEntry('nonexistent')).toBeUndefined();
    });
  });

  describe('cost lookup integration', () => {
    it('records costUsd from the cost callback', () => {
      const session = makeSession({ id: 'cost-1', status: 'done' });
      const getCost = vi.fn((id: string) => (id === 'cost-1' ? 1.23 : undefined));

      const { result } = renderHook(() => useSessionHistory([session], getCost));

      const entry = result.current.entries.find((e) => e.id === 'cost-1');
      expect(entry?.costUsd).toBe(1.23);
    });

    it('records null costUsd when callback returns undefined', () => {
      const session = makeSession({ id: 'nocost-1', status: 'done' });
      const getCost = vi.fn(() => undefined);

      const { result } = renderHook(() => useSessionHistory([session], getCost));

      const entry = result.current.entries.find((e) => e.id === 'nocost-1');
      expect(entry?.costUsd).toBeNull();
    });
  });

  describe('sessionToEntry mapping', () => {
    it('computes durationMs from updated_at - created_at', () => {
      const session = makeSession({
        id: 'dur-1',
        status: 'done',
        created_at: 10_000,
        updated_at: 70_000,
      });
      const { result } = renderHook(() => useSessionHistory([session]));

      const entry = result.current.entries.find((e) => e.id === 'dur-1');
      expect(entry?.durationMs).toBe(60_000);
    });
  });
});
