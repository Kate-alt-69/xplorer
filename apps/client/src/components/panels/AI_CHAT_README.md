# AI Chat Agent — Architecture & Reference

The AI chat agent is a standalone panel in Xplorer that provides conversational file management powered by LLM. Users can ask the agent to create, edit, move, delete, and organize files, run terminal commands, compare files, and more.

## File Map

### Core Components

| File | Purpose |
|------|---------|
| `StandaloneChatPanel.tsx` | Main panel component. Orchestrates messages, input, actions, branching, and rendering. |
| `ChatPanel.tsx` | Older chat panel (server-backed agent mode). Separate from the standalone panel. |
| `ChatMessageBubble.tsx` | Renders a single chat message bubble (user or assistant). |
| `ChatActionCards.tsx` | File action permission cards (approve/reject/undo) and batch action bar. |
| `ChatCommandCard.tsx` | Terminal command execution card with stdout/stderr output display. |
| `ChatDiffPreview.tsx` | Inline diff preview for `edit_file` actions (LCS-based line diff). |
| `ChatInput.tsx` | Chat input textarea used by ChatPanel. |
| `ChatSlashInput.tsx` | Input with slash command autocomplete (used by StandaloneChatPanel). |
| `ChatContextHeader.tsx` | Header showing current directory, selected files, and editor selection. |
| `ChatWelcome.tsx` | Contextual welcome message shown when chat is empty. |
| `ChatFilePathCard.tsx` | Clickable file path pill that navigates to the file in the explorer. |
| `ChatDropZone.tsx` | Drag-and-drop overlay + attached files bar. |
| `ChatHistoryView.tsx` | Saved conversation list with load/delete. Lazy-loaded. |
| `ChatBranchTabs.tsx` | Branch tab bar for conversation forking. Lazy-loaded. |
| `ChatPinnedMessages.tsx` | Pinned messages section. Lazy-loaded. |
| `ChatMessageContextMenu.tsx` | Right-click context menu for pin/copy on messages. |
| `ChatFeedbackButtons.tsx` | Thumbs up/down feedback buttons on assistant messages. |
| `ChatErrorBoundary.tsx` | Error boundary wrapper for the chat panel. |
| `ProactiveSuggestionCard.tsx` | Card for proactive agent suggestions (auto-dismissed). |
| `TaskPlanCard.tsx` | Multi-step task plan with progress bar and controls. Lazy-loaded. |

### Utility Modules (Pure Logic)

| File | Purpose |
|------|---------|
| `chat-file-actions.tsx` | Action types, JSON parsing from AI responses, execution via TauriAPI, undo logic, command safety, system prompt. |
| `chat-context-helpers.ts` | File reading for AI context (text, images, directories), Xplorer state access. |
| `chat-system-prompt.ts` | Assembles the full system prompt from all context sources. Extracted for size. |
| `chat-slash-commands.ts` | Slash command definitions and matching. Language extension map. |
| `chat-special-commands.ts` | Client-side handlers for `/memory`, `/forget`, `/compare`, `/preferences`, `/audit`, `/security`. |
| `chat-action-templates.ts` | Save/load/run/delete reusable action templates. |
| `chat-history.ts` | Chat history persistence (localStorage). |
| `chat-branching.ts` | Conversation branching (fork, switch, delete, rename). |
| `chat-pinning.ts` | Message pinning per conversation. |
| `chat-export-html.ts` | Standalone HTML report export with inline CSS. |
| `chat-file-compare.ts` | File comparison (text diff, metadata, JSON/CSV schema diff). |
| `chat-agent-memory.ts` | Per-folder and global preference memory with Levenshtein dedup. |
| `chat-correction-learning.ts` | Detects user corrections ("no, not like that") and extracts preferences. |
| `chat-feedback-store.ts` | Thumbs up/down feedback persistence per message. |
| `chat-workspace-awareness.ts` | Project type detection (Node/Rust/Python/Go/etc.), git info, directory summary. |
| `chat-extension-awareness.ts` | Installed extension discovery, contextual suggestions, marketplace hints. |
| `chat-security-rules.ts` | Path restrictions, file type protection, rate limiting. |
| `chat-audit-log.ts` | Action audit log with session tracking and summary. |
| `chat-quick-actions.tsx` | Quick action buttons shown on empty chat. |

### Hooks

| File | Purpose |
|------|---------|
| `use-chat-actions.ts` | File action execution, undo, batch permission, auto-execute logic. |
| `use-chat-branching.ts` | State management for conversation branching. |
| `use-task-plan.ts` | Multi-step task plan state (approve, pause, resume, cancel, step tracking). |
| `use-streaming-text.ts` | Progressive text reveal animation for assistant messages. |
| `use-proactive-agent.ts` | Watches navigation and suggests actions (debounced, with cooldown). |

## Action Types

### Mutating Actions (require user permission)

| Action | Fields | Description |
|--------|--------|-------------|
| `create_file` | `path`, `content` | Create a new file with content |
| `edit_file` | `path`, `content` | Overwrite file content (captures previous for undo) |
| `delete_file` | `path` | Move file to trash (recoverable) |
| `rename_file` | `path`, `destination` | Rename a file or directory |
| `move_file` | `path`, `destination` | Move a file to a new location |
| `copy_file` | `path`, `destination` | Copy a file |
| `create_directory` | `path` | Create a directory (recursive) |

### Terminal Commands (always require explicit permission)

| Action | Fields | Description |
|--------|--------|-------------|
| `run_command` | `command`, `cwd` | Execute a shell command with 30s timeout |

Dangerous commands (rm -rf, sudo, etc.) are flagged with a warning. Output (stdout/stderr/exit code) is captured and shown in the UI.

### Read-Only Actions (auto-execute, no permission needed)

| Action | Fields | Description |
|--------|--------|-------------|
| `list_directory` | `path` | List directory contents |
| `search_files` | `path`, `query` | Search for files by glob pattern |
| `open_file` | `path` | Navigate to file/directory in the explorer |
| `open_extension` | `extension_id`, `path` | Open a file in an installed extension |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/organize` | Analyze and organize the current folder |
| `/summarize` | Summarize selected files |
| `/search <query>` | Search files by query |
| `/diff <file1> <file2>` | Compare two files |
| `/compare <file1> <file2>` | Deep file comparison with schema analysis |
| `/memory` | Show what the agent remembers about this folder |
| `/forget` | Clear agent memory for this folder |
| `/templates` | List saved action templates |
| `/save-template <name>` | Save last action sequence as a reusable template |
| `/run-template <name>` | Run a saved template |
| `/delete-template <name>` | Delete a saved template |
| `/describe` | Describe selected image(s) using vision |
| `/export [md]` | Export chat as HTML report (or markdown) |
| `/pin` | Toggle pin on the last AI message |
| `/preferences` | Show learned preferences and feedback history |
| `/audit` | Show recent agent action audit log |
| `/security` | Show and configure security rules |
| `/help` | Show available commands |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+L` / `Cmd+L` | Clear chat |
| `Up Arrow` (empty input) | Recall last message |
| `Escape` | Stop agent (if loading) or blur input |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |

## Memory & Learning

### Agent Memory (`chat-agent-memory.ts`)

The agent remembers observations per folder and globally:

- **Per-folder**: Things learned about specific directories (file patterns, organization preferences, project context).
- **Global**: User preferences that apply everywhere (preferred naming conventions, default behaviors).
- **Deduplication**: Uses Levenshtein similarity (>85% threshold) to avoid storing duplicate observations.
- **Eviction**: Entries older than 30 days are removed. Max 15 observations per folder, 50 folders, 20 global preferences.
- **Memory tags**: The AI includes `[MEMORY:folder]` or `[MEMORY:global]` tags in responses to save observations. These are stripped from the displayed text.

### Correction Learning (`chat-correction-learning.ts`)

When the user corrects the agent (e.g., "no, organize by date not by type"), the system:

1. Detects correction patterns (starts with "no", "actually", "instead", "I prefer", etc.)
2. Extracts the preference statement
3. Determines if it's global or folder-specific
4. Saves it as a memory observation tagged `[correction, preference]`

Corrections are given highest priority in the system prompt so the AI respects them.

### Feedback Store (`chat-feedback-store.ts`)

Thumbs up/down on assistant messages:

- Positive feedback reinforces the approach (saved as a positive memory).
- Negative feedback with optional correction text saves what the user wants differently.
- Feedback history is injected into the system prompt for future responses.

## Security Rules (`chat-security-rules.ts`)

Configurable rules that restrict agent actions:

- **Path restrictions**: Block actions on system directories (`/etc`, `/usr`, `C:\Windows`, etc.).
- **File type restrictions**: Prevent deleting protected file types (`.key`, `.pem`, `.env`, etc.).
- **Rate limiting**: Max mutating operations per minute (default: 20) to prevent runaway loops.
- **Configuration**: Via `/security` command or by saying "add blocked path /some/path".
- **Audit logging**: All blocked actions are logged with the blocking rule name.

## Extending the Agent

### Adding a New Action Type

1. Add the action name to `FileActionType` union in `chat-file-actions.tsx`.
2. Add it to the appropriate set (`READONLY_ACTIONS`, `ALWAYS_ASK_ACTIONS`, or neither for standard mutating).
3. Add the action name to `ALL_ACTION_NAMES` array.
4. Add parsing logic in `tryParseAction` if it has special fields.
5. Add execution logic in `executeFileAction` switch statement.
6. Add undo logic in `undoFileAction` if applicable.
7. Update `canUndoAction` to handle the new action.
8. Add the action description to `FILE_OPS_SYSTEM_PROMPT`.
9. If the action needs security checks, add it to `MUTATING_ACTIONS` in `chat-security-rules.ts`.
10. Add a mapping in `ACTION_TYPE_TO_SUMMARY_KEY` in `chat-audit-log.ts` for session summaries.

### Adding a New Slash Command

1. Add a `SlashCommand` entry to `SLASH_COMMANDS` in `chat-slash-commands.ts`.
2. If the command is handled client-side (no AI call), add a handler in `chat-special-commands.ts`.
3. If it uses a magic prefix (e.g., `__SHOW_*__`), add the handler in `sendMessage` in `StandaloneChatPanel.tsx`.

### Adding a New Proactive Suggestion

1. Create a `SuggestionGenerator` function in `use-proactive-agent.ts`.
2. Add it to the `GENERATORS` array (order matters -- first match wins).
3. The function receives `WorkspaceContext` and returns `ProactiveSuggestion | null`.

### Storage Keys

All localStorage keys are centralized in `apps/client/src/lib/storage-keys.ts`. When adding new persistent state, always add a new key there. Current AI chat keys:

- `AI_FILE_ACCESS_GRANTED` -- "Always allow" file operations toggle
- `AI_CHAT_HISTORY` -- Saved conversations
- `AI_ACTION_TEMPLATES` -- Saved action templates
- `PROACTIVE_AGENT_ENABLED` -- Proactive suggestions toggle
- `AI_AGENT_MEMORY` -- Per-folder and global observations
- `AI_CHAT_PINNED` -- Pinned messages per conversation
- `AI_CHAT_FEEDBACK` -- Thumbs up/down feedback entries
- `AI_AUDIT_LOG` -- Action audit log
- `AI_SECURITY_RULES` -- Security rule configuration
