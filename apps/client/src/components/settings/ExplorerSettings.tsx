import { useTranslation } from 'react-i18next';
import { LayoutGrid, Eye, FileText, FolderOpen } from 'lucide-react';
import { Toggle, SelectField, SettingRow, SectionTitle, Divider, type AppSettings } from './shared';

interface ExplorerSettingsProps {
  settings: AppSettings;
  updateSetting: (key: string, value: string | boolean | number) => void;
}

const ExplorerSettings = ({ settings, updateSetting }: ExplorerSettingsProps) => {
  const { t } = useTranslation();

  const viewModes = [
    { value: 'grid', label: t('settings.explorer.grid') },
    { value: 'list', label: t('settings.explorer.list') },
    { value: 'details', label: t('settings.explorer.details') },
  ];

  return (
    <div className="space-y-1">
      <SectionTitle title={t('settings.explorer.display')} />
      <SettingRow
        icon={LayoutGrid}
        label={t('settings.explorer.defaultView')}
        description={t('settings.explorer.defaultViewDesc')}
      >
        <SelectField
          label={t('settings.explorer.defaultView')}
          value={settings.defaultView}
          onChange={(v) => updateSetting('defaultView', v)}
          options={viewModes}
        />
      </SettingRow>
      <SettingRow
        icon={Eye}
        label={t('settings.explorer.showHidden')}
        description={t('settings.explorer.showHiddenDesc')}
      >
        <Toggle
          id="hiddenFiles"
          label={t('settings.explorer.showHidden')}
          checked={settings.showHiddenFiles}
          onChange={(v) => updateSetting('showHiddenFiles', v)}
        />
      </SettingRow>
      <SettingRow
        icon={FileText}
        label={t('settings.explorer.fileExtensions')}
        description={t('settings.explorer.fileExtensionsDesc')}
      >
        <Toggle
          id="fileExtensions"
          label={t('settings.explorer.fileExtensions')}
          checked={settings.showFileExtensions}
          onChange={(v) => updateSetting('showFileExtensions', v)}
        />
      </SettingRow>
      <SettingRow
        icon={FolderOpen}
        label={t('settings.explorer.autoFolderSizes')}
        description={t('settings.explorer.autoFolderSizesDesc')}
      >
        <Toggle
          id="autoFolderSizes"
          label={t('settings.explorer.autoFolderSizes')}
          checked={settings.autoCalculateFolderSizes}
          onChange={(v) => updateSetting('autoCalculateFolderSizes', v)}
        />
      </SettingRow>

      <Divider />
      <SectionTitle title={t('settings.explorer.preview')} />
      <SettingRow
        icon={FileText}
        label={t('settings.explorer.markdownPreview')}
        description={t('settings.explorer.markdownPreviewDesc')}
      >
        <Toggle
          id="markdownPreview"
          label={t('settings.explorer.markdownPreview')}
          checked={settings.enableMarkdownPreview}
          onChange={(v) => updateSetting('enableMarkdownPreview', v)}
        />
      </SettingRow>
    </div>
  );
};

export default ExplorerSettings;
