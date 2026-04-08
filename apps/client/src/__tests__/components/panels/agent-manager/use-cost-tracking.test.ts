import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// We need to mock storage-keys before the module loads
vi.mock('@/lib/storage-keys', () => ({
  STORAGE_KEYS: {
    AGENT_COST_HISTORY: 'xplorer:agent-cost-history',
  },
}));

import useCostTracking from '@/components/panels/agent-manager/use-cost-tracking';

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
// Tests
// ---------------------------------------------------------------------------

describe('useCostTracking', () => {
  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      const { result } = renderHook(() => useCostTracking());
      // 20 chars -> ceil(20/4) = 5
      expect(result.current.estimateTokens('12345678901234567890')).toBe(5);
    });

    it('returns 0 for empty string', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.estimateTokens('')).toBe(0);
    });

    it('rounds up for non-divisible lengths', () => {
      const { result } = renderHook(() => useCostTracking());
      // 5 chars -> ceil(5/4) = 2
      expect(result.current.estimateTokens('hello')).toBe(2);
    });

    it('handles single character', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.estimateTokens('a')).toBe(1);
    });
  });

  describe('getModelPricing', () => {
    it('returns correct pricing for claude-sonnet-4-20250514', () => {
      const { result } = renderHook(() => useCostTracking());
      const pricing = result.current.getModelPricing('claude-sonnet-4-20250514');
      expect(pricing.inputPerMTok).toBe(3);
      expect(pricing.outputPerMTok).toBe(15);
    });

    it('returns correct pricing for claude-opus-4-6-20250515', () => {
      const { result } = renderHook(() => useCostTracking());
      const pricing = result.current.getModelPricing('claude-opus-4-6-20250515');
      expect(pricing.inputPerMTok).toBe(15);
      expect(pricing.outputPerMTok).toBe(75);
    });

    it('returns correct pricing for gpt-4o', () => {
      const { result } = renderHook(() => useCostTracking());
      const pricing = result.current.getModelPricing('gpt-4o');
      expect(pricing.inputPerMTok).toBe(2.5);
      expect(pricing.outputPerMTok).toBe(10);
    });

    it('returns zero pricing for local models', () => {
      const { result } = renderHook(() => useCostTracking());
      const pricing = result.current.getModelPricing('llama3.3');
      expect(pricing.inputPerMTok).toBe(0);
      expect(pricing.outputPerMTok).toBe(0);
    });

    it('returns default pricing for unknown models', () => {
      const { result } = renderHook(() => useCostTracking());
      const pricing = result.current.getModelPricing('unknown-model-xyz');
      expect(pricing.inputPerMTok).toBe(3);
      expect(pricing.outputPerMTok).toBe(15);
    });
  });

  describe('calculateCost (via recordTokens)', () => {
    it('records cost for a session using model pricing', () => {
      const { result } = renderHook(() => useCostTracking());

      act(() => {
        // 1M input tokens @ $3/MTok + 500K output tokens @ $15/MTok
        result.current.recordTokens(
          's1',
          'Agent 1',
          'claude-sonnet-4-20250514',
          1_000_000,
          500_000,
        );
      });

      const entry = result.current.getSessionCost('s1');
      expect(entry).toBeDefined();
      // cost = (1M/1M)*3 + (500K/1M)*15 = 3 + 7.5 = 10.5
      expect(entry!.costUsd).toBeCloseTo(10.5, 2);
    });

    it('accumulates tokens across multiple recordTokens calls', () => {
      const { result } = renderHook(() => useCostTracking());

      act(() => {
        result.current.recordTokens('s1', 'Agent 1', 'claude-sonnet-4-20250514', 100_000, 50_000);
      });
      act(() => {
        result.current.recordTokens('s1', 'Agent 1', 'claude-sonnet-4-20250514', 100_000, 50_000);
      });

      const entry = result.current.getSessionCost('s1');
      expect(entry!.tokensIn).toBe(200_000);
      expect(entry!.tokensOut).toBe(100_000);
    });

    it('computes zero cost for free local models', () => {
      const { result } = renderHook(() => useCostTracking());

      act(() => {
        result.current.recordTokens('s1', 'Local Agent', 'llama3.3', 1_000_000, 1_000_000);
      });

      const entry = result.current.getSessionCost('s1');
      expect(entry!.costUsd).toBe(0);
    });
  });

  describe('todayTotalCost / todayTotalTokensIn / todayTotalTokensOut', () => {
    it('sums costs across multiple sessions', () => {
      const { result } = renderHook(() => useCostTracking());

      act(() => {
        result.current.recordTokens('s1', 'A1', 'claude-sonnet-4-20250514', 1_000_000, 0);
        result.current.recordTokens('s2', 'A2', 'claude-sonnet-4-20250514', 1_000_000, 0);
      });

      // Each session: (1M/1M)*3 = $3. Total = $6
      expect(result.current.todayTotalCost).toBeCloseTo(6, 2);
      expect(result.current.todayTotalTokensIn).toBe(2_000_000);
    });

    it('starts at zero with no sessions', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.todayTotalCost).toBe(0);
      expect(result.current.todayTotalTokensIn).toBe(0);
      expect(result.current.todayTotalTokensOut).toBe(0);
    });
  });

  describe('formatCost', () => {
    it('formats zero as $0.00', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.formatCost(0)).toBe('$0.00');
    });

    it('formats sub-penny values as <$0.01', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.formatCost(0.005)).toBe('<$0.01');
    });

    it('formats normal values with 2 decimal places', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.formatCost(10.5)).toBe('$10.50');
    });
  });

  describe('formatTokens', () => {
    it('formats zero as "0"', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.formatTokens(0)).toBe('0');
    });

    it('formats small values without suffix', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.formatTokens(500)).toBe('500');
    });

    it('formats thousands with K suffix', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.formatTokens(45_000)).toBe('45.0K');
    });

    it('formats millions with M suffix', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.formatTokens(2_500_000)).toBe('2.50M');
    });
  });

  describe('getSessionCost', () => {
    it('returns undefined for unknown session', () => {
      const { result } = renderHook(() => useCostTracking());
      expect(result.current.getSessionCost('nonexistent')).toBeUndefined();
    });
  });

  describe('persistence', () => {
    it('persists daily record to localStorage on recordTokens', () => {
      const { result } = renderHook(() => useCostTracking());

      act(() => {
        result.current.recordTokens('s1', 'Agent', 'claude-sonnet-4-20250514', 1000, 500);
      });

      const raw = store['xplorer:agent-cost-history'];
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw);
      const keys = Object.keys(parsed);
      expect(keys).toHaveLength(1);
      expect(parsed[keys[0]].sessions).toHaveLength(1);
    });
  });
});
