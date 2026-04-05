# AI Chat Agent -- Architecture & Reference

The AI chat agent is a standalone panel in Xplorer that provides conversational file management powered by LLM. Users can ask the agent to create, edit, move, delete, and organize files, run terminal commands, compare files, scan for duplicates, summarize documents, manage workflows, share conversations, and more.

## File Map

### Core Components

| File | Purpose |
|------|---------|
| `StandaloneChatPanel.tsx` | Main panel component. Orchestrates messages, input, actions, branching, and rendering. |
| `ChatPanel.tsx` | Older chat panel (server-backed agent mode). Separate from the standalone panel. |
| `ChatMessageBubble.tsx` | Renders a single chat message bubble (user or assistant). |
| `ChatMessage.tsx` | Message bubble, tool call display, active plan, pending approval, streaming, and empty state components for ChatPanel. |
| `ChatActionCards.tsx` | File action permission cards (approve/reject/undo) and batch action bar. |
| `ChatCommandCard.tsx` | Terminal command execution card with stdout/stderr output display. |
| `ChatDiffPreview.tsx` | Inline diff preview for `edit_file` actions (LCS-based line diff). |
| `ChatInput.tsx` | Chat input textarea used by ChatPanel. |
| `ChatSlashInput.tsx` | Input with slash command autocomplete (used by StandaloneChatPanel). Merges core + extra commands. |
| `ChatContextHeader.tsx` | Header showing current directory, selected files, and editor selection. |
| `ChatWelcome.tsx` | Contextual welcome message shown when chat is empty. |
| `ChatOnboarding.tsx` | First-time onboarding card with capability cards and dismissible welcome. |
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
| `chat-system-prompt.ts` | Assembles the full system prompt from all context sources with TTL caching. |
| `chat-slash-commands.ts` | Core slash command definitions (23 commands) and matching. Language extension map. |
| `chat-slash-commands-extra.ts` | Additional slash commands (/commit-message, /share, /workflows). Merged at runtime. |
| `chat-special-commands.ts` | Client-side handlers for /memory, /forget, /compare, /preferences, /audit, /security, /duplicates, /rename-pattern, /organize-folder, /find, /summarize-folder. Also async handlers for pre-computed results. |
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
| `chat-smart-file-ops.ts` | Duplicate detection, rename pattern analysis, folder organization suggestions. |
| `chat-search-integration.ts` | AI-enhanced search across filenames and file content. |
| `chat-document-intelligence.ts` | Document summarization, folder analysis, format detection, smart thumbnails. |
| `chat-clipboard-ai.ts` | Multi-modal clipboard handling: image, code, URL detection on paste. |
| `chat-share.ts` | Conversation sharing via compressed base64 links (Compression Streams API). |
| `chat-workflow-templates.ts` | Built-in and custom workflow templates with task plan generation. |
| `chat-content-scanner.ts` | Secret/credential detection in file content (API keys, tokens, passwords). |
| `ai-git-helpers.ts` | Git-aware helpers: commit message generation from staged changes. |
| `chat-quick-actions.tsx` | Quick action buttons shown on empty chat. |

### Hooks

| File | Purpose |
|------|---------|
| `use-chat-actions.ts` | File action execution, undo, batch permission, auto-execute logic. |
| `use-chat-branching.ts` | State management for conversation branching. |
| `use-chat-send.ts` | Slash command dispatch, file context building, drag-drop helpers, save-code-as-file. |
| `use-agent-loop.ts` | AI agent loop iteration and task plan step execution. |
| `use-chat-feedback.ts` | Message pinning, thumbs up/down feedback, and context menu handlers. |
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

## Slash Commands (29 total)

### File Operations
| Command | Description |
|---------|-------------|
| `/organize` | Analyze and organize the current folder |
| `/organize-folder` | Analyze folder and suggest file organization by type |
| `/summarize` | Summarize selected files |
| `/summarize-folder` | Summarize all documents in the current folder |
| `/search <query>` | Search files by query |
| `/find <query>` | AI-enhanced search across filenames and content |
| `/diff <file1> <file2>` | Compare two files |
| `/compare <file1> <file2>` | Deep file comparison with schema analysis |
| `/duplicates` | Find duplicate files in the current folder |
| `/rename-pattern` | Detect filename patterns and suggest batch rename |
| `/describe` | Describe selected image(s) using vision |

### Agent Memory & Learning
| Command | Description |
|---------|-------------|
| `/memory` | Show what the agent remembers about this folder |
| `/forget` | Clear agent memory for this folder |
| `/preferences` | Show learned preferences and feedback history |

### Templates & Workflows
| Command | Description |
|---------|-------------|
| `/templates` | List saved action templates |
| `/save-template <name>` | Save last action sequence as a reusable template |
| `/run-template <name>` | Run a saved template |
| `/delete-template <name>` | Delete a saved template |
| `/workflows` | List available workflow templates |
| `/run-workflow <name>` | Run a workflow template by name |
| `/save-workflow <name>` | Save the last chat interaction as a workflow |
| `/delete-workflow <name>` | Delete a saved workflow |

### Chat Management
| Command | Description |
|---------|-------------|
| `/export [md]` | Export chat as HTML report (or markdown) |
| `/pin` | Toggle pin on the last AI message |
| `/share` | Share this conversation as a copyable link |
| `/help` | Show available commands |

### Security & Audit
| Command | Description |
|---------|-------------|
| `/audit` | Show recent agent action audit log |
| `/security` | Show and configure security rules |

### Git Helpers
| Command | Description |
|---------|-------------|
| `/commit-message` | Generate a smart commit message from staged changes |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+L` / `Cmd+L` | Clear chat |
| `Up Arrow` (empty input) | Recall last message |
| `Escape` | Stop agent (if loading) or blur input |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |

## Capabilities

### Smart File Operations (`chat-smart-file-ops.ts`)
- **Duplicate detection**: Scans directory for files with matching sizes, groups duplicates, reports space savings.
- **Rename pattern analysis**: Detects camera timestamps, screenshot names, copy suffixes, WhatsApp media names, and suggests cleaner naming conventions.
- **Folder organization**: Analyzes file types and suggests grouping by category (Images, Documents, Code, etc.).

### Search Integration (`chat-search-integration.ts`)
- **Filename search**: Glob-based file matching.
- **Content search**: Searches inside text files for matching content with line-number snippets.
- **Combined reports**: Groups results by filename matches vs content matches.

### Document Intelligence (`chat-document-intelligence.ts`)
- **Format detection**: Identifies document types (PDF, DOCX, XLSX, PPTX, Markdown, etc.).
- **Summarization suggestions**: Automatically suggests summarization for large documents in context.
- **Folder analysis**: Scans directory for documents, categorizes them, and generates overview reports.

### Code AI Actions
- **Image description**: Vision-capable models describe selected images in detail.
- **Code explanation**: Explains selected code, identifies key functions, and flags potential issues.
- **Code saving**: Assistant code blocks can be saved directly as files with auto-detected extensions.

### Git Helpers (`ai-git-helpers.ts`)
- **Commit message generation**: Analyzes staged changes and generates conventional commit messages.

### Workflow Templates (`chat-workflow-templates.ts`)
- **Built-in workflows**: Photo organization, project setup, code review, documentation generation, dependency audit.
- **Custom workflows**: Save and replay multi-step interactions as reusable templates.
- **Task plan integration**: Workflows generate task plans with step-by-step execution, pause/resume/cancel.

### Content Scanner (`chat-content-scanner.ts`)
- **Secret detection**: Scans file content for API keys, tokens, passwords, private keys, connection strings.
- **Inline warnings**: Shows warnings in file action cards before approving writes that contain secrets.

### Clipboard AI (`chat-clipboard-ai.ts`)
- **Image paste**: Detects pasted images and converts to base64 for vision analysis.
- **Code paste**: Detects code snippets via heuristic language detection (TypeScript, Python, Rust, etc.).
- **URL paste**: Detects pasted URLs and extracts hostname/path metadata.

### Sharing (`chat-share.ts`)
- **Compressed links**: Serializes conversations to compressed base64 URL fragments using Compression Streams API.
- **Privacy**: Strips file paths and hidden context messages before sharing.
- **Clipboard copy**: Automatically copies share link to clipboard.

### Onboarding (`ChatOnboarding.tsx`)
- **First-time welcome**: Shows capability cards and example prompt on first use.
- **Dismissible**: Persists dismissal via localStorage so it only shows once.
- **Localized**: All text uses i18n keys for multi-language support.

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

1. Add a `SlashCommand` entry to `SLASH_COMMANDS` in `chat-slash-commands.ts` (or `EXTRA_SLASH_COMMANDS` in `chat-slash-commands-extra.ts`).
2. If the command is handled client-side (no AI call), add a handler in `chat-special-commands.ts`.
3. If it uses a magic prefix (e.g., `__SHOW_*__`), the `dispatchSlashCommand` function in `use-chat-send.ts` will route it.
4. Both command sets are merged in `ChatSlashInput.tsx` for autocomplete and in `dispatchSlashCommand` for matching.

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
- `AI_ONBOARDING_DONE` -- First-time onboarding dismissal
- `AI_WORKFLOW_TEMPLATES` -- Custom workflow templates

## Architecture Overview

```
StandaloneChatPanel (975 lines)
  |-- use-chat-send.ts         (slash dispatch, file context, drag-drop)
  |-- use-agent-loop.ts        (AI agent loop + plan execution)
  |-- use-chat-actions.ts      (file action execute/undo/batch)
  |-- use-chat-feedback.ts     (pinning, feedback, context menu)
  |-- use-chat-branching.ts    (conversation forking)
  |-- use-task-plan.ts         (plan state machine)
  |-- use-streaming-text.ts    (text reveal animation)
  |-- use-proactive-agent.ts   (proactive suggestions)
  |
  |-- chat-system-prompt.ts    (assembles system prompt from all sources)
  |     |-- chat-file-actions.tsx       (FILE_OPS_SYSTEM_PROMPT)
  |     |-- chat-smart-file-ops.ts      (SMART_FILE_OPS_PROMPT)
  |     |-- chat-search-integration.ts  (AI_SEARCH_PROMPT)
  |     |-- chat-document-intelligence.ts (DOCUMENT_INTELLIGENCE_PROMPT)
  |     |-- chat-workspace-awareness.ts (workspace context)
  |     |-- chat-agent-memory.ts        (memory prompt)
  |     |-- chat-correction-learning.ts (feedback prompt)
  |     |-- chat-extension-awareness.ts (extension awareness)
  |     |-- chat-security-rules.ts      (security rules)
  |
  |-- chat-slash-commands.ts      (23 core commands)
  |-- chat-slash-commands-extra.ts (6 extra commands)
  |-- chat-special-commands.ts    (client-side command handlers)
  |-- chat-action-templates.ts    (template CRUD)
  |-- chat-workflow-templates.ts  (workflow CRUD + built-ins)
  |
  |-- chat-history.ts             (conversation persistence)
  |-- chat-branching.ts           (branch data structures)
  |-- chat-pinning.ts             (pin persistence)
  |-- chat-feedback-store.ts      (feedback persistence)
  |-- chat-audit-log.ts           (audit log persistence)
  |-- chat-content-scanner.ts     (secret detection)
  |-- chat-clipboard-ai.ts        (paste handling)
  |-- chat-share.ts               (conversation sharing)
  |-- chat-export-html.ts         (HTML report export)
  |-- chat-file-compare.ts        (file diff/comparison)
  |-- ai-git-helpers.ts           (git commit message)
```
