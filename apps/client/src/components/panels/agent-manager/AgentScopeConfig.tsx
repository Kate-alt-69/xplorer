/**
 * Scope configuration for agent sessions.
 *
 * Lets the user configure directory, file scope, depth, and git-awareness
 * before launching an agent. Shown in both NewAgentForm and AgentLauncher.
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, GitBranch, Layers, FileText } from 'lucide-react';
import type { AgentScopeConfig as ScopeConfig } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentScopeConfigProps {
  /** Initial working directory */
  workingDirectory: string;
  onDirectoryChange: (dir: string) => void;
  /** Current scope config */
  scope: ScopeConfig;
  onScopeChange: (scope: ScopeConfig) => void;
  /** Compact mode for inline display (AgentLauncher) */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SCOPE: ScopeConfig = {
  file_scope: 'all',
  depth: 'subfolders',
  git_filter: 'all',
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
};

const labelStyle: React.CSSProperties = {
  color: 'var(--xp-text-muted)',
  fontWeight: 500,
  minWidth: 60,
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

const pillGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '2px',
  flex: 1,
  flexWrap: 'wrap',
};

const makePillStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 8px',
  borderRadius: '4px',
  border: `1px solid ${active ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-border)'}`,
  background: active ? 'rgba(122, 162, 247, 0.15)' : 'var(--xp-bg)',
  color: active ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-text-muted)',
  fontSize: '10px',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  whiteSpace: 'nowrap' as const,
});

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '3px 6px',
  fontSize: '10px',
  background: 'var(--xp-bg)',
  border: '1px solid var(--xp-border)',
  borderRadius: '4px',
  color: 'var(--xp-text)',
  outline: 'none',
  boxSizing: 'border-box',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentScopeConfig = ({
  workingDirectory,
  onDirectoryChange,
  scope,
  onScopeChange,
  compact = false,
}: AgentScopeConfigProps) => {
  const { t } = useTranslation();
  const [showGlob, setShowGlob] = useState(scope.file_scope === 'glob');

  const updateScope = useCallback(
    (partial: Partial<ScopeConfig>) => {
      onScopeChange({ ...scope, ...partial });
    },
    [scope, onScopeChange],
  );

  const handleFileScopeChange = useCallback(
    (value: string) => {
      setShowGlob(value === 'glob');
      updateScope({
        file_scope: value,
        glob_pattern: value === 'glob' ? scope.glob_pattern || '**/*' : undefined,
      });
    },
    [scope.glob_pattern, updateScope],
  );

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? '4px' : '6px',
    padding: compact ? '4px 0' : '6px 0',
  };

  return (
    <div style={containerStyle}>
      {/* Directory */}
      <div style={rowStyle}>
        <span style={labelStyle}>
          <Folder size={10} />
          {t('agentManager.scope.directory')}
        </span>
        <input
          type="text"
          value={workingDirectory}
          onChange={(e) => onDirectoryChange(e.target.value)}
          style={inputStyle}
          placeholder="/"
          spellCheck={false}
        />
      </div>

      {/* File scope */}
      <div style={rowStyle}>
        <span style={labelStyle}>
          <FileText size={10} />
          {t('agentManager.scope.fileScope')}
        </span>
        <div style={pillGroupStyle}>
          {(['all', 'selected', 'glob'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => handleFileScopeChange(opt)}
              style={makePillStyle(scope.file_scope === opt)}
            >
              {t(`agentManager.scope.fileScope_${opt}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Glob input */}
      {showGlob && (
        <div style={{ ...rowStyle, paddingLeft: 66 }}>
          <input
            type="text"
            value={scope.glob_pattern || ''}
            onChange={(e) => updateScope({ glob_pattern: e.target.value })}
            style={inputStyle}
            placeholder="**/*.ts"
            spellCheck={false}
          />
        </div>
      )}

      {/* Depth */}
      <div style={rowStyle}>
        <span style={labelStyle}>
          <Layers size={10} />
          {t('agentManager.scope.depth')}
        </span>
        <div style={pillGroupStyle}>
          {(['folder', 'subfolders', 'project'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => updateScope({ depth: opt })}
              style={makePillStyle(scope.depth === opt)}
            >
              {t(`agentManager.scope.depth_${opt}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Git filter */}
      <div style={rowStyle}>
        <span style={labelStyle}>
          <GitBranch size={10} />
          {t('agentManager.scope.gitFilter')}
        </span>
        <div style={pillGroupStyle}>
          {(['all', 'modified', 'staged'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => updateScope({ git_filter: opt })}
              style={makePillStyle(scope.git_filter === opt)}
            >
              {t(`agentManager.scope.gitFilter_${opt}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AgentScopeConfig;
