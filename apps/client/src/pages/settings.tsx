import { useState, useEffect } from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  FolderOpen,
  Bot,
  Search,
  Accessibility,
  Shield,
  Keyboard,
  Store,
  HardDrive,
  ClipboardList,
  History,
  MousePointerClick,
  Settings2,
  ChevronRight,
  FileCode,
  RefreshCw,
  Heart,
  Github,
  ExternalLink,
  Info,
} from 'lucide-react';
import {
  AgentService,
  type SafeAgentSettings,
  type UpdateAgentSettingsPayload,
  type AgentPermissions,
} from '@/lib/agent-service';
import TokenizerSettings from '@/components/TokenizerSettings';
import BackupRestoreSettings from '@/components/settings/BackupRestoreSettings';
import AuditLogSettings from '@/components/settings/AuditLogSettings';
import VersioningSettings from '@/components/settings/VersioningSettings';
import ContextMenuRulesCard from '@/components/settings/ContextMenuRulesCard';
import ShortcutsSettingsPanel from '@/components/settings/ShortcutsSettings';
import GeneralSettings from '@/components/settings/GeneralSettings';
import ExplorerSettings from '@/components/settings/ExplorerSettings';
import AISettings from '@/components/settings/AISettings';
import PermissionsSettings from '@/components/settings/PermissionsSettings';
import AccessibilitySettings from '@/components/settings/AccessibilitySettings';
import FileAssociationsSettings from '@/components/settings/FileAssociationsSettings';
import { loadFontSize } from '@/lib/utils';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  Toggle,
  SettingRow,
} from '@/components/settings/shared';

type SettingsTab =
  | 'general'
  | 'explorer'
  | 'file-associations'
  | 'context-menu'
  | 'ai'
  | 'permissions'
  | 'indexing'
  | 'shortcuts'
  | 'accessibility'
  | 'marketplace'
  | 'backup'
  | 'audit'
  | 'versioning'
  | 'about';

type TabDef = { id: SettingsTab; label: string; icon: React.ElementType; description: string };

const buildTabs = (t: (key: string) => string): TabDef[] => [
  {
    id: 'general',
    label: t('settings.tabs.general'),
    icon: Settings2,
    description: t('settings.tabs.generalDesc'),
  },
  {
    id: 'explorer',
    label: t('settings.tabs.explorer'),
    icon: FolderOpen,
    description: t('settings.tabs.explorerDesc'),
  },
  {
    id: 'file-associations',
    label: t('settings.tabs.fileAssociations'),
    icon: FileCode,
    description: t('settings.tabs.fileAssociationsDesc'),
  },
  {
    id: 'context-menu',
    label: t('settings.tabs.contextMenu'),
    icon: MousePointerClick,
    description: t('settings.tabs.contextMenuDesc'),
  },
  {
    id: 'ai',
    label: t('settings.tabs.ai'),
    icon: Bot,
    description: t('settings.tabs.aiDesc'),
  },
  {
    id: 'permissions',
    label: t('settings.tabs.permissions'),
    icon: Shield,
    description: t('settings.tabs.permissionsDesc'),
  },
  {
    id: 'indexing',
    label: t('settings.tabs.indexing'),
    icon: Search,
    description: t('settings.tabs.indexingDesc'),
  },
  {
    id: 'shortcuts',
    label: t('settings.tabs.shortcuts'),
    icon: Keyboard,
    description: t('settings.tabs.shortcutsDesc'),
  },
  {
    id: 'marketplace',
    label: t('settings.tabs.marketplace'),
    icon: Store,
    description: t('settings.tabs.marketplaceDesc'),
  },
  {
    id: 'accessibility',
    label: t('settings.tabs.accessibility'),
    icon: Accessibility,
    description: t('settings.tabs.accessibilityDesc'),
  },
  {
    id: 'backup',
    label: t('settings.tabs.backup'),
    icon: HardDrive,
    description: t('settings.tabs.backupDesc'),
  },
  {
    id: 'audit',
    label: t('settings.tabs.audit'),
    icon: ClipboardList,
    description: t('settings.tabs.auditDesc'),
  },
  {
    id: 'versioning',
    label: t('settings.tabs.versioning'),
    icon: History,
    description: t('settings.tabs.versioningDesc'),
  },
  {
    id: 'about',
    label: t('settings.tabs.about'),
    icon: Info,
    description: t('settings.tabs.aboutDesc'),
  },
];

const MarketplaceSettings = ({
  autoUpdateExtensions,
  setAutoUpdateExtensions,
  t,
}: {
  autoUpdateExtensions: boolean;
  setAutoUpdateExtensions: (v: boolean) => void;
  t: (key: string) => string;
}) => (
  <div className="space-y-1">
    <div className="mb-1 px-4 pb-1 pt-2">
      <h3 className="text-xp-text-secondary text-xs font-semibold uppercase tracking-wider">
        {t('settings.marketplace.updatesSection')}
      </h3>
    </div>
    <SettingRow
      icon={RefreshCw}
      label={t('extensions.autoUpdate')}
      description={t('extensions.autoUpdateDescription')}
    >
      <Toggle
        id="autoUpdateExtensions"
        label={t('extensions.autoUpdate')}
        checked={autoUpdateExtensions}
        onChange={setAutoUpdateExtensions}
      />
    </SettingRow>
  </div>
);

const Settings = () => {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const tabs = buildTabs(t);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      /* ignore localStorage/parse errors */
    }
    return DEFAULT_SETTINGS;
  });

  const [autoUpdateExtensions, setAutoUpdateExtensions] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AUTO_UPDATE_EXTENSIONS);
      // Default to true if not explicitly set
      return raw === null || raw === 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.AUTO_UPDATE_EXTENSIONS, String(autoUpdateExtensions));
  }, [autoUpdateExtensions]);

  const [agentSettings, setAgentSettings] = useState<SafeAgentSettings>({
    enabled: true,
    has_api_key: false,
    has_openai_api_key: false,
    model: 'claude-sonnet-4-6',
    max_turns: 25,
    auto_approve: false,
    thinking_enabled: false,
    thinking_budget: 10000,
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [agentSettingsLoaded, setAgentSettingsLoaded] = useState(false);

  const [permissions, setPermissions] = useState<AgentPermissions>({
    disabled_tools: [],
    auto_approve_tools: [],
    allowed_paths: [],
    blocked_paths: [],
    custom_blocked_commands: [],
    block_internet: true,
  });
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    AgentService.getSettings()
      .then((s) => {
        setAgentSettings(s);
        setAgentSettingsLoaded(true);
      })
      .catch(() => {
        setAgentSettingsLoaded(true);
      });
  }, []);

  // Persist non-secret agent settings on change (debounced)
  useEffect(() => {
    if (!agentSettingsLoaded) return;
    const payload: UpdateAgentSettingsPayload = {
      enabled: agentSettings.enabled,
      model: agentSettings.model,
      max_turns: agentSettings.max_turns,
      auto_approve: agentSettings.auto_approve,
      thinking_enabled: agentSettings.thinking_enabled,
      thinking_budget: agentSettings.thinking_budget,
    };
    const timer = setTimeout(() => {
      AgentService.updateSettings(payload).catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [agentSettings, agentSettingsLoaded]);

  // Persist API keys on change (debounced, separate command)
  useEffect(() => {
    if (!agentSettingsLoaded) return;
    if (apiKeyInput === '' && openaiKeyInput === '') return;
    const timer = setTimeout(() => {
      const payload: { api_key?: string; openai_api_key?: string } = {};
      if (apiKeyInput !== '') payload.api_key = apiKeyInput;
      if (openaiKeyInput !== '') payload.openai_api_key = openaiKeyInput;
      AgentService.updateApiKeys(payload)
        .then(() => {
          setAgentSettings((prev) => ({
            ...prev,
            has_api_key: apiKeyInput !== '' ? true : prev.has_api_key,
            has_openai_api_key: openaiKeyInput !== '' ? true : prev.has_openai_api_key,
          }));
        })
        .catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [apiKeyInput, openaiKeyInput, agentSettingsLoaded]);

  const updateAgentSetting = <K extends keyof SafeAgentSettings>(
    key: K,
    value: SafeAgentSettings[K],
  ) => {
    setAgentSettings((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    AgentService.getPermissions()
      .then((p) => {
        setPermissions(p);
        setPermissionsLoaded(true);
      })
      .catch(() => setPermissionsLoaded(true));
  }, []);

  useEffect(() => {
    if (!permissionsLoaded) return;
    const timer = setTimeout(() => {
      AgentService.updatePermissions(permissions).catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [permissions, permissionsLoaded]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    loadFontSize();
    if (settings.reducedMotion) document.documentElement.classList.add('reduce-motion');
    if (settings.enhancedFocus) document.documentElement.classList.add('enhanced-focus');
    if (settings.highContrast) document.documentElement.classList.add('high-contrast');
    // Mount-only: apply persisted accessibility settings on init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSetting = (key: string, value: string | boolean | number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <GeneralSettings
            settings={settings}
            updateSetting={updateSetting}
            setSettings={setSettings}
          />
        );
      case 'explorer':
        return <ExplorerSettings settings={settings} updateSetting={updateSetting} />;
      case 'file-associations':
        return <FileAssociationsSettings />;
      case 'context-menu':
        return <ContextMenuRulesCard />;
      case 'ai':
        return (
          <AISettings
            agentSettings={agentSettings}
            updateAgentSetting={updateAgentSetting}
            setAgentSettings={setAgentSettings}
            apiKeyInput={apiKeyInput}
            setApiKeyInput={setApiKeyInput}
            openaiKeyInput={openaiKeyInput}
            setOpenaiKeyInput={setOpenaiKeyInput}
            settings={settings}
            updateSetting={updateSetting}
          />
        );
      case 'permissions':
        return (
          <PermissionsSettings
            permissions={permissions}
            setPermissions={setPermissions}
            agentSettings={agentSettings}
          />
        );
      case 'indexing':
        return (
          <div className="px-4 py-2">
            <TokenizerSettings />
          </div>
        );
      case 'shortcuts':
        return <ShortcutsSettingsPanel />;
      case 'marketplace':
        return (
          <MarketplaceSettings
            autoUpdateExtensions={autoUpdateExtensions}
            setAutoUpdateExtensions={setAutoUpdateExtensions}
            t={t}
          />
        );
      case 'accessibility':
        return <AccessibilitySettings settings={settings} updateSetting={updateSetting} />;
      case 'backup':
        return <BackupRestoreSettings />;
      case 'audit':
        return <AuditLogSettings />;
      case 'versioning':
        return <VersioningSettings />;
      case 'about':
        return (
          <div className="space-y-6 px-4 py-2">
            <div className="border-xp-border rounded-lg border p-6 text-center">
              <h2 className="text-xp-text mb-1 text-2xl font-bold">Xplorer</h2>
              <p className="text-xp-text-muted text-sm">v1.0.0-alpha.1</p>
              <p className="text-xp-text-secondary mt-3 text-sm">
                {t('settings.about.description')}
              </p>
            </div>

            <div className="border-xp-border rounded-lg border p-4">
              <h3 className="text-xp-text mb-3 text-sm font-semibold">
                {t('settings.about.links')}
              </h3>
              <div className="space-y-2">
                <button
                  onClick={() => TauriAPI.openUrl('https://github.com/kimlimjustin/xplorer')}
                  className="text-xp-text hover:bg-xp-surface-light flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors"
                >
                  <Github size={18} className="text-xp-text-muted" />
                  <span className="text-sm">GitHub Repository</span>
                  <ExternalLink size={14} className="text-xp-text-muted ml-auto" />
                </button>
                <button
                  onClick={() => TauriAPI.openUrl('https://xplorer.space')}
                  className="text-xp-text hover:bg-xp-surface-light flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors"
                >
                  <ExternalLink size={18} className="text-xp-text-muted" />
                  <span className="text-sm">xplorer.space</span>
                  <ExternalLink size={14} className="text-xp-text-muted ml-auto" />
                </button>
              </div>
            </div>

            <div className="border-xp-blue/30 bg-xp-blue/5 rounded-lg border p-5">
              <div className="flex items-start gap-3">
                <Heart size={20} className="text-xp-blue mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-xp-text text-sm font-semibold">
                    {t('settings.about.sponsorTitle')}
                  </h3>
                  <p className="text-xp-text-secondary mt-1 text-sm leading-relaxed">
                    {t('settings.about.sponsorDescription')}
                  </p>
                  <button
                    onClick={() => TauriAPI.openUrl('https://github.com/sponsors/kimlimjustin')}
                    className="bg-xp-blue hover:bg-xp-blue/80 mt-3 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
                  >
                    <Heart size={14} />
                    {t('settings.about.sponsorButton')}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xp-text-muted text-center text-xs">{t('settings.about.license')}</p>
          </div>
        );
    }
  };

  return (
    <div className="bg-xp-bg text-xp-text flex min-h-screen flex-col">
      {/* Header */}
      <div className="border-xp-border/50 bg-xp-bg/80 shrink-0 border-b backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <button
            onClick={() => setLocation('/')}
            className="text-xp-text-secondary hover:bg-xp-surface hover:text-xp-text flex h-8 w-8 items-center justify-center rounded-md transition-colors"
            title={t('settings.backToApp')}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xp-text text-lg font-semibold leading-tight">
              {t('settings.title')}
            </h1>
            <p className="text-xp-text-secondary text-xs">{t('settings.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Body: Sidebar + Content */}
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto flex h-full max-w-6xl">
          {/* Sidebar */}
          <nav className="border-xp-border/50 w-56 shrink-0 overflow-y-auto border-r px-3 py-4">
            <div className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                      isActive
                        ? 'bg-xp-accent/15 text-xp-accent'
                        : 'text-xp-text-secondary hover:bg-xp-surface hover:text-xp-text'
                    }`}
                  >
                    <Icon size={18} className={isActive ? 'text-xp-accent' : ''} />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm font-medium ${isActive ? 'text-xp-accent' : ''}`}
                      >
                        {tab.label}
                      </div>
                      <div className="text-xp-text-secondary/60 truncate text-[10px]">
                        {tab.description}
                      </div>
                    </div>
                    {isActive && <ChevronRight size={14} className="text-xp-accent/60 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content */}
          <main className="flex-1 overflow-y-auto px-2 py-4">
            <div className="max-w-2xl">
              {/* Tab heading */}
              <div className="mb-4 px-4">
                <h2 className="text-xp-text text-xl font-semibold">
                  {tabs.find((t) => t.id === activeTab)?.label}
                </h2>
                <p className="text-xp-text-secondary mt-0.5 text-sm">
                  {tabs.find((t) => t.id === activeTab)?.description}
                </p>
              </div>

              {/* Settings content */}
              {renderTabContent()}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default Settings;
