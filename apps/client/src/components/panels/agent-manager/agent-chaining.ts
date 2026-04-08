/**
 * Agent Chaining — sequential multi-step agent pipelines.
 *
 * An AgentChain is an ordered list of steps. Each step defines a
 * prompt template and model. When a chain runs, the output of each
 * step is injected as context into the next step's prompt.
 *
 * Built-in chains:
 *   - "Review & Fix": reviewer -> fixer -> tester
 *   - "Document & Test": documenter -> test writer
 */

import type { CreateSessionParams } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainStep {
  /** Unique step identifier */
  id: string;
  /** Human-readable step label */
  label: string;
  /** Prompt template — use `{{input}}` for previous step output,
   *  `{{workingDir}}` for working directory,
   *  `{{files}}` for selected files list */
  promptTemplate: string;
  /** Model to use for this step */
  model: string;
}

export interface AgentChain {
  /** Unique chain identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Ordered steps */
  steps: ChainStep[];
}

export type ChainStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface ChainStepResult {
  stepId: string;
  status: ChainStepStatus;
  /** Output text from this step (passed as input to the next) */
  output: string;
  /** Session ID if a cloud agent was created */
  sessionId?: string;
  /** Error message if status is 'error' */
  error?: string;
  /** Elapsed time in ms */
  elapsedMs: number;
}

export interface ChainRunResult {
  chainId: string;
  steps: ChainStepResult[];
  /** Overall success — true if all steps completed */
  success: boolean;
  /** Total elapsed time in ms */
  totalElapsedMs: number;
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a prompt template by replacing placeholders.
 */
export const resolveTemplate = (
  template: string,
  vars: {
    input?: string;
    workingDir?: string;
    files?: string[];
  },
): string => {
  let result = template;
  result = result.replace(/\{\{input\}\}/g, vars.input ?? '');
  result = result.replace(/\{\{workingDir\}\}/g, vars.workingDir ?? '/');
  result = result.replace(
    /\{\{files\}\}/g,
    vars.files && vars.files.length > 0 ? vars.files.join('\n') : '(none)',
  );
  return result;
};

// ---------------------------------------------------------------------------
// Chain runner
// ---------------------------------------------------------------------------

/**
 * Run a chain sequentially. Each step's output becomes the next step's input.
 *
 * @param chain       - The chain definition
 * @param workingDir  - Working directory for all steps
 * @param files       - Selected files (optional)
 * @param executeStep - Callback that actually runs a step (creates a session
 *                      and waits for completion, returning the output text).
 *                      This is injected so the chain runner stays decoupled
 *                      from the Tauri API.
 * @param onProgress  - Called after each step completes
 */
export const runChain = async (
  chain: AgentChain,
  workingDir: string,
  files: string[],
  executeStep: (params: CreateSessionParams) => Promise<string>,
  onProgress?: (stepIndex: number, result: ChainStepResult) => void,
): Promise<ChainRunResult> => {
  const results: ChainStepResult[] = [];
  const chainStart = Date.now();
  let previousOutput = '';

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];
    const stepStart = Date.now();

    const prompt = resolveTemplate(step.promptTemplate, {
      input: previousOutput,
      workingDir,
      files,
    });

    const params: CreateSessionParams = {
      name: `${chain.name} — ${step.label}`,
      prompt,
      model: step.model,
      working_directory: workingDir,
      selected_files: files,
    };

    try {
      const output = await executeStep(params);
      const result: ChainStepResult = {
        stepId: step.id,
        status: 'done',
        output,
        elapsedMs: Date.now() - stepStart,
      };
      results.push(result);
      previousOutput = output;
      onProgress?.(i, result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result: ChainStepResult = {
        stepId: step.id,
        status: 'error',
        output: '',
        error: errorMsg,
        elapsedMs: Date.now() - stepStart,
      };
      results.push(result);
      onProgress?.(i, result);

      // Mark remaining steps as skipped
      for (let j = i + 1; j < chain.steps.length; j++) {
        const skipped: ChainStepResult = {
          stepId: chain.steps[j].id,
          status: 'skipped',
          output: '',
          elapsedMs: 0,
        };
        results.push(skipped);
        onProgress?.(j, skipped);
      }

      return {
        chainId: chain.id,
        steps: results,
        success: false,
        totalElapsedMs: Date.now() - chainStart,
      };
    }
  }

  return {
    chainId: chain.id,
    steps: results,
    success: true,
    totalElapsedMs: Date.now() - chainStart,
  };
};

// ---------------------------------------------------------------------------
// Built-in chains
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export const BUILTIN_CHAINS: AgentChain[] = [
  {
    id: 'review-and-fix',
    name: 'Review & Fix',
    description: 'Code reviewer finds issues, fixer resolves them, tester verifies',
    steps: [
      {
        id: 'reviewer',
        label: 'Reviewer',
        model: DEFAULT_MODEL,
        promptTemplate: [
          'You are a thorough code reviewer.',
          'Review the code in {{workingDir}} for bugs, security issues, and code quality problems.',
          'Selected files: {{files}}',
          '',
          'Output a numbered list of issues found with file paths and line numbers.',
          'Be specific and actionable.',
        ].join('\n'),
      },
      {
        id: 'fixer',
        label: 'Fixer',
        model: DEFAULT_MODEL,
        promptTemplate: [
          'You are a senior developer fixing code issues.',
          'A code review found the following issues:',
          '',
          '{{input}}',
          '',
          'Fix each issue in the codebase at {{workingDir}}.',
          'Make minimal, targeted changes. Explain each fix briefly.',
        ].join('\n'),
      },
      {
        id: 'tester',
        label: 'Tester',
        model: DEFAULT_MODEL,
        promptTemplate: [
          'You are a QA engineer verifying fixes.',
          'The following fixes were applied:',
          '',
          '{{input}}',
          '',
          'In {{workingDir}}, verify each fix is correct.',
          'Run any existing tests. Report pass/fail for each fix.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'document-and-test',
    name: 'Document & Test',
    description: 'Generate documentation then write tests for the codebase',
    steps: [
      {
        id: 'documenter',
        label: 'Documenter',
        model: DEFAULT_MODEL,
        promptTemplate: [
          'You are a technical documentation writer.',
          'Analyze the code in {{workingDir}} and generate comprehensive documentation.',
          'Selected files: {{files}}',
          '',
          'For each file, add JSDoc/docstring comments to all exports.',
          'Generate a README.md summarizing the module.',
        ].join('\n'),
      },
      {
        id: 'test-writer',
        label: 'Test Writer',
        model: DEFAULT_MODEL,
        promptTemplate: [
          'You are a test engineer.',
          'Documentation was generated:',
          '',
          '{{input}}',
          '',
          'Write comprehensive tests for the documented code in {{workingDir}}.',
          'Cover edge cases, error handling, and the documented behavior.',
          "Use the project's existing test framework.",
        ].join('\n'),
      },
    ],
  },
];

/**
 * Get a built-in chain by ID.
 */
export const getBuiltinChain = (chainId: string): AgentChain | undefined =>
  BUILTIN_CHAINS.find((c) => c.id === chainId);

/**
 * Get all available chains (built-in + custom from localStorage).
 */
export const getAllChains = (): AgentChain[] => {
  const custom = loadCustomChains();
  return [...BUILTIN_CHAINS, ...custom];
};

// ---------------------------------------------------------------------------
// Custom chain persistence
// ---------------------------------------------------------------------------

const CUSTOM_CHAINS_KEY = 'xplorer:agent-custom-chains';

const loadCustomChains = (): AgentChain[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_CHAINS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is AgentChain =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as AgentChain).id === 'string' &&
        typeof (c as AgentChain).name === 'string' &&
        Array.isArray((c as AgentChain).steps),
    );
  } catch {
    return [];
  }
};

export const saveCustomChain = (chain: AgentChain): void => {
  try {
    const existing = loadCustomChains();
    const filtered = existing.filter((c) => c.id !== chain.id);
    filtered.push(chain);
    localStorage.setItem(CUSTOM_CHAINS_KEY, JSON.stringify(filtered));
  } catch {
    console.warn('[agent-chaining] Failed to save custom chain');
  }
};

export const removeCustomChain = (chainId: string): void => {
  try {
    const existing = loadCustomChains();
    const filtered = existing.filter((c) => c.id !== chainId);
    localStorage.setItem(CUSTOM_CHAINS_KEY, JSON.stringify(filtered));
  } catch {
    console.warn('[agent-chaining] Failed to remove custom chain');
  }
};
