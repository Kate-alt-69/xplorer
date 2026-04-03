import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// Auto-trigger content search when local filename search returns nothing
const AutoContentSearch = ({ trigger }: { trigger: () => void }) => {
  const calledRef = useRef(false);
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      trigger();
    }
  }, [trigger]);
  return null;
};
import {
  useLiveSearch,
  type SearchFilterType,
  type LiveSearchResult,
} from '@/hooks/use-live-search';
import type { FileEntry, SearchResult, GrepSearchMatch } from '@/lib/tauri-api';
import { useAiSearch } from '@/hooks/use-search-results';
import { ResultRow, AIResultRow, GroupHeader, Spinner } from './search-results/SearchResultItem';

// ── Types ────────────────────────────────────────────────────────────────────

export type SearchMode = 'local' | 'ai';

interface SearchResultsPanelProps {
  basePath: string;
  navigateToPath: (path: string) => void;
  onFileSelect: (file: FileEntry) => void;
  onFileOpen?: (file: FileEntry) => void;
  width?: number;
}

export interface SearchResultsPanelHandle {
  focus: () => void;
}

// ── Filter chips ─────────────────────────────────────────────────────────────

const FILTERS: { key: SearchFilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'files', label: 'Files' },
  { key: 'folders', label: 'Folders' },
  { key: 'documents', label: 'Documents' },
  { key: 'images', label: 'Images' },
  { key: 'code', label: 'Code' },
];

// ── Main component ───────────────────────────────────────────────────────────

const SearchResultsPanel = React.forwardRef<SearchResultsPanelHandle, SearchResultsPanelProps>(
  function SearchResultsPanel({ basePath, navigateToPath, onFileSelect, onFileOpen, width }, ref) {
    const [searchMode, setSearchMode] = useState<SearchMode>('local');

    // ── Local search ────────────────────────────────────────────────────────
    const {
      query: localQuery,
      setQuery: setLocalQuery,
      groupedResults,
      isSearching: isLocalSearching,
      resultCount: localResultCount,
      totalResultCount: localTotalResultCount,
      folderCount,
      activeFilter,
      setActiveFilter,
      hasMore,
      showMore,
      clearSearch: clearLocalSearch,
      contentResults,
      isContentSearching,
      contentSearchTriggered,
      triggerContentSearch,
    } = useLiveSearch(basePath);

    // ── AI search ───────────────────────────────────────────────────────────
    const {
      aiQuery,
      setAiQuery,
      aiResults,
      isAiSearching,
      aiParsedInfo,
      handleAiResultSelect,
      clearAiSearch,
    } = useAiSearch(basePath);

    const inputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Expose focus method via ref
    React.useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
      },
    }));

    // Unified query getter/setter based on mode
    const query = searchMode === 'local' ? localQuery : aiQuery;
    const setQuery = searchMode === 'local' ? setLocalQuery : setAiQuery;
    const isSearching = searchMode === 'local' ? isLocalSearching : isAiSearching;

    // Build a flat list of renderable items for virtualization (local mode):
    type FlatItem =
      | { type: 'group-header'; parentDir: string }
      | { type: 'result'; item: LiveSearchResult };

    const flatItems: FlatItem[] = useMemo(() => {
      const items: FlatItem[] = [];
      for (const group of groupedResults) {
        items.push({ type: 'group-header', parentDir: group.parentDir });
        for (const item of group.items) {
          items.push({ type: 'result', item });
        }
      }
      return items;
    }, [groupedResults]);

    // Virtualizer (local mode only)
    const virtualizer = useVirtualizer({
      count: searchMode === 'local' ? flatItems.length + (hasMore ? 1 : 0) : 0,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: (index: number) => {
        if (index >= flatItems.length) return 32;
        const item = flatItems[index];
        return item.type === 'group-header' ? 28 : 26;
      },
      overscan: 10,
    });

    // Focus input on mount
    useEffect(() => {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }, []);

    // Handle navigating to a file's parent and selecting it (local mode)
    const handleNavigateToResult = useCallback(
      (parentDir: string, file: FileEntry) => {
        navigateToPath(parentDir);
        onFileSelect(file);
      },
      [navigateToPath, onFileSelect],
    );

    // Handle double-click to open file
    const handleDoubleClickResult = useCallback(
      (file: FileEntry) => {
        if (onFileOpen) {
          onFileOpen(file);
        }
      },
      [onFileOpen],
    );

    // Handle AI result selection
    const onAiResultSelect = useCallback(
      (result: SearchResult) => {
        handleAiResultSelect(result, navigateToPath, onFileSelect);
      },
      [handleAiResultSelect, navigateToPath, onFileSelect],
    );

    // Clear search for current mode
    const clearSearch = useCallback(() => {
      if (searchMode === 'local') {
        clearLocalSearch();
      } else {
        clearAiSearch();
      }
    }, [searchMode, clearLocalSearch, clearAiSearch]);

    // Keyboard navigation
    const handleInputKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (searchMode === 'local') {
            for (const flatItem of flatItems) {
              if (flatItem.type === 'result') {
                handleNavigateToResult(flatItem.item.parentDir, flatItem.item.file);
                break;
              }
            }
          } else if (aiResults.length > 0) {
            onAiResultSelect(aiResults[0]);
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const firstResultEl = scrollContainerRef.current?.querySelector(
            '[role="option"]',
          ) as HTMLElement;
          if (firstResultEl) {
            firstResultEl.focus();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          clearSearch();
        }
      },
      [searchMode, flatItems, aiResults, handleNavigateToResult, onAiResultSelect, clearSearch],
    );

    const noQuery = !query.trim();
    const resultCount = searchMode === 'local' ? localResultCount : aiResults.length;
    const noResults = !noQuery && !isSearching && resultCount === 0;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: width ?? '100%',
          overflow: 'hidden',
        }}
      >
        {/* Search mode toggle */}
        <SearchModeToggle searchMode={searchMode} setSearchMode={setSearchMode} />

        {/* Search input */}
        <SearchInput
          searchMode={searchMode}
          query={query}
          setQuery={setQuery}
          isSearching={isSearching}
          onKeyDown={handleInputKeyDown}
          onClear={clearSearch}
          inputRef={inputRef}
        />

        {/* Filter chips (local mode only) */}
        {searchMode === 'local' && (
          <div
            style={{
              display: 'flex',
              gap: '4px',
              padding: '6px 8px',
              borderBottom: '1px solid var(--xp-border)',
              flexWrap: 'wrap',
            }}
          >
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                style={{
                  padding: '2px 8px',
                  fontSize: '10px',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: activeFilter === key ? 'var(--xp-blue)' : 'var(--xp-border)',
                  background:
                    activeFilter === key
                      ? 'rgba(var(--xp-blue-rgb, 99, 102, 241), 0.15)'
                      : 'transparent',
                  color: activeFilter === key ? 'var(--xp-blue)' : 'var(--xp-text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontWeight: activeFilter === key ? 600 : 400,
                  lineHeight: '18px',
                }}
                aria-pressed={activeFilter === key}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* AI search info */}
        {searchMode === 'ai' && !noQuery && (
          <SearchStatusBar isSearching={isAiSearching} noResults={noResults} query={query}>
            {isAiSearching ? (
              <>
                <Spinner />
                <span>Searching with AI...</span>
              </>
            ) : noResults ? (
              <span>No results for &apos;{query}&apos;</span>
            ) : aiResults.length > 0 ? (
              <span>
                {aiResults.length} result{aiResults.length !== 1 ? 's' : ''}
                {aiParsedInfo && (
                  <span style={{ marginLeft: '4px', opacity: 0.7 }}>({aiParsedInfo})</span>
                )}
              </span>
            ) : null}
          </SearchStatusBar>
        )}

        {/* Result count / status (local mode) */}
        {searchMode === 'local' && !noQuery && (
          <SearchStatusBar
            isSearching={isLocalSearching || isContentSearching}
            noResults={noResults && !contentSearchTriggered}
            query={query}
          >
            {isLocalSearching ? (
              <>
                <Spinner />
                <span>Searching...</span>
              </>
            ) : isContentSearching ? (
              <>
                <Spinner />
                <span>Searching file contents...</span>
              </>
            ) : contentSearchTriggered && contentResults.length > 0 ? (
              <span>
                Found {contentResults.length} content match{contentResults.length !== 1 ? 'es' : ''}
              </span>
            ) : noResults && !contentSearchTriggered ? (
              <span>No files matching &apos;{query}&apos;</span>
            ) : localResultCount > 0 ? (
              <span>
                Found {localResultCount} file{localResultCount !== 1 ? 's' : ''} in {folderCount}{' '}
                folder
                {folderCount !== 1 ? 's' : ''}
                {localTotalResultCount > localResultCount && <> ({localTotalResultCount} total)</>}
              </span>
            ) : (
              <span>No results for &apos;{query}&apos;</span>
            )}
          </SearchStatusBar>
        )}

        {/* Results list */}
        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflow: 'auto',
            minHeight: 0,
          }}
          role="listbox"
          aria-label="Search results"
        >
          {noQuery ? (
            <EmptyState searchMode={searchMode} />
          ) : isSearching && resultCount === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px 16px',
                gap: '8px',
                color: 'var(--xp-text-muted)',
              }}
            >
              <Spinner />
              <span style={{ fontSize: '12px' }}>
                {searchMode === 'ai' ? 'Searching with AI...' : 'Searching...'}
              </span>
            </div>
          ) : noResults && searchMode === 'local' && !contentSearchTriggered ? (
            <AutoContentSearch trigger={triggerContentSearch} />
          ) : noResults && (searchMode === 'ai' || contentSearchTriggered) ? (
            <NoResultsState
              query={query}
              searchMode={searchMode}
              onSwitchToAi={() => {
                setSearchMode('ai');
                setAiQuery(localQuery);
              }}
            />
          ) : searchMode === 'ai' ? (
            <div>
              {aiResults.map((result) => (
                <AIResultRow
                  key={result.path}
                  result={result}
                  query={aiQuery}
                  onSelect={onAiResultSelect}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const index = virtualRow.index;

                if (index >= flatItems.length) {
                  return (
                    <div
                      key="show-more"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <button
                        onClick={showMore}
                        style={{
                          background: 'none',
                          border: '1px solid var(--xp-border)',
                          borderRadius: '4px',
                          padding: '4px 12px',
                          fontSize: '11px',
                          color: 'var(--xp-blue)',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        className="hover:bg-xp-surface-light"
                      >
                        Show more... ({localTotalResultCount - localResultCount} remaining)
                      </button>
                    </div>
                  );
                }

                const flatItem = flatItems[index];

                if (flatItem.type === 'group-header') {
                  return (
                    <div
                      key={`header-${flatItem.parentDir}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <GroupHeader parentDir={flatItem.parentDir} basePath={basePath} />
                    </div>
                  );
                }

                return (
                  <div
                    key={flatItem.item.file.path}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <ResultRow
                      item={flatItem.item}
                      query={localQuery}
                      onNavigate={handleNavigateToResult}
                      onDoubleClick={handleDoubleClickResult}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Content search results (grep fallback) */}
          {searchMode === 'local' &&
            contentSearchTriggered &&
            !isContentSearching &&
            contentResults.length > 0 && (
              <ContentSearchResults
                results={contentResults}
                query={localQuery}
                onFileSelect={(filePath) => {
                  const sep = filePath.includes('/') ? '/' : '\\';
                  const parts = filePath.split(sep);
                  const name = parts.pop() || '';
                  const parentDir = parts.join(sep);
                  const ext = name.split('.').pop()?.toLowerCase() || '';
                  const entry: FileEntry = {
                    name,
                    path: filePath,
                    is_dir: false,
                    size: 0,
                    modified: 0,
                    file_type: ext,
                    is_readonly: false,
                  };
                  navigateToPath(parentDir);
                  onFileSelect(entry);
                }}
              />
            )}

          {/* Content search: searching spinner */}
          {searchMode === 'local' && isContentSearching && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px 16px',
                gap: '8px',
                color: 'var(--xp-text-muted)',
              }}
            >
              <Spinner />
              <span style={{ fontSize: '12px' }}>Searching file contents...</span>
            </div>
          )}

          {/* Content search: no results after search */}
          {searchMode === 'local' &&
            contentSearchTriggered &&
            !isContentSearching &&
            contentResults.length === 0 &&
            localResultCount === 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '24px 16px',
                  gap: '4px',
                  color: 'var(--xp-text-muted)',
                }}
              >
                <span style={{ fontSize: '12px' }}>
                  No content matches for &apos;{localQuery}&apos;
                </span>
                <span style={{ fontSize: '11px', opacity: 0.7 }}>
                  Try a shorter or different search term
                </span>
              </div>
            )}
        </div>
      </div>
    );
  },
);

export default React.memo(SearchResultsPanel);

// ── Sub-components ─────────────────────────────────────────────────────────────

const SearchModeToggle = ({
  searchMode,
  setSearchMode,
}: {
  searchMode: SearchMode;
  setSearchMode: (m: SearchMode) => void;
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      padding: '6px 8px',
      borderBottom: '1px solid var(--xp-border)',
      gap: '4px',
    }}
  >
    <button
      onClick={() => setSearchMode('local')}
      style={{
        flex: 1,
        padding: '3px 0',
        fontSize: '10px',
        fontWeight: searchMode === 'local' ? 600 : 400,
        borderRadius: '4px',
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s',
        background: searchMode === 'local' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
        color: searchMode === 'local' ? 'var(--xp-blue)' : 'var(--xp-text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
      }}
      aria-pressed={searchMode === 'local'}
      title="Search files by name in the current directory tree"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      Local
    </button>
    <button
      onClick={() => setSearchMode('ai')}
      style={{
        flex: 1,
        padding: '3px 0',
        fontSize: '10px',
        fontWeight: searchMode === 'ai' ? 600 : 400,
        borderRadius: '4px',
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s',
        background: searchMode === 'ai' ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
        color: searchMode === 'ai' ? '#a855f7' : 'var(--xp-text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
      }}
      aria-pressed={searchMode === 'ai'}
      title="AI-powered search: natural language queries, content search, semantic matching"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        <path d="M5 3v4" />
        <path d="M19 17v4" />
        <path d="M3 5h4" />
        <path d="M17 19h4" />
      </svg>
      AI Search
    </button>
  </div>
);

const SearchInput = ({
  searchMode,
  query,
  setQuery,
  isSearching,
  onKeyDown,
  onClear,
  inputRef,
}: {
  searchMode: SearchMode;
  query: string;
  setQuery: (q: string) => void;
  isSearching: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) => (
  <div style={{ padding: '8px', borderBottom: '1px solid var(--xp-border)' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--xp-surface-light)',
        borderRadius: '6px',
        padding: '0 8px',
        gap: '6px',
        border: `1px solid ${searchMode === 'ai' ? 'rgba(168, 85, 247, 0.3)' : 'var(--xp-border)'}`,
      }}
    >
      {searchMode === 'local' ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--xp-text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#a855f7"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      )}
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          searchMode === 'local' ? 'Search files and folders...' : 'Natural language search...'
        }
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: '6px 0',
          fontSize: '12px',
          color: 'var(--xp-text)',
          lineHeight: '18px',
        }}
        aria-label={searchMode === 'local' ? 'Search files and folders' : 'AI search'}
      />
      {isSearching && <Spinner />}
      {query && (
        <button
          onClick={onClear}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--xp-text-muted)',
            borderRadius: '3px',
            transition: 'color 0.15s',
          }}
          className="hover:text-xp-text"
          aria-label="Clear search"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  </div>
);

const SearchStatusBar = ({
  children,
}: {
  children: React.ReactNode;
  isSearching?: boolean;
  noResults?: boolean;
  query?: string;
}) => (
  <div
    style={{
      padding: '4px 8px',
      fontSize: '10px',
      color: 'var(--xp-text-muted)',
      borderBottom: '1px solid var(--xp-border)',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    }}
  >
    {children}
  </div>
);

const EmptyState = ({ searchMode }: { searchMode: SearchMode }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      gap: '12px',
      color: 'var(--xp-text-muted)',
    }}
  >
    {searchMode === 'local' ? (
      <>
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.4 }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span style={{ fontSize: '12px', textAlign: 'center' }}>
          Type to search files and folders
        </span>
        <span style={{ fontSize: '10px', opacity: 0.7, textAlign: 'center' }}>
          Ctrl+Shift+F to toggle this panel
        </span>
      </>
    ) : (
      <>
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.4 }}
        >
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          <path d="M5 3v4" />
          <path d="M19 17v4" />
          <path d="M3 5h4" />
          <path d="M17 19h4" />
        </svg>
        <span style={{ fontSize: '12px', textAlign: 'center' }}>AI-powered search</span>
        <span
          style={{
            fontSize: '10px',
            opacity: 0.7,
            textAlign: 'center',
            maxWidth: '200px',
          }}
        >
          Try natural language like &quot;large images from last week&quot; or &quot;recently
          modified code files&quot;
        </span>
      </>
    )}
  </div>
);

const NoResultsState = ({
  query,
  searchMode,
  onSwitchToAi,
  onSearchContents,
  isContentSearching,
}: {
  query: string;
  searchMode: SearchMode;
  onSwitchToAi: () => void;
  onSearchContents?: () => void;
  isContentSearching?: boolean;
}) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      gap: '8px',
      color: 'var(--xp-text-muted)',
    }}
  >
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: 0.4 }}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
    <span style={{ fontSize: '12px', textAlign: 'center' }}>
      No files matching &apos;{query}&apos;
    </span>
    {searchMode === 'local' && onSearchContents && (
      <button
        onClick={onSearchContents}
        disabled={isContentSearching}
        style={{
          marginTop: '4px',
          fontSize: '11px',
          color: 'var(--xp-blue)',
          background: 'none',
          border: '1px solid var(--xp-border)',
          borderRadius: '4px',
          padding: '4px 12px',
          cursor: isContentSearching ? 'wait' : 'pointer',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        {isContentSearching ? (
          <>
            <Spinner />
            Searching contents...
          </>
        ) : (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Search in file contents
          </>
        )}
      </button>
    )}
    {searchMode === 'local' && (
      <button
        onClick={onSwitchToAi}
        style={{
          marginTop: '4px',
          fontSize: '11px',
          color: '#a855f7',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          transition: 'opacity 0.15s',
        }}
      >
        Try AI search instead
      </button>
    )}
  </div>
);

const ContentSearchResults = ({
  results,
  query,
  onFileSelect,
}: {
  results: GrepSearchMatch[];
  query: string;
  onFileSelect: (filePath: string) => void;
}) => {
  // Group results by file
  const grouped = useMemo(() => {
    const groups = new Map<string, GrepSearchMatch[]>();
    for (const match of results) {
      const existing = groups.get(match.file);
      if (existing) {
        existing.push(match);
      } else {
        groups.set(match.file, [match]);
      }
    }
    return Array.from(groups.entries());
  }, [results]);

  const queryLower = query.toLowerCase();

  const highlightContent = (text: string): React.ReactNode => {
    if (!queryLower) return text;
    const escaped = queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      part.toLowerCase() === queryLower ? (
        <mark
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={{
            backgroundColor: 'rgba(250, 204, 21, 0.3)',
            color: 'inherit',
            borderRadius: '2px',
            padding: '0 1px',
          }}
        >
          {part}
        </mark>
      ) : (
        // eslint-disable-next-line react/no-array-index-key
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    );
  };

  return (
    <div style={{ borderTop: '1px solid var(--xp-border)' }}>
      <div
        style={{
          padding: '6px 8px',
          fontSize: '10px',
          fontWeight: 600,
          color: 'var(--xp-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          borderBottom: '1px solid var(--xp-border)',
          background: 'rgba(99, 102, 241, 0.05)',
        }}
      >
        Content matches ({results.length})
      </div>
      {grouped.map(([filePath, matches]) => (
        <div key={filePath}>
          {/* File header */}
          <button
            onClick={() => onFileSelect(filePath)}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 500,
              color: 'var(--xp-blue)',
              background: 'rgba(99, 102, 241, 0.08)',
              border: 'none',
              borderBottom: '1px solid var(--xp-border)',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'background 0.15s',
            }}
            className="hover:bg-xp-surface-light"
            title={filePath}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {matches[0].filename}
            </span>
          </button>
          {/* Matching lines */}
          {matches.map((match) => (
            <button
              key={`${match.file}:${match.line}`}
              onClick={() => onFileSelect(match.file)}
              style={{
                width: '100%',
                padding: '2px 8px 2px 24px',
                fontSize: '11px',
                color: 'var(--xp-text)',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(var(--xp-border-rgb, 100, 100, 100), 0.3)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
                transition: 'background 0.15s',
                lineHeight: '20px',
              }}
              className="hover:bg-xp-surface-light"
              title={`${match.file}:${match.line}`}
            >
              <span
                style={{
                  color: 'var(--xp-text-muted)',
                  fontSize: '10px',
                  minWidth: '32px',
                  textAlign: 'right',
                  flexShrink: 0,
                  fontFamily: 'monospace',
                }}
              >
                {match.line}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                }}
              >
                {highlightContent(match.content.trim())}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};
