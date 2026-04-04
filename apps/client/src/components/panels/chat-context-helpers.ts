/**
 * File reading and context-building helpers for the AI chat panel.
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { basename } from './chat-file-actions';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max bytes of file content to include in AI context (~10 KB). */
const MAX_FILE_CONTENT_LENGTH = 10_000;

/** Max total context for multi-file reads (~30 KB split across files). */
const MAX_MULTI_FILE_TOTAL = 30_000;

/** Max number of files to read content for at once. */
const MAX_MULTI_FILE_COUNT = 5;

/** Max directory entries to include in context injection */
const MAX_DIR_CONTEXT_ENTRIES = 50;

/** Max agent loop iterations (to prevent runaway loops) */
export const MAX_AGENT_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Xplorer state helpers
// ---------------------------------------------------------------------------

export interface XplorerState {
  currentPath?: string;
  selectedFiles?: Array<{ name: string; path: string; is_dir: boolean }>;
  editorSelection?: {
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
  } | null;
}

export const getXplorerState = (): XplorerState | undefined =>
  (window as unknown as { __xplorer_state__?: XplorerState }).__xplorer_state__;

// ---------------------------------------------------------------------------
// File context type
// ---------------------------------------------------------------------------

export interface FileContext {
  name: string;
  path: string;
  file_type: string;
  content?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the lowercase extension from a file path (without the dot). */
export const getExt = (filePath: string): string => {
  const name = basename(filePath);
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : name.toLowerCase();
};

/** Read file content for AI context. Tries text first, then document extraction. */
export const readFileForAIContext = async (
  file: { name: string; path: string; is_dir: boolean },
  maxLength = MAX_FILE_CONTENT_LENGTH,
): Promise<FileContext> => {
  const ext = getExt(file.path);

  if (file.is_dir) {
    return { name: file.name, path: file.path, file_type: 'directory' };
  }

  // Try reading as plain text first
  try {
    let content = await TauriAPI.readTextFile(file.path);
    if (content.length > maxLength) {
      content = `${content.slice(0, maxLength)}\n\n[... truncated at ${Math.round(maxLength / 1000)}KB ...]`;
    }
    if (content.trim().length > 0) {
      return { name: file.name, path: file.path, file_type: ext, content };
    }
  } catch {
    // Not a text file -- try document extraction
  }

  // Try document extraction (PDF, DOCX, XLSX, PPTX, etc.)
  try {
    let content = await TauriAPI.extractDocumentText(file.path);
    if (content.length > maxLength) {
      content = `${content.slice(0, maxLength)}\n\n[... truncated at ${Math.round(maxLength / 1000)}KB ...]`;
    }
    if (content.trim().length > 0) {
      return { name: file.name, path: file.path, file_type: ext, content };
    }
  } catch {
    // Document extraction not available for this format
  }

  return {
    name: file.name,
    path: file.path,
    file_type: ext || 'unknown',
    content: `[File: ${file.name} (${ext || 'unknown'} format)]`,
  };
};

/**
 * Read multiple files for AI context. Distributes the byte budget across files
 * so that the total context stays manageable.
 */
export const readMultipleFilesForAIContext = async (
  files: Array<{ name: string; path: string; is_dir: boolean }>,
): Promise<FileContext[]> => {
  const nonDirFiles = files.filter((f) => !f.is_dir);
  const filesToRead = nonDirFiles.slice(0, MAX_MULTI_FILE_COUNT);
  if (filesToRead.length === 0) return [];

  const perFileLimit = Math.floor(MAX_MULTI_FILE_TOTAL / filesToRead.length);
  const results = await Promise.allSettled(
    filesToRead.map((f) => readFileForAIContext(f, perFileLimit)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FileContext> => r.status === 'fulfilled')
    .map((r) => r.value);
};

/** Build directory listing context string */
export const buildDirectoryContext = async (dirPath: string): Promise<string> => {
  try {
    const entries = await TauriAPI.readDirectory(dirPath);
    const total = entries.length;
    const shown = entries.slice(0, MAX_DIR_CONTEXT_ENTRIES);
    const lines = shown.map((e) => `  ${e.is_dir ? '[dir]' : `[${getExt(e.path)}]`} ${e.name}`);
    let result = `Directory listing of ${dirPath} (${total} items):\n${lines.join('\n')}`;
    if (total > MAX_DIR_CONTEXT_ENTRIES) {
      result += `\n  ... and ${total - MAX_DIR_CONTEXT_ENTRIES} more items`;
    }
    return result;
  } catch {
    return `Directory: ${dirPath} (could not read listing)`;
  }
};
