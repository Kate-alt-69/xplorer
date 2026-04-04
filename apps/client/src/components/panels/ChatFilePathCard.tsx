/**
 * Inline file path card for AI chat responses.
 * When the AI mentions a file path, it gets rendered as a clickable card
 * showing the file name, icon, and size instead of plain text.
 */
import { useState, useEffect } from 'react';
import {
  FileText,
  Folder,
  Image,
  Music,
  Film,
  Code2,
  FileSpreadsheet,
  FileType,
} from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilePathCardProps {
  filePath: string;
  onClick?: (filePath: string) => void;
}

// ---------------------------------------------------------------------------
// Extension to icon mapping
// ---------------------------------------------------------------------------

const FILE_TYPE_ICONS: Record<string, React.ReactNode> = {
  // Images
  png: <Image size={12} />,
  jpg: <Image size={12} />,
  jpeg: <Image size={12} />,
  gif: <Image size={12} />,
  svg: <Image size={12} />,
  webp: <Image size={12} />,
  // Audio
  mp3: <Music size={12} />,
  wav: <Music size={12} />,
  flac: <Music size={12} />,
  ogg: <Music size={12} />,
  // Video
  mp4: <Film size={12} />,
  mov: <Film size={12} />,
  avi: <Film size={12} />,
  mkv: <Film size={12} />,
  // Code
  ts: <Code2 size={12} />,
  tsx: <Code2 size={12} />,
  js: <Code2 size={12} />,
  jsx: <Code2 size={12} />,
  py: <Code2 size={12} />,
  rs: <Code2 size={12} />,
  go: <Code2 size={12} />,
  java: <Code2 size={12} />,
  c: <Code2 size={12} />,
  cpp: <Code2 size={12} />,
  rb: <Code2 size={12} />,
  php: <Code2 size={12} />,
  // Data
  json: <FileSpreadsheet size={12} />,
  csv: <FileSpreadsheet size={12} />,
  xml: <FileSpreadsheet size={12} />,
  yaml: <FileSpreadsheet size={12} />,
  yml: <FileSpreadsheet size={12} />,
  toml: <FileSpreadsheet size={12} />,
  // Docs
  pdf: <FileType size={12} />,
  doc: <FileType size={12} />,
  docx: <FileType size={12} />,
  md: <FileText size={12} />,
  txt: <FileText size={12} />,
};

const getFileIcon = (filePath: string, isDir: boolean): React.ReactNode => {
  if (isDir) return <Folder size={12} />;
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return FILE_TYPE_ICONS[ext] ?? <FileText size={12} />;
};

/** Format bytes into human-readable size */
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatFilePathCard = ({ filePath, onClick }: FilePathCardProps) => {
  const [fileInfo, setFileInfo] = useState<{
    exists: boolean;
    isDir: boolean;
    size: number;
    name: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const parts = filePath.split(/[/\\]/);
    const name = parts[parts.length - 1] || filePath;

    // Try to get file info
    TauriAPI.isDir(filePath)
      .then((isDir) => {
        if (cancelled) return;
        if (isDir) {
          setFileInfo({ exists: true, isDir: true, size: 0, name });
        } else {
          // It exists and is not a dir -- try to get size from directory listing
          const parentDir = parts.slice(0, -1).join('/') || '/';
          TauriAPI.readDirectory(parentDir)
            .then((entries) => {
              if (cancelled) return;
              const entry = entries.find((e) => e.path === filePath || e.name === name);
              setFileInfo({
                exists: true,
                isDir: false,
                size: entry?.size ?? 0,
                name,
              });
            })
            .catch(() => {
              if (!cancelled) {
                setFileInfo({ exists: true, isDir: false, size: 0, name });
              }
            });
        }
      })
      .catch(() => {
        // File doesn't exist or can't be accessed -- still show the card but dimmed
        if (!cancelled) {
          setFileInfo({ exists: false, isDir: false, size: 0, name });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const name = fileInfo?.name ?? filePath.split(/[/\\]/).pop() ?? filePath;
  const icon = getFileIcon(filePath, fileInfo?.isDir ?? false);

  const handleClick = () => {
    if (onClick) {
      onClick(filePath);
    }
  };

  return (
    <button
      onClick={handleClick}
      title={filePath}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        margin: '1px 2px',
        borderRadius: '4px',
        border: '1px solid var(--xp-border)',
        background: 'var(--xp-surface)',
        color: 'var(--xp-text)',
        cursor: onClick ? 'pointer' : 'default',
        fontSize: '12px',
        fontFamily: 'monospace',
        verticalAlign: 'middle',
        maxWidth: '260px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        opacity: fileInfo?.exists === false ? 0.6 : 1,
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.borderColor = 'var(--xp-blue)';
          e.currentTarget.style.background = 'var(--xp-surface-light)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--xp-border)';
        e.currentTarget.style.background = 'var(--xp-surface)';
      }}
    >
      <span style={{ flexShrink: 0, color: 'var(--xp-blue)' }}>{icon}</span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {fileInfo !== null && fileInfo.exists && !fileInfo.isDir && fileInfo.size > 0 && (
        <span
          style={{
            color: 'var(--xp-text-muted)',
            fontSize: '10px',
            flexShrink: 0,
          }}
        >
          {formatSize(fileInfo.size)}
        </span>
      )}
      {fileInfo?.isDir && (
        <span
          style={{
            color: 'var(--xp-text-muted)',
            fontSize: '10px',
            flexShrink: 0,
          }}
        >
          dir
        </span>
      )}
    </button>
  );
};

export default ChatFilePathCard;

// ---------------------------------------------------------------------------
// File path detection regex
// ---------------------------------------------------------------------------

/**
 * Match absolute file paths in text. Supports:
 * - Unix: /path/to/file.ext
 * - Windows: C:\path\to\file.ext or C:/path/to/file.ext
 * Avoids matching URLs (http://, https://).
 */
const FILE_PATH_REGEX =
  /(?:(?<![a-zA-Z:])(?:\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+)|(?:[A-Z]:[/\\](?:[^\s:*?"<>|]+[/\\])*[^\s:*?"<>|]+\.[a-zA-Z0-9]+)|(?:(?<![a-zA-Z:])\/(?:[a-zA-Z0-9._-]+\/){2,}[a-zA-Z0-9._-]+))/g;

/**
 * Extract file paths from text content.
 * Returns unique paths found in the text.
 */
export const extractFilePaths = (text: string): string[] => {
  const matches = text.match(FILE_PATH_REGEX);
  if (!matches) return [];
  // Deduplicate and filter out common false positives
  const unique = [...new Set(matches)].filter(
    (p) =>
      // Must have at least 2 path segments
      p.split(/[/\\]/).filter(Boolean).length >= 2 &&
      // Not a URL protocol
      !p.startsWith('http') &&
      !p.startsWith('ftp'),
  );
  return unique;
};
