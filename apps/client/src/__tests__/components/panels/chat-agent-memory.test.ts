import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/storage-keys', () => ({
  STORAGE_KEYS: {
    AI_AGENT_MEMORY: 'xplorer:ai-agent-memory',
  },
}));

import {
  loadMemoryStore,
  addFolderObservation,
  addGlobalPreference,
  getFolderMemory,
  recordFolderVisit,
  clearFolderMemory,
  clearAllMemory,
  getGlobalPreferences,
  getMemorySummary,
  normalizePath,
  buildMemoryPrompt,
  parseAndSaveMemories,
} from '@/components/panels/chat-agent-memory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

describe('normalizePath', () => {
  it('normalizes backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\test\\folder')).toBe('C:/Users/test/folder');
  });

  it('removes trailing slashes', () => {
    expect(normalizePath('/home/user/')).toBe('/home/user');
    expect(normalizePath('/home/user///')).toBe('/home/user');
  });

  it('returns / for empty string', () => {
    expect(normalizePath('')).toBe('/');
  });

  it('preserves normal Unix paths', () => {
    expect(normalizePath('/home/user/docs')).toBe('/home/user/docs');
  });
});

// ---------------------------------------------------------------------------
// loadMemoryStore / saveMemoryStore
// ---------------------------------------------------------------------------

describe('loadMemoryStore', () => {
  it('returns default store when nothing is saved', () => {
    const store = loadMemoryStore();
    expect(store.version).toBe(1);
    expect(store.folders).toEqual({});
    expect(store.globalPreferences).toEqual([]);
  });

  it('returns default store when localStorage has corrupt data', () => {
    localStorage.setItem('xplorer:ai-agent-memory', 'not-json');
    const store = loadMemoryStore();
    expect(store.version).toBe(1);
  });

  it('loads a saved store correctly', () => {
    const saved = { version: 1, folders: {}, globalPreferences: [] };
    localStorage.setItem('xplorer:ai-agent-memory', JSON.stringify(saved));
    const store = loadMemoryStore();
    expect(store.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// addFolderObservation + deduplication
// ---------------------------------------------------------------------------

describe('addFolderObservation', () => {
  it('adds an observation to a new folder', () => {
    const obs = addFolderObservation('/home/user', 'This folder has images', ['pattern']);
    expect(obs).not.toBeNull();
    expect(obs!.text).toBe('This folder has images');
    expect(obs!.tags).toContain('pattern');

    const memory = getFolderMemory('/home/user');
    expect(memory).not.toBeNull();
    expect(memory!.observations).toHaveLength(1);
  });

  it('deduplicates exact same text', () => {
    addFolderObservation('/home/user', 'observation one');
    const second = addFolderObservation('/home/user', 'observation one');

    expect(second).toBeNull(); // duplicate
    expect(getFolderMemory('/home/user')!.observations).toHaveLength(1);
  });

  it('deduplicates very similar text (>85% similarity)', () => {
    addFolderObservation('/home/user', 'User prefers organizing by date');
    const similar = addFolderObservation('/home/user', 'User prefers organizing by dates');

    // Very similar text should be deduplicated
    expect(similar).toBeNull();
  });

  it('allows distinct observations', () => {
    addFolderObservation('/home/user', 'Observation about images');
    const second = addFolderObservation('/home/user', 'Observation about documents');

    expect(second).not.toBeNull();
    expect(getFolderMemory('/home/user')!.observations).toHaveLength(2);
  });

  it('trims observations to max limit', () => {
    for (let i = 0; i < 20; i++) {
      addFolderObservation('/home/user', `Unique observation number ${i}`);
    }
    const memory = getFolderMemory('/home/user');
    // MAX_OBSERVATIONS_PER_FOLDER is 15
    expect(memory!.observations.length).toBeLessThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// addGlobalPreference
// ---------------------------------------------------------------------------

describe('addGlobalPreference', () => {
  it('adds a global preference', () => {
    const obs = addGlobalPreference('User always wants dark mode', ['preference']);
    expect(obs).not.toBeNull();
    expect(obs!.text).toBe('User always wants dark mode');

    const prefs = getGlobalPreferences();
    expect(prefs).toHaveLength(1);
  });

  it('deduplicates same preference text', () => {
    addGlobalPreference('User prefers tabs');
    const dup = addGlobalPreference('User prefers tabs');
    expect(dup).toBeNull();
    expect(getGlobalPreferences()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// recordFolderVisit
// ---------------------------------------------------------------------------

describe('recordFolderVisit', () => {
  it('creates a new folder memory on first visit', () => {
    recordFolderVisit('/new/folder');
    const memory = getFolderMemory('/new/folder');
    expect(memory).not.toBeNull();
    expect(memory!.visitCount).toBe(1);
  });

  it('increments visit count on subsequent visits', () => {
    recordFolderVisit('/new/folder');
    recordFolderVisit('/new/folder');
    recordFolderVisit('/new/folder');
    const memory = getFolderMemory('/new/folder');
    expect(memory!.visitCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// clearFolderMemory / clearAllMemory
// ---------------------------------------------------------------------------

describe('clearFolderMemory', () => {
  it('removes memory for a specific folder', () => {
    addFolderObservation('/home/user', 'test obs');
    expect(getFolderMemory('/home/user')).not.toBeNull();

    clearFolderMemory('/home/user');
    expect(getFolderMemory('/home/user')).toBeNull();
  });
});

describe('clearAllMemory', () => {
  it('removes all stored memory', () => {
    addFolderObservation('/home/user', 'test obs');
    addGlobalPreference('global pref');

    clearAllMemory();

    expect(getFolderMemory('/home/user')).toBeNull();
    expect(getGlobalPreferences()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getMemorySummary
// ---------------------------------------------------------------------------

describe('getMemorySummary', () => {
  it('returns empty array when no folders are stored', () => {
    expect(getMemorySummary()).toEqual([]);
  });

  it('returns summary of stored folders', () => {
    recordFolderVisit('/folder1');
    addFolderObservation('/folder1', 'obs1');
    recordFolderVisit('/folder2');

    const summary = getMemorySummary();
    expect(summary).toHaveLength(2);
    expect(summary[0]).toHaveProperty('path');
    expect(summary[0]).toHaveProperty('observationCount');
    expect(summary[0]).toHaveProperty('visitCount');
  });
});

// ---------------------------------------------------------------------------
// buildMemoryPrompt
// ---------------------------------------------------------------------------

describe('buildMemoryPrompt', () => {
  it('returns empty string when no memory exists', () => {
    const prompt = buildMemoryPrompt('/nonexistent');
    expect(prompt).toBe('');
  });

  it('includes folder observations in prompt', () => {
    addFolderObservation('/home/user', 'This folder has many images');
    recordFolderVisit('/home/user');

    const prompt = buildMemoryPrompt('/home/user');
    expect(prompt).toContain('Agent Memory');
    expect(prompt).toContain('many images');
  });

  it('includes global preferences in prompt', () => {
    addGlobalPreference('User prefers dark mode');
    addFolderObservation('/home/user', 'test');

    const prompt = buildMemoryPrompt('/home/user');
    expect(prompt).toContain('User Preferences');
    expect(prompt).toContain('dark mode');
  });
});

// ---------------------------------------------------------------------------
// parseAndSaveMemories
// ---------------------------------------------------------------------------

describe('parseAndSaveMemories', () => {
  it('extracts and saves folder memory tags', () => {
    const text = 'Here is my response.\n[MEMORY:folder] User likes sorting by size';
    const clean = parseAndSaveMemories(text, '/home/user');

    expect(clean).toContain('Here is my response');
    expect(clean).not.toContain('[MEMORY:folder]');

    const memory = getFolderMemory('/home/user');
    expect(memory!.observations.some((o) => o.text.includes('sorting by size'))).toBe(true);
  });

  it('extracts and saves global memory tags', () => {
    const text = 'Response text.\n[MEMORY:global] User always prefers concise answers';
    const clean = parseAndSaveMemories(text, '/home/user');

    expect(clean).not.toContain('[MEMORY:global]');

    const prefs = getGlobalPreferences();
    expect(prefs.some((p) => p.text.includes('concise answers'))).toBe(true);
  });

  it('returns original text if no memory tags', () => {
    const text = 'No memory tags here.';
    const clean = parseAndSaveMemories(text, '/home/user');
    expect(clean).toBe(text);
  });
});
