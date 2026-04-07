/**
 * Shared discovery context for inter-agent knowledge sharing.
 *
 * When one agent discovers something (finds a bug, identifies a pattern,
 * reads a config), it broadcasts to other running agents via a global store.
 * New agent sessions can be injected with relevant discoveries.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscoveryType =
  | 'bug_found'
  | 'pattern_identified'
  | 'config_read'
  | 'dependency_found'
  | 'test_result';

export interface Discovery {
  /** Unique discovery identifier */
  id: string;
  /** Category of discovery */
  type: DiscoveryType;
  /** Human-readable description of the discovery */
  content: string;
  /** Session ID of the agent that made this discovery */
  sourceSessionId: string;
  /** Display name of the source agent/session */
  sourceSessionName: string;
  /** When the discovery was made */
  timestamp: number;
}

/** Labels for each discovery type */
export const DISCOVERY_TYPE_LABELS: Record<DiscoveryType, string> = {
  bug_found: 'agentManager.discoveries.types.bugFound',
  pattern_identified: 'agentManager.discoveries.types.patternIdentified',
  config_read: 'agentManager.discoveries.types.configRead',
  dependency_found: 'agentManager.discoveries.types.dependencyFound',
  test_result: 'agentManager.discoveries.types.testResult',
};

/** Colors for each discovery type (used in UI badges) */
export const DISCOVERY_TYPE_COLORS: Record<DiscoveryType, string> = {
  bug_found: 'var(--xp-red, #f7768e)',
  pattern_identified: 'var(--xp-blue, #7aa2f7)',
  config_read: 'var(--xp-purple, #bb9af7)',
  dependency_found: 'var(--xp-cyan, #7dcfff)',
  test_result: 'var(--xp-green, #73daca)',
};

/** Icons for each discovery type (emoji-style for status display) */
export const DISCOVERY_TYPE_ICONS: Record<DiscoveryType, string> = {
  bug_found: 'Bug',
  pattern_identified: 'Eye',
  config_read: 'Settings',
  dependency_found: 'Link',
  test_result: 'FlaskConical',
};

// ---------------------------------------------------------------------------
// In-memory store + localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'xplorer:agent-shared-discoveries';

/** Event name dispatched when discoveries change */
const DISCOVERY_CHANGE_EVENT = 'xplorer-discoveries-changed';

let discoveryStore: Map<string, Discovery> = new Map();

/** Load discoveries from localStorage */
const loadDiscoveries = (): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Array<[string, Discovery]>;
    discoveryStore = new Map(entries);
  } catch {
    // Corrupted data — start fresh
    discoveryStore = new Map();
  }
};

/** Persist discoveries to localStorage */
const saveDiscoveries = (): void => {
  try {
    const entries = Array.from(discoveryStore.entries());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable
  }
};

/** Notify listeners that the discovery store changed */
const notifyChange = (): void => {
  window.dispatchEvent(new CustomEvent(DISCOVERY_CHANGE_EVENT));
};

// Initialize on first import
loadDiscoveries();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let idCounter = 0;
const generateId = (): string => {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `disc_${Date.now()}_${idCounter}`;
};

/**
 * Add a new discovery to the shared context.
 * Broadcasts to all listeners and persists to localStorage.
 */
export const addDiscovery = (
  type: DiscoveryType,
  content: string,
  sourceSessionId: string,
  sourceSessionName: string,
): Discovery => {
  const discovery: Discovery = {
    id: generateId(),
    type,
    content,
    sourceSessionId,
    sourceSessionName,
    timestamp: Date.now(),
  };
  discoveryStore.set(discovery.id, discovery);
  saveDiscoveries();
  notifyChange();

  // Also dispatch a typed event so agent sessions can react
  window.dispatchEvent(
    new CustomEvent('xplorer-discovery-broadcast', {
      detail: { discovery },
    }),
  );

  return discovery;
};

/**
 * Remove a discovery by ID.
 */
export const removeDiscovery = (id: string): void => {
  discoveryStore.delete(id);
  saveDiscoveries();
  notifyChange();
};

/**
 * Clear all discoveries.
 */
export const clearAllDiscoveries = (): void => {
  discoveryStore.clear();
  saveDiscoveries();
  notifyChange();
};

/**
 * Get all discoveries as an array, sorted newest-first.
 */
export const getAllDiscoveries = (): Discovery[] =>
  Array.from(discoveryStore.values()).sort((a, b) => b.timestamp - a.timestamp);

/**
 * Get discoveries filtered by type.
 */
export const getDiscoveriesByType = (type: DiscoveryType): Discovery[] =>
  getAllDiscoveries().filter((d) => d.type === type);

/**
 * Get discoveries from a specific session.
 */
export const getDiscoveriesBySession = (sessionId: string): Discovery[] =>
  getAllDiscoveries().filter((d) => d.sourceSessionId === sessionId);

/**
 * Get the total count of discoveries.
 */
export const getDiscoveryCount = (): number => discoveryStore.size;

/**
 * Build a system prompt injection with relevant discoveries for a new agent session.
 * Only includes the most recent discoveries to avoid prompt bloat.
 */
export const buildDiscoveryContext = (maxItems: number = 10): string => {
  const discoveries = getAllDiscoveries().slice(0, maxItems);
  if (discoveries.length === 0) return '';

  const lines = discoveries.map((d) => {
    const typeLabel = d.type.replace(/_/g, ' ');
    const time = new Date(d.timestamp).toLocaleTimeString();
    return `- [${typeLabel}] (from "${d.sourceSessionName}" at ${time}): ${d.content}`;
  });

  return [
    '\n--- Shared discoveries from other agents ---',
    ...lines,
    '--- End shared discoveries ---\n',
  ].join('\n');
};

/**
 * Format all discoveries for the /discoveries slash command display.
 */
export const formatDiscoveriesDisplay = (): string => {
  const discoveries = getAllDiscoveries();
  if (discoveries.length === 0) {
    return '**Shared Discoveries**\n\nNo discoveries yet. Agents will share findings here as they work.';
  }

  const typeGroups: Record<string, Discovery[]> = {};
  for (const d of discoveries) {
    const key = d.type;
    if (!typeGroups[key]) typeGroups[key] = [];
    typeGroups[key].push(d);
  }

  let text = `**Shared Discoveries** (${discoveries.length} total)\n\n`;

  for (const [type, items] of Object.entries(typeGroups)) {
    const label = type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    text += `### ${label} (${items.length})\n`;
    for (const item of items) {
      const time = new Date(item.timestamp).toLocaleTimeString();
      text += `- ${item.content}\n  _Source: ${item.sourceSessionName} at ${time}_\n`;
    }
    text += '\n';
  }

  return text;
};

/**
 * Subscribe to discovery changes. Returns an unsubscribe function.
 */
export const subscribeToDiscoveries = (callback: () => void): (() => void) => {
  const handler = () => callback();
  window.addEventListener(DISCOVERY_CHANGE_EVENT, handler);
  return () => window.removeEventListener(DISCOVERY_CHANGE_EVENT, handler);
};
