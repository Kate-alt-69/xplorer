import { transport } from '../transport';
import type { ExtensionManifestInfo, ExtensionPackageInfo, FileEntry } from '../tauri-api-types';

// ── Extension-scoped storage ────────────────────────────────────────────────

export const getExtensionStorage = async (extensionId: string, key: string): Promise<unknown> =>
  await transport('get_extension_storage', { extensionId, key });

export const setExtensionStorage = async (
  extensionId: string,
  key: string,
  value: unknown,
): Promise<void> => await transport('set_extension_storage', { extensionId, key, value });

export const deleteExtensionStorage = async (extensionId: string, key: string): Promise<void> =>
  await transport('delete_extension_storage', { extensionId, key });

// ── Extension management ────────────────────────────────────────────────────

export const getInstalledExtensions = async (): Promise<ExtensionPackageInfo[]> =>
  await transport('get_installed_extensions');

export const installExtensionFromPath = async (
  extensionPath: string,
): Promise<ExtensionPackageInfo> =>
  await transport('install_extension_from_path', { extensionPath });

export const uninstallExtensionById = async (extensionId: string): Promise<void> =>
  await transport('uninstall_extension_by_id', { extensionId });

export const activateExtension = async (extensionId: string): Promise<void> =>
  await transport('activate_extension', { extensionId });

export const deactivateExtension = async (extensionId: string): Promise<void> =>
  await transport('deactivate_extension', { extensionId });

export const getActiveExtensionIds = async (): Promise<string[]> =>
  await transport('get_active_extension_ids');

export const getExtensionPermissions = async (extensionId: string): Promise<string[]> =>
  await transport('get_extension_permissions', { extensionId });

export const validateExtensionPath = async (
  extensionPath: string,
): Promise<ExtensionManifestInfo> => await transport('validate_extension_path', { extensionPath });

export const downloadAndInstallExtension = async (
  downloadUrl: string,
  extensionId: string,
  expectedChecksum?: string,
): Promise<ExtensionPackageInfo> =>
  await transport('download_and_install_extension', {
    downloadUrl,
    extensionId,
    expectedChecksum: expectedChecksum || null,
  });

// ── .xtension file operations ───────────────────────────────────────────────

export const packExtension = async (extensionDir: string, outputPath?: string): Promise<string> =>
  await transport('pack_extension', { extensionDir, outputPath: outputPath || null });

export const installXtensionFile = async (xtensionPath: string): Promise<ExtensionPackageInfo> =>
  await transport('install_xtension_file', { xtensionPath });

export const inspectXtensionFile = async (xtensionPath: string): Promise<ExtensionManifestInfo> =>
  await transport('inspect_xtension_file', { xtensionPath });

export const nativePluginInvoke = async (
  extensionId: string,
  pluginId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> =>
  await transport('native_plugin_invoke', { extensionId, pluginId, command, args });

export const extensionBackendCall = async (
  extensionId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> =>
  await transport('extension_backend_call', {
    extensionId,
    method,
    args: JSON.stringify(args),
  });

export const extensionBackendStatus = async (extensionId: string): Promise<{ loaded: boolean }> =>
  await transport('extension_backend_status', { extensionId });

export const checkForExtensionUpdates = async (
  marketplaceUrl: string,
  installedExtensions: Array<{ id: string; version: string }>,
): Promise<
  Array<{
    id: string;
    current_version: string;
    latest_version: string;
    download_url: string;
    checksum: string | null;
    changelog: string | null;
  }>
> =>
  await transport('check_for_extension_updates', {
    marketplaceUrl,
    installedExtensions,
  });

export const downloadExtensionUpdate = async (
  url: string,
  expectedChecksum?: string,
): Promise<string> =>
  await transport('download_extension', {
    url,
    expectedChecksum: expectedChecksum ?? null,
  });

// ── SSH file browsing (via native plugin) ──────────────────────────────────

const parseSSHUrl = (
  url: string,
): { host: string; port: number; username: string; remotePath: string; connId: string } | null => {
  const match = url.match(/^ssh:\/\/([^/]+)\/(.*)$/);
  if (!match) return null;
  const connId = match[1];
  const remotePath = decodeURIComponent(match[2]) || '~';
  const connMatch = connId.match(/^([^@]+)@([^:]+):(\d+)$/);
  if (!connMatch) return null;
  return {
    username: connMatch[1],
    host: connMatch[2],
    port: parseInt(connMatch[3], 10),
    remotePath,
    connId,
  };
};

export const sshReadDirectory = async (sshUrl: string): Promise<FileEntry[]> => {
  const parsed = parseSSHUrl(sshUrl);
  if (!parsed) return [];

  const storedRaw = await transport('get_extension_storage', {
    extensionId: 'xplorer-ssh',
    key: 'connections',
  }).catch(() => null);

  let password: string | null = null;
  let keyPath: string | null = null;
  if (storedRaw && Array.isArray(storedRaw)) {
    const stored = storedRaw as Array<{
      host: string;
      port: number;
      username: string;
      password?: string;
      keyPath?: string;
    }>;
    const match = stored.find(
      (c) => c.host === parsed.host && c.port === parsed.port && c.username === parsed.username,
    );
    if (match) {
      password = match.password ?? null;
      keyPath = match.keyPath ?? null;
    }
  }

  const result = (await nativePluginInvoke('xplorer-ssh', 'xplorer-ssh', 'read_directory', {
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    remote_path: parsed.remotePath,
    password,
    key_path: keyPath,
  })) as {
    ok?: Array<{
      name: string;
      path: string;
      is_dir: boolean;
      size: number;
      modified: number;
      file_type: string;
    }>;
    error?: string;
  };

  if (!result.ok) return [];

  return result.ok.map((f) => ({
    name: f.name,
    path: `ssh://${parsed.connId}/${encodeURIComponent(f.path)}`,
    is_dir: f.is_dir,
    size: f.size,
    modified: f.modified,
    file_type: f.file_type,
    is_readonly: false,
  }));
};
