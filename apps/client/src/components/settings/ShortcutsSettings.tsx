import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from 'lucide-react';
import KeyboardShortcutsSettings from '@/components/KeyboardShortcutsSettings';
import {
  isVimModeEnabled,
  setVimModeSetting,
  isVimLearningModeEnabled,
  setVimLearningModeSetting,
} from '@/hooks/use-vim-mode';
import { Toggle, SettingRow, SectionTitle, Divider } from './shared';

const ShortcutsSettingsPanel = () => {
  const { t } = useTranslation();
  const [vimModeEnabled, setVimModeEnabledState] = useState(() => isVimModeEnabled());
  const [vimLearningMode, setVimLearningModeState] = useState(() => isVimLearningModeEnabled());

  const handleVimModeToggle = (v: boolean) => {
    setVimModeEnabledState(v);
    setVimModeSetting(v);
  };

  const handleVimLearningModeToggle = (v: boolean) => {
    setVimLearningModeState(v);
    setVimLearningModeSetting(v);
  };

  return (
    <div className="space-y-1">
      <SectionTitle title={t('settings.shortcuts.inputMode')} />
      <SettingRow
        icon={Keyboard}
        label={t('settings.shortcuts.vimMode')}
        description={t('settings.shortcuts.vimModeDesc')}
      >
        <Toggle id="vimMode" checked={vimModeEnabled} onChange={handleVimModeToggle} />
      </SettingRow>
      {vimModeEnabled && (
        <>
          <SettingRow
            icon={Keyboard}
            label={t('settings.shortcuts.vimLearningMode')}
            description={t('settings.shortcuts.vimLearningModeDesc')}
          >
            <Toggle
              id="vimLearningMode"
              label={t('settings.shortcuts.vimLearningMode')}
              checked={vimLearningMode}
              onChange={handleVimLearningModeToggle}
            />
          </SettingRow>
          <div className="bg-xp-surface-light/50 text-xp-text-secondary mx-4 mb-2 space-y-1 rounded-md p-3 text-xs leading-relaxed">
            <div className="text-xp-text mb-1.5 text-sm font-medium">
              {t('settings.shortcuts.vimKeyBindings')}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">j</kbd> /{' '}
                <kbd className="bg-xp-bg rounded px-1 font-mono">k</kbd>{' '}
                {t('settings.shortcuts.vimMoveUpDown')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">h</kbd>{' '}
                {t('settings.shortcuts.vimGoParent')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">l</kbd> /{' '}
                <kbd className="bg-xp-bg rounded px-1 font-mono">Enter</kbd>{' '}
                {t('settings.shortcuts.vimOpenEnter')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">gg</kbd>{' '}
                {t('settings.shortcuts.vimFirstFile')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">G</kbd>{' '}
                {t('settings.shortcuts.vimLastFile')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">/</kbd>{' '}
                {t('settings.shortcuts.vimFocusSearch')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">:</kbd>{' '}
                {t('settings.shortcuts.vimCommandPalette')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">i</kbd>{' '}
                {t('settings.shortcuts.vimInsertMode')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">dd</kbd>{' '}
                {t('settings.shortcuts.vimDelete')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">yy</kbd>{' '}
                {t('settings.shortcuts.vimCopy')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">p</kbd>{' '}
                {t('settings.shortcuts.vimPaste')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">v</kbd>{' '}
                {t('settings.shortcuts.vimVisualMode')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">V</kbd>{' '}
                {t('settings.shortcuts.vimSelectRange')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">o</kbd>{' '}
                {t('settings.shortcuts.vimOpenDefault')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">r</kbd>{' '}
                {t('settings.shortcuts.vimRename')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">m</kbd>{' '}
                {t('settings.shortcuts.vimBookmark')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">.</kbd>{' '}
                {t('settings.shortcuts.vimRepeatLast')}
              </span>
              <span>
                <kbd className="bg-xp-bg rounded px-1 font-mono">Esc</kbd>{' '}
                {t('settings.shortcuts.vimClearExit')}
              </span>
            </div>
          </div>
        </>
      )}
      <Divider />
      <SectionTitle title={t('settings.shortcuts.keyBindings')} />
      <div className="px-4 py-2">
        <KeyboardShortcutsSettings />
      </div>
    </div>
  );
};

export default ShortcutsSettingsPanel;
