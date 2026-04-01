#!/usr/bin/env bash
# Stub-only: no client components are copied from the desktop app.
# This eliminates the React 18/19 version conflict that crashed xplorer.space.
# Landing page uses screenshots instead of live component demos.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
DEST="$WEB_DIR/.client-components"

rm -rf "$DEST"
mkdir -p "$DEST/components/explorer" "$DEST/components/panels" "$DEST/components/ui" "$DEST/lib" "$DEST/hooks" "$DEST/contexts" "$DEST/__mocks__" "$DEST/locales" "$DEST/styles" "$DEST/components/dialogs" "$DEST/components/split-view" "$DEST/components/explorer/sidebar" "$DEST/components/explorer/architect" "$DEST/extensions/advanced-selection" "$DEST/types"

STUB='const S = (p: any) => <div {...p} />; export default S; export {};'

# Component stubs
for f in StatusBar CommandPalette; do echo "$STUB" > "$DEST/components/$f.tsx"; done
for f in LeftSidebar OperationBar FileGridItem FileGridHelpers TopBar NavigationBar SearchResultsPanel VimModeIndicator ThumbnailPreview TerminalCommands; do echo "$STUB" > "$DEST/components/explorer/$f.tsx"; done
for f in ChatPanel ChatInput ChatMessage PreviewPanel ExtensionsPanel PreviewActionBar; do echo "$STUB" > "$DEST/components/panels/$f.tsx"; done
for f in MarkdownRenderer Skeleton ContextMenu Toast; do echo "$STUB" > "$DEST/components/ui/$f.tsx"; done
echo 'export const PreviewSkeleton = () => null;' >> "$DEST/components/ui/Skeleton.tsx"
for f in BatchConfirmDialog EncryptionDialog FileConflictDialog FileDetailsDialog MoveTreePreviewDialog PermissionReviewDialog; do echo "$STUB" > "$DEST/components/dialogs/$f.tsx"; done
echo "$STUB" > "$DEST/components/split-view/EditorGroupPane.tsx"

# Sidebar stubs
for f in SidebarQuickAccess SidebarRecent SidebarBookmarks SidebarCollections SidebarDrives SidebarFileTree PlacesSection; do
  echo "$STUB" > "$DEST/components/explorer/sidebar/$f.tsx"
done

# Architect stubs
for f in use-architect-scanner ArchitectSidebarTree ArchitectCanvas ArchitectToolbar ArchitectAnalysis; do
  echo "export default {}; export {};" > "$DEST/components/explorer/architect/$f.ts"
done
echo "$STUB" > "$DEST/components/explorer/ArchitectView.tsx"
echo "$STUB" > "$DEST/components/explorer/BrowserView.tsx"

# Lib stubs
for f in utils constants storage-keys context-menu-factory context-menu-rules collections path-bookmarks saved-searches workspace-layouts folder-colors file-templates agent-service ai-service editable-files validate-filename drag-utils file-operation-helpers move-tree-preview paste-helpers preview-factory shortcut-utils theme-registry tour-steps extension-host-icon extension-registry tauri-api-types format-utils tab-utils extension-registration-helpers extension-host-queries; do
  echo "export default {}; export {};" > "$DEST/lib/$f.ts"
done
echo "export const isTauri = () => false; export const transport = {};" > "$DEST/lib/transport.ts"
echo "export const STORAGE_KEYS = {} as Record<string, string>;" > "$DEST/lib/storage-keys.ts"

# Extension host stub
cat > "$DEST/lib/extension-host.ts" << 'EOF'
const noop = () => {};
export const extensionHost = { getSidebarTabs: () => [], getBottomTabs: () => [], onChange: () => noop, isReady: () => true };
export default extensionHost;
EOF

cat > "$DEST/lib/extension-lifecycle.ts" << 'EOF'
export const initExtensions = async () => {};
EOF

# Extension host types stub
cat > "$DEST/lib/extension-host-types.ts" << 'EOF'
export interface LoadedExtension { id: string; manifest: any; isActive: boolean; isBuiltin: boolean; isDev?: boolean; reloadCount?: number; }
export interface PanelRegistration { id: string; extensionId: string; title: string; icon: any; location: string; isBuiltin: boolean; render: () => any; }
export type ExtensionManifest = Record<string, any>;
export type ExtensionPackage = Record<string, any>;
export type PanelRenderProps = Record<string, any>;
export type FileDecoration = Record<string, any>;
export type FileDecorator = Record<string, any>;
export type ContextMenuEntry = Record<string, any>;
export type EditorRegistration = Record<string, any>;
export type PreviewRegistration = Record<string, any>;
export type ExtensionFileInfo = Record<string, any>;
export type CommandHandler = Record<string, any>;
export type EventCallback = () => void;
export class EventBus { on() {} off() {} emit() {} }
export const resolveIcon = () => null;
EOF

# Tauri API stub
mkdir -p "$DEST/lib/tauri-api"
cat > "$DEST/lib/tauri-api.ts" << 'EOF'
export class TauriAPI { static readDirectory = async () => []; static readTextFile = async () => ''; }
export type FileEntry = { name: string; path: string; is_dir: boolean; size: number; modified: number; file_type: string; is_readonly: boolean; };
EOF
echo "export {};" > "$DEST/lib/tauri-api/index.ts"

# Hook stubs
for f in use-toast use-chat use-chat-state use-file-operations use-xplorer-actions use-xplorer-effects use-navigation use-live-search use-folder-sizes use-sidebar-resize use-window-event use-draggable use-theme-manager use-shortcuts use-vim-mode use-type-ahead-search use-cross-tab-selection use-dialogs use-split-layout use-pane-sync use-layout-state use-file-comparison use-terminal use-focus-change-tracker use-context-menu use-bulk-rename use-file-actions use-navigation-actions use-search-results use-undo-history use-open-with-prefs use-updater; do
  echo "export const ${f//-/_} = () => ({}); export default ${f//-/_};" > "$DEST/hooks/$f}.ts" 2>/dev/null || echo "export default {};" > "$DEST/hooks/$f.ts"
done

# Context stubs
echo "export {};" > "$DEST/contexts/ExplorerContext.tsx"
echo "export {};" > "$DEST/contexts/DragDropContext.tsx"

# Extension selection stub
echo "export {};" > "$DEST/extensions/advanced-selection/selection-utils.ts"
# Types stub
echo "export {};" > "$DEST/types/split-view.ts"

# Mock files
cat > "$DEST/__mocks__/react-i18next.ts" << 'EOF'
export const useTranslation = () => ({ t: (key: string) => key.split('.').pop() || key, i18n: { language: 'en', changeLanguage: () => Promise.resolve() } });
export const Trans = ({ children }: { children?: React.ReactNode }) => children;
export const initReactI18next = { type: '3rdParty', init: () => {} };
EOF

cat > "$DEST/__mocks__/wouter.ts" << 'EOF'
export const useLocation = () => ['/home', () => {}] as const;
export const useRoute = () => [true, {}] as const;
export const Link = (p: any) => p.children;
export const Route = (p: any) => p.children;
export const Switch = (p: any) => p.children;
EOF

# i18n stub
echo "export default { t: (k: string) => k };" > "$DEST/i18n.ts"

# Empty CSS
echo "" > "$DEST/styles/tokyo-night.css"
echo "" > "$DEST/index.css"

echo "✅ Stubs created (no client components copied — eliminates React version conflict)"
