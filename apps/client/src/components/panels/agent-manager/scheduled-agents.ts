/**
 * Scheduled agent definitions and storage.
 * Lets users schedule agents to run on a recurring or one-time basis.
 *
 * Schedules fire while Xplorer is open — the runner hook checks every 30s.
 * Each schedule tracks last_run timestamp to avoid duplicate fires.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';
import type { CreateSessionParams, AgentScopeConfig } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleFrequency =
  | { type: 'once'; runAt: number }
  | { type: 'interval'; everyMinutes: number }
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; dayOfWeek: number; hour: number; minute: number }
  | { type: 'monthly'; day: number; hour: number; minute: number };

export interface ScheduledAgent {
  id: string;
  name: string;
  prompt: string;
  model: string;
  workingDirectory: string;
  scope?: AgentScopeConfig;
  frequency: ScheduleFrequency;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
  runCount: number;
}

export interface ScheduleRunRecord {
  scheduleId: string;
  ranAt: number;
  sessionId: string | null;
  status: 'success' | 'error' | 'skipped';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const loadSchedules = (): ScheduledAgent[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_SCHEDULES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ScheduledAgent[];
  } catch (err) {
    console.warn('[ScheduledAgents] Failed to load schedules:', err);
    return [];
  }
};

export const saveSchedules = (schedules: ScheduledAgent[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.AGENT_SCHEDULES, JSON.stringify(schedules));
    window.dispatchEvent(new CustomEvent('xplorer-schedules-changed'));
  } catch (err) {
    console.warn('[ScheduledAgents] Failed to save schedules:', err);
  }
};

export const loadRunHistory = (): ScheduleRunRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_SCHEDULE_RUNS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ScheduleRunRecord[];
  } catch (err) {
    console.warn('[ScheduledAgents] Failed to load run history:', err);
    return [];
  }
};

export const saveRunHistory = (runs: ScheduleRunRecord[]): void => {
  try {
    // Keep last 200 runs
    const capped = runs.slice(-200);
    localStorage.setItem(STORAGE_KEYS.AGENT_SCHEDULE_RUNS, JSON.stringify(capped));
  } catch (err) {
    console.warn('[ScheduledAgents] Failed to save run history:', err);
  }
};

export const recordRun = (record: ScheduleRunRecord): void => {
  const history = loadRunHistory();
  history.push(record);
  saveRunHistory(history);
};

// ---------------------------------------------------------------------------
// Next-run computation
// ---------------------------------------------------------------------------

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const minuteMs = 60 * 1000;

/**
 * Compute the next time a schedule should fire, given the current time and
 * the schedule's frequency. Returns a Unix timestamp in ms.
 */
export const computeNextRun = (
  freq: ScheduleFrequency,
  now: number = Date.now(),
  lastRun: number | null = null,
): number => {
  switch (freq.type) {
    case 'once':
      return freq.runAt;

    case 'interval': {
      const base = lastRun ?? now;
      return base + freq.everyMinutes * minuteMs;
    }

    case 'hourly': {
      const next = new Date(now);
      next.setMinutes(freq.minute, 0, 0);
      if (next.getTime() <= now) next.setHours(next.getHours() + 1);
      return next.getTime();
    }

    case 'daily': {
      const next = new Date(now);
      next.setHours(freq.hour, freq.minute, 0, 0);
      if (next.getTime() <= now) next.setTime(next.getTime() + dayMs);
      return next.getTime();
    }

    case 'weekly': {
      const next = new Date(now);
      next.setHours(freq.hour, freq.minute, 0, 0);
      const currentDow = next.getDay();
      let dayDiff = freq.dayOfWeek - currentDow;
      if (dayDiff < 0 || (dayDiff === 0 && next.getTime() <= now)) dayDiff += 7;
      next.setTime(next.getTime() + dayDiff * dayMs);
      return next.getTime();
    }

    case 'monthly': {
      const next = new Date(now);
      next.setDate(freq.day);
      next.setHours(freq.hour, freq.minute, 0, 0);
      if (next.getTime() <= now) next.setMonth(next.getMonth() + 1);
      return next.getTime();
    }

    default:
      return now + hourMs;
  }
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number): string => n.toString().padStart(2, '0');

export const formatFrequency = (freq: ScheduleFrequency): string => {
  switch (freq.type) {
    case 'once':
      return `Once at ${new Date(freq.runAt).toLocaleString()}`;
    case 'interval':
      if (freq.everyMinutes < 60) return `Every ${freq.everyMinutes} min`;
      if (freq.everyMinutes % 60 === 0) return `Every ${freq.everyMinutes / 60} hr`;
      return `Every ${freq.everyMinutes} min`;
    case 'hourly':
      return `Every hour at :${pad(freq.minute)}`;
    case 'daily':
      return `Daily at ${pad(freq.hour)}:${pad(freq.minute)}`;
    case 'weekly':
      return `${dayNames[freq.dayOfWeek] ?? 'Sun'} at ${pad(freq.hour)}:${pad(freq.minute)}`;
    case 'monthly':
      return `Day ${freq.day} at ${pad(freq.hour)}:${pad(freq.minute)}`;
    default:
      return 'Unknown';
  }
};

export const formatRelativeTime = (timestamp: number, now: number = Date.now()): string => {
  const delta = timestamp - now;
  const absDelta = Math.abs(delta);
  const minutes = Math.floor(absDelta / minuteMs);
  const hours = Math.floor(absDelta / hourMs);
  const days = Math.floor(absDelta / dayMs);
  const tense = delta < 0 ? 'ago' : 'in';

  let value: string;
  if (absDelta < minuteMs) value = 'now';
  else if (minutes < 60) value = `${minutes}m`;
  else if (hours < 24) value = `${hours}h`;
  else value = `${days}d`;

  if (value === 'now') return 'now';
  return delta < 0 ? `${value} ${tense}` : `${tense} ${value}`;
};

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export const createSchedule = (
  partial: Omit<ScheduledAgent, 'id' | 'createdAt' | 'lastRunAt' | 'nextRunAt' | 'runCount'>,
): ScheduledAgent => {
  const now = Date.now();
  const id = `sched_${now}_${Math.random().toString(36).slice(2, 9)}`;
  const schedule: ScheduledAgent = {
    ...partial,
    id,
    createdAt: now,
    lastRunAt: null,
    nextRunAt: computeNextRun(partial.frequency, now, null),
    runCount: 0,
  };
  const all = loadSchedules();
  all.push(schedule);
  saveSchedules(all);
  return schedule;
};

export const updateSchedule = (id: string, patch: Partial<ScheduledAgent>): void => {
  const all = loadSchedules();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const updated = { ...all[idx], ...patch };
  // Recompute next run if frequency changed
  if (patch.frequency) {
    updated.nextRunAt = computeNextRun(patch.frequency, Date.now(), updated.lastRunAt);
  }
  all[idx] = updated;
  saveSchedules(all);
};

export const deleteSchedule = (id: string): void => {
  const all = loadSchedules().filter((s) => s.id !== id);
  saveSchedules(all);
};

export const toggleSchedule = (id: string): void => {
  const all = loadSchedules();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], enabled: !all[idx].enabled };
  saveSchedules(all);
};

/** Mark schedule as having just run; advance next_run_at. */
export const markRan = (id: string, timestamp: number = Date.now()): void => {
  const all = loadSchedules();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const sched = all[idx];
  const next = computeNextRun(sched.frequency, timestamp, timestamp);
  // For 'once' schedules, disable after running
  const enabled = sched.frequency.type === 'once' ? false : sched.enabled;
  all[idx] = {
    ...sched,
    lastRunAt: timestamp,
    nextRunAt: next,
    runCount: sched.runCount + 1,
    enabled,
  };
  saveSchedules(all);
};

// ---------------------------------------------------------------------------
// Convert schedule → agent session params
// ---------------------------------------------------------------------------

export const scheduleToSessionParams = (sched: ScheduledAgent): CreateSessionParams => ({
  name: sched.name || sched.prompt.slice(0, 40),
  prompt: sched.prompt,
  model: sched.model,
  working_directory: sched.workingDirectory,
  scope: sched.scope,
});
