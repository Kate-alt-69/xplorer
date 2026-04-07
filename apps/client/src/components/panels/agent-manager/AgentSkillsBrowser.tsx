/**
 * Agent Skills Browser — browse and install community-contributed agent skills
 * from the extension marketplace.
 *
 * Skills are extension packages with `category: "agent-skill"` in their manifest.
 * Each skill provides: system prompt, default model, tool permissions, and description.
 * Installed skills appear in the templates grid alongside built-in templates.
 *
 * Uses mock data for marketplace skills (actual marketplace integration later).
 */
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  CheckCircle2,
  Star,
  Search,
  Loader2,
  Package,
  Shield,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import type { AgentTemplate } from './agent-templates-data';
import type { CreateSessionParams } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A marketplace agent skill extension manifest */
export interface MarketplaceSkill {
  /** Unique skill package identifier (e.g. "community/sql-migration-agent") */
  id: string;
  /** Display name */
  name: string;
  /** Short description of what this skill does */
  description: string;
  /** Author name */
  author: string;
  /** Number of installs */
  installCount: number;
  /** Average rating (0-5) */
  rating: number;
  /** Accent color for the card */
  accentColor: string;
  /** System prompt the skill provides */
  systemPrompt: string;
  /** Default model recommendation */
  defaultModel: string;
  /** Estimated cost per run in USD */
  estimatedCostUsd: number;
  /** Tool permissions this skill requires */
  toolPermissions: string[];
  /** Version string */
  version: string;
  /** Category tag for filtering */
  tags: string[];
}

export type SkillInstallStatus = 'available' | 'installing' | 'installed';

interface AgentSkillsBrowserProps {
  /** Called when user wants to use an installed skill as a template */
  onSelectSkill: (params: CreateSessionParams) => void;
  /** Whether launching is disabled (e.g. an agent is already running) */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Mock marketplace data
// ---------------------------------------------------------------------------

const MOCK_MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  {
    id: 'community/sql-migration-agent',
    name: 'SQL Migration Agent',
    description:
      'Analyzes database schemas, generates migration scripts, and validates them against existing data. Supports PostgreSQL, MySQL, and SQLite.',
    author: 'dbtools',
    installCount: 2450,
    rating: 4.7,
    accentColor: 'var(--xp-blue, #7aa2f7)',
    systemPrompt:
      'You are a database migration specialist. Analyze the current database schema files and generate safe, reversible migration scripts. Always include rollback instructions.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.12,
    toolPermissions: ['read_file', 'create_file', 'run_command'],
    version: '1.3.0',
    tags: ['database', 'sql', 'migration'],
  },
  {
    id: 'community/api-doc-generator',
    name: 'API Doc Generator',
    description:
      'Scans REST/GraphQL endpoints, extracts types and routes, generates OpenAPI specs and interactive documentation.',
    author: 'apiforge',
    installCount: 1830,
    rating: 4.5,
    accentColor: 'var(--xp-green, #73daca)',
    systemPrompt:
      'You are an API documentation expert. Scan source files for route handlers, extract request/response types, and generate comprehensive OpenAPI 3.0 specifications with examples.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.15,
    toolPermissions: ['read_file', 'create_file', 'search_files'],
    version: '2.1.0',
    tags: ['api', 'documentation', 'openapi'],
  },
  {
    id: 'community/dependency-updater',
    name: 'Dependency Updater',
    description:
      'Checks for outdated dependencies, reviews changelogs for breaking changes, and creates safe update PRs with migration notes.',
    author: 'depbot',
    installCount: 3120,
    rating: 4.8,
    accentColor: 'var(--xp-warning, #e0af68)',
    systemPrompt:
      'You are a dependency management specialist. Analyze package manifests, identify outdated dependencies, check changelogs for breaking changes, and suggest a safe upgrade path with migration steps.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.1,
    toolPermissions: ['read_file', 'edit_file', 'run_command'],
    version: '1.0.2',
    tags: ['dependencies', 'npm', 'cargo', 'pip'],
  },
  {
    id: 'community/i18n-translator',
    name: 'i18n Translator',
    description:
      'Scans for hardcoded strings, extracts them to locale files, and generates translations for multiple languages using context-aware translation.',
    author: 'globaldev',
    installCount: 980,
    rating: 4.3,
    accentColor: 'var(--xp-purple, #bb9af7)',
    systemPrompt:
      'You are an internationalization expert. Scan source files for hardcoded user-facing strings, extract them to i18n locale files using the project conventions, and generate translations for target languages. Preserve context and tone.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.18,
    toolPermissions: ['read_file', 'edit_file', 'create_file', 'search_files'],
    version: '0.9.1',
    tags: ['i18n', 'translation', 'localization'],
  },
  {
    id: 'community/ci-pipeline-builder',
    name: 'CI Pipeline Builder',
    description:
      'Analyzes project structure and generates CI/CD pipelines for GitHub Actions, GitLab CI, or CircleCI with test, lint, build, and deploy stages.',
    author: 'citools',
    installCount: 1560,
    rating: 4.6,
    accentColor: 'var(--xp-cyan, #7dcfff)',
    systemPrompt:
      'You are a CI/CD pipeline expert. Analyze the project structure, detect the tech stack, and generate a comprehensive CI/CD configuration with stages for linting, testing, building, and deployment. Follow best practices for caching and parallelism.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.08,
    toolPermissions: ['read_file', 'create_file', 'list_directory'],
    version: '1.2.0',
    tags: ['ci', 'cd', 'devops', 'github-actions'],
  },
  {
    id: 'community/accessibility-checker',
    name: 'Accessibility Checker',
    description:
      'Audits React/HTML components for WCAG compliance, identifies a11y issues, and generates fixes with proper ARIA attributes and semantic HTML.',
    author: 'a11ydev',
    installCount: 720,
    rating: 4.4,
    accentColor: 'var(--xp-teal, #2ac3de)',
    systemPrompt:
      'You are an accessibility expert. Audit React and HTML components for WCAG 2.1 AA compliance. Identify missing ARIA attributes, incorrect roles, keyboard navigation issues, color contrast problems, and semantic HTML violations. Provide specific fixes.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.14,
    toolPermissions: ['read_file', 'edit_file', 'search_files'],
    version: '1.1.0',
    tags: ['accessibility', 'a11y', 'wcag', 'react'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format install count for display (e.g. 1234 -> "1.2K") */
const formatInstallCount = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
};

/** Render star rating as a visual indicator */
const StarRating = ({ rating }: { rating: number }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '2px',
      fontSize: '9px',
      color: 'var(--xp-warning, #e0af68)',
    }}
  >
    <Star size={9} style={{ fill: 'currentColor' }} />
    {rating.toFixed(1)}
  </span>
);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Individual skill card in the marketplace grid */
const SkillCard = ({
  skill,
  status,
  onInstall,
  onUse,
  disabled,
  t,
}: {
  skill: MarketplaceSkill;
  status: SkillInstallStatus;
  onInstall: () => void;
  onUse: () => void;
  disabled?: boolean;
  t: (key: string) => string;
}) => {
  const isInstalled = status === 'installed';
  const isInstalling = status === 'installing';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px',
        borderRadius: '6px',
        border: `1px solid ${isInstalled ? skill.accentColor : 'var(--xp-border)'}`,
        background: 'var(--xp-surface)',
        transition: 'border-color 0.15s ease, transform 0.1s ease',
      }}
      onMouseEnter={(e) => {
        if (!isInstalled) {
          e.currentTarget.style.borderColor = skill.accentColor;
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isInstalled) {
          e.currentTarget.style.borderColor = 'var(--xp-border)';
          e.currentTarget.style.transform = 'translateY(0)';
        }
      }}
    >
      {/* Header: name + version */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <Package size={14} style={{ color: skill.accentColor, flexShrink: 0 }} />
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--xp-text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {skill.name}
        </span>
        <span
          style={{
            fontSize: '9px',
            color: 'var(--xp-text-muted)',
            flexShrink: 0,
          }}
        >
          v{skill.version}
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
        {skill.description}
      </div>

      {/* Author + stats row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '9px',
          color: 'var(--xp-text-muted)',
        }}
      >
        <span>{skill.author}</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          <Download size={8} />
          {formatInstallCount(skill.installCount)}
        </span>
        <StarRating rating={skill.rating} />
        <span style={{ marginLeft: 'auto' }}>
          ~${skill.estimatedCostUsd.toFixed(2)}/{t('agentManager.skillsBrowser.perRun')}
        </span>
      </div>

      {/* Tool permissions */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '3px',
        }}
      >
        {skill.toolPermissions.map((perm) => (
          <span
            key={perm}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              fontSize: '8px',
              padding: '1px 4px',
              borderRadius: '3px',
              background: 'var(--xp-surface-light, rgba(255,255,255,0.05))',
              color: 'var(--xp-text-muted)',
            }}
          >
            <Shield size={7} />
            {perm.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginTop: 'auto',
        }}
      >
        {isInstalled ? (
          <button
            onClick={onUse}
            disabled={disabled}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '4px',
              border: `1px solid ${skill.accentColor}`,
              background: `${skill.accentColor}22`,
              color: skill.accentColor,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '10px',
              fontWeight: 600,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <CheckCircle2 size={10} />
            {t('agentManager.skillsBrowser.useSkill')}
          </button>
        ) : (
          <button
            onClick={onInstall}
            disabled={isInstalling}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid var(--xp-green, #73daca)',
              background: isInstalling
                ? 'var(--xp-surface-light, rgba(255,255,255,0.05))'
                : 'rgba(115, 218, 202, 0.15)',
              color: 'var(--xp-green, #73daca)',
              cursor: isInstalling ? 'default' : 'pointer',
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
            {isInstalling ? (
              <>
                <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                {t('agentManager.skillsBrowser.installing')}
              </>
            ) : (
              <>
                <Download size={10} />
                {t('agentManager.skillsBrowser.install')}
              </>
            )}
          </button>
        )}

        {/* Details link */}
        <button
          title={t('agentManager.skillsBrowser.viewDetails')}
          aria-label={t('agentManager.skillsBrowser.viewDetails')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background: 'none',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** Browse and install community agent skills from the marketplace */
const AgentSkillsBrowser = ({ onSelectSkill, disabled }: AgentSkillsBrowserProps) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [installStatuses, setInstallStatuses] = useState<Map<string, SkillInstallStatus>>(
    new Map(),
  );

  /** Filter skills by search query */
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return MOCK_MARKETPLACE_SKILLS;
    const query = searchQuery.toLowerCase();
    return MOCK_MARKETPLACE_SKILLS.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.author.toLowerCase().includes(query) ||
        skill.tags.some((tag) => tag.includes(query)),
    );
  }, [searchQuery]);

  /** Simulate installing a skill */
  const handleInstall = useCallback((skillId: string) => {
    setInstallStatuses((prev) => {
      const next = new Map(prev);
      next.set(skillId, 'installing');
      return next;
    });

    // Simulate install delay
    setTimeout(() => {
      setInstallStatuses((prev) => {
        const next = new Map(prev);
        next.set(skillId, 'installed');
        return next;
      });
    }, 1500);
  }, []);

  /** Convert an installed skill to a CreateSessionParams and pass to parent */
  const handleUseSkill = useCallback(
    (skill: MarketplaceSkill) => {
      const params: CreateSessionParams = {
        name: skill.name,
        prompt: skill.systemPrompt,
        model: skill.defaultModel,
        working_directory: '/',
      };
      onSelectSkill(params);
    },
    [onSelectSkill],
  );

  const getStatus = (skillId: string): SkillInstallStatus =>
    installStatuses.get(skillId) ?? 'available';

  const installedCount = useMemo(
    () => Array.from(installStatuses.values()).filter((s) => s === 'installed').length,
    [installStatuses],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Header with search and stats */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            padding: '4px 8px',
            background: 'var(--xp-surface)',
          }}
        >
          <Search size={12} style={{ color: 'var(--xp-text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('agentManager.skillsBrowser.searchPlaceholder')}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--xp-text)',
              fontSize: '11px',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {installedCount > 0 && (
          <span
            style={{
              fontSize: '9px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '8px',
              background: 'var(--xp-green, #73daca)',
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {installedCount} {t('agentManager.skillsBrowser.installedBadge')}
          </span>
        )}

        <button
          title={t('agentManager.skillsBrowser.refresh')}
          aria-label={t('agentManager.skillsBrowser.refresh')}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            background: 'none',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Results count */}
      <div
        style={{
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <Package size={10} />
        {t('agentManager.skillsBrowser.resultsCount', {
          count: filteredSkills.length,
        })}
      </div>

      {/* Skills grid */}
      {filteredSkills.length === 0 ? (
        <div
          style={{
            padding: '16px',
            textAlign: 'center',
            color: 'var(--xp-text-muted)',
            fontSize: '11px',
          }}
        >
          {t('agentManager.skillsBrowser.noResults')}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              status={getStatus(skill.id)}
              onInstall={() => handleInstall(skill.id)}
              onUse={() => handleUseSkill(skill)}
              disabled={disabled}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** Convert installed marketplace skills to AgentTemplate format for the templates grid */
export const installedSkillsToTemplates = (
  statuses: Map<string, SkillInstallStatus>,
): AgentTemplate[] =>
  MOCK_MARKETPLACE_SKILLS.filter((skill) => statuses.get(skill.id) === 'installed').map(
    (skill) => ({
      id: `skill-${skill.id}`,
      nameKey: skill.name,
      descriptionKey: skill.description,
      icon: 'Package',
      systemPrompt: skill.systemPrompt,
      defaultModel: skill.defaultModel,
      estimatedCostUsd: skill.estimatedCostUsd,
      accentColor: skill.accentColor,
    }),
  );

export default AgentSkillsBrowser;
