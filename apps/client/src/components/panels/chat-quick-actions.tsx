/**
 * Quick action chip definitions for the AI chat panel.
 * Rendered as clickable suggestions above the input bar.
 */
import { FolderTree, Search, Sparkles, Braces, FileDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuickAction {
  label: string;
  icon: React.ReactNode;
  prompt: string;
  /** Only show when there are selected files */
  requiresSelection?: boolean;
  /** Only show when in a directory */
  requiresDirectory?: boolean;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Organize folder',
    icon: <FolderTree size={12} />,
    prompt:
      'Analyze this folder and suggest a clean organization structure. Group related files into subfolders by type or purpose.',
    requiresDirectory: true,
  },
  {
    label: 'Find duplicates',
    icon: <Search size={12} />,
    prompt:
      'Search this directory for duplicate or very similar files. List any files that appear to be duplicates based on name patterns.',
    requiresDirectory: true,
  },
  {
    label: 'Summarize selected',
    icon: <Sparkles size={12} />,
    prompt: 'Read and summarize the selected file(s). Give a concise overview of each file.',
    requiresSelection: true,
  },
  {
    label: 'Explain code',
    icon: <Braces size={12} />,
    prompt:
      'Explain this code. What does it do, what are the key functions, and are there any potential issues?',
    requiresSelection: true,
  },
  {
    label: 'Generate README',
    icon: <FileDown size={12} />,
    prompt:
      'Analyze the files in this directory and generate a README.md with a project description, setup instructions, and usage examples.',
    requiresDirectory: true,
  },
];

// ---------------------------------------------------------------------------
// Quick Actions Bar component
// ---------------------------------------------------------------------------

interface QuickActionsBarProps {
  actions: QuickAction[];
  isLoading: boolean;
  onAction: (action: QuickAction) => void;
}

export const QuickActionsBar = ({ actions, isLoading, onAction }: QuickActionsBarProps) => {
  if (actions.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--xp-border)',
        padding: '6px 8px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        flexShrink: 0,
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action)}
          disabled={isLoading}
          title={action.prompt}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 10px',
            borderRadius: '12px',
            border: '1px solid var(--xp-border)',
            background: 'var(--xp-surface)',
            color: 'var(--xp-text)',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            opacity: isLoading ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.background = 'var(--xp-surface-light)';
              e.currentTarget.style.borderColor = 'var(--xp-blue)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--xp-surface)';
            e.currentTarget.style.borderColor = 'var(--xp-border)';
          }}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
};
