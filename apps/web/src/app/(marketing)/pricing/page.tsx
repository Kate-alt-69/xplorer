import type { Metadata } from 'next';
import { Clock, Heart } from 'lucide-react';
import { SITE_NAME } from '@/lib/constants';

const SPONSOR_URL = 'https://github.com/sponsors/kimlimjustin';

export const metadata: Metadata = {
  title: `Pricing | ${SITE_NAME}`,
  description: 'Xplorer pricing plans - Coming soon.',
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 lg:px-8">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10">
        <Clock className="h-8 w-8 text-brand-500" />
      </div>
      <h1 className="mb-4 text-4xl font-bold text-gray-900 dark:text-white">Pricing Coming Soon</h1>
      <p className="mx-auto mb-8 max-w-xl text-lg text-gray-500 dark:text-gray-400">
        Xplorer is currently <strong>free and open source</strong>. Pro plans with premium features
        are being designed and will launch soon.
      </p>

      <div className="mx-auto mb-12 max-w-md rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-3 text-lg font-semibold">What&apos;s free today</h3>
        <ul className="space-y-2 text-left text-sm text-gray-600 dark:text-gray-400">
          <li className="flex items-center gap-2">✓ Full file management</li>
          <li className="flex items-center gap-2">✓ AI chat assistant</li>
          <li className="flex items-center gap-2">✓ Git integration</li>
          <li className="flex items-center gap-2">✓ Extension marketplace</li>
          <li className="flex items-center gap-2">✓ All themes</li>
          <li className="flex items-center gap-2">✓ SSH remote access</li>
        </ul>
      </div>

      <a
        href={SPONSOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl bg-pink-500 px-8 py-3.5 font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-pink-600"
      >
        <Heart className="h-5 w-5" />
        Sponsor on GitHub
      </a>
    </div>
  );
}
