/**
 * Hook that runs the agent schedule timer.
 *
 * Mounts once at the Agent Manager level, polls every 30s, and fires any
 * schedule whose nextRunAt is in the past. Fires create real agent sessions
 * via TauriAPI.createAgentSession.
 *
 * Schedules only fire while Xplorer is open. For OS-level scheduling that
 * survives reboots, we'd need a Tauri-side cron daemon (future work).
 */
import { useEffect, useRef, useState } from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import {
  loadSchedules,
  markRan,
  recordRun,
  scheduleToSessionParams,
  type ScheduledAgent,
} from './scheduled-agents';

const CHECK_INTERVAL_MS = 30_000; // 30 seconds

const fireSchedule = async (sched: ScheduledAgent): Promise<void> => {
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
    console.warn(`[Schedule] Fired "${sched.name}" → session ${session.id}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    markRan(sched.id);
    recordRun({
      scheduleId: sched.id,
      ranAt: Date.now(),
      sessionId: null,
      status: 'error',
      errorMessage,
    });
    console.error(`[Schedule] Failed to fire "${sched.name}":`, errorMessage);
  }
};

export const useScheduleRunner = (enabled = true): void => {
  const isFiringRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const check = async () => {
      if (isFiringRef.current) return;
      isFiringRef.current = true;
      try {
        const now = Date.now();
        const due = loadSchedules().filter((s) => s.enabled && s.nextRunAt <= now);
        // Fire due schedules sequentially to avoid overwhelming the backend
        for (const sched of due) {
          await fireSchedule(sched);
        }
      } finally {
        isFiringRef.current = false;
      }
    };

    // Run once immediately, then on interval
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled]);
};

/**
 * Reactive hook that returns the current schedule list and re-renders on changes.
 */
export const useSchedules = (): ScheduledAgent[] => {
  const [schedules, setSchedules] = useState<ScheduledAgent[]>(() => loadSchedules());

  useEffect(() => {
    const handler = () => setSchedules(loadSchedules());
    window.addEventListener('xplorer-schedules-changed', handler);
    // Refresh every 60s so nextRunAt countdowns update
    const interval = setInterval(handler, 60_000);
    return () => {
      window.removeEventListener('xplorer-schedules-changed', handler);
      clearInterval(interval);
    };
  }, []);

  return schedules;
};
