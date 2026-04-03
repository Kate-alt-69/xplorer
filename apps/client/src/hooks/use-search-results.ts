import { useState, useRef, useEffect, useCallback } from 'react';
import { TauriAPI, type SearchResult, type FileEntry } from '@/lib/tauri-api';
import { SEARCH_DEBOUNCE_MS } from '@/lib/constants';

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
        const response = await TauriAPI.smartSearch(trimmed, basePath, 50);

        if (!signal.aborted) {
          setAiResults(response.results);
          setAiParsedInfo(response.explanation ?? null);
          setMatchedItems(response.matched_items);
          setProvider(response.provider);
          setSearchTermsUsed(response.search_terms_used);
          setIsAiSearching(false);
        }
      } catch (err: unknown) {
        if (!signal.aborted) {
          console.error('AI search error:', err);
          setAiResults([]);
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
      // Navigate to parent directory and select file
      const sep = result.path.includes('/') ? '/' : '\\';
      const parts = result.path.split(sep);
      parts.pop();
      const parentDir = parts.join(sep);
      const hasExt = result.filename.includes('.') && !result.filename.startsWith('.');

      navigateToPath(parentDir || basePath);

      // Create a synthetic FileEntry for selection
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
