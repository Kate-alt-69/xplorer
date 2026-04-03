import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, Clock, CheckCircle, AlertTriangle, FileJson } from 'lucide-react';
import { SectionTitle, SettingRow, Divider } from './shared';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const EXPORT_VERSION = '0.4.0';
const LAST_EXPORT_KEY = STORAGE_KEYS.LAST_EXPORT_DATE;

const KNOWN_KEYS = [
  STORAGE_KEYS.SETTINGS,
  STORAGE_KEYS.UI_STATE,
  STORAGE_KEYS.FONT_SIZE,
  STORAGE_KEYS.MARKETPLACE_URL,
  STORAGE_KEYS.AUTO_WHITELIST_VISITED,
  STORAGE_KEYS.SPLIT_LAYOUT,
  STORAGE_KEYS.TOUR_COMPLETED,
  STORAGE_KEYS.BETA_WARNING_DISMISSED,
  STORAGE_KEYS.CUSTOM_THEMES,
  STORAGE_KEYS.LAST_EXPORT_DATE,
  STORAGE_KEYS.OPENAI_KEY,
  STORAGE_KEYS.OLLAMA_URL,
  STORAGE_KEYS.VIM_MODE,
  STORAGE_KEYS.INSTALLED_EXTENSIONS,
  STORAGE_KEYS.SEARCH_HISTORY,
  STORAGE_KEYS.PERMISSION_VIOLATIONS,
  STORAGE_KEYS.SYNC_API_URL,
  STORAGE_KEYS.SYNC_TOKEN,
  STORAGE_KEYS.AUTO_SYNC_ENABLED,
  'gdrive-plugin-settings',
  'gdrive-file-cache',
];

const KNOWN_PREFIXES = ['xplorer:', 'xplorer_', 'xplorer-', 'gdrive-'];

interface ExportPayload {
  version: string;
  exportDate: string;
  settings: Record<string, string>;
}

type ImportStatus =
  | { type: 'idle' }
  | { type: 'preview'; payload: ExportPayload; categories: ImportCategory[] }
  | { type: 'success'; count: number }
  | { type: 'error'; message: string };

interface ImportCategory {
  label: string;
  keys: string[];
}

const collectExportableKeys = (): string[] => {
  const keys = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (KNOWN_KEYS.includes(key) || KNOWN_PREFIXES.some((p) => key.startsWith(p))) {
      keys.add(key);
    }
  }
  return Array.from(keys).sort();
};

const categorizeKeys = (keys: string[]): ImportCategory[] => {
  const categories: ImportCategory[] = [];
  const buckets: Record<string, string[]> = {
    'settings.backup.categoryAppSettings': [],
    'settings.backup.categoryAppearance': [],
    'settings.backup.categoryAiSearch': [],
    'settings.backup.categoryExtensions': [],
    'settings.backup.categorySyncCloud': [],
    'settings.backup.categoryOther': [],
  };

  for (const key of keys) {
    if (
      key === STORAGE_KEYS.SETTINGS ||
      key === STORAGE_KEYS.UI_STATE ||
      key === STORAGE_KEYS.FONT_SIZE ||
      key === STORAGE_KEYS.SPLIT_LAYOUT
    ) {
      buckets['settings.backup.categoryAppSettings'].push(key);
    } else if (key.includes('theme') || key.includes('custom-themes')) {
      buckets['settings.backup.categoryAppearance'].push(key);
    } else if (key.includes('openai') || key.includes('ollama') || key.includes('search')) {
      buckets['settings.backup.categoryAiSearch'].push(key);
    } else if (key.includes('extension') || key.includes('marketplace')) {
      buckets['settings.backup.categoryExtensions'].push(key);
    } else if (key.includes('sync') || key.includes('gdrive')) {
      buckets['settings.backup.categorySyncCloud'].push(key);
    } else {
      buckets['settings.backup.categoryOther'].push(key);
    }
  }

  for (const [label, keyList] of Object.entries(buckets)) {
    if (keyList.length > 0) {
      categories.push({ label, keys: keyList });
    }
  }

  return categories;
};

const buildExportPayload = (): ExportPayload => {
  const keys = collectExportableKeys();
  const settings: Record<string, string> = {};
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      settings[key] = value;
    }
  }
  return {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    settings,
  };
};

const downloadJson = (payload: ExportPayload) => {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `xplorer-settings-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const validatePayload = (data: unknown): data is ExportPayload => {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== 'string') return false;
  if (typeof obj.exportDate !== 'string') return false;
  if (typeof obj.settings !== 'object' || obj.settings === null) return false;
  const settings = obj.settings as Record<string, unknown>;
  for (const [key, val] of Object.entries(settings)) {
    if (typeof key !== 'string' || typeof val !== 'string') return false;
  }
  return true;
};

const BackupRestoreSettings = () => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>({ type: 'idle' });
  const [lastExportDate, setLastExportDate] = useState<string | null>(() => {
    return localStorage.getItem(LAST_EXPORT_KEY);
  });

  const handleExport = () => {
    try {
      const payload = buildExportPayload();
      downloadJson(payload);
      const now = new Date().toISOString();
      localStorage.setItem(LAST_EXPORT_KEY, now);
      setLastExportDate(now);
    } catch {
      setImportStatus({ type: 'error', message: t('settings.backup.exportFailed') });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const data = JSON.parse(text);

        if (!validatePayload(data)) {
          setImportStatus({
            type: 'error',
            message: t('settings.backup.invalidBackupStructure'),
          });
          return;
        }

        const keys = Object.keys(data.settings);
        const categories = categorizeKeys(keys);
        setImportStatus({ type: 'preview', payload: data, categories });
      } catch {
        setImportStatus({
          type: 'error',
          message: t('settings.backup.invalidJson'),
        });
      }
    };
    reader.onerror = () => {
      setImportStatus({ type: 'error', message: t('settings.backup.readFileFailed') });
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleApplyImport = () => {
    if (importStatus.type !== 'preview') return;
    const { payload } = importStatus;
    let count = 0;
    for (const [key, value] of Object.entries(payload.settings)) {
      localStorage.setItem(key, value);
      count++;
    }
    setImportStatus({ type: 'success', count });
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  const handleCancelImport = () => {
    setImportStatus({ type: 'idle' });
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-1">
      <SectionTitle
        title={t('settings.backup.exportSection')}
        description={t('settings.backup.exportSectionDesc')}
      />

      <SettingRow
        icon={Download}
        label={t('settings.backup.exportLabel')}
        description={t('settings.backup.exportDesc')}
      >
        <button
          onClick={handleExport}
          className="bg-xp-accent flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Download size={14} />
          {t('settings.backup.exportButton')}
        </button>
      </SettingRow>

      {lastExportDate && (
        <div className="text-xp-text-secondary flex items-center gap-2 px-4 py-1.5 text-xs">
          <Clock size={12} className="shrink-0" />
          <span>{t('settings.backup.lastExported', { date: formatDate(lastExportDate) })}</span>
        </div>
      )}

      <Divider />
      <SectionTitle
        title={t('settings.backup.importSection')}
        description={t('settings.backup.importSectionDesc')}
      />

      <SettingRow
        icon={Upload}
        label={t('settings.backup.importLabel')}
        description={t('settings.backup.importDesc')}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          className="border-xp-border bg-xp-surface text-xp-text hover:bg-xp-surface-light flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors"
        >
          <Upload size={14} />
          {t('settings.backup.chooseFile')}
        </button>
      </SettingRow>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileSelect}
      />

      {importStatus.type === 'error' && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
          <div>
            <div className="text-sm font-medium text-red-400">
              {t('settings.backup.importErrorTitle')}
            </div>
            <div className="mt-0.5 text-xs text-red-400/80">{importStatus.message}</div>
          </div>
          <button
            onClick={handleCancelImport}
            className="ml-auto shrink-0 text-xs text-red-400/60 transition-colors hover:text-red-400"
          >
            {t('settings.backup.dismiss')}
          </button>
        </div>
      )}

      {importStatus.type === 'preview' && (
        <div className="border-xp-border bg-xp-surface mx-4 mt-2 rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileJson size={16} className="text-xp-accent" />
            <span className="text-xp-text text-sm font-medium">
              {t('settings.backup.importPreviewTitle')}
            </span>
          </div>

          <div className="text-xp-text-secondary mb-3 space-y-1 text-xs">
            <div>
              {t('settings.backup.previewVersion')}{' '}
              <span className="text-xp-text font-mono">{importStatus.payload.version}</span>
            </div>
            <div>
              {t('settings.backup.previewExported')}{' '}
              <span className="text-xp-text">{formatDate(importStatus.payload.exportDate)}</span>
            </div>
            <div>
              {t('settings.backup.previewTotalKeys')}{' '}
              <span className="text-xp-text font-mono">
                {Object.keys(importStatus.payload.settings).length}
              </span>
            </div>
          </div>

          <div className="mb-4 space-y-2">
            {importStatus.categories.map((cat) => (
              <div key={cat.label} className="bg-xp-bg/50 rounded-md px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xp-text text-xs font-medium">{t(cat.label)}</span>
                  <span className="text-xp-text-secondary font-mono text-[10px]">
                    {t('settings.backup.previewKeyCount', { count: cat.keys.length })}
                  </span>
                </div>
                <div className="text-xp-text-secondary/70 mt-1 font-mono text-[10px] leading-relaxed">
                  {cat.keys.join(', ')}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2">
            <AlertTriangle size={14} className="shrink-0 text-amber-400" />
            <span className="text-xs text-amber-400/90">
              {t('settings.backup.overwriteWarning')}
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancelImport}
              className="border-xp-border bg-xp-surface text-xp-text hover:bg-xp-surface-light rounded-md border px-3 py-1.5 text-sm transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApplyImport}
              className="bg-xp-accent flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <CheckCircle size={14} />
              {t('settings.backup.applyImport')}
            </button>
          </div>
        </div>
      )}

      {importStatus.type === 'success' && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <CheckCircle size={16} className="shrink-0 text-emerald-400" />
          <div>
            <div className="text-sm font-medium text-emerald-400">
              {t('settings.backup.importSuccessTitle')}
            </div>
            <div className="mt-0.5 text-xs text-emerald-400/80">
              {t('settings.backup.importSuccessDesc', { count: importStatus.count })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupRestoreSettings;
