/**
 * Agent Manager Panel — mission control for AI operations.
 *
 * Sections:
 * 1. Active Agents — currently running AI tasks (from Rust backend + legacy events)
 * 2. New Agent — spawn a new agent session with prompt + model
 * 3. External Agents — terminal-based agent detection
 * 4. Task Queue — pending tasks with drag-to-reorder
 * 5. Quick Actions — one-click common AI tasks
 * 6. Recent Actions — scrollable audit log
 * 7. Agent Settings — bottom bar with toggles
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Lightbulb,
  LayoutGrid,
  DollarSign,
  FolderTree,
  FileEdit,
  Calendar,
} from 'lucide-react';
import ActiveAgents, { type AgentTask } from './agent-manager/ActiveAgents';
import TaskQueue, { type QueuedTask } from './agent-manager/TaskQueue';
import QuickActions from './agent-manager/QuickActions';
import RecentActions from './agent-manager/RecentActions';
import AgentSettingsBar from './agent-manager/AgentSettingsBar';
import TerminalAgentDetector from './agent-manager/TerminalAgentDetector';
import NewAgentForm from './agent-manager/NewAgentForm';
import SessionHistory from './agent-manager/SessionHistory';
import SharedDiscoveriesBadge from './agent-manager/SharedDiscoveriesBadge';
import AgentNotifications from './agent-manager/AgentNotifications';
import CostTracker from './agent-manager/CostTracker';
import AgentTemplates from './agent-manager/AgentTemplates';
import CrossDirectoryView from './agent-manager/CrossDirectoryView';
import FileChangeTracker from './agent-manager/FileChangeTracker';
import ScheduledAgents from './agent-manager/ScheduledAgents';
import { useScheduleRunner, useSchedules } from './agent-manager/use-schedule-runner';
import { useSessionHistory } from './agent-manager/use-session-history';
import useCostTracking from './agent-manager/use-cost-tracking';
import { useFileChanges } from './agent-manager/use-file-changes';
import useAgentSessions from '@/hooks/use-agent-sessions';
import { subscribeToDiscoveries, getDiscoveryCount } from './agent-manager/agent-shared-context';
import type { CreateSessionParams } from '@/lib/tauri-api-types';

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
  const [externalExpanded, setExternalExpanded] = useState(true);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [showNewAgentForm, setShowNewAgentForm] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [discoveriesExpanded, setDiscoveriesExpanded] = useState(false);
  const [discoveryCount, setDiscoveryCount] = useState(getDiscoveryCount);
  const [templatesExpanded, setTemplatesExpanded] = useState(false);
  const [costExpanded, setCostExpanded] = useState(false);
  const [crossDirExpanded, setCrossDirExpanded] = useState(false);
  const [fileChangesExpanded, setFileChangesExpanded] = useState(false);
  const [scheduledExpanded, setScheduledExpanded] = useState(false);

  // Multi-session agent state from Rust backend
  const { sessions, createSession, stopSession, removeSession } = useAgentSessions();

  // Run the schedule timer — fires due schedules every 30s
  useScheduleRunner();
  const schedules = useSchedules();
  const enabledScheduleCount = useMemo(
    () => schedules.filter((s) => s.enabled).length,
    [schedules],
  );

  // Cost tracking — per-session and daily totals
  const {
    sessionCosts,
    todayTotalCost,
    todayTotalTokensIn,
    todayTotalTokensOut,
    formatCost,
    formatTokens,
  } = useCostTracking();

  // File change tracking — per-agent file modifications
  const { changesByAgent, totalChangeCount } = useFileChanges(sessions);

  // Session history — persists completed sessions
  const {
    entries: historyEntries,
    clearAll: clearHistory,
    removeEntry: removeHistoryEntry,
  } = useSessionHistory(sessions);

  // Subscribe to shared discoveries count changes
  useEffect(() => {
    const unsub = subscribeToDiscoveries(() => {
      setDiscoveryCount(getDiscoveryCount());
    });
    return unsub;
  }, []);

  // Active agents — synced from the chat panel's agent loop (legacy)
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

  // Create new agent session
  const handleCreateSession = useCallback(
    async (params: CreateSessionParams) => {
      await createSession(params);
      setShowNewAgentForm(false);
    },
    [createSession],
  );

  // Launch from template — create session with template params
  const handleSelectTemplate = useCallback(
    (params: CreateSessionParams) => {
      createSession(params).catch((err: unknown) => {
        console.error('[AgentManager] Failed to create session from template:', err);
      });
    },
    [createSession],
  );

  // Count active items (both legacy + multi-session)
  const totalActiveCount = useMemo(
    () =>
      activeAgents.length +
      sessions.filter(
        (s) =>
          s.status === 'thinking' ||
          s.status === 'executing' ||
          s.status === 'waiting_approval' ||
          s.status === 'idle',
      ).length,
    [activeAgents, sessions],
  );

  // Check if any agent is actively running (disable quick actions)
  const hasActiveAgent = useMemo(() => totalActiveCount > 0, [totalActiveCount]);

  // Broadcast active count so the VerticalExtensionsBar status indicator stays in sync
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('xplorer-agent-active-count', { detail: { count: totalActiveCount } }),
    );
  }, [totalActiveCount]);

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
      {/* Invisible notification emitter — watches session transitions */}
      <AgentNotifications sessions={sessions} />

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
            style={{
              ...sectionHeaderStyle,
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}
              onClick={() => setActiveExpanded((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveExpanded((v) => !v);
              }}
            >
              {activeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t('agentManager.sections.activeAgents')}
              {totalActiveCount > 0 && (
                <span
                  style={{
                    background: 'var(--xp-green, #73daca)',
                    color: '#fff',
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '8px',
                  }}
                >
                  {totalActiveCount}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowNewAgentForm((v) => !v)}
              title={t('agentManager.newAgent.title')}
              aria-label={t('agentManager.newAgent.title')}
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
              <Plus size={10} />
              {t('agentManager.newAgent.button')}
            </button>
          </div>
          {activeExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              {showNewAgentForm && (
                <div style={{ marginBottom: '8px' }}>
                  <NewAgentForm
                    onSubmit={handleCreateSession}
                    onCancel={() => setShowNewAgentForm(false)}
                  />
                </div>
              )}
              <ActiveAgents
                agents={activeAgents}
                onStop={handleStopAgent}
                sessions={sessions}
                onStopSession={stopSession}
                onRemoveSession={removeSession}
              />
            </div>
          )}
        </div>

        {/* External Agents Section (Terminal Detection) */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setExternalExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={externalExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setExternalExpanded((v) => !v);
            }}
          >
            {externalExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('agentManager.sections.externalAgents')}
          </div>
          {externalExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <TerminalAgentDetector />
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

        {/* Agent Templates Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setTemplatesExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={templatesExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setTemplatesExpanded((v) => !v);
            }}
          >
            {templatesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <LayoutGrid size={12} />
            {t('agentManager.sections.templates')}
          </div>
          {templatesExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <AgentTemplates onSelectTemplate={handleSelectTemplate} disabled={hasActiveAgent} />
            </div>
          )}
        </div>

        {/* Scheduled Agents Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setScheduledExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={scheduledExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setScheduledExpanded((v) => !v);
            }}
          >
            {scheduledExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Calendar size={12} />
            {t('agentManager.sections.scheduled', { defaultValue: 'Scheduled' })}
            {enabledScheduleCount > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: '10px',
                  padding: '1px 6px',
                  borderRadius: '8px',
                  background: 'rgba(122, 162, 247, 0.2)',
                  color: 'var(--xp-blue)',
                }}
              >
                {enabledScheduleCount}
              </span>
            )}
          </div>
          {scheduledExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <ScheduledAgents />
            </div>
          )}
        </div>

        {/* Cost Tracker Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setCostExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={costExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setCostExpanded((v) => !v);
            }}
          >
            {costExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <DollarSign size={12} />
            {t('agentManager.sections.costTracker')}
            {todayTotalCost > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: '10px',
                  color: 'var(--xp-text-muted)',
                }}
              >
                {formatCost(todayTotalCost)}
              </span>
            )}
          </div>
          {costExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <CostTracker
                todayTotalCost={todayTotalCost}
                todayTotalTokensIn={todayTotalTokensIn}
                todayTotalTokensOut={todayTotalTokensOut}
                sessionCosts={sessionCosts}
                formatCost={formatCost}
                formatTokens={formatTokens}
              />
            </div>
          )}
        </div>

        {/* File Changes Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setFileChangesExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={fileChangesExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setFileChangesExpanded((v) => !v);
            }}
          >
            {fileChangesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FileEdit size={12} />
            {t('agentManager.sections.fileChanges')}
            {totalChangeCount > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  background: 'var(--xp-warning, #e0af68)',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '8px',
                }}
              >
                {totalChangeCount}
              </span>
            )}
          </div>
          {fileChangesExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <FileChangeTracker changesByAgent={changesByAgent} />
            </div>
          )}
        </div>

        {/* Cross-Directory View Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setCrossDirExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={crossDirExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setCrossDirExpanded((v) => !v);
            }}
          >
            {crossDirExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FolderTree size={12} />
            {t('agentManager.sections.crossDirectory')}
          </div>
          {crossDirExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <CrossDirectoryView
                sessions={sessions}
                sessionCosts={sessionCosts}
                formatCost={formatCost}
                onStopSession={stopSession}
                onRemoveSession={removeSession}
              />
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

        {/* Shared Discoveries Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setDiscoveriesExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={discoveriesExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setDiscoveriesExpanded((v) => !v);
            }}
          >
            {discoveriesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Lightbulb size={12} />
            {t('agentManager.sections.sharedDiscoveries')}
            {discoveryCount > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  background: 'var(--xp-purple, #bb9af7)',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '8px',
                }}
              >
                {discoveryCount}
              </span>
            )}
          </div>
          {discoveriesExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <SharedDiscoveriesBadge />
            </div>
          )}
        </div>

        {/* Session History Section */}
        <div style={{ borderTop: '1px solid var(--xp-border)' }}>
          <div
            style={sectionHeaderStyle}
            onClick={() => setHistoryExpanded((v) => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={historyExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setHistoryExpanded((v) => !v);
            }}
          >
            {historyExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('agentManager.sections.sessionHistory')}
            {historyEntries.length > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  background: 'var(--xp-text-muted)',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '8px',
                }}
              >
                {historyEntries.length}
              </span>
            )}
          </div>
          {historyExpanded && (
            <div style={{ padding: '0 8px 8px' }}>
              <SessionHistory
                entries={historyEntries}
                onClearAll={clearHistory}
                onRemoveEntry={removeHistoryEntry}
              />
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
