/**
 * Inline model picker for the AI chat panel.
 * Lets users switch between popular OpenRouter models without opening Settings.
 * Persists selection to localStorage under aiCloudModel + aiServiceMode=cloud.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Sparkles, Check } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

interface ChatModelPickerProps {
  currentModel: string;
  onModelChange: (model: string) => void;
}

interface ModelOption {
  id: string;
  label: string;
  hint?: string;
}

const POPULAR_MODELS: ReadonlyArray<ModelOption> = [
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', hint: 'Default · balanced' },
  { id: 'anthropic/claude-opus-4', label: 'Claude Opus 4', hint: 'Most capable' },
  { id: 'anthropic/claude-haiku-3.5', label: 'Claude Haiku 3.5', hint: 'Fast · cheap' },
  { id: 'openai/gpt-4.1', label: 'GPT-4.1', hint: 'OpenAI flagship' },
  { id: 'openai/o3', label: 'OpenAI o3', hint: 'Reasoning' },
  { id: 'openai/o4-mini', label: 'o4-mini', hint: 'Fast reasoning' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Long context' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Cheap & fast' },
  { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout', hint: 'Open weight' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', hint: 'Reasoning · cheap' },
  { id: 'qwen/qwen3-235b', label: 'Qwen3 235B', hint: 'Open · large' },
  { id: 'x-ai/grok-4', label: 'Grok 4', hint: 'xAI' },
];

const stripPrefix = (model: string): string => model.replace(/^openrouter:/, '');

const findLabel = (model: string): string => {
  const stripped = stripPrefix(model);
  const match = POPULAR_MODELS.find((m) => m.id === stripped);
  if (match) return match.label;
  // Show short version of custom model
  const parts = stripped.split('/');
  return parts[parts.length - 1] || stripped || 'Select model';
};

const ChatModelPicker = ({ currentModel, onModelChange }: ChatModelPickerProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const persistModel = (modelId: string) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const s = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      s.aiServiceMode = 'cloud';
      s.aiCloudModel = modelId;
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
      window.dispatchEvent(new CustomEvent('xplorer-settings-changed'));
    } catch (err) {
      console.warn('[ChatModelPicker] Failed to persist model:', err);
    }
  };

  const handlePick = (modelId: string) => {
    onModelChange(`openrouter:${modelId}`);
    persistModel(modelId);
    setIsOpen(false);
  };

  const handleCustomSubmit = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    handlePick(trimmed);
    setCustomInput('');
  };

  const currentStripped = stripPrefix(currentModel);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        title={t('aiChat.modelPicker.tooltip', { defaultValue: 'Choose AI model' }) as string}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 8px',
          fontSize: '11px',
          background: 'var(--xp-surface-light)',
          border: '1px solid var(--xp-border)',
          borderRadius: '4px',
          color: 'var(--xp-text)',
          cursor: 'pointer',
          maxWidth: '180px',
        }}
      >
        <Sparkles size={11} style={{ color: 'var(--xp-blue)', flexShrink: 0 }} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {findLabel(currentModel)}
        </span>
        <ChevronDown size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 100,
            minWidth: '240px',
            maxHeight: '360px',
            overflowY: 'auto',
            background: 'var(--xp-surface)',
            border: '1px solid var(--xp-border)',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            padding: '4px',
          }}
        >
          <div
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--xp-text-muted)',
              padding: '4px 8px',
            }}
          >
            {t('aiChat.modelPicker.popular', { defaultValue: 'Popular models' })}
          </div>
          {POPULAR_MODELS.map((m) => {
            const selected = m.id === currentStripped;
            return (
              <button
                key={m.id}
                onClick={() => handlePick(m.id)}
                role="option"
                aria-selected={selected}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: '12px',
                  background: selected ? 'rgba(122, 162, 247, 0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'var(--xp-text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = 'var(--xp-surface-light)';
                }}
                onMouseLeave={(e) => {
                  if (!selected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <Check
                  size={12}
                  style={{
                    color: selected ? 'var(--xp-blue)' : 'transparent',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: selected ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.label}
                  </div>
                  {m.hint && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: 'var(--xp-text-muted)',
                        marginTop: '1px',
                      }}
                    >
                      {m.hint}
                    </div>
                  )}
                </div>
              </button>
            );
          })}

          <div
            style={{
              borderTop: '1px solid var(--xp-border)',
              marginTop: '4px',
              paddingTop: '6px',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--xp-text-muted)',
                padding: '0 8px 4px 8px',
              }}
            >
              {t('aiChat.modelPicker.custom', { defaultValue: 'Custom model' })}
            </div>
            <div style={{ display: 'flex', gap: '4px', padding: '0 8px 4px 8px' }}>
              <input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCustomSubmit();
                  }
                }}
                placeholder="provider/model-id"
                style={{
                  flex: 1,
                  fontSize: '11px',
                  padding: '4px 6px',
                  background: 'var(--xp-bg)',
                  border: '1px solid var(--xp-border)',
                  borderRadius: '4px',
                  color: 'var(--xp-text)',
                  outline: 'none',
                  fontFamily: 'monospace',
                }}
              />
              <button
                onClick={handleCustomSubmit}
                disabled={!customInput.trim()}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  background: customInput.trim() ? 'var(--xp-blue)' : 'var(--xp-surface-light)',
                  color: customInput.trim() ? '#fff' : 'var(--xp-text-muted)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: customInput.trim() ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}
              >
                {t('aiChat.modelPicker.use', { defaultValue: 'Use' })}
              </button>
            </div>
            <div
              style={{
                fontSize: '10px',
                color: 'var(--xp-text-muted)',
                padding: '0 8px 4px 8px',
                lineHeight: 1.4,
              }}
            >
              {t('aiChat.modelPicker.browseHint', {
                defaultValue: 'Browse all at openrouter.ai/models',
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatModelPicker;
