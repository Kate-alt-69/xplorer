/**
 * Drag & drop overlay and attached-files bar for the AI chat panel.
 */
import { FileText, X, FileDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// Drag overlay (shown while dragging files over the chat)
// ---------------------------------------------------------------------------

export const DragOverlay = () => (
  <div
    role="presentation"
    aria-label="Drop files here to add context"
    style={{
      position: 'absolute',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(122, 162, 247, 0.08)',
      border: '2px dashed var(--xp-blue)',
      borderRadius: '8px',
      pointerEvents: 'none',
    }}
  >
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        color: 'var(--xp-blue)',
        fontSize: '14px',
        fontWeight: 600,
      }}
    >
      <FileDown size={28} />
      <span>Drop files to add context</span>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Attached files bar (shown when files have been dropped)
// ---------------------------------------------------------------------------

interface DroppedFile {
  name: string;
  path: string;
  is_dir: boolean;
}

interface AttachedFilesBarProps {
  files: DroppedFile[];
  onRemove: (path: string) => void;
  onClearAll: () => void;
}

export const AttachedFilesBar = ({ files, onRemove, onClearAll }: AttachedFilesBarProps) => {
  if (files.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--xp-border)',
        padding: '6px 8px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        fontSize: '11px',
        flexShrink: 0,
        background: 'rgba(122, 162, 247, 0.05)',
      }}
    >
      <span
        style={{
          color: 'var(--xp-text-muted)',
          fontSize: '10px',
          display: 'flex',
          alignItems: 'center',
          marginRight: '4px',
        }}
      >
        Attached:
      </span>
      {files.map((file) => (
        <span
          key={file.path}
          title={file.path}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            padding: '2px 6px',
            borderRadius: '4px',
            background: 'rgba(122, 162, 247, 0.15)',
            color: 'var(--xp-blue)',
          }}
        >
          <FileText size={10} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100px',
            }}
          >
            {file.name}
          </span>
          <button
            onClick={() => onRemove(file.path)}
            aria-label={`Remove ${file.name} from context`}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--xp-text-muted)',
              padding: '0 1px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        aria-label="Remove all attached files"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--xp-text-muted)',
          fontSize: '10px',
          marginLeft: 'auto',
          padding: '0 4px',
        }}
      >
        Clear all
      </button>
    </div>
  );
};
