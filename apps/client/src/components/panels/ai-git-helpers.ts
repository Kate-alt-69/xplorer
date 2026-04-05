/**
 * AI-powered Git helpers for the Xplorer file manager.
 *
 * Provides smart commit message generation by reading `git diff --staged`
 * and asking the AI to produce a conventional commit message. Also exposes
 * a slash command handler for `/commit-message`.
 *
 * Usage from the Git panel: call `generateCommitMessage(repoPath, model)`
 * to get a suggested commit message string.
 *
 * Usage from chat: the `/commit-message` slash command delegates here.
 */
import { TauriAPI } from '@/lib/tauri-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitMessageResult {
  /** The suggested commit message */
  message: string;
  /** Summary of what changed (for display) */
  summary: string;
  /** Number of files changed */
  filesChanged: number;
  /** Whether there were staged changes to analyze */
  hasChanges: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max diff length to send to the AI (in characters). Larger diffs are truncated. */
const MAX_DIFF_LENGTH = 8_000;

/** System prompt for commit message generation */
const COMMIT_MSG_SYSTEM_PROMPT = `You are a commit message generator. Given a git diff, write a concise conventional commit message.

Rules:
- Use the format: type(scope): description
- Types: feat, fix, refactor, test, docs, chore, perf, style, ci, build
- Keep the subject line under 72 characters
- If the diff touches multiple areas, pick the most significant type
- Be specific about what changed and why
- Do NOT include a body or footer unless the change is complex
- Output ONLY the commit message, nothing else

Examples:
- feat(auth): add OAuth2 login with Google provider
- fix(api): handle null response in user endpoint
- refactor(utils): extract date formatting into shared helper
- docs(readme): update installation instructions for v2`;

// ---------------------------------------------------------------------------
// Core: generate commit message
// ---------------------------------------------------------------------------

/**
 * Generate a smart commit message by reading staged changes and asking the AI.
 *
 * @param repoPath - Path to the git repository root
 * @param model - AI model ID to use (e.g. "gpt-4o", "claude-3-5-sonnet")
 * @returns CommitMessageResult with the suggested message
 */
export const generateCommitMessage = async (
  repoPath: string,
  model: string,
): Promise<CommitMessageResult> => {
  // 1. Get staged diff
  const stagedDiff = await getStagedDiff(repoPath);

  if (!stagedDiff.trim()) {
    return {
      message: '',
      summary: 'No staged changes found. Stage files with `git add` first.',
      filesChanged: 0,
      hasChanges: false,
    };
  }

  // 2. Get file status for context
  const fileStatuses = await getFileStatuses(repoPath);
  const stagedFiles = fileStatuses.filter((f) => f.staged);

  // 3. Truncate diff if needed
  const truncatedDiff =
    stagedDiff.length > MAX_DIFF_LENGTH
      ? `${stagedDiff.slice(0, MAX_DIFF_LENGTH)}\n\n[... diff truncated at ${MAX_DIFF_LENGTH} chars ...]`
      : stagedDiff;

  // 4. Build the prompt
  const userPrompt = buildPrompt(truncatedDiff, stagedFiles);

  // 5. Ask the AI
  const aiResponse = await TauriAPI.chatWithAI(
    model,
    [
      { role: 'system', content: COMMIT_MSG_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    null,
  );

  // 6. Clean up the response (strip markdown code fences if present)
  const cleanMessage = cleanCommitMessage(aiResponse);

  return {
    message: cleanMessage,
    summary: buildSummary(stagedFiles),
    filesChanged: stagedFiles.length,
    hasChanges: true,
  };
};

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

interface FileStatusInfo {
  path: string;
  status: string;
  staged: boolean;
}

/**
 * Get the staged diff from the repository.
 */
const getStagedDiff = async (repoPath: string): Promise<string> => {
  try {
    const { stdout } = await TauriAPI.executeCommand('git diff --staged', repoPath);
    return stdout;
  } catch {
    return '';
  }
};

/**
 * Get file statuses (staged and unstaged).
 */
const getFileStatuses = async (repoPath: string): Promise<FileStatusInfo[]> => {
  try {
    const { stdout } = await TauriAPI.executeCommand('git status --porcelain', repoPath);

    if (!stdout.trim()) return [];

    return stdout
      .trim()
      .split('\n')
      .map((line) => {
        const indexStatus = line[0];
        const _workStatus = line[1];
        const filePath = line.slice(3).trim();

        // Index status: M=modified, A=added, D=deleted, R=renamed, ' '=not staged
        const staged = indexStatus !== ' ' && indexStatus !== '?';
        const statusMap: Record<string, string> = {
          M: 'modified',
          A: 'added',
          D: 'deleted',
          R: 'renamed',
          C: 'copied',
          '?': 'untracked',
        };

        return {
          path: filePath,
          status: statusMap[indexStatus] ?? 'unknown',
          staged,
        };
      });
  } catch {
    return [];
  }
};

/**
 * Build the user prompt for the AI.
 */
const buildPrompt = (diff: string, stagedFiles: FileStatusInfo[]): string => {
  const fileList = stagedFiles.map((f) => `  ${f.status}: ${f.path}`).join('\n');

  return `Generate a commit message for these staged changes:

Files changed (${stagedFiles.length}):
${fileList}

Diff:
\`\`\`diff
${diff}
\`\`\``;
};

/**
 * Build a human-readable summary of changes.
 */
const buildSummary = (files: FileStatusInfo[]): string => {
  const counts: Record<string, number> = {};
  for (const f of files) {
    counts[f.status] = (counts[f.status] ?? 0) + 1;
  }

  const parts = Object.entries(counts).map(([status, count]) => `${count} ${status}`);

  return `${files.length} file${files.length !== 1 ? 's' : ''}: ${parts.join(', ')}`;
};

/**
 * Clean up an AI-generated commit message.
 * Strips markdown code fences, extra whitespace, and quotes.
 */
const cleanCommitMessage = (raw: string): string => {
  let msg = raw.trim();

  // Remove code fences
  msg = msg.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '');

  // Remove surrounding quotes
  if ((msg.startsWith('"') && msg.endsWith('"')) || (msg.startsWith("'") && msg.endsWith("'"))) {
    msg = msg.slice(1, -1);
  }

  // Trim again
  msg = msg.trim();

  // If the message has multiple lines, take only the first non-empty line
  // as the subject (commit title)
  const lines = msg.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    // Return full message if it has a body (separated by blank line)
    const blankLineIdx = msg.indexOf('\n\n');
    if (blankLineIdx > 0) {
      return msg;
    }
    return lines[0].trim();
  }

  return msg;
};

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------

/**
 * Handle the `/commit-message` slash command.
 *
 * Reads the current directory's git status and generates a commit message.
 * Returns a formatted string for display in the chat panel.
 */
export const handleCommitMessageCommand = async (
  currentPath: string,
  model: string,
): Promise<string> => {
  // Find git repository root
  let repoPath: string | null = null;
  try {
    repoPath = await TauriAPI.findGitRepository(currentPath);
  } catch {
    // Not in a git repo
  }

  if (!repoPath) {
    return '**Commit Message Generator**\n\nNo Git repository found in the current directory. Navigate to a folder inside a Git repository and try again.';
  }

  try {
    const result = await generateCommitMessage(repoPath, model);

    if (!result.hasChanges) {
      return `**Commit Message Generator**\n\n${result.summary}\n\nStage your changes with \`git add <files>\` and run \`/commit-message\` again.`;
    }

    const lines = [
      '**Suggested Commit Message**\n',
      '```',
      result.message,
      '```',
      '',
      `*${result.summary}*`,
      '',
      'You can copy this message and use it with `git commit -m "..."`, or click the commit button in the Git panel.',
    ];

    return lines.join('\n');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return `**Commit Message Generator**\n\nFailed to generate commit message: ${errMsg}\n\nMake sure you have staged changes and a valid AI model configured.`;
  }
};

// Re-exports for testing
export { getStagedDiff, cleanCommitMessage, buildSummary, buildPrompt };
