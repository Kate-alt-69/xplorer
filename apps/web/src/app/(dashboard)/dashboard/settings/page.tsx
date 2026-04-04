'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Key, Copy, Check, RefreshCw, Trash2 } from 'lucide-react';

const SettingsPage = () => {
  const { data: session } = useSession();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [revoking, setRevoking] = useState(false);

  const generateToken = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cli', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setHasToken(true);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const revokeToken = async () => {
    setRevoking(true);
    try {
      const res = await fetch('/api/cli', { method: 'DELETE' });
      if (res.ok) {
        setToken(null);
        setHasToken(false);
      }
    } catch {
      /* ignore */
    } finally {
      setRevoking(false);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!session) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Please sign in to access settings.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">Settings</h1>

      <div className="rounded-lg border border-gray-200 p-6 dark:border-gray-800">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10">
            <Key className="h-5 w-5 text-brand-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">CLI Token</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Authenticate the Xplorer CLI to publish extensions
            </p>
          </div>
        </div>

        {token ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-hidden text-ellipsis rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-900">
                {token}
              </code>
              <button
                onClick={copyToken}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-gray-200 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                title="Copy"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              Copy this token now — it won&apos;t be shown again.
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Run:{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
                xplorer login
              </code>{' '}
              and paste this token.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={generateToken}
                disabled={loading}
                className="flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-600"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Regenerate
              </button>
              <button
                onClick={revokeToken}
                disabled={revoking}
                className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Revoke
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={generateToken}
              disabled={loading}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate CLI Token'}
            </button>
            {hasToken === false && (
              <p className="text-xs text-gray-500">No active token. Generate one to use the CLI.</p>
            )}
          </div>
        )}
      </div>

      {/* Account Info */}
      <div className="mt-6 rounded-lg border border-gray-200 p-6 dark:border-gray-800">
        <h2 className="mb-3 text-lg font-semibold">Account</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Name</span>
            <span>{session.user?.name || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span>{session.user?.email || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
