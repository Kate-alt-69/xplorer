/**
 * Handlers for special slash commands that don't go to the AI:
 * /memory, /forget, /compare, /preferences
 *
 * Returns a response object or null if the command is not handled here.
 */
import {
  getFolderMemory,
  clearFolderMemory,
  getGlobalPreferences,
  getMemorySummary,
  normalizePath,
  loadMemoryStore,
} from './chat-agent-memory';
import { getXplorerState } from './chat-context-helpers';
import { loadFeedbackEntries } from './chat-feedback-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecialCommandResult {
  /** 'handled' means show responseText directly. 'redirect' means call sendMessage. */
  type: 'handled' | 'redirect';
  responseText?: string;
  redirectPrompt?: string;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Handle special slash commands that are fully client-side.
 * Returns null if the prompt is not a special command.
 */
export const handleSpecialSlashCommand = (
  prompt: string,
  currentPath: string,
): SpecialCommandResult | null => {
  // /memory -- show what the agent remembers
  if (prompt === '__SHOW_MEMORY__') {
    const folderMem = currentPath ? getFolderMemory(currentPath) : null;
    const globalPrefs = getGlobalPreferences();
    const summary = getMemorySummary();
    let memText = '**Agent Memory**\n\n';
    if (folderMem && folderMem.observations.length > 0) {
      memText += `**This folder** (${folderMem.visitCount} visits):\n`;
      for (const obs of folderMem.observations) {
        memText += `- ${obs.text}\n`;
      }
      memText += '\n';
    } else {
      memText += 'No memories for this folder yet.\n\n';
    }
    if (globalPrefs.length > 0) {
      memText += '**Global preferences:**\n';
      for (const pref of globalPrefs) {
        memText += `- ${pref.text}\n`;
      }
      memText += '\n';
    }
    memText += `Remembering ${summary.length} folder${summary.length !== 1 ? 's' : ''} total.`;
    return { type: 'handled', responseText: memText };
  }

  // /forget -- clear memory for current folder
  if (prompt === '__CLEAR_MEMORY__') {
    if (currentPath) {
      clearFolderMemory(currentPath);
    }
    return {
      type: 'handled',
      responseText: currentPath
        ? 'Cleared all agent memory for this folder.'
        : 'No current folder to clear memory for.',
    };
  }

  // /compare selected files
  if (prompt === '__COMPARE_SELECTED__') {
    const xState = getXplorerState();
    const sel = xState?.selectedFiles ?? [];
    if (sel.length === 2 && !sel[0].is_dir && !sel[1].is_dir) {
      return {
        type: 'redirect',
        redirectPrompt: `Compare these two files in detail:\n1. ${sel[0].path}\n2. ${sel[1].path}`,
      };
    }
    return {
      type: 'handled',
      responseText: 'Please select exactly 2 files to compare, or use `/compare file1 file2`.',
    };
  }

  // /compare file1 file2
  if (prompt.startsWith('__COMPARE_FILES__')) {
    const paths = prompt.slice('__COMPARE_FILES__'.length).split('|');
    if (paths.length === 2 && paths[0] && paths[1]) {
      return {
        type: 'redirect',
        redirectPrompt: `Compare these two files in detail:\n1. ${paths[0]}\n2. ${paths[1]}`,
      };
    }
    return {
      type: 'handled',
      responseText: 'Please provide two file paths: `/compare file1 file2`.',
    };
  }

  // /preferences -- show learned preferences and feedback history
  if (prompt === '__SHOW_PREFERENCES__') {
    return { type: 'handled', responseText: buildPreferencesDisplay(currentPath) };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Preferences display builder
// ---------------------------------------------------------------------------

/**
 * Build a formatted display of all learned preferences and feedback.
 */
const buildPreferencesDisplay = (currentPath: string): string => {
  const store = loadMemoryStore();
  const globalPrefs = getGlobalPreferences();
  const feedbackEntries = loadFeedbackEntries();
  const summary = getMemorySummary();
  const lines: string[] = ['**Learned Preferences**\n'];

  // Global preferences
  if (globalPrefs.length > 0) {
    lines.push('**Global:**');
    for (const pref of globalPrefs) {
      const tagStr = pref.tags.includes('correction') ? ' (from correction)' : '';
      const feedbackStr = pref.tags.includes('feedback') ? ' (from feedback)' : '';
      lines.push(`- ${pref.text}${tagStr}${feedbackStr}`);
    }
    lines.push('');
  } else {
    lines.push('**Global:** No global preferences learned yet.\n');
  }

  // Current folder preferences
  if (currentPath) {
    const key = normalizePath(currentPath);
    const folderMem = store.folders[key];
    if (folderMem && folderMem.observations.length > 0) {
      const prefs = folderMem.observations.filter(
        (obs) =>
          obs.tags.includes('preference') ||
          obs.tags.includes('correction') ||
          obs.tags.includes('feedback'),
      );
      if (prefs.length > 0) {
        lines.push(`**${key}:**`);
        for (const pref of prefs) {
          lines.push(`- ${pref.text}`);
        }
        lines.push('');
      }
    }
  }

  // Other folder preferences (non-current)
  const currentKey = currentPath ? normalizePath(currentPath) : '';
  const otherFolders = Object.values(store.folders).filter((f) => {
    if (f.path === currentKey) return false;
    return f.observations.some(
      (obs) =>
        obs.tags.includes('preference') ||
        obs.tags.includes('correction') ||
        obs.tags.includes('feedback'),
    );
  });

  if (otherFolders.length > 0) {
    for (const folder of otherFolders.slice(0, 5)) {
      const prefs = folder.observations.filter(
        (obs) =>
          obs.tags.includes('preference') ||
          obs.tags.includes('correction') ||
          obs.tags.includes('feedback'),
      );
      if (prefs.length > 0) {
        lines.push(`**${folder.path}:**`);
        for (const pref of prefs) {
          lines.push(`- ${pref.text}`);
        }
        lines.push('');
      }
    }
  }

  // Feedback summary
  if (feedbackEntries.length > 0) {
    const positiveCount = feedbackEntries.filter((e) => e.type === 'positive').length;
    const negativeCount = feedbackEntries.filter((e) => e.type === 'negative').length;
    lines.push(
      `**Feedback:** ${positiveCount} positive, ${negativeCount} negative responses recorded.`,
    );
  }

  // Stats
  lines.push('');
  lines.push(
    `Tracking ${summary.length} folder${summary.length !== 1 ? 's' : ''}, ${globalPrefs.length} global preferences.`,
  );
  lines.push(
    '\nUse `/forget` to clear this folder\'s memory, or say "clear all preferences" to reset everything.',
  );

  return lines.join('\n');
};
