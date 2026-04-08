/**
 * CLI agent launcher utilities.
 *
 * Spawns external AI CLI tools (Claude Code, Codex, custom commands)
 * in new PTY sessions. The terminal agent detector will automatically
 * pick up the running process.
 */
import { TauriAPI } from '@/lib/tauri-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliAgentResult {
  /** PTY session ID for tracking */
  sessionId: string;
  /** Human-readable label for the terminal tab */
  label: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cliCounter = 0;

const generateSessionId = (prefix: string): string => {
  cliCounter++;
  return `cli-${prefix}-${Date.now()}-${cliCounter}`;
};

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

/**
 * Spawn a PTY, optionally writing an initial command string after a short
 * delay to let the shell initialise.
 */
const spawnWithCommand = async (sessionId: string, cwd: string, command: string): Promise<void> => {
  await TauriAPI.ptySpawn(sessionId, cwd, DEFAULT_COLS, DEFAULT_ROWS);

  // Send the command followed by a newline to execute it
  if (command) {
    await TauriAPI.ptyWrite(sessionId, `${command}\n`);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch Claude Code CLI in a new PTY session.
 *
 * @param workingDir - Directory to run `claude` from
 * @param prompt     - Optional initial prompt to pass via stdin
 */
export const launchClaudeCode = async (
  workingDir: string,
  prompt?: string,
): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('claude');
  const command = prompt ? `claude "${prompt.replace(/"/g, '\\"')}"` : 'claude';

  await spawnWithCommand(sessionId, workingDir, command);

  return { sessionId, label: 'Claude Code' };
};

/**
 * Launch OpenAI Codex CLI in a new PTY session.
 *
 * @param workingDir - Directory to run `codex` from
 * @param prompt     - Optional initial prompt to pass via stdin
 */
export const launchCodex = async (workingDir: string, prompt?: string): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('codex');
  const command = prompt ? `codex "${prompt.replace(/"/g, '\\"')}"` : 'codex';

  await spawnWithCommand(sessionId, workingDir, command);

  return { sessionId, label: 'Codex' };
};

/**
 * Launch an arbitrary CLI command in a new PTY session.
 *
 * @param workingDir - Directory to run the command from
 * @param command    - Full CLI command string to execute
 */
export const launchCustomCli = async (
  workingDir: string,
  command: string,
): Promise<CliAgentResult> => {
  const sessionId = generateSessionId('custom');

  await spawnWithCommand(sessionId, workingDir, command);

  // Use the first token of the command as label
  const label = command.split(/\s+/)[0] || 'Custom CLI';

  return { sessionId, label };
};
