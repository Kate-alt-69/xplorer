/**
 * Context header bar for the AI chat panel.
 * Shows the current directory, selected files, and editor selection.
 */
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen, Code2, X } from 'lucide-react';
import { basename } from './chat-file-actions';

interface SelectedFile {
  name: string;
  path: string;
  is_dir: boolean;
}

interface EditorSelection {
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

interface ChatContextHeaderProps {
  currentPath: string;
  selectedFiles: SelectedFile[];
  editorSelection: EditorSelection | null | undefined;
  includeSelection: boolean;
  onToggleSelection: () => void;
}

const ChatContextHeader = ({
  currentPath,
  selectedFiles,
  editorSelection,
  includeSelection,
  onToggleSelection,
}: ChatContextHeaderProps) => {
  const { t } = useTranslation();
  const hasContext = currentPath || selectedFiles.length > 0 || editorSelection;
  if (!hasContext) return null;

  return (
    <div
      style={{
        borderBottom: '1px solid var(--xp-border)',
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '12px',
        flexShrink: 0,
      }}
    >
      {currentPath && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--xp-text-muted)',
          }}
        >
          <FolderOpen size={12} style={{ flexShrink: 0 }} />
          <span
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={currentPath}
          >
            {basename(currentPath)}
          </span>
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {selectedFiles.slice(0, 5).map((file) => (
            <span
              key={file.path}
              title={file.path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '1px 6px',
                borderRadius: '4px',
                background: 'var(--xp-surface-light)',
                color: 'var(--xp-text)',
                fontSize: '11px',
                maxWidth: '140px',
              }}
            >
              <FileText size={10} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
            </span>
          ))}
          {selectedFiles.length > 5 && (
            <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)', padding: '1px 4px' }}>
              {t('aiChat.context.moreFiles', { count: selectedFiles.length - 5 })}
            </span>
          )}
        </div>
      )}

      {editorSelection && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 6px',
            borderRadius: '4px',
            background: includeSelection ? 'rgba(122, 162, 247, 0.15)' : 'var(--xp-surface-light)',
            color: includeSelection ? 'var(--xp-blue)' : 'var(--xp-text-muted)',
          }}
        >
          <Code2 size={11} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {basename(editorSelection.filePath)} L{editorSelection.startLine}-
            {editorSelection.endLine}
          </span>
          <button
            onClick={onToggleSelection}
            title={
              includeSelection
                ? t('aiChat.context.excludeSelection')
                : t('aiChat.context.includeSelection')
            }
            aria-label={
              includeSelection
                ? t('aiChat.context.excludeSelection')
                : t('aiChat.context.includeSelection')
            }
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 2px',
              color: 'inherit',
              fontSize: '11px',
              opacity: 0.7,
            }}
          >
            {includeSelection ? <X size={10} /> : t('aiChat.context.include')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatContextHeader;
