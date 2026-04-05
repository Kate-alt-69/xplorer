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

/** Max image file size to include as base64 (5 MB). */
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Max number of images to include in a single context. */
export const MAX_IMAGE_CONTEXT_COUNT = 3;

/** Image extensions recognised for vision context. */
export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

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
  /** Base64-encoded image data (data URL) for vision-capable models. */
  imageBase64?: string;
  /** MIME type of the image (e.g. "image/png"). */
  imageMimeType?: string;
}

/** Check whether a file extension is a supported image type. */
export const isImageExtension = (ext: string): boolean => IMAGE_EXTENSIONS.has(ext.toLowerCase());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the lowercase extension from a file path (without the dot). */
export const getExt = (filePath: string): string => {
  const name = basename(filePath);
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : name.toLowerCase();
};

/** Map extension to MIME type for images. */
const imageMimeType = (ext: string): string => {
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
  };
  return map[ext] ?? 'image/png';
};

/**
 * Read an image file as base64 for vision context.
 * Returns null if the file is too large or cannot be read.
 */
export const readImageAsBase64 = async (
  filePath: string,
): Promise<{ base64: string; mimeType: string } | null> => {
  try {
    const bytes = await TauriAPI.readBinaryFile(filePath);
    if (bytes.length > MAX_IMAGE_SIZE_BYTES) {
      return null; // Too large
    }
    const ext = getExt(filePath);
    const mime = imageMimeType(ext);

    // Convert Uint8Array to base64 string
    let binary = '';
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);
    return { base64: b64, mimeType: mime };
  } catch {
    return null;
  }
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

  // Handle images — read as base64 for vision models
  if (isImageExtension(ext)) {
    const imageData = await readImageAsBase64(file.path);
    if (imageData) {
      return {
        name: file.name,
        path: file.path,
        file_type: ext,
        content: `[Image file: ${file.name}]`,
        imageBase64: imageData.base64,
        imageMimeType: imageData.mimeType,
      };
    }
    // Fall back to metadata-only if image too large or unreadable
    return {
      name: file.name,
      path: file.path,
      file_type: ext,
      content: `[Image file: ${file.name} — too large or unreadable for vision analysis]`,
    };
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
