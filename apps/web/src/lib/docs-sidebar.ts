export interface SidebarItem {
  slug: string;
  title: string;
}

export interface SidebarCategory {
  label: string;
  items: SidebarItem[];
}

export type SidebarEntry = SidebarItem | SidebarCategory;

export const DOCS_SIDEBAR: SidebarEntry[] = [
  { slug: 'intro', title: 'Introduction' },
  { slug: 'getting-started', title: 'Getting Started' },
  { slug: 'contributing', title: 'Contributing' },
  {
    label: 'Architecture',
    items: [
      { slug: 'architecture/overview', title: 'Overview' },
      { slug: 'architecture/frontend', title: 'Frontend' },
      { slug: 'architecture/backend', title: 'Backend' },
      { slug: 'architecture/tauri-bridge', title: 'Tauri Bridge' },
    ],
  },
  {
    label: 'Features',
    items: [
      { slug: 'features/overview', title: 'Overview' },
      { slug: 'features/file-browsing', title: 'File Browsing' },
      { slug: 'features/file-operations', title: 'File Operations' },
      { slug: 'features/file-previews', title: 'File Previews' },
      { slug: 'features/views', title: 'View Modes' },
      { slug: 'features/search-and-tokenizer', title: 'Search & Tokenizer' },
      { slug: 'features/ai-integration', title: 'AI Integration' },
      { slug: 'features/ai-agent', title: 'AI Agent' },
      { slug: 'features/git-integration', title: 'Git Integration' },
      { slug: 'features/google-drive', title: 'Google Drive' },
      { slug: 'features/ssh-remote', title: 'SSH Remote' },
      { slug: 'features/themes', title: 'Themes' },
      { slug: 'features/keyboard-shortcuts', title: 'Keyboard Shortcuts' },
      { slug: 'features/accessibility', title: 'Accessibility' },
      { slug: 'features/onboarding-tour', title: 'Onboarding Tour' },
    ],
  },
  {
    label: 'Extensions',
    items: [
      { slug: 'extensions/overview', title: 'Overview' },
      { slug: 'extensions/getting-started', title: 'Getting Started' },
      { slug: 'extensions/creating-extensions', title: 'Creating Extensions' },
      { slug: 'extensions/sdk', title: 'SDK Reference' },
      { slug: 'extensions/manifest', title: 'Manifest' },
      { slug: 'extensions/permissions', title: 'Permissions' },
    ],
  },
  {
    label: 'API Reference',
    items: [
      { slug: 'api/frontend-api', title: 'Frontend API' },
      { slug: 'api/tauri-commands', title: 'Tauri Commands' },
      { slug: 'api/types', title: 'Types' },
    ],
  },
];
