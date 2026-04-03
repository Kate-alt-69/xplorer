import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Pencil, RotateCcw, X, Check } from 'lucide-react';
import {
  getContextMenuRules,
  createRule,
  updateRule,
  deleteRule,
  resetRules,
  getAvailableMenuItems,
  type ContextMenuRule,
  type RuleMatcher,
} from '@/lib/context-menu-rules';
import { SectionTitle, Divider } from './shared';

// ── Toggle (local, matching shared.tsx style) ──────────────────────

const RuleToggle = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    className={`focus-visible:ring-xp-accent relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 ${
      checked ? 'bg-xp-accent' : 'bg-xp-border'
    }`}
    onClick={() => onChange(!checked)}
  >
    <span
      className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
        checked ? 'translate-x-4' : 'translate-x-0.5'
      }`}
    />
  </button>
);

// ── Condition label helpers ────────────────────────────────────────

type TFunction = (key: string, options?: Record<string, unknown>) => string;

const conditionLabel = (c: ContextMenuRule['condition'], t: TFunction): string => {
  return c === 'show_only_for'
    ? t('settings.contextMenuRules.showOnlyFor')
    : t('settings.contextMenuRules.hideFor');
};

const matcherLabel = (m: RuleMatcher, t: TFunction): string => {
  switch (m.type) {
    case 'extension':
      return t('settings.contextMenuRules.matcherExtensions', { value: m.value });
    case 'file_type':
      return t('settings.contextMenuRules.matcherType', { value: m.value });
    case 'name_pattern':
      return t('settings.contextMenuRules.matcherNamePattern', { value: m.value });
    case 'is_directory':
      return m.value === 'true'
        ? t('settings.contextMenuRules.matcherDirectories')
        : t('settings.contextMenuRules.matcherFiles');
  }
};

// ── Inline rule editor form ────────────────────────────────────────

interface RuleFormData {
  menuItemId: string;
  condition: 'show_only_for' | 'hide_for';
  matcherType: RuleMatcher['type'];
  matcherValue: string;
}

const INITIAL_FORM: RuleFormData = {
  menuItemId: 'compress',
  condition: 'show_only_for',
  matcherType: 'extension',
  matcherValue: '',
};

const RuleForm = React.memo(
  ({
    initial,
    onSave,
    onCancel,
  }: {
    initial?: RuleFormData;
    onSave: (data: RuleFormData) => void;
    onCancel: () => void;
  }) => {
    const { t } = useTranslation();
    const [form, setForm] = useState<RuleFormData>(initial || INITIAL_FORM);
    const menuItems = getAvailableMenuItems();

    const handleSave = () => {
      if (!form.matcherValue.trim() && form.matcherType !== 'is_directory') return;
      onSave(form);
    };

    const placeholders: Record<RuleMatcher['type'], string> = {
      extension: '.jpg,.png,.gif',
      file_type: 'image/*',
      name_pattern: 'readme*',
      is_directory: 'true',
    };

    return (
      <div className="border-xp-border bg-xp-surface/50 space-y-3 rounded-lg border p-3">
        {/* Menu item selector */}
        <div>
          <label className="text-xp-text-secondary mb-1 block text-xs font-medium">
            {t('settings.contextMenuRules.menuItemLabel')}
          </label>
          <select
            value={form.menuItemId}
            onChange={(e) => setForm((f) => ({ ...f, menuItemId: e.target.value }))}
            className="border-xp-border bg-xp-bg text-xp-text focus:border-xp-accent h-8 w-full rounded border px-2 text-sm focus:outline-none"
          >
            {menuItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {/* Condition */}
        <div>
          <label className="text-xp-text-secondary mb-1 block text-xs font-medium">
            {t('settings.contextMenuRules.conditionLabel')}
          </label>
          <div className="flex gap-3">
            {(['show_only_for', 'hide_for'] as const).map((cond) => (
              <label
                key={cond}
                className="text-xp-text flex cursor-pointer items-center gap-1.5 text-sm"
              >
                <input
                  type="radio"
                  name="condition"
                  checked={form.condition === cond}
                  onChange={() => setForm((f) => ({ ...f, condition: cond }))}
                  className="accent-xp-accent"
                />
                {conditionLabel(cond, t)}
              </label>
            ))}
          </div>
        </div>

        {/* Matcher type + value */}
        <div className="flex gap-2">
          <div className="w-1/3">
            <label className="text-xp-text-secondary mb-1 block text-xs font-medium">
              {t('settings.contextMenuRules.matchByLabel')}
            </label>
            <select
              value={form.matcherType}
              onChange={(e) => {
                const type = e.target.value as RuleMatcher['type'];
                setForm((f) => ({
                  ...f,
                  matcherType: type,
                  matcherValue: type === 'is_directory' ? 'true' : f.matcherValue,
                }));
              }}
              className="border-xp-border bg-xp-bg text-xp-text focus:border-xp-accent h-8 w-full rounded border px-2 text-sm focus:outline-none"
            >
              <option value="extension">{t('settings.contextMenuRules.matchExtension')}</option>
              <option value="file_type">{t('settings.contextMenuRules.matchFileType')}</option>
              <option value="name_pattern">
                {t('settings.contextMenuRules.matchNamePattern')}
              </option>
              <option value="is_directory">
                {t('settings.contextMenuRules.matchIsDirectory')}
              </option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xp-text-secondary mb-1 block text-xs font-medium">
              {t('settings.contextMenuRules.valueLabel')}
            </label>
            {form.matcherType === 'is_directory' ? (
              <select
                value={form.matcherValue || 'true'}
                onChange={(e) => setForm((f) => ({ ...f, matcherValue: e.target.value }))}
                className="border-xp-border bg-xp-bg text-xp-text focus:border-xp-accent h-8 w-full rounded border px-2 text-sm focus:outline-none"
              >
                <option value="true">{t('settings.contextMenuRules.dirYes')}</option>
                <option value="false">{t('settings.contextMenuRules.dirNo')}</option>
              </select>
            ) : (
              <input
                type="text"
                value={form.matcherValue}
                onChange={(e) => setForm((f) => ({ ...f, matcherValue: e.target.value }))}
                placeholder={placeholders[form.matcherType]}
                className="border-xp-border bg-xp-bg text-xp-text focus:border-xp-accent h-8 w-full rounded border px-2 text-sm focus:outline-none"
              />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="text-xp-text-secondary hover:bg-xp-surface-light flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <X size={12} />
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!form.matcherValue.trim() && form.matcherType !== 'is_directory'}
            className="bg-xp-accent flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={12} />
            {t('common.save')}
          </button>
        </div>
      </div>
    );
  },
);
RuleForm.displayName = 'RuleForm';

// ── Rule list item ─────────────────────────────────────────────────

const RuleRow = React.memo(
  ({
    rule,
    onToggle,
    onEdit,
    onDelete,
  }: {
    rule: ContextMenuRule;
    onToggle: () => void;
    onEdit: () => void;
    onDelete: () => void;
  }) => {
    const { t } = useTranslation();
    return (
      <div className="hover:bg-xp-surface-light/50 group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors">
        <RuleToggle checked={rule.enabled} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="text-xp-text truncate text-sm">
            <span className="font-medium">{rule.menuItemLabel}</span>
            <span className="text-xp-text-secondary mx-1.5">—</span>
            <span className="text-xp-text-secondary">
              {conditionLabel(rule.condition, t)} {matcherLabel(rule.matcher, t)}
            </span>
          </div>
        </div>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onEdit}
            className="text-xp-text-secondary hover:text-xp-text hover:bg-xp-surface-light rounded p-1.5 transition-colors"
            title={t('settings.contextMenuRules.editRule')}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            className="text-xp-text-secondary hover:text-xp-red hover:bg-xp-red/10 rounded p-1.5 transition-colors"
            title={t('settings.contextMenuRules.deleteRule')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    );
  },
);
RuleRow.displayName = 'RuleRow';

// ── Main Component ─────────────────────────────────────────────────

const ContextMenuRulesCard = () => {
  const { t } = useTranslation();
  const [rules, setRules] = useState<ContextMenuRule[]>(() => getContextMenuRules());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const menuItemsMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of getAvailableMenuItems()) {
      map[item.id] = item.label;
    }
    return map;
  }, []);

  // Re-read rules from storage (in case another tab mutated them)
  const refreshRules = useCallback(() => {
    setRules(getContextMenuRules());
  }, []);

  const handleCreate = useCallback(
    (data: RuleFormData) => {
      createRule({
        menuItemId: data.menuItemId,
        menuItemLabel: menuItemsMap[data.menuItemId] || data.menuItemId,
        condition: data.condition,
        matcher: { type: data.matcherType, value: data.matcherValue.trim() },
        enabled: true,
      });
      refreshRules();
      setShowForm(false);
    },
    [menuItemsMap, refreshRules],
  );

  const handleUpdate = useCallback(
    (id: string, data: RuleFormData) => {
      updateRule(id, {
        menuItemId: data.menuItemId,
        menuItemLabel: menuItemsMap[data.menuItemId] || data.menuItemId,
        condition: data.condition,
        matcher: { type: data.matcherType, value: data.matcherValue.trim() },
      });
      refreshRules();
      setEditingId(null);
    },
    [menuItemsMap, refreshRules],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const rule = rules.find((r) => r.id === id);
      if (rule) {
        updateRule(id, { enabled: !rule.enabled });
        refreshRules();
      }
    },
    [rules, refreshRules],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteRule(id);
      refreshRules();
      if (editingId === id) setEditingId(null);
    },
    [editingId, refreshRules],
  );

  const handleReset = useCallback(() => {
    resetRules();
    refreshRules();
    setShowForm(false);
    setEditingId(null);
  }, [refreshRules]);

  return (
    <div className="space-y-1">
      <SectionTitle
        title={t('settings.contextMenuRules.title')}
        description={t('settings.contextMenuRules.description')}
      />

      {/* Existing rules */}
      {rules.length > 0 ? (
        <div className="space-y-0.5">
          {rules.map((rule) =>
            editingId === rule.id ? (
              <div key={rule.id} className="px-3 py-1">
                <RuleForm
                  initial={{
                    menuItemId: rule.menuItemId,
                    condition: rule.condition,
                    matcherType: rule.matcher.type,
                    matcherValue: rule.matcher.value,
                  }}
                  onSave={(data) => handleUpdate(rule.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() => handleToggle(rule.id)}
                onEdit={() => {
                  setEditingId(rule.id);
                  setShowForm(false);
                }}
                onDelete={() => handleDelete(rule.id)}
              />
            ),
          )}
        </div>
      ) : (
        <div className="px-4 py-6 text-center">
          <div className="text-xp-text-secondary text-sm">
            {t('settings.contextMenuRules.noRules')}
          </div>
          <div className="text-xp-text-secondary/60 mt-1 text-xs">
            {t('settings.contextMenuRules.noRulesHint')}
          </div>
        </div>
      )}

      {/* Add Rule form */}
      {showForm && (
        <div className="px-3 py-1">
          <RuleForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      <Divider />

      {/* Action buttons */}
      <div className="flex items-center justify-between px-4 py-2">
        {!showForm && (
          <button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
            }}
            className="bg-xp-accent flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} />
            {t('settings.contextMenuRules.addRule')}
          </button>
        )}
        {rules.length > 0 && (
          <button
            onClick={handleReset}
            className="text-xp-text-secondary hover:text-xp-text hover:bg-xp-surface-light flex items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors"
          >
            <RotateCcw size={14} />
            {t('settings.contextMenuRules.resetDefaults')}
          </button>
        )}
      </div>
    </div>
  );
};

export default ContextMenuRulesCard;
