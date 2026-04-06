/**
 * Workflow template system for AI chat.
 *
 * Predefined and user-saved multi-step workflow templates that auto-populate
 * the task planner. Each workflow is a series of steps with descriptions
 * and prompts that the AI executes sequentially.
 *
 * Built-in templates cover common dev/productivity tasks:
 * - "Set up Node project"
 * - "Clean up downloads folder"
 * - "Organize photos by date"
 *
 * Users can save custom workflows from successful chat interactions
 * via `/save-workflow <name>`.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  /** Human-readable step description */
  description: string;
  /** The prompt to send to the AI for this step */
  prompt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** Category for grouping in the UI */
  category: 'development' | 'organization' | 'productivity' | 'custom';
  /** The steps to execute */
  steps: WorkflowStep[];
  /** Whether this is a built-in template (cannot be deleted) */
  builtin: boolean;
  /** When this template was created (for custom templates) */
  createdAt: number;
  /** How many times this workflow has been run */
  runCount: number;
}

export interface WorkflowCommandResult {
  type: 'handled' | 'redirect' | 'task_plan';
  responseText?: string;
  redirectPrompt?: string;
  /** JSON string of a task plan to inject into the chat */
  taskPlanJson?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = STORAGE_KEYS.AI_WORKFLOW_TEMPLATES;
const MAX_CUSTOM_WORKFLOWS = 30;

// ---------------------------------------------------------------------------
// Built-in workflow templates
// ---------------------------------------------------------------------------

const BUILTIN_WORKFLOWS: WorkflowTemplate[] = [
  {
    id: 'builtin-setup-node',
    name: 'Set up Node project',
    description:
      'Initialize a new Node.js project with package.json, TypeScript, ESLint, and Prettier',
    category: 'development',
    steps: [
      {
        description: 'Create package.json with npm init',
        prompt: 'Run `npm init -y` in the current directory to create a basic package.json',
      },
      {
        description: 'Install TypeScript and dev dependencies',
        prompt: 'Run `npm install --save-dev typescript @types/node ts-node` to set up TypeScript',
      },
      {
        description: 'Create tsconfig.json',
        prompt:
          'Create a tsconfig.json file with strict mode enabled, target ES2022, module NodeNext, and outDir set to ./dist',
      },
      {
        description: 'Set up ESLint and Prettier',
        prompt:
          'Run `npm install --save-dev eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin` and create basic .eslintrc.json and .prettierrc configs',
      },
      {
        description: 'Create project structure',
        prompt:
          'Create a src/ directory with an index.ts file containing a simple hello world, and add build/start/dev scripts to package.json',
      },
      {
        description: 'Create .gitignore',
        prompt:
          'Create a .gitignore file with common Node.js entries: node_modules, dist, .env, *.log',
      },
    ],
    builtin: true,
    createdAt: 0,
    runCount: 0,
  },
  {
    id: 'builtin-clean-downloads',
    name: 'Clean up downloads folder',
    description: 'Organize a messy downloads folder by moving files into categorized subfolders',
    category: 'organization',
    steps: [
      {
        description: 'Scan the downloads folder',
        prompt:
          'List all files in the current directory and categorize them by type (images, documents, archives, videos, audio, code, installers, other)',
      },
      {
        description: 'Create category folders',
        prompt:
          'Create subfolders for each category that has 2 or more files: Images, Documents, Archives, Videos, Audio, Code, Installers',
      },
      {
        description: 'Move files to their categories',
        prompt:
          'Move each file into its appropriate category folder. Images (.jpg, .png, .gif, .webp, .svg) go to Images/, Documents (.pdf, .doc, .docx, .txt, .xlsx) go to Documents/, Archives (.zip, .tar, .gz, .rar) go to Archives/, etc.',
      },
      {
        description: 'Report the results',
        prompt:
          'List the final folder structure and report how many files were moved into each category and how much space each category uses',
      },
    ],
    builtin: true,
    createdAt: 0,
    runCount: 0,
  },
  {
    id: 'builtin-organize-photos',
    name: 'Organize photos by date',
    description: 'Sort photos into year/month folders based on their modification dates',
    category: 'organization',
    steps: [
      {
        description: 'Scan for image files',
        prompt:
          'List all image files (.jpg, .jpeg, .png, .heic, .raw, .cr2, .nef) in the current directory and its immediate subdirectories',
      },
      {
        description: 'Analyze date distribution',
        prompt:
          'Group the found images by year and month based on their modification dates. Show a summary of how many photos are in each year/month',
      },
      {
        description: 'Create date-based folder structure',
        prompt:
          'Create folders in the format YYYY/MM (e.g., 2024/01, 2024/02) for each year/month combination that has photos',
      },
      {
        description: 'Move photos to date folders',
        prompt:
          'Move each photo to its corresponding YYYY/MM folder based on its modification date. Report progress as you go',
      },
      {
        description: 'Clean up empty folders',
        prompt:
          'Check for any empty folders left behind after moving photos and offer to delete them. Show the final folder structure',
      },
    ],
    builtin: true,
    createdAt: 0,
    runCount: 0,
  },
  {
    id: 'builtin-setup-react',
    name: 'Set up React component',
    description: 'Scaffold a new React component with TypeScript, tests, and styles',
    category: 'development',
    steps: [
      {
        description: 'Create component file',
        prompt:
          'Create a new React functional component file with TypeScript. Use arrow function syntax, include proper prop types interface, and export it as default',
      },
      {
        description: 'Create test file',
        prompt:
          'Create a test file for the component using Vitest and React Testing Library. Include basic render test and prop testing',
      },
      {
        description: 'Create styles',
        prompt: 'Create a CSS module file for the component with basic layout styles',
      },
      {
        description: 'Create index barrel export',
        prompt: 'Create an index.ts barrel file that re-exports the component and its types',
      },
    ],
    builtin: true,
    createdAt: 0,
    runCount: 0,
  },
  {
    id: 'builtin-weekly-cleanup',
    name: 'Weekly file cleanup',
    description: 'Find and clean up old temp files, duplicates, and large unused files',
    category: 'productivity',
    steps: [
      {
        description: 'Find temporary files',
        prompt:
          'Search for temporary files in the current directory tree: .tmp, .temp, ~*, .bak, .swp, .DS_Store, Thumbs.db. List them with sizes',
      },
      {
        description: 'Find large files',
        prompt:
          'Find the 20 largest files in the current directory tree. Show their paths and sizes, sorted by size descending',
      },
      {
        description: 'Find old files',
        prompt:
          'Find files that have not been modified in the last 90 days. Group them by directory and show total size per directory',
      },
      {
        description: 'Generate cleanup report',
        prompt:
          'Summarize what was found: total temp files and their size, largest files, old files. Suggest which ones are safe to delete and offer to clean them up',
      },
    ],
    builtin: true,
    createdAt: 0,
    runCount: 0,
  },
];

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const loadCustomWorkflows = (): WorkflowTemplate[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkflowTemplate[];
  } catch {
    return [];
  }
};

const saveCustomWorkflows = (workflows: WorkflowTemplate[]): void => {
  try {
    const trimmed = workflows.slice(0, MAX_CUSTOM_WORKFLOWS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all available workflows (builtin + custom).
 */
export const getAllWorkflows = (): WorkflowTemplate[] => {
  const custom = loadCustomWorkflows();
  return [...BUILTIN_WORKFLOWS, ...custom];
};

/**
 * Find a workflow by name (case-insensitive partial match).
 */
export const findWorkflow = (name: string): WorkflowTemplate | undefined => {
  const all = getAllWorkflows();
  const lower = name.toLowerCase().trim();
  // Exact match first
  const exact = all.find((w) => w.name.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match
  return all.find((w) => w.name.toLowerCase().includes(lower));
};

/**
 * Save a custom workflow from a successful chat interaction.
 */
export const saveCustomWorkflow = (
  name: string,
  description: string,
  steps: WorkflowStep[],
): WorkflowTemplate => {
  const workflow: WorkflowTemplate = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    category: 'custom',
    steps,
    builtin: false,
    createdAt: Date.now(),
    runCount: 0,
  };

  const custom = loadCustomWorkflows();
  custom.unshift(workflow);
  saveCustomWorkflows(custom);
  return workflow;
};

/**
 * Delete a custom workflow by ID.
 */
export const deleteWorkflow = (workflowId: string): boolean => {
  const custom = loadCustomWorkflows();
  const filtered = custom.filter((w) => w.id !== workflowId);
  if (filtered.length === custom.length) return false; // Not found
  saveCustomWorkflows(filtered);
  return true;
};

/**
 * Increment the run count of a workflow.
 */
export const incrementWorkflowRunCount = (workflowId: string): void => {
  // Check builtin first (stored in memory only -- reset on reload)
  const builtin = BUILTIN_WORKFLOWS.find((w) => w.id === workflowId);
  if (builtin) {
    builtin.runCount += 1;
    return;
  }

  const custom = loadCustomWorkflows();
  const idx = custom.findIndex((w) => w.id === workflowId);
  if (idx >= 0) {
    custom[idx] = { ...custom[idx], runCount: custom[idx].runCount + 1 };
    saveCustomWorkflows(custom);
  }
};

// ---------------------------------------------------------------------------
// Display formatters
// ---------------------------------------------------------------------------

/**
 * Format the workflow list for display in chat.
 */
export const formatWorkflowList = (): string => {
  const all = getAllWorkflows();

  if (all.length === 0) {
    return 'No workflow templates available.';
  }

  const lines: string[] = ['**Available Workflow Templates**\n'];

  const categories: Record<string, WorkflowTemplate[]> = {};
  for (const w of all) {
    const cat = w.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(w);
  }

  const categoryLabels: Record<string, string> = {
    development: 'Development',
    organization: 'Organization',
    productivity: 'Productivity',
    custom: 'Custom',
  };

  for (const [cat, workflows] of Object.entries(categories)) {
    lines.push(`**${categoryLabels[cat] ?? cat}**`);
    for (const w of workflows) {
      const badge = w.builtin ? '' : ' (custom)';
      const runs = w.runCount > 0 ? ` -- used ${w.runCount}x` : '';
      lines.push(`- \`/run-workflow ${w.name}\`${badge}${runs}`);
      lines.push(`  ${w.description}`);
      lines.push(`  ${w.steps.length} steps`);
    }
    lines.push('');
  }

  lines.push('Run a workflow with `/run-workflow <name>`');
  lines.push('Save a custom workflow with `/save-workflow <name>`');

  return lines.join('\n');
};

/**
 * Convert a workflow into a task plan JSON string for the task planner.
 */
export const workflowToTaskPlan = (workflow: WorkflowTemplate): string => {
  const plan = {
    title: workflow.name,
    steps: workflow.steps.map((step) => ({
      description: step.description,
      prompt: step.prompt,
    })),
  };
  return JSON.stringify(plan, null, 2);
};

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------

/**
 * Handle workflow-related slash commands.
 * Returns null if the prompt is not a workflow command.
 */
export const handleWorkflowSlashCommand = (
  prompt: string,
  _currentPath: string,
): WorkflowCommandResult | null => {
  // /workflows -- list available workflows
  if (prompt === '__LIST_WORKFLOWS__') {
    return {
      type: 'handled',
      responseText: formatWorkflowList(),
    };
  }

  // /run-workflow <name>
  if (prompt.startsWith('__RUN_WORKFLOW__')) {
    const name = prompt.slice('__RUN_WORKFLOW__'.length).trim();
    if (!name) {
      return {
        type: 'handled',
        responseText:
          'Please provide a workflow name: `/run-workflow <name>`\n\nUse `/workflows` to see available workflows.',
      };
    }

    const workflow = findWorkflow(name);
    if (!workflow) {
      return {
        type: 'handled',
        responseText: `Workflow "${name}" not found.\n\nUse \`/workflows\` to see available workflows.`,
      };
    }

    incrementWorkflowRunCount(workflow.id);

    // Generate a task plan for the workflow
    const taskPlanJson = workflowToTaskPlan(workflow);

    return {
      type: 'task_plan',
      responseText: `Starting workflow: **${workflow.name}**\n\n${workflow.description}`,
      taskPlanJson,
    };
  }

  // /save-workflow <name>
  if (prompt.startsWith('__SAVE_WORKFLOW__')) {
    const name = prompt.slice('__SAVE_WORKFLOW__'.length).trim();
    if (!name) {
      return {
        type: 'handled',
        responseText:
          'Please provide a name for the workflow: `/save-workflow <name>`\n\nThis will save the last successful multi-step interaction as a reusable workflow.',
      };
    }

    // Check if the name already exists
    const existing = findWorkflow(name);
    if (existing) {
      return {
        type: 'handled',
        responseText: `A workflow named "${existing.name}" already exists. Choose a different name or delete the existing one with \`/delete-workflow ${existing.name}\`.`,
      };
    }

    // Save a placeholder workflow -- the caller should populate the steps
    // from the last chat interaction's task plan or action sequence.
    // For now, create a stub that the user can customize.
    const workflow = saveCustomWorkflow(name, 'Custom workflow saved from chat interaction', [
      {
        description: 'Execute the saved workflow',
        prompt: `Run the "${name}" workflow as previously demonstrated in our conversation.`,
      },
    ]);

    return {
      type: 'handled',
      responseText: `Workflow **"${workflow.name}"** saved.\n\nRun it anytime with \`/run-workflow ${workflow.name}\`\nDelete it with \`/delete-workflow ${workflow.name}\``,
    };
  }

  // /delete-workflow <name>
  if (prompt.startsWith('__DELETE_WORKFLOW__')) {
    const name = prompt.slice('__DELETE_WORKFLOW__'.length).trim();
    if (!name) {
      return {
        type: 'handled',
        responseText: 'Please provide a workflow name: `/delete-workflow <name>`',
      };
    }

    const workflow = findWorkflow(name);
    if (!workflow) {
      return {
        type: 'handled',
        responseText: `Workflow "${name}" not found.\n\nUse \`/workflows\` to see available workflows.`,
      };
    }

    if (workflow.builtin) {
      return {
        type: 'handled',
        responseText: `Cannot delete built-in workflow "${workflow.name}". Only custom workflows can be deleted.`,
      };
    }

    deleteWorkflow(workflow.id);
    return {
      type: 'handled',
      responseText: `Workflow **"${workflow.name}"** deleted.`,
    };
  }

  return null;
};
