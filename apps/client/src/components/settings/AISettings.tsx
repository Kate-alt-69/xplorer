import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Shield,
  Key,
  Cpu,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Brain,
  RotateCcw,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '@/components/ui/select';
import { type SafeAgentSettings } from '@/lib/agent-service';
import { Toggle, SettingRow, SectionTitle, Divider } from './shared';
import { STORAGE_KEYS } from '@/lib/storage-keys';

interface AISettingsProps {
  agentSettings: SafeAgentSettings;
  updateAgentSetting: <K extends keyof SafeAgentSettings>(
    key: K,
    value: SafeAgentSettings[K],
  ) => void;
  setAgentSettings: (s: SafeAgentSettings) => void;
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  openaiKeyInput: string;
  setOpenaiKeyInput: (v: string) => void;
}

const AISettings = ({
  agentSettings,
  updateAgentSetting,
  setAgentSettings,
  apiKeyInput,
  setApiKeyInput,
  openaiKeyInput,
  setOpenaiKeyInput,
}: AISettingsProps) => {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  const isNonAnthropicModel =
    agentSettings.model.startsWith('gpt-') ||
    agentSettings.model.startsWith('o1') ||
    agentSettings.model.startsWith('o3') ||
    agentSettings.model.startsWith('o4') ||
    agentSettings.model.startsWith('chatgpt-') ||
    agentSettings.model.startsWith('gemini-') ||
    agentSettings.model.startsWith('deepseek-') ||
    agentSettings.model.startsWith('mistral-') ||
    agentSettings.model.startsWith('codestral');

  const resolveThirdPartyKeyInfo = (): { label: string; desc: string } => {
    if (agentSettings.model.startsWith('gemini-')) {
      return { label: t('settings.ai.googleApiKey'), desc: t('settings.ai.googleApiKeyDesc') };
    }
    if (agentSettings.model.startsWith('deepseek-')) {
      return { label: t('settings.ai.deepseekApiKey'), desc: t('settings.ai.deepseekApiKeyDesc') };
    }
    if (agentSettings.model.startsWith('mistral-') || agentSettings.model.startsWith('codestral')) {
      return { label: t('settings.ai.mistralApiKey'), desc: t('settings.ai.mistralApiKeyDesc') };
    }
    return { label: t('settings.ai.openaiApiKey'), desc: t('settings.ai.openaiApiKeyDesc') };
  };
  const { label: thirdPartyKeyLabel, desc: thirdPartyKeyDesc } = resolveThirdPartyKeyInfo();

  return (
    <div className="space-y-1">
      <SectionTitle title={t('settings.ai.agent')} />
      <SettingRow
        icon={Bot}
        label={t('settings.ai.enableAgent')}
        description={t('settings.ai.enableAgentDesc')}
      >
        <Toggle
          id="agentEnabled"
          label={t('settings.ai.enableAgent')}
          checked={agentSettings.enabled}
          onChange={(v) => updateAgentSetting('enabled', v)}
        />
      </SettingRow>
      <SettingRow
        icon={Shield}
        label={t('settings.ai.autoApprove')}
        description={
          agentSettings.auto_approve
            ? t('settings.ai.autoApproveDescOn')
            : t('settings.ai.autoApproveDescOff')
        }
      >
        <Toggle
          id="autoApprove"
          label={t('settings.ai.autoApproveToggle')}
          checked={agentSettings.auto_approve}
          onChange={(v) => updateAgentSetting('auto_approve', v)}
        />
      </SettingRow>

      <Divider />
      <SectionTitle title={t('settings.ai.configuration')} />

      {/* Anthropic API Key */}
      <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
        <div className="mb-2 flex items-center gap-3">
          <Key size={18} className="text-xp-text-secondary shrink-0" />
          <div>
            <div className="text-xp-text text-sm font-medium">{t('settings.ai.apiKey')}</div>
            <div className="text-xp-text-secondary mt-0.5 text-xs">
              {t('settings.ai.apiKeyDesc')}
            </div>
          </div>
        </div>
        <div className="relative ml-[30px]">
          <input
            id="apiKey"
            type={showApiKey ? 'text' : 'password'}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={
              agentSettings.has_api_key ? `••••••••  (${t('settings.ai.keyIsSet')})` : 'sk-ant-...'
            }
            className="border-xp-border bg-xp-bg text-xp-text hover:border-xp-text-secondary focus:border-xp-accent focus:ring-xp-accent h-9 w-full rounded-md border px-3 pr-16 font-mono text-sm transition-colors focus:outline-none focus:ring-1"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="text-xp-text-secondary hover:text-xp-text hover:bg-xp-surface-light absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
          >
            {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            {showApiKey ? t('settings.ai.hideKey') : t('settings.ai.showKey')}
          </button>
        </div>
      </div>

      <SettingRow
        icon={Cpu}
        label={t('settings.ai.model')}
        description={t('settings.ai.modelDesc')}
      >
        <Select value={agentSettings.model} onValueChange={(v) => updateAgentSetting('model', v)}>
          <SelectTrigger className="h-9 min-w-[180px]" aria-label="AI Model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t('settings.ai.modelGroupAnthropic')}</SelectLabel>
              <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
              <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
              <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('settings.ai.modelGroupOpenAI')}</SelectLabel>
              <SelectItem value="gpt-4o">GPT-4o</SelectItem>
              <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
              <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
              <SelectItem value="gpt-4.1-mini">GPT-4.1 Mini</SelectItem>
              <SelectItem value="gpt-4.1-nano">GPT-4.1 Nano</SelectItem>
              <SelectItem value="o3-mini">o3-mini</SelectItem>
              <SelectItem value="o4-mini">o4-mini</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('settings.ai.modelGroupGoogle')}</SelectLabel>
              <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
              <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('settings.ai.modelGroupDeepSeek')}</SelectLabel>
              <SelectItem value="deepseek-chat">DeepSeek V3</SelectItem>
              <SelectItem value="deepseek-reasoner">DeepSeek R1</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('settings.ai.modelGroupMetaOllama')}</SelectLabel>
              <SelectItem value="llama3.3">Llama 3.3 70B</SelectItem>
              <SelectItem value="llama3.1">Llama 3.1 8B</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('settings.ai.modelGroupMistral')}</SelectLabel>
              <SelectItem value="mistral-large-latest">Mistral Large</SelectItem>
              <SelectItem value="mistral-small-latest">Mistral Small</SelectItem>
              <SelectItem value="codestral-latest">Codestral</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('settings.ai.modelGroupLocalOllama')}</SelectLabel>
              <SelectItem value="ollama:custom">Custom Ollama Model</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>

      {/* Third-party API Key — shows when a non-Anthropic model is selected */}
      {isNonAnthropicModel && (
        <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
          <div className="mb-2 flex items-center gap-3">
            <Key size={18} className="text-xp-text-secondary shrink-0" />
            <div>
              <div className="text-xp-text text-sm font-medium">{thirdPartyKeyLabel}</div>
              <div className="text-xp-text-secondary mt-0.5 text-xs">{thirdPartyKeyDesc}</div>
            </div>
          </div>
          <div className="relative ml-[30px]">
            <input
              type={showOpenaiKey ? 'text' : 'password'}
              value={openaiKeyInput}
              onChange={(e) => setOpenaiKeyInput(e.target.value)}
              placeholder={
                agentSettings.has_openai_api_key
                  ? `••••••••  (${t('settings.ai.keyIsSet')})`
                  : 'sk-...'
              }
              className="border-xp-border bg-xp-bg text-xp-text hover:border-xp-text-secondary focus:border-xp-accent focus:ring-xp-accent h-9 w-full rounded-md border px-3 pr-16 font-mono text-sm transition-colors focus:outline-none focus:ring-1"
            />
            <button
              type="button"
              onClick={() => setShowOpenaiKey(!showOpenaiKey)}
              className="text-xp-text-secondary hover:text-xp-text hover:bg-xp-surface-light absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
            >
              {showOpenaiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              {showOpenaiKey ? t('settings.ai.hideKey') : t('settings.ai.showKey')}
            </button>
          </div>
        </div>
      )}

      <Divider />
      <SectionTitle title={t('settings.ai.aiSearch')} />

      {/* OpenAI API Key for search */}
      <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
        <div className="mb-2 flex items-center gap-3">
          <Key size={18} className="text-xp-text-secondary shrink-0" />
          <div>
            <div className="text-xp-text text-sm font-medium">{t('settings.ai.openaiApiKey')}</div>
            <div className="text-xp-text-secondary mt-0.5 text-xs">
              {t('settings.ai.openaiApiKeySearchDesc')}
            </div>
          </div>
        </div>
        <div className="ml-[30px]">
          <input
            type="password"
            defaultValue={localStorage.getItem(STORAGE_KEYS.OPENAI_KEY) || ''}
            onChange={(e) => localStorage.setItem(STORAGE_KEYS.OPENAI_KEY, e.target.value)}
            placeholder="sk-..."
            className="border-xp-border bg-xp-bg text-xp-text hover:border-xp-text-secondary focus:border-xp-accent focus:ring-xp-accent h-9 w-full rounded-md border px-3 font-mono text-sm transition-colors focus:outline-none focus:ring-1"
          />
        </div>
      </div>

      {/* Ollama URL */}
      <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
        <div className="mb-2 flex items-center gap-3">
          <Cpu size={18} className="text-xp-text-secondary shrink-0" />
          <div>
            <div className="text-xp-text text-sm font-medium">
              {t('settings.ai.ollamaEndpoint')}
            </div>
            <div className="text-xp-text-secondary mt-0.5 text-xs">
              {t('settings.ai.ollamaEndpointDesc')}
            </div>
          </div>
        </div>
        <div className="ml-[30px]">
          <input
            type="text"
            defaultValue={localStorage.getItem(STORAGE_KEYS.OLLAMA_URL) || 'http://localhost:11434'}
            onChange={(e) => localStorage.setItem(STORAGE_KEYS.OLLAMA_URL, e.target.value)}
            placeholder="http://localhost:11434"
            className="border-xp-border bg-xp-bg text-xp-text hover:border-xp-text-secondary focus:border-xp-accent focus:ring-xp-accent h-9 w-full rounded-md border px-3 font-mono text-sm transition-colors focus:outline-none focus:ring-1"
          />
        </div>
      </div>

      <Divider />
      <SectionTitle title={t('settings.ai.agentSection')} />

      {/* Max Turns */}
      <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <SlidersHorizontal size={18} className="text-xp-text-secondary shrink-0" />
            <div>
              <div className="text-xp-text text-sm font-medium">{t('settings.ai.maxTurns')}</div>
              <div className="text-xp-text-secondary mt-0.5 text-xs">
                {t('settings.ai.maxTurnsDesc')}
              </div>
            </div>
          </div>
          <span className="text-xp-accent text-sm font-medium tabular-nums">
            {agentSettings.max_turns}
          </span>
        </div>
        <div className="ml-[30px] mt-2">
          <input
            id="maxTurns"
            type="range"
            min={5}
            max={50}
            value={agentSettings.max_turns}
            onChange={(e) => updateAgentSetting('max_turns', Number(e.target.value))}
            className="bg-xp-border accent-xp-accent [&::-webkit-slider-thumb]:bg-xp-accent h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md"
          />
          <div className="text-xp-text-secondary/60 mt-1 flex justify-between text-[10px]">
            <span>5</span>
            <span>50</span>
          </div>
        </div>
      </div>

      {/* Extended Thinking */}
      <SettingRow
        icon={Brain}
        label={t('settings.ai.extendedThinking')}
        description={t('settings.ai.extendedThinkingDesc')}
      >
        <Toggle
          id="thinkingEnabled"
          label={t('settings.ai.extendedThinking')}
          checked={agentSettings.thinking_enabled}
          onChange={(v) => updateAgentSetting('thinking_enabled', v)}
        />
      </SettingRow>

      {/* Thinking Budget — conditional */}
      {agentSettings.thinking_enabled && (
        <div className="hover:bg-xp-surface-light/50 rounded-lg px-4 py-3 transition-colors">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <SlidersHorizontal size={18} className="text-xp-text-secondary shrink-0" />
              <div>
                <div className="text-xp-text text-sm font-medium">
                  {t('settings.ai.thinkingBudget')}
                </div>
                <div className="text-xp-text-secondary mt-0.5 text-xs">
                  {t('settings.ai.thinkingBudgetDesc')}
                </div>
              </div>
            </div>
            <span className="text-xp-accent text-sm font-medium tabular-nums">
              {agentSettings.thinking_budget.toLocaleString()}
            </span>
          </div>
          <div className="ml-[30px] mt-2">
            <input
              type="range"
              min={5000}
              max={50000}
              step={5000}
              value={agentSettings.thinking_budget}
              onChange={(e) => updateAgentSetting('thinking_budget', Number(e.target.value))}
              className="bg-xp-border accent-xp-accent [&::-webkit-slider-thumb]:bg-xp-accent h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md"
            />
            <div className="text-xp-text-secondary/60 mt-1 flex justify-between text-[10px]">
              <span>5K</span>
              <span>50K</span>
            </div>
          </div>
        </div>
      )}

      <Divider />
      <div className="px-4 pt-2">
        <button
          onClick={() => {
            setAgentSettings({
              enabled: true,
              has_api_key: agentSettings.has_api_key,
              has_openai_api_key: agentSettings.has_openai_api_key,
              model: 'claude-sonnet-4-6',
              max_turns: 25,
              auto_approve: false,
              thinking_enabled: false,
              thinking_budget: 10000,
            });
          }}
          className="text-xp-text-secondary hover:text-xp-text hover:bg-xp-surface-light flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors"
        >
          <RotateCcw size={14} />
          {t('settings.ai.resetAgent')}
        </button>
      </div>
    </div>
  );
};

export default AISettings;
