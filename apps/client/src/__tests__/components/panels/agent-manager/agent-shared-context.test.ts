import { describe, it, expect, beforeEach, vi } from 'vitest';

// The global setup.ts mocks @/lib/utils. We don't import it here,
// but we still need to unmock nothing — we just avoid triggering it.

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

// We need a fresh module for each test so the in-memory store resets
const loadModule = async () => {
  // Clear the module cache so each test gets a fresh discoveryStore
  vi.resetModules();
  return await import('@/components/panels/agent-manager/agent-shared-context');
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-shared-context', () => {
  describe('addDiscovery', () => {
    it('adds a discovery and returns it with all required fields', async () => {
      const mod = await loadModule();
      const result = mod.addDiscovery(
        'bug_found',
        'Null pointer in utils.ts',
        'session-1',
        'Bug Fixer',
      );

      expect(result).toMatchObject({
        type: 'bug_found',
        content: 'Null pointer in utils.ts',
        sourceSessionId: 'session-1',
        sourceSessionName: 'Bug Fixer',
      });
      expect(result.id).toMatch(/^disc_/);
      expect(typeof result.timestamp).toBe('number');
    });

    it('persists discovery to localStorage', async () => {
      const mod = await loadModule();
      mod.addDiscovery('config_read', 'tsconfig has strict mode', 's1', 'Reader');

      expect(store['xplorer:agent-shared-discoveries']).toBeDefined();
      const parsed = JSON.parse(store['xplorer:agent-shared-discoveries']);
      expect(parsed).toHaveLength(1);
      expect(parsed[0][1].content).toBe('tsconfig has strict mode');
    });

    it('dispatches custom events on add', async () => {
      const mod = await loadModule();
      const handler = vi.fn();
      window.addEventListener('xplorer-discoveries-changed', handler);

      mod.addDiscovery('test_result', 'All tests pass', 's1', 'Tester');

      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener('xplorer-discoveries-changed', handler);
    });

    it('dispatches a broadcast event with the discovery in detail', async () => {
      const mod = await loadModule();
      const handler = vi.fn();
      window.addEventListener('xplorer-discovery-broadcast', handler);

      mod.addDiscovery('dependency_found', 'react 18 detected', 's2', 'Scanner');

      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0] as CustomEvent;
      expect(event.detail.discovery.content).toBe('react 18 detected');

      window.removeEventListener('xplorer-discovery-broadcast', handler);
    });
  });

  describe('removeDiscovery', () => {
    it('removes a discovery by ID', async () => {
      const mod = await loadModule();
      const d = mod.addDiscovery('bug_found', 'bug1', 's1', 'Agent');
      expect(mod.getDiscoveryCount()).toBe(1);

      mod.removeDiscovery(d.id);
      expect(mod.getDiscoveryCount()).toBe(0);
    });

    it('is a no-op for non-existent ID', async () => {
      const mod = await loadModule();
      mod.addDiscovery('bug_found', 'bug1', 's1', 'Agent');
      mod.removeDiscovery('non-existent');
      expect(mod.getDiscoveryCount()).toBe(1);
    });
  });

  describe('clearAllDiscoveries', () => {
    it('removes all discoveries', async () => {
      const mod = await loadModule();
      mod.addDiscovery('bug_found', 'bug1', 's1', 'Agent');
      mod.addDiscovery('config_read', 'cfg1', 's2', 'Agent2');
      expect(mod.getDiscoveryCount()).toBe(2);

      mod.clearAllDiscoveries();
      expect(mod.getDiscoveryCount()).toBe(0);
      expect(mod.getAllDiscoveries()).toEqual([]);
    });

    it('persists cleared state to localStorage', async () => {
      const mod = await loadModule();
      mod.addDiscovery('bug_found', 'bug1', 's1', 'Agent');
      mod.clearAllDiscoveries();

      const stored = JSON.parse(store['xplorer:agent-shared-discoveries']);
      expect(stored).toEqual([]);
    });
  });

  describe('getAllDiscoveries', () => {
    it('returns discoveries sorted newest-first', async () => {
      const mod = await loadModule();
      // Add with slight timestamp offset via sequential calls
      mod.addDiscovery('bug_found', 'first', 's1', 'A');
      mod.addDiscovery('config_read', 'second', 's2', 'B');
      mod.addDiscovery('test_result', 'third', 's3', 'C');

      const all = mod.getAllDiscoveries();
      expect(all).toHaveLength(3);
      // Newest should be first (highest timestamp)
      for (let i = 0; i < all.length - 1; i++) {
        expect(all[i].timestamp).toBeGreaterThanOrEqual(all[i + 1].timestamp);
      }
    });
  });

  describe('getDiscoveriesByType', () => {
    it('filters by the given type', async () => {
      const mod = await loadModule();
      mod.addDiscovery('bug_found', 'bug', 's1', 'A');
      mod.addDiscovery('config_read', 'cfg', 's2', 'B');
      mod.addDiscovery('bug_found', 'bug2', 's3', 'C');

      const bugs = mod.getDiscoveriesByType('bug_found');
      expect(bugs).toHaveLength(2);
      expect(bugs.every((d) => d.type === 'bug_found')).toBe(true);
    });
  });

  describe('getDiscoveriesBySession', () => {
    it('filters by session ID', async () => {
      const mod = await loadModule();
      mod.addDiscovery('bug_found', 'b1', 'session-A', 'Agent A');
      mod.addDiscovery('config_read', 'c1', 'session-B', 'Agent B');
      mod.addDiscovery('test_result', 't1', 'session-A', 'Agent A');

      const sessionA = mod.getDiscoveriesBySession('session-A');
      expect(sessionA).toHaveLength(2);
      expect(sessionA.every((d) => d.sourceSessionId === 'session-A')).toBe(true);
    });
  });

  describe('buildDiscoveryContext', () => {
    it('returns empty string when no discoveries', async () => {
      const mod = await loadModule();
      expect(mod.buildDiscoveryContext()).toBe('');
    });

    it('includes header and footer markers', async () => {
      const mod = await loadModule();
      mod.addDiscovery('bug_found', 'something', 's1', 'Agent');

      const ctx = mod.buildDiscoveryContext();
      expect(ctx).toContain('--- Shared discoveries from other agents ---');
      expect(ctx).toContain('--- End shared discoveries ---');
    });

    it('respects maxItems parameter', async () => {
      const mod = await loadModule();
      for (let i = 0; i < 5; i++) {
        mod.addDiscovery('bug_found', `bug-${i}`, 's1', 'Agent');
      }

      const ctx = mod.buildDiscoveryContext(2);
      // Count discovery lines (lines starting with "- [")
      const lines = ctx.split('\n').filter((l) => l.startsWith('- ['));
      expect(lines).toHaveLength(2);
    });

    it('includes type label and source name in output', async () => {
      const mod = await loadModule();
      mod.addDiscovery('pattern_identified', 'singleton pattern', 's1', 'Analyzer');

      const ctx = mod.buildDiscoveryContext();
      expect(ctx).toContain('pattern identified');
      expect(ctx).toContain('Analyzer');
      expect(ctx).toContain('singleton pattern');
    });
  });

  describe('dedup — IDs are unique', () => {
    it('generates unique IDs for rapid sequential calls', async () => {
      const mod = await loadModule();
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const d = mod.addDiscovery('test_result', `test ${i}`, 's1', 'Agent');
        ids.add(d.id);
      }
      expect(ids.size).toBe(20);
    });
  });

  describe('subscribeToDiscoveries', () => {
    it('returns an unsubscribe function that stops notifications', async () => {
      const mod = await loadModule();
      const handler = vi.fn();
      const unsub = mod.subscribeToDiscoveries(handler);

      mod.addDiscovery('bug_found', 'b1', 's1', 'Agent');
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      mod.addDiscovery('bug_found', 'b2', 's1', 'Agent');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('DISCOVERY_TYPE_LABELS', () => {
    it('covers all five discovery types', async () => {
      const mod = await loadModule();
      const types: Array<
        import('@/components/panels/agent-manager/agent-shared-context').DiscoveryType
      > = ['bug_found', 'pattern_identified', 'config_read', 'dependency_found', 'test_result'];
      for (const t of types) {
        expect(mod.DISCOVERY_TYPE_LABELS[t]).toBeDefined();
      }
    });
  });

  describe('DISCOVERY_TYPE_COLORS', () => {
    it('has a color entry for every discovery type', async () => {
      const mod = await loadModule();
      const types: Array<
        import('@/components/panels/agent-manager/agent-shared-context').DiscoveryType
      > = ['bug_found', 'pattern_identified', 'config_read', 'dependency_found', 'test_result'];
      for (const t of types) {
        expect(mod.DISCOVERY_TYPE_COLORS[t]).toBeDefined();
        expect(typeof mod.DISCOVERY_TYPE_COLORS[t]).toBe('string');
      }
    });
  });

  describe('formatDiscoveriesDisplay', () => {
    it('returns a message when empty', async () => {
      const mod = await loadModule();
      const display = mod.formatDiscoveriesDisplay();
      expect(display).toContain('No discoveries yet');
    });

    it('groups discoveries by type', async () => {
      const mod = await loadModule();
      mod.addDiscovery('bug_found', 'bug-a', 's1', 'A');
      mod.addDiscovery('bug_found', 'bug-b', 's2', 'B');
      mod.addDiscovery('config_read', 'config-a', 's3', 'C');

      const display = mod.formatDiscoveriesDisplay();
      expect(display).toContain('Bug Found');
      expect(display).toContain('Config Read');
      expect(display).toContain('3 total');
    });
  });
});
