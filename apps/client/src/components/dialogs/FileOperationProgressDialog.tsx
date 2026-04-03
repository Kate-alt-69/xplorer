import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileOperationProgress } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import { X, Square } from 'lucide-react';

const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond <= 0) return '—';
  return `${formatFileSize(bytesPerSecond)}/s`;
};

const formatETA = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const getStatusLabel = (op: FileOperationProgress, t: (key: string) => string): string => {
  switch (op.status) {
    case 'Completed':
      return t('dialogs.fileOp.statusDone');
    case 'Cancelled':
      return t('dialogs.fileOp.statusCancelled');
    case 'Failed':
      return op.error_message || t('dialogs.fileOp.statusFailed');
    default:
      return `${Math.round(op.progress_percentage || 0)}%`;
  }
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'Completed':
      return 'bg-green-500';
    case 'Failed':
      return 'bg-red-500';
    case 'Cancelled':
      return 'bg-yellow-500';
    default:
      return 'bg-xp-blue';
  }
};

const FileOperationProgressDialog = () => {
  const { t } = useTranslation();
  const [operations, setOperations] = useState<Map<string, FileOperationProgress>>(new Map());
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up all pending dismiss timers on unmount
  useEffect(() => {
    const timers = dismissTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const handleProgress = useCallback((progress: FileOperationProgress) => {
    setOperations((prev) => {
      const next = new Map(prev);
      next.set(progress.operation_id, progress);
      return next;
    });

    // Auto-dismiss completed/failed/cancelled after 4s
    if (
      progress.status === 'Completed' ||
      progress.status === 'Failed' ||
      progress.status === 'Cancelled'
    ) {
      // Clear any existing timer for this operation
      const existingTimer = dismissTimers.current.get(progress.operation_id);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        dismissTimers.current.delete(progress.operation_id);
        setOperations((prev) => {
          const next = new Map(prev);
          next.delete(progress.operation_id);
          return next;
        });
      }, 4000);
      dismissTimers.current.set(progress.operation_id, timer);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    TauriAPI.listenToFileOperationProgress(handleProgress).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [handleProgress]);

  const dismiss = (id: string) => {
    setOperations((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const cancelOperation = useCallback(async (id: string) => {
    await TauriAPI.cancelFileOperation(id);
  }, []);

  if (operations.size === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {Array.from(operations.values()).map((op) => {
        const fileName =
          op.current_file?.split(/[/\\]/).pop() ||
          op.source_path?.split(/[/\\]/).pop() ||
          t('dialogs.fileOp.unknownFile');
        const isActive = op.status === 'Starting' || op.status === 'InProgress';
        const isDone = op.status === 'Completed';

        return (
          <div
            key={op.operation_id}
            className="bg-xp-surface border-xp-border rounded-lg border p-3 shadow-xl backdrop-blur-sm"
          >
            {/* Header */}
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${getStatusColor(op.status)} ${isActive ? 'animate-pulse' : ''}`}
                />
                <span className="text-xp-text truncate text-xs font-medium capitalize">
                  {op.operation_type || t('dialogs.fileOp.fileOperation')}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {isActive && (
                  <button
                    onClick={() => cancelOperation(op.operation_id)}
                    className="text-xp-text-muted p-0.5 transition-colors hover:text-red-400"
                    title={t('dialogs.fileOp.cancelOperation')}
                  >
                    <Square size={10} />
                  </button>
                )}
                <button
                  onClick={() => dismiss(op.operation_id)}
                  className="text-xp-text-muted hover:text-xp-text p-0.5 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Current file */}
            <div className="text-xp-text-muted mb-1.5 truncate text-[11px]" title={op.current_file}>
              {fileName}
            </div>

            {/* Progress bar */}
            <div className="bg-xp-bg mb-1.5 h-1.5 w-full overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full transition-all duration-300 ${getStatusColor(op.status)}`}
                style={{ width: `${Math.min(100, op.progress_percentage || 0)}%` }}
              />
            </div>

            {/* Stats */}
            <div className="text-xp-text-muted flex items-center justify-between text-[10px]">
              <span>
                {getStatusLabel(op, t)}
                {isActive &&
                  op.total_files > 1 &&
                  ` (${op.files_processed}/${op.total_files} ${t('dialogs.fileOp.files')})`}
              </span>
              {isActive && (
                <span>
                  {formatSpeed(op.speed_bytes_per_second)}
                  {op.estimated_remaining_seconds
                    ? ` \u00B7 ${formatETA(op.estimated_remaining_seconds)}`
                    : ''}
                </span>
              )}
              {isDone && op.total_bytes > 0 && <span>{formatFileSize(op.total_bytes)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FileOperationProgressDialog;
