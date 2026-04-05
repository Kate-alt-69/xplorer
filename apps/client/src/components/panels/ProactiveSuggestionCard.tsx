/**
 * Subtle, non-intrusive card displayed at the top of the chat panel
 * when the proactive agent has a suggestion for the user.
 *
 * Design: light background, one-line headline, optional detail,
 * action button that sends the suggestion as a user message,
 * dismiss button, and a settings toggle to disable proactive mode.
 */
import { useState } from 'react';
import { Lightbulb, X, Settings } from 'lucide-react';
import { type ProactiveSuggestion } from './use-proactive-agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProactiveSuggestionCardProps {
  suggestion: ProactiveSuggestion;
  onAction: (prompt: string) => void;
  onDismiss: () => void;
  proactiveEnabled: boolean;
  onToggleProactive: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ProactiveSuggestionCard = ({
  suggestion,
  onAction,
  onDismiss,
  proactiveEnabled,
  onToggleProactive,
}: ProactiveSuggestionCardProps) => {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div
      style={{
        margin: '8px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--xp-border)',
        background: 'var(--xp-surface)',
        fontSize: '12px',
        animation: 'proactive-fade-in 0.3s ease-out',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
        }}
      >
        <Lightbulb
          size={14}
          style={{
            flexShrink: 0,
            color: 'var(--xp-yellow, #e0af68)',
            marginTop: '1px',
          }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: 'var(--xp-text)',
              fontWeight: 500,
              lineHeight: '1.3',
            }}
          >
            {suggestion.headline}
          </div>
          {suggestion.detail && (
            <div
              style={{
                color: 'var(--xp-text-muted)',
                fontSize: '11px',
                marginTop: '2px',
                lineHeight: '1.3',
              }}
            >
              {suggestion.detail}
            </div>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onDismiss}
          title="Dismiss suggestion"
          aria-label="Dismiss suggestion"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: 'var(--xp-text-muted)',
            opacity: 0.6,
            flexShrink: 0,
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Action row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginTop: '8px',
        }}
      >
        <button
          onClick={() => onAction(suggestion.prompt)}
          style={{
            padding: '4px 12px',
            borderRadius: '6px',
            border: '1px solid var(--xp-blue)',
            background: 'rgba(122, 162, 247, 0.12)',
            color: 'var(--xp-blue)',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 500,
          }}
        >
          {suggestion.actionLabel}
        </button>

        <button
          onClick={onDismiss}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid var(--xp-border)',
            background: 'none',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          Dismiss
        </button>

        {/* Settings toggle */}
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <button
            onClick={() => setShowSettings((v) => !v)}
            title="Proactive agent settings"
            aria-label="Proactive agent settings"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: 'var(--xp-text-muted)',
              opacity: 0.6,
            }}
          >
            <Settings size={12} />
          </button>

          {showSettings && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                right: 0,
                marginBottom: '4px',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-surface)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                whiteSpace: 'nowrap',
                zIndex: 10,
                fontSize: '11px',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  color: 'var(--xp-text)',
                }}
              >
                <input
                  type="checkbox"
                  checked={proactiveEnabled}
                  onChange={(e) => onToggleProactive(e.target.checked)}
                  style={{ accentColor: 'var(--xp-blue)' }}
                />
                Proactive suggestions
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProactiveSuggestionCard;
