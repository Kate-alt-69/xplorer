import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Heart, X, ExternalLink } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const BETA_DISMISSED_KEY = STORAGE_KEYS.BETA_WARNING_DISMISSED;
const SPONSOR_URL = 'https://github.com/sponsors/kimlimjustin';

export const isBetaWarningDismissed = (): boolean => {
  return localStorage.getItem(BETA_DISMISSED_KEY) === 'true';
};

export const resetBetaWarning = () => {
  localStorage.removeItem(BETA_DISMISSED_KEY);
};

const BetaWarningDialog = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isBetaWarningDismissed()) {
      const timer = setTimeout(() => setIsOpen(true), 400);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!isOpen) return null;

  const handleDismiss = () => {
    localStorage.setItem(BETA_DISMISSED_KEY, 'true');
    setIsOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm duration-200 animate-in fade-in">
      <div className="bg-xp-bg border-xp-border relative mx-4 w-full max-w-md overflow-hidden rounded-xl border shadow-2xl">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="text-xp-muted hover:text-xp-text hover:bg-xp-hover absolute right-3 top-3 rounded-md p-1 transition-colors"
          aria-label={t('common.close')}
        >
          <X size={16} />
        </button>

        {/* Warning header */}
        <div className="px-6 pb-4 pt-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-xp-text text-lg font-semibold">{t('dialogs.beta.title')}</h2>
              <p className="text-xp-muted text-xs">{t('dialogs.beta.subtitle')}</p>
            </div>
          </div>

          <div className="text-xp-muted space-y-3 text-sm leading-relaxed">
            <p>{t('dialogs.beta.intro')}</p>
            <ul className="ml-1 space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-500">•</span>
                {t('dialogs.beta.bullet1')}
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-500">•</span>
                {t('dialogs.beta.bullet2')}
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-500">•</span>
                <span>{t('dialogs.beta.bullet3')}</span>
              </li>
            </ul>
            <p className="text-xs">
              {t('dialogs.beta.bugReport')}{' '}
              <a
                href="https://github.com/kimlimjustin/xplorer/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xp-blue hover:underline"
              >
                {t('dialogs.beta.githubIssues')}
              </a>
              .
            </p>
          </div>
        </div>

        {/* Sponsor section */}
        <div className="mx-6 mb-4 rounded-lg border border-pink-500/20 bg-pink-500/5 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <Heart className="h-4 w-4 text-pink-500" />
            <span className="text-xp-text text-sm font-medium">
              {t('dialogs.beta.supportTitle')}
            </span>
          </div>
          <p className="text-xp-muted mb-2.5 text-xs">{t('dialogs.beta.supportDesc')}</p>
          <a
            href={SPONSOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-pink-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-pink-600"
          >
            <Heart size={12} />
            {t('dialogs.beta.becomeSponsor')}
            <ExternalLink size={10} />
          </a>
        </div>

        {/* Footer */}
        <div className="bg-xp-hover/50 border-xp-border flex items-center justify-between border-t px-6 py-3">
          <span className="text-xp-muted text-xs">{t('dialogs.beta.showAgainHint')}</span>
          <button
            onClick={handleDismiss}
            className="bg-xp-blue rounded-md px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            {t('dialogs.beta.iUnderstand')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BetaWarningDialog;
