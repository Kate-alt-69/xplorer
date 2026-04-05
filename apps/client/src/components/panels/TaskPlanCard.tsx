/**
 * TaskPlanCard -- renders a multi-step task plan with progress tracking
 * and pause / resume / cancel controls.
 */
import { useState, useCallback } from 'react';
import type { TaskPlan, TaskStep, TaskStepStatus } from './use-task-plan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stepStatusIcon = (status: TaskStepStatus): string => {
  switch (status) {
    case 'completed':
      return '\u2705';
    case 'running':
      return '\uD83D\uDD04';
    case 'failed':
      return '\u274C';
    case 'skipped':
      return '\u23ED\uFE0F';
    default:
      return '\u2B1C';
  }
};

const progressPercent = (steps: TaskStep[]): number => {
  const done = steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  return Math.round((done / steps.length) * 100);
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ProgressBar = ({ percent }: { percent: number }) => (
  <div
    style={{
      width: '100%',
      height: '6px',
      borderRadius: '3px',
      background: 'var(--xp-border)',
      overflow: 'hidden',
    }}
    role="progressbar"
    aria-valuenow={percent}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={`Task progress: ${percent}%`}
  >
    <div
      style={{
        width: `${percent}%`,
        height: '100%',
        borderRadius: '3px',
        background: percent === 100 ? 'var(--xp-green)' : 'var(--xp-blue)',
        transition: 'width 0.3s ease',
      }}
    />
  </div>
);

const StepRow = ({ step }: { step: TaskStep }) => {
  const isMuted = step.status === 'skipped';
  const isFailed = step.status === 'failed';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '4px 0',
        fontSize: '12px',
        opacity: isMuted ? 0.5 : 1,
      }}
    >
      <span style={{ flexShrink: 0, fontSize: '13px', lineHeight: '1.3' }}>
        {stepStatusIcon(step.status)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            textDecoration: isMuted ? 'line-through' : undefined,
            color: isFailed ? 'var(--xp-red)' : 'var(--xp-text)',
          }}
        >
          {step.description}
        </span>
        {step.error && (
          <div style={{ color: 'var(--xp-red)', fontSize: '11px', marginTop: '2px' }}>
            {step.error}
          </div>
        )}
        {step.result && step.status === 'completed' && (
          <div style={{ color: 'var(--xp-text-muted)', fontSize: '11px', marginTop: '2px' }}>
            {step.result.length > 120 ? `${step.result.slice(0, 117)}...` : step.result}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

interface EditableStepsProps {
  steps: TaskStep[];
  onSave: (updated: Array<{ description: string; prompt: string }>) => void;
  onCancel: () => void;
}

const EditableSteps = ({ steps, onSave, onCancel }: EditableStepsProps) => {
  const [editSteps, setEditSteps] = useState(
    steps.map((s) => ({ description: s.description, prompt: s.prompt })),
  );

  const handleDescChange = useCallback((i: number, val: string) => {
    setEditSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, description: val } : s)));
  }, []);

  const handleRemove = useCallback((i: number) => {
    setEditSteps((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const handleAdd = useCallback(() => {
    setEditSteps((prev) => [...prev, { description: '', prompt: '' }]);
  }, []);

  return (
    <div style={{ padding: '8px 0' }}>
      {editSteps.map((step, i) => (
        <div
          key={`edit-${i}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '6px',
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)', flexShrink: 0 }}>
            {i + 1}.
          </span>
          <input
            type="text"
            value={step.description}
            onChange={(e) => handleDescChange(i, e.target.value)}
            style={{
              flex: 1,
              fontSize: '12px',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid var(--xp-border)',
              background: 'var(--xp-bg)',
              color: 'var(--xp-text)',
              outline: 'none',
            }}
            aria-label={`Step ${i + 1} description`}
          />
          <button
            onClick={() => handleRemove(i)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--xp-red)',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0 2px',
              flexShrink: 0,
            }}
            title="Remove step"
            aria-label={`Remove step ${i + 1}`}
          >
            {'\u00D7'}
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button
          onClick={handleAdd}
          style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background: 'var(--xp-surface)',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
          }}
        >
          + Add step
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={onCancel}
          style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background: 'var(--xp-surface)',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(editSteps.filter((s) => s.description.trim()))}
          style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--xp-blue)',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TaskPlanCardProps {
  plan: TaskPlan;
  onApprove: () => void;
  onEdit: (updated: Array<{ description: string; prompt: string }>) => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
}

const TaskPlanCard = ({
  plan,
  onApprove,
  onEdit,
  onCancel,
  onPause,
  onResume,
}: TaskPlanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);

  const percent = progressPercent(plan.steps);
  const completedCount = plan.steps.filter((s) => s.status === 'completed').length;
  const isWaiting = plan.status === 'pending_approval';
  const isRunning = plan.status === 'executing';
  const isPaused = plan.status === 'paused';
  const isDone = plan.status === 'completed';
  const isFailed = plan.status === 'failed';
  const isCancelled = plan.status === 'cancelled';

  const statusLabel = (() => {
    if (isDone) return 'Completed';
    if (isFailed) return 'Failed';
    if (isCancelled) return 'Cancelled';
    if (isPaused) return 'Paused';
    if (isRunning) return `Step ${plan.currentStepIndex + 1}/${plan.steps.length}`;
    return 'Pending';
  })();

  const statusColor = (() => {
    if (isDone) return 'var(--xp-green)';
    if (isFailed) return 'var(--xp-red)';
    if (isCancelled) return 'var(--xp-text-muted)';
    if (isPaused) return 'var(--xp-yellow)';
    if (isRunning) return 'var(--xp-blue)';
    return 'var(--xp-purple)';
  })();

  const handleEditSave = useCallback(
    (updated: Array<{ description: string; prompt: string }>) => {
      onEdit(updated);
      setIsEditing(false);
    },
    [onEdit],
  );

  return (
    <div
      style={{
        borderRadius: '8px',
        border: '1px solid var(--xp-border)',
        background: 'var(--xp-surface)',
        overflow: 'hidden',
        marginBottom: '8px',
      }}
      role="region"
      aria-label={`Task plan: ${plan.title}`}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderBottom: '1px solid var(--xp-border)',
        }}
      >
        <span style={{ fontSize: '14px' }}>{'\uD83D\uDCCB'}</span>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--xp-text)' }}>
          {plan.title}
        </span>
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '10px',
            background: statusColor,
            color: 'white',
            fontWeight: 500,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Progress bar -- only visible during/after execution */}
      {!isWaiting && (
        <div style={{ padding: '8px 12px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)' }}>
              {completedCount}/{plan.steps.length} steps
            </span>
            <span style={{ fontSize: '11px', color: 'var(--xp-text-muted)' }}>{percent}%</span>
          </div>
          <ProgressBar percent={percent} />
        </div>
      )}

      {/* Steps list */}
      <div style={{ padding: '8px 12px' }}>
        {isEditing ? (
          <EditableSteps
            steps={plan.steps}
            onSave={handleEditSave}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          plan.steps.map((step) => <StepRow key={step.index} step={step} />)
        )}
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          padding: '8px 12px',
          borderTop: '1px solid var(--xp-border)',
        }}
      >
        {isWaiting && !isEditing && (
          <>
            <button
              onClick={onApprove}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--xp-green)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              aria-label="Execute plan"
            >
              Execute Plan
            </button>
            <button
              onClick={() => setIsEditing(true)}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-surface)',
                color: 'var(--xp-text)',
                cursor: 'pointer',
              }}
              aria-label="Edit plan"
            >
              Edit Plan
            </button>
            <button
              onClick={onCancel}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-surface)',
                color: 'var(--xp-text-muted)',
                cursor: 'pointer',
              }}
              aria-label="Cancel plan"
            >
              Cancel
            </button>
          </>
        )}

        {isRunning && (
          <>
            <button
              onClick={onPause}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-yellow)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              aria-label="Pause plan execution"
            >
              Pause
            </button>
            <button
              onClick={onCancel}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-surface)',
                color: 'var(--xp-red)',
                cursor: 'pointer',
              }}
              aria-label="Cancel remaining steps"
            >
              Cancel
            </button>
          </>
        )}

        {isPaused && (
          <>
            <button
              onClick={onResume}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--xp-blue)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 500,
              }}
              aria-label="Resume plan execution"
            >
              Resume
            </button>
            <button
              onClick={onCancel}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-surface)',
                color: 'var(--xp-red)',
                cursor: 'pointer',
              }}
              aria-label="Cancel remaining steps"
            >
              Cancel
            </button>
          </>
        )}

        {(isDone || isFailed || isCancelled) && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--xp-text-muted)',
              padding: '5px 0',
            }}
          >
            {isDone && `All ${plan.steps.length} steps completed`}
            {isFailed && `Failed at step ${plan.currentStepIndex + 1}`}
            {isCancelled && `Cancelled (${completedCount}/${plan.steps.length} completed)`}
          </span>
        )}
      </div>
    </div>
  );
};

export default TaskPlanCard;
