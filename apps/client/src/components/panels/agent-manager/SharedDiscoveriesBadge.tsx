/**
 * Shared Discoveries section for the Agent Manager panel.
 *
 * Shows discoveries that agents have broadcast, with type badges,
 * source session info, and clear/remove controls.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import {
  getAllDiscoveries,
  removeDiscovery,
  clearAllDiscoveries,
  subscribeToDiscoveries,
  DISCOVERY_TYPE_COLORS,
  type Discovery,
} from './agent-shared-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const typeLabel = (type: string): string =>
  type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SharedDiscoveriesBadge = () => {
  const { t } = useTranslation();
  const [discoveries, setDiscoveries] = useState<Discovery[]>(getAllDiscoveries);

  // Re-read on changes
  useEffect(() => {
    const unsub = subscribeToDiscoveries(() => {
      setDiscoveries(getAllDiscoveries());
    });
    return unsub;
  }, []);

  const handleRemove = useCallback((id: string) => {
    removeDiscovery(id);
  }, []);

  const handleClearAll = useCallback(() => {
    clearAllDiscoveries();
  }, []);

  if (discoveries.length === 0) {
    return (
      <div
        style={{
          padding: '12px',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          textAlign: 'center',
        }}
      >
        {t('agentManager.discoveries.empty')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {/* Clear all button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2px' }}>
        <button
          onClick={handleClearAll}
          title={t('agentManager.discoveries.clearAll')}
          style={{
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            padding: '2px 6px',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            fontSize: '10px',
          }}
        >
          <Trash2 size={10} />
          {t('agentManager.discoveries.clearAll')}
        </button>
      </div>

      {/* Discovery list */}
      {discoveries.map((disc) => {
        const color = DISCOVERY_TYPE_COLORS[disc.type];

        return (
          <div
            key={disc.id}
            style={{
              border: '1px solid var(--xp-border)',
              borderRadius: '6px',
              padding: '8px',
              background: 'var(--xp-surface)',
              fontSize: '11px',
            }}
          >
            {/* Header: type badge + time + remove */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '4px',
              }}
            >
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '4px',
                  background: `${color}22`,
                  color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  flexShrink: 0,
                }}
              >
                {typeLabel(disc.type)}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={disc.sourceSessionName}
              >
                {disc.sourceSessionName}
              </span>
              <span
                style={{
                  fontSize: '9px',
                  color: 'var(--xp-text-muted)',
                  flexShrink: 0,
                }}
              >
                {formatTimestamp(disc.timestamp)}
              </span>
              <button
                onClick={() => handleRemove(disc.id)}
                title={t('agentManager.discoveries.remove')}
                aria-label={t('agentManager.discoveries.remove')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '1px',
                  cursor: 'pointer',
                  color: 'var(--xp-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={10} />
              </button>
            </div>

            {/* Content */}
            <div
              style={{
                color: 'var(--xp-text)',
                lineHeight: '1.4',
                wordBreak: 'break-word',
              }}
            >
              {disc.content}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SharedDiscoveriesBadge;
