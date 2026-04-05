/**
 * Extension awareness for the AI chat panel.
 *
 * Provides:
 * 1. Extension discovery — queries extensionHost for installed extensions
 *    and builds a system prompt section describing available tools.
 * 2. Contextual suggestions — detects when a selected file matches an
 *    installed extension's capabilities (editor file types, category, etc.).
 * 3. Marketplace install suggestions — when a user asks for something that
 *    a well-known extension could handle but it isn't installed.
 */

import { extensionHost, type LoadedExtension, type ExtensionManifest } from '@/lib/extension-host';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionSuggestion {
  extensionId: string;
  extensionName: string;
  message: string;
  /** If set, the extension is installed and can be opened */
  filePath?: string;
}

export interface MarketplaceSuggestion {
  keyword: string;
  extensionName: string;
  description: string;
}

interface ExtensionCapability {
  id: string;
  name: string;
  description: string;
  category: string;
  fileExtensions: string[];
  commands: string[];
  hasPanel: boolean;
  hasEditor: boolean;
  hasPreview: boolean;
}

// ---------------------------------------------------------------------------
// Well-known marketplace extensions (for install suggestions)
// ---------------------------------------------------------------------------

const MARKETPLACE_EXTENSIONS: MarketplaceSuggestion[] = [
  {
    keyword: 'docker',
    extensionName: 'Docker Manager',
    description: 'Manage Docker containers, images, and compose files',
  },
  {
    keyword: 'database',
    extensionName: 'SQLite Browser',
    description: 'Browse and query SQLite databases',
  },
  {
    keyword: 'sqlite',
    extensionName: 'SQLite Browser',
    description: 'Browse and query SQLite databases',
  },
  {
    keyword: 'markdown',
    extensionName: 'Markdown Preview',
    description: 'Live preview for Markdown files with syntax highlighting',
  },
  {
    keyword: 'hex',
    extensionName: 'Hex Editor',
    description: 'View and edit files in hexadecimal format',
  },
  {
    keyword: 'csv',
    extensionName: 'CSV Viewer',
    description: 'View and filter CSV/TSV files in a table',
  },
  {
    keyword: 'terminal',
    extensionName: 'Integrated Terminal',
    description: 'Full terminal emulator inside Xplorer',
  },
  {
    keyword: 'archive',
    extensionName: 'Archive Manager',
    description: 'Browse and extract zip, tar, gz, and other archives',
  },
  {
    keyword: 'diff',
    extensionName: 'Diff Viewer',
    description: 'Side-by-side file comparison with syntax highlighting',
  },
];

// ---------------------------------------------------------------------------
// File extension to category mapping for contextual matching
// ---------------------------------------------------------------------------

const FILE_EXT_CATEGORIES: Record<string, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'avif'],
  code: [
    'js',
    'ts',
    'jsx',
    'tsx',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'c',
    'cpp',
    'h',
    'cs',
    'php',
    'swift',
    'kt',
    'scala',
    'lua',
    'r',
    'pl',
    'sh',
    'bash',
    'zsh',
  ],
  database: ['db', 'sqlite', 'sqlite3', 'sql'],
  document: ['md', 'mdx', 'rst', 'txt', 'rtf', 'doc', 'docx', 'pdf'],
  config: ['json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'env'],
  archive: ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
  data: ['csv', 'tsv', 'parquet'],
};

const getFileCategory = (fileName: string): string | null => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  for (const [category, extensions] of Object.entries(FILE_EXT_CATEGORIES)) {
    if (extensions.includes(ext)) return category;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Extension capability extraction
// ---------------------------------------------------------------------------

const extractCapabilities = (ext: LoadedExtension): ExtensionCapability => {
  const manifest: ExtensionManifest = ext.manifest;
  const contributes = manifest.contributes;

  const fileExtensions: string[] = [];
  if (contributes?.editors) {
    for (const editor of contributes.editors) {
      fileExtensions.push(...editor.extensions);
    }
  }

  const commands: string[] = [];
  if (contributes?.commands) {
    for (const cmd of contributes.commands) {
      commands.push(cmd.command);
    }
  }

  return {
    id: manifest.id,
    name: manifest.display_name ?? manifest.name,
    description: manifest.description ?? '',
    category: manifest.category ?? 'other',
    fileExtensions,
    commands,
    hasPanel: (contributes?.panels?.length ?? 0) > 0,
    hasEditor: (contributes?.editors?.length ?? 0) > 0,
    hasPreview: manifest.category === 'preview',
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all installed extensions and their capabilities.
 * Returns a list of capability descriptors suitable for AI prompt injection.
 */
export const getInstalledExtensionCapabilities = (): ExtensionCapability[] => {
  const extensions = extensionHost.getAllExtensions();
  return extensions.filter((ext) => ext.isActive).map(extractCapabilities);
};

/**
 * Build a system prompt section describing installed extensions.
 * Returns empty string if no extensions are installed.
 */
export const buildExtensionAwarenessPrompt = (): string => {
  const capabilities = getInstalledExtensionCapabilities();
  if (capabilities.length === 0) return '';

  const lines: string[] = ['## Installed Extensions'];
  lines.push(
    'The following extensions are installed and available in the file manager. You can suggest opening files with these extensions when relevant.',
  );
  lines.push('');

  for (const cap of capabilities) {
    let desc = `- **${cap.name}** (\`${cap.id}\`)`;
    if (cap.description) desc += `: ${cap.description}`;

    const details: string[] = [];
    if (cap.fileExtensions.length > 0) {
      details.push(`handles: .${cap.fileExtensions.join(', .')}`);
    }
    if (cap.hasEditor) details.push('can edit files');
    if (cap.hasPanel) details.push('has panel UI');
    if (cap.hasPreview) details.push('can preview files');
    if (cap.commands.length > 0) {
      details.push(`commands: ${cap.commands.slice(0, 5).join(', ')}`);
    }

    if (details.length > 0) {
      desc += ` [${details.join('; ')}]`;
    }

    lines.push(desc);
  }

  lines.push('');
  lines.push(
    'To open a file in an extension, use: `{"action": "open_extension", "extension_id": "<id>", "path": "/absolute/path/to/file"}`',
  );
  lines.push(
    'This action auto-executes (no permission needed) and opens the extension with the file context.',
  );

  return lines.join('\n');
};

/**
 * Detect contextual extension suggestions based on currently selected files.
 * Returns suggestions for extensions that handle the selected file types.
 */
export const getContextualExtensionSuggestions = (
  selectedFiles: Array<{ name: string; path: string; is_dir: boolean }>,
  currentPath: string,
): ExtensionSuggestion[] => {
  if (selectedFiles.length === 0 && !currentPath) return [];

  const capabilities = getInstalledExtensionCapabilities();
  if (capabilities.length === 0) return [];

  const suggestions: ExtensionSuggestion[] = [];
  const suggestedExtIds = new Set<string>();

  for (const file of selectedFiles) {
    if (file.is_dir) continue;

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const category = getFileCategory(file.name);

    for (const cap of capabilities) {
      if (suggestedExtIds.has(cap.id)) continue;

      // Match by file extension
      if (cap.fileExtensions.includes(ext)) {
        suggestions.push({
          extensionId: cap.id,
          extensionName: cap.name,
          message: `I can open "${file.name}" in ${cap.name}. Want me to open it?`,
          filePath: file.path,
        });
        suggestedExtIds.add(cap.id);
        continue;
      }

      // Match by category
      if (category && cap.category.toLowerCase().includes(category)) {
        suggestions.push({
          extensionId: cap.id,
          extensionName: cap.name,
          message: `The ${cap.name} extension can handle ${category} files like "${file.name}".`,
          filePath: file.path,
        });
        suggestedExtIds.add(cap.id);
      }
    }
  }

  // Check for git context — suggest git extensions if in a git repo
  if (currentPath) {
    const gitExts = capabilities.filter(
      (c) =>
        c.category.toLowerCase().includes('git') ||
        c.id.toLowerCase().includes('git') ||
        c.name.toLowerCase().includes('git'),
    );
    for (const gitExt of gitExts) {
      if (!suggestedExtIds.has(gitExt.id)) {
        suggestions.push({
          extensionId: gitExt.id,
          extensionName: gitExt.name,
          message: `The ${gitExt.name} extension is available. Want to use it for git operations?`,
        });
        suggestedExtIds.add(gitExt.id);
      }
    }
  }

  return suggestions;
};

/**
 * Check if a user message might benefit from a marketplace extension
 * that isn't currently installed.
 */
export const getMarketplaceSuggestions = (userMessage: string): MarketplaceSuggestion[] => {
  const installedIds = new Set(
    extensionHost
      .getAllExtensions()
      .filter((e) => e.isActive)
      .map((e) => e.manifest.name.toLowerCase()),
  );

  const lower = userMessage.toLowerCase();
  const matches: MarketplaceSuggestion[] = [];
  const seen = new Set<string>();

  for (const ext of MARKETPLACE_EXTENSIONS) {
    if (seen.has(ext.extensionName)) continue;
    if (installedIds.has(ext.extensionName.toLowerCase())) continue;

    if (lower.includes(ext.keyword)) {
      matches.push(ext);
      seen.add(ext.extensionName);
    }
  }

  return matches;
};

/**
 * Execute the open_extension action by finding the extension and
 * triggering the appropriate UI action (open panel, editor, or command).
 */
export const executeOpenExtension = async (
  extensionId: string,
  filePath?: string,
): Promise<string> => {
  const ext = extensionHost.getExtension(extensionId);
  if (!ext) {
    return `Extension "${extensionId}" is not installed or not active.`;
  }
  if (!ext.isActive) {
    return `Extension "${extensionId}" is installed but not active.`;
  }

  // Try to open via the extension's editor if a file path is provided
  if (filePath) {
    // Navigate to the file so the extension editor can pick it up
    const xState = (
      window as unknown as { __xplorer_state__?: { navigateTo?: (p: string) => void } }
    ).__xplorer_state__;
    if (xState?.navigateTo) {
      // Navigate to the parent directory
      const parts = filePath.split(/[/\\]/);
      const fileName = parts.pop() ?? '';
      const parentDir = parts.join('/') || '/';
      xState.navigateTo(parentDir);

      // Emit an event so the extension host knows to open this file
      extensionHost.emitEvent('xplorer:open-file-with-extension', {
        extensionId,
        filePath,
        fileName,
      });

      return `Opened "${fileName}" with ${ext.manifest.display_name ?? ext.manifest.name}.`;
    }
  }

  // Try to open via the extension's panel
  const panels = ext.manifest.contributes?.panels;
  if (panels && panels.length > 0) {
    extensionHost.emitEvent('xplorer:open-panel', { panelId: panels[0].id });
    return `Opened ${ext.manifest.display_name ?? ext.manifest.name} panel.`;
  }

  // Try to execute a default command
  const commands = ext.manifest.contributes?.commands;
  if (commands && commands.length > 0) {
    try {
      await extensionHost.executeCommand(commands[0].command, filePath ? { filePath } : {});
      return `Executed ${commands[0].title ?? commands[0].command} from ${ext.manifest.display_name ?? ext.manifest.name}.`;
    } catch (err) {
      return `Failed to execute command: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return `Extension "${ext.manifest.display_name ?? ext.manifest.name}" is available but has no default action to trigger.`;
};

/**
 * Build a marketplace suggestion prompt section for the AI.
 * Called with the user's message to provide install recommendations.
 */
export const buildMarketplaceSuggestionText = (userMessage: string): string => {
  const suggestions = getMarketplaceSuggestions(userMessage);
  if (suggestions.length === 0) return '';

  const lines: string[] = [];
  for (const s of suggestions) {
    lines.push(
      `There's a **${s.extensionName}** extension available in the Xplorer marketplace that could help: ${s.description}. The user can install it from the Extensions panel.`,
    );
  }
  return lines.join('\n');
};
