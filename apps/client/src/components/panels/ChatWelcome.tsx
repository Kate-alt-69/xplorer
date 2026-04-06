/**
 * Contextual welcome message for the AI chat panel.
 * Instead of a static empty state, shows a dynamic welcome
 * based on the current workspace context (project type, git status, etc.).
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderGit2, Package, GitBranch, FileCode2, Sparkles, Loader2 } from 'lucide-react';
import { type WorkspaceContext, detectWorkspaceContext } from './chat-workspace-awareness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Suggestion {
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

interface ChatWelcomeProps {
  currentPath: string;
  selectedFileCount: number;
  onSendMessage: (prompt: string) => void;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Suggestion builders
// ---------------------------------------------------------------------------

const buildSuggestions = (ctx: WorkspaceContext): Suggestion[] => {
  const suggestions: Suggestion[] = [];

  // Git-based suggestions
  if (ctx.git.isRepo) {
    if (ctx.git.uncommittedCount !== undefined && ctx.git.uncommittedCount > 0) {
      suggestions.push({
        label: `Review ${ctx.git.uncommittedCount} uncommitted change${ctx.git.uncommittedCount !== 1 ? 's' : ''}`,
        prompt: `I have ${ctx.git.uncommittedCount} uncommitted changes in this Git repo. Can you list them and help me review what changed?`,
        icon: <FolderGit2 size={12} />,
      });
    }
    if (ctx.git.branch && ctx.git.branch !== 'main' && ctx.git.branch !== 'master') {
      suggestions.push({
        label: `Summarize work on "${ctx.git.branch}"`,
        prompt: `I'm on the "${ctx.git.branch}" branch. Can you help me summarize what this branch is about based on the files here?`,
        icon: <GitBranch size={12} />,
      });
    }
  }

  // Project-based suggestions
  if (ctx.project) {
    switch (ctx.project.type) {
      case 'node':
        suggestions.push({
          label: 'Check for outdated dependencies',
          prompt:
            'Analyze the package.json in this project. Are there any dependencies that might be outdated or have known issues? What improvements would you suggest?',
          icon: <Package size={12} />,
        });
        break;
      case 'rust':
        suggestions.push({
          label: 'Review Cargo.toml config',
          prompt:
            'Analyze the Cargo.toml in this project. Are the dependencies well-organized? Any suggestions for the project configuration?',
          icon: <Package size={12} />,
        });
        break;
      case 'python':
        suggestions.push({
          label: 'Check Python dependencies',
          prompt:
            'Analyze the Python dependencies in this project. Are there any version pinning issues or suggestions for improvement?',
          icon: <Package size={12} />,
        });
        break;
      case 'go':
        suggestions.push({
          label: 'Review Go module config',
          prompt:
            'Analyze the go.mod in this project. Are the module dependencies well-managed? Any suggestions?',
          icon: <Package size={12} />,
        });
        break;
      default:
        break;
    }
  }

  // Generic suggestions based on directory content
  if (ctx.fileCount > 20) {
    suggestions.push({
      label: 'Organize this folder',
      prompt:
        'This folder has many files. Analyze them and suggest an organization structure — group related files into subfolders by type or purpose.',
      icon: <Sparkles size={12} />,
    });
  }

  if (ctx.fileCount > 0) {
    suggestions.push({
      label: 'Explain this project',
      prompt:
        'Look at the files in this directory and explain what this project or folder is about. What are the key files and their purposes?',
      icon: <FileCode2 size={12} />,
    });
  }

  return suggestions.slice(0, 4); // Max 4 suggestions
};

// ---------------------------------------------------------------------------
// Welcome headline
// ---------------------------------------------------------------------------

const buildHeadline = (ctx: WorkspaceContext): string => {
  if (ctx.project && ctx.git.isRepo) {
    const branch = ctx.git.branch ? ` on ${ctx.git.branch}` : '';
    return `${ctx.project.label} project${branch}`;
  }
  if (ctx.project) {
    return `${ctx.project.label} project`;
  }
  if (ctx.git.isRepo) {
    const branch = ctx.git.branch ? ` on ${ctx.git.branch}` : '';
    return `Git repository${branch}`;
  }
  if (ctx.totalItems > 0) {
    return `${ctx.fileCount} files, ${ctx.dirCount} folders`;
  }
  return '';
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatWelcome = ({
  currentPath,
  selectedFileCount,
  onSendMessage,
  isLoading,
}: ChatWelcomeProps) => {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!currentPath) {
      setWorkspace(null);
      return;
    }

    let cancelled = false;
    setDetecting(true);

    detectWorkspaceContext(currentPath)
      .then((ctx) => {
        if (!cancelled) {
          setWorkspace(ctx);
          setDetecting(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspace(null);
          setDetecting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  const headline = workspace ? buildHeadline(workspace) : '';
  const suggestions = workspace ? buildSuggestions(workspace) : [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--xp-text-muted)',
        fontSize: '13px',
        gap: '12px',
        padding: '16px',
      }}
    >
      <span style={{ fontSize: '28px' }}>&#x1F4AC;</span>

      {detecting ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--xp-text-muted)',
            fontSize: '12px',
          }}
        >
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          {t('aiChat.welcome.analyzingWorkspace')}
        </div>
      ) : (
        <>
          {headline ? (
            <span style={{ fontWeight: 600, color: 'var(--xp-text)', fontSize: '14px' }}>
              {headline}
            </span>
          ) : (
            <span>{t('aiChat.welcome.askAnything')}</span>
          )}

          {workspace?.project?.details && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--xp-text-muted)',
                maxWidth: '280px',
                textAlign: 'center',
              }}
            >
              {workspace.project.details}
            </span>
          )}

          {/* Contextual info badges */}
          {workspace && (workspace.git.isRepo || workspace.project) && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                justifyContent: 'center',
                marginTop: '2px',
              }}
            >
              {workspace.git.isRepo &&
                workspace.git.uncommittedCount !== undefined &&
                workspace.git.uncommittedCount > 0 && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: 'rgba(255, 183, 77, 0.12)',
                      color: 'var(--xp-yellow, #e0af68)',
                      fontSize: '11px',
                    }}
                  >
                    <FolderGit2 size={10} />
                    {t('aiChat.welcome.uncommitted', { count: workspace.git.uncommittedCount })}
                  </span>
                )}
              {workspace.topExtensions.length > 0 && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: 'rgba(122, 162, 247, 0.1)',
                    color: 'var(--xp-blue)',
                    fontSize: '11px',
                  }}
                >
                  <FileCode2 size={10} />
                  {workspace.topExtensions.map((e) => `.${e.ext}`).join(', ')}
                </span>
              )}
            </div>
          )}

          {/* Contextual suggestions */}
          {suggestions.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                marginTop: '8px',
                width: '100%',
                maxWidth: '300px',
              }}
            >
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.label}
                  onClick={() => onSendMessage(suggestion.prompt)}
                  disabled={isLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--xp-border)',
                    background: 'var(--xp-surface)',
                    color: 'var(--xp-text)',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    textAlign: 'left',
                    opacity: isLoading ? 0.5 : 1,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading) {
                      e.currentTarget.style.borderColor = 'var(--xp-blue)';
                      e.currentTarget.style.background = 'var(--xp-surface-light)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--xp-border)';
                    e.currentTarget.style.background = 'var(--xp-surface)';
                  }}
                >
                  <span style={{ flexShrink: 0, color: 'var(--xp-blue)' }}>{suggestion.icon}</span>
                  <span>{suggestion.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Fallback when no contextual suggestions */}
          {suggestions.length === 0 && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--xp-text-muted)',
                maxWidth: '220px',
                textAlign: 'center',
              }}
            >
              {t('aiChat.welcome.capabilities')}
            </span>
          )}
        </>
      )}

      {selectedFileCount > 0 && (
        <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)' }}>
          {t('aiChat.context.filesInContext', { count: selectedFileCount })}
        </span>
      )}

      <span
        style={{
          fontSize: '11px',
          color: 'var(--xp-text-muted)',
          marginTop: '4px',
          opacity: 0.7,
        }}
      >
        {t('aiChat.welcome.dragOrType')}
      </span>
    </div>
  );
};

export default ChatWelcome;
