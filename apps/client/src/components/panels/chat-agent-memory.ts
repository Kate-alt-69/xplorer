/**
 * Agent memory system: persists observations and preferences per-folder
 * across chat sessions. The agent remembers what it learned about directories,
 * user preferences, and past interactions.
 *
 * Storage: localStorage keyed by folder path (normalized).
 * Each entry has a TTL and max observation count to keep storage bounded.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryObservation {
  /** Unique id for deduplication */
  id: string;
  /** Human-readable observation text */
  text: string;
  /** Timestamp when this was recorded */
  createdAt: number;
  /** Tags for categorizing observations (e.g. 'organization', 'preference', 'pattern') */
  tags: string[];
}

export interface FolderMemory {
  /** Normalized folder path */
  path: string;
  /** Observations the agent has made about this folder */
  observations: MemoryObservation[];
  /** Last time this memory was accessed */
  lastAccessed: number;
  /** Number of times the user has visited this folder during agent sessions */
  visitCount: number;
}

export interface AgentMemoryStore {
  /** Version for future migration */
  version: number;
  /** Memories keyed by normalized folder path */
  folders: Record<string, FolderMemory>;
  /** Global user preferences the agent has learned */
  globalPreferences: MemoryObservation[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max observations per folder */
const MAX_OBSERVATIONS_PER_FOLDER = 15;

/** Max folders to remember */
const MAX_REMEMBERED_FOLDERS = 50;

/** Max global preference observations */
const MAX_GLOBAL_PREFS = 20;

/** Memory entries older than this are eligible for eviction (30 days) */
const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** localStorage key */
const MEMORY_STORAGE_KEY = STORAGE_KEYS.AI_AGENT_MEMORY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateObservationId = (): string =>
  `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Normalize a folder path for consistent keying */
export const normalizePath = (folderPath: string): string =>
  folderPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

export const loadMemoryStore = (): AgentMemoryStore => {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return { version: 1, folders: {}, globalPreferences: [] };
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'version' in parsed) {
      return parsed as AgentMemoryStore;
    }
  } catch {
    // Corrupted storage, start fresh
  }
  return { version: 1, folders: {}, globalPreferences: [] };
};

export const saveMemoryStore = (store: AgentMemoryStore): void => {
  try {
    // Evict old entries before saving
    const cleaned = evictOldEntries(store);
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // localStorage full or unavailable
  }
};

/** Remove stale entries to keep storage bounded */
const evictOldEntries = (store: AgentMemoryStore): AgentMemoryStore => {
  const now = Date.now();
  const folders = { ...store.folders };

  // Remove expired observations within folders
  for (const [key, folder] of Object.entries(folders)) {
    const liveObs = folder.observations.filter((obs) => now - obs.createdAt < MEMORY_TTL_MS);
    if (liveObs.length === 0 && now - folder.lastAccessed > MEMORY_TTL_MS) {
      delete folders[key];
    } else {
      folders[key] = { ...folder, observations: liveObs };
    }
  }

  // If still over the folder limit, evict least-recently-accessed
  const folderKeys = Object.keys(folders);
  if (folderKeys.length > MAX_REMEMBERED_FOLDERS) {
    const sorted = folderKeys.sort((a, b) => folders[a].lastAccessed - folders[b].lastAccessed);
    const toRemove = sorted.slice(0, folderKeys.length - MAX_REMEMBERED_FOLDERS);
    for (const key of toRemove) {
      delete folders[key];
    }
  }

  // Trim global prefs
  const globalPreferences = store.globalPreferences
    .filter((obs) => now - obs.createdAt < MEMORY_TTL_MS)
    .slice(0, MAX_GLOBAL_PREFS);

  return { ...store, folders, globalPreferences };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get memory for a specific folder. Returns null if no memory exists. */
export const getFolderMemory = (folderPath: string): FolderMemory | null => {
  const store = loadMemoryStore();
  const key = normalizePath(folderPath);
  return store.folders[key] ?? null;
};

/** Record a visit to a folder (increments visit count, updates lastAccessed). */
export const recordFolderVisit = (folderPath: string): void => {
  const store = loadMemoryStore();
  const key = normalizePath(folderPath);
  const existing = store.folders[key];

  if (existing) {
    store.folders[key] = {
      ...existing,
      lastAccessed: Date.now(),
      visitCount: existing.visitCount + 1,
    };
  } else {
    store.folders[key] = {
      path: key,
      observations: [],
      lastAccessed: Date.now(),
      visitCount: 1,
    };
  }

  saveMemoryStore(store);
};

/** Add an observation to a folder's memory. Deduplicates by text similarity. */
export const addFolderObservation = (
  folderPath: string,
  text: string,
  tags: string[] = [],
): MemoryObservation | null => {
  const store = loadMemoryStore();
  const key = normalizePath(folderPath);

  if (!store.folders[key]) {
    store.folders[key] = {
      path: key,
      observations: [],
      lastAccessed: Date.now(),
      visitCount: 0,
    };
  }

  const folder = store.folders[key];

  // Deduplicate: skip if a very similar observation already exists
  const lowerText = text.toLowerCase().trim();
  const isDuplicate = folder.observations.some((obs) => {
    const existingLower = obs.text.toLowerCase().trim();
    return existingLower === lowerText || levenshteinSimilarity(existingLower, lowerText) > 0.85;
  });

  if (isDuplicate) return null;

  const observation: MemoryObservation = {
    id: generateObservationId(),
    text: text.trim(),
    createdAt: Date.now(),
    tags,
  };

  // Prepend new observation, trim to max
  folder.observations = [observation, ...folder.observations].slice(0, MAX_OBSERVATIONS_PER_FOLDER);
  folder.lastAccessed = Date.now();

  saveMemoryStore(store);
  return observation;
};

/** Add a global preference observation. */
export const addGlobalPreference = (
  text: string,
  tags: string[] = [],
): MemoryObservation | null => {
  const store = loadMemoryStore();

  const lowerText = text.toLowerCase().trim();
  const isDuplicate = store.globalPreferences.some(
    (obs) => levenshteinSimilarity(obs.text.toLowerCase().trim(), lowerText) > 0.85,
  );
  if (isDuplicate) return null;

  const observation: MemoryObservation = {
    id: generateObservationId(),
    text: text.trim(),
    createdAt: Date.now(),
    tags,
  };

  store.globalPreferences = [observation, ...store.globalPreferences].slice(0, MAX_GLOBAL_PREFS);
  saveMemoryStore(store);
  return observation;
};

/** Get all global preferences. */
export const getGlobalPreferences = (): MemoryObservation[] => {
  const store = loadMemoryStore();
  return store.globalPreferences;
};

/** Clear all memory for a specific folder. */
export const clearFolderMemory = (folderPath: string): void => {
  const store = loadMemoryStore();
  const key = normalizePath(folderPath);
  delete store.folders[key];
  saveMemoryStore(store);
};

/** Clear all agent memory. */
export const clearAllMemory = (): void => {
  localStorage.removeItem(MEMORY_STORAGE_KEY);
};

/** Get a summary of all remembered folders (for UI display). */
export const getMemorySummary = (): Array<{
  path: string;
  observationCount: number;
  visitCount: number;
  lastAccessed: number;
}> => {
  const store = loadMemoryStore();
  return Object.values(store.folders)
    .map((f) => ({
      path: f.path,
      observationCount: f.observations.length,
      visitCount: f.visitCount,
      lastAccessed: f.lastAccessed,
    }))
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
};

// ---------------------------------------------------------------------------
// System prompt builder for agent memory context
// ---------------------------------------------------------------------------

/**
 * Build a memory context section for the system prompt.
 * Includes relevant folder memories and global preferences.
 */
export const buildMemoryPrompt = (folderPath: string): string => {
  const lines: string[] = [];
  const key = normalizePath(folderPath);
  const store = loadMemoryStore();
  const folderMem = store.folders[key];

  if (folderMem && folderMem.observations.length > 0) {
    lines.push('## Agent Memory (this folder)');
    lines.push(
      `You have visited this folder ${folderMem.visitCount} time${folderMem.visitCount !== 1 ? 's' : ''} before. Here is what you remember:`,
    );
    for (const obs of folderMem.observations) {
      const age = formatAge(obs.createdAt);
      const tagStr = obs.tags.length > 0 ? ` [${obs.tags.join(', ')}]` : '';
      lines.push(`- ${obs.text} (${age} ago${tagStr})`);
    }
    lines.push('');
    lines.push(
      'Use these memories to provide more personalized, context-aware responses. Reference past observations when relevant (e.g., "Last time you were here, you organized files by type. Want me to do the same?").',
    );
  }

  if (store.globalPreferences.length > 0) {
    lines.push('');
    lines.push('## User Preferences (global)');
    lines.push('Things you have learned about this user across all sessions:');
    for (const pref of store.globalPreferences) {
      lines.push(`- ${pref.text}`);
    }
  }

  if (lines.length > 0) {
    lines.unshift('');
    lines.push('');
    lines.push(
      'IMPORTANT: When you learn something new about the user or this folder during conversation, include a [MEMORY] tag at the end of your response to save it. Format: `[MEMORY:folder] observation text` or `[MEMORY:global] preference text`. Only add memories for genuinely useful observations, not trivial facts.',
    );
    lines.push('');
    lines.push(
      'CORRECTIONS: Preferences tagged [correction] were learned when the user corrected you. Always respect these. If a preference contradicts your default behavior, follow the preference. When you see correction-tagged memories, acknowledge you remember their preference (e.g., "I remember you prefer organizing by date, so I\'ll do that").',
    );
  }

  return lines.join('\n');
};

/**
 * Parse memory tags from an AI response and save them.
 * Returns the response text with memory tags removed.
 */
export const parseAndSaveMemories = (responseText: string, currentPath: string): string => {
  const folderPattern = /\[MEMORY:folder\]\s*(.+?)(?:\n|$)/g;
  const globalPattern = /\[MEMORY:global\]\s*(.+?)(?:\n|$)/g;

  let cleanText = responseText;
  let match: RegExpExecArray | null;

  // Extract and save folder memories
  match = folderPattern.exec(responseText);
  while (match !== null) {
    const observation = match[1].trim();
    if (observation && currentPath) {
      addFolderObservation(currentPath, observation, ['auto']);
    }
    cleanText = cleanText.replace(match[0], '');
    match = folderPattern.exec(responseText);
  }

  // Extract and save global preferences
  match = globalPattern.exec(responseText);
  while (match !== null) {
    const preference = match[1].trim();
    if (preference) {
      addGlobalPreference(preference, ['auto']);
    }
    cleanText = cleanText.replace(match[0], '');
    match = globalPattern.exec(responseText);
  }

  return cleanText.trim();
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Simple Levenshtein-based similarity (0-1). Good enough for dedup. */
const levenshteinSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  // For performance, skip expensive computation on very different lengths
  if (Math.abs(a.length - b.length) > maxLen * 0.3) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
  }

  const distance = matrix[a.length][b.length];
  return 1 - distance / maxLen;
};

/** Format a timestamp age as a human-readable string */
const formatAge = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
};
