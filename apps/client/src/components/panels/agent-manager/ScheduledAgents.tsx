/**
 * Scheduled Agents section for the Agent Manager panel.
 * Shows all schedules with toggle, edit, delete, and "run now" controls.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, Play, Pencil, Trash2, Power, Folder } from 'lucide-react';
import {
  deleteSchedule,
  toggleSchedule,
  formatFrequency,
  formatRelativeTime,
  scheduleToSessionParams,
  markRan,
  recordRun,
  type ScheduledAgent,
} from './scheduled-agents';
import { useSchedules } from './use-schedule-runner';
import ScheduleAgentForm from './ScheduleAgentForm';
import { TauriAPI } from '@/lib/tauri-api';

const basenameOf = (path: string): string => {
  if (!path) return '';
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
};

const ScheduledAgents = () => {
  const { t } = useTranslation();
  const schedules = useSchedules();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ScheduledAgent | null>(null);

  const handleRunNow = async (sched: ScheduledAgent) => {
    try {
      const params = scheduleToSessionParams(sched);
      const session = await TauriAPI.createAgentSession(params);
      markRan(sched.id);
      recordRun({
        scheduleId: sched.id,
        ranAt: Date.now(),
        sessionId: session.id,
        status: 'success',
      });
    } catch (err) {
      console.error('[ScheduledAgents] Failed to run now:', err);
    }
  };

  const handleDelete = (id: string) => {
    if (
      confirm(
        t('agentManager.schedule.confirmDelete', {
          defaultValue: 'Delete this schedule?',
        }) as string,
      )
    ) {
      deleteSchedule(id);
    }
  };

  if (showForm || editing) {
    return (
      <ScheduleAgentForm
        initial={editing ?? undefined}
        onClose={() => {
          setShowForm(false);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {schedules.length === 0 ? (
        <div
          style={{
            padding: '16px 12px',
            textAlign: 'center',
            fontSize: '11px',
            color: 'var(--xp-text-muted)',
            background: 'var(--xp-surface-light)',
            borderRadius: '6px',
            border: '1px dashed var(--xp-border)',
          }}
        >
          <Calendar size={20} style={{ opacity: 0.5, marginBottom: '6px' }} />
          <div>
            {t('agentManager.schedule.empty', {
              defaultValue: 'No scheduled agents yet',
            })}
          </div>
          <div style={{ marginTop: '4px', fontSize: '10px' }}>
            {t('agentManager.schedule.emptyHint', {
              defaultValue: 'Schedule daily cleanups, weekly reviews, etc.',
            })}
          </div>
        </div>
      ) : (
        schedules.map((sched) => (
          <ScheduleCard
            key={sched.id}
            sched={sched}
            onRunNow={() => handleRunNow(sched)}
            onEdit={() => setEditing(sched)}
            onDelete={() => handleDelete(sched.id)}
            onToggle={() => toggleSchedule(sched.id)}
          />
        ))
      )}

      <button
        onClick={() => setShowForm(true)}
        style={{
          padding: '6px 8px',
          fontSize: '11px',
          background: 'transparent',
          border: '1px dashed var(--xp-border)',
          borderRadius: '4px',
          color: 'var(--xp-text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--xp-blue)';
          e.currentTarget.style.color = 'var(--xp-blue)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--xp-border)';
          e.currentTarget.style.color = 'var(--xp-text-muted)';
        }}
      >
        <Plus size={12} />
        {t('agentManager.schedule.add', { defaultValue: 'New scheduled agent' })}
      </button>
    </div>
  );
};

interface ScheduleCardProps {
  sched: ScheduledAgent;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

const ScheduleCard = ({ sched, onRunNow, onEdit, onDelete, onToggle }: ScheduleCardProps) => {
  const dirName = basenameOf(sched.workingDirectory);

  return (
    <div
      style={{
        padding: '8px',
        background: sched.enabled ? 'var(--xp-surface-light)' : 'var(--xp-surface)',
        border: '1px solid var(--xp-border)',
        borderLeft: `3px solid ${sched.enabled ? 'var(--xp-blue)' : 'var(--xp-text-muted)'}`,
        borderRadius: '4px',
        opacity: sched.enabled ? 1 : 0.6,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      {/* Top row: name + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--xp-text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={sched.name}
        >
          {sched.name}
        </div>
        <button
          onClick={onToggle}
          title={sched.enabled ? 'Pause schedule' : 'Resume schedule'}
          style={iconBtnStyle(sched.enabled ? 'var(--xp-green, #73daca)' : 'var(--xp-text-muted)')}
        >
          <Power size={11} />
        </button>
        <button onClick={onRunNow} title="Run now" style={iconBtnStyle('var(--xp-blue)')}>
          <Play size={11} />
        </button>
        <button onClick={onEdit} title="Edit" style={iconBtnStyle('var(--xp-text-muted)')}>
          <Pencil size={11} />
        </button>
        <button onClick={onDelete} title="Delete" style={iconBtnStyle('var(--xp-red, #f7768e)')}>
          <Trash2 size={11} />
        </button>
      </div>

      {/* Frequency line */}
      <div
        style={{
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <Calendar size={10} style={{ flexShrink: 0 }} />
        <span>{formatFrequency(sched.frequency)}</span>
      </div>

      {/* Directory + next run */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
        }}
      >
        {dirName && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
            title={sched.workingDirectory}
          >
            <Folder size={10} />
            {dirName}
          </span>
        )}
        {sched.enabled && (
          <span style={{ marginLeft: 'auto' }}>Next: {formatRelativeTime(sched.nextRunAt)}</span>
        )}
      </div>

      {/* Stats */}
      {sched.runCount > 0 && (
        <div style={{ fontSize: '10px', color: 'var(--xp-text-muted)' }}>
          Ran {sched.runCount}× · Last:{' '}
          {sched.lastRunAt ? formatRelativeTime(sched.lastRunAt) : 'never'}
        </div>
      )}
    </div>
  );
};

const iconBtnStyle = (color: string): React.CSSProperties => ({
  padding: '3px',
  background: 'transparent',
  border: 'none',
  color,
  cursor: 'pointer',
  borderRadius: '3px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export default ScheduledAgents;
