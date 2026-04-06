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
import { formatAuditLogDisplay } from './chat-audit-log';
import { formatSecurityRulesDisplay } from './chat-security-rules';
import {
  findDuplicatesInDirectory,
  formatDuplicateReport,
  detectRenamePatterns,
  formatRenamePatternReport,
} from './chat-smart-file-ops';
import { handleCommitMessageCommand } from './ai-git-helpers';
import { handleWorkflowSlashCommand, type WorkflowCommandResult } from './chat-workflow-templates';
import { TauriAPI } from '@/lib/tauri-api';

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

  // /audit -- show recent agent action audit log
  if (prompt === '__SHOW_AUDIT__') {
    return { type: 'handled', responseText: formatAuditLogDisplay() };
  }

  // /security -- show and configure security rules
  if (prompt === '__SHOW_SECURITY__') {
    return { type: 'handled', responseText: formatSecurityRulesDisplay() };
  }

  // /duplicates -- find duplicate files in current folder
  if (prompt === '__FIND_DUPLICATES__') {
    if (!currentPath) {
      return {
        type: 'handled',
        responseText: 'No current folder to scan for duplicates.',
      };
    }
    return {
      type: 'redirect',
      redirectPrompt: `Scan the current directory for duplicate files. List the directory first, then identify files with the same size. For files with matching sizes, compare them to confirm they are duplicates. Report how many duplicate groups you found and how much space could be saved. Offer to clean them up by keeping the oldest copy and trashing the rest.`,
    };
  }

  // /rename-pattern -- detect filename patterns and suggest batch rename
  if (prompt === '__RENAME_PATTERN__') {
    if (!currentPath) {
      return {
        type: 'handled',
        responseText: 'No current folder to analyze for rename patterns.',
      };
    }
    return {
      type: 'redirect',
      redirectPrompt: `Analyze filenames in the current directory for common patterns (camera timestamps like IMG_20240101_001.jpg, screenshot names, copy suffixes like "file (1).txt", WhatsApp media names, etc.). For each pattern found, suggest a cleaner naming convention and show example before/after. Then offer to batch rename matching files.`,
    };
  }

  // /organize-folder -- analyze folder and suggest organization by type
  if (prompt === '__ORGANIZE_FOLDER__') {
    if (!currentPath) {
      return {
        type: 'handled',
        responseText: 'No current folder to analyze for organization.',
      };
    }
    return {
      type: 'redirect',
      redirectPrompt: `Analyze the file types in the current directory and suggest a folder organization structure. Group files by category (Images, Documents, Code, Videos, Audio, Archives) and suggest creating folders for categories with 3+ files. Show how many files would go into each folder and the total space. Present the plan before executing.`,
    };
  }

  // /find [query] -- AI-enhanced search
  if (prompt === '__AI_SEARCH__') {
    return {
      type: 'handled',
      responseText: 'Please provide a search query: `/find [query]`',
    };
  }
  if (prompt.startsWith('__AI_SEARCH__')) {
    const query = prompt.slice('__AI_SEARCH__'.length).trim();
    if (!query) {
      return {
        type: 'handled',
        responseText: 'Please provide a search query: `/find [query]`',
      };
    }
    return {
      type: 'redirect',
      redirectPrompt: `Search for "${query}" in the current directory. Use both filename matching and content search (search inside files). Show all matching files with relevant snippets. Group results by content matches vs filename matches.`,
    };
  }

  // /summarize-folder -- summarize all documents in current folder
  if (prompt === '__SUMMARIZE_FOLDER__') {
    if (!currentPath) {
      return {
        type: 'handled',
        responseText: 'No current folder to analyze for documents.',
      };
    }
    return {
      type: 'redirect',
      redirectPrompt: `List the current directory and identify all document files (text, PDF, office docs, markdown, etc.). For each document, read the first portion and provide a concise summary. Then give an overall summary of what this folder's documents contain. Focus on key information, purpose, and any patterns across the documents.`,
    };
  }

  // /workflows, /run-workflow, /save-workflow, /delete-workflow
  const workflowResult = handleWorkflowSlashCommand(prompt, currentPath);
  if (workflowResult) {
    return convertWorkflowResult(workflowResult);
  }

  return null;
};

// ---------------------------------------------------------------------------
// Workflow result converter
// ---------------------------------------------------------------------------

const convertWorkflowResult = (result: WorkflowCommandResult): SpecialCommandResult => {
  if (result.type === 'task_plan' && result.taskPlanJson) {
    // Return a redirect that includes the task plan JSON so the chat panel
    // can parse it and show the plan approval UI.
    return {
      type: 'handled',
      responseText: `${result.responseText ?? ''}\n\n\`\`\`task_plan\n${result.taskPlanJson}\n\`\`\``,
    };
  }
  return {
    type: result.type === 'handled' ? 'handled' : 'redirect',
    responseText: result.responseText,
    redirectPrompt: result.redirectPrompt,
  };
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

// ---------------------------------------------------------------------------
// Async smart file ops handlers (for programmatic use)
// ---------------------------------------------------------------------------

/**
 * Handle the /commit-message command (async — calls AI).
 */
export const handleCommitMessageAsync = async (
  currentPath: string,
  model: string,
): Promise<SpecialCommandResult> => {
  const responseText = await handleCommitMessageCommand(currentPath, model);
  return { type: 'handled', responseText };
};

/**
 * Run the /duplicates analysis and return a formatted report.
 * This is the async version that pre-computes results directly.
 */
export const handleDuplicatesAsync = async (currentPath: string): Promise<SpecialCommandResult> => {
  if (!currentPath) {
    return {
      type: 'handled',
      responseText: 'No current folder to scan for duplicates.',
    };
  }
  try {
    const report = await findDuplicatesInDirectory(currentPath);
    return {
      type: 'handled',
      responseText: formatDuplicateReport(currentPath, report),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'handled',
      responseText: `Failed to scan for duplicates: ${msg}`,
    };
  }
};

/**
 * Run the /rename-pattern analysis and return a formatted report.
 * This is the async version that pre-computes results directly.
 */
export const handleRenamePatternAsync = async (
  currentPath: string,
): Promise<SpecialCommandResult> => {
  if (!currentPath) {
    return {
      type: 'handled',
      responseText: 'No current folder to analyze for rename patterns.',
    };
  }
  try {
    const entries = await TauriAPI.readDirectory(currentPath);
    const patterns = detectRenamePatterns(entries);
    return {
      type: 'handled',
      responseText: formatRenamePatternReport(currentPath, patterns),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'handled',
      responseText: `Failed to analyze filename patterns: ${msg}`,
    };
  }
};

/**
 * Run the /find search and return a formatted report.
 * This is the async version that pre-computes results directly.
 */
export const handleAISearchAsync = async (
  query: string,
  currentPath: string,
): Promise<SpecialCommandResult> => {
  if (!query) {
    return {
      type: 'handled',
      responseText: 'Please provide a search query: `/find [query]`',
    };
  }
  try {
    const { performAISearch, formatSearchReport } = await import('./chat-search-integration');
    const report = await performAISearch(query, currentPath);
    return {
      type: 'handled',
      responseText: formatSearchReport(report),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'handled',
      responseText: `Search failed: ${msg}`,
    };
  }
};

/**
 * Run the /summarize-folder analysis and return a formatted report.
 * This is the async version that pre-computes results directly.
 */
export const handleSummarizeFolderAsync = async (
  currentPath: string,
): Promise<SpecialCommandResult> => {
  if (!currentPath) {
    return {
      type: 'handled',
      responseText: 'No current folder to analyze for documents.',
    };
  }
  try {
    const { analyzeFolderDocuments } = await import('./chat-document-intelligence');
    const report = await analyzeFolderDocuments(currentPath);
    return {
      type: 'handled',
      responseText: report.summary,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'handled',
      responseText: `Failed to analyze folder documents: ${msg}`,
    };
  }
};
