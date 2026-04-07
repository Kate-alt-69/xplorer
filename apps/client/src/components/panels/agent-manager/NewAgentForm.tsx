/**
 * Inline form for creating a new multi-session agent.
 * Collects name, prompt, and model selection.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreateSessionParams } from '@/lib/tauri-api-types';

interface NewAgentFormProps {
  onSubmit: (params: CreateSessionParams) => void;
  onCancel: () => void;
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

const NewAgentForm = ({ onSubmit, onCancel }: NewAgentFormProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    const sessionName = name.trim() || prompt.slice(0, 40);
    onSubmit({
      name: sessionName,
      prompt: prompt.trim(),
      model,
      working_directory: '/',
    });
  };

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
      <input
        type="text"
        placeholder={t('agentManager.newAgent.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={inputStyle}
      />
      <textarea
        placeholder={t('agentManager.newAgent.promptPlaceholder')}
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
          disabled={!prompt.trim()}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            border: '1px solid var(--xp-green, #73daca)',
            borderRadius: '4px',
            background: prompt.trim() ? 'var(--xp-green, #73daca)' : 'var(--xp-surface-light)',
            color: prompt.trim() ? '#fff' : 'var(--xp-text-muted)',
            cursor: prompt.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          {t('agentManager.newAgent.start')}
        </button>
      </div>
    </div>
  );
};

export default NewAgentForm;
