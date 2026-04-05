/**
 * Chat message pinning utilities.
 * Persists pinned message indices per conversation in localStorage.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PinnedMessage {
  /** Index of the message in the conversation */
  messageIndex: number;
  /** Snapshot of the message content at pin time */
  content: string;
  /** Role of the message */
  role: string;
  /** Timestamp when pinned */
  pinnedAt: number;
}

interface PinnedStore {
  /** Map from conversation ID -> pinned messages */
  [conversationId: string]: PinnedMessage[];
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const PINNED_KEY = STORAGE_KEYS.AI_CHAT_PINNED;

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

const loadPinnedStore = (): PinnedStore => {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as PinnedStore;
  } catch {
    return {};
  }
};

const savePinnedStore = (store: PinnedStore): void => {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(store));
  } catch {
    // storage full -- silently ignore
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get all pinned messages for a conversation */
export const getPinnedMessages = (conversationId: string): PinnedMessage[] => {
  const store = loadPinnedStore();
  return store[conversationId] ?? [];
};

/** Pin a message. No-op if already pinned at that index. */
export const pinMessage = (
  conversationId: string,
  messageIndex: number,
  content: string,
  role: string,
): void => {
  const store = loadPinnedStore();
  const pins = store[conversationId] ?? [];
  if (pins.some((p) => p.messageIndex === messageIndex)) return;
  pins.push({ messageIndex, content, role, pinnedAt: Date.now() });
  store[conversationId] = pins;
  savePinnedStore(store);
};

/** Unpin a message by index */
export const unpinMessage = (conversationId: string, messageIndex: number): void => {
  const store = loadPinnedStore();
  const pins = store[conversationId] ?? [];
  store[conversationId] = pins.filter((p) => p.messageIndex !== messageIndex);
  if (store[conversationId].length === 0) {
    delete store[conversationId];
  }
  savePinnedStore(store);
};

/** Check if a message is pinned */
export const isMessagePinned = (conversationId: string, messageIndex: number): boolean => {
  const pins = getPinnedMessages(conversationId);
  return pins.some((p) => p.messageIndex === messageIndex);
};

/** Clear all pins for a conversation */
export const clearPins = (conversationId: string): void => {
  const store = loadPinnedStore();
  delete store[conversationId];
  savePinnedStore(store);
};
