/**
 * Agent Settings bar — quick toggles displayed at the bottom of the Agent Manager panel.
 * Shows current AI provider/model, proactive mode toggle, and auto-allow toggle.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Zap, ShieldCheck } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentSettingsBarProps {
  /** Override model display (from chat panel state) */
  modelOverride?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getModelDisplay = (model: string): string => {
  if (!model) return '';
  // Strip provider prefix for display
  if (model.startsWith('openrouter:')) {
    const name = model.slice('openrouter:'.length);
    // Show just the model name, e.g. "anthropic/claude-sonnet-4" -> "claude-sonnet-4"
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  }
  return model;
};

const loadSettingBool = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
};

const saveSettingBool = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentSettingsBar = ({ modelOverride }: AgentSettingsBarProps) => {
  const { t } = useTranslation();
  const [model, setModel] = useState('');
  const [proactiveEnabled, setProactiveEnabled] = useState(() =>
    loadSettingBool(STORAGE_KEYS.PROACTIVE_AGENT_ENABLED, false),
  );
  const [autoAllowEnabled, setAutoAllowEnabled] = useState(() =>
    loadSettingBool(STORAGE_KEYS.AI_FILE_ACCESS_GRANTED, false),
  );

  // Load model from settings
  useEffect(() => {
    if (modelOverride) {
      setModel(modelOverride);
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) {
        const s = JSON.parse(raw) as Record<string, unknown>;
        const mode = (s.aiServiceMode as string) || 'cloud';
        if (mode === 'cloud') {
          const cloudModel = (s.aiCloudModel as string) || 'anthropic/claude-sonnet-4';
          setModel(`openrouter:${cloudModel}`);
          return;
        }
        if (mode === 'custom') {
          const cm = (s.aiCustomModel as string) || '';
          if (cm) {
            setModel(cm);
            return;
          }
        }
      }
    } catch {
      // Ignore
    }
  }, [modelOverride]);

  const toggleProactive = useCallback(() => {
    setProactiveEnabled((prev) => {
      const next = !prev;
      saveSettingBool(STORAGE_KEYS.PROACTIVE_AGENT_ENABLED, next);
      return next;
    });
  }, []);

  const toggleAutoAllow = useCallback(() => {
    setAutoAllowEnabled((prev) => {
      const next = !prev;
      saveSettingBool(STORAGE_KEYS.AI_FILE_ACCESS_GRANTED, next);
      return next;
    });
  }, []);

  return (
    <div
      style={{
        borderTop: '1px solid var(--xp-border)',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flexShrink: 0,
      }}
    >
      {/* Model display */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
        }}
      >
        <Bot size={12} style={{ flexShrink: 0 }} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={model}
        >
          {getModelDisplay(model) || t('agentManager.settings.notConfigured')}
        </span>
      </div>

      {/* Toggle row */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {/* Proactive mode toggle */}
        <button
          onClick={toggleProactive}
          title={t('agentManager.settings.proactiveMode')}
          aria-label={t('agentManager.settings.proactiveMode')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '4px 6px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background: proactiveEnabled ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-surface)',
            color: proactiveEnabled ? '#fff' : 'var(--xp-text-muted)',
            cursor: 'pointer',
            fontSize: '10px',
            transition: 'all 0.15s ease',
          }}
        >
          <Zap size={10} />
          {t('agentManager.settings.proactive')}
        </button>

        {/* Auto-allow toggle */}
        <button
          onClick={toggleAutoAllow}
          title={t('agentManager.settings.autoAllow')}
          aria-label={t('agentManager.settings.autoAllow')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '4px 6px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background: autoAllowEnabled ? 'var(--xp-green, #73daca)' : 'var(--xp-surface)',
            color: autoAllowEnabled ? '#fff' : 'var(--xp-text-muted)',
            cursor: 'pointer',
            fontSize: '10px',
            transition: 'all 0.15s ease',
          }}
        >
          <ShieldCheck size={10} />
          {t('agentManager.settings.autoAllowLabel')}
        </button>
      </div>
    </div>
  );
};

export default AgentSettingsBar;
