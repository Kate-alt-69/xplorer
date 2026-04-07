/**
 * Agent Templates — a grid of pre-built agent templates that users can
 * launch with one click. Each template pre-fills the New Agent form
 * with a curated name, system prompt, default model, and estimated cost.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SearchCode,
  FlaskConical,
  Bug,
  BookOpen,
  RefreshCw,
  ShieldAlert,
  Gauge,
  FolderPlus,
} from 'lucide-react';
import { AGENT_TEMPLATES, type AgentTemplate } from './agent-templates-data';
import type { CreateSessionParams } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentTemplatesProps {
  /** Called when a template is selected — pre-fills the agent form */
  onSelectTemplate: (params: CreateSessionParams) => void;
  /** Whether launching is disabled (e.g. an agent is already running) */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Icon resolver — maps string icon names to lucide components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<
  string,
  React.ComponentType<{ size?: number; style?: React.CSSProperties }>
> = {
  SearchCode,
  FlaskConical,
  Bug,
  BookOpen,
  RefreshCw,
  ShieldAlert,
  Gauge,
  FolderPlus,
};

const resolveIcon = (
  iconName: string,
): React.ComponentType<{ size?: number; style?: React.CSSProperties }> => {
  return ICON_MAP[iconName] ?? SearchCode;
};

// ---------------------------------------------------------------------------
// Template Card
// ---------------------------------------------------------------------------

const TemplateCard = ({
  template,
  onSelect,
  disabled,
  t,
}: {
  template: AgentTemplate;
  onSelect: (template: AgentTemplate) => void;
  disabled?: boolean;
  t: (key: string) => string;
}) => {
  const IconComponent = resolveIcon(template.icon);

  return (
    <button
      onClick={() => onSelect(template)}
      disabled={disabled}
      title={t(template.descriptionKey)}
      aria-label={t(template.nameKey)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px',
        borderRadius: '6px',
        border: '1px solid var(--xp-border)',
        background: 'var(--xp-surface)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
        transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--xp-surface-light)';
          e.currentTarget.style.borderColor = template.accentColor;
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--xp-surface)';
        e.currentTarget.style.borderColor = 'var(--xp-border)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Icon + name row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span
          style={{
            color: template.accentColor,
            flexShrink: 0,
            display: 'flex',
          }}
        >
          <IconComponent size={16} />
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--xp-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {t(template.nameKey)}
        </span>
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          lineHeight: '1.3',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {t(template.descriptionKey)}
      </div>

      {/* Footer — estimated cost */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '9px',
          color: 'var(--xp-text-muted)',
          marginTop: 'auto',
        }}
      >
        <span>
          {t('agentManager.templates.estimatedCost')}: ~${template.estimatedCostUsd.toFixed(2)}
        </span>
      </div>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const AgentTemplates = ({ onSelectTemplate, disabled }: AgentTemplatesProps) => {
  const { t } = useTranslation();

  const handleSelect = useCallback(
    (template: AgentTemplate) => {
      const params: CreateSessionParams = {
        name: t(template.nameKey),
        prompt: template.systemPrompt,
        model: template.defaultModel,
        working_directory: '/',
      };
      onSelectTemplate(params);
    },
    [onSelectTemplate, t],
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '4px',
      }}
    >
      {AGENT_TEMPLATES.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          onSelect={handleSelect}
          disabled={disabled}
          t={t}
        />
      ))}
    </div>
  );
};

export default AgentTemplates;
