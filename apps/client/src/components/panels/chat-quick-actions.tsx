/**
 * Quick action chip definitions for the AI chat panel.
 * Rendered as clickable suggestions above the input bar.
 */
import { useTranslation } from 'react-i18next';
import { FolderTree, Search, Sparkles, Braces, FileDown, ImageIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuickAction {
  /** i18n key for the label (resolved at render time) */
  labelKey: string;
  /** Fallback label if i18n is not available */
  label: string;
  icon: React.ReactNode;
  prompt: string;
  /** Only show when there are selected files */
  requiresSelection?: boolean;
  /** Only show when in a directory */
  requiresDirectory?: boolean;
  /** Only show when selected files include images */
  requiresImage?: boolean;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const QUICK_ACTIONS: QuickAction[] = [
  {
    labelKey: 'aiChat.quickActions.organizeFolder',
    label: 'Organize folder',
    icon: <FolderTree size={12} />,
    prompt:
      'Analyze this folder and suggest a clean organization structure. Group related files into subfolders by type or purpose.',
    requiresDirectory: true,
  },
  {
    labelKey: 'aiChat.quickActions.findDuplicates',
    label: 'Find duplicates',
    icon: <Search size={12} />,
    prompt:
      'Search this directory for duplicate or very similar files. List any files that appear to be duplicates based on name patterns.',
    requiresDirectory: true,
  },
  {
    labelKey: 'aiChat.quickActions.summarizeSelected',
    label: 'Summarize selected',
    icon: <Sparkles size={12} />,
    prompt: 'Read and summarize the selected file(s). Give a concise overview of each file.',
    requiresSelection: true,
  },
  {
    labelKey: 'aiChat.quickActions.explainCode',
    label: 'Explain code',
    icon: <Braces size={12} />,
    prompt:
      'Explain this code. What does it do, what are the key functions, and are there any potential issues?',
    requiresSelection: true,
  },
  {
    labelKey: 'aiChat.quickActions.generateReadme',
    label: 'Generate README',
    icon: <FileDown size={12} />,
    prompt:
      'Analyze the files in this directory and generate a README.md with a project description, setup instructions, and usage examples.',
    requiresDirectory: true,
  },
  {
    labelKey: 'aiChat.quickActions.describeImage',
    label: 'Describe this image',
    icon: <ImageIcon size={12} />,
    prompt:
      'Describe this image in detail. What is shown, what are the key elements, colors, and composition? Provide any useful observations.',
    requiresImage: true,
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
  const { t } = useTranslation();

  if (actions.length === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={t('aiChat.quickActions.organizeFolder')}
      style={{
        borderTop: '1px solid var(--xp-border)',
        padding: '6px 8px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        flexShrink: 0,
      }}
    >
      {actions.map((action) => {
        const resolvedLabel = t(action.labelKey, { defaultValue: action.label });
        return (
          <button
            key={action.labelKey}
            onClick={() => onAction(action)}
            disabled={isLoading}
            title={action.prompt}
            aria-label={resolvedLabel}
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
            {resolvedLabel}
          </button>
        );
      })}
    </div>
  );
};
