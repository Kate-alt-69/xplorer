/**
 * Hook for progressive text rendering (simulated streaming).
 *
 * Since the Rust backend returns the full AI response at once,
 * this hook reveals the text incrementally, giving the feel of
 * a streaming response instead of a sudden wall of text.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Characters revealed per tick */
const CHARS_PER_TICK = 8;

/** Milliseconds between ticks */
const TICK_INTERVAL_MS = 12;

/**
 * Once remaining chars exceed this threshold we dump the rest instantly
 * so that very long responses don't take forever to finish streaming.
 */
const FAST_FORWARD_THRESHOLD = 2000;

/** Below this length, show instantly (no animation needed) */
const MIN_STREAM_LENGTH = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamingEntry {
  /** Unique key (typically the message index) */
  id: string;
  /** Full final text */
  fullText: string;
}

interface StreamingState {
  /** Currently visible text for each streaming entry */
  visibleTexts: Map<string, string>;
  /** Whether any entry is still animating */
  isStreaming: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages progressive text reveal for one or more messages.
 *
 * Usage:
 *   const { getVisibleText, isStreaming } = useStreamingText(entries);
 *   // In render: getVisibleText(id) returns the text to display
 */
export const useStreamingText = (
  entries: StreamingEntry[],
): StreamingState & {
  getVisibleText: (id: string) => string;
  skipAll: () => void;
} => {
  const [visibleTexts, setVisibleTexts] = useState<Map<string, string>>(new Map());
  const progressRef = useRef<Map<string, number>>(new Map());
  const entriesRef = useRef<StreamingEntry[]>([]);
  const completedRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  // Track which entries have been seen before so we only animate new ones
  const knownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    entriesRef.current = entries;

    // Identify new entries that need streaming
    const newEntries: StreamingEntry[] = [];
    for (const entry of entries) {
      if (!knownIdsRef.current.has(entry.id)) {
        knownIdsRef.current.add(entry.id);
        newEntries.push(entry);

        // Short texts or empty texts: show immediately
        if (entry.fullText.length < MIN_STREAM_LENGTH) {
          progressRef.current.set(entry.id, entry.fullText.length);
          completedRef.current.add(entry.id);
        } else {
          progressRef.current.set(entry.id, 0);
        }
      } else if (completedRef.current.has(entry.id)) {
        // Already completed; ensure progress is at full length
        // (handles cases where fullText changed after completion)
        progressRef.current.set(entry.id, entry.fullText.length);
      }
    }

    // Clean up removed entries
    const currentIds = new Set(entries.map((e) => e.id));
    for (const id of knownIdsRef.current) {
      if (!currentIds.has(id)) {
        knownIdsRef.current.delete(id);
        progressRef.current.delete(id);
        completedRef.current.delete(id);
      }
    }

    // If new streaming entries were added, kick off animation
    if (newEntries.some((e) => !completedRef.current.has(e.id))) {
      startAnimation();
    }

    // Sync visible texts for non-streaming entries immediately
    setVisibleTexts((prev) => {
      const next = new Map(prev);
      for (const entry of entries) {
        const progress = progressRef.current.get(entry.id) ?? entry.fullText.length;
        next.set(entry.id, entry.fullText.slice(0, progress));
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const startAnimation = useCallback(() => {
    if (rafRef.current !== null) return; // Already running

    const tick = (now: number) => {
      if (now - lastTickRef.current < TICK_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastTickRef.current = now;

      let anyActive = false;
      const currentEntries = entriesRef.current;

      for (const entry of currentEntries) {
        if (completedRef.current.has(entry.id)) continue;

        const currentProgress = progressRef.current.get(entry.id) ?? 0;
        if (currentProgress >= entry.fullText.length) {
          completedRef.current.add(entry.id);
          progressRef.current.set(entry.id, entry.fullText.length);
          continue;
        }

        anyActive = true;
        const remaining = entry.fullText.length - currentProgress;

        // Accelerate for long remaining text
        const charsToAdd =
          remaining > FAST_FORWARD_THRESHOLD
            ? Math.min(remaining, CHARS_PER_TICK * 8)
            : CHARS_PER_TICK;

        const newProgress = Math.min(currentProgress + charsToAdd, entry.fullText.length);
        progressRef.current.set(entry.id, newProgress);

        if (newProgress >= entry.fullText.length) {
          completedRef.current.add(entry.id);
        }
      }

      // Batch update visible texts
      setVisibleTexts(() => {
        const next = new Map<string, string>();
        for (const entry of currentEntries) {
          const progress = progressRef.current.get(entry.id) ?? entry.fullText.length;
          next.set(entry.id, entry.fullText.slice(0, progress));
        }
        return next;
      });

      if (anyActive) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const isStreaming = entries.some((e) => !completedRef.current.has(e.id));

  const getVisibleText = useCallback(
    (id: string): string => {
      return visibleTexts.get(id) ?? '';
    },
    [visibleTexts],
  );

  const skipAll = useCallback(() => {
    for (const entry of entriesRef.current) {
      progressRef.current.set(entry.id, entry.fullText.length);
      completedRef.current.add(entry.id);
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setVisibleTexts(() => {
      const next = new Map<string, string>();
      for (const entry of entriesRef.current) {
        next.set(entry.id, entry.fullText);
      }
      return next;
    });
  }, []);

  return { visibleTexts, isStreaming, getVisibleText, skipAll };
};
