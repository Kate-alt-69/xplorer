/**
 * Agent Manager Panel — mission control for AI operations.
 *
 * Sections:
 * 1. Active Agents — currently running AI tasks
 * 2. Task Queue — pending tasks with drag-to-reorder
 * 3. Quick Actions — one-click common AI tasks
 * 4. Recent Actions — scrollable audit log
 * 5. Agent Settings — bottom bar with toggles
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ActiveAgents, { type AgentTask } from './agent-manager/ActiveAgents';
import TaskQueue, { type QueuedTask } from './agent-manager/TaskQueue';
import QuickActions from './agent-manager/QuickActions';
import RecentActions from './agent-manager/RecentActions';
import AgentSettingsBar from './agent-manager/AgentSettingsBar';

// ---------------------------------------------------------------------------
// Section header style (consistent with PerformanceDashboard)
// ---------------------------------------------------------------------------

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 8px',
  cursor: 'pointer',
  userSelect: 'none',
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--xp-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dispatch a prompt to the AI chat panel via the established event bridge.
 * The `use-xplorer-effects` hook listens for this and opens the chat panel.
 */
const dispatchChatPrompt = (prompt: string): void => {
  window.dispatchEvent(new CustomEvent('xplorer-ai-chat-request', { detail: { prompt } }));
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const AgentManagerPanel = () => {
  const { t } = useTranslation();

  // Section collapse state
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);

  // Active agents — synced from the chat panel's agent loop
  const [activeAgents, setActiveAgents] = useState<AgentTask[]>([]);

  // Task queue — stored in component state, persisted per session
  const [taskQueue, setTaskQueue] = useState<QueuedTask[]>([]);

  // Listen for agent status updates from the chat panel
  useEffect(() => {
    const handleAgentUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ agents: AgentTask[] }>).detail;
      if (detail?.agents) {
        setActiveAgents(detail.agents);
      }
    };

    const handleAgentStart = (e: Event) => {
      const detail = (e as CustomEvent<{ agent: AgentTask }>).detail;
      if (detail?.agent) {
        setActiveAgents((prev) => {
          const exists = prev.some((a) => a.id === detail.agent.id);
          if (exists) return prev.map((a) => (a.id === detail.agent.id ? detail.agent : a));
          return [...prev, detail.agent];
        });
      }
    };

    const handleAgentEnd = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId: string }>).detail;
      if (detail?.agentId) {
        setActiveAgents((prev) => prev.filter((a) => a.id !== detail.agentId));
      }
    };

    window.addEventListener('xplorer-agent-update', handleAgentUpdate);
    window.addEventListener('xplorer-agent-start', handleAgentStart);
    window.addEventListener('xplorer-agent-end', handleAgentEnd);
    return () => {
      window.removeEventListener('xplorer-agent-update', handleAgentUpdate);
      window.removeEventListener('xplorer-agent-start', handleAgentStart);
      window.removeEventListener('xplorer-agent-end', handleAgentEnd);
    };
  }, []);

  // Listen for tasks being queued from other parts of the app
  useEffect(() => {
    const handleQueueTask = (e: Event) => {
      const detail = (e as CustomEvent<{ task: QueuedTask }>).detail;
      if (detail?.task) {
        setTaskQueue((prev) => [...prev, detail.task]);
      }
    };

    window.addEventListener('xplorer-agent-queue-task', handleQueueTask);
    return () => window.removeEventListener('xplorer-agent-queue-task', handleQueueTask);
  }, []);

  // Stop an active agent
  const handleStopAgent = useCallback((_id: string) => {
    // Dispatch stop event for the chat panel to handle
    window.dispatchEvent(new CustomEvent('xplorer-agent-stop', { detail: { agentId: _id } }));
    setActiveAgents((prev) => prev.filter((a) => a.id !== _id));
  }, []);

  // Start a queued task
  const handleStartTask = useCallback((task: QueuedTask) => {
    setTaskQueue((prev) => prev.filter((t) => t.id !== task.id));
    dispatchChatPrompt(task.prompt);
  }, []);

  // Remove a queued task
  const handleRemoveTask = useCallback((id: string) => {
    setTaskQueue((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Reorder tasks via drag
  const handleReorderTasks = useCallback((tasks: QueuedTask[]) => {
    setTaskQueue(tasks);
  }, []);

  // Quick action handler
  const handleQuickAction = useCallback((prompt: string) => {
    dispatchChatPrompt(prompt);
  }, []);

  // Check if any agent is actively running (disable quick actions)
  const hasActiveAgent = useMemo(() => activeAgents.length > 0, [activeAgents]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 0%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Scrollable content */}
      <div
        style={{
          overflowY: 'auto',
          overflowX: 'hidden',
          flex: '1 1 0%',
          minHeight: 0,
        }}
      >
        {/* Active Agents Section */}
        <div>
          <div
            style={sectionHeaderStyle}
            onClick={() => setActiveExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={activeExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActiveExpanded((v) => !v);
            }}
          >
            {activeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('agentManager.sections.activeAgents')}
            {activeAgents.length > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  background: 'var(--xp-green, #73daca)',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '8px',
                }}
              >
                {activeAgents.length}
              </span>
            )}
          </div>
          {activeExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <ActiveAgents agents={activeAgents} onStop={handleStopAgent} />
            </div>
          )}
        </div>

        {/* Task Queue Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setQueueExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={queueExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setQueueExpanded((v) => !v);
            }}
          >
            {queueExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('agentManager.sections.taskQueue')}
            {taskQueue.length > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  background: 'var(--xp-blue, #7aa2f7)',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '8px',
                }}
              >
                {taskQueue.length}
              </span>
            )}
          </div>
          {queueExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <TaskQueue
                tasks={taskQueue}
                onStart={handleStartTask}
                onRemove={handleRemoveTask}
                onReorder={handleReorderTasks}
              />
            </div>
          )}
        </div>

        {/* Quick Actions Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setQuickActionsExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={quickActionsExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setQuickActionsExpanded((v) => !v);
            }}
          >
            {quickActionsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('agentManager.sections.quickActions')}
          </div>
          {quickActionsExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <QuickActions onAction={handleQuickAction} disabled={hasActiveAgent} />
            </div>
          )}
        </div>

        {/* Recent Actions Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setRecentExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={recentExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setRecentExpanded((v) => !v);
            }}
          >
            {recentExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('agentManager.sections.recentActions')}
          </div>
          {recentExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <RecentActions maxItems={30} />
            </div>
          )}
        </div>
      </div>

      {/* Agent Settings Bar — pinned at bottom */}
      <AgentSettingsBar />
    </div>
  );
};

export default AgentManagerPanel;
