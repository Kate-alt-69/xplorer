/**
 * Handlers for special slash commands that don't go to the AI:
 * /memory, /forget, /compare
 *
 * Returns a response object or null if the command is not handled here.
 */
import {
  getFolderMemory,
  clearFolderMemory,
  getGlobalPreferences,
  getMemorySummary,
} from './chat-agent-memory';
import { getXplorerState } from './chat-context-helpers';

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

  return null;
};
