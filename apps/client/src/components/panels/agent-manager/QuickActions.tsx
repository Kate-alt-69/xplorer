/**
 * Quick Actions grid — one-click common AI tasks.
 * Each action dispatches a prompt to the AI chat via the xplorer-ai-chat-request event.
 */
import { useTranslation } from 'react-i18next';
import { FolderTree, Search, FileDown, PenLine, FileText, Trash2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuickActionDef {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
  prompt: string;
}

interface QuickActionsProps {
  onAction: (prompt: string) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const QUICK_ACTIONS: QuickActionDef[] = [
  {
    id: 'organize',
    labelKey: 'agentManager.quickActions.organize',
    icon: <FolderTree size={16} />,
    prompt:
      'Analyze this folder and organize files into a clean structure. Group related files into subfolders by type or purpose.',
  },
  {
    id: 'duplicates',
    labelKey: 'agentManager.quickActions.findDuplicates',
    icon: <Search size={16} />,
    prompt:
      'Search this directory for duplicate or very similar files. List any files that appear to be duplicates based on name, size, and content patterns.',
  },
  {
    id: 'readme',
    labelKey: 'agentManager.quickActions.generateReadme',
    icon: <FileDown size={16} />,
    prompt:
      'Analyze the files in this directory and generate a README.md with a project description, setup instructions, and usage examples.',
  },
  {
    id: 'rename',
    labelKey: 'agentManager.quickActions.smartRename',
    icon: <PenLine size={16} />,
    prompt:
      'Analyze filenames in this folder and suggest consistent naming improvements. Detect patterns and propose a rename plan.',
  },
  {
    id: 'summarize',
    labelKey: 'agentManager.quickActions.summarize',
    icon: <FileText size={16} />,
    prompt:
      'Summarize the contents of this folder. List key files and provide a brief description of what this directory contains and its purpose.',
  },
  {
    id: 'cleanup',
    labelKey: 'agentManager.quickActions.cleanup',
    icon: <Trash2 size={16} />,
    prompt:
      'Analyze this folder and suggest files that could be deleted or archived. Look for temp files, old backups, and unused assets.',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const QuickActions = ({ onAction, disabled }: QuickActionsProps) => {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '4px',
      }}
    >
      {QUICK_ACTIONS.map((action) => {
        const label = t(action.labelKey);
        return (
          <button
            key={action.id}
            onClick={() => onAction(action.prompt)}
            disabled={disabled}
            title={action.prompt}
            aria-label={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid var(--xp-border)',
              background: 'var(--xp-surface)',
              color: 'var(--xp-text)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              textAlign: 'left',
              opacity: disabled ? 0.5 : 1,
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!disabled) {
                e.currentTarget.style.background = 'var(--xp-surface-light)';
                e.currentTarget.style.borderColor = 'var(--xp-blue, #7aa2f7)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--xp-surface)';
              e.currentTarget.style.borderColor = 'var(--xp-border)';
            }}
          >
            <span
              style={{
                color: 'var(--xp-blue, #7aa2f7)',
                flexShrink: 0,
                display: 'flex',
              }}
            >
              {action.icon}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default QuickActions;
