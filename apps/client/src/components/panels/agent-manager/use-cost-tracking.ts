/**
 * Hook for tracking API cost and token usage per agent session.
 *
 * Estimates tokens from message character length (~4 chars/token),
 * calculates cost based on model pricing, and persists daily totals
 * in localStorage for history.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** Cost per million input tokens (USD) */
  inputPerMTok: number;
  /** Cost per million output tokens (USD) */
  outputPerMTok: number;
}

export interface SessionCostEntry {
  sessionId: string;
  sessionName: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  updatedAt: number;
}

export interface DailyCostRecord {
  date: string; // ISO date string YYYY-MM-DD
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  sessions: SessionCostEntry[];
}

export interface UseCostTrackingResult {
  /** Cost entries keyed by session ID */
  sessionCosts: Map<string, SessionCostEntry>;
  /** Today's cumulative cost across all sessions */
  todayTotalCost: number;
  /** Today's cumulative tokens in across all sessions */
  todayTotalTokensIn: number;
  /** Today's cumulative tokens out across all sessions */
  todayTotalTokensOut: number;
  /** Record tokens for a specific session */
  recordTokens: (
    sessionId: string,
    sessionName: string,
    model: string,
    tokensIn: number,
    tokensOut: number,
  ) => void;
  /** Estimate tokens from message text (~4 chars/token) */
  estimateTokens: (text: string) => number;
  /** Get cost for a specific session */
  getSessionCost: (sessionId: string) => SessionCostEntry | undefined;
  /** Format cost as display string */
  formatCost: (costUsd: number) => string;
  /** Format token count as display string (e.g. "45K") */
  formatTokens: (count: number) => string;
  /** Get pricing info for a model */
  getModelPricing: (model: string) => ModelPricing;
}

// ---------------------------------------------------------------------------
// Model pricing table (USD per million tokens)
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-20250514': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-6-20250515': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 0.8, outputPerMTok: 4 },
  // OpenAI
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  o3: { inputPerMTok: 10, outputPerMTok: 40 },
  'o4-mini': { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  // Local (free)
  'llama3.3': { inputPerMTok: 0, outputPerMTok: 0 },
  qwen3: { inputPerMTok: 0, outputPerMTok: 0 },
  'deepseek-r1': { inputPerMTok: 0, outputPerMTok: 0 },
};

/** Fallback pricing for unknown models */
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getTodayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const loadDailyRecord = (dateKey: string): DailyCostRecord | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_COST_HISTORY);
    if (!raw) return null;
    const history = JSON.parse(raw) as Record<string, DailyCostRecord>;
    return history[dateKey] ?? null;
  } catch {
    return null;
  }
};

const saveDailyRecord = (dateKey: string, record: DailyCostRecord): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_COST_HISTORY);
    const history: Record<string, DailyCostRecord> = raw
      ? (JSON.parse(raw) as Record<string, DailyCostRecord>)
      : {};
    history[dateKey] = record;

    // Keep only the last 30 days to avoid unbounded storage growth
    const sortedKeys = Object.keys(history).sort();
    if (sortedKeys.length > 30) {
      const keysToRemove = sortedKeys.slice(0, sortedKeys.length - 30);
      for (const key of keysToRemove) {
        delete history[key];
      }
    }

    localStorage.setItem(STORAGE_KEYS.AGENT_COST_HISTORY, JSON.stringify(history));
  } catch {
    // Storage unavailable
  }
};

const calculateCost = (model: string, tokensIn: number, tokensOut: number): number => {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (
    (tokensIn / 1_000_000) * pricing.inputPerMTok + (tokensOut / 1_000_000) * pricing.outputPerMTok
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const useCostTracking = (): UseCostTrackingResult => {
  const [sessionCosts, setSessionCosts] = useState<Map<string, SessionCostEntry>>(new Map());
  const sessionCostsRef = useRef(sessionCosts);
  sessionCostsRef.current = sessionCosts;

  // Load today's records on mount
  useEffect(() => {
    const todayKey = getTodayKey();
    const record = loadDailyRecord(todayKey);
    if (record?.sessions?.length) {
      const map = new Map<string, SessionCostEntry>();
      for (const entry of record.sessions) {
        map.set(entry.sessionId, entry);
      }
      setSessionCosts(map);
    }
  }, []);

  const estimateTokens = useCallback((text: string): number => {
    // Rough heuristic: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }, []);

  const getModelPricing = useCallback((model: string): ModelPricing => {
    return MODEL_PRICING[model] ?? DEFAULT_PRICING;
  }, []);

  const recordTokens = useCallback(
    (
      sessionId: string,
      sessionName: string,
      model: string,
      tokensIn: number,
      tokensOut: number,
    ) => {
      setSessionCosts((prev) => {
        const next = new Map(prev);
        const existing = next.get(sessionId);
        const newTokensIn = (existing?.tokensIn ?? 0) + tokensIn;
        const newTokensOut = (existing?.tokensOut ?? 0) + tokensOut;

        const entry: SessionCostEntry = {
          sessionId,
          sessionName,
          model,
          tokensIn: newTokensIn,
          tokensOut: newTokensOut,
          costUsd: calculateCost(model, newTokensIn, newTokensOut),
          updatedAt: Date.now(),
        };

        next.set(sessionId, entry);

        // Persist to daily record
        const todayKey = getTodayKey();
        const sessions = Array.from(next.values());
        const totalCostUsd = sessions.reduce((sum, s) => sum + s.costUsd, 0);
        const totalTokensIn = sessions.reduce((sum, s) => sum + s.tokensIn, 0);
        const totalTokensOut = sessions.reduce((sum, s) => sum + s.tokensOut, 0);

        saveDailyRecord(todayKey, {
          date: todayKey,
          totalCostUsd,
          totalTokensIn,
          totalTokensOut,
          sessions,
        });

        return next;
      });
    },
    [],
  );

  const getSessionCost = useCallback((sessionId: string): SessionCostEntry | undefined => {
    return sessionCostsRef.current.get(sessionId);
  }, []);

  const formatCost = useCallback((costUsd: number): string => {
    if (costUsd === 0) return '$0.00';
    if (costUsd < 0.01) return '<$0.01';
    return `$${costUsd.toFixed(2)}`;
  }, []);

  const formatTokens = useCallback((count: number): string => {
    if (count === 0) return '0';
    if (count < 1000) return String(count);
    if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
    return `${(count / 1_000_000).toFixed(2)}M`;
  }, []);

  // Compute today's totals
  const entries = Array.from(sessionCosts.values());
  const todayTotalCost = entries.reduce((sum, e) => sum + e.costUsd, 0);
  const todayTotalTokensIn = entries.reduce((sum, e) => sum + e.tokensIn, 0);
  const todayTotalTokensOut = entries.reduce((sum, e) => sum + e.tokensOut, 0);

  return {
    sessionCosts,
    todayTotalCost,
    todayTotalTokensIn,
    todayTotalTokensOut,
    recordTokens,
    estimateTokens,
    getSessionCost,
    formatCost,
    formatTokens,
    getModelPricing,
  };
};

export default useCostTracking;
