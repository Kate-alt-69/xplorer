/**
 * AI-Powered Smart File Operations for the chat agent.
 *
 * Provides:
 * 1. Smart rename — detect patterns in filenames and suggest batch renames
 * 2. Duplicate detection — size-first, then partial hash comparison
 * 3. Folder structure suggestion — analyze file types and recommend organization
 *
 * Wired into the AI system prompt and exposed via /duplicates and /rename-pattern
 * slash commands.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import type { FileEntry } from '@/lib/tauri-api-types';
import { basename } from './chat-file-actions';
import { getExt } from './chat-context-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenamePattern {
  /** Human-readable pattern description */
  description: string;
  /** Regex that matches the pattern */
  regex: RegExp;
  /** Number of files matching this pattern */
  matchCount: number;
  /** Example original filename */
  exampleOriginal: string;
  /** Example renamed filename */
  exampleRenamed: string;
  /** Function to transform a filename */
  transform: (filename: string) => string;
}

export interface RenameSuggestion {
  original: string;
  suggested: string;
  path: string;
}

export interface DuplicateGroup {
  /** File size in bytes (shared by all files in the group) */
  size: number;
  /** Hash used for comparison (partial or full) */
  hash: string;
  /** Files in this duplicate group */
  files: Array<{
    name: string;
    path: string;
    modified: number;
  }>;
}

export interface DuplicateReport {
  /** Total duplicate groups found */
  groupCount: number;
  /** Total wasted space in bytes */
  wastedBytes: number;
  /** The duplicate groups */
  groups: DuplicateGroup[];
  /** How long the scan took (ms) */
  scanTimeMs: number;
}

export interface FolderStructureSuggestion {
  /** Suggested folder name */
  folderName: string;
  /** File extensions that belong in this folder */
  extensions: string[];
  /** Number of files that would go into this folder */
  fileCount: number;
  /** Total size of files */
  totalSize: number;
}

export interface FolderAnalysis {
  /** Total files (non-directory) */
  totalFiles: number;
  /** Whether the folder is "messy" (multiple types, no sub-organization) */
  isMessy: boolean;
  /** Suggested folder structure */
  suggestions: FolderStructureSuggestion[];
  /** Human-readable summary */
  summary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum files of a single type to suggest a folder for it */
const MIN_FILES_FOR_FOLDER = 3;

/** Category mappings: extension -> (folder name, category label) */
const EXTENSION_CATEGORIES: Record<string, { folder: string; label: string }> = {
  // Images
  jpg: { folder: 'Images', label: 'images' },
  jpeg: { folder: 'Images', label: 'images' },
  png: { folder: 'Images', label: 'images' },
  gif: { folder: 'Images', label: 'images' },
  webp: { folder: 'Images', label: 'images' },
  svg: { folder: 'Images', label: 'images' },
  bmp: { folder: 'Images', label: 'images' },
  ico: { folder: 'Images', label: 'images' },
  tiff: { folder: 'Images', label: 'images' },
  raw: { folder: 'Images', label: 'images' },
  cr2: { folder: 'Images', label: 'images' },
  nef: { folder: 'Images', label: 'images' },
  // Documents
  pdf: { folder: 'Documents', label: 'PDFs' },
  doc: { folder: 'Documents', label: 'documents' },
  docx: { folder: 'Documents', label: 'documents' },
  xls: { folder: 'Documents', label: 'spreadsheets' },
  xlsx: { folder: 'Documents', label: 'spreadsheets' },
  ppt: { folder: 'Documents', label: 'presentations' },
  pptx: { folder: 'Documents', label: 'presentations' },
  odt: { folder: 'Documents', label: 'documents' },
  ods: { folder: 'Documents', label: 'spreadsheets' },
  odp: { folder: 'Documents', label: 'presentations' },
  txt: { folder: 'Documents', label: 'text files' },
  rtf: { folder: 'Documents', label: 'documents' },
  csv: { folder: 'Documents', label: 'data files' },
  // Code
  js: { folder: 'Code', label: 'code files' },
  ts: { folder: 'Code', label: 'code files' },
  jsx: { folder: 'Code', label: 'code files' },
  tsx: { folder: 'Code', label: 'code files' },
  py: { folder: 'Code', label: 'code files' },
  rs: { folder: 'Code', label: 'code files' },
  go: { folder: 'Code', label: 'code files' },
  java: { folder: 'Code', label: 'code files' },
  c: { folder: 'Code', label: 'code files' },
  cpp: { folder: 'Code', label: 'code files' },
  h: { folder: 'Code', label: 'code files' },
  rb: { folder: 'Code', label: 'code files' },
  php: { folder: 'Code', label: 'code files' },
  swift: { folder: 'Code', label: 'code files' },
  kt: { folder: 'Code', label: 'code files' },
  css: { folder: 'Code', label: 'code files' },
  scss: { folder: 'Code', label: 'code files' },
  html: { folder: 'Code', label: 'code files' },
  // Video
  mp4: { folder: 'Videos', label: 'videos' },
  avi: { folder: 'Videos', label: 'videos' },
  mov: { folder: 'Videos', label: 'videos' },
  mkv: { folder: 'Videos', label: 'videos' },
  wmv: { folder: 'Videos', label: 'videos' },
  flv: { folder: 'Videos', label: 'videos' },
  webm: { folder: 'Videos', label: 'videos' },
  // Audio
  mp3: { folder: 'Audio', label: 'audio files' },
  wav: { folder: 'Audio', label: 'audio files' },
  flac: { folder: 'Audio', label: 'audio files' },
  ogg: { folder: 'Audio', label: 'audio files' },
  aac: { folder: 'Audio', label: 'audio files' },
  wma: { folder: 'Audio', label: 'audio files' },
  m4a: { folder: 'Audio', label: 'audio files' },
  // Archives
  zip: { folder: 'Archives', label: 'archives' },
  tar: { folder: 'Archives', label: 'archives' },
  gz: { folder: 'Archives', label: 'archives' },
  rar: { folder: 'Archives', label: 'archives' },
  '7z': { folder: 'Archives', label: 'archives' },
  bz2: { folder: 'Archives', label: 'archives' },
  xz: { folder: 'Archives', label: 'archives' },
};

// ---------------------------------------------------------------------------
// 1. Smart Rename — Pattern Detection
// ---------------------------------------------------------------------------

/** Known filename patterns and their preferred transformations */
const FILENAME_PATTERNS: Array<{
  name: string;
  description: string;
  regex: RegExp;
  transform: (filename: string) => string;
}> = [
  {
    name: 'camera-timestamp',
    description: 'Camera timestamp (IMG_YYYYMMDD_NNN) -> date-based (YYYY-MM-DD-NNN)',
    regex: /^(IMG|DSC|DSCN|DSCF|P|PANO)_(\d{4})(\d{2})(\d{2})_(\d+)\.([\w]+)$/i,
    transform: (filename: string): string => {
      const m = filename.match(
        /^(IMG|DSC|DSCN|DSCF|P|PANO)_(\d{4})(\d{2})(\d{2})_(\d+)\.([\w]+)$/i,
      );
      if (!m) return filename;
      return `${m[2]}-${m[3]}-${m[4]}-${m[5]}.${m[6].toLowerCase()}`;
    },
  },
  {
    name: 'screenshot-timestamp',
    description: 'Screenshot timestamp (Screenshot YYYY-MM-DD at HH.MM.SS) -> clean format',
    regex: /^Screenshot[\s_]+(\d{4})-(\d{2})-(\d{2})[\s_]+at[\s_]+(\d+)\.(\d+)\.(\d+)\.([\w]+)$/i,
    transform: (filename: string): string => {
      const m = filename.match(
        /^Screenshot[\s_]+(\d{4})-(\d{2})-(\d{2})[\s_]+at[\s_]+(\d+)\.(\d+)\.(\d+)\.([\w]+)$/i,
      );
      if (!m) return filename;
      return `screenshot-${m[1]}-${m[2]}-${m[3]}-${m[4]}${m[5]}${m[6]}.${m[7].toLowerCase()}`;
    },
  },
  {
    name: 'copy-suffix',
    description: 'Remove copy suffix (file (1).txt, file - Copy.txt) -> file.txt',
    regex: /^(.+?)[\s_]*(?:\(\d+\)|-\s*Copy(?:\s*\(\d+\))?)(\.[^.]+)$/i,
    transform: (filename: string): string => {
      const m = filename.match(/^(.+?)[\s_]*(?:\(\d+\)|-\s*Copy(?:\s*\(\d+\))?)(\.[^.]+)$/i);
      if (!m) return filename;
      return `${m[1].trimEnd()}${m[2]}`;
    },
  },
  {
    name: 'spaces-to-dashes',
    description: 'Replace spaces with dashes and lowercase',
    regex: /^[^.]+\s+[^.]+\.\w+$/,
    transform: (filename: string): string => {
      const dotIdx = filename.lastIndexOf('.');
      if (dotIdx <= 0) return filename.toLowerCase().replace(/\s+/g, '-');
      const name = filename.slice(0, dotIdx);
      const ext = filename.slice(dotIdx);
      return `${name.toLowerCase().replace(/\s+/g, '-')}${ext.toLowerCase()}`;
    },
  },
  {
    name: 'whatsapp-media',
    description: 'WhatsApp media (IMG-YYYYMMDD-WAnnnn) -> date-based',
    regex: /^(IMG|VID|AUD|DOC)-(\d{4})(\d{2})(\d{2})-WA(\d+)\.([\w]+)$/i,
    transform: (filename: string): string => {
      const m = filename.match(/^(IMG|VID|AUD|DOC)-(\d{4})(\d{2})(\d{2})-WA(\d+)\.([\w]+)$/i);
      if (!m) return filename;
      const prefix = m[1].toLowerCase() === 'img' ? 'photo' : m[1].toLowerCase();
      return `${prefix}-${m[2]}-${m[3]}-${m[4]}-${m[5]}.${m[6].toLowerCase()}`;
    },
  },
  {
    name: 'sequential-numbering',
    description: 'Pad sequential numbers (file1.txt -> file-001.txt)',
    regex: /^([A-Za-z_-]+?)(\d{1,2})(\.[^.]+)$/,
    transform: (filename: string): string => {
      const m = filename.match(/^([A-Za-z_-]+?)(\d{1,2})(\.[^.]+)$/);
      if (!m) return filename;
      const num = m[2].padStart(3, '0');
      const sep = m[1].endsWith('-') || m[1].endsWith('_') ? '' : '-';
      return `${m[1]}${sep}${num}${m[3]}`;
    },
  },
];

/**
 * Detect rename patterns in a list of filenames.
 * Returns patterns sorted by match count (descending).
 */
export const detectRenamePatterns = (files: FileEntry[]): RenamePattern[] => {
  const nonDirFiles = files.filter((f) => !f.is_dir);
  const patterns: RenamePattern[] = [];

  for (const patDef of FILENAME_PATTERNS) {
    const matches = nonDirFiles.filter((f) => patDef.regex.test(basename(f.path)));
    if (matches.length >= 2) {
      const exampleFile = matches[0];
      const exampleName = basename(exampleFile.path);
      patterns.push({
        description: patDef.description,
        regex: patDef.regex,
        matchCount: matches.length,
        exampleOriginal: exampleName,
        exampleRenamed: patDef.transform(exampleName),
        transform: patDef.transform,
      });
    }
  }

  return patterns.sort((a, b) => b.matchCount - a.matchCount);
};

/**
 * Generate rename suggestions for all files matching a detected pattern.
 */
export const generateRenameSuggestions = (
  files: FileEntry[],
  pattern: RenamePattern,
): RenameSuggestion[] => {
  const nonDirFiles = files.filter((f) => !f.is_dir);
  const suggestions: RenameSuggestion[] = [];

  for (const file of nonDirFiles) {
    const name = basename(file.path);
    if (pattern.regex.test(name)) {
      const newName = pattern.transform(name);
      if (newName !== name) {
        suggestions.push({
          original: name,
          suggested: newName,
          path: file.path,
        });
      }
    }
  }

  return suggestions;
};

/**
 * Build a formatted report of detected rename patterns for display in chat.
 */
export const formatRenamePatternReport = (dirPath: string, patterns: RenamePattern[]): string => {
  if (patterns.length === 0) {
    return `No recognizable filename patterns found in **${dirPath}**. Files appear to already have clean names.`;
  }

  const lines: string[] = [`**Detected Filename Patterns in ${dirPath}**\n`];

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    lines.push(`### Pattern ${i + 1}: ${p.description}`);
    lines.push(`- **Matches:** ${p.matchCount} files`);
    lines.push(`- **Example:** \`${p.exampleOriginal}\` → \`${p.exampleRenamed}\``);
    lines.push('');
  }

  lines.push(
    'Would you like me to rename files using one of these patterns? I can show you the full list of changes before executing.',
  );

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// 2. Duplicate Detection
// ---------------------------------------------------------------------------

/**
 * Find potential duplicates in a directory using size-first comparison,
 * then partial content hash for same-size files.
 *
 * This is a client-side orchestration layer that delegates to TauriAPI
 * for the heavy lifting (hashing is done in Rust).
 */
export const findDuplicatesInDirectory = async (dirPath: string): Promise<DuplicateReport> => {
  const startTime = Date.now();

  try {
    // Use the existing Rust-based duplicate finder for efficiency
    const result = await TauriAPI.findDuplicates(dirPath, 1); // minFileSize=1 byte

    const groups: DuplicateGroup[] = result.duplicate_groups.map((g) => ({
      size: g.size,
      hash: g.hash,
      files: g.files.map((f) => ({
        name: f.name,
        path: f.path,
        modified: f.modified,
      })),
    }));

    // Calculate wasted space: for each group, all but one file is "wasted"
    const wastedBytes = groups.reduce((acc, g) => acc + g.size * (g.files.length - 1), 0);

    return {
      groupCount: groups.length,
      wastedBytes,
      groups,
      scanTimeMs: Date.now() - startTime,
    };
  } catch {
    // Fallback: manual size-based grouping via directory listing
    return await findDuplicatesFallback(dirPath, startTime);
  }
};

/**
 * Fallback duplicate detection using directory listing + size comparison.
 * Less accurate than hash-based but works without the Rust duplicate finder.
 */
const findDuplicatesFallback = async (
  dirPath: string,
  startTime: number,
): Promise<DuplicateReport> => {
  const entries = await TauriAPI.readDirectory(dirPath);
  const files = entries.filter((e) => !e.is_dir && e.size > 0);

  // Group by size first (fast filter)
  const sizeGroups = new Map<number, FileEntry[]>();
  for (const file of files) {
    const group = sizeGroups.get(file.size);
    if (group) {
      group.push(file);
    } else {
      sizeGroups.set(file.size, [file]);
    }
  }

  // Only keep groups with 2+ files of same size
  const candidateGroups = [...sizeGroups.entries()].filter(([, group]) => group.length >= 2);

  const duplicateGroups: DuplicateGroup[] = [];

  // For each size group, compute partial hashes to confirm duplicates
  for (const [size, group] of candidateGroups) {
    const hashMap = new Map<string, Array<{ name: string; path: string; modified: number }>>();

    for (const file of group) {
      try {
        const hash = await TauriAPI.computeFileHash(file.path, 'sha256');
        const existing = hashMap.get(hash);
        if (existing) {
          existing.push({
            name: file.name,
            path: file.path,
            modified: file.modified,
          });
        } else {
          hashMap.set(hash, [{ name: file.name, path: file.path, modified: file.modified }]);
        }
      } catch {
        // Skip files we cannot hash
      }
    }

    for (const [hash, fileList] of hashMap) {
      if (fileList.length >= 2) {
        duplicateGroups.push({ size, hash, files: fileList });
      }
    }
  }

  const wastedBytes = duplicateGroups.reduce((acc, g) => acc + g.size * (g.files.length - 1), 0);

  return {
    groupCount: duplicateGroups.length,
    wastedBytes,
    groups: duplicateGroups,
    scanTimeMs: Date.now() - startTime,
  };
};

/**
 * Format a duplicate report for display in the chat panel.
 */
export const formatDuplicateReport = (dirPath: string, report: DuplicateReport): string => {
  if (report.groupCount === 0) {
    return `**No duplicates found** in ${dirPath}.\nScanned in ${report.scanTimeMs}ms.`;
  }

  const lines: string[] = [
    `**Duplicate Files Found in ${dirPath}**\n`,
    `- **${report.groupCount}** duplicate group${report.groupCount !== 1 ? 's' : ''}`,
    `- **${formatFileSize(report.wastedBytes)}** of wasted space`,
    `- Scan completed in ${report.scanTimeMs}ms\n`,
  ];

  // Show up to 10 groups
  const maxGroups = 10;
  const shownGroups = report.groups.slice(0, maxGroups);

  for (let i = 0; i < shownGroups.length; i++) {
    const g = shownGroups[i];
    lines.push(`**Group ${i + 1}** (${formatFileSize(g.size)} each, ${g.files.length} copies):`);
    for (const f of g.files) {
      lines.push(`  - \`${f.name}\` — ${f.path}`);
    }
    lines.push('');
  }

  if (report.groups.length > maxGroups) {
    lines.push(`... and ${report.groups.length - maxGroups} more duplicate groups.\n`);
  }

  lines.push(
    'Would you like me to remove the duplicates? I will keep the oldest copy and move the rest to trash.',
  );

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// 3. Folder Structure Suggestion
// ---------------------------------------------------------------------------

/**
 * Analyze a directory and suggest folder organization based on file types.
 */
export const analyzeFolderStructure = async (dirPath: string): Promise<FolderAnalysis> => {
  const entries = await TauriAPI.readDirectory(dirPath);
  const files = entries.filter((e) => !e.is_dir);
  const existingDirs = entries.filter((e) => e.is_dir).map((e) => e.name.toLowerCase());

  // Count files per category
  const categoryMap = new Map<string, { extensions: Set<string>; files: FileEntry[] }>();

  for (const file of files) {
    const ext = getExt(file.path);
    const cat = EXTENSION_CATEGORIES[ext];
    if (cat) {
      const existing = categoryMap.get(cat.folder);
      if (existing) {
        existing.extensions.add(ext);
        existing.files.push(file);
      } else {
        categoryMap.set(cat.folder, {
          extensions: new Set([ext]),
          files: [file],
        });
      }
    }
  }

  // Build suggestions, filtering out categories with too few files or
  // where a matching folder already exists
  const suggestions: FolderStructureSuggestion[] = [];
  for (const [folderName, data] of categoryMap) {
    // Skip if folder already exists (case-insensitive)
    if (existingDirs.includes(folderName.toLowerCase())) continue;
    // Skip if too few files
    if (data.files.length < MIN_FILES_FOR_FOLDER) continue;

    const totalSize = data.files.reduce((acc, f) => acc + f.size, 0);
    suggestions.push({
      folderName,
      extensions: [...data.extensions],
      fileCount: data.files.length,
      totalSize,
    });
  }

  // Sort by file count descending
  suggestions.sort((a, b) => b.fileCount - a.fileCount);

  // Determine if the folder is "messy"
  const uniqueExtensions = new Set(files.map((f) => getExt(f.path)));
  const isMessy = files.length >= 10 && uniqueExtensions.size >= 3 && suggestions.length >= 2;

  // Build human-readable summary
  const summary = buildFolderAnalysisSummary(dirPath, files.length, suggestions, isMessy);

  return {
    totalFiles: files.length,
    isMessy,
    suggestions,
    summary,
  };
};

/**
 * Build a readable summary of the folder analysis.
 */
const buildFolderAnalysisSummary = (
  dirPath: string,
  totalFiles: number,
  suggestions: FolderStructureSuggestion[],
  isMessy: boolean,
): string => {
  if (suggestions.length === 0) {
    return `**${dirPath}** looks well-organized already (${totalFiles} files). No folder structure changes needed.`;
  }

  const lines: string[] = [`**Folder Analysis: ${dirPath}**\n`];

  if (isMessy) {
    lines.push(
      `This folder has ${totalFiles} files with mixed types. Here is a suggested organization:\n`,
    );
  } else {
    lines.push(`Found ${totalFiles} files. Some could be better organized:\n`);
  }

  for (const s of suggestions) {
    const extList = s.extensions.map((e) => `.${e}`).join(', ');
    lines.push(
      `- **${s.folderName}/** — ${s.fileCount} files (${extList}, ${formatFileSize(s.totalSize)})`,
    );
  }

  const totalMoved = suggestions.reduce((acc, s) => acc + s.fileCount, 0);
  lines.push(
    `\nThis would organize **${totalMoved}** of ${totalFiles} files into ${suggestions.length} folders.`,
  );
  lines.push(
    '\nWould you like me to create these folders and move the files? I will show you the full plan first.',
  );

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// System prompt snippet
// ---------------------------------------------------------------------------

/**
 * Additional system prompt context describing smart file operations.
 * Injected into the main system prompt by chat-system-prompt.ts.
 */
export const SMART_FILE_OPS_PROMPT = `
## Smart File Operations
You have access to intelligent file operation capabilities:

### Pattern-Based Rename (/rename-pattern)
- Detect naming patterns in the current folder (camera timestamps, screenshot names, copy suffixes, WhatsApp media, etc.)
- Suggest batch renames to clean, consistent naming conventions
- Example: IMG_20240101_001.jpg -> 2024-01-01-001.jpg
- Always show the full rename plan before executing

### Duplicate Detection (/duplicates)
- Scan the current directory for duplicate files
- Uses file size comparison first (fast), then content hash for same-size files
- Reports wasted space and offers to clean up (keeping oldest copy, trashing the rest)

### Folder Organization
- Analyze file types in a messy folder and suggest structure
- Categories: Images/, Documents/, Code/, Videos/, Audio/, Archives/
- Only suggest folders when there are 3+ files of that type
- Show the plan before moving anything

When the user asks about organizing, renaming, or cleaning up files, use these capabilities proactively.
`.trim();
