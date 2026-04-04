import { useState, useRef, useEffect, useCallback } from 'react';
import { TauriAPI, type SearchResult, type FileEntry } from '@/lib/tauri-api';
import { SEARCH_DEBOUNCE_MS } from '@/lib/constants';

/** Emit a message to the Activity Log */
const logOutput = (msg: string) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('xplorer-output', { detail: msg }));
  }
};

// ── Hook ────────────────────────────────────────────────────────────────────

export const useAiSearch = (basePath: string) => {
  const [aiQuery, setAiQuery] = useState('');
  const [aiResults, setAiResults] = useState<SearchResult[]>([]);
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [aiParsedInfo, setAiParsedInfo] = useState<string | null>(null);
  const [matchedItems, setMatchedItems] = useState<string[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [searchTermsUsed, setSearchTermsUsed] = useState<string[]>([]);
  const aiAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    aiAbortRef.current.aborted = true;

    const trimmed = aiQuery.trim();
    if (!trimmed) {
      setAiResults([]);
      setIsAiSearching(false);
      setAiParsedInfo(null);
      setMatchedItems([]);
      setProvider('');
      setSearchTermsUsed([]);
      return;
    }

    setIsAiSearching(true);

    aiDebounceRef.current = setTimeout(async () => {
      const signal = { aborted: false };
      aiAbortRef.current = signal;

      try {
        // Phase 1: Show fast BM25F results immediately
        logOutput(`[INFO] AI Search: "${trimmed}" — fetching instant results...`);
        setAiParsedInfo('Searching...');

        try {
          const fastResults = await TauriAPI.enhancedSearch(trimmed, undefined, 50);
          if (!signal.aborted && fastResults.results.length > 0) {
            setAiResults(fastResults.results);
            setProvider('text');
            const pq = fastResults.parsed_query;
            if (pq) {
              const parts: string[] = [];
              if (pq.file_type_filter) parts.push(`type: ${pq.file_type_filter}`);
              if (pq.sort_hint) parts.push(`sort: ${pq.sort_hint}`);
              if (pq.keywords?.length) parts.push(`"${pq.keywords.join(' ')}"`);
              setAiParsedInfo(parts.length > 0 ? parts.join(' | ') : 'Text search');
            }
            logOutput(`[INFO] AI Search: ${fastResults.results.length} instant results`);
          }
        } catch {
          // BM25F unavailable — skip fast phase
        }

        // Phase 2: Call AI for smart results (runs in parallel feel)
        if (!signal.aborted) {
          setAiParsedInfo((prev) => (prev ? `${prev} — waiting for AI...` : 'Waiting for AI...'));
          logOutput('[INFO] AI Search: querying LLM for smart interpretation...');

          const response = await TauriAPI.smartSearch(trimmed, basePath, 50);

          if (!signal.aborted) {
            setAiResults(response.results);
            setAiParsedInfo(response.explanation ?? null);
            setMatchedItems(response.matched_items);
            setProvider(response.provider);
            setSearchTermsUsed(response.search_terms_used);
            setIsAiSearching(false);
            logOutput(
              `[INFO] AI Search: ${response.results.length} results via ${response.provider}${
                response.search_terms_used.length > 0
                  ? ` (terms: ${response.search_terms_used.join(', ')})`
                  : ''
              }`,
            );
          }
        }
      } catch (err: unknown) {
        if (!signal.aborted) {
          const msg = err instanceof Error ? err.message : String(err);
          logOutput(`[WARN] AI Search failed: ${msg}`);
          setAiParsedInfo(null);
          setMatchedItems([]);
          setProvider('fallback');
          setSearchTermsUsed([]);
          setIsAiSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
      aiAbortRef.current.aborted = true;
    };
  }, [aiQuery, basePath]);

  const handleAiResultSelect = useCallback(
    (
      result: SearchResult,
      navigateToPath: (path: string) => void,
      onFileSelect: (file: FileEntry) => void,
    ) => {
      const sep = result.path.includes('/') ? '/' : '\\';
      const parts = result.path.split(sep);
      parts.pop();
      const parentDir = parts.join(sep);
      const hasExt = result.filename.includes('.') && !result.filename.startsWith('.');

      navigateToPath(parentDir || basePath);

      const syntheticFile: FileEntry = {
        name: result.filename,
        path: result.path,
        size: 0,
        modified: 0,
        is_dir: !hasExt,
        file_type: hasExt ? result.filename.split('.').pop() || '' : 'folder',
        is_readonly: false,
      };
      onFileSelect(syntheticFile);
    },
    [basePath],
  );

  const clearAiSearch = useCallback(() => {
    setAiQuery('');
    setAiResults([]);
    setIsAiSearching(false);
    setAiParsedInfo(null);
    setMatchedItems([]);
    setProvider('');
    setSearchTermsUsed([]);
  }, []);

  return {
    aiQuery,
    setAiQuery,
    aiResults,
    isAiSearching,
    aiParsedInfo,
    matchedItems,
    provider,
    searchTermsUsed,
    handleAiResultSelect,
    clearAiSearch,
  };
};
