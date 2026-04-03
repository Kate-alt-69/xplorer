import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { TauriAPI, type ExtractionOptions, type ArchiveInfo } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import {
  AlertTriangle,
  FolderOpen,
  Archive,
  FolderClosed,
  File as FileIcon,
  Lock,
  CheckSquare,
  Square,
} from 'lucide-react';

interface ExtractDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  archivePath: string;
}

const ExtractDialog = ({ isOpen, onClose, onComplete, archivePath }: ExtractDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [archiveInfo, setArchiveInfo] = useState<ArchiveInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [outputDirectory, setOutputDirectory] = useState('');
  const [password, setPassword] = useState('');
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [preservePermissions, setPreservePermissions] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(true);

  // Selection state for partial extraction
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());

  const allEntryPaths = useMemo(() => {
    if (!archiveInfo) return [];
    return archiveInfo.files.map((f) => f.path);
  }, [archiveInfo]);

  const allSelected = allEntryPaths.length > 0 && selectedEntries.size === allEntryPaths.length;
  const selectionCount = selectedEntries.size;

  const toggleEntry = useCallback((path: string) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedEntries(new Set(allEntryPaths));
  }, [allEntryPaths]);

  const deselectAll = useCallback(() => {
    setSelectedEntries(new Set());
  }, []);

  useEffect(() => {
    if (isOpen && archivePath) {
      loadArchiveInfo();
      generateDefaultOutputDirectory();
      setSelectedEntries(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, archivePath]);

  const loadArchiveInfo = async () => {
    setLoading(true);
    setError(null);

    try {
      const info = await TauriAPI.getArchiveInfo(archivePath);
      setArchiveInfo(info);
    } catch (err) {
      setError((err as Error).message);
      toast({
        title: t('dialogs.extract.errorLoadingTitle'),
        description: t('dialogs.extract.errorLoadingDesc', { error: (err as Error).message }),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const generateDefaultOutputDirectory = () => {
    if (!archivePath) return;

    // Default to the same directory as the archive, with the archive name as folder
    const archiveDir = archivePath.split(/[/\\]/).slice(0, -1).join('/');
    const archiveName =
      archivePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(zip|tar|tar\.gz|tar\.bz2|tar\.xz|7z|rar)$/i, '') || 'extracted';
    setOutputDirectory(`${archiveDir}/${archiveName}`);
  };

  const handleExtract = async () => {
    if (!outputDirectory.trim()) {
      toast({
        title: t('dialogs.extract.outputDirRequiredTitle'),
        description: t('dialogs.extract.outputDirRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }

    if (archiveInfo?.is_encrypted && !password.trim()) {
      toast({
        title: t('dialogs.extract.passwordRequiredTitle'),
        description: t('dialogs.extract.passwordRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }

    setExtracting(true);

    try {
      const options: ExtractionOptions = {
        output_directory: outputDirectory,
        password: password.trim() || undefined,
        overwrite_existing: overwriteExisting,
        preserve_permissions: preservePermissions,
        include_hidden: includeHidden,
      };

      const resultPath = await TauriAPI.extractArchive(archivePath, options);

      toast({
        title: t('dialogs.extract.successTitle'),
        description: t('dialogs.extract.successDesc', {
          name: resultPath.split(/[/\\]/).pop(),
        }),
      });

      onComplete?.();
      onClose();
    } catch (err) {
      toast({
        title: t('dialogs.extract.failedTitle'),
        description: t('dialogs.extract.failedDesc', { error: (err as Error).message }),
        variant: 'destructive',
      });
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractSelected = async () => {
    if (!outputDirectory.trim()) {
      toast({
        title: t('dialogs.extract.outputDirRequiredTitle'),
        description: t('dialogs.extract.outputDirRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }

    if (selectedEntries.size === 0) {
      toast({
        title: t('dialogs.extract.noFilesSelectedTitle'),
        description: t('dialogs.extract.noFilesSelectedDesc'),
        variant: 'destructive',
      });
      return;
    }

    if (archiveInfo?.is_encrypted && !password.trim()) {
      toast({
        title: t('dialogs.extract.passwordRequiredTitle'),
        description: t('dialogs.extract.passwordRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }

    setExtracting(true);

    try {
      const resultPath = await TauriAPI.extractSelectedEntries(
        archivePath,
        Array.from(selectedEntries),
        outputDirectory,
        overwriteExisting,
      );

      toast({
        title: t('dialogs.extract.successTitle'),
        description: t('dialogs.extract.successSelectedDesc', {
          count: selectedEntries.size,
          name: resultPath.split(/[/\\]/).pop(),
        }),
      });

      onComplete?.();
      onClose();
    } catch (err) {
      toast({
        title: t('dialogs.extract.failedTitle'),
        description: t('dialogs.extract.failedSelectedDesc', { error: (err as Error).message }),
        variant: 'destructive',
      });
    } finally {
      setExtracting(false);
    }
  };

  const handleClose = () => {
    if (extracting) return;

    setOutputDirectory('');
    setPassword('');
    setError(null);
    setSelectedEntries(new Set());
    onClose();
  };

  const handleBrowseOutputDirectory = async () => {
    try {
      const result = await TauriAPI.showOpenDialog({
        directory: true,
        multiple: false,
      });

      if (result && result.length > 0) {
        setOutputDirectory(result[0]);
      }
    } catch (err) {
      console.error('Failed to open directory dialog:', err);
    }
  };

  const getCompressionRatio = (): string => {
    if (!archiveInfo || archiveInfo.total_size === 0) return '';
    const ratio = (archiveInfo.compressed_size / archiveInfo.total_size) * 100;
    return t('dialogs.extract.compressionRatio', { percent: Math.round(ratio) });
  };

  const getArchiveIcon = (): React.ReactNode => {
    return <Archive size={24} className="text-xp-orange inline-block" />;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-xp-surface max-h-[90vh] w-[600px] max-w-[90vw] overflow-hidden rounded-lg shadow-2xl">
        {/* Header */}
        <div className="border-xp-border flex items-center justify-between border-b p-6">
          <h2 className="text-xp-text text-xl font-semibold">{t('dialogs.extract.title')}</h2>
          <button
            onClick={handleClose}
            disabled={extracting}
            className="hover:bg-xp-surface-light rounded-md p-2 transition-colors disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-6">
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="border-xp-blue h-8 w-8 animate-spin rounded-full border-b-2" />
              <span className="text-xp-text-muted ml-3">{t('dialogs.extract.analyzing')}</span>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <div className="mb-4 text-4xl text-red-400">
                <AlertTriangle size="1em" className="inline-block" />
              </div>
              <h3 className="text-xp-text mb-2 text-lg font-medium">
                {t('dialogs.extract.errorAnalyzingTitle')}
              </h3>
              <p className="text-xp-text-muted mb-4">{error}</p>
              <button
                onClick={loadArchiveInfo}
                className="bg-xp-blue hover:bg-xp-blue-dark rounded px-4 py-2 text-white transition-colors"
              >
                {t('dialogs.extract.tryAgain')}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Archive Summary */}
              {archiveInfo && (
                <div className="bg-xp-bg rounded-lg p-4">
                  <div className="mb-3 flex items-center">
                    <span className="mr-3 text-2xl">{getArchiveIcon()}</span>
                    <div>
                      <h3 className="text-md text-xp-text font-medium">
                        {archivePath.split(/[/\\]/).pop()}
                      </h3>
                      <p className="text-xp-text-muted text-sm">
                        {t('dialogs.extract.archiveFormat', { format: archiveInfo.format })}
                        {archiveInfo.is_encrypted && (
                          <span className="ml-2 inline-flex items-center gap-1 text-yellow-400">
                            <Lock size={14} /> {t('dialogs.extract.encrypted')}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xp-text-muted">{t('dialogs.extract.files')}</span>
                      <span className="text-xp-text ml-2">
                        {archiveInfo.total_files.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-xp-text-muted">{t('dialogs.extract.directories')}</span>
                      <span className="text-xp-text ml-2">
                        {archiveInfo.total_directories.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-xp-text-muted">
                        {t('dialogs.extract.compressedSize')}
                      </span>
                      <span className="text-xp-text ml-2">
                        {formatFileSize(archiveInfo.compressed_size)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xp-text-muted">
                        {t('dialogs.extract.uncompressedSize')}
                      </span>
                      <span className="text-xp-text ml-2">
                        {formatFileSize(archiveInfo.total_size)}
                        <span className="text-xp-green ml-1 text-xs">
                          ({getCompressionRatio()})
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Output Directory */}
              <div>
                <label className="text-xp-text mb-2 block text-sm font-medium">
                  {t('dialogs.extract.outputDir')}
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={outputDirectory}
                    onChange={(e) => setOutputDirectory(e.target.value)}
                    className="border-xp-border bg-xp-bg text-xp-text focus:ring-xp-blue focus:border-xp-blue flex-1 rounded-md border px-3 py-2"
                    placeholder={t('dialogs.extract.outputDirPlaceholder')}
                  />
                  <button
                    onClick={handleBrowseOutputDirectory}
                    className="border-xp-border hover:bg-xp-surface-light rounded-md border px-3 py-2 transition-colors"
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>

              {/* Password (if encrypted) */}
              {archiveInfo?.is_encrypted && (
                <div>
                  <label className="text-xp-text mb-2 block text-sm font-medium">
                    {t('dialogs.extract.passwordLabel')}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-xp-border bg-xp-bg text-xp-text focus:ring-xp-blue focus:border-xp-blue w-full rounded-md border px-3 py-2"
                    placeholder={t('dialogs.extract.passwordPlaceholder')}
                  />
                  <p className="mt-1 text-xs text-yellow-400">
                    <Lock size={12} className="mr-1 inline-block" />
                    {t('dialogs.extract.encryptedNote')}
                  </p>
                </div>
              )}

              {/* Options */}
              <div className="space-y-3">
                <h4 className="text-xp-text text-sm font-medium">{t('dialogs.extract.options')}</h4>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={overwriteExisting}
                      onChange={(e) => setOverwriteExisting(e.target.checked)}
                      className="text-xp-blue bg-xp-bg border-xp-border focus:ring-xp-blue h-4 w-4 rounded"
                    />
                    <span className="text-xp-text text-sm">
                      {t('dialogs.extract.overwriteExisting')}
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={preservePermissions}
                      onChange={(e) => setPreservePermissions(e.target.checked)}
                      className="text-xp-blue bg-xp-bg border-xp-border focus:ring-xp-blue h-4 w-4 rounded"
                    />
                    <span className="text-xp-text text-sm">
                      {t('dialogs.extract.preservePermissions')}
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={includeHidden}
                      onChange={(e) => setIncludeHidden(e.target.checked)}
                      className="text-xp-blue bg-xp-bg border-xp-border focus:ring-xp-blue h-4 w-4 rounded"
                    />
                    <span className="text-xp-text text-sm">
                      {t('dialogs.extract.includeHidden')}
                    </span>
                  </label>
                </div>
              </div>

              {/* Archive Contents with Selection */}
              {archiveInfo && archiveInfo.files.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xp-text text-sm font-medium">
                      {t('dialogs.extract.archiveContents', {
                        count: archiveInfo.files.length,
                      })}
                      {selectionCount > 0 && (
                        <span className="bg-xp-blue ml-2 rounded-full px-2 py-0.5 text-xs text-white">
                          {t('dialogs.extract.selectionCount', { count: selectionCount })}
                        </span>
                      )}
                    </h4>
                    <button
                      onClick={allSelected ? deselectAll : selectAll}
                      className="text-xp-blue hover:text-xp-blue-dark flex items-center gap-1 px-2 py-1 text-xs transition-colors"
                    >
                      {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      {allSelected ? t('dialogs.extract.deselectAll') : t('common.selectAll')}
                    </button>
                  </div>
                  <div className="bg-xp-bg border-xp-border max-h-48 overflow-y-auto rounded border">
                    {archiveInfo.files.map((file, _index) => (
                      <div
                        key={file.path}
                        className={`border-xp-border hover:bg-xp-surface-light flex cursor-pointer items-center space-x-2 border-b px-3 py-1 text-xs transition-colors last:border-b-0 ${selectedEntries.has(file.path) ? 'bg-xp-blue/10' : ''}`}
                        onClick={() => toggleEntry(file.path)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedEntries.has(file.path)}
                          onChange={() => toggleEntry(file.path)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xp-blue bg-xp-bg border-xp-border focus:ring-xp-blue h-3.5 w-3.5 flex-shrink-0 rounded"
                        />
                        <span className="text-xp-text-muted flex-shrink-0">
                          {file.is_directory ? (
                            <FolderClosed size={12} className="inline-block" />
                          ) : (
                            <FileIcon size={12} className="inline-block" />
                          )}
                        </span>
                        <span className="text-xp-text flex-1 truncate">{file.path}</span>
                        <span className="text-xp-text-muted flex-shrink-0">
                          {file.is_directory ? '' : formatFileSize(file.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-xp-border bg-xp-bg flex justify-end space-x-3 border-t p-6">
          <button
            onClick={handleClose}
            disabled={extracting}
            className="text-xp-text hover:bg-xp-surface-light rounded px-4 py-2 transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          {selectionCount > 0 && (
            <button
              onClick={handleExtractSelected}
              disabled={
                extracting ||
                loading ||
                !outputDirectory.trim() ||
                (archiveInfo?.is_encrypted && !password.trim())
              }
              className="bg-xp-green flex items-center space-x-2 rounded px-4 py-2 text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {extracting && (
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
              )}
              <span>
                {extracting
                  ? t('dialogs.extract.extracting')
                  : t('dialogs.extract.extractSelected', { count: selectionCount })}
              </span>
            </button>
          )}
          <button
            onClick={handleExtract}
            disabled={
              extracting ||
              loading ||
              !outputDirectory.trim() ||
              (archiveInfo?.is_encrypted && !password.trim())
            }
            className="bg-xp-blue hover:bg-xp-blue-dark flex items-center space-x-2 rounded px-4 py-2 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {extracting && (
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
            )}
            <span>
              {extracting ? t('dialogs.extract.extracting') : t('dialogs.extract.extractAll')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExtractDialog;
