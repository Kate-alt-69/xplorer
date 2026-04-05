/**
 * Slash command definitions for the AI chat panel.
 * Type /command in the chat input for quick actions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashCommand {
  name: string;
  description: string;
  /** If true, everything after the command name is an argument */
  hasArgs?: boolean;
  /** Transform the slash command into a natural language prompt for the AI */
  toPrompt: (args: string) => string;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/organize',
    description: 'Organize the current folder',
    toPrompt: (_args) =>
      'Analyze this folder and organize it. Group related files into subfolders by type or purpose. Show me your plan before executing.',
  },
  {
    name: '/summarize',
    description: 'Summarize selected files',
    toPrompt: (_args) =>
      "Read and summarize the selected file(s). Give a concise overview of each file's purpose and contents.",
  },
  {
    name: '/search',
    description: 'Search files by query',
    hasArgs: true,
    toPrompt: (args) =>
      `Search for files matching "${args}" in the current directory and its subdirectories. Show me the results.`,
  },
  {
    name: '/diff',
    description: 'Compare two files',
    hasArgs: true,
    toPrompt: (args) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length >= 2) {
        return `Compare these two files and show me the differences:\n1. ${parts[0]}\n2. ${parts[1]}`;
      }
      return `Compare the selected files and show me the differences.`;
    },
  },
  {
    name: '/compare',
    description: 'Deep file comparison with diff/schema analysis',
    hasArgs: true,
    toPrompt: (args) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length >= 2) {
        return `__COMPARE_FILES__${parts[0]}|${parts[1]}`;
      }
      return '__COMPARE_SELECTED__';
    },
  },
  {
    name: '/memory',
    description: 'Show what the agent remembers about this folder',
    toPrompt: (_args) => '__SHOW_MEMORY__',
  },
  {
    name: '/forget',
    description: 'Clear agent memory for this folder',
    toPrompt: (_args) => '__CLEAR_MEMORY__',
  },
  {
    name: '/templates',
    description: 'List saved action templates',
    toPrompt: (_args) => '__LIST_TEMPLATES__',
  },
  {
    name: '/save-template',
    description: 'Save last action sequence as template',
    hasArgs: true,
    toPrompt: (args) => `__SAVE_TEMPLATE__${args}`,
  },
  {
    name: '/run-template',
    description: 'Run a saved action template',
    hasArgs: true,
    toPrompt: (args) => `__RUN_TEMPLATE__${args}`,
  },
  {
    name: '/delete-template',
    description: 'Delete a saved template',
    hasArgs: true,
    toPrompt: (args) => `__DELETE_TEMPLATE__${args}`,
  },
  {
    name: '/describe',
    description: 'Describe selected image(s)',
    toPrompt: (_args) =>
      'Describe this image in detail. What is shown, what are the key elements, colors, and composition? Provide any useful observations.',
  },
  {
    name: '/export',
    description: 'Export chat as HTML report (or /export md for markdown)',
    toPrompt: (args) => {
      const fmt = args.trim().toLowerCase();
      if (fmt === 'md' || fmt === 'markdown') return '__EXPORT_CHAT_MD__';
      return '__EXPORT_CHAT_HTML__';
    },
    hasArgs: true,
  },
  {
    name: '/pin',
    description: 'Toggle pin on the last AI message',
    toPrompt: (_args) => '__PIN_LAST__',
  },
  {
    name: '/preferences',
    description: 'Show learned preferences and feedback history',
    toPrompt: (_args) => '__SHOW_PREFERENCES__',
  },
  {
    name: '/audit',
    description: 'Show recent agent action audit log',
    toPrompt: (_args) => '__SHOW_AUDIT__',
  },
  {
    name: '/security',
    description: 'Show and configure security rules',
    toPrompt: (_args) => '__SHOW_SECURITY__',
  },
  {
    name: '/help',
    description: 'Show available commands',
    toPrompt: (_args) => '__SHOW_HELP__',
  },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Try to match a slash command from input text. Returns the prompt or null. */
export const matchSlashCommand = (
  text: string,
): { prompt: string; command: SlashCommand } | null => {
  const trimmed = text.trim();
  for (const cmd of SLASH_COMMANDS) {
    if (trimmed === cmd.name || trimmed.startsWith(`${cmd.name} `)) {
      const args = trimmed.slice(cmd.name.length).trim();
      return { prompt: cmd.toPrompt(args), command: cmd };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Language extension map for "Save as file" feature
// ---------------------------------------------------------------------------

export const LANG_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  rust: 'rs',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  html: 'html',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  xml: 'xml',
  sql: 'sql',
  shell: 'sh',
  bash: 'sh',
  zsh: 'sh',
  markdown: 'md',
  md: 'md',
  toml: 'toml',
  tsx: 'tsx',
  jsx: 'jsx',
};
