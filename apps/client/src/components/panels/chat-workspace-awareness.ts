/**
 * Workspace awareness: detect project types and environment context
 * to provide intelligent, project-specific suggestions in the AI chat.
 */
import { TauriAPI } from '@/lib/tauri-api';
import { getExt } from './chat-context-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  type: ProjectType;
  label: string;
  /** Manifest file that was detected */
  manifest: string;
  /** Extra info extracted from the manifest */
  details?: string;
}

export type ProjectType =
  | 'node'
  | 'rust'
  | 'python'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'flutter'
  | 'unknown';

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  uncommittedCount?: number;
  repoRoot?: string;
}

export interface WorkspaceContext {
  project: ProjectInfo | null;
  git: GitInfo;
  /** Total items in current directory */
  totalItems: number;
  /** Breakdown by file type (top 5 extensions) */
  topExtensions: Array<{ ext: string; count: number }>;
  /** Directories count */
  dirCount: number;
  /** Files count */
  fileCount: number;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

interface ManifestCheck {
  file: string;
  type: ProjectType;
  label: string;
  /** Extract details from manifest content */
  extractDetails?: (content: string) => string | undefined;
}

const MANIFEST_CHECKS: ManifestCheck[] = [
  {
    file: 'package.json',
    type: 'node',
    label: 'Node.js',
    extractDetails: (content) => {
      try {
        const pkg: unknown = JSON.parse(content);
        if (pkg && typeof pkg === 'object') {
          const obj = pkg as Record<string, unknown>;
          const name = typeof obj.name === 'string' ? obj.name : undefined;
          const deps = obj.dependencies
            ? Object.keys(obj.dependencies as Record<string, unknown>).length
            : 0;
          const devDeps = obj.devDependencies
            ? Object.keys(obj.devDependencies as Record<string, unknown>).length
            : 0;
          const parts: string[] = [];
          if (name) parts.push(`"${name}"`);
          if (deps > 0 || devDeps > 0) parts.push(`${deps} deps, ${devDeps} devDeps`);
          // Detect frameworks
          const allDeps = {
            ...(typeof obj.dependencies === 'object' ? obj.dependencies : {}),
            ...(typeof obj.devDependencies === 'object' ? obj.devDependencies : {}),
          } as Record<string, unknown>;
          const frameworks: string[] = [];
          if ('react' in allDeps) frameworks.push('React');
          if ('next' in allDeps) frameworks.push('Next.js');
          if ('vue' in allDeps) frameworks.push('Vue');
          if ('svelte' in allDeps) frameworks.push('Svelte');
          if ('angular' in allDeps || '@angular/core' in allDeps) frameworks.push('Angular');
          if ('express' in allDeps) frameworks.push('Express');
          if ('tailwindcss' in allDeps) frameworks.push('Tailwind');
          if (frameworks.length > 0) parts.push(`frameworks: ${frameworks.join(', ')}`);
          return parts.join(' | ');
        }
      } catch {
        /* ignore parse errors */
      }
      return undefined;
    },
  },
  {
    file: 'Cargo.toml',
    type: 'rust',
    label: 'Rust',
    extractDetails: (content) => {
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      const editionMatch = content.match(/^edition\s*=\s*"([^"]+)"/m);
      const parts: string[] = [];
      if (nameMatch) parts.push(`"${nameMatch[1]}"`);
      if (editionMatch) parts.push(`edition ${editionMatch[1]}`);
      return parts.length > 0 ? parts.join(' | ') : undefined;
    },
  },
  {
    file: 'requirements.txt',
    type: 'python',
    label: 'Python',
    extractDetails: (content) => {
      const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      return `${lines.length} dependencies`;
    },
  },
  {
    file: 'pyproject.toml',
    type: 'python',
    label: 'Python',
    extractDetails: (content) => {
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      return nameMatch ? `"${nameMatch[1]}"` : undefined;
    },
  },
  {
    file: 'go.mod',
    type: 'go',
    label: 'Go',
    extractDetails: (content) => {
      const moduleMatch = content.match(/^module\s+(\S+)/m);
      return moduleMatch ? `module: ${moduleMatch[1]}` : undefined;
    },
  },
  {
    file: 'pom.xml',
    type: 'java',
    label: 'Java (Maven)',
  },
  {
    file: 'build.gradle',
    type: 'java',
    label: 'Java (Gradle)',
  },
  {
    file: 'build.gradle.kts',
    type: 'java',
    label: 'Kotlin (Gradle)',
  },
  {
    file: 'Program.cs',
    type: 'dotnet',
    label: '.NET',
  },
  {
    file: 'Gemfile',
    type: 'ruby',
    label: 'Ruby',
  },
  {
    file: 'composer.json',
    type: 'php',
    label: 'PHP',
  },
  {
    file: 'Package.swift',
    type: 'swift',
    label: 'Swift',
  },
  {
    file: 'pubspec.yaml',
    type: 'flutter',
    label: 'Flutter/Dart',
  },
];

/**
 * Detect the project type by checking for manifest files in the given directory.
 */
export const detectProjectType = async (dirPath: string): Promise<ProjectInfo | null> => {
  if (!dirPath) return null;

  try {
    const entries = await TauriAPI.readDirectory(dirPath);
    const fileNames = new Set(entries.map((e) => e.name));

    for (const check of MANIFEST_CHECKS) {
      if (fileNames.has(check.file)) {
        let details: string | undefined;
        if (check.extractDetails) {
          try {
            const content = await TauriAPI.readTextFile(`${dirPath}/${check.file}`);
            details = check.extractDetails(content);
          } catch {
            /* file read failed, skip details */
          }
        }
        return {
          type: check.type,
          label: check.label,
          manifest: check.file,
          details,
        };
      }
    }
  } catch {
    /* directory read failed */
  }

  return null;
};

// ---------------------------------------------------------------------------
// Git context detection
// ---------------------------------------------------------------------------

/**
 * Detect git repository information for the given directory.
 */
export const detectGitInfo = async (dirPath: string): Promise<GitInfo> => {
  if (!dirPath) return { isRepo: false };

  try {
    const repoRoot = await TauriAPI.findGitRepository(dirPath);
    if (!repoRoot) return { isRepo: false };

    const info: GitInfo = { isRepo: true, repoRoot };

    try {
      const repoInfo = await TauriAPI.getGitRepoInfo(repoRoot);
      if (repoInfo?.branch) {
        info.branch = repoInfo.branch;
      }
    } catch {
      /* git info fetch failed */
    }

    try {
      const fileStatuses = await TauriAPI.getFileStatus(repoRoot);
      if (Array.isArray(fileStatuses)) {
        info.uncommittedCount = fileStatuses.length;
      }
    } catch {
      /* file status fetch failed */
    }

    return info;
  } catch {
    return { isRepo: false };
  }
};

// ---------------------------------------------------------------------------
// Directory summary
// ---------------------------------------------------------------------------

/**
 * Build a quick directory summary: file/dir counts and top extensions.
 */
export const buildDirectorySummary = async (
  dirPath: string,
): Promise<{
  totalItems: number;
  dirCount: number;
  fileCount: number;
  topExtensions: Array<{ ext: string; count: number }>;
}> => {
  const result = {
    totalItems: 0,
    dirCount: 0,
    fileCount: 0,
    topExtensions: [] as Array<{ ext: string; count: number }>,
  };

  if (!dirPath) return result;

  try {
    const entries = await TauriAPI.readDirectory(dirPath);
    result.totalItems = entries.length;

    const extCounts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.is_dir) {
        result.dirCount++;
      } else {
        result.fileCount++;
        const ext = getExt(entry.path);
        if (ext) {
          extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        }
      }
    }

    result.topExtensions = Array.from(extCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => ({ ext, count }));
  } catch {
    /* directory read failed */
  }

  return result;
};

// ---------------------------------------------------------------------------
// Full workspace context
// ---------------------------------------------------------------------------

/**
 * Gather the complete workspace context for a directory.
 * Used to power the contextual welcome message and workspace-aware prompts.
 */
export const detectWorkspaceContext = async (dirPath: string): Promise<WorkspaceContext> => {
  const [project, git, summary] = await Promise.all([
    detectProjectType(dirPath),
    detectGitInfo(dirPath),
    buildDirectorySummary(dirPath),
  ]);

  return {
    project,
    git,
    ...summary,
  };
};

// ---------------------------------------------------------------------------
// System prompt injection
// ---------------------------------------------------------------------------

/**
 * Build a workspace awareness section for the AI system prompt.
 * This gives the AI knowledge about what kind of project it's working with.
 */
export const buildWorkspacePrompt = (ctx: WorkspaceContext): string => {
  const lines: string[] = [];

  if (ctx.project) {
    lines.push(`## Workspace: ${ctx.project.label} project`);
    lines.push(`Detected manifest: ${ctx.project.manifest}`);
    if (ctx.project.details) {
      lines.push(`Project info: ${ctx.project.details}`);
    }

    // Add project-specific context
    switch (ctx.project.type) {
      case 'node':
        lines.push(
          'This is a Node.js project. You can suggest npm/pnpm/yarn commands, suggest dependency updates, and help with package.json configuration.',
        );
        break;
      case 'rust':
        lines.push(
          'This is a Rust project. You can suggest cargo commands, help with Cargo.toml configuration, and provide Rust-specific advice.',
        );
        break;
      case 'python':
        lines.push(
          'This is a Python project. You can suggest pip/poetry commands, help with virtual environments, and provide Python-specific advice.',
        );
        break;
      case 'go':
        lines.push(
          'This is a Go project. You can suggest go commands, help with go.mod management, and provide Go-specific advice.',
        );
        break;
      case 'java':
        lines.push(
          'This is a Java/JVM project. You can suggest Maven/Gradle commands and provide Java-specific advice.',
        );
        break;
      default:
        break;
    }
  }

  if (ctx.git.isRepo) {
    lines.push(`\n## Git Repository`);
    if (ctx.git.branch) lines.push(`Current branch: ${ctx.git.branch}`);
    if (ctx.git.uncommittedCount !== undefined && ctx.git.uncommittedCount > 0) {
      lines.push(`Uncommitted changes: ${ctx.git.uncommittedCount} files`);
    }
  }

  if (ctx.totalItems > 0) {
    lines.push(`\n## Directory Overview`);
    lines.push(`${ctx.fileCount} files, ${ctx.dirCount} folders (${ctx.totalItems} total items)`);
    if (ctx.topExtensions.length > 0) {
      const extList = ctx.topExtensions.map((e) => `.${e.ext} (${e.count})`).join(', ');
      lines.push(`Top file types: ${extList}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '';
};
