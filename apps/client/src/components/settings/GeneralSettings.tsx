import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import {
  Palette,
  Globe,
  Type,
  Sparkles,
  PanelLeft,
  Bell,
  Save,
  HelpCircle,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { startTour, resetTourCompleted } from '@/hooks/use-tour';
import { resetBetaWarning } from '@/components/dialogs/BetaWarningDialog';
import { applyFontSize } from '@/lib/utils';
import { useAllThemes } from '@/lib/theme-registry';
import {
  Toggle,
  SelectField,
  SettingRow,
  SectionTitle,
  Divider,
  SystemIntegrationSettings,
  type AppSettings,
  DEFAULT_SETTINGS,
} from './shared';

interface GeneralSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
  setSettings: (s: AppSettings) => void;
}

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'id', label: 'Bahasa Indonesia' },
];

const GeneralSettings = ({ settings, updateSetting, setSettings }: GeneralSettingsProps) => {
  const [, setLocation] = useLocation();
  const { t, i18n } = useTranslation();
  const allThemes = useAllThemes();

  const themes = Object.entries(allThemes).map(([key, th]) => ({
    value: key,
    label: th.name,
  }));

  const fontSizes = [
    { value: 'small', label: t('settings.general.small') },
    { value: 'medium', label: t('settings.general.medium') },
    { value: 'large', label: t('settings.general.large') },
    { value: 'xl', label: t('settings.general.extraLarge') },
  ];

  const sidebarWidths = [
    { value: 'narrow', label: t('settings.general.narrow') },
    { value: 'medium', label: t('settings.general.medium') },
    { value: 'wide', label: t('settings.general.wide') },
  ];

  return (
    <div className="space-y-1">
      <SectionTitle title={t('settings.general.appearance')} />
      <SettingRow
        icon={Palette}
        label={t('settings.general.theme')}
        description={t('settings.general.themeDesc')}
      >
        <SelectField
          label={t('settings.general.theme')}
          value={settings.theme}
          onChange={(v) => updateSetting('theme', v)}
          options={themes}
        />
      </SettingRow>
      <SettingRow
        icon={Globe}
        label={t('settings.general.language')}
        description={t('settings.general.languageDesc')}
      >
        <SelectField
          label={t('settings.general.language')}
          value={settings.language || i18n.language?.split('-')[0] || 'en'}
          onChange={(v) => {
            updateSetting('language', v);
            i18n.changeLanguage(v);
          }}
          options={languageOptions}
        />
      </SettingRow>
      <SettingRow
        icon={Type}
        label={t('settings.general.fontSize')}
        description={t('settings.general.fontSizeDesc')}
      >
        <SelectField
          label={t('settings.general.fontSize')}
          value={settings.fontSize}
          onChange={(v) => {
            updateSetting('fontSize', v);
            applyFontSize(v as 'small' | 'medium' | 'large' | 'xl');
          }}
          options={fontSizes}
        />
      </SettingRow>
      <SettingRow
        icon={Sparkles}
        label={t('settings.general.animations')}
        description={t('settings.general.animationsDesc')}
      >
        <Toggle
          id="animations"
          label={t('settings.general.animations')}
          checked={settings.enableAnimations}
          onChange={(v) => updateSetting('enableAnimations', v)}
        />
      </SettingRow>

      <Divider />
      <SectionTitle title={t('settings.general.layout')} />
      <SettingRow
        icon={PanelLeft}
        label={t('settings.general.sidebarWidth')}
        description={t('settings.general.sidebarWidthDesc')}
      >
        <SelectField
          label={t('settings.general.sidebarWidth')}
          value={settings.sidebarWidth}
          onChange={(v) => updateSetting('sidebarWidth', v)}
          options={sidebarWidths}
        />
      </SettingRow>

      <Divider />
      <SectionTitle title={t('settings.general.system')} />
      <SettingRow
        icon={Bell}
        label={t('settings.general.notifications')}
        description={t('settings.general.notificationsDesc')}
      >
        <Toggle
          id="notifications"
          label={t('settings.general.notifications')}
          checked={settings.enableNotifications}
          onChange={(v) => updateSetting('enableNotifications', v)}
        />
      </SettingRow>
      <SettingRow
        icon={Save}
        label={t('settings.general.autoSave')}
        description={t('settings.general.autoSaveDesc')}
      >
        <Toggle
          id="autoSave"
          label={t('settings.general.autoSave')}
          checked={settings.autoSave}
          onChange={(v) => updateSetting('autoSave', v)}
        />
      </SettingRow>

      <Divider />
      <SectionTitle title={t('settings.general.systemIntegration')} />
      <SystemIntegrationSettings />

      <Divider />
      <SectionTitle title={t('settings.general.help')} />
      <SettingRow
        icon={HelpCircle}
        label={t('settings.general.onboardingTour')}
        description={t('settings.general.onboardingTourDesc')}
      >
        <button
          onClick={() => {
            resetTourCompleted();
            setLocation('/');
            setTimeout(() => startTour(), 300);
          }}
          className="bg-xp-blue flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {t('settings.general.replayTour')}
        </button>
      </SettingRow>
      <SettingRow
        icon={AlertTriangle}
        label={t('settings.general.betaWarning')}
        description={t('settings.general.betaWarningDesc')}
      >
        <button
          onClick={() => {
            resetBetaWarning();
            setLocation('/');
          }}
          className="flex items-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {t('settings.general.showWarning')}
        </button>
      </SettingRow>

      <Divider />
      <div className="px-4 pt-4">
        <button
          onClick={() => setSettings(DEFAULT_SETTINGS)}
          className="text-xp-red hover:bg-xp-red/10 flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors"
        >
          <RotateCcw size={14} />
          {t('settings.resetAll')}
        </button>
      </div>
    </div>
  );
};

export default GeneralSettings;
