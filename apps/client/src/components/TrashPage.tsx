import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { TauriAPI, type TrashItem } from '@/lib/tauri-api';
import { useToast } from '@/hooks/use-toast';
import { getFileIcon, formatFileSize, formatDate } from '@/lib/utils';
import { Trash2 } from 'lucide-react';
import { showConfirmationToast } from '@/components/ui/Toast';

interface RecycleBinProps {
  onClose?: () => void;
}

const RecycleBin = ({ onClose }: RecycleBinProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Query trash items
  const {
    data: trashItems = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['trash-items'],
    queryFn: () => TauriAPI.getTrashItems(),
    staleTime: 30000,
  });

  // Show toast notification for errors
  useEffect(() => {
    if (error) {
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastLoadErrorTitle'),
        description: t('pages.trash.toastLoadErrorDesc', { error: (error as Error).message }),
      });
    }
  }, [error, toast, t]);

  const handleSelectItem = (original_path: string, event?: React.MouseEvent) => {
    if (event && (event.ctrlKey || event.metaKey)) {
      // Ctrl+click for multi-select
      setSelectedItems((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(original_path)) {
          newSet.delete(original_path);
        } else {
          newSet.add(original_path);
        }
        return newSet;
      });
    } else {
      // Single select
      setSelectedItems(new Set([original_path]));
    }
  };

  const handleRestore = async (itemPath?: string) => {
    // For restoration, we need to use the actual trash item path, not the original path
    const trashItemsToRestore = itemPath
      ? [itemPath]
      : Array.from(selectedItems).map((original_path) => {
          const item = trashItems.find((t) => t.original_path === original_path);
          return item ? getTrashItemPath(item) : original_path;
        });

    if (trashItemsToRestore.length === 0) {
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastNoItemsTitle'),
        description: t('pages.trash.toastNoItemsRestoreDesc'),
      });
      return;
    }

    const confirmed = await showConfirmationToast({
      title: t('pages.trash.confirmRestoreTitle'),
      description: t('pages.trash.confirmRestoreDesc', { count: trashItemsToRestore.length }),
      confirmText: t('pages.trash.confirmRestoreBtn'),
      cancelText: t('common.cancel'),
    });

    if (!confirmed) return;

    try {
      const restoredPaths: string[] = [];
      for (const trashPath of trashItemsToRestore) {
        const restoredPath = await TauriAPI.restoreFromTrash(trashPath);
        restoredPaths.push(restoredPath);
      }

      setSelectedItems(new Set());
      refetch();

      toast({
        title: t('pages.trash.toastRestoredTitle'),
        description: t('pages.trash.toastRestoredDesc', { count: restoredPaths.length }),
      });
    } catch (error) {
      console.error('Failed to restore items:', error);
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastRestoreFailedTitle'),
        description: t('pages.trash.toastRestoreFailedDesc', {
          error: (error as Error).message,
        }),
      });
    }
  };

  // Helper function to get the actual trash item path (this might need adjustment based on the TrashItem structure)
  const getTrashItemPath = (item: TrashItem): string => {
    // If the item has a specific trash path, use it; otherwise use original path as fallback
    return 'trashPath' in item &&
      typeof (item as TrashItem & { trashPath?: string }).trashPath === 'string'
      ? (item as TrashItem & { trashPath: string }).trashPath
      : item.original_path;
  };

  const handlePermanentDelete = async (original_path?: string) => {
    // For permanent deletion, we need to use the actual trash item paths
    const trashItemsToDelete = original_path
      ? [original_path]
      : Array.from(selectedItems).map((original_path) => {
          const item = trashItems.find((t) => t.original_path === original_path);
          return item ? getTrashItemPath(item) : original_path;
        });

    if (trashItemsToDelete.length === 0) {
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastNoItemsTitle'),
        description: t('pages.trash.toastNoItemsDeleteDesc'),
      });
      return;
    }

    const confirmed = await showConfirmationToast({
      title: t('pages.trash.confirmDeleteTitle'),
      description: t('pages.trash.confirmDeleteDesc', { count: trashItemsToDelete.length }),
      confirmText: t('pages.trash.confirmDeleteBtn'),
      cancelText: t('common.cancel'),
    });

    if (!confirmed) return;

    try {
      for (const trashPath of trashItemsToDelete) {
        await TauriAPI.permanentlyDeleteFromTrash(trashPath);
      }

      setSelectedItems(new Set());
      refetch();

      toast({
        title: t('pages.trash.toastDeletedTitle'),
        description: t('pages.trash.toastDeletedDesc', { count: trashItemsToDelete.length }),
      });
    } catch (error) {
      console.error('Failed to permanently delete items:', error);
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastDeleteFailedTitle'),
        description: t('pages.trash.toastDeleteFailedDesc', {
          error: (error as Error).message,
        }),
      });
    }
  };

  const handleEmptyTrash = async () => {
    if (trashItems.length === 0) {
      toast({
        title: t('pages.trash.toastAlreadyEmptyTitle'),
        description: t('pages.trash.toastAlreadyEmptyDesc'),
      });
      return;
    }

    const confirmed = await showConfirmationToast({
      title: t('pages.trash.confirmEmptyTitle'),
      description: t('pages.trash.confirmEmptyDesc', { count: trashItems.length }),
      confirmText: t('pages.trash.confirmEmptyBtn'),
      cancelText: t('common.cancel'),
    });

    if (!confirmed) return;

    try {
      const deletedCount = await TauriAPI.emptyTrash();
      setSelectedItems(new Set());
      refetch();

      toast({
        title: t('pages.trash.toastEmptiedTitle'),
        description: t('pages.trash.toastEmptiedDesc', { count: deletedCount }),
      });
    } catch (error) {
      console.error('Failed to empty trash:', error);
      toast({
        variant: 'destructive',
        title: t('pages.trash.toastEmptyFailedTitle'),
        description: t('pages.trash.toastEmptyFailedDesc', { error: (error as Error).message }),
      });
    }
  };

  const handleSelectAll = () => {
    if (selectedItems.size === trashItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(trashItems.map((item) => item.original_path)));
    }
  };

  const isAllSelected = selectedItems.size === trashItems.length && trashItems.length > 0;

  return (
    <div className="bg-xp-bg text-xp-text flex h-full flex-col">
      {/* Header */}
      <div className="border-xp-border flex items-center justify-between border-b p-4">
        <h2 className="text-xp-text flex items-center gap-2 text-xl font-semibold">
          <Trash2 size={20} /> {t('pages.trash.title')}
        </h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleSelectAll}
            className="bg-xp-surface hover:bg-xp-surface-light border-xp-border rounded border px-3 py-1 text-sm"
            aria-label={
              isAllSelected ? t('pages.trash.ariaDeselectAll') : t('pages.trash.ariaSelectAll')
            }
          >
            {isAllSelected ? t('pages.trash.deselectAll') : t('pages.trash.selectAll')}
          </button>
          <button
            onClick={() => handleRestore()}
            disabled={selectedItems.size === 0}
            className="bg-xp-blue rounded px-3 py-1 text-sm text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('pages.trash.ariaRestoreCount', { count: selectedItems.size })}
          >
            {t('pages.trash.restoreCount', { count: selectedItems.size })}
          </button>
          <button
            onClick={() => handlePermanentDelete()}
            disabled={selectedItems.size === 0}
            className="bg-xp-red rounded px-3 py-1 text-sm text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('pages.trash.ariaDeleteCount', { count: selectedItems.size })}
          >
            {t('pages.trash.deletePermanentlyCount', { count: selectedItems.size })}
          </button>
          <button
            onClick={handleEmptyTrash}
            disabled={trashItems.length === 0}
            className="bg-xp-red rounded px-3 py-1 text-sm text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('pages.trash.ariaEmptyBin')}
          >
            {t('pages.trash.emptyRecycleBin')}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="bg-xp-surface hover:bg-xp-surface-light border-xp-border rounded border px-3 py-1 text-sm"
              aria-label={t('pages.trash.ariaBackToHome')}
            >
              {t('pages.trash.backToHome')}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {(() => {
          if (isLoading) {
            return (
              <div className="flex h-full items-center justify-center">
                <div className="text-xp-text-muted">{t('pages.trash.loading')}</div>
              </div>
            );
          }
          if (trashItems.length === 0) {
            return (
              <div className="flex h-full items-center justify-center">
                <div className="text-xp-text-muted text-center">
                  <div className="mb-4 text-4xl">
                    <Trash2 size="1em" className="text-xp-text-muted inline-block" />
                  </div>
                  <div className="text-lg">{t('pages.trash.empty')}</div>
                  <div className="mt-2 text-sm">{t('pages.trash.emptyHint')}</div>
                </div>
              </div>
            );
          }
          return (
            <div className="grid grid-cols-1 gap-2">
              {trashItems.map((item) => (
                <div
                  key={item.original_path}
                  onClick={(e) => handleSelectItem(item.original_path, e)}
                  className={`hover:bg-xp-surface flex cursor-pointer items-center rounded p-3 ${
                    selectedItems.has(item.original_path) ? 'bg-xp-accent bg-opacity-20' : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center">
                    <div className="mr-3 text-xl">
                      {getFileIcon({
                        name: item.name,
                        is_dir: item.is_dir,
                        path: item.original_path,
                        size: item.size,
                        modified: item.deletion_date,
                        file_type: item.name.split('.').pop() || '',
                        is_readonly: false,
                      })}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xp-text truncate font-medium">{item.name}</div>
                      <div className="text-xp-text-muted truncate text-sm">
                        {item.original_path}
                      </div>
                    </div>
                    <div className="text-xp-text-muted ml-4 text-sm">
                      {!item.is_dir && formatFileSize(item.size)}
                    </div>
                    <div className="text-xp-text-muted ml-4 text-sm">
                      {formatDate(item.deletion_date * 1000)}
                    </div>
                    <div className="ml-4 flex space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestore(item.original_path);
                        }}
                        className="bg-xp-blue rounded px-2 py-1 text-xs text-white hover:opacity-80"
                        aria-label={t('pages.trash.ariaRestoreItem', { name: item.name })}
                      >
                        {t('pages.trash.restore')}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePermanentDelete(item.original_path);
                        }}
                        className="bg-xp-red rounded px-2 py-1 text-xs text-white hover:opacity-80"
                        aria-label={t('pages.trash.ariaDeleteItem', { name: item.name })}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Footer */}
      <div className="border-xp-border text-xp-text-muted border-t p-4 text-sm">
        {t('pages.trash.footer', {
          count: trashItems.length,
          defaultValue: `${trashItems.length} item${trashItems.length !== 1 ? 's' : ''} in recycle bin`,
        })}
        {selectedItems.size > 0 && t('pages.trash.footerSelected', { count: selectedItems.size })}
      </div>
    </div>
  );
};

export default RecycleBin;
