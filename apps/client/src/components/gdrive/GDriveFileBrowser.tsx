import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type FileEntry } from '@/lib/tauri-api';
import { gdriveManager } from '@/lib/gdrive-plugin';
import {
  Cloud,
  RefreshCw,
  ChevronUp,
  Download,
  Upload,
  FolderPlus,
  FolderOpen,
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
// @tauri-apps/plugin-dialog save/open removed — not used directly here
import { formatFileSize, formatDate, getFileIcon, sortFiles, type SortField } from '@/lib/utils';
import { GDriveDownloadDialog } from '@/components/gdrive/GDriveDownloadDialog';
import { GDriveUploadDialog } from '@/components/gdrive/GDriveUploadDialog';

interface BreadcrumbEntry {
  id: string;
  name: string;
}

interface GDriveFileBrowserProps {
  accountId: string;
  initialFolderId?: string;
  onNavigate?: (path: string) => void;
  onFileSelect?: (file: FileEntry) => void;
}

const GDriveFileBrowser = ({
  accountId,
  initialFolderId,
  onNavigate,
  onFileSelect,
}: GDriveFileBrowserProps) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string>(initialFolderId || 'root');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([
    { id: 'root', name: t('settings.gdrive.myDrive') },
  ]);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileEntry } | null>(
    null,
  );
  const [accountEmail, setAccountEmail] = useState<string>('');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSortDropdownOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setIsSortDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isSortDropdownOpen]);

  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{ fileId: string; fileName: string } | null>(
    null,
  );

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const loadFiles = useCallback(
    async (folderId: string) => {
      setError(null);
      setSelectedFile(null);
      setCurrentFolderId(folderId);
      onNavigate?.(folderId);

      // Show cached data instantly if available
      const cached = gdriveManager.getCachedFiles(accountId, folderId);
      if (cached) {
        setFiles(cached);
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await gdriveManager.listFiles(accountId, folderId);
        setFiles(result);
      } catch (err) {
        // Only show error if we had no cached data
        if (!cached) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setError(errorMessage);
          toast({
            title: t('settings.gdrive.toastLoadErrorTitle'),
            description: t('settings.gdrive.toastLoadErrorDesc', { error: errorMessage }),
            variant: 'destructive',
          });
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accountId, onNavigate, toast],
  );

  // Load account info and files on mount
  useEffect(() => {
    const loadAccount = async () => {
      try {
        const accounts = await gdriveManager.getAccounts();
        const account = accounts.find((a) => a.id === accountId);
        if (account) {
          setAccountEmail(account.email);
        }
      } catch {
        // Silently ignore — email is just for display
      }
    };

    loadAccount();
    loadFiles(initialFolderId || 'root');
    // Only reload when the account changes, not when loadFiles reference changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const sortedFiles = useMemo(
    () => sortFiles([...files], sortBy, sortOrder),
    [files, sortBy, sortOrder],
  );

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRefresh = () => {
    loadFiles(currentFolderId);
  };

  const navigateUp = () => {
    if (breadcrumbs.length <= 1) return;
    const newBreadcrumbs = breadcrumbs.slice(0, -1);
    setBreadcrumbs(newBreadcrumbs);
    const parentFolder = newBreadcrumbs[newBreadcrumbs.length - 1];
    loadFiles(parentFolder.id);
  };

  const navigateToBreadcrumb = (index: number) => {
    if (index === breadcrumbs.length - 1) return; // Already there
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    loadFiles(newBreadcrumbs[index].id);
  };

  const handleFileClick = (file: FileEntry) => {
    if (selectedFile?.path === file.path) {
      setSelectedFile(null);
    } else {
      setSelectedFile(file);
    }
    onFileSelect?.(file);
  };

  const handleFileDoubleClick = (file: FileEntry) => {
    if (file.is_dir) {
      setBreadcrumbs((prev) => [...prev, { id: file.path, name: file.name }]);
      loadFiles(file.path);
    } else {
      onFileSelect?.(file);
    }
  };

  const handleSortChange = (newSortBy: SortField) => {
    if (newSortBy === sortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('asc');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
    setSelectedFile(file);
  };

  const handleNewFolder = async () => {
    const folderName = prompt(t('settings.gdrive.promptFolderName'));
    if (!folderName?.trim()) return;

    try {
      await gdriveManager.createFolder(accountId, folderName.trim(), currentFolderId);
      toast({
        title: t('settings.gdrive.toastFolderCreatedTitle'),
        description: t('settings.gdrive.toastFolderCreatedDesc', { name: folderName.trim() }),
      });
      loadFiles(currentFolderId);
    } catch (err) {
      toast({
        title: t('settings.gdrive.toastErrorTitle'),
        description: t('settings.gdrive.toastCreateFolderErrorDesc', {
          error: (err as Error).message,
        }),
        variant: 'destructive',
      });
    }
  };

  const handleUpload = () => {
    setShowUploadDialog(true);
  };

  const handleDownload = () => {
    if (!selectedFile || selectedFile.is_dir) return;
    setDownloadTarget({ fileId: selectedFile.path, fileName: selectedFile.name });
    setShowDownloadDialog(true);
  };

  const handleDelete = async (file?: FileEntry) => {
    const targetFile = file || selectedFile;
    if (!targetFile) return;

    const confirmed = confirm(t('settings.gdrive.confirmDelete', { name: targetFile.name }));
    if (!confirmed) return;

    try {
      await gdriveManager.deleteFile(accountId, targetFile.path);
      toast({
        title: t('settings.gdrive.toastDeletedTitle'),
        description: t('settings.gdrive.toastDeletedDesc', { name: targetFile.name }),
      });
      setSelectedFile(null);
      loadFiles(currentFolderId);
    } catch (err) {
      toast({
        title: t('settings.gdrive.toastErrorTitle'),
        description: t('settings.gdrive.toastDeleteErrorDesc', { error: (err as Error).message }),
        variant: 'destructive',
      });
    }
  };

  const handleRename = async (file?: FileEntry) => {
    const targetFile = file || selectedFile;
    if (!targetFile) return;

    const newName = prompt(t('settings.gdrive.promptNewName'), targetFile.name);
    if (!newName?.trim() || newName.trim() === targetFile.name) return;

    try {
      await gdriveManager.renameFile(accountId, targetFile.path, newName.trim());
      toast({
        title: t('settings.gdrive.toastRenamedTitle'),
        description: t('settings.gdrive.toastRenamedDesc', { name: newName.trim() }),
      });
      loadFiles(currentFolderId);
    } catch (err) {
      toast({
        title: t('settings.gdrive.toastErrorTitle'),
        description: t('settings.gdrive.toastRenameErrorDesc', { error: (err as Error).message }),
        variant: 'destructive',
      });
    }
  };

  const handleContextMenuAction = (action: string) => {
    if (!contextMenu) return;
    const file = contextMenu.file;
    setContextMenu(null);

    switch (action) {
      case 'open':
        if (file.is_dir) {
          handleFileDoubleClick(file);
        }
        break;
      case 'download':
        if (!file.is_dir) {
          setDownloadTarget({ fileId: file.path, fileName: file.name });
          setShowDownloadDialog(true);
        }
        break;
      case 'rename':
        handleRename(file);
        break;
      case 'delete':
        handleDelete(file);
        break;
    }
  };

  const sortLabels: Record<SortField, string> = {
    name: t('settings.gdrive.sortName'),
    size: t('settings.gdrive.sortSize'),
    dateModified: t('settings.gdrive.sortModified'),
    dateCreated: t('settings.gdrive.sortCreated'),
    type: t('settings.gdrive.sortType'),
    extension: t('settings.gdrive.sortExtension'),
  };

  return (
    <div className="bg-xp-bg flex h-full flex-1 flex-col">
      {/* Operation Bar — matches normal file explorer style */}
      <div className="bg-xp-surface border-xp-border border-b p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {/* Sort Dropdown */}
            <div className="relative" ref={sortDropdownRef}>
              <button
                onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                className="bg-xp-bg border-xp-border hover:bg-xp-surface-light flex items-center space-x-2 rounded border px-3 py-2"
              >
                <span className="text-sm">
                  {sortLabels[sortBy] || t('settings.gdrive.sortName')}
                </span>
                {sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {isSortDropdownOpen && (
                <div className="bg-xp-popover border-xp-border absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded border shadow-xl backdrop-blur-xl">
                  {(['name', 'size', 'dateModified'] as const).map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        handleSortChange(key);
                        setIsSortDropdownOpen(false);
                      }}
                      className={`hover:bg-xp-surface-light flex w-full items-center justify-between px-4 py-2 text-left ${
                        sortBy === key ? 'bg-xp-blue text-xp-blue bg-opacity-20' : ''
                      }`}
                    >
                      <span className="text-sm">{sortLabels[key]}</span>
                      {sortBy === key &&
                        (sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Breadcrumb */}
            <div className="text-xp-text ml-2 flex items-center space-x-1 overflow-x-auto text-sm">
              <Cloud className="text-xp-blue h-4 w-4 flex-shrink-0" />
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.id}>
                  {index > 0 && <span className="text-xp-text-muted">/</span>}
                  <button
                    onClick={() => navigateToBreadcrumb(index)}
                    className={`hover:bg-xp-surface-light whitespace-nowrap rounded px-1.5 py-0.5 ${
                      index === breadcrumbs.length - 1
                        ? 'text-xp-blue font-medium'
                        : 'text-xp-text-muted hover:text-xp-text'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
              {accountEmail && (
                <span className="text-xp-text-muted ml-2 text-xs">({accountEmail})</span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-1">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="hover:bg-xp-surface-light rounded p-2"
              title={t('common.refresh')}
            >
              <RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={navigateUp}
              disabled={breadcrumbs.length <= 1}
              className="hover:bg-xp-surface-light rounded p-2 disabled:opacity-50"
              title={t('settings.gdrive.goUp')}
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <div className="bg-xp-border mx-0.5 h-5 w-px" />
            <button
              onClick={handleNewFolder}
              className="hover:bg-xp-surface-light rounded p-2"
              title={t('settings.gdrive.newFolder')}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
            <button
              onClick={handleUpload}
              className="hover:bg-xp-surface-light rounded p-2"
              title={t('settings.gdrive.upload')}
            >
              <Upload className="h-4 w-4" />
            </button>
            <button
              onClick={handleDownload}
              disabled={!selectedFile || selectedFile.is_dir}
              className="hover:bg-xp-surface-light rounded p-2 disabled:opacity-50"
              title={t('settings.gdrive.download')}
            >
              <Download className="h-4 w-4" />
            </button>
            <div className="bg-xp-border mx-0.5 h-5 w-px" />
            <button
              onClick={() => handleRename()}
              disabled={!selectedFile}
              className="hover:bg-xp-surface-light rounded p-2 disabled:opacity-50"
              title={t('common.rename')}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleDelete()}
              disabled={!selectedFile}
              className="hover:bg-xp-surface-light hover:text-xp-red rounded p-2 disabled:opacity-50"
              title={t('common.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto" onClick={() => setContextMenu(null)}>
        {error ? (
          <div className="p-8 text-center">
            <div className="text-xp-red mb-4 text-6xl">
              <Cloud className="mx-auto h-16 w-16 opacity-50" />
            </div>
            <h3 className="text-xp-text mb-2 text-lg font-medium">
              {t('settings.gdrive.connectionError')}
            </h3>
            <p className="text-xp-text-muted mb-4">{error}</p>
            <button
              onClick={handleRefresh}
              className="bg-xp-blue hover:bg-xp-blue-dark focus:ring-xp-blue rounded px-4 py-2 text-white transition-colors focus:outline-none focus:ring-1"
              aria-label={t('settings.gdrive.ariaRetryLoading')}
            >
              {t('settings.gdrive.tryAgain')}
            </button>
          </div>
        ) : null}
        {!error && loading && (
          <div className="p-8 text-center">
            <RefreshCw className="text-xp-blue mx-auto mb-4 h-8 w-8 animate-spin" />
            <p className="text-xp-text-muted">{t('settings.gdrive.loadingFiles')}</p>
          </div>
        )}
        {!error && !loading && sortedFiles.length === 0 ? (
          <div className="text-xp-text-muted p-8 text-center">
            <Cloud className="mx-auto mb-4 h-16 w-16 opacity-30" />
            <p className="text-lg">{t('settings.gdrive.emptyFolderTitle')}</p>
            <p className="mt-2 text-sm">{t('settings.gdrive.emptyFolderDesc')}</p>
          </div>
        ) : (
          <div className="p-2">
            {sortedFiles.map((file) => (
              <div
                key={file.path}
                tabIndex={0}
                className={`hover:bg-xp-surface-light focus:ring-xp-blue flex cursor-pointer items-center rounded-md p-3 transition-colors focus:outline-none focus:ring-1 ${
                  selectedFile?.path === file.path
                    ? 'bg-xp-blue border-xp-blue border bg-opacity-20'
                    : 'border border-transparent'
                }`}
                onClick={() => handleFileClick(file)}
                onDoubleClick={() => handleFileDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                <div className="flex min-w-0 flex-1 items-center">
                  <div className="mr-3 flex-shrink-0 text-2xl">{getFileIcon(file)}</div>

                  <div className="min-w-0 flex-1">
                    <div className="text-xp-text truncate font-medium">{file.name}</div>
                    {file.is_dir && (
                      <div className="text-xp-text-muted text-xs">{t('common.folder')}</div>
                    )}
                  </div>
                </div>

                <div className="text-xp-text-muted flex items-center space-x-6 text-sm">
                  <div className="w-20 text-right">
                    {file.is_dir ? '\u2014' : formatFileSize(file.size)}
                  </div>

                  <div className="w-32 text-right">{formatDate(file.modified)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="bg-xp-surface border-xp-border fixed z-50 min-w-[160px] rounded-lg border py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.file.is_dir && (
            <button
              onClick={() => handleContextMenuAction('open')}
              className="text-xp-text hover:bg-xp-surface-light focus:ring-xp-blue flex w-full items-center space-x-2 px-4 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-1"
              aria-label={t('settings.gdrive.ariaOpenFolder')}
            >
              <FolderOpen className="h-4 w-4" />
              <span>{t('common.open')}</span>
            </button>
          )}
          {!contextMenu.file.is_dir && (
            <button
              onClick={() => handleContextMenuAction('download')}
              className="text-xp-text hover:bg-xp-surface-light focus:ring-xp-blue flex w-full items-center space-x-2 px-4 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-1"
              aria-label={t('settings.gdrive.ariaDownloadFile')}
            >
              <Download className="h-4 w-4" />
              <span>{t('settings.gdrive.download')}</span>
            </button>
          )}
          <button
            onClick={() => handleContextMenuAction('rename')}
            className="text-xp-text hover:bg-xp-surface-light focus:ring-xp-blue flex w-full items-center space-x-2 px-4 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-1"
            aria-label={t('settings.gdrive.ariaRenameFile')}
          >
            <Pencil className="h-4 w-4" />
            <span>{t('common.rename')}</span>
          </button>
          <div className="border-xp-border my-1 border-t" />
          <button
            onClick={() => handleContextMenuAction('delete')}
            className="text-xp-red hover:bg-xp-surface-light focus:ring-xp-blue flex w-full items-center space-x-2 px-4 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-1"
            aria-label={t('settings.gdrive.ariaDeleteFile')}
          >
            <Trash2 className="h-4 w-4" />
            <span>{t('common.delete')}</span>
          </button>
        </div>
      )}

      {/* Download Dialog */}
      {downloadTarget && (
        <GDriveDownloadDialog
          isOpen={showDownloadDialog}
          onClose={() => {
            setShowDownloadDialog(false);
            setDownloadTarget(null);
          }}
          accountId={accountId}
          fileId={downloadTarget.fileId}
          fileName={downloadTarget.fileName}
        />
      )}

      {/* Upload Dialog */}
      <GDriveUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        accountId={accountId}
        parentFolderId={currentFolderId}
        onUploadComplete={() => loadFiles(currentFolderId)}
      />
    </div>
  );
};

export default GDriveFileBrowser;
