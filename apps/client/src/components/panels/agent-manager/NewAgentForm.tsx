/**
 * Inline form for creating a new multi-session agent.
 * Collects agent type, name, prompt, model selection, and scope configuration.
 * Supports Xplorer Cloud agents and launching external CLI agents
 * (Claude Code, Codex, or a custom command).
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CreateSessionParams,
  AgentScopeConfig as ScopeConfigType,
} from '@/lib/tauri-api-types';
import { getXplorerState } from '@/components/panels/chat-context-helpers';
import {
  detectWorkspaceContext,
  buildWorkspacePrompt,
} from '@/components/panels/chat-workspace-awareness';
import AgentScopeConfig, { DEFAULT_SCOPE } from './AgentScopeConfig';
import { launchClaudeCode, launchCodex, launchCustomCli } from './launch-cli-agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentType = 'cloud' | 'claude-code' | 'codex' | 'custom-cli';

interface NewAgentFormProps {
  onSubmit: (params: CreateSessionParams) => void;
  onCancel: () => void;
  /** Called after a CLI agent is successfully spawned */
  onCliLaunched?: (sessionId: string, label: string) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '11px',
  background: 'var(--xp-bg)',
  border: '1px solid var(--xp-border)',
  borderRadius: '4px',
  color: 'var(--xp-text)',
  outline: 'none',
  boxSizing: 'border-box',
};

const NewAgentForm = ({ onSubmit, onCancel, onCliLaunched }: NewAgentFormProps) => {
  const { t } = useTranslation();
  const [agentType, setAgentType] = useState<AgentType>('cloud');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [workingDirectory, setWorkingDirectory] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [projectContext, setProjectContext] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<ScopeConfigType>({ ...DEFAULT_SCOPE });
  const [showScope, setShowScope] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  // Auto-detect context from Xplorer state on mount
  useEffect(() => {
    const xState = getXplorerState();
    if (xState?.currentPath) {
      setWorkingDirectory(xState.currentPath);
    }
    if (xState?.selectedFiles && xState.selectedFiles.length > 0) {
      setSelectedFiles(xState.selectedFiles.map((f) => f.path));
    }

    // Detect workspace context asynchronously
    const dir = xState?.currentPath || '/';
    detectWorkspaceContext(dir)
      .then((ctx) => {
        const contextStr = buildWorkspacePrompt(ctx);
        if (contextStr) {
          setProjectContext(contextStr);
        }
      })
      .catch(() => {
        // Workspace detection failed — continue without project context
      });
  }, []);

  const handleScopeChange = useCallback((newScope: ScopeConfigType) => {
    setScope(newScope);
  }, []);

  const handleDirectoryChange = useCallback((dir: string) => {
    setWorkingDirectory(dir);
  }, []);

  const handleSubmit = async () => {
    if (isLaunching) return;

    if (agentType === 'cloud') {
      if (!prompt.trim()) return;
      setIsLaunching(true);
      const sessionName = name.trim() || prompt.slice(0, 40);
      try {
        onSubmit({
          name: sessionName,
          prompt: prompt.trim(),
          model,
          working_directory: workingDirectory,
          selected_files: selectedFiles,
          project_context: projectContext,
          scope,
        });
        // Clear form after successful launch
        setName('');
        setPrompt('');
      } finally {
        setIsLaunching(false);
      }
      return;
    }

    // CLI-based agents
    setIsLaunching(true);
    try {
      let result;
      if (agentType === 'claude-code') {
        result = await launchClaudeCode(workingDirectory, prompt.trim() || undefined);
      } else if (agentType === 'codex') {
        result = await launchCodex(workingDirectory, prompt.trim() || undefined);
      } else {
        // custom-cli
        const cmd = customCommand.trim();
        if (!cmd) {
          setIsLaunching(false);
          return;
        }
        result = await launchCustomCli(workingDirectory, cmd);
      }
      onCliLaunched?.(result.sessionId, result.label);
      // Clear form after successful launch
      setName('');
      setPrompt('');
      setCustomCommand('');
    } catch (err) {
      console.error('[NewAgentForm] Failed to launch CLI agent:', err);
    } finally {
      setIsLaunching(false);
    }
  };

  /** Whether the submit button should be enabled */
  const canSubmit = (() => {
    if (isLaunching) return false;
    if (agentType === 'cloud') return !!prompt.trim();
    if (agentType === 'custom-cli') return !!customCommand.trim();
    // claude-code / codex can launch without a prompt
    return true;
  })();

  const isCliAgent = agentType !== 'cloud';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px',
        border: '1px solid var(--xp-border)',
        borderRadius: '6px',
        background: 'var(--xp-surface)',
      }}
    >
      {/* Agent type selector */}
      <select
        value={agentType}
        onChange={(e) => setAgentType(e.target.value as AgentType)}
        style={{ ...inputStyle, cursor: 'pointer' }}
      >
        <option value="cloud">{t('agentManager.newAgent.typeCloud')}</option>
        <option value="claude-code">{t('agentManager.newAgent.typeClaudeCode')}</option>
        <option value="codex">{t('agentManager.newAgent.typeCodex')}</option>
        <option value="custom-cli">{t('agentManager.newAgent.typeCustomCli')}</option>
      </select>

      {/* Name — only for cloud agents */}
      {!isCliAgent && (
        <input
          type="text"
          placeholder={t('agentManager.newAgent.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
      )}

      {/* Custom CLI command input */}
      {agentType === 'custom-cli' && (
        <input
          type="text"
          placeholder={t('agentManager.newAgent.commandPlaceholder')}
          value={customCommand}
          onChange={(e) => setCustomCommand(e.target.value)}
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '11px' }}
        />
      )}

      {/* Prompt — always shown but optional for CLI agents */}
      <textarea
        placeholder={
          isCliAgent
            ? t('agentManager.newAgent.promptPlaceholderCli')
            : t('agentManager.newAgent.promptPlaceholder')
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />

      {/* Model picker — only for cloud agents */}
      {!isCliAgent && (
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{
            ...inputStyle,
            cursor: 'pointer',
          }}
        >
          <optgroup label="Anthropic">
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            <option value="claude-opus-4-6-20250515">Claude Opus 4.6</option>
          </optgroup>
          <optgroup label="OpenAI">
            <option value="gpt-4o">GPT-4o</option>
            <option value="o3">o3</option>
            <option value="o4-mini">o4-mini</option>
          </optgroup>
          <optgroup label="Local (Ollama)">
            <option value="llama3.3">Llama 3.3</option>
            <option value="qwen3">Qwen 3</option>
            <option value="deepseek-r1">DeepSeek R1</option>
          </optgroup>
        </select>
      )}

      {/* Context summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          padding: '2px 0',
        }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
        >
          {workingDirectory}
          {selectedFiles.length > 0 &&
            ` · ${selectedFiles.length} ${t('agentManager.scope.filesSelected')}`}
          {projectContext && ` · ${t('agentManager.scope.contextDetected')}`}
        </span>
        {!isCliAgent && (
          <button
            onClick={() => setShowScope((v) => !v)}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              color: showScope ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {t('agentManager.scope.configure')}
          </button>
        )}
      </div>

      {/* Scope config — expandable, cloud only */}
      {showScope && !isCliAgent && (
        <div
          style={{
            borderTop: '1px solid var(--xp-border)',
            paddingTop: '4px',
          }}
        >
          <AgentScopeConfig
            workingDirectory={workingDirectory}
            onDirectoryChange={handleDirectoryChange}
            scope={scope}
            onScopeChange={handleScopeChange}
            compact
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            background: 'none',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
          }}
        >
          {t('agentManager.newAgent.cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            border: '1px solid var(--xp-green, #73daca)',
            borderRadius: '4px',
            background: canSubmit ? 'var(--xp-green, #73daca)' : 'var(--xp-surface-light)',
            color: canSubmit ? '#fff' : 'var(--xp-text-muted)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          {isLaunching
            ? t('agentManager.newAgent.launching')
            : isCliAgent
              ? t('agentManager.newAgent.launch')
              : t('agentManager.newAgent.start')}
        </button>
      </div>
    </div>
  );
};

export default NewAgentForm;
