/**
 * Chat history persistence utilities for the AI chat panel.
 * Saves/loads conversations to localStorage.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: string;
  content: string;
  /** Whether this is a system/context injection message (hidden from user) */
  isContextInjection?: boolean;
  /** Files that were dropped onto chat for this message */
  droppedFiles?: Array<{ name: string; path: string }>;
}

export interface SavedConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max saved conversations in history */
const MAX_CHAT_HISTORY = 30;

/** localStorage key for chat history */
const CHAT_HISTORY_KEY = STORAGE_KEYS.AI_CHAT_HISTORY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const generateConversationId = (): string =>
  `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Derive a short title from the first user message */
export const deriveConversationTitle = (messages: ChatMessage[]): string => {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New conversation';
  const text = firstUser.content.trim();
  return text.length > 50 ? `${text.slice(0, 47)}...` : text;
};

export const loadChatHistory = (): SavedConversation[] => {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedConversation[];
  } catch {
    return [];
  }
};

export const saveChatHistory = (history: SavedConversation[]): void => {
  try {
    // Keep only the most recent conversations
    const trimmed = history.slice(0, MAX_CHAT_HISTORY);
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable -- silently ignore
  }
};

/** Format a timestamp as a human-readable relative time string */
export const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};
