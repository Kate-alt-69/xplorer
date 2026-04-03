import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';
import { convertAssetUrl } from '@/lib/transport';
import { computeLineDiff, getDiffStats, type DiffLine } from '@/lib/simple-diff';
import { formatFileSize, formatDate } from '@/lib/utils';

// ── File type helpers ────────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'xml',
  'svg',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'rb',
  'php',
  'sh',
  'bash',
  'zsh',
  'bat',
  'cmd',
  'ps1',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'log',
  'csv',
  'tsv',
  'sql',
  'graphql',
  'gql',
  'vue',
  'svelte',
  'astro',
  'mdx',
]);

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'tiff',
]);

const getExt = (name: string): string => {
  return name.split('.').pop()?.toLowerCase() || '';
};

const isTextFile = (file: FileEntry): boolean => {
  return TEXT_EXTENSIONS.has(getExt(file.name));
};

const isImageFile = (file: FileEntry): boolean => {
  return IMAGE_EXTENSIONS.has(getExt(file.name));
};

// ── Sub-components ───────────────────────────────────────────────────────────

/** Header bar with file names and swap button */
const CompareHeader = React.memo(
  ({
    leftFile: _leftFile,
    rightFile: _rightFile,
    onSwap,
    onDismiss,
  }: {
    leftFile: FileEntry;
    rightFile: FileEntry;
    onSwap: () => void;
    onDismiss: () => void;
  }) => {
    const { t } = useTranslation();
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--xp-border)',
          background: 'var(--xp-surface)',
          flexShrink: 0,
        }}
      >
        {/* Banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 0%', minWidth: 0 }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--xp-blue)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 3h5v5" />
            <path d="M8 3H3v5" />
            <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
            <path d="m15 9 6-6" />
          </svg>
          <span
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--xp-text)', whiteSpace: 'nowrap' }}
          >
            {t('previews.compare.comparing2Files')}
          </span>
        </div>

        {/* Swap button */}
        <button
          onClick={onSwap}
          title={t('previews.compare.swapTitle')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 4,
            border: '1px solid var(--xp-border)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--xp-text-secondary)',
            flexShrink: 0,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 16V4m0 0L3 8m4-4l4 4" />
            <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>

        {/* Dismiss (X) */}
        <button
          onClick={onDismiss}
          title={t('previews.compare.exitTitle')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--xp-text-secondary)',
            flexShrink: 0,
          }}
        >
          <svg
            width="14"
            height="14"
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
      </div>
    );
  },
);
CompareHeader.displayName = 'CompareHeader';

/** File name label for each side */
const FileLabel: React.FC<{ file: FileEntry; side: 'left' | 'right' }> = ({
  file,
  side: _side,
}) => (
  <div
    style={{
      padding: '6px 10px',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--xp-text)',
      background: 'var(--xp-bg)',
      borderBottom: '1px solid var(--xp-border)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}
    title={file.path}
  >
    {file.name}
  </div>
);

// ── Text Compare ─────────────────────────────────────────────────────────────

const MAX_TEXT_SIZE = 2 * 1024 * 1024; // 2 MB per file

const TextCompare = React.memo(
  ({ leftFile, rightFile }: { leftFile: FileEntry; rightFile: FileEntry }) => {
    const { t } = useTranslation();
    const [leftContent, setLeftContent] = useState<string | null>(null);
    const [rightContent, setRightContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const leftScrollRef = useRef<HTMLDivElement>(null);
    const rightScrollRef = useRef<HTMLDivElement>(null);
    const syncingRef = useRef(false);

    // Load text contents
    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);

      const load = async () => {
        try {
          if (leftFile.size > MAX_TEXT_SIZE || rightFile.size > MAX_TEXT_SIZE) {
            if (!cancelled) {
              setError('One or both files exceed the 2 MB size limit for text comparison.');
            }
            return;
          }
          const [left, right] = await Promise.all([
            TauriAPI.readTextFile(leftFile.path),
            TauriAPI.readTextFile(rightFile.path),
          ]);
          if (!cancelled) {
            setLeftContent(left);
            setRightContent(right);
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to read file(s)');
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      load();
      return () => {
        cancelled = true;
      };
    }, [leftFile.path, rightFile.path, leftFile.size, rightFile.size]);

    // Synced scrolling
    const handleScroll = useCallback((source: 'left' | 'right') => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      const from = source === 'left' ? leftScrollRef.current : rightScrollRef.current;
      const to = source === 'left' ? rightScrollRef.current : leftScrollRef.current;
      if (from && to) {
        to.scrollTop = from.scrollTop;
      }
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    }, []);

    // Compute diff
    const { diff, stats } = useMemo(() => {
      if (leftContent === null || rightContent === null) {
        return { diff: [] as DiffLine[], stats: { additions: 0, removals: 0, unchanged: 0 } };
      }
      const d = computeLineDiff(leftContent, rightContent);
      return { diff: d, stats: getDiffStats(d) };
    }, [leftContent, rightContent]);

    const leftLineCount = leftContent?.split('\n').length ?? 0;
    const rightLineCount = rightContent?.split('\n').length ?? 0;

    if (loading) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: 'var(--xp-text-secondary)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12 }}>{t('previews.compare.loadingContents')}</div>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: 'var(--xp-red)',
            padding: 16,
          }}
        >
          <div style={{ textAlign: 'center', fontSize: 12 }}>{error}</div>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* Summary bar */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '6px 10px',
            fontSize: 11,
            color: 'var(--xp-text-secondary)',
            borderBottom: '1px solid var(--xp-border)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {t('previews.compare.linesCount', {
              count: leftLineCount,
              size: formatFileSize(leftFile.size),
            })}
          </span>
          <span>{t('comparison.vs')}</span>
          <span>
            {t('previews.compare.linesCount', {
              count: rightLineCount,
              size: formatFileSize(rightFile.size),
            })}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <span style={{ color: 'var(--xp-green)' }}>+{stats.additions}</span>{' '}
            <span style={{ color: 'var(--xp-red)' }}>-{stats.removals}</span>{' '}
            <span>
              {stats.unchanged} {t('previews.compare.same')}
            </span>
          </span>
        </div>

        {/* Side-by-side diff */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left pane */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              borderRight: '1px solid var(--xp-border)',
            }}
          >
            <FileLabel file={leftFile} side="left" />
            <div
              ref={leftScrollRef}
              onScroll={() => handleScroll('left')}
              style={{
                flex: 1,
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: 11,
                lineHeight: '18px',
              }}
            >
              {diff.map((line, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <DiffLineRow key={idx} line={line} side="left" />
              ))}
            </div>
          </div>

          {/* Right pane */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <FileLabel file={rightFile} side="right" />
            <div
              ref={rightScrollRef}
              onScroll={() => handleScroll('right')}
              style={{
                flex: 1,
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: 11,
                lineHeight: '18px',
              }}
            >
              {diff.map((line, idx) => (
                // eslint-disable-next-line react/no-array-index-key
                <DiffLineRow key={idx} line={line} side="right" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
TextCompare.displayName = 'TextCompare';

/** Single diff line row */
const DiffLineRow = React.memo(({ line, side }: { line: DiffLine; side: 'left' | 'right' }) => {
  // For "added" lines, left side is blank; for "removed" lines, right side is blank
  const isBlank =
    (side === 'left' && line.type === 'added') || (side === 'right' && line.type === 'removed');

  const lineNum = side === 'left' ? line.lineNumber.left : line.lineNumber.right;

  let bgColor = 'transparent';
  if (!isBlank) {
    if (line.type === 'added') bgColor = 'rgba(52, 211, 153, 0.12)';
    else if (line.type === 'removed') bgColor = 'rgba(248, 113, 113, 0.12)';
  } else {
    bgColor = 'var(--xp-bg)';
  }

  return (
    <div
      style={{
        display: 'flex',
        background: bgColor,
        minHeight: 18,
        borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}
    >
      {/* Line number */}
      <div
        style={{
          width: 40,
          flexShrink: 0,
          textAlign: 'right',
          paddingRight: 6,
          color: 'var(--xp-text-secondary)',
          opacity: 0.5,
          userSelect: 'none',
        }}
      >
        {lineNum ?? ''}
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          paddingLeft: 4,
          paddingRight: 4,
          whiteSpace: 'pre',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: isBlank ? 'transparent' : 'var(--xp-text)',
        }}
      >
        {isBlank ? '\u00A0' : line.content}
      </div>
    </div>
  );
});
DiffLineRow.displayName = 'DiffLineRow';

// ── Image Compare ────────────────────────────────────────────────────────────

const ImageCompare = React.memo(
  ({ leftFile, rightFile }: { leftFile: FileEntry; rightFile: FileEntry }) => {
    const { t } = useTranslation();
    const [mode, setMode] = useState<'side-by-side' | 'overlay'>('side-by-side');
    const [opacity, setOpacity] = useState(50);
    const [leftDims, setLeftDims] = useState<{ w: number; h: number } | null>(null);
    const [rightDims, setRightDims] = useState<{ w: number; h: number } | null>(null);

    const leftSrc = useMemo(() => convertAssetUrl(leftFile.path), [leftFile.path]);
    const rightSrc = useMemo(() => convertAssetUrl(rightFile.path), [rightFile.path]);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '6px 10px',
            borderBottom: '1px solid var(--xp-border)',
            flexShrink: 0,
            fontSize: 11,
          }}
        >
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setMode('side-by-side')}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--xp-border)',
                background: mode === 'side-by-side' ? 'var(--xp-blue)' : 'transparent',
                color: mode === 'side-by-side' ? '#fff' : 'var(--xp-text-secondary)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {t('previews.compare.sideBySide')}
            </button>
            <button
              onClick={() => setMode('overlay')}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--xp-border)',
                background: mode === 'overlay' ? 'var(--xp-blue)' : 'transparent',
                color: mode === 'overlay' ? '#fff' : 'var(--xp-text-secondary)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {t('previews.compare.overlay')}
            </button>
          </div>

          {/* Opacity slider (overlay mode only) */}
          {mode === 'overlay' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <span style={{ color: 'var(--xp-text-secondary)', fontSize: 11 }}>
                {t('previews.compare.opacity')}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                style={{ flex: 1, maxWidth: 140 }}
              />
              <span style={{ color: 'var(--xp-text-secondary)', fontSize: 11, minWidth: 32 }}>
                {opacity}%
              </span>
            </div>
          )}
        </div>

        {/* Image display */}
        {mode === 'side-by-side' ? (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* Left image */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid var(--xp-border)',
                minWidth: 0,
              }}
            >
              <FileLabel file={leftFile} side="left" />
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'auto',
                  padding: 8,
                }}
              >
                <img
                  src={leftSrc}
                  alt={leftFile.name}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setLeftDims({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                />
              </div>
              <div
                style={{
                  padding: '4px 8px',
                  fontSize: 10,
                  color: 'var(--xp-text-secondary)',
                  borderTop: '1px solid var(--xp-border)',
                  textAlign: 'center',
                }}
              >
                {leftDims ? `${leftDims.w} x ${leftDims.h}` : '...'} |{' '}
                {formatFileSize(leftFile.size)}
              </div>
            </div>

            {/* Right image */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <FileLabel file={rightFile} side="right" />
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'auto',
                  padding: 8,
                }}
              >
                <img
                  src={rightSrc}
                  alt={rightFile.name}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setRightDims({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                />
              </div>
              <div
                style={{
                  padding: '4px 8px',
                  fontSize: 10,
                  color: 'var(--xp-text-secondary)',
                  borderTop: '1px solid var(--xp-border)',
                  textAlign: 'center',
                }}
              >
                {rightDims ? `${rightDims.w} x ${rightDims.h}` : '...'} |{' '}
                {formatFileSize(rightFile.size)}
              </div>
            </div>
          </div>
        ) : (
          /* Overlay mode */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{
                flex: 1,
                position: 'relative',
                overflow: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 8,
              }}
            >
              {/* Bottom (left) image */}
              <img
                src={leftSrc}
                alt={leftFile.name}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setLeftDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
              {/* Top (right) image overlaid */}
              <img
                src={rightSrc}
                alt={rightFile.name}
                style={{
                  position: 'absolute',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  opacity: opacity / 100,
                }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setRightDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                padding: '4px 8px',
                fontSize: 10,
                color: 'var(--xp-text-secondary)',
                borderTop: '1px solid var(--xp-border)',
                justifyContent: 'space-around',
              }}
            >
              <span>
                {leftFile.name}: {leftDims ? `${leftDims.w}x${leftDims.h}` : '...'} |{' '}
                {formatFileSize(leftFile.size)}
              </span>
              <span>
                {rightFile.name}: {rightDims ? `${rightDims.w}x${rightDims.h}` : '...'} |{' '}
                {formatFileSize(rightFile.size)}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  },
);
ImageCompare.displayName = 'ImageCompare';

// ── Metadata Compare ─────────────────────────────────────────────────────────

const MetadataCompare = React.memo(
  ({ leftFile, rightFile }: { leftFile: FileEntry; rightFile: FileEntry }) => {
    const { t } = useTranslation();
    const rows: Array<{ label: string; left: string; right: string }> = useMemo(
      () => [
        { label: t('previews.compare.metaName'), left: leftFile.name, right: rightFile.name },
        {
          label: t('previews.compare.metaExtension'),
          left: getExt(leftFile.name) || t('previews.compare.metaNone'),
          right: getExt(rightFile.name) || t('previews.compare.metaNone'),
        },
        {
          label: t('previews.compare.metaSize'),
          left: formatFileSize(leftFile.size),
          right: formatFileSize(rightFile.size),
        },
        {
          label: t('previews.compare.metaSizeBytes'),
          left: leftFile.size.toLocaleString(),
          right: rightFile.size.toLocaleString(),
        },
        {
          label: t('previews.compare.metaModified'),
          left: formatDate(leftFile.modified),
          right: formatDate(rightFile.modified),
        },
        {
          label: t('previews.compare.metaType'),
          left: leftFile.is_dir ? t('common.folder') : t('common.file'),
          right: rightFile.is_dir ? t('common.folder') : t('common.file'),
        },
        {
          label: t('previews.compare.metaFileType'),
          left: leftFile.file_type || t('previews.compare.metaUnknown'),
          right: rightFile.file_type || t('previews.compare.metaUnknown'),
        },
        ...(leftFile.mime_type || rightFile.mime_type
          ? [
              {
                label: t('previews.compare.metaMimeType'),
                left: leftFile.mime_type || t('previews.compare.metaUnknown'),
                right: rightFile.mime_type || t('previews.compare.metaUnknown'),
              },
            ]
          : []),
      ],
      [leftFile, rightFile, t],
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* File labels */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--xp-border)', flexShrink: 0 }}>
          <div style={{ flex: 1, borderRight: '1px solid var(--xp-border)' }}>
            <FileLabel file={leftFile} side="left" />
          </div>
          <div style={{ flex: 1 }}>
            <FileLabel file={rightFile} side="right" />
          </div>
        </div>

        {/* Metadata table */}
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid var(--xp-border)',
                    color: 'var(--xp-text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  {t('previews.compare.colProperty')}
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid var(--xp-border)',
                    color: 'var(--xp-text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  {t('previews.compare.colLeft')}
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid var(--xp-border)',
                    color: 'var(--xp-text-secondary)',
                    fontWeight: 600,
                  }}
                >
                  {t('previews.compare.colRight')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isDifferent = row.left !== row.right;
                return (
                  <tr key={row.label}>
                    <td
                      style={{
                        padding: '4px 8px',
                        borderBottom: '1px solid var(--xp-border)',
                        color: 'var(--xp-text-secondary)',
                        fontWeight: 500,
                      }}
                    >
                      {row.label}
                    </td>
                    <td
                      style={{
                        padding: '4px 8px',
                        borderBottom: '1px solid var(--xp-border)',
                        color: 'var(--xp-text)',
                        background: isDifferent ? 'rgba(250, 204, 21, 0.1)' : 'transparent',
                        wordBreak: 'break-all',
                      }}
                    >
                      {row.left}
                    </td>
                    <td
                      style={{
                        padding: '4px 8px',
                        borderBottom: '1px solid var(--xp-border)',
                        color: 'var(--xp-text)',
                        background: isDifferent ? 'rgba(250, 204, 21, 0.1)' : 'transparent',
                        wordBreak: 'break-all',
                      }}
                    >
                      {row.right}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
);
MetadataCompare.displayName = 'MetadataCompare';

// ── Main ComparePreview ──────────────────────────────────────────────────────

export interface ComparePreviewProps {
  leftFile: FileEntry;
  rightFile: FileEntry;
  onDismiss: () => void;
  formatFileSize: (bytes: number) => string;
  formatDate: (timestamp: number) => string;
}

const ComparePreview = ({
  leftFile: initialLeft,
  rightFile: initialRight,
  onDismiss,
}: ComparePreviewProps) => {
  const [swapped, setSwapped] = useState(false);

  // Reset swap state when the files themselves change
  const prevKey = useRef(`${initialLeft.path}|${initialRight.path}`);
  const currentKey = `${initialLeft.path}|${initialRight.path}`;
  if (currentKey !== prevKey.current) {
    prevKey.current = currentKey;
    if (swapped) setSwapped(false);
  }

  const leftFile = swapped ? initialRight : initialLeft;
  const rightFile = swapped ? initialLeft : initialRight;

  const handleSwap = useCallback(() => {
    setSwapped((prev) => !prev);
  }, []);

  // Determine comparison type
  const bothText = isTextFile(leftFile) && isTextFile(rightFile);
  const bothImages = isImageFile(leftFile) && isImageFile(rightFile);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <CompareHeader
        leftFile={leftFile}
        rightFile={rightFile}
        onSwap={handleSwap}
        onDismiss={onDismiss}
      />

      {(() => {
        if (bothText) return <TextCompare leftFile={leftFile} rightFile={rightFile} />;
        if (bothImages) return <ImageCompare leftFile={leftFile} rightFile={rightFile} />;
        return <MetadataCompare leftFile={leftFile} rightFile={rightFile} />;
      })()}
    </div>
  );
};

export default React.memo(ComparePreview);
