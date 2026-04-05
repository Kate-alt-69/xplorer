/**
 * Hook for managing multi-step task plan state.
 *
 * When the AI detects a complex multi-step request, it generates a plan
 * wrapped in a ```task_plan ... ``` block. This hook parses that block,
 * manages step-by-step execution with progress tracking, and supports
 * pause / resume / cancel controls.
 */
import { useState, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface TaskStep {
  /** 1-based step number */
  index: number;
  /** Human-readable description shown in the plan card */
  description: string;
  /** The prompt to send to the AI when this step executes */
  prompt: string;
  status: TaskStepStatus;
  /** Result summary after execution */
  result?: string;
  error?: string;
}

export type TaskPlanStatus =
  | 'pending_approval'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskPlan {
  id: string;
  title: string;
  steps: TaskStep[];
  status: TaskPlanStatus;
  currentStepIndex: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Try to extract a task_plan block from an AI response.
 * Expected format:
 *
 * ```task_plan
 * {
 *   "title": "Organize folder by file type",
 *   "steps": [
 *     { "description": "List directory contents", "prompt": "List all files in /path/to/dir" },
 *     ...
 *   ]
 * }
 * ```
 *
 * Returns the parsed plan and the response text with the block removed,
 * or null if no plan block is found.
 */
export const parseTaskPlan = (
  responseText: string,
): { cleanText: string; plan: TaskPlan } | null => {
  const planPattern = /```task_plan\s*\n?([\s\S]*?)```/;
  const match = planPattern.exec(responseText);
  if (!match) return null;

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== 'object') return null;

    const obj = parsed as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title : 'Task Plan';
    const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];

    if (rawSteps.length === 0) return null;

    const steps: TaskStep[] = rawSteps.map((s: unknown, i: number): TaskStep => {
      const step = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      return {
        index: i + 1,
        description: typeof step.description === 'string' ? step.description : `Step ${i + 1}`,
        prompt: typeof step.prompt === 'string' ? step.prompt : '',
        status: 'pending',
      };
    });

    const plan: TaskPlan = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      steps,
      status: 'pending_approval',
      currentStepIndex: 0,
      createdAt: Date.now(),
    };

    const cleanText = responseText.replace(match[0], '').trim();
    return { cleanText, plan };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useTaskPlan = () => {
  const [activePlan, setActivePlan] = useState<TaskPlan | null>(null);
  const pauseRef = useRef(false);
  const cancelRef = useRef(false);

  const setPlan = useCallback((plan: TaskPlan | null) => {
    setActivePlan(plan);
    pauseRef.current = false;
    cancelRef.current = false;
  }, []);

  const approvePlan = useCallback(() => {
    setActivePlan((prev) => (prev ? { ...prev, status: 'executing' } : null));
  }, []);

  const pausePlan = useCallback(() => {
    pauseRef.current = true;
    setActivePlan((prev) => (prev ? { ...prev, status: 'paused' } : null));
  }, []);

  const resumePlan = useCallback(() => {
    pauseRef.current = false;
    setActivePlan((prev) => (prev ? { ...prev, status: 'executing' } : null));
  }, []);

  const cancelPlan = useCallback(() => {
    cancelRef.current = true;
    setActivePlan((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        status: 'cancelled',
        steps: prev.steps.map((s) =>
          s.status === 'pending' || s.status === 'running' ? { ...s, status: 'skipped' } : s,
        ),
      };
    });
  }, []);

  /** Mark a step as running */
  const startStep = useCallback((stepIndex: number) => {
    setActivePlan((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        currentStepIndex: stepIndex,
        steps: prev.steps.map((s) => (s.index === stepIndex + 1 ? { ...s, status: 'running' } : s)),
      };
    });
  }, []);

  /** Mark a step as completed with an optional result summary */
  const completeStep = useCallback((stepIndex: number, result?: string) => {
    setActivePlan((prev) => {
      if (!prev) return null;
      const updatedSteps = prev.steps.map((s) =>
        s.index === stepIndex + 1 ? { ...s, status: 'completed' as const, result } : s,
      );
      const allDone = updatedSteps.every((s) => s.status === 'completed' || s.status === 'skipped');
      return {
        ...prev,
        steps: updatedSteps,
        status: allDone ? 'completed' : prev.status,
      };
    });
  }, []);

  /** Mark a step as failed */
  const failStep = useCallback((stepIndex: number, error: string) => {
    setActivePlan((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        status: 'failed',
        steps: prev.steps.map((s, i) => {
          if (s.index === stepIndex + 1) return { ...s, status: 'failed' as const, error };
          if (i > stepIndex) return { ...s, status: 'skipped' as const };
          return s;
        }),
      };
    });
  }, []);

  /** Edit the plan before execution (replace steps) */
  const editPlan = useCallback((updatedSteps: Array<{ description: string; prompt: string }>) => {
    setActivePlan((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        steps: updatedSteps.map((s, i) => ({
          index: i + 1,
          description: s.description,
          prompt: s.prompt,
          status: 'pending' as const,
        })),
      };
    });
  }, []);

  return {
    activePlan,
    isPaused: pauseRef,
    isCancelled: cancelRef,
    setPlan,
    approvePlan,
    pausePlan,
    resumePlan,
    cancelPlan,
    startStep,
    completeStep,
    failStep,
    editPlan,
  };
};
