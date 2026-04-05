/**
 * Additional slash commands that extend the base set in chat-slash-commands.ts.
 *
 * These are registered separately to avoid modifying the core slash commands
 * file (which other agents may be working on). Both sets are merged at runtime
 * by ChatSlashInput and handled by chat-special-commands.
 */
import type { SlashCommand } from './chat-slash-commands';

// ---------------------------------------------------------------------------
// Additional command definitions
// ---------------------------------------------------------------------------

export const EXTRA_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/commit-message',
    description: 'Generate a smart commit message from staged changes',
    toPrompt: (_args) => '__GENERATE_COMMIT_MESSAGE__',
  },
  {
    name: '/workflows',
    description: 'List available workflow templates',
    toPrompt: (_args) => '__LIST_WORKFLOWS__',
  },
  {
    name: '/run-workflow',
    description: 'Run a workflow template by name',
    hasArgs: true,
    toPrompt: (args) => `__RUN_WORKFLOW__${args}`,
  },
  {
    name: '/save-workflow',
    description: 'Save the last chat interaction as a workflow',
    hasArgs: true,
    toPrompt: (args) => `__SAVE_WORKFLOW__${args}`,
  },
  {
    name: '/delete-workflow',
    description: 'Delete a saved workflow',
    hasArgs: true,
    toPrompt: (args) => `__DELETE_WORKFLOW__${args}`,
  },
];

/**
 * Try to match an extra slash command from input text.
 * Returns the prompt or null.
 */
export const matchExtraSlashCommand = (
  text: string,
): { prompt: string; command: SlashCommand } | null => {
  const trimmed = text.trim();
  for (const cmd of EXTRA_SLASH_COMMANDS) {
    if (trimmed === cmd.name || trimmed.startsWith(`${cmd.name} `)) {
      const args = trimmed.slice(cmd.name.length).trim();
      return { prompt: cmd.toPrompt(args), command: cmd };
    }
  }
  return null;
};
