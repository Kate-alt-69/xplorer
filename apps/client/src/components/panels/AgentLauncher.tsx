/**
 * Agent Launcher — floating Cmd+K quick-launcher for spawning agents.
 *
 * Activated by Cmd+K (macOS) or Ctrl+K (Windows/Linux). Presents a
 * centered floating card with:
 * - Text input for the agent task description
 * - Model picker dropdown (popular OpenRouter models)
 * - Scope picker (current directory / selected files / browse)
 * - Recent agent prompts
 * - Launch button that dispatches to the AI chat
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Rocket, ChevronDown, Clock, X, Folder, FolderOpen } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { getXplorerState } from '@/components/panels/chat-context-helpers';
import {
  detectWorkspaceContext,
  buildWorkspacePrompt,
} from '@/components/panels/chat-workspace-awareness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentLauncherProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
  selectedFileCount?: number;
}

interface RecentPrompt {
  text: string;
  model: string;
  scope: string;
  timestamp: number;
}

type ScopeOption = 'current-dir' | 'selected-files' | 'browse';

// ---------------------------------------------------------------------------
// Model list — popular OpenRouter models
// ---------------------------------------------------------------------------

const MODEL_OPTIONS = [
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'anthropic/claude-opus-4', label: 'Claude Opus 4' },
  { value: 'anthropic/claude-haiku-3.5', label: 'Claude Haiku 3.5' },
  { value: 'openai/gpt-4.1', label: 'GPT-4.1' },
  { value: 'openai/o3', label: 'o3' },
  { value: 'openai/o4-mini', label: 'o4-mini' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout' },
  { value: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
  { value: 'qwen/qwen3-235b', label: 'Qwen3 235B' },
];

const DEFAULT_MODEL = MODEL_OPTIONS[0].value;

const MAX_RECENT_PROMPTS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const loadRecentPrompts = (): RecentPrompt[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_LAUNCHER_RECENT);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is RecentPrompt =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as RecentPrompt).text === 'string' &&
        typeof (p as RecentPrompt).timestamp === 'number',
    );
  } catch {
    return [];
  }
};

const saveRecentPrompts = (prompts: RecentPrompt[]): void => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.AGENT_LAUNCHER_RECENT,
      JSON.stringify(prompts.slice(0, MAX_RECENT_PROMPTS)),
    );
  } catch {
    // Storage unavailable
  }
};

const dispatchChatPrompt = (prompt: string): void => {
  window.dispatchEvent(new CustomEvent('xplorer-ai-chat-request', { detail: { prompt } }));
};

const getScopeDisplay = (
  scope: ScopeOption,
  currentPath: string,
  selectedFileCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string => {
  switch (scope) {
    case 'current-dir': {
      const dirName = currentPath.split(/[\\/]/).pop() || currentPath;
      return `${t('agentManager.launcher.scopeCurrentDir')} (${dirName})`;
    }
    case 'selected-files':
      return `${t('agentManager.launcher.scopeSelectedFiles')} (${selectedFileCount})`;
    case 'browse':
      return t('agentManager.launcher.scopeBrowse');
  }
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '15vh',
  background: 'rgba(0, 0, 0, 0.5)',
  backdropFilter: 'blur(4px)',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  borderRadius: '12px',
  border: '1px solid var(--xp-border)',
  background: 'var(--xp-surface)',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)',
  overflow: 'hidden',
  animation: 'fadeSlideIn 0.15s ease-out',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'var(--xp-text)',
  fontSize: '14px',
  fontFamily: 'inherit',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 16px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--xp-text-muted)',
  fontWeight: 500,
  minWidth: 40,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  borderRadius: '6px',
  border: '1px solid var(--xp-border)',
  background: 'var(--xp-bg)',
  color: 'var(--xp-text)',
  fontSize: '12px',
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
};

const launchBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  width: '100%',
  padding: '10px',
  border: 'none',
  borderRadius: '0',
  background: 'var(--xp-blue, #7aa2f7)',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.15s ease',
};

const recentItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 16px',
  cursor: 'pointer',
  fontSize: '12px',
  color: 'var(--xp-text-muted)',
  transition: 'background 0.1s ease',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentLauncher = ({
  isOpen,
  onClose,
  currentPath,
  selectedFileCount = 0,
}: AgentLauncherProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [scope, setScope] = useState<ScopeOption>('current-dir');
  const [workingDir, setWorkingDir] = useState(currentPath);
  const [showDirInput, setShowDirInput] = useState(false);
  const [recentPrompts, setRecentPrompts] = useState<RecentPrompt[]>([]);

  // Sync working dir with currentPath prop
  useEffect(() => {
    setWorkingDir(currentPath);
  }, [currentPath]);

  // Load recent prompts on open
  useEffect(() => {
    if (isOpen) {
      setRecentPrompts(loadRecentPrompts());
      setPrompt('');
      setShowDirInput(false);
      // Focus after a frame so the animation plays
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  const scopeDisplay = useMemo(
    () => getScopeDisplay(scope, workingDir, selectedFileCount, t),
    [scope, workingDir, selectedFileCount, t],
  );

  const handleLaunch = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // Build context-enriched prompt
    let scopeContext = '';
    if (scope === 'current-dir') {
      scopeContext = `Working directory: ${workingDir}`;
    } else if (scope === 'selected-files') {
      scopeContext = `Selected ${selectedFileCount} file(s) in ${workingDir}`;
    }

    // Gather selected file paths from Xplorer state
    const xState = getXplorerState();
    const selectedPaths = xState?.selectedFiles?.map((f) => f.path) ?? [];

    // Detect workspace context asynchronously then dispatch
    const buildAndDispatch = async () => {
      let projectCtx = '';
      try {
        const ctx = await detectWorkspaceContext(workingDir);
        projectCtx = buildWorkspacePrompt(ctx);
      } catch {
        // Workspace detection failed — continue without
      }

      const contextParts: string[] = [];
      if (scopeContext) contextParts.push(scopeContext);
      if (selectedPaths.length > 0) {
        contextParts.push(`Selected files: ${selectedPaths.join(', ')}`);
      }
      if (projectCtx) {
        contextParts.push(projectCtx);
      }

      const contextBlock =
        contextParts.length > 0 ? `[Agent Context]\n${contextParts.join('\n')}\n\n` : '';
      const fullPrompt = `${contextBlock}${trimmed}`;

      dispatchChatPrompt(fullPrompt);
    };

    // Save to recent
    const newRecent: RecentPrompt = {
      text: trimmed,
      model,
      scope,
      timestamp: Date.now(),
    };
    const updated = [newRecent, ...recentPrompts.filter((r) => r.text !== trimmed)].slice(
      0,
      MAX_RECENT_PROMPTS,
    );
    setRecentPrompts(updated);
    saveRecentPrompts(updated);

    // Fire and forget — launch the context detection + dispatch
    buildAndDispatch().catch(() => {
      // Fallback: dispatch without project context
      const fallbackPrompt = scopeContext ? `[Context: ${scopeContext}]\n\n${trimmed}` : trimmed;
      dispatchChatPrompt(fallbackPrompt);
    });

    onClose();
  }, [prompt, model, scope, workingDir, selectedFileCount, recentPrompts, onClose]);

  const handleRecentClick = useCallback((recent: RecentPrompt) => {
    setPrompt(recent.text);
    setModel(recent.model || DEFAULT_MODEL);
    if (
      recent.scope === 'current-dir' ||
      recent.scope === 'selected-files' ||
      recent.scope === 'browse'
    ) {
      setScope(recent.scope);
    }
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleLaunch();
      }
    },
    [handleLaunch],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div style={backdropStyle} onClick={handleBackdropClick}>
      {/* Keyframe for slide-in animation */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-label={t('agentManager.launcher.placeholder')}
      >
        {/* Close button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 8px 0 0' }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--xp-text-muted)',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Input */}
        <div style={{ borderBottom: '1px solid var(--xp-border)' }}>
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('agentManager.launcher.placeholder')}
            style={inputStyle}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Model picker */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('agentManager.launcher.modelLabel')}</span>
          <div style={{ flex: 1, position: 'relative' }}>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={selectStyle}>
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                color: 'var(--xp-text-muted)',
              }}
            />
          </div>
        </div>

        {/* Scope picker */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('agentManager.launcher.scopeLabel')}</span>
          <div style={{ flex: 1, display: 'flex', gap: '4px' }}>
            {(['current-dir', 'selected-files'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: `1px solid ${scope === s ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-border)'}`,
                  background: scope === s ? 'rgba(122, 162, 247, 0.15)' : 'var(--xp-bg)',
                  color: scope === s ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-text-muted)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <Folder size={10} />
                {s === 'current-dir'
                  ? t('agentManager.launcher.scopeCurrentDir')
                  : t('agentManager.launcher.scopeSelectedFiles')}
              </button>
            ))}
          </div>
        </div>

        {/* Scope display + directory toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0 16px 8px',
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
          }}
        >
          <span style={{ flex: 1 }}>{scopeDisplay}</span>
          <button
            onClick={() => setShowDirInput((v) => !v)}
            title={t('agentManager.launcher.changeDirectory')}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              cursor: 'pointer',
              color: showDirInput ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '10px',
              flexShrink: 0,
            }}
          >
            <FolderOpen size={10} />
          </button>
        </div>

        {/* Directory input (expandable) */}
        {showDirInput && (
          <div style={rowStyle}>
            <span style={labelStyle}>{t('agentManager.launcher.directoryLabel')}</span>
            <input
              type="text"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              style={{
                ...selectStyle,
                fontFamily: 'monospace',
                fontSize: '11px',
              }}
              spellCheck={false}
              placeholder="/"
            />
          </div>
        )}

        {/* Recent prompts */}
        {recentPrompts.length > 0 && (
          <div
            style={{
              borderTop: '1px solid var(--xp-border)',
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                padding: '6px 16px 2px',
                fontSize: '10px',
                color: 'var(--xp-text-muted)',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {t('agentManager.launcher.recentPrompts')}
            </div>
            {recentPrompts.map((recent) => (
              <div
                key={recent.timestamp}
                style={recentItemStyle}
                onClick={() => handleRecentClick(recent)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--xp-surface-light)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRecentClick(recent);
                }}
              >
                <Clock size={10} style={{ flexShrink: 0 }} />
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {recent.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Launch button */}
        <button
          onClick={handleLaunch}
          disabled={!prompt.trim()}
          style={{
            ...launchBtnStyle,
            opacity: prompt.trim() ? 1 : 0.5,
            cursor: prompt.trim() ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={(e) => {
            if (prompt.trim()) e.currentTarget.style.background = 'var(--xp-blue-bright, #89b4fa)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--xp-blue, #7aa2f7)';
          }}
        >
          <Rocket size={14} />
          {t('agentManager.launcher.launch')}
          <span
            style={{
              marginLeft: 8,
              fontSize: '10px',
              opacity: 0.7,
              fontWeight: 400,
            }}
          >
            {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter
          </span>
        </button>

        {/* Footer hint */}
        <div
          style={{
            padding: '6px 16px',
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
            textAlign: 'center',
            borderTop: '1px solid var(--xp-border)',
          }}
        >
          {t('agentManager.launcher.shortcutHint')}
        </div>
      </div>
    </div>
  );
};

export default AgentLauncher;
