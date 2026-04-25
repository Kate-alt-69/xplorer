/**
 * Form to create or edit a scheduled agent.
 * Picks frequency (once/interval/hourly/daily/weekly/monthly), prompt, model, scope.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, X } from 'lucide-react';
import { getXplorerState } from '@/components/panels/chat-context-helpers';
import {
  createSchedule,
  updateSchedule,
  type ScheduledAgent,
  type ScheduleFrequency,
} from './scheduled-agents';

interface ScheduleAgentFormProps {
  /** If editing an existing schedule */
  initial?: ScheduledAgent;
  onClose: () => void;
}

type FrequencyType = ScheduleFrequency['type'];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '12px',
  background: 'var(--xp-bg)',
  border: '1px solid var(--xp-border)',
  borderRadius: '4px',
  color: 'var(--xp-text)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--xp-text-muted)',
  marginBottom: '2px',
  display: 'block',
};

const dayOptions: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const ScheduleAgentForm = ({ initial, onClose }: ScheduleAgentFormProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [model, setModel] = useState(initial?.model ?? 'openrouter:anthropic/claude-sonnet-4');
  const [workingDir, setWorkingDir] = useState(initial?.workingDirectory ?? '');
  const POPULAR_MODELS = [
    'openrouter:anthropic/claude-sonnet-4',
    'openrouter:anthropic/claude-haiku-3.5',
    'openrouter:openai/gpt-4.1',
    'openrouter:openai/o4-mini',
    'openrouter:google/gemini-2.5-flash',
    'openrouter:deepseek/deepseek-r1',
  ];
  const [freqType, setFreqType] = useState<FrequencyType>(initial?.frequency.type ?? 'daily');

  // Frequency-specific state
  const [everyMinutes, setEveryMinutes] = useState(60);
  const [hourMinute, setHourMinute] = useState({ hour: 9, minute: 0 });
  const [weekly, setWeekly] = useState({ dayOfWeek: 1, hour: 9, minute: 0 });
  const [monthly, setMonthly] = useState({ day: 1, hour: 9, minute: 0 });
  const [hourlyMinute, setHourlyMinute] = useState(0);
  const [onceDateTime, setOnceDateTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
  });

  // Initialize from initial schedule
  useEffect(() => {
    if (!initial) {
      // Default working directory to current path
      const xs = getXplorerState();
      if (xs?.currentPath) setWorkingDir(xs.currentPath);
      return;
    }
    const f = initial.frequency;
    if (f.type === 'interval') setEveryMinutes(f.everyMinutes);
    if (f.type === 'hourly') setHourlyMinute(f.minute);
    if (f.type === 'daily') setHourMinute({ hour: f.hour, minute: f.minute });
    if (f.type === 'weekly') setWeekly(f);
    if (f.type === 'monthly') setMonthly(f);
    if (f.type === 'once') {
      const d = new Date(f.runAt);
      setOnceDateTime(
        new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      );
    }
  }, [initial]);

  const buildFrequency = (): ScheduleFrequency => {
    switch (freqType) {
      case 'once':
        return { type: 'once', runAt: new Date(onceDateTime).getTime() };
      case 'interval':
        return { type: 'interval', everyMinutes };
      case 'hourly':
        return { type: 'hourly', minute: hourlyMinute };
      case 'daily':
        return { type: 'daily', ...hourMinute };
      case 'weekly':
        return { type: 'weekly', ...weekly };
      case 'monthly':
        return { type: 'monthly', ...monthly };
    }
  };

  const handleSave = () => {
    if (!prompt.trim()) return;
    const frequency = buildFrequency();
    const data = {
      name: name.trim() || prompt.slice(0, 40),
      prompt: prompt.trim(),
      model,
      workingDirectory: workingDir.trim(),
      frequency,
      enabled: initial?.enabled ?? true,
    };
    if (initial) {
      updateSchedule(initial.id, data);
    } else {
      createSchedule(data);
    }
    onClose();
  };

  return (
    <div
      style={{
        padding: '10px',
        background: 'var(--xp-surface)',
        border: '1px solid var(--xp-border)',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <Calendar size={13} style={{ color: 'var(--xp-blue)' }} />
          {initial
            ? t('agentManager.schedule.editTitle', { defaultValue: 'Edit schedule' })
            : t('agentManager.schedule.newTitle', { defaultValue: 'New scheduled agent' })}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            padding: '2px',
          }}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Name */}
      <div>
        <label style={labelStyle}>
          {t('agentManager.schedule.name', { defaultValue: 'Name (optional)' })}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekly cleanup"
          style={inputStyle}
        />
      </div>

      {/* Prompt */}
      <div>
        <label style={labelStyle}>
          {t('agentManager.schedule.prompt', { defaultValue: 'What should the agent do?' })}
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Organize files in Downloads by type..."
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      {/* Model */}
      <div>
        <label style={labelStyle}>
          {t('agentManager.schedule.model', { defaultValue: 'Model' })}
        </label>
        <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
          {POPULAR_MODELS.map((m) => (
            <option key={m} value={m}>
              {m.replace('openrouter:', '')}
            </option>
          ))}
          {!POPULAR_MODELS.includes(model) && <option value={model}>{model}</option>}
        </select>
      </div>

      {/* Working directory */}
      <div>
        <label style={labelStyle}>
          {t('agentManager.schedule.directory', { defaultValue: 'Working directory' })}
        </label>
        <input
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          placeholder="/Users/you/Downloads"
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '11px' }}
        />
      </div>

      {/* Frequency type picker */}
      <div>
        <label style={labelStyle}>
          {t('agentManager.schedule.frequency', { defaultValue: 'Frequency' })}
        </label>
        <select
          value={freqType}
          onChange={(e) => setFreqType(e.target.value as FrequencyType)}
          style={inputStyle}
        >
          <option value="once">Once</option>
          <option value="interval">Every N minutes</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {/* Frequency-specific inputs */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'flex-end',
          padding: '8px',
          background: 'var(--xp-surface-light)',
          borderRadius: '4px',
        }}
      >
        <Clock
          size={13}
          style={{ color: 'var(--xp-text-muted)', flexShrink: 0, marginBottom: '7px' }}
        />

        {freqType === 'once' && (
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Run at</label>
            <input
              type="datetime-local"
              value={onceDateTime}
              onChange={(e) => setOnceDateTime(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        {freqType === 'interval' && (
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Every</label>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="number"
                min={1}
                max={1440}
                value={everyMinutes}
                onChange={(e) => setEveryMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                style={inputStyle}
              />
              <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)' }}>minutes</span>
            </div>
          </div>
        )}

        {freqType === 'hourly' && (
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>At minute</label>
            <input
              type="number"
              min={0}
              max={59}
              value={hourlyMinute}
              onChange={(e) =>
                setHourlyMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))
              }
              style={inputStyle}
            />
          </div>
        )}

        {freqType === 'daily' && (
          <>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Hour</label>
              <input
                type="number"
                min={0}
                max={23}
                value={hourMinute.hour}
                onChange={(e) =>
                  setHourMinute({
                    ...hourMinute,
                    hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Minute</label>
              <input
                type="number"
                min={0}
                max={59}
                value={hourMinute.minute}
                onChange={(e) =>
                  setHourMinute({
                    ...hourMinute,
                    minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
                style={inputStyle}
              />
            </div>
          </>
        )}

        {freqType === 'weekly' && (
          <>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Day</label>
              <select
                value={weekly.dayOfWeek}
                onChange={(e) => setWeekly({ ...weekly, dayOfWeek: parseInt(e.target.value) })}
                style={inputStyle}
              >
                {dayOptions.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: '60px' }}>
              <label style={labelStyle}>Hour</label>
              <input
                type="number"
                min={0}
                max={23}
                value={weekly.hour}
                onChange={(e) =>
                  setWeekly({
                    ...weekly,
                    hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
                style={inputStyle}
              />
            </div>
            <div style={{ width: '60px' }}>
              <label style={labelStyle}>Min</label>
              <input
                type="number"
                min={0}
                max={59}
                value={weekly.minute}
                onChange={(e) =>
                  setWeekly({
                    ...weekly,
                    minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
                style={inputStyle}
              />
            </div>
          </>
        )}

        {freqType === 'monthly' && (
          <>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Day</label>
              <input
                type="number"
                min={1}
                max={28}
                value={monthly.day}
                onChange={(e) =>
                  setMonthly({
                    ...monthly,
                    day: Math.min(28, Math.max(1, parseInt(e.target.value) || 1)),
                  })
                }
                style={inputStyle}
              />
            </div>
            <div style={{ width: '60px' }}>
              <label style={labelStyle}>Hour</label>
              <input
                type="number"
                min={0}
                max={23}
                value={monthly.hour}
                onChange={(e) =>
                  setMonthly({
                    ...monthly,
                    hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
                style={inputStyle}
              />
            </div>
            <div style={{ width: '60px' }}>
              <label style={labelStyle}>Min</label>
              <input
                type="number"
                min={0}
                max={59}
                value={monthly.minute}
                onChange={(e) =>
                  setMonthly({
                    ...monthly,
                    minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)),
                  })
                }
                style={inputStyle}
              />
            </div>
          </>
        )}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
        <button
          onClick={onClose}
          style={{
            padding: '5px 10px',
            fontSize: '11px',
            background: 'transparent',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
          }}
        >
          {t('agentManager.schedule.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button
          onClick={handleSave}
          disabled={!prompt.trim()}
          style={{
            padding: '5px 12px',
            fontSize: '11px',
            background: prompt.trim() ? 'var(--xp-blue)' : 'var(--xp-surface-light)',
            border: 'none',
            borderRadius: '4px',
            color: prompt.trim() ? '#fff' : 'var(--xp-text-muted)',
            cursor: prompt.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          {initial
            ? t('agentManager.schedule.save', { defaultValue: 'Save' })
            : t('agentManager.schedule.create', { defaultValue: 'Create schedule' })}
        </button>
      </div>
    </div>
  );
};

export default ScheduleAgentForm;
