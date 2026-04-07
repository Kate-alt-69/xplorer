/**
 * Task Queue section — shows pending tasks waiting to be executed.
 * Supports drag-to-reorder, start, and remove controls.
 */
import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, Play, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueuedTask {
  id: string;
  description: string;
  /** The prompt to send to the AI chat when started */
  prompt: string;
  addedAt: number;
}

interface TaskQueueProps {
  tasks: QueuedTask[];
  onStart: (task: QueuedTask) => void;
  onRemove: (id: string) => void;
  onReorder: (tasks: QueuedTask[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TaskQueue = ({ tasks, onStart, onRemove, onReorder }: TaskQueueProps) => {
  const { t } = useTranslation();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index);
    dragNodeRef.current = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // Slight delay to allow drag image to render
    requestAnimationFrame(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = '0.4';
      }
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === dropIndex) return;

      const reordered = [...tasks];
      const [removed] = reordered.splice(dragIndex, 1);
      reordered.splice(dropIndex, 0, removed);
      onReorder(reordered);
    },
    [dragIndex, tasks, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = '1';
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragNodeRef.current = null;
  }, []);

  if (tasks.length === 0) {
    return (
      <div
        style={{
          padding: '12px',
          color: 'var(--xp-text-muted)',
          fontSize: '11px',
          textAlign: 'center',
        }}
      >
        {t('agentManager.taskQueue.empty')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {tasks.map((task, index) => (
        <div
          key={task.id}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, index)}
          onDragEnd={handleDragEnd}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 8px',
            borderRadius: '4px',
            border: '1px solid var(--xp-border)',
            background:
              dragOverIndex === index && dragIndex !== index
                ? 'var(--xp-surface-light)'
                : 'var(--xp-surface)',
            cursor: 'grab',
            transition: 'background 0.15s ease',
          }}
        >
          <GripVertical
            size={12}
            style={{ color: 'var(--xp-text-muted)', flexShrink: 0, cursor: 'grab' }}
          />

          {/* Queue position */}
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'var(--xp-blue, #7aa2f7)',
              color: '#fff',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontWeight: 600,
            }}
          >
            {index + 1}
          </span>

          <span
            style={{
              flex: 1,
              fontSize: '11px',
              color: 'var(--xp-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {task.description}
          </span>

          <button
            onClick={() => onStart(task)}
            title={t('agentManager.taskQueue.start')}
            aria-label={`${t('agentManager.taskQueue.start')}: ${task.description}`}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 4px',
              cursor: 'pointer',
              color: 'var(--xp-green, #73daca)',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Play size={10} />
          </button>

          <button
            onClick={() => onRemove(task.id)}
            title={t('agentManager.taskQueue.remove')}
            aria-label={`${t('agentManager.taskQueue.remove')}: ${task.description}`}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 4px',
              cursor: 'pointer',
              color: 'var(--xp-text-muted)',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default TaskQueue;
