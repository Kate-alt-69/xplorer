/**
 * AI Document Intelligence for the chat agent.
 *
 * Provides:
 * 1. Document summarization — offer summaries for large text files or PDFs
 * 2. Folder document summarization — summarize all documents in a folder
 * 3. Smart thumbnails — extract first lines of text content for previews
 *
 * Exposed via the /summarize-folder slash command and proactive suggestions
 * when large files are in context.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import type { FileEntry } from '@/lib/tauri-api-types';
import { getExt } from './chat-context-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  /** File name */
  name: string;
  /** Full path */
  path: string;
  /** File extension */
  ext: string;
  /** File size in bytes */
  size: number;
  /** Extracted text content (truncated) */
  content: string;
  /** Whether content was truncated */
  truncated: boolean;
  /** Number of lines in the content */
  lineCount: number;
}

export interface DocumentSummaryContext {
  /** The document info */
  document: DocumentInfo;
  /** Whether the document is "large" (>2KB) and warrants a summary offer */
  isLarge: boolean;
  /** First N lines for thumbnail preview */
  thumbnail: string;
}

export interface FolderDocumentReport {
  /** Directory path */
  dirPath: string;
  /** Total documents found */
  totalDocuments: number;
  /** Documents with extractable content */
  readableDocuments: DocumentInfo[];
  /** Documents that could not be read */
  unreadableCount: number;
  /** Total size of all documents */
  totalSize: number;
  /** Formatted summary for chat display */
  summary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Size threshold (bytes) above which we offer a summary */
const LARGE_FILE_THRESHOLD = 2048;

/** Max content to extract per document for summarization context */
const MAX_CONTENT_PER_DOC = 8_000;

/** Max content for folder-level summarization per document */
const MAX_CONTENT_PER_DOC_FOLDER = 4_000;

/** Max documents to process in a folder summarization */
const MAX_DOCS_IN_FOLDER = 20;

/** Lines to extract for "smart thumbnail" preview */
const THUMBNAIL_LINES = 3;

/** Document file extensions that support text extraction */
const DOCUMENT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'rst',
  'org',
  'tex',
  'pdf',
  'doc',
  'docx',
  'rtf',
  'odt',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'log',
  'ini',
  'cfg',
  'conf',
  'toml',
  'xls',
  'xlsx',
  'pptx',
  'ppt',
  'ods',
  'odp',
]);

/** Extensions that are always "text" (no extraction needed) */
const PLAIN_TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'rst',
  'org',
  'tex',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'log',
  'ini',
  'cfg',
  'conf',
  'toml',
]);

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Check if a file is a document type that supports summarization.
 */
export const isDocumentFile = (filePath: string): boolean => {
  const ext = getExt(filePath);
  return DOCUMENT_EXTENSIONS.has(ext);
};

/**
 * Check if a file is large enough to warrant a summary offer.
 */
export const isLargeDocument = (size: number): boolean => size > LARGE_FILE_THRESHOLD;

/**
 * Extract content from a document file.
 * Tries plain text read first, then document extraction for binary formats.
 */
export const extractDocumentContent = async (
  filePath: string,
  maxLength = MAX_CONTENT_PER_DOC,
): Promise<{ content: string; truncated: boolean; lineCount: number } | null> => {
  const ext = getExt(filePath);

  // Try plain text read for known text formats
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    try {
      const text = await TauriAPI.readTextFile(filePath);
      const lineCount = text.split('\n').length;
      if (text.length > maxLength) {
        return {
          content: text.slice(0, maxLength),
          truncated: true,
          lineCount,
        };
      }
      return { content: text, truncated: false, lineCount };
    } catch {
      return null;
    }
  }

  // Try document extraction for binary formats (PDF, DOCX, etc.)
  try {
    const text = await TauriAPI.extractDocumentText(filePath);
    const lineCount = text.split('\n').length;
    if (text.length > maxLength) {
      return {
        content: text.slice(0, maxLength),
        truncated: true,
        lineCount,
      };
    }
    if (text.trim().length > 0) {
      return { content: text, truncated: false, lineCount };
    }
  } catch {
    // Extraction not available
  }

  return null;
};

/**
 * Build a document summary context for a single file.
 * Used when a file is loaded into the chat context.
 */
export const buildDocumentSummaryContext = async (file: {
  name: string;
  path: string;
  size: number;
}): Promise<DocumentSummaryContext | null> => {
  if (!isDocumentFile(file.path)) return null;

  const extracted = await extractDocumentContent(file.path);
  if (!extracted) return null;

  const ext = getExt(file.path);
  const thumbnail = extractThumbnail(extracted.content);

  return {
    document: {
      name: file.name,
      path: file.path,
      ext,
      size: file.size,
      content: extracted.content,
      truncated: extracted.truncated,
      lineCount: extracted.lineCount,
    },
    isLarge: isLargeDocument(file.size),
    thumbnail,
  };
};

/**
 * Extract the first N non-empty lines of content as a "smart thumbnail".
 */
export const extractThumbnail = (content: string): string => {
  const lines = content.split('\n');
  const nonEmpty: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      // Truncate very long lines
      nonEmpty.push(trimmed.length > 100 ? `${trimmed.slice(0, 100)}...` : trimmed);
    }
    if (nonEmpty.length >= THUMBNAIL_LINES) break;
  }

  return nonEmpty.join('\n');
};

/**
 * Check if a file in context is large enough to suggest summarization.
 * Returns a suggestion message or null.
 */
export const checkSummarizationSuggestion = (file: {
  name: string;
  path: string;
  size: number;
}): string | null => {
  if (!isDocumentFile(file.path)) return null;
  if (!isLargeDocument(file.size)) return null;

  const sizeStr = formatFileSize(file.size);
  return `This file (${file.name}, ${sizeStr}) is quite large. Would you like me to summarize it?`;
};

// ---------------------------------------------------------------------------
// Folder document summarization
// ---------------------------------------------------------------------------

/**
 * Analyze all documents in a folder and prepare summaries.
 */
export const analyzeFolderDocuments = async (dirPath: string): Promise<FolderDocumentReport> => {
  const entries = await TauriAPI.readDirectory(dirPath);
  const docFiles = entries.filter((e) => !e.is_dir && isDocumentFile(e.path));

  if (docFiles.length === 0) {
    return {
      dirPath,
      totalDocuments: 0,
      readableDocuments: [],
      unreadableCount: 0,
      totalSize: 0,
      summary: `**No documents found** in ${dirPath}. No text, PDF, or office files detected.`,
    };
  }

  // Sort by size descending to prioritize larger (more important) docs
  const sorted = [...docFiles].sort((a, b) => b.size - a.size);
  const toProcess = sorted.slice(0, MAX_DOCS_IN_FOLDER);

  const readableDocs: DocumentInfo[] = [];
  let unreadableCount = 0;
  let totalSize = 0;

  for (const file of toProcess) {
    totalSize += file.size;
    const extracted = await extractDocumentContent(file.path, MAX_CONTENT_PER_DOC_FOLDER);
    if (extracted) {
      readableDocs.push({
        name: file.name,
        path: file.path,
        ext: getExt(file.path),
        size: file.size,
        content: extracted.content,
        truncated: extracted.truncated,
        lineCount: extracted.lineCount,
      });
    } else {
      unreadableCount++;
    }
  }

  // Add unprocessed files to total size and unreadable count
  if (docFiles.length > MAX_DOCS_IN_FOLDER) {
    const remaining = docFiles.slice(MAX_DOCS_IN_FOLDER);
    for (const f of remaining) {
      totalSize += f.size;
    }
    unreadableCount += remaining.length;
  }

  const summary = buildFolderDocumentSummary(
    dirPath,
    docFiles.length,
    readableDocs,
    unreadableCount,
    totalSize,
  );

  return {
    dirPath,
    totalDocuments: docFiles.length,
    readableDocuments: readableDocs,
    unreadableCount,
    totalSize,
    summary,
  };
};

/**
 * Build a human-readable summary of folder documents for chat display.
 */
const buildFolderDocumentSummary = (
  dirPath: string,
  totalDocs: number,
  readableDocs: DocumentInfo[],
  unreadableCount: number,
  totalSize: number,
): string => {
  const lines: string[] = [`**Documents in ${dirPath}**\n`];

  lines.push(
    `Found **${totalDocs}** document${totalDocs !== 1 ? 's' : ''} (${formatFileSize(totalSize)} total)\n`,
  );

  // Group by extension
  const byExt = new Map<string, DocumentInfo[]>();
  for (const doc of readableDocs) {
    const group = byExt.get(doc.ext);
    if (group) {
      group.push(doc);
    } else {
      byExt.set(doc.ext, [doc]);
    }
  }

  if (byExt.size > 0) {
    lines.push('**By type:**');
    for (const [ext, docs] of byExt) {
      const extSize = docs.reduce((acc, d) => acc + d.size, 0);
      lines.push(
        `- .${ext}: ${docs.length} file${docs.length !== 1 ? 's' : ''} (${formatFileSize(extSize)})`,
      );
    }
    lines.push('');
  }

  // Show thumbnails for readable documents
  if (readableDocs.length > 0) {
    lines.push('**Document previews:**');
    const maxPreviews = 10;
    for (let i = 0; i < Math.min(readableDocs.length, maxPreviews); i++) {
      const doc = readableDocs[i];
      const thumbnail = extractThumbnail(doc.content);
      const sizeStr = formatFileSize(doc.size);
      lines.push(`\n**${doc.name}** (${sizeStr}, ${doc.lineCount} lines)`);
      if (thumbnail) {
        lines.push(`> ${thumbnail.split('\n').join('\n> ')}`);
      }
    }
    if (readableDocs.length > maxPreviews) {
      lines.push(`\n... and ${readableDocs.length - maxPreviews} more documents`);
    }
  }

  if (unreadableCount > 0) {
    lines.push(
      `\n${unreadableCount} document${unreadableCount !== 1 ? 's' : ''} could not be read.`,
    );
  }

  // Check for PDF-heavy folders
  const pdfCount = readableDocs.filter((d) => d.ext === 'pdf').length;
  if (pdfCount >= 2) {
    lines.push(`\nThis folder has ${pdfCount} PDFs. Would you like me to summarize all of them?`);
  } else {
    lines.push('\nWould you like me to summarize any of these documents?');
  }

  return lines.join('\n');
};

/**
 * Build a context string with document contents for AI summarization.
 * Used when the AI needs to summarize multiple documents.
 */
export const buildFolderSummarizationContext = (report: FolderDocumentReport): string => {
  const lines: string[] = [
    `Summarize the following ${report.readableDocuments.length} documents from ${report.dirPath}:\n`,
  ];

  for (const doc of report.readableDocuments) {
    lines.push(`### ${doc.name} (${formatFileSize(doc.size)})`);
    lines.push('```');
    // Use first 2000 chars per doc for summarization context
    const contentPreview = doc.content.slice(0, 2000);
    lines.push(contentPreview);
    if (doc.content.length > 2000) {
      lines.push('... [truncated]');
    }
    lines.push('```\n');
  }

  lines.push(
    'Provide a concise summary of each document, then an overall summary of what this folder contains.',
  );

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Smart thumbnail generation for file listings
// ---------------------------------------------------------------------------

/**
 * Generate smart thumbnails for a list of files.
 * Returns a map of file path -> thumbnail text (first 3 lines).
 */
export const generateSmartThumbnails = async (files: FileEntry[]): Promise<Map<string, string>> => {
  const thumbnails = new Map<string, string>();
  const docFiles = files.filter((f) => !f.is_dir && isDocumentFile(f.path));

  // Process in parallel but limit concurrency
  const BATCH_SIZE = 5;
  for (let i = 0; i < docFiles.length; i += BATCH_SIZE) {
    const batch = docFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        try {
          const text = await TauriAPI.readTextFile(file.path);
          const thumbnail = extractThumbnail(text);
          return { path: file.path, thumbnail };
        } catch {
          // Try document extraction for binary docs
          try {
            const text = await TauriAPI.extractDocumentText(file.path);
            const thumbnail = extractThumbnail(text);
            return { path: file.path, thumbnail };
          } catch {
            return null;
          }
        }
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value?.thumbnail) {
        thumbnails.set(result.value.path, result.value.thumbnail);
      }
    }
  }

  return thumbnails;
};

// ---------------------------------------------------------------------------
// System prompt snippet
// ---------------------------------------------------------------------------

/**
 * Additional system prompt context for document intelligence capabilities.
 */
export const DOCUMENT_INTELLIGENCE_PROMPT = `
## Document Intelligence
You can analyze and summarize documents:

### Single Document Summary
When a large text file, PDF, or office document (>2KB) is loaded in context, you can offer to summarize it. Provide:
- A concise summary of the document's purpose and key points
- Important details, numbers, or conclusions
- The document's structure (sections, chapters if applicable)

### Folder Document Summary (/summarize-folder)
For folders containing multiple documents, you can:
- List all documents with type breakdown and sizes
- Show smart previews (first 3 lines of each document)
- Offer to summarize all documents together
- Highlight PDFs and suggest batch summarization

### Smart Thumbnails
For file listings, you can extract the first few lines of text content as a quick preview, helping users identify files without opening them.

When you see documents in the user's context, proactively mention summarization if the files are large or numerous.
`.trim();
