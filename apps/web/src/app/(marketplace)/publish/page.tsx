'use client';

import { Terminal, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

const PublishPage = () => {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10">
        <Terminal className="h-8 w-8 text-brand-500" />
      </div>
      <h1 className="mb-3 text-3xl font-bold">Publish via CLI</h1>
      <p className="mx-auto mb-8 max-w-md text-gray-500 dark:text-gray-400">
        Extensions are now published through the Xplorer CLI for a better developer experience.
      </p>

      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-6 text-left dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
            1
          </span>
          <div>
            <p className="font-medium">Install the CLI</p>
            <code className="mt-1 block rounded bg-gray-100 px-2 py-1 text-sm dark:bg-gray-800">
              npm i -g @xplorer/cli
            </code>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
            2
          </span>
          <div>
            <p className="font-medium">Login to your account</p>
            <code className="mt-1 block rounded bg-gray-100 px-2 py-1 text-sm dark:bg-gray-800">
              xplorer login
            </code>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
            3
          </span>
          <div>
            <p className="font-medium">Publish from your extension directory</p>
            <code className="mt-1 block rounded bg-gray-100 px-2 py-1 text-sm dark:bg-gray-800">
              cd my-extension && xplorer publish
            </code>
          </div>
        </div>
      </div>

      <a
        href="/docs/extensions/getting-started"
        className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-brand-500 hover:text-brand-600"
      >
        Read the extension docs
        <ArrowRight className="h-4 w-4" />
      </a>
    </div>
  );
};

export default PublishPage;
