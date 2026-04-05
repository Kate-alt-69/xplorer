/**
 * Proactive agent hook: watches user navigation and file selection,
 * then generates non-intrusive suggestions using local heuristics (no LLM calls).
 *
 * Design principles:
 * - Max 1 suggestion per navigation event
 * - 2-second debounce after navigation before analyzing
 * - 5-minute cooldown per folder (don't re-suggest for the same path)
 * - Auto-dismiss suggestions after 30 seconds
 * - User can disable entirely via localStorage toggle
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { type WorkspaceContext } from './chat-workspace-awareness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProactiveSuggestion {
  id: string;
  headline: string;
  detail?: string;
  actionLabel: string;
  prompt: string;
  /** Timestamp when this suggestion was created */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wait this long after path change before analyzing (ms) */
const DEBOUNCE_MS = 2_000;

/** Don't re-suggest for the same folder within this period (ms) */
const COOLDOWN_MS = 5 * 60 * 1_000;

/** Auto-dismiss suggestion after this period (ms) */
const AUTO_DISMISS_MS = 30_000;

// ---------------------------------------------------------------------------
// Heuristic suggestion generators
// ---------------------------------------------------------------------------

type SuggestionGenerator = (ctx: WorkspaceContext, dirPath: string) => ProactiveSuggestion | null;

const makeSuggestionId = (): string =>
  `suggestion-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** Detect uncommitted git changes */
const detectGitChanges: SuggestionGenerator = (ctx) => {
  if (!ctx.git.isRepo || !ctx.git.uncommittedCount || ctx.git.uncommittedCount === 0) return null;
  const count = ctx.git.uncommittedCount;
  return {
    id: makeSuggestionId(),
    headline: `${count} uncommitted change${count !== 1 ? 's' : ''} detected`,
    detail: ctx.git.branch ? `On branch "${ctx.git.branch}"` : undefined,
    actionLabel: 'Review changes',
    prompt: `I have ${count} uncommitted Git changes. Can you list them and help me review what changed? Suggest a commit message if the changes look ready.`,
    createdAt: Date.now(),
  };
};

/** Detect project type and offer analysis */
const detectProjectAnalysis: SuggestionGenerator = (ctx) => {
  if (!ctx.project) return null;
  const { label, type } = ctx.project;

  switch (type) {
    case 'node':
      return {
        id: makeSuggestionId(),
        headline: `${label} project detected`,
        detail: ctx.project.details || undefined,
        actionLabel: 'Analyze dependencies',
        prompt: `This looks like a ${label} project. Can you analyze the package.json and summarize the dependencies, scripts, and suggest any improvements?`,
        createdAt: Date.now(),
      };
    case 'rust':
      return {
        id: makeSuggestionId(),
        headline: `${label} project detected`,
        detail: ctx.project.details || undefined,
        actionLabel: 'Review Cargo.toml',
        prompt: `This is a ${label} project. Can you review the Cargo.toml, summarize the crate structure, and suggest any improvements?`,
        createdAt: Date.now(),
      };
    case 'python':
      return {
        id: makeSuggestionId(),
        headline: `${label} project detected`,
        detail: ctx.project.details || undefined,
        actionLabel: 'Check dependencies',
        prompt: `This is a ${label} project. Can you analyze the dependencies and suggest any improvements or potential issues?`,
        createdAt: Date.now(),
      };
    default:
      return {
        id: makeSuggestionId(),
        headline: `${label} project detected`,
        detail: ctx.project.details || undefined,
        actionLabel: 'Explain project',
        prompt: `This is a ${label} project. Can you analyze the structure and explain what this project is about?`,
        createdAt: Date.now(),
      };
  }
};

/** Detect large unorganized folders */
const detectLargeFolder: SuggestionGenerator = (ctx) => {
  if (ctx.fileCount < 30) return null;
  // Only suggest if there are many files and few subdirectories (flat structure)
  if (ctx.dirCount > ctx.fileCount * 0.3) return null;

  return {
    id: makeSuggestionId(),
    headline: `${ctx.fileCount} files with minimal organization`,
    detail:
      ctx.topExtensions.length > 0
        ? `Mostly ${ctx.topExtensions
            .slice(0, 3)
            .map((e) => `.${e.ext}`)
            .join(', ')} files`
        : undefined,
    actionLabel: 'Suggest structure',
    prompt: `This folder has ${ctx.fileCount} files and only ${ctx.dirCount} subdirectories. Can you analyze the files and suggest a better organization structure?`,
    createdAt: Date.now(),
  };
};

/** Detect image-heavy folders */
const detectImageFolder: SuggestionGenerator = (ctx) => {
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico']);
  const imageExtEntries = ctx.topExtensions.filter((e) => imageExts.has(e.ext));
  const imageCount = imageExtEntries.reduce((sum, e) => sum + e.count, 0);

  if (imageCount < 10 || imageCount < ctx.fileCount * 0.5) return null;

  return {
    id: makeSuggestionId(),
    headline: `${imageCount} images found`,
    detail: `${imageExtEntries.map((e) => `.${e.ext} (${e.count})`).join(', ')}`,
    actionLabel: 'Organize images',
    prompt: `This folder contains ${imageCount} images. Can you suggest how to organize them — perhaps by naming pattern, date, or type?`,
    createdAt: Date.now(),
  };
};

/** Detect CSV/data-heavy folders */
const detectDataFolder: SuggestionGenerator = (ctx) => {
  const dataExts = new Set(['csv', 'tsv', 'json', 'xlsx', 'xls', 'parquet']);
  const dataExtEntries = ctx.topExtensions.filter((e) => dataExts.has(e.ext));
  const dataCount = dataExtEntries.reduce((sum, e) => sum + e.count, 0);

  if (dataCount < 3) return null;

  return {
    id: makeSuggestionId(),
    headline: `${dataCount} data files found`,
    detail: dataExtEntries.map((e) => `.${e.ext} (${e.count})`).join(', '),
    actionLabel: 'Summarize datasets',
    prompt: `This folder has ${dataCount} data files (${dataExtEntries.map((e) => `.${e.ext}`).join(', ')}). Can you list them and provide a brief summary of each?`,
    createdAt: Date.now(),
  };
};

/** Detect empty directory */
const detectEmptyDirectory: SuggestionGenerator = (ctx, dirPath) => {
  if (ctx.totalItems !== 0) return null;

  return {
    id: makeSuggestionId(),
    headline: 'Empty directory',
    detail: undefined,
    actionLabel: 'Create project',
    prompt: `This directory is empty. Can you help me set up a project here? What kind of project would you like to create in "${dirPath}"?`,
    createdAt: Date.now(),
  };
};

/**
 * Ordered list of suggestion generators.
 * The first one that produces a non-null result wins (max 1 suggestion per event).
 */
const GENERATORS: SuggestionGenerator[] = [
  detectGitChanges,
  detectLargeFolder,
  detectImageFolder,
  detectDataFolder,
  detectEmptyDirectory,
  detectProjectAnalysis,
];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useProactiveAgent = (
  currentPath: string,
  workspaceCtx: WorkspaceContext | null,
  /** Whether the chat already has messages (suppress suggestions if conversation ongoing) */
  hasMessages: boolean,
  /** Whether the agent is currently processing */
  isLoading: boolean,
) => {
  const [suggestion, setSuggestion] = useState<ProactiveSuggestion | null>(null);
  const [enabled, setEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PROACTIVE_AGENT_ENABLED);
    return stored !== 'false'; // default: true
  });

  // Track cooldowns per folder path
  const cooldownMapRef = useRef<Map<string, number>>(new Map());
  // Track the last path we generated a suggestion for
  const lastSuggestedPathRef = useRef<string>('');
  // Auto-dismiss timer
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist enabled state
  const toggleEnabled = useCallback((value: boolean) => {
    setEnabled(value);
    localStorage.setItem(STORAGE_KEYS.PROACTIVE_AGENT_ENABLED, value ? 'true' : 'false');
    if (!value) {
      setSuggestion(null);
    }
  }, []);

  const dismiss = useCallback(() => {
    setSuggestion(null);
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  }, []);

  // Generate suggestion when path changes (debounced)
  useEffect(() => {
    if (!enabled || !currentPath || !workspaceCtx || hasMessages || isLoading) {
      return;
    }

    // Check cooldown for this path
    const lastTime = cooldownMapRef.current.get(currentPath);
    if (lastTime && Date.now() - lastTime < COOLDOWN_MS) {
      return;
    }

    // Don't re-suggest for the same path we just suggested
    if (currentPath === lastSuggestedPathRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      // Run heuristic generators
      let newSuggestion: ProactiveSuggestion | null = null;
      for (const generator of GENERATORS) {
        newSuggestion = generator(workspaceCtx, currentPath);
        if (newSuggestion) break;
      }

      if (newSuggestion) {
        setSuggestion(newSuggestion);
        lastSuggestedPathRef.current = currentPath;
        cooldownMapRef.current.set(currentPath, Date.now());

        // Clean up old cooldown entries (keep map small)
        if (cooldownMapRef.current.size > 50) {
          const now = Date.now();
          for (const [path, time] of cooldownMapRef.current) {
            if (now - time > COOLDOWN_MS) {
              cooldownMapRef.current.delete(path);
            }
          }
        }

        // Auto-dismiss after 30 seconds
        if (autoDismissTimerRef.current) {
          clearTimeout(autoDismissTimerRef.current);
        }
        autoDismissTimerRef.current = setTimeout(() => {
          setSuggestion(null);
          autoDismissTimerRef.current = null;
        }, AUTO_DISMISS_MS);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [currentPath, workspaceCtx, enabled, hasMessages, isLoading]);

  // Clean up auto-dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
      }
    };
  }, []);

  return {
    suggestion,
    enabled,
    toggleEnabled,
    dismiss,
  };
};
