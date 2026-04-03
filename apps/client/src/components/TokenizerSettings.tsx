import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, TokenizerSettings, TokenIndex, IndexingProgress } from '@/lib/tauri-api';
import { useToast } from '@/hooks/use-toast';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { formatFileSize } from '@/lib/utils';

interface TokenizerSettingsProps {
  className?: string;
}

const TokenizerSettingsComponent = ({ className }: TokenizerSettingsProps) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TokenizerSettings>({
    enabled: false,
    whitelisted_paths: [],
    blacklisted_extensions: [],
    blacklisted_paths: [],
    max_file_size: 10 * 1024 * 1024, // 10MB
    update_interval: 300, // 5 minutes
    memory_limit_mb: 1024, // 1 GB
  });

  const [stats, setStats] = useState<TokenIndex | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress | null>(null);
  const [newPath, setNewPath] = useState('');
  const [newBlacklistPath, setNewBlacklistPath] = useState('');
  const [newExtension, setNewExtension] = useState('');
  const [autoWhitelist, setAutoWhitelist] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AUTO_WHITELIST_VISITED);
    return saved !== null ? saved === 'true' : true; // default ON
  });
  const [isLoading, setIsLoading] = useState(true);

  const { toast } = useToast();

  const loadSettings = async () => {
    try {
      const tokenizerSettings = await TauriAPI.getTokenizerSettings();
      setSettings(tokenizerSettings);
    } catch (error) {
      console.error('Failed to load tokenizer settings:', error);
      toast({
        title: t('toast.tokenizerLoadError'),
        description: t('toast.tokenizerLoadErrorDesc'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const tokenizerStats = await TauriAPI.getTokenizerStats();
      setStats(tokenizerStats);
    } catch (error) {
      console.error('Failed to load tokenizer stats:', error);
    }
  };

  const checkIndexingStatus = async () => {
    try {
      const indexing = await TauriAPI.isTokenizerIndexing();
      setIsIndexing(indexing);
    } catch (error) {
      console.error('Failed to check indexing status:', error);
    }
  };

  useEffect(() => {
    loadSettings();
    loadStats();
    checkIndexingStatus();

    // Listen for indexing progress
    const unlisten = TauriAPI.listenToEvent<IndexingProgress>('tokenizer-progress', (progress) => {
      setIndexingProgress(progress);
      if (progress.status === 'Completed') {
        setIsIndexing(false);
        loadStats();
        toast({
          title: t('toast.tokenizerIndexingComplete'),
          description: t('toast.tokenizerIndexingCompleteDesc', {
            files: progress.processed_files,
            tokens: progress.total_tokens,
          }),
        });
      }
    });

    return () => {
      unlisten.then((fn) => fn()).catch(console.error);
    };
    // Mount-only: loadSettings and toast are stable and only needed on init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save when enabled toggle changes (so it persists across reopens)
  const initialLoadRef = React.useRef(true);
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    TauriAPI.setTokenizerSettings(settings).catch((err) =>
      console.error('Failed to auto-save indexing settings:', err),
    );
  }, [settings.enabled]);

  const saveSettings = async () => {
    try {
      await TauriAPI.setTokenizerSettings(settings);
      toast({
        title: t('toast.tokenizerSettingsSaved'),
        description: t('toast.tokenizerSettingsSavedDesc'),
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast({
        title: t('toast.tokenizerSaveError'),
        description: t('toast.tokenizerSaveErrorDesc'),
        variant: 'destructive',
      });
    }
  };

  const addWhitelistedPath = () => {
    if (newPath.trim() && !settings.whitelisted_paths.includes(newPath.trim())) {
      setSettings((prev) => ({
        ...prev,
        whitelisted_paths: [...prev.whitelisted_paths, newPath.trim()],
      }));
      setNewPath('');
    }
  };

  const removeWhitelistedPath = (path: string) => {
    setSettings((prev) => ({
      ...prev,
      whitelisted_paths: prev.whitelisted_paths.filter((p) => p !== path),
    }));
  };

  const addBlacklistedExtension = () => {
    if (
      newExtension.trim() &&
      !settings.blacklisted_extensions.includes(newExtension.trim().toLowerCase())
    ) {
      setSettings((prev) => ({
        ...prev,
        blacklisted_extensions: [...prev.blacklisted_extensions, newExtension.trim().toLowerCase()],
      }));
      setNewExtension('');
    }
  };

  const removeBlacklistedExtension = (extension: string) => {
    setSettings((prev) => ({
      ...prev,
      blacklisted_extensions: prev.blacklisted_extensions.filter((ext) => ext !== extension),
    }));
  };

  const addBlacklistedPath = () => {
    if (newBlacklistPath.trim() && !settings.blacklisted_paths.includes(newBlacklistPath.trim())) {
      setSettings((prev) => ({
        ...prev,
        blacklisted_paths: [...prev.blacklisted_paths, newBlacklistPath.trim()],
      }));
      setNewBlacklistPath('');
    }
  };

  const removeBlacklistedPath = (path: string) => {
    setSettings((prev) => ({
      ...prev,
      blacklisted_paths: prev.blacklisted_paths.filter((p) => p !== path),
    }));
  };

  const toggleAutoWhitelist = (value: boolean) => {
    setAutoWhitelist(value);
    localStorage.setItem(STORAGE_KEYS.AUTO_WHITELIST_VISITED, String(value));
  };

  const handleRebuildIndex = async () => {
    try {
      await TauriAPI.rebuildTokenIndex();
      setIsIndexing(true);
      setIndexingProgress(null);
      toast({
        title: t('toast.tokenizerIndexingStarted'),
        description: t('toast.tokenizerIndexingStartedDesc'),
      });
    } catch (error) {
      console.error('Failed to start indexing:', error);
      toast({
        title: t('toast.tokenizerIndexingError'),
        description: t('toast.tokenizerIndexingErrorDesc'),
        variant: 'destructive',
      });
    }
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className || ''}`}>
        <div className="border-xp-blue h-8 w-8 animate-spin rounded-full border-b-2" />
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xp-text text-xl font-semibold">{t('settings.tokenizer.title')}</h2>
          <p className="text-xp-text-muted text-sm">{t('settings.tokenizer.subtitle')}</p>
        </div>

        <div className="flex items-center space-x-2">
          {stats && (
            <div className="text-xp-text-muted text-xs">
              {t('settings.tokenizer.statsFilesTokens', {
                files: stats.total_files,
                tokens: stats.total_tokens.toLocaleString(),
              })}
            </div>
          )}
          <div
            className={`h-3 w-3 rounded-full ${settings.enabled ? 'bg-green-500' : 'bg-gray-400'}`}
          />
        </div>
      </div>

      {/* Enable/Disable Toggle */}
      <div className="bg-xp-surface border-xp-border flex items-center justify-between rounded-lg border p-4">
        <div>
          <h3 className="text-xp-text font-medium">{t('settings.tokenizer.enableIndexing')}</h3>
          <p className="text-xp-text-muted text-sm">{t('settings.tokenizer.enableIndexingDesc')}</p>
        </div>
        <button
          onClick={() => setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className={`rounded-md px-4 py-2 transition-colors ${
            settings.enabled
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-gray-600 text-white hover:bg-gray-700'
          }`}
        >
          {settings.enabled ? t('settings.tokenizer.enabled') : t('settings.tokenizer.disabled')}
        </button>
      </div>

      {/* Auto-whitelist visited folders */}
      <div className="bg-xp-surface border-xp-border flex items-center justify-between rounded-lg border p-4">
        <div>
          <h3 className="text-xp-text font-medium">{t('settings.tokenizer.autoWhitelist')}</h3>
          <p className="text-xp-text-muted text-sm">{t('settings.tokenizer.autoWhitelistDesc')}</p>
        </div>
        <button
          onClick={() => toggleAutoWhitelist(!autoWhitelist)}
          className={`rounded-md px-4 py-2 transition-colors ${
            autoWhitelist
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-gray-600 text-white hover:bg-gray-700'
          }`}
        >
          {autoWhitelist ? t('settings.tokenizer.enabled') : t('settings.tokenizer.disabled')}
        </button>
      </div>

      {/* Indexing Status & Progress */}
      {(isIndexing || indexingProgress) && (
        <div className="bg-xp-surface border-xp-border rounded-lg border p-4">
          <div className="mb-2 flex items-center space-x-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            <h3 className="text-xp-text font-medium">
              {isIndexing
                ? t('settings.tokenizer.indexingInProgress')
                : t('settings.tokenizer.indexingComplete')}
            </h3>
          </div>

          {indexingProgress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-xp-text-muted">
                  {t('settings.tokenizer.progressFiles', {
                    processed: indexingProgress.processed_files,
                    total: indexingProgress.total_files,
                  })}
                </span>
                <span className="text-xp-text">
                  {indexingProgress.progress_percentage.toFixed(1)}%
                </span>
              </div>

              <div className="bg-xp-bg h-2 w-full rounded-full">
                <div
                  className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${indexingProgress.progress_percentage}%` }}
                />
              </div>

              <div className="text-xp-text-muted text-xs">
                {t('settings.tokenizer.currentFile', { file: indexingProgress.current_file })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Statistics */}
      {stats && (
        <div className="bg-xp-surface border-xp-border rounded-lg border p-4">
          <h3 className="text-xp-text mb-3 font-medium">{t('settings.tokenizer.statistics')}</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="text-center">
              <div className="text-xp-blue text-lg font-semibold">{stats.total_files}</div>
              <div className="text-xp-text-muted text-xs">
                {t('settings.tokenizer.filesIndexed')}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xp-blue text-lg font-semibold">
                {stats.total_tokens.toLocaleString()}
              </div>
              <div className="text-xp-text-muted text-xs">
                {t('settings.tokenizer.totalTokens')}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xp-blue text-lg font-semibold">
                {Object.keys(stats.word_to_files || {}).length.toLocaleString()}
              </div>
              <div className="text-xp-text-muted text-xs">
                {t('settings.tokenizer.uniqueWords')}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xp-blue text-lg font-semibold">
                {stats.last_updated
                  ? new Date(stats.last_updated * 1000).toLocaleDateString()
                  : t('settings.tokenizer.never')}
              </div>
              <div className="text-xp-text-muted text-xs">
                {t('settings.tokenizer.lastUpdated')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Whitelisted Paths */}
      <div className="bg-xp-surface border-xp-border rounded-lg border p-4">
        <h3 className="text-xp-text mb-3 font-medium">{t('settings.tokenizer.whitelistedDirs')}</h3>
        <p className="text-xp-text-muted mb-3 text-xs">
          {t('settings.tokenizer.whitelistedDirsDesc')}
        </p>

        <div className="mb-3 space-y-2">
          {settings.whitelisted_paths.map((path) => (
            <div key={path} className="bg-xp-bg flex items-center justify-between rounded p-2">
              <span className="font-mono text-sm">{path}</span>
              <button
                onClick={() => removeWhitelistedPath(path)}
                className="p-1 text-red-500 hover:text-red-400"
                title={t('settings.tokenizer.removePathTitle')}
              >
                ×
              </button>
            </div>
          ))}

          {settings.whitelisted_paths.length === 0 && (
            <div className="text-xp-text-muted py-4 text-center">
              {t('settings.tokenizer.noWhitelistedDirs')}
            </div>
          )}
        </div>

        <div className="flex space-x-2">
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addWhitelistedPath()}
            placeholder={t('settings.tokenizer.addDirPlaceholder')}
            className="bg-xp-bg border-xp-border flex-1 rounded border px-3 py-2 text-sm"
          />
          <button
            onClick={addWhitelistedPath}
            className="bg-xp-blue hover:bg-xp-blue-dark rounded px-4 py-2 text-sm text-white"
          >
            {t('common.add')}
          </button>
        </div>
      </div>

      {/* Blacklisted Extensions */}
      <div className="bg-xp-surface border-xp-border rounded-lg border p-4">
        <h3 className="text-xp-text mb-3 font-medium">
          {t('settings.tokenizer.blacklistedExtensions')}
        </h3>
        <p className="text-xp-text-muted mb-3 text-xs">
          {t('settings.tokenizer.blacklistedExtensionsDesc')}
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          {settings.blacklisted_extensions.map((ext) => (
            <span key={ext} className="bg-xp-bg inline-flex items-center rounded px-2 py-1 text-sm">
              .{ext}
              <button
                onClick={() => removeBlacklistedExtension(ext)}
                className="ml-2 text-red-500 hover:text-red-400"
                title={t('settings.tokenizer.removeExtensionTitle')}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="flex space-x-2">
          <input
            type="text"
            value={newExtension}
            onChange={(e) => setNewExtension(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addBlacklistedExtension()}
            placeholder={t('settings.tokenizer.addExtPlaceholder')}
            className="bg-xp-bg border-xp-border flex-1 rounded border px-3 py-2 text-sm"
          />
          <button
            onClick={addBlacklistedExtension}
            className="bg-xp-blue hover:bg-xp-blue-dark rounded px-4 py-2 text-sm text-white"
          >
            {t('common.add')}
          </button>
        </div>
      </div>

      {/* Blacklisted Paths */}
      <div className="bg-xp-surface border-xp-border rounded-lg border p-4">
        <h3 className="text-xp-text mb-3 font-medium">{t('settings.tokenizer.blacklistedDirs')}</h3>
        <p className="text-xp-text-muted mb-3 text-xs">
          {t('settings.tokenizer.blacklistedDirsDesc')}
        </p>

        <div className="mb-3 space-y-2">
          {(settings.blacklisted_paths || []).map((path) => (
            <div key={path} className="bg-xp-bg flex items-center justify-between rounded p-2">
              <span className="font-mono text-sm">{path}</span>
              <button
                onClick={() => removeBlacklistedPath(path)}
                className="p-1 text-red-500 hover:text-red-400"
                title={t('settings.tokenizer.removeBlacklistPathTitle')}
              >
                &times;
              </button>
            </div>
          ))}

          {(!settings.blacklisted_paths || settings.blacklisted_paths.length === 0) && (
            <div className="text-xp-text-muted py-4 text-center">
              {t('settings.tokenizer.noBlacklistedDirs')}
            </div>
          )}
        </div>

        <div className="flex space-x-2">
          <input
            type="text"
            value={newBlacklistPath}
            onChange={(e) => setNewBlacklistPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addBlacklistedPath()}
            placeholder={t('settings.tokenizer.addExcludeDirPlaceholder')}
            className="bg-xp-bg border-xp-border flex-1 rounded border px-3 py-2 text-sm"
          />
          <button
            onClick={addBlacklistedPath}
            className="bg-xp-blue hover:bg-xp-blue-dark rounded px-4 py-2 text-sm text-white"
          >
            {t('common.add')}
          </button>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="bg-xp-surface border-xp-border rounded-lg border p-4">
        <h3 className="text-xp-text mb-3 font-medium">
          {t('settings.tokenizer.advancedSettings')}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">
              {t('settings.tokenizer.maxFileSize', {
                size: formatFileSize(settings.max_file_size),
              })}
            </label>
            <input
              type="range"
              min={1024 * 1024} // 1MB
              max={100 * 1024 * 1024} // 100MB
              step={1024 * 1024}
              value={settings.max_file_size}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, max_file_size: parseInt(e.target.value) }))
              }
              className="w-full"
            />
            <div className="text-xp-text-muted mt-1 text-xs">
              {t('settings.tokenizer.maxFileSizeDesc')}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              {t('settings.tokenizer.updateInterval', {
                duration: formatDuration(settings.update_interval),
              })}
            </label>
            <input
              type="range"
              min={60} // 1 minute
              max={3600} // 1 hour
              step={60}
              value={settings.update_interval}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, update_interval: parseInt(e.target.value) }))
              }
              className="w-full"
            />
            <div className="text-xp-text-muted mt-1 text-xs">
              {t('settings.tokenizer.updateIntervalDesc')}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              {t('settings.tokenizer.memoryLimit', {
                limit:
                  settings.memory_limit_mb >= 1024
                    ? `${(settings.memory_limit_mb / 1024).toFixed(settings.memory_limit_mb % 1024 === 0 ? 0 : 1)} GB`
                    : `${settings.memory_limit_mb} MB`,
              })}
            </label>
            <input
              type="range"
              min={256}
              max={4096}
              step={256}
              value={settings.memory_limit_mb}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, memory_limit_mb: parseInt(e.target.value) }))
              }
              className="w-full"
            />
            <div className="text-xp-text-muted mt-1 text-xs">
              {t('settings.tokenizer.memoryLimitDesc')}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex space-x-3">
        <button
          onClick={saveSettings}
          className="bg-xp-blue hover:bg-xp-blue-dark flex-1 rounded px-4 py-2 text-white transition-colors"
        >
          {t('settings.tokenizer.saveSettings')}
        </button>

        <button
          onClick={handleRebuildIndex}
          disabled={isIndexing || !settings.enabled || settings.whitelisted_paths.length === 0}
          className="rounded bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isIndexing ? t('settings.tokenizer.indexing') : t('settings.tokenizer.rebuildIndex')}
        </button>

        <button
          onClick={() => {
            const defaults: TokenizerSettings = {
              enabled: true,
              whitelisted_paths: [],
              blacklisted_extensions: [
                'exe',
                'dll',
                'so',
                'dylib',
                'bin',
                'obj',
                'zip',
                'tar',
                'gz',
                'rar',
                '7z',
                'iso',
                'jpg',
                'jpeg',
                'png',
                'gif',
                'bmp',
                'tiff',
                'mp4',
                'avi',
                'mov',
                'wmv',
                'flv',
                'mkv',
                'mp3',
                'wav',
                'flac',
                'aac',
                'ogg',
                'wma',
                'doc',
                'ppt',
                'xls',
              ],
              blacklisted_paths: [],
              max_file_size: 10 * 1024 * 1024,
              update_interval: 300,
              memory_limit_mb: 1024,
            };
            setSettings(defaults);
            toggleAutoWhitelist(true);
            toast({
              title: t('toast.tokenizerReset'),
              description: t('toast.tokenizerResetDesc'),
            });
          }}
          className="rounded bg-gray-600 px-4 py-2 text-white transition-colors hover:bg-gray-700"
        >
          {t('settings.tokenizer.resetToDefaults')}
        </button>
      </div>
    </div>
  );
};

export default TokenizerSettingsComponent;
