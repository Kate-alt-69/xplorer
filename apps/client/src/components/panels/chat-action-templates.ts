/**
 * Action template system for the AI chat panel.
 * Allows users to save successful multi-step action sequences
 * as reusable templates stored in localStorage.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { type FileAction } from './chat-file-actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionTemplate {
  id: string;
  name: string;
  description: string;
  /** The original prompt that triggered this sequence */
  prompt: string;
  /** The file actions that were executed */
  actions: FileAction[];
  /** When this template was created */
  createdAt: number;
  /** How many times this template has been used */
  useCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max templates to store */
const MAX_TEMPLATES = 20;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

export const loadTemplates = (): ActionTemplate[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AI_ACTION_TEMPLATES);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ActionTemplate[];
  } catch {
    return [];
  }
};

export const saveTemplates = (templates: ActionTemplate[]): void => {
  try {
    const trimmed = templates.slice(0, MAX_TEMPLATES);
    localStorage.setItem(STORAGE_KEYS.AI_ACTION_TEMPLATES, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable
  }
};

export const generateTemplateId = (): string =>
  `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Template operations
// ---------------------------------------------------------------------------

/**
 * Save a new action template from a completed sequence.
 * Strips absolute path prefixes so templates are reusable across directories.
 */
export const createTemplate = (
  name: string,
  description: string,
  prompt: string,
  actions: FileAction[],
): ActionTemplate => {
  const template: ActionTemplate = {
    id: generateTemplateId(),
    name,
    description,
    prompt,
    actions,
    createdAt: Date.now(),
    useCount: 0,
  };

  const templates = loadTemplates();
  templates.unshift(template);
  saveTemplates(templates);
  return template;
};

/**
 * Delete a template by id.
 */
export const deleteTemplate = (templateId: string): void => {
  const templates = loadTemplates().filter((t) => t.id !== templateId);
  saveTemplates(templates);
};

/**
 * Increment the use count of a template.
 */
export const incrementTemplateUseCount = (templateId: string): void => {
  const templates = loadTemplates();
  const idx = templates.findIndex((t) => t.id === templateId);
  if (idx >= 0) {
    templates[idx] = { ...templates[idx], useCount: templates[idx].useCount + 1 };
    saveTemplates(templates);
  }
};

/**
 * Format templates for display as a chat message.
 */
export const formatTemplateList = (templates: ActionTemplate[]): string => {
  if (templates.length === 0) {
    return 'No saved templates yet.\n\nTo save a template, use `/save-template <name>` after the AI completes a multi-step action sequence.';
  }

  const lines: string[] = ['**Saved Action Templates**\n'];
  for (const tmpl of templates) {
    const date = new Date(tmpl.createdAt).toLocaleDateString();
    const actionsDesc = tmpl.actions.map((a) => `\`${a.action}\``).join(', ');
    lines.push(`**${tmpl.name}** (${tmpl.actions.length} actions, used ${tmpl.useCount}x)`);
    lines.push(`  ${tmpl.description}`);
    lines.push(`  Actions: ${actionsDesc}`);
    lines.push(`  Created: ${date}`);
    lines.push(`  Run with: \`/run-template ${tmpl.name}\`\n`);
  }
  return lines.join('\n');
};

/**
 * Find a template by name (case-insensitive partial match).
 */
export const findTemplate = (name: string): ActionTemplate | undefined => {
  const templates = loadTemplates();
  const lower = name.toLowerCase().trim();
  // Exact match first
  const exact = templates.find((t) => t.name.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match
  return templates.find((t) => t.name.toLowerCase().includes(lower));
};

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------

export interface TemplateCommandResult {
  /** 'handled' means show responseText. 'redirect' means call sendMessage with redirectPrompt. */
  type: 'handled' | 'redirect';
  responseText?: string;
  redirectPrompt?: string;
}

/**
 * Handle a template-related slash command.
 * Returns null if the command is not template-related.
 *
 * @param prompt - The expanded prompt from matchSlashCommand
 * @param lastSuccessActions - The most recent successful file actions (for save)
 * @param triggerPrompt - The user prompt that triggered those actions (for save)
 */
export const handleTemplateSlashCommand = (
  prompt: string,
  lastSuccessActions: FileAction[],
  triggerPrompt: string,
): TemplateCommandResult | null => {
  if (prompt === '__LIST_TEMPLATES__') {
    const templates = loadTemplates();
    return { type: 'handled', responseText: formatTemplateList(templates) };
  }

  if (prompt.startsWith('__SAVE_TEMPLATE__')) {
    const name = prompt.slice('__SAVE_TEMPLATE__'.length).trim();
    if (!name) {
      return {
        type: 'handled',
        responseText: 'Please provide a name for the template: `/save-template <name>`',
      };
    }
    if (lastSuccessActions.length === 0) {
      return {
        type: 'handled',
        responseText:
          'No completed file actions found to save as a template. Run some file actions first, then use `/save-template <name>`.',
      };
    }
    const description = `${lastSuccessActions.length} action${lastSuccessActions.length !== 1 ? 's' : ''}: ${lastSuccessActions.map((a) => a.action).join(', ')}`;
    createTemplate(name, description, triggerPrompt, lastSuccessActions);
    return {
      type: 'handled',
      responseText: `Template **"${name}"** saved with ${lastSuccessActions.length} action${lastSuccessActions.length !== 1 ? 's' : ''}.\n\nRun it anytime with \`/run-template ${name}\``,
    };
  }

  if (prompt.startsWith('__RUN_TEMPLATE__')) {
    const name = prompt.slice('__RUN_TEMPLATE__'.length).trim();
    if (!name) {
      return {
        type: 'handled',
        responseText:
          'Please provide a template name: `/run-template <name>`\n\nUse `/templates` to see available templates.',
      };
    }
    const tmpl = findTemplate(name);
    if (!tmpl) {
      return {
        type: 'handled',
        responseText: `Template "${name}" not found.\n\nUse \`/templates\` to see available templates.`,
      };
    }
    incrementTemplateUseCount(tmpl.id);
    const redirectPrompt = tmpl.prompt
      ? `Run this action sequence again: ${tmpl.prompt}\n\nHere are the actions from the saved template "${tmpl.name}":\n${tmpl.actions.map((a) => `- ${a.action}: ${a.path}${a.destination ? ` -> ${a.destination}` : ''}`).join('\n')}\n\nPlease execute these actions with the current directory context. Adapt paths if needed.`
      : `Run the saved template "${tmpl.name}": ${tmpl.description}`;
    return { type: 'redirect', redirectPrompt };
  }

  if (prompt.startsWith('__DELETE_TEMPLATE__')) {
    const name = prompt.slice('__DELETE_TEMPLATE__'.length).trim();
    if (!name) {
      return {
        type: 'handled',
        responseText: 'Please provide a template name: `/delete-template <name>`',
      };
    }
    const tmpl = findTemplate(name);
    if (!tmpl) {
      return {
        type: 'handled',
        responseText: `Template "${name}" not found.\n\nUse \`/templates\` to see available templates.`,
      };
    }
    deleteTemplate(tmpl.id);
    return {
      type: 'handled',
      responseText: `Template **"${tmpl.name}"** deleted.`,
    };
  }

  return null;
};
