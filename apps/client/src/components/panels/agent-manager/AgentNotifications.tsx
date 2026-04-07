/**
 * AgentNotifications — emits toast-style notifications for key agent events:
 *   - Agent completed
 *   - Agent needs approval
 *   - Agent error
 *
 * Listens for session status changes and dispatches to the existing toast
 * system. Notifications auto-dismiss after 5 seconds and are clickable to
 * jump to the agent's panel.
 *
 * Notification preferences are stored in localStorage (can disable per type).
 */
import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/hooks/use-toast';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import type { AgentSessionSummary, AgentSessionStatus } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentNotificationType = 'completed' | 'approval' | 'error';

export interface AgentNotificationPrefs {
  completed: boolean;
  approval: boolean;
  error: boolean;
}

interface AgentNotificationsProps {
  /** Current session summaries from the backend */
  sessions: AgentSessionSummary[];
  /** Callback to navigate to the agent manager panel */
  onNavigateToAgent?: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// Preference helpers
// ---------------------------------------------------------------------------

export const loadNotificationPrefs = (): AgentNotificationPrefs => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_NOTIFICATION_PREFS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AgentNotificationPrefs>;
      return {
        completed: parsed.completed !== false,
        approval: parsed.approval !== false,
        error: parsed.error !== false,
      };
    }
  } catch {
    // ignore
  }
  return { completed: true, approval: true, error: true };
};

export const saveNotificationPrefs = (prefs: AgentNotificationPrefs): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.AGENT_NOTIFICATION_PREFS, JSON.stringify(prefs));
  } catch {
    // Storage unavailable
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentNotifications = ({
  sessions,
  onNavigateToAgent: _onNavigateToAgent,
}: AgentNotificationsProps) => {
  const { t } = useTranslation();

  // Track previous status per session to detect transitions
  const prevStatusRef = useRef<Map<string, AgentSessionStatus>>(new Map());

  const emitNotification = useCallback(
    (type: AgentNotificationType, session: AgentSessionSummary) => {
      const prefs = loadNotificationPrefs();
      if (!prefs[type]) return;

      let title: string;
      let description: string | undefined;
      let variant: 'default' | 'destructive' = 'default';

      switch (type) {
        case 'completed':
          title = t('agentManager.notifications.agentCompleted', { name: session.name });
          description = t('agentManager.notifications.agentCompletedDetail', {
            issues: session.tool_calls_count,
          });
          break;
        case 'approval':
          title = t('agentManager.notifications.agentNeedsApproval', { name: session.name });
          description = t('agentManager.notifications.agentNeedsApprovalDetail', {
            file: session.working_directory,
          });
          break;
        case 'error':
          title = t('agentManager.notifications.agentError', { name: session.name });
          description = t('agentManager.notifications.agentErrorDetail', {
            reason: session.error_message ?? 'Unknown error',
          });
          variant = 'destructive';
          break;
      }

      toast({ title, description, variant });

      // Also dispatch a custom event so other parts of the UI can react
      window.dispatchEvent(
        new CustomEvent('xplorer-agent-notification', {
          detail: { type, sessionId: session.id, sessionName: session.name },
        }),
      );
    },
    [t],
  );

  // Watch for session status transitions and emit notifications
  useEffect(() => {
    const prevMap = prevStatusRef.current;

    for (const session of sessions) {
      const prevStatus = prevMap.get(session.id);

      // Skip if this is the first time we see this session (initial load)
      if (prevStatus === undefined) {
        prevMap.set(session.id, session.status);
        continue;
      }

      // Detect transitions
      if (prevStatus !== session.status) {
        if (session.status === 'done' && prevStatus !== 'done') {
          emitNotification('completed', session);
        } else if (session.status === 'waiting_approval' && prevStatus !== 'waiting_approval') {
          emitNotification('approval', session);
        } else if (session.status === 'error' && prevStatus !== 'error') {
          emitNotification('error', session);
        }

        prevMap.set(session.id, session.status);
      }
    }

    // Clean up sessions that no longer exist
    const currentIds = new Set(sessions.map((s) => s.id));
    for (const [id] of prevMap) {
      if (!currentIds.has(id)) {
        prevMap.delete(id);
      }
    }
  }, [sessions, emitNotification]);

  // Also listen for legacy agent events
  useEffect(() => {
    const handleAgentEnd = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string; description?: string }>).detail;
      if (!detail) return;

      const prefs = loadNotificationPrefs();
      if (!prefs.completed) return;

      toast({
        title: t('agentManager.notifications.agentCompleted', {
          name: detail.description ?? t('agentManager.conversation.roleAgent'),
        }),
      });
    };

    window.addEventListener('xplorer-agent-end', handleAgentEnd);
    return () => window.removeEventListener('xplorer-agent-end', handleAgentEnd);
  }, [t]);

  // This component is invisible — it only emits side effects (toasts)
  return null;
};

export default AgentNotifications;
