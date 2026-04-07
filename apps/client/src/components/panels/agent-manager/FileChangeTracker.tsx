/**
 * File Change Tracker — displays per-agent file change lists inside
 * the Agent Manager panel.  Each agent gets a collapsible section
 * showing which files were created, modified, or deleted, with
 * timestamps and click-to-navigate behaviour.
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileEdit,
  Trash2,
  ExternalLink,
  X,
} from 'lucide-react';
import type { AgentFileChanges, TrackedFileChange, FileChangeType } from './use-file-changes';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FileChangeTrackerProps {
  /** All tracked changes keyed by agent id */
  changesByAgent: Map<string, AgentFileChanges>;
  /** Navigate the main file browser to a given path */
  onNavigateToFile?: (filePath: string) => void;
  /** Open a before/after diff view for a file */
  onViewDiff?: (filePath: string) => void;
  /** Clear changes for a specific agent */
  onClearAgent?: (agentId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANGE_TYPE_CONFIG: Record<
  FileChangeType,
  { color: string; label: string; Icon: typeof FilePlus2 }
> = {
  created: {
    color: 'var(--xp-green, #73daca)',
    label: 'agentManager.fileChanges.created',
    Icon: FilePlus2,
  },
  modified: {
    color: 'var(--xp-warning, #e0af68)',
    label: 'agentManager.fileChanges.modified',
    Icon: FileEdit,
  },
  deleted: {
    color: 'var(--xp-red, #f7768e)',
    label: 'agentManager.fileChanges.deleted',
    Icon: Trash2,
  },
};

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const FileChangeRow = ({
  change,
  onNavigate,
  onViewDiff,
}: {
  change: TrackedFileChange;
  onNavigate?: (path: string) => void;
  onViewDiff?: (path: string) => void;
}) => {
  const { t } = useTranslation();
  const config = CHANGE_TYPE_CONFIG[change.changeType];
  const { Icon } = config;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 0',
        fontSize: '10px',
        color: 'var(--xp-text)',
      }}
    >
      <Icon size={11} style={{ flexShrink: 0, color: config.color }} />
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          cursor: onNavigate ? 'pointer' : 'default',
        }}
        title={change.path}
        onClick={onNavigate ? () => onNavigate(change.path) : undefined}
      >
        {change.name}
      </span>

      <span
        style={{
          fontSize: '9px',
          color: config.color,
          flexShrink: 0,
          textTransform: 'uppercase',
          fontWeight: 500,
        }}
      >
        {t(config.label)}
      </span>

      <span
        style={{
          fontSize: '9px',
          color: 'var(--xp-text-muted)',
          flexShrink: 0,
        }}
      >
        {formatTimestamp(change.timestamp)}
      </span>

      {onNavigate && (
        <button
          onClick={() => onNavigate(change.path)}
          title={t('agentManager.fileChanges.goToFile')}
          aria-label={t('agentManager.fileChanges.goToFile')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            padding: '0 1px',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <ExternalLink size={10} />
        </button>
      )}

      {onViewDiff && change.changeType !== 'deleted' && (
        <button
          onClick={() => onViewDiff(change.path)}
          title={t('agentManager.fileChanges.viewDiff')}
          aria-label={t('agentManager.fileChanges.viewDiff')}
          style={{
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '3px',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            padding: '1px 4px',
            fontSize: '9px',
            flexShrink: 0,
          }}
        >
          {t('agentManager.fileChanges.diff')}
        </button>
      )}
    </div>
  );
};

const AgentChangeSection = ({
  entry,
  onNavigate,
  onViewDiff,
  onClear,
}: {
  entry: AgentFileChanges;
  onNavigate?: (path: string) => void;
  onViewDiff?: (path: string) => void;
  onClear?: () => void;
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const createdCount = entry.changes.filter((c) => c.changeType === 'created').length;
  const modifiedCount = entry.changes.filter((c) => c.changeType === 'modified').length;
  const deletedCount = entry.changes.filter((c) => c.changeType === 'deleted').length;

  return (
    <div
      style={{
        border: '1px solid var(--xp-border)',
        borderRadius: '6px',
        background: 'var(--xp-surface)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 8px',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        ) : (
          <ChevronRight size={12} style={{ flexShrink: 0, color: 'var(--xp-text-muted)' }} />
        )}

        <span
          style={{
            flex: 1,
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--xp-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.agentName}
        </span>

        {/* Summary badges */}
        {createdCount > 0 && (
          <span
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: 'var(--xp-green, #73daca)',
              padding: '0 4px',
            }}
          >
            +{createdCount}
          </span>
        )}
        {modifiedCount > 0 && (
          <span
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: 'var(--xp-warning, #e0af68)',
              padding: '0 4px',
            }}
          >
            ~{modifiedCount}
          </span>
        )}
        {deletedCount > 0 && (
          <span
            style={{
              fontSize: '9px',
              fontWeight: 600,
              color: 'var(--xp-red, #f7768e)',
              padding: '0 4px',
            }}
          >
            -{deletedCount}
          </span>
        )}

        {onClear && entry.changes.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            title={t('agentManager.fileChanges.clear')}
            aria-label={t('agentManager.fileChanges.clear')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--xp-text-muted)',
              padding: '0 2px',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* File list */}
      {expanded && (
        <div
          style={{
            padding: '0 8px 6px',
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          {entry.changes.length === 0 ? (
            <div
              style={{
                fontSize: '10px',
                color: 'var(--xp-text-muted)',
                textAlign: 'center',
                padding: '6px 0',
              }}
            >
              {t('agentManager.fileChanges.noChanges')}
            </div>
          ) : (
            entry.changes.map((change, idx) => (
              <FileChangeRow
                key={`${change.path}-${change.timestamp}-${idx}`}
                change={change}
                onNavigate={onNavigate}
                onViewDiff={onViewDiff}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const FileChangeTracker = ({
  changesByAgent,
  onNavigateToFile,
  onViewDiff,
  onClearAgent,
}: FileChangeTrackerProps) => {
  const { t } = useTranslation();

  const handleNavigate = useCallback(
    (filePath: string) => {
      if (onNavigateToFile) {
        onNavigateToFile(filePath);
        return;
      }
      // Fallback: navigate via the extension host bridge
      const state = (
        window as unknown as { __xplorer_state__?: { navigateTo?: (p: string) => void } }
      ).__xplorer_state__;
      state?.navigateTo?.(filePath);
    },
    [onNavigateToFile],
  );

  const entries = Array.from(changesByAgent.values()).filter((e) => e.changes.length > 0);

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: '12px',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          textAlign: 'center',
        }}
      >
        {t('agentManager.fileChanges.empty')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {entries.map((entry) => (
        <AgentChangeSection
          key={entry.agentId}
          entry={entry}
          onNavigate={handleNavigate}
          onViewDiff={onViewDiff}
          onClear={onClearAgent ? () => onClearAgent(entry.agentId) : undefined}
        />
      ))}
    </div>
  );
};

export default FileChangeTracker;
