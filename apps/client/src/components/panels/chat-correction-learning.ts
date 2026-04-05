/**
 * Correction learning module: detects when the user corrects the agent
 * and extracts preferences to store in agent memory.
 *
 * Correction patterns include phrases like "no", "not like that", "instead",
 * "actually", "I prefer", etc. When detected, the preference is extracted
 * and saved both per-folder and globally.
 */
import {
  addFolderObservation,
  addGlobalPreference,
  type MemoryObservation,
} from './chat-agent-memory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrectionResult {
  /** Whether a correction was detected */
  isCorrection: boolean;
  /** The extracted preference text (if any) */
  preference: string | null;
  /** Whether this is a global preference vs folder-specific */
  isGlobal: boolean;
  /** The saved observation (null if duplicate or not saved) */
  savedObservation: MemoryObservation | null;
}

export interface FeedbackEntry {
  /** Unique id */
  id: string;
  /** The message index this feedback is for */
  messageIndex: number;
  /** 'positive' for thumbs up, 'negative' for thumbs down */
  type: 'positive' | 'negative';
  /** Optional correction text from the user (for negative feedback) */
  correctionText?: string;
  /** The original AI response content (truncated) */
  responsePreview: string;
  /** The user's original prompt that led to this response */
  userPrompt: string;
  /** Folder path where this feedback was given */
  folderPath: string;
  /** Timestamp */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Correction detection patterns
// ---------------------------------------------------------------------------

/** Patterns that indicate the user is correcting the agent */
const CORRECTION_STARTERS: RegExp[] = [
  /^no[,.\s!]/i,
  /^no$/i,
  /^nope/i,
  /^not like that/i,
  /^that'?s not (right|correct|what i)/i,
  /^wrong/i,
  /^actually[,\s]/i,
  /^instead[,\s]/i,
  /^i (prefer|want|need|meant|said)/i,
  /^don'?t do (that|it|this)/i,
  /^stop doing/i,
  /^please (don'?t|stop|use|do)/i,
  /^never (do|use|organize|sort|name|create)/i,
  /^always (use|do|organize|sort|name|create)/i,
  /^from now on/i,
  /^in the future/i,
  /^next time/i,
  /^remember (that|to|this)/i,
  /not (\w+)[,\s]+but (\w+)/i,
  /instead of (\w+)/i,
];

/** Patterns that indicate a global preference (not folder-specific) */
const GLOBAL_PREFERENCE_INDICATORS: RegExp[] = [
  /\balways\b/i,
  /\bnever\b/i,
  /\bfrom now on\b/i,
  /\bin the future\b/i,
  /\bevery time\b/i,
  /\ball files?\b/i,
  /\bprefer\b/i,
  /\bdefault\b/i,
  /\bnext time\b/i,
  /\bremember (that|to|this)\b/i,
];

// ---------------------------------------------------------------------------
// Preference extraction
// ---------------------------------------------------------------------------

/**
 * Extract a clean preference statement from a correction message.
 * Strips out the negative/corrective preamble and reformulates as a positive preference.
 */
const extractPreference = (message: string, _previousResponse: string): string | null => {
  const trimmed = message.trim();
  if (trimmed.length < 5) return null;
  if (trimmed.length > 200) return null;

  // Try to extract "X not Y" or "X instead of Y" patterns
  const notButMatch = trimmed.match(/not (\w[\w\s]+?)[,.\s]+(?:but|use|do|try) (\w[\w\s]+)/i);
  if (notButMatch) {
    return `Prefer ${notButMatch[2].trim()} over ${notButMatch[1].trim()}`;
  }

  const insteadOfMatch = trimmed.match(/instead of (\w[\w\s]+?)[,.\s]+(?:use|do|try) (\w[\w\s]+)/i);
  if (insteadOfMatch) {
    return `Prefer ${insteadOfMatch[2].trim()} over ${insteadOfMatch[1].trim()}`;
  }

  // "I prefer X" pattern
  const preferMatch = trimmed.match(/i prefer (\w[\w\s]+)/i);
  if (preferMatch) {
    return `User prefers ${preferMatch[1].trim()}`;
  }

  // "Always X" pattern
  const alwaysMatch = trimmed.match(/always (\w[\w\s]+)/i);
  if (alwaysMatch) {
    return `Always ${alwaysMatch[1].trim()}`;
  }

  // "Never X" pattern
  const neverMatch = trimmed.match(/never (\w[\w\s]+)/i);
  if (neverMatch) {
    return `Never ${neverMatch[1].trim()}`;
  }

  // "From now on X" / "Next time X" pattern
  const futureMatch = trimmed.match(/(?:from now on|in the future|next time)[,\s]+(.+)/i);
  if (futureMatch) {
    return futureMatch[1].trim();
  }

  // "Remember that X" pattern
  const rememberMatch = trimmed.match(/remember (?:that |to )?(.+)/i);
  if (rememberMatch) {
    return rememberMatch[1].trim();
  }

  // Strip common correction prefixes and return the remainder as-is
  const stripped = trimmed
    .replace(/^(no[,.\s!]+|nope[,.\s]+|wrong[,.\s]+|actually[,.\s]+|instead[,.\s]+)/i, '')
    .trim();

  if (stripped.length > 10 && stripped.length < 200) {
    return stripped;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect if a user message is a correction of the agent's previous response.
 * If so, extract the preference and store it.
 */
export const detectAndLearnCorrection = (
  userMessage: string,
  previousAiResponse: string,
  currentPath: string,
): CorrectionResult => {
  const trimmed = userMessage.trim();

  // Check if the message matches any correction pattern
  const isCorrection = CORRECTION_STARTERS.some((pattern) => pattern.test(trimmed));

  if (!isCorrection) {
    return { isCorrection: false, preference: null, isGlobal: false, savedObservation: null };
  }

  // Extract the preference
  const preference = extractPreference(trimmed, previousAiResponse);
  if (!preference) {
    return { isCorrection: true, preference: null, isGlobal: false, savedObservation: null };
  }

  // Determine if this is a global or folder-specific preference
  const isGlobal = GLOBAL_PREFERENCE_INDICATORS.some((pattern) => pattern.test(trimmed));

  // Save the preference
  let savedObservation: MemoryObservation | null = null;
  const tags = ['correction', 'preference'];

  if (isGlobal) {
    savedObservation = addGlobalPreference(preference, tags);
  }

  // Always save to folder if we have a path, even for global prefs
  if (currentPath) {
    const folderObs = addFolderObservation(currentPath, preference, tags);
    if (!savedObservation) {
      savedObservation = folderObs;
    }
  }

  return { isCorrection, preference, isGlobal, savedObservation };
};

/**
 * Process positive feedback: reinforces the approach by saving it as a positive memory.
 */
export const learnFromPositiveFeedback = (
  userPrompt: string,
  aiResponse: string,
  currentPath: string,
): MemoryObservation | null => {
  // Extract a short summary of what the AI did
  const summary = aiResponse.length > 100 ? `${aiResponse.slice(0, 100)}...` : aiResponse;
  const preference = `Good approach for "${userPrompt.slice(0, 50)}": ${summary}`;
  const tags = ['feedback', 'positive'];

  if (currentPath) {
    return addFolderObservation(currentPath, preference, tags);
  }
  return addGlobalPreference(preference, tags);
};

/**
 * Process negative feedback with a correction: saves what the user wants differently.
 */
export const learnFromNegativeFeedback = (
  correctionText: string,
  userPrompt: string,
  currentPath: string,
): MemoryObservation | null => {
  const preference = `For "${userPrompt.slice(0, 50)}": ${correctionText}`;
  const tags = ['feedback', 'negative', 'correction'];

  const isGlobal = GLOBAL_PREFERENCE_INDICATORS.some((pattern) => pattern.test(correctionText));

  if (isGlobal) {
    addGlobalPreference(preference, tags);
  }

  if (currentPath) {
    return addFolderObservation(currentPath, preference, tags);
  }
  return addGlobalPreference(preference, tags);
};

/**
 * Build a concise feedback context section for the system prompt.
 * Includes recent feedback entries so the AI can learn from past mistakes.
 */
export const buildFeedbackPrompt = (feedbackHistory: FeedbackEntry[]): string => {
  if (feedbackHistory.length === 0) return '';

  const lines: string[] = ['\n## User Feedback History'];
  lines.push(
    'The user has given feedback on your previous responses. Use this to improve future responses:',
  );

  const recent = feedbackHistory.slice(0, 10);
  for (const entry of recent) {
    if (entry.type === 'positive') {
      lines.push(
        `- [+] User liked your response to "${entry.userPrompt.slice(0, 40)}..." — continue this approach`,
      );
    } else {
      const correction = entry.correctionText
        ? `: "${entry.correctionText}"`
        : ' (no details given)';
      lines.push(
        `- [-] User disliked your response to "${entry.userPrompt.slice(0, 40)}..."${correction}`,
      );
    }
  }

  return lines.join('\n');
};
