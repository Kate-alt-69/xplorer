/**
 * File comparison utilities for the AI chat agent.
 * Supports text diff, metadata comparison for binary files,
 * and schema diffing for structured data (JSON, CSV).
 *
 * Used by the /compare slash command and automatic detection
 * when exactly 2 files are dropped into chat.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { getExt, readFileForAIContext, type FileContext } from './chat-context-helpers';
import { basename } from './chat-file-actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonResult {
  /** Type of comparison performed */
  type: 'text' | 'metadata' | 'schema' | 'mixed';
  /** File A info */
  fileA: { name: string; path: string; ext: string; size?: number };
  /** File B info */
  fileB: { name: string; path: string; ext: string; size?: number };
  /** The comparison context string to inject into the AI prompt */
  contextForAI: string;
  /** Whether both files were successfully read */
  success: boolean;
  /** Error message if comparison failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Text file extensions that support line-by-line diffing */
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'rs',
  'go',
  'java',
  'kt',
  'kts',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'swift',
  'php',
  'sh',
  'bash',
  'zsh',
  'fish',
  'sql',
  'r',
  'lua',
  'vim',
  'el',
  'clj',
  'ex',
  'exs',
  'erl',
  'hs',
  'ml',
  'mli',
  'scala',
  'groovy',
  'gradle',
  'cmake',
  'makefile',
  'dockerfile',
  'conf',
  'ini',
  'cfg',
  'env',
  'gitignore',
  'gitattributes',
  'editorconfig',
  'eslintrc',
  'prettierrc',
  'babelrc',
  'tsconfig',
  'csv',
  'tsv',
  'log',
  'svg',
  'graphql',
  'gql',
  'proto',
  'prisma',
]);

/** Image extensions */
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'bmp',
  'tiff',
  'tif',
  'ico',
  'avif',
]);

/** Structured data extensions that support schema comparison */
const SCHEMA_EXTENSIONS = new Set(['json', 'csv', 'tsv', 'yaml', 'yml', 'xml']);

/** Max content size for comparison (per file) */
const MAX_COMPARE_SIZE = 15_000;

// ---------------------------------------------------------------------------
// Core comparison logic
// ---------------------------------------------------------------------------

/**
 * Compare two files and produce a context string for the AI.
 * Reads both files, determines the best comparison approach, and
 * generates a detailed comparison context.
 */
export const compareFiles = async (pathA: string, pathB: string): Promise<ComparisonResult> => {
  const nameA = basename(pathA);
  const nameB = basename(pathB);
  const extA = getExt(pathA);
  const extB = getExt(pathB);

  const result: ComparisonResult = {
    type: 'text',
    fileA: { name: nameA, path: pathA, ext: extA },
    fileB: { name: nameB, path: pathB, ext: extB },
    contextForAI: '',
    success: false,
  };

  // Read both files
  let contentA: FileContext;
  let contentB: FileContext;

  try {
    [contentA, contentB] = await Promise.all([
      readFileForAIContext({ name: nameA, path: pathA, is_dir: false }, MAX_COMPARE_SIZE),
      readFileForAIContext({ name: nameB, path: pathB, is_dir: false }, MAX_COMPARE_SIZE),
    ]);
  } catch (err) {
    result.error = `Failed to read files: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  // Get metadata for both files
  let metaA: { size: number; modified: string } | null = null;
  let metaB: { size: number; modified: string } | null = null;

  try {
    const [propsA, propsB] = await Promise.all([
      TauriAPI.getFileProperties(pathA).catch(() => null),
      TauriAPI.getFileProperties(pathB).catch(() => null),
    ]);
    if (propsA) {
      metaA = {
        size: propsA.size,
        modified: new Date(propsA.modified * 1000).toLocaleString(),
      };
    }
    if (propsB) {
      metaB = {
        size: propsB.size,
        modified: new Date(propsB.modified * 1000).toLocaleString(),
      };
    }
    result.fileA.size = metaA?.size;
    result.fileB.size = metaB?.size;
  } catch {
    // Metadata unavailable, continue without it
  }

  const isTextA =
    TEXT_EXTENSIONS.has(extA) ||
    (contentA.content != null && !contentA.content.startsWith('[File:'));
  const isTextB =
    TEXT_EXTENSIONS.has(extB) ||
    (contentB.content != null && !contentB.content.startsWith('[File:'));
  const isImageA = IMAGE_EXTENSIONS.has(extA);
  const isImageB = IMAGE_EXTENSIONS.has(extB);
  const isSchemaA = SCHEMA_EXTENSIONS.has(extA);
  const isSchemaB = SCHEMA_EXTENSIONS.has(extB);

  const sections: string[] = [];

  // -- Metadata comparison section --
  sections.push('## File Metadata');
  sections.push(`| Property | ${nameA} | ${nameB} |`);
  sections.push('|---|---|---|');
  sections.push(`| Extension | .${extA} | .${extB} |`);
  if (metaA?.size !== undefined && metaB?.size !== undefined) {
    sections.push(`| Size | ${formatBytes(metaA.size)} | ${formatBytes(metaB.size)} |`);
  }
  if (metaA?.modified && metaB?.modified) {
    sections.push(`| Modified | ${metaA.modified} | ${metaB.modified} |`);
  }
  sections.push('');

  // -- Text content comparison --
  if (isTextA && isTextB && contentA.content && contentB.content) {
    result.type = isSchemaA && isSchemaB ? 'schema' : 'text';

    const diffSummary = computeSimpleDiff(contentA.content, contentB.content);
    sections.push('## Content Comparison');
    sections.push(diffSummary);
    sections.push('');

    // For structured data, add schema comparison
    if (isSchemaA && isSchemaB && extA === extB) {
      const schemaDiff = compareSchemas(contentA.content, contentB.content, extA);
      if (schemaDiff) {
        result.type = 'schema';
        sections.push('## Schema / Structure Comparison');
        sections.push(schemaDiff);
        sections.push('');
      }
    }

    // Include full file contents for AI analysis
    sections.push(`## File A: ${nameA}`);
    sections.push(`\`\`\`${extA}`);
    sections.push(contentA.content);
    sections.push('```');
    sections.push('');
    sections.push(`## File B: ${nameB}`);
    sections.push(`\`\`\`${extB}`);
    sections.push(contentB.content);
    sections.push('```');
  } else if (isImageA && isImageB) {
    // Image comparison: metadata only (AI cannot see binary data)
    result.type = 'metadata';
    sections.push('## Image Comparison');
    sections.push(
      'Both files are images. Metadata comparison above shows size and format differences.',
    );
    sections.push(`File A: ${nameA} (.${extA})`);
    sections.push(`File B: ${nameB} (.${extB})`);
    if (metaA?.size !== undefined && metaB?.size !== undefined) {
      const sizeDiff = Math.abs(metaA.size - metaB.size);
      const pct = metaA.size > 0 ? ((sizeDiff / metaA.size) * 100).toFixed(1) : '0';
      sections.push(`Size difference: ${formatBytes(sizeDiff)} (${pct}%)`);
    }
  } else {
    // Mixed or binary comparison
    result.type = 'mixed';
    if (contentA.content && !contentA.content.startsWith('[File:')) {
      sections.push(`## File A: ${nameA} (text)`);
      sections.push(`\`\`\`${extA}`);
      sections.push(contentA.content);
      sections.push('```');
    } else {
      sections.push(`## File A: ${nameA}`);
      sections.push(`Binary file (.${extA})`);
    }
    sections.push('');
    if (contentB.content && !contentB.content.startsWith('[File:')) {
      sections.push(`## File B: ${nameB} (text)`);
      sections.push(`\`\`\`${extB}`);
      sections.push(contentB.content);
      sections.push('```');
    } else {
      sections.push(`## File B: ${nameB}`);
      sections.push(`Binary file (.${extB})`);
    }
  }

  result.contextForAI = sections.join('\n');
  result.success = true;
  return result;
};

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

/**
 * Compute a simple line-by-line diff summary.
 * Not a full Myers diff -- just enough to give the AI a structural overview.
 */
const computeSimpleDiff = (textA: string, textB: string): string => {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');

  if (textA === textB) {
    return `Files are identical (${linesA.length} lines).`;
  }

  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;

  const setA = new Set(linesA.map((l) => l.trimEnd()));
  const setB = new Set(linesB.map((l) => l.trimEnd()));

  for (const line of linesA) {
    if (!setB.has(line.trimEnd())) removedCount++;
  }
  for (const line of linesB) {
    if (!setA.has(line.trimEnd())) addedCount++;
  }

  // Lines that exist in both (by index) but differ
  const minLen = Math.min(linesA.length, linesB.length);
  for (let i = 0; i < minLen; i++) {
    if (linesA[i] !== linesB[i]) changedCount++;
  }

  const summary: string[] = [];
  summary.push(
    `Lines: ${linesA.length} vs ${linesB.length} (${linesA.length > linesB.length ? '-' : '+'}${Math.abs(linesA.length - linesB.length)})`,
  );
  summary.push(`Changed positions: ~${changedCount} lines differ at same positions`);
  summary.push(`Unique to file A: ~${removedCount} lines`);
  summary.push(`Unique to file B: ~${addedCount} lines`);

  // Character-level size comparison
  const sizeA = textA.length;
  const sizeB = textB.length;
  const sizeDiff = Math.abs(sizeA - sizeB);
  summary.push(`Character count: ${sizeA} vs ${sizeB} (${sizeA > sizeB ? '-' : '+'}${sizeDiff})`);

  return summary.join('\n');
};

// ---------------------------------------------------------------------------
// Schema comparison
// ---------------------------------------------------------------------------

/**
 * Compare structural schemas of two files (JSON keys, CSV columns, etc.).
 */
const compareSchemas = (contentA: string, contentB: string, ext: string): string | null => {
  switch (ext) {
    case 'json':
      return compareJsonSchemas(contentA, contentB);
    case 'csv':
    case 'tsv':
      return compareCsvSchemas(contentA, contentB, ext === 'tsv' ? '\t' : ',');
    default:
      return null;
  }
};

/** Compare JSON structures (top-level keys and types). */
const compareJsonSchemas = (jsonA: string, jsonB: string): string | null => {
  try {
    const objA: unknown = JSON.parse(jsonA);
    const objB: unknown = JSON.parse(jsonB);

    if (typeof objA !== 'object' || typeof objB !== 'object' || !objA || !objB) {
      return null;
    }

    const keysA = new Set(Object.keys(objA as Record<string, unknown>));
    const keysB = new Set(Object.keys(objB as Record<string, unknown>));
    const onlyInA = [...keysA].filter((k) => !keysB.has(k));
    const onlyInB = [...keysB].filter((k) => !keysA.has(k));
    const shared = [...keysA].filter((k) => keysB.has(k));

    const lines: string[] = [];
    lines.push(`Shared keys: ${shared.length}`);
    if (onlyInA.length > 0) lines.push(`Only in file A: ${onlyInA.join(', ')}`);
    if (onlyInB.length > 0) lines.push(`Only in file B: ${onlyInB.join(', ')}`);

    // Compare types of shared keys
    const typeDiffs: string[] = [];
    const recA = objA as Record<string, unknown>;
    const recB = objB as Record<string, unknown>;
    for (const key of shared) {
      const typeA = Array.isArray(recA[key]) ? 'array' : typeof recA[key];
      const typeB = Array.isArray(recB[key]) ? 'array' : typeof recB[key];
      if (typeA !== typeB) {
        typeDiffs.push(`"${key}": ${typeA} vs ${typeB}`);
      }
    }
    if (typeDiffs.length > 0) {
      lines.push(`Type differences: ${typeDiffs.join('; ')}`);
    }

    return lines.join('\n');
  } catch {
    return null;
  }
};

/** Compare CSV column headers. */
const compareCsvSchemas = (csvA: string, csvB: string, delimiter: string): string | null => {
  const headerA =
    csvA
      .split('\n')[0]
      ?.split(delimiter)
      .map((h) => h.trim()) ?? [];
  const headerB =
    csvB
      .split('\n')[0]
      ?.split(delimiter)
      .map((h) => h.trim()) ?? [];

  if (headerA.length === 0 && headerB.length === 0) return null;

  const rowCountA = csvA.split('\n').filter((l) => l.trim()).length - 1;
  const rowCountB = csvB.split('\n').filter((l) => l.trim()).length - 1;

  const setA = new Set(headerA);
  const setB = new Set(headerB);
  const onlyInA = headerA.filter((h) => !setB.has(h));
  const onlyInB = headerB.filter((h) => !setA.has(h));
  const shared = headerA.filter((h) => setB.has(h));

  const lines: string[] = [];
  lines.push(`Columns: ${headerA.length} vs ${headerB.length}`);
  lines.push(`Rows: ${rowCountA} vs ${rowCountB}`);
  lines.push(`Shared columns: ${shared.length}`);
  if (onlyInA.length > 0) lines.push(`Only in file A: ${onlyInA.join(', ')}`);
  if (onlyInB.length > 0) lines.push(`Only in file B: ${onlyInB.join(', ')}`);

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Detect if the user's message is asking to compare files.
 * Used when exactly 2 files are dropped or selected.
 */
export const isCompareIntent = (userText: string, fileCount: number): boolean => {
  if (fileCount !== 2) return false;

  const lower = userText.toLowerCase();
  const compareKeywords = [
    'compare',
    'diff',
    'difference',
    'differences',
    'versus',
    'vs',
    'contrast',
    'what changed',
    "what's different",
    'how do they differ',
    'side by side',
    'side-by-side',
  ];

  return compareKeywords.some((kw) => lower.includes(kw));
};

/**
 * Build a comparison prompt from two file paths.
 */
export const buildComparePrompt = (pathA: string, pathB: string): string =>
  `Compare these two files in detail and tell me the differences:\n1. ${pathA}\n2. ${pathB}\n\nProvide a structured comparison covering: format, structure, content differences, and which file appears to be newer/better if applicable.`;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};
