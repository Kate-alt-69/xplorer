import { useTranslation } from 'react-i18next';
import { Globe, RotateCcw } from 'lucide-react';
import { type AgentPermissions, type SafeAgentSettings } from '@/lib/agent-service';
import { PermToggle, SectionTitle, Divider } from './shared';

interface PermissionsSettingsProps {
  permissions: AgentPermissions;
  setPermissions: (p: AgentPermissions) => void;
  agentSettings: SafeAgentSettings;
}

const READ_TOOL_NAMES = [
  'read_file',
  'list_directory',
  'search_files',
  'search_content',
  'get_system_info',
  'search_indexed',
  'extract_document_text',
  'recall',
] as const;

const WRITE_TOOL_NAMES = [
  'write_file',
  'create_directory',
  'rename',
  'delete',
  'move_file',
  'copy_file',
  'execute_command',
  'execute_plan',
] as const;

// Maps tool name -> { labelKey, descKey } in settings.permissions.tools
const TOOL_TRANSLATION_KEYS: Record<string, { labelKey: string; descKey: string }> = {
  read_file: {
    labelKey: 'settings.permissions.tools.readFile',
    descKey: 'settings.permissions.tools.readFileDesc',
  },
  list_directory: {
    labelKey: 'settings.permissions.tools.listDir',
    descKey: 'settings.permissions.tools.listDirDesc',
  },
  search_files: {
    labelKey: 'settings.permissions.tools.searchFiles',
    descKey: 'settings.permissions.tools.searchFilesDesc',
  },
  search_content: {
    labelKey: 'settings.permissions.tools.searchContent',
    descKey: 'settings.permissions.tools.searchContentDesc',
  },
  get_system_info: {
    labelKey: 'settings.permissions.tools.systemInfo',
    descKey: 'settings.permissions.tools.systemInfoDesc',
  },
  search_indexed: {
    labelKey: 'settings.permissions.tools.searchIndex',
    descKey: 'settings.permissions.tools.searchIndexDesc',
  },
  extract_document_text: {
    labelKey: 'settings.permissions.tools.extractText',
    descKey: 'settings.permissions.tools.extractTextDesc',
  },
  recall: {
    labelKey: 'settings.permissions.tools.recallMemory',
    descKey: 'settings.permissions.tools.recallMemoryDesc',
  },
  write_file: {
    labelKey: 'settings.permissions.tools.writeFile',
    descKey: 'settings.permissions.tools.writeFileDesc',
  },
  create_directory: {
    labelKey: 'settings.permissions.tools.createDir',
    descKey: 'settings.permissions.tools.createDirDesc',
  },
  rename: {
    labelKey: 'settings.permissions.tools.rename',
    descKey: 'settings.permissions.tools.renameDesc',
  },
  delete: {
    labelKey: 'settings.permissions.tools.delete',
    descKey: 'settings.permissions.tools.deleteDesc',
  },
  move_file: {
    labelKey: 'settings.permissions.tools.moveFile',
    descKey: 'settings.permissions.tools.moveFileDesc',
  },
  copy_file: {
    labelKey: 'settings.permissions.tools.copyFile',
    descKey: 'settings.permissions.tools.copyFileDesc',
  },
  execute_command: {
    labelKey: 'settings.permissions.tools.executeCommand',
    descKey: 'settings.permissions.tools.executeCommandDesc',
  },
  execute_plan: {
    labelKey: 'settings.permissions.tools.executePlan',
    descKey: 'settings.permissions.tools.executePlanDesc',
  },
};

const DEFAULT_PERMISSIONS: AgentPermissions = {
  disabled_tools: [],
  auto_approve_tools: [],
  allowed_paths: [],
  blocked_paths: [],
  custom_blocked_commands: [],
  block_internet: true,
};

const PermissionsSettings = ({
  permissions,
  setPermissions,
  agentSettings,
}: PermissionsSettingsProps) => {
  const { t } = useTranslation();

  const toggleTool = (toolName: string) => {
    setPermissions({
      ...permissions,
      disabled_tools: permissions.disabled_tools.includes(toolName)
        ? permissions.disabled_tools.filter((tool) => tool !== toolName)
        : [...permissions.disabled_tools, toolName],
    });
  };

  const toggleAutoApprove = (toolName: string) => {
    setPermissions({
      ...permissions,
      auto_approve_tools: permissions.auto_approve_tools.includes(toolName)
        ? permissions.auto_approve_tools.filter((tool) => tool !== toolName)
        : [...permissions.auto_approve_tools, toolName],
    });
  };

  const addToList = (
    field: 'allowed_paths' | 'blocked_paths' | 'custom_blocked_commands',
    value: string,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (permissions[field].includes(trimmed)) return;
    setPermissions({ ...permissions, [field]: [...permissions[field], trimmed] });
  };

  const removeFromList = (
    field: 'allowed_paths' | 'blocked_paths' | 'custom_blocked_commands',
    index: number,
  ) => {
    setPermissions({
      ...permissions,
      [field]: permissions[field].filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-1">
      {/* Internet Sandbox */}
      <SectionTitle title={t('settings.permissions.network')} />
      <div className="hover:bg-xp-surface-light/50 flex items-center justify-between gap-4 rounded-lg px-4 py-3 transition-colors">
        <div className="flex min-w-0 items-center gap-3">
          <Globe size={18} className="text-xp-text-secondary shrink-0" />
          <div className="min-w-0">
            <div className="text-xp-text text-sm font-medium">
              {t('settings.permissions.blockInternet')}
            </div>
            <div className="text-xp-text-secondary mt-0.5 text-xs leading-relaxed">
              {t('settings.permissions.blockInternetDesc')}
            </div>
          </div>
        </div>
        <PermToggle
          enabled={permissions.block_internet}
          onChange={() =>
            setPermissions({ ...permissions, block_internet: !permissions.block_internet })
          }
        />
      </div>

      <Divider />

      {/* Read Tools */}
      <SectionTitle
        title={t('settings.permissions.readTools')}
        description={t('settings.permissions.readToolsDesc')}
      />
      <div className="grid grid-cols-1 gap-0.5">
        {READ_TOOL_NAMES.map((toolName) => {
          const enabled = !permissions.disabled_tools.includes(toolName);
          const keys = TOOL_TRANSLATION_KEYS[toolName];
          return (
            <div
              key={toolName}
              className={`hover:bg-xp-surface-light/50 flex items-center justify-between gap-4 rounded-lg px-4 py-2.5 transition-colors ${!enabled ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0">
                <div className="text-xp-text flex items-center gap-2 text-sm font-medium">
                  <code className="bg-xp-surface text-xp-accent/80 rounded px-1.5 py-0.5 font-mono text-[11px]">
                    {toolName}
                  </code>
                  {t(keys.labelKey)}
                </div>
                <div className="text-xp-text-secondary mt-0.5 text-xs">{t(keys.descKey)}</div>
              </div>
              <PermToggle enabled={enabled} onChange={() => toggleTool(toolName)} />
            </div>
          );
        })}
      </div>

      <Divider />
      <SectionTitle
        title={t('settings.permissions.writeTools')}
        description={t('settings.permissions.writeToolsDesc')}
      />
      <div className="grid grid-cols-1 gap-0.5">
        {WRITE_TOOL_NAMES.map((toolName) => {
          const enabled = !permissions.disabled_tools.includes(toolName);
          const keys = TOOL_TRANSLATION_KEYS[toolName];
          return (
            <div
              key={toolName}
              className={`hover:bg-xp-surface-light/50 flex items-center justify-between gap-4 rounded-lg px-4 py-2.5 transition-colors ${!enabled ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0">
                <div className="text-xp-text flex items-center gap-2 text-sm font-medium">
                  <code className="bg-xp-surface text-xp-accent/80 rounded px-1.5 py-0.5 font-mono text-[11px]">
                    {toolName}
                  </code>
                  {t(keys.labelKey)}
                </div>
                <div className="text-xp-text-secondary mt-0.5 text-xs">{t(keys.descKey)}</div>
              </div>
              <PermToggle enabled={enabled} onChange={() => toggleTool(toolName)} />
            </div>
          );
        })}
      </div>

      {/* Per-tool auto-approve */}
      <Divider />
      <SectionTitle
        title={t('settings.permissions.autoApproveRules')}
        description={
          agentSettings.auto_approve
            ? t('settings.permissions.autoApproveGlobalOn')
            : t('settings.permissions.autoApproveGlobalOff')
        }
      />
      {agentSettings.auto_approve ? (
        <div className="text-xp-text-secondary px-4 py-2 text-xs italic">
          {t('settings.permissions.autoApproveGlobalNote')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-0.5">
          {WRITE_TOOL_NAMES.map((toolName) => {
            const isDisabled = permissions.disabled_tools.includes(toolName);
            if (isDisabled) return null;
            const autoApproved = permissions.auto_approve_tools.includes(toolName);
            const keys = TOOL_TRANSLATION_KEYS[toolName];
            return (
              <div
                key={toolName}
                className="hover:bg-xp-surface-light/50 flex items-center justify-between gap-4 rounded-lg px-4 py-2 transition-colors"
              >
                <div className="text-xp-text text-sm">{t(keys.labelKey)}</div>
                <PermToggle enabled={autoApproved} onChange={() => toggleAutoApprove(toolName)} />
              </div>
            );
          })}
        </div>
      )}

      {/* Allowed Paths */}
      <Divider />
      <SectionTitle
        title={t('settings.permissions.allowedPaths')}
        description={t('settings.permissions.allowedPathsDesc')}
      />
      <div className="space-y-2 px-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. D:\Projects"
            className="border-xp-border bg-xp-bg text-xp-text focus:border-xp-accent focus:ring-xp-accent h-8 flex-1 rounded-md border px-3 font-mono text-sm focus:outline-none focus:ring-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addToList('allowed_paths', e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <button
            onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              addToList('allowed_paths', input.value);
              input.value = '';
            }}
            className="bg-xp-accent h-8 rounded-md px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {t('common.add')}
          </button>
        </div>
        {permissions.allowed_paths.length > 0 && (
          <div className="space-y-1">
            {permissions.allowed_paths.map((p, i) => (
              <div
                key={p}
                className="bg-xp-surface text-xp-text flex items-center justify-between gap-2 rounded-md px-3 py-1.5 font-mono text-sm"
              >
                <span className="truncate">{p}</span>
                <button
                  onClick={() => removeFromList('allowed_paths', i)}
                  className="text-xp-text-secondary shrink-0 text-xs hover:text-red-400"
                >
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Blocked Paths */}
      <Divider />
      <SectionTitle
        title={t('settings.permissions.blockedPaths')}
        description={t('settings.permissions.blockedPathsDesc')}
      />
      <div className="space-y-2 px-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. D:\Secrets"
            className="border-xp-border bg-xp-bg text-xp-text focus:border-xp-accent focus:ring-xp-accent h-8 flex-1 rounded-md border px-3 font-mono text-sm focus:outline-none focus:ring-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addToList('blocked_paths', e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <button
            onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              addToList('blocked_paths', input.value);
              input.value = '';
            }}
            className="bg-xp-accent h-8 rounded-md px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {t('common.add')}
          </button>
        </div>
        {permissions.blocked_paths.length > 0 && (
          <div className="space-y-1">
            {permissions.blocked_paths.map((p, i) => (
              <div
                key={p}
                className="bg-xp-surface text-xp-text flex items-center justify-between gap-2 rounded-md px-3 py-1.5 font-mono text-sm"
              >
                <span className="truncate">{p}</span>
                <button
                  onClick={() => removeFromList('blocked_paths', i)}
                  className="text-xp-text-secondary shrink-0 text-xs hover:text-red-400"
                >
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Blocked Commands */}
      <Divider />
      <SectionTitle
        title={t('settings.permissions.customBlockedCommands')}
        description={t('settings.permissions.customBlockedCommandsDesc')}
      />
      <div className="space-y-2 px-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. npm"
            className="border-xp-border bg-xp-bg text-xp-text focus:border-xp-accent focus:ring-xp-accent h-8 flex-1 rounded-md border px-3 font-mono text-sm focus:outline-none focus:ring-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addToList('custom_blocked_commands', e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <button
            onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              addToList('custom_blocked_commands', input.value);
              input.value = '';
            }}
            className="bg-xp-accent h-8 rounded-md px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {t('common.add')}
          </button>
        </div>
        {permissions.custom_blocked_commands.length > 0 && (
          <div className="space-y-1">
            {permissions.custom_blocked_commands.map((c, i) => (
              <div
                key={c}
                className="bg-xp-surface text-xp-text flex items-center justify-between gap-2 rounded-md px-3 py-1.5 font-mono text-sm"
              >
                <span className="truncate">{c}</span>
                <button
                  onClick={() => removeFromList('custom_blocked_commands', i)}
                  className="text-xp-text-secondary shrink-0 text-xs hover:text-red-400"
                >
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reset */}
      <Divider />
      <div className="px-4 pt-2">
        <button
          onClick={() => setPermissions(DEFAULT_PERMISSIONS)}
          className="text-xp-text-secondary hover:text-xp-text hover:bg-xp-surface-light flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors"
        >
          <RotateCcw size={14} />
          {t('settings.permissions.resetDefaults')}
        </button>
      </div>
    </div>
  );
};

export default PermissionsSettings;
