/**
 * Feedback storage for AI chat responses.
 * Stores thumbs-up/down feedback per message, both per-folder and globally.
 * The agent uses this feedback history to improve future responses.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { normalizePath } from './chat-agent-memory';
import type { FeedbackEntry } from './chat-correction-learning';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEEDBACK_STORAGE_KEY = STORAGE_KEYS.AI_CHAT_FEEDBACK;

/** Max feedback entries to store */
const MAX_FEEDBACK_ENTRIES = 100;

/** Feedback entries older than this are evicted (30 days) */
const FEEDBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

const generateFeedbackId = (): string =>
  `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const loadFeedbackEntries = (): FeedbackEntry[] => {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FeedbackEntry[];
  } catch {
    return [];
  }
};

const saveFeedbackEntries = (entries: FeedbackEntry[]): void => {
  try {
    const now = Date.now();
    const live = entries
      .filter((e) => now - e.createdAt < FEEDBACK_TTL_MS)
      .slice(0, MAX_FEEDBACK_ENTRIES);
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(live));
  } catch {
    // localStorage full or unavailable
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a positive feedback entry (thumbs up).
 */
export const addPositiveFeedback = (
  messageIndex: number,
  responsePreview: string,
  userPrompt: string,
  folderPath: string,
): FeedbackEntry => {
  const entry: FeedbackEntry = {
    id: generateFeedbackId(),
    messageIndex,
    type: 'positive',
    responsePreview: responsePreview.slice(0, 200),
    userPrompt: userPrompt.slice(0, 200),
    folderPath: normalizePath(folderPath),
    createdAt: Date.now(),
  };

  const entries = loadFeedbackEntries();
  entries.unshift(entry);
  saveFeedbackEntries(entries);
  return entry;
};

/**
 * Add a negative feedback entry (thumbs down) with optional correction text.
 */
export const addNegativeFeedback = (
  messageIndex: number,
  responsePreview: string,
  userPrompt: string,
  folderPath: string,
  correctionText?: string,
): FeedbackEntry => {
  const entry: FeedbackEntry = {
    id: generateFeedbackId(),
    messageIndex,
    type: 'negative',
    correctionText,
    responsePreview: responsePreview.slice(0, 200),
    userPrompt: userPrompt.slice(0, 200),
    folderPath: normalizePath(folderPath),
    createdAt: Date.now(),
  };

  const entries = loadFeedbackEntries();
  entries.unshift(entry);
  saveFeedbackEntries(entries);
  return entry;
};

/**
 * Get feedback entries for a specific folder.
 */
export const getFolderFeedback = (folderPath: string): FeedbackEntry[] => {
  const key = normalizePath(folderPath);
  return loadFeedbackEntries().filter((e) => e.folderPath === key);
};

/**
 * Get all feedback entries (global).
 */
export const getAllFeedback = (): FeedbackEntry[] => loadFeedbackEntries();

/**
 * Check if a message already has feedback.
 */
export const getMessageFeedback = (messageIndex: number): FeedbackEntry | null => {
  const entries = loadFeedbackEntries();
  return entries.find((e) => e.messageIndex === messageIndex) ?? null;
};

/**
 * Clear all feedback entries.
 */
export const clearAllFeedback = (): void => {
  localStorage.removeItem(FEEDBACK_STORAGE_KEY);
};

/**
 * Clear feedback entries for a specific folder.
 */
export const clearFolderFeedback = (folderPath: string): void => {
  const key = normalizePath(folderPath);
  const entries = loadFeedbackEntries().filter((e) => e.folderPath !== key);
  saveFeedbackEntries(entries);
};
