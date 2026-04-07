# Agent Manager Panel

Architecture reference for the Xplorer Agent Manager — the right-sidebar panel and full-screen workspace for managing AI agent sessions.

## File Map

| File | Purpose |
|---|---|
| `ActiveAgents.tsx` | Displays running agent sessions with status badges, progress bars, stop/remove controls |
| `AgentBottomPanel.tsx` | Compact agent view for the bottom panel, horizontal layout with agent selector dropdown |
| `AgentConversationView.tsx` | Full conversation thread with markdown, inline tool-call indicators, approval cards, message input |
| `AgentNotifications.tsx` | Emits toast notifications on agent status transitions (completed, needs approval, error) |
| `AgentSettingsBar.tsx` | Bottom-of-panel settings: model display, proactive mode toggle, auto-allow toggle |
| `AgentSkillsBrowser.tsx` | Browse and install community agent skills from the extension marketplace |
| `AgentStatusIndicator.tsx` | Small overlay badge for the sidebar icon showing active agent count + pulsing dot |
| `AgentTemplates.tsx` | Grid of pre-built agent templates for one-click launching |
| `AgentWorkspace.tsx` | Full-screen three-column workspace: agent list, conversation, file changes |
| `CostTracker.tsx` | Summary bar showing today's API cost and per-session token usage |
| `CrossDirectoryView.tsx` | Groups agent sessions by working directory with navigate-to-folder support |
| `FileChangeTracker.tsx` | Per-agent collapsible file change lists with created/modified/deleted indicators |
| `NewAgentForm.tsx` | Inline form for creating a new agent session (name, prompt, model) |
| `QuickActions.tsx` | One-click common AI tasks (organize, find duplicates, summarize, etc.) |
| `RecentActions.tsx` | Scrollable audit log of recent AI actions with undo support |
| `SessionHistory.tsx` | Completed session list with duration, cost, file changes, expandable details |
| `SharedDiscoveriesBadge.tsx` | Displays inter-agent shared discoveries with type badges and clear controls |
| `TaskQueue.tsx` | Pending task queue with drag-to-reorder, start, and remove controls |
| `TerminalAgentDetector.tsx` | Monitors PTY output for external AI agents (Claude Code, Codex, Aider) |
| `UnifiedDiffReview.tsx` | Side-by-side diff view of all agent file changes with accept/reject per file |
| `agent-shared-context.ts` | In-memory + localStorage store for inter-agent knowledge sharing |
| `agent-templates-data.ts` | Built-in agent template definitions (system prompts, models, costs) |
| `use-cost-tracking.ts` | Hook for per-session API cost/token estimation with daily persistence |
| `use-file-changes.ts` | Hook for tracking file changes per agent session via fs-change events |
| `use-session-history.ts` | Hook for persisting completed sessions to localStorage (max 50) |

## Agent Session Lifecycle

```
idle -> thinking -> executing -> waiting_approval -> thinking -> ... -> done
                                                                    -> error
                                                                    -> cancelled
```

### States

- **idle** — Session created, waiting for first prompt or initialization.
- **thinking** — Agent is processing input and deciding next action.
- **executing** — Agent is running a tool call (read file, edit file, run command).
- **waiting_approval** — Agent wants to perform a dangerous action and needs user approval.
- **done** — Agent completed its task successfully.
- **error** — Agent encountered an unrecoverable error.
- **cancelled** — User stopped the agent manually.

Terminal states (`done`, `error`, `cancelled`) trigger:
1. Toast notification via `AgentNotifications`
2. Entry saved to `SessionHistory` via `use-session-history`
3. Cost snapshot persisted via `use-cost-tracking`

## How to Add New Agent Templates

1. Open `agent-templates-data.ts`
2. Add a new entry to `AGENT_TEMPLATES`:
   ```ts
   {
     id: 'my-template',
     nameKey: 'agentManager.templates.myTemplate',
     descriptionKey: 'agentManager.templates.myTemplateDesc',
     icon: 'Wand2', // any lucide-react icon name
     systemPrompt: 'You are a ...',
     defaultModel: 'claude-sonnet-4-20250514',
     estimatedCostUsd: 0.15,
     accentColor: 'var(--xp-blue, #7aa2f7)',
   }
   ```
3. Add the icon to `ICON_MAP` in `AgentTemplates.tsx`
4. Add i18n keys to all 4 locale files (`en.json`, `zh.json`, `ja.json`, `id.json`)

Community skills from the marketplace are defined in `AgentSkillsBrowser.tsx` and use the `MarketplaceSkill` interface with `category: "agent-skill"` in their extension manifest.

## External Agent Detection

`TerminalAgentDetector.tsx` monitors PTY terminal output for AI agent signatures:

- **Claude Code** — matches `Claude Code v`, `claude>`, `Opus 4`, `Sonnet 4`
- **Codex CLI** — matches `Codex CLI`, `codex>`, `openai/codex`
- **Aider** — matches `aider v`, `aider>`, `Aider chat`
- **Generic AI** — matches `agent loop`, `tool call`, `thinking...`, `reading file`

Detection flow:
1. PTY output is stripped of ANSI escape codes
2. Patterns are matched against the cleaned text
3. On first match, an `ExternalAgent` entry is created with status `active`
4. Subsequent output updates `lastActivityAt` and extracts file paths
5. After 30 seconds of silence, status transitions to `idle`
6. On PTY exit, status transitions to `exited`

Events are broadcast via `window.dispatchEvent(new CustomEvent('xplorer-external-agent', ...))`.

## Cost Tracking

`use-cost-tracking.ts` estimates API costs using a model pricing table:

| Model | Input ($/MTok) | Output ($/MTok) |
|---|---|---|
| claude-sonnet-4-20250514 | 3.00 | 15.00 |
| claude-opus-4-6-20250515 | 15.00 | 75.00 |
| claude-haiku-4-5-20251001 | 0.80 | 4.00 |
| gpt-4o | 2.50 | 10.00 |
| o3 | 10.00 | 40.00 |
| o4-mini | 1.10 | 4.40 |
| Local models | 0.00 | 0.00 |

Token estimation uses a rough heuristic of ~4 characters per token. Daily totals are persisted to `localStorage` under `xplorer:agent-cost-history` with a 30-day rolling window.

## MCP Host Tool List

The agent sessions expose these tool types for MCP-compatible interactions:

- `read_file` — Read file contents
- `edit_file` — Modify existing file
- `create_file` — Create new file
- `delete_file` — Remove file
- `run_command` — Execute shell command
- `search_files` — Search for files by pattern
- `list_directory` — List directory contents

Each tool call is rendered inline in the conversation view with status indicators (pending, running, success, error).

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` / `Ctrl+K` | Open command palette / agent launcher |
| `Cmd+Shift+A` / `Ctrl+Shift+A` | Toggle full-screen Agent Workspace |
| `Escape` | Close Agent Workspace |
| `Enter` | Send message in conversation view |
| `Shift+Enter` | New line in message input |
| `Cmd+Enter` / `Ctrl+Enter` | Submit new agent form |
