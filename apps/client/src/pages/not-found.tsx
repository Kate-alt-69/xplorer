import { useTranslation } from 'react-i18next';

const NotFound = () => {
  const { t } = useTranslation();

  return (
    <div className="bg-xp-bg flex min-h-screen w-full items-center justify-center">
      <div className="bg-xp-surface border-xp-border mx-4 w-full max-w-md rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl" role="img" aria-label="error">
            !
          </span>
          <h1 className="text-xp-text text-2xl font-bold">{t('pages.notFound.title')}</h1>
        </div>

        <p className="text-xp-text-secondary mt-4 text-sm">{t('pages.notFound.hint')}</p>
      </div>
    </div>
  );
};

export default NotFound;
