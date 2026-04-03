import { useState, useEffect, useCallback, useRef } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import type { SortField } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FolderSettings {
  viewMode?: string;
  sortBy?: SortField;
  sortOrder?: 'asc' | 'desc';
  groupByDate?: boolean;
}

interface FolderViewSettingsResult {
  viewMode: string;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  groupByDate: boolean;
  setViewMode: (mode: string) => void;
  setSortBy: (field: SortField) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setGroupByDate: (enabled: boolean) => void;
  toggleSortOrder: () => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_VIEW_MODE = 'medium';
const DEFAULT_SORT_BY: SortField = 'name';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'asc';
const DEFAULT_GROUP_BY_DATE = false;

// ── Persistence helpers ───────────────────────────────────────────────────────

const STORAGE_KEY = STORAGE_KEYS.FOLDER_SETTINGS;
const MAX_ENTRIES = 500;

const loadAllSettings = (): Record<string, FolderSettings> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, FolderSettings>;
      }
    }
  } catch (e) {
    console.warn('Failed to parse folder-settings from localStorage:', e);
  }
  return {};
};

const getSettingsForPath = (path: string): FolderSettings | null => {
  const all = loadAllSettings();
  return all[path] ?? null;
};

const saveSettingsForPath = (path: string, settings: FolderSettings): void => {
  const all = loadAllSettings();
  all[path] = { ...all[path], ...settings };
  // LRU eviction — drop oldest keys when over limit
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) {
    delete all[keys[0]];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};

// ── Auto-detection helpers ────────────────────────────────────────────────────

/** Folders that default to date-grouped, reverse-chronological sort */
const isDateGroupedFolder = (path: string): boolean => {
  const lowerPath = path.toLowerCase().replace(/\\/g, '/');
  return /\/(downloads|desktop|documents)\/?$/i.test(lowerPath);
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Per-folder view and sort settings. Each call site (pane) gets its own state
 * that persists per folder path in localStorage.
 *
 * When navigating to a folder with no saved settings, falls back to
 * auto-detected defaults (date-grouped for Downloads/Desktop/Documents,
 * otherwise medium icons sorted by name ascending).
 *
 * The `globalViewMode` parameter provides a baseline from the smart-view
 * auto-detection system — it's used only when no per-folder sort/group
 * settings exist yet.
 */
export const useFolderViewSettings = (
  currentPath: string,
  globalViewMode: string,
): FolderViewSettingsResult => {
  // Compute initial values for this path
  const computeDefaults = useCallback(
    (
      path: string,
    ): { viewMode: string; sortBy: SortField; sortOrder: 'asc' | 'desc'; groupByDate: boolean } => {
      const saved = getSettingsForPath(path);
      const isDateFolder = isDateGroupedFolder(path);

      return {
        viewMode: saved?.viewMode ?? globalViewMode ?? DEFAULT_VIEW_MODE,
        sortBy: saved?.sortBy ?? (isDateFolder ? 'dateModified' : DEFAULT_SORT_BY),
        sortOrder: saved?.sortOrder ?? (isDateFolder ? 'desc' : DEFAULT_SORT_ORDER),
        groupByDate: saved?.groupByDate ?? (isDateFolder ? true : DEFAULT_GROUP_BY_DATE),
      };
    },
    [globalViewMode],
  );

  const [viewMode, setViewModeState] = useState(() => computeDefaults(currentPath).viewMode);
  const [sortBy, setSortByState] = useState(() => computeDefaults(currentPath).sortBy);
  const [sortOrder, setSortOrderState] = useState(() => computeDefaults(currentPath).sortOrder);
  const [groupByDate, setGroupByDateState] = useState(
    () => computeDefaults(currentPath).groupByDate,
  );

  // Track the path so we can reload settings on navigation
  const prevPathRef = useRef(currentPath);

  // When the path changes, load settings for the new folder
  useEffect(() => {
    if (prevPathRef.current === currentPath) return;
    prevPathRef.current = currentPath;

    const defaults = computeDefaults(currentPath);
    setViewModeState(defaults.viewMode);
    setSortByState(defaults.sortBy);
    setSortOrderState(defaults.sortOrder);
    setGroupByDateState(defaults.groupByDate);
  }, [currentPath, computeDefaults]);

  // Sync viewMode when globalViewMode (from useSmartView) changes for this path
  // Only apply if the user hasn't explicitly saved settings for this folder
  const prevGlobalViewRef = useRef(globalViewMode);
  useEffect(() => {
    if (prevGlobalViewRef.current === globalViewMode) return;
    prevGlobalViewRef.current = globalViewMode;

    const saved = getSettingsForPath(currentPath);
    if (!saved?.viewMode) {
      setViewModeState(globalViewMode);
    }
  }, [globalViewMode, currentPath]);

  // ── Setters that persist to localStorage ────────────────────────────────────

  const setViewMode = useCallback(
    (mode: string) => {
      setViewModeState(mode);
      saveSettingsForPath(currentPath, { viewMode: mode });
    },
    [currentPath],
  );

  const setSortBy = useCallback(
    (field: SortField) => {
      setSortByState(field);
      saveSettingsForPath(currentPath, { sortBy: field });
    },
    [currentPath],
  );

  const setSortOrder = useCallback(
    (order: 'asc' | 'desc') => {
      setSortOrderState(order);
      saveSettingsForPath(currentPath, { sortOrder: order });
    },
    [currentPath],
  );

  const setGroupByDate = useCallback(
    (enabled: boolean) => {
      setGroupByDateState(enabled);
      saveSettingsForPath(currentPath, { groupByDate: enabled });
    },
    [currentPath],
  );

  const toggleSortOrder = useCallback(() => {
    setSortOrderState((prev) => {
      const next = prev === 'asc' ? 'desc' : 'asc';
      saveSettingsForPath(currentPath, { sortOrder: next });
      return next;
    });
  }, [currentPath]);

  return {
    viewMode,
    sortBy,
    sortOrder,
    groupByDate,
    setViewMode,
    setSortBy,
    setSortOrder,
    setGroupByDate,
    toggleSortOrder,
  };
};
