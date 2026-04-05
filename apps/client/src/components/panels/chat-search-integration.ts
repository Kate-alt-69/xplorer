/**
 * AI Search Integration for the chat agent.
 *
 * Connects the AI chat to the existing search infrastructure:
 * - BM25F token search (indexed, fast)
 * - Content search via grepSearch / searchInFiles
 * - Natural language search
 * - Semantic search (when AI index is available)
 *
 * Exposed via the /find slash command and the search_index agent action.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { getXplorerState } from './chat-context-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResultEntry {
  /** File path */
  path: string;
  /** File name */
  name: string;
  /** Relevance score (0-1, higher is better) */
  score: number;
  /** Matched content snippet (for content search) */
  snippet?: string;
  /** Line number of the match (for content search) */
  lineNumber?: number;
  /** How the result was found */
  source: 'token' | 'grep' | 'natural_language' | 'semantic' | 'filename';
}

export interface AISearchReport {
  /** The original query */
  query: string;
  /** Directory searched */
  searchPath: string;
  /** Combined, deduplicated results sorted by relevance */
  results: SearchResultEntry[];
  /** Total results before deduplication */
  totalRawResults: number;
  /** How long the search took (ms) */
  searchTimeMs: number;
  /** Which search methods were used */
  methodsUsed: string[];
  /** Any errors encountered during search */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max results to return from each search method */
const MAX_RESULTS_PER_METHOD = 20;

/** Max total results after merging */
const MAX_TOTAL_RESULTS = 30;

/** Max snippet length for display */
const MAX_SNIPPET_LENGTH = 120;

// ---------------------------------------------------------------------------
// Core search functions
// ---------------------------------------------------------------------------

/**
 * Perform an AI-enhanced search that combines multiple search strategies.
 * Tries filename search, content search (grep), and token/NL search in parallel.
 */
export const performAISearch = async (
  query: string,
  searchPath?: string,
): Promise<AISearchReport> => {
  const startTime = Date.now();
  const xState = getXplorerState();
  const effectivePath = searchPath ?? xState?.currentPath ?? '/';

  const results: SearchResultEntry[] = [];
  const methodsUsed: string[] = [];
  const errors: string[] = [];

  // Run searches in parallel for speed
  const searchPromises: Array<Promise<void>> = [];

  // 1. Filename search (fast glob-based)
  searchPromises.push(
    (async () => {
      try {
        const fileResults = await TauriAPI.findFiles(`*${query}*`, effectivePath);
        methodsUsed.push('filename');
        for (let i = 0; i < Math.min(fileResults.length, MAX_RESULTS_PER_METHOD); i++) {
          const filePath = fileResults[i];
          const name = filePath.split(/[/\\]/).pop() ?? filePath;
          results.push({
            path: filePath,
            name,
            score: 0.8 - i * 0.02, // Decrease score by position
            source: 'filename',
          });
        }
      } catch (err) {
        errors.push(`Filename search: ${err instanceof Error ? err.message : String(err)}`);
      }
    })(),
  );

  // 2. Content search (grep-based, searches inside files)
  searchPromises.push(
    (async () => {
      try {
        const grepResults = await TauriAPI.grepSearch(query, effectivePath, MAX_RESULTS_PER_METHOD);
        methodsUsed.push('grep');
        for (let i = 0; i < grepResults.length; i++) {
          const r = grepResults[i];
          const snippet = truncateSnippet(r.content);
          results.push({
            path: r.file,
            name: r.filename,
            score: 0.9 - i * 0.02, // Content matches scored higher
            snippet,
            lineNumber: r.line,
            source: 'grep',
          });
        }
      } catch (err) {
        errors.push(`Content search: ${err instanceof Error ? err.message : String(err)}`);
      }
    })(),
  );

  // 3. Token-based BM25F search (if index is available)
  searchPromises.push(
    (async () => {
      try {
        const tokenResults = await TauriAPI.searchTokens(query, MAX_RESULTS_PER_METHOD);
        if (tokenResults.length > 0) {
          methodsUsed.push('token');
          for (const r of tokenResults) {
            results.push({
              path: r.path,
              name: r.path.split(/[/\\]/).pop() ?? r.path,
              score: r.score ?? 0.7,
              snippet: r.snippet ?? undefined,
              source: 'token',
            });
          }
        }
      } catch {
        // Token index may not be available — this is fine, not an error
      }
    })(),
  );

  // 4. Natural language search (if available)
  searchPromises.push(
    (async () => {
      try {
        const nlResults = await TauriAPI.naturalLanguageSearch(
          query,
          undefined,
          MAX_RESULTS_PER_METHOD,
        );
        if (nlResults.length > 0) {
          methodsUsed.push('natural_language');
          for (const r of nlResults) {
            results.push({
              path: r.path,
              name: r.path.split(/[/\\]/).pop() ?? r.path,
              score: r.score ?? 0.75,
              snippet: r.snippet ?? undefined,
              source: 'natural_language',
            });
          }
        }
      } catch {
        // NL search may not be available
      }
    })(),
  );

  await Promise.allSettled(searchPromises);

  // Deduplicate by file path, keeping highest-scored entry
  const deduped = deduplicateResults(results);

  // Sort by score descending
  deduped.sort((a, b) => b.score - a.score);

  // Limit total results
  const finalResults = deduped.slice(0, MAX_TOTAL_RESULTS);

  return {
    query,
    searchPath: effectivePath,
    results: finalResults,
    totalRawResults: results.length,
    searchTimeMs: Date.now() - startTime,
    methodsUsed,
    errors,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicate search results by file path.
 * For entries with the same path, keep the one with the highest score,
 * but merge snippets and line numbers from content searches.
 */
const deduplicateResults = (results: SearchResultEntry[]): SearchResultEntry[] => {
  const byPath = new Map<string, SearchResultEntry>();

  for (const r of results) {
    const existing = byPath.get(r.path);
    if (!existing) {
      byPath.set(r.path, { ...r });
    } else {
      // Keep higher score
      if (r.score > existing.score) {
        existing.score = r.score;
        existing.source = r.source;
      }
      // Prefer snippet from content search
      if (r.snippet && !existing.snippet) {
        existing.snippet = r.snippet;
        existing.lineNumber = r.lineNumber;
      }
    }
  }

  return [...byPath.values()];
};

/**
 * Truncate a content snippet for display.
 */
const truncateSnippet = (content: string): string => {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_SNIPPET_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_SNIPPET_LENGTH)}...`;
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format search results for display in the chat panel.
 */
export const formatSearchReport = (report: AISearchReport): string => {
  const lines: string[] = [];

  if (report.results.length === 0) {
    lines.push(`**No results found** for "${report.query}" in ${report.searchPath}.`);
    if (report.errors.length > 0) {
      lines.push('\nSearch errors:');
      for (const err of report.errors) {
        lines.push(`- ${err}`);
      }
    }
    return lines.join('\n');
  }

  lines.push(
    `**Search Results for "${report.query}"** (${report.results.length} results in ${report.searchTimeMs}ms)\n`,
  );
  lines.push(`Searched: ${report.searchPath}`);
  lines.push(`Methods: ${report.methodsUsed.join(', ')}\n`);

  // Group results: content matches first, then filename-only matches
  const contentResults = report.results.filter((r) => r.snippet);
  const filenameResults = report.results.filter((r) => !r.snippet);

  if (contentResults.length > 0) {
    lines.push('**Content matches:**');
    for (const r of contentResults.slice(0, 15)) {
      const lineInfo = r.lineNumber ? `:${r.lineNumber}` : '';
      lines.push(`- \`${r.name}\`${lineInfo} — ${r.snippet}`);
      lines.push(`  ${r.path}`);
    }
    if (contentResults.length > 15) {
      lines.push(`  ... and ${contentResults.length - 15} more content matches`);
    }
    lines.push('');
  }

  if (filenameResults.length > 0) {
    lines.push('**Filename matches:**');
    for (const r of filenameResults.slice(0, 15)) {
      lines.push(`- \`${r.name}\` — ${r.path}`);
    }
    if (filenameResults.length > 15) {
      lines.push(`  ... and ${filenameResults.length - 15} more filename matches`);
    }
    lines.push('');
  }

  lines.push('Would you like me to open any of these files or search for something else?');

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// System prompt snippet
// ---------------------------------------------------------------------------

/**
 * Additional system prompt context for AI search capabilities.
 */
export const AI_SEARCH_PROMPT = `
## AI Search Capabilities
You can search for files and content using multiple strategies:

### /find [query]
Performs a combined search across:
- **Filename matching** — finds files whose names contain the query
- **Content search (grep)** — searches inside file contents for the query text
- **Token index (BM25F)** — uses the indexed search for fast, ranked results
- **Natural language search** — understands queries like "files modified last week" or "large images"

When the user asks to find or search for something, use the search_files action with a descriptive query. For content-level searches, prefer grep-style queries. For filename searches, use glob patterns with search_files.

You can combine search with file operations — for example, "find all TODO comments and list the files" or "find duplicate configs across the project".
`.trim();
