import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadDirectory = vi.fn();
const mockReadTextFile = vi.fn();
const mockFindGitRepository = vi.fn();
const mockGetGitRepoInfo = vi.fn();
const mockGetFileStatus = vi.fn();
const mockExecuteCommand = vi.fn();

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
    readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
    findGitRepository: (...args: unknown[]) => mockFindGitRepository(...args),
    getGitRepoInfo: (...args: unknown[]) => mockGetGitRepoInfo(...args),
    getFileStatus: (...args: unknown[]) => mockGetFileStatus(...args),
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  },
}));

/** Helper: build a minimal WorkspaceContext with all required fields */
const makeCtx = (overrides: Partial<WorkspaceContext> = {}): WorkspaceContext => ({
  project: null,
  monorepo: { tool: null },
  tsConfig: null,
  git: { isRepo: false },
  gitDiffSummary: null,
  totalItems: 0,
  fileCount: 0,
  dirCount: 0,
  topExtensions: [],
  ...overrides,
});

import {
  detectProjectType,
  detectGitInfo,
  buildDirectorySummary,
  detectWorkspaceContext,
  buildWorkspacePrompt,
  type WorkspaceContext,
} from '@/components/panels/chat-workspace-awareness';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// detectProjectType
// ---------------------------------------------------------------------------

describe('detectProjectType', () => {
  it('returns null for empty path', async () => {
    const result = await detectProjectType('');
    expect(result).toBeNull();
  });

  it('detects Node.js project by package.json', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'package.json', path: '/app/package.json', is_dir: false },
      { name: 'src', path: '/app/src', is_dir: true },
    ]);
    mockReadTextFile.mockResolvedValue(
      JSON.stringify({
        name: 'my-app',
        dependencies: { react: '^18.0.0', next: '^14.0.0' },
        devDependencies: { tailwindcss: '^3.0.0' },
      }),
    );

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('node');
    expect(result!.label).toBe('Node.js');
    expect(result!.manifest).toBe('package.json');
    expect(result!.details).toContain('my-app');
    expect(result!.details).toContain('React');
    expect(result!.details).toContain('Next.js');
    expect(result!.details).toContain('Tailwind');
  });

  it('detects Rust project by Cargo.toml', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'Cargo.toml', path: '/app/Cargo.toml', is_dir: false },
      { name: 'src', path: '/app/src', is_dir: true },
    ]);
    mockReadTextFile.mockResolvedValue('name = "my-crate"\nedition = "2021"\n');

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('rust');
    expect(result!.label).toBe('Rust');
    expect(result!.details).toContain('my-crate');
    expect(result!.details).toContain('edition 2021');
  });

  it('detects Python project by requirements.txt', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'requirements.txt', path: '/app/requirements.txt', is_dir: false },
    ]);
    mockReadTextFile.mockResolvedValue('flask==2.0\nrequests==2.28\nnumpy==1.24\n');

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('python');
    expect(result!.details).toContain('3 dependencies');
  });

  it('detects Python project by pyproject.toml', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'pyproject.toml', path: '/app/pyproject.toml', is_dir: false },
    ]);
    mockReadTextFile.mockResolvedValue('name = "my-python-project"\nversion = "0.1.0"\n');

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('python');
    expect(result!.details).toContain('my-python-project');
  });

  it('detects Go project by go.mod', async () => {
    mockReadDirectory.mockResolvedValue([{ name: 'go.mod', path: '/app/go.mod', is_dir: false }]);
    mockReadTextFile.mockResolvedValue('module github.com/user/repo\ngo 1.21\n');

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('go');
    expect(result!.details).toContain('github.com/user/repo');
  });

  it('detects Java Maven project by pom.xml', async () => {
    mockReadDirectory.mockResolvedValue([{ name: 'pom.xml', path: '/app/pom.xml', is_dir: false }]);

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('java');
    expect(result!.label).toBe('Java (Maven)');
  });

  it('detects Flutter project by pubspec.yaml', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'pubspec.yaml', path: '/app/pubspec.yaml', is_dir: false },
    ]);

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('flutter');
    expect(result!.label).toBe('Flutter/Dart');
  });

  it('returns null when no manifest is found', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'README.md', path: '/app/README.md', is_dir: false },
      { name: 'docs', path: '/app/docs', is_dir: true },
    ]);

    const result = await detectProjectType('/app');
    expect(result).toBeNull();
  });

  it('handles directory read failure gracefully', async () => {
    mockReadDirectory.mockRejectedValue(new Error('Permission denied'));

    const result = await detectProjectType('/app');
    expect(result).toBeNull();
  });

  it('handles manifest read failure gracefully', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'package.json', path: '/app/package.json', is_dir: false },
    ]);
    mockReadTextFile.mockRejectedValue(new Error('Read failed'));

    const result = await detectProjectType('/app');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('node');
    // details should be undefined because the read failed
    expect(result!.details).toBeUndefined();
  });

  it('detects Vue framework in Node.js project', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'package.json', path: '/app/package.json', is_dir: false },
    ]);
    mockReadTextFile.mockResolvedValue(
      JSON.stringify({
        name: 'vue-app',
        dependencies: { vue: '^3.0.0' },
      }),
    );

    const result = await detectProjectType('/app');
    expect(result!.details).toContain('Vue');
  });
});

// ---------------------------------------------------------------------------
// detectGitInfo
// ---------------------------------------------------------------------------

describe('detectGitInfo', () => {
  it('returns isRepo: false for empty path', async () => {
    const result = await detectGitInfo('');
    expect(result.isRepo).toBe(false);
  });

  it('returns isRepo: false when no git repo found', async () => {
    mockFindGitRepository.mockResolvedValue(null);

    const result = await detectGitInfo('/app');
    expect(result.isRepo).toBe(false);
  });

  it('detects git repo with branch info', async () => {
    mockFindGitRepository.mockResolvedValue('/app');
    mockGetGitRepoInfo.mockResolvedValue({ branch: 'main' });
    mockGetFileStatus.mockResolvedValue([
      { path: 'file.txt', status: 'modified' },
      { path: 'new.txt', status: 'untracked' },
    ]);

    const result = await detectGitInfo('/app');
    expect(result.isRepo).toBe(true);
    expect(result.branch).toBe('main');
    expect(result.uncommittedCount).toBe(2);
    expect(result.repoRoot).toBe('/app');
  });

  it('handles git info fetch failure gracefully', async () => {
    mockFindGitRepository.mockResolvedValue('/app');
    mockGetGitRepoInfo.mockRejectedValue(new Error('git error'));
    mockGetFileStatus.mockRejectedValue(new Error('git error'));

    const result = await detectGitInfo('/app');
    expect(result.isRepo).toBe(true);
    expect(result.branch).toBeUndefined();
    expect(result.uncommittedCount).toBeUndefined();
  });

  it('handles findGitRepository error gracefully', async () => {
    mockFindGitRepository.mockRejectedValue(new Error('Error'));

    const result = await detectGitInfo('/app');
    expect(result.isRepo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildDirectorySummary
// ---------------------------------------------------------------------------

describe('buildDirectorySummary', () => {
  it('returns zero counts for empty path', async () => {
    const result = await buildDirectorySummary('');
    expect(result.totalItems).toBe(0);
    expect(result.fileCount).toBe(0);
    expect(result.dirCount).toBe(0);
  });

  it('counts files and directories correctly', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'file.ts', path: '/app/file.ts', is_dir: false },
      { name: 'file2.ts', path: '/app/file2.ts', is_dir: false },
      { name: 'style.css', path: '/app/style.css', is_dir: false },
      { name: 'src', path: '/app/src', is_dir: true },
      { name: 'lib', path: '/app/lib', is_dir: true },
    ]);

    const result = await buildDirectorySummary('/app');
    expect(result.totalItems).toBe(5);
    expect(result.fileCount).toBe(3);
    expect(result.dirCount).toBe(2);
  });

  it('computes top extensions', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'a.ts', path: '/app/a.ts', is_dir: false },
      { name: 'b.ts', path: '/app/b.ts', is_dir: false },
      { name: 'c.ts', path: '/app/c.ts', is_dir: false },
      { name: 'd.css', path: '/app/d.css', is_dir: false },
      { name: 'e.css', path: '/app/e.css', is_dir: false },
      { name: 'f.json', path: '/app/f.json', is_dir: false },
    ]);

    const result = await buildDirectorySummary('/app');
    expect(result.topExtensions.length).toBeGreaterThan(0);
    // ts should be first (3 files)
    expect(result.topExtensions[0].ext).toBe('ts');
    expect(result.topExtensions[0].count).toBe(3);
  });

  it('limits top extensions to 5', async () => {
    const entries = [];
    const exts = ['ts', 'tsx', 'css', 'json', 'md', 'html', 'js', 'rs'];
    for (let i = 0; i < exts.length; i++) {
      entries.push({ name: `file.${exts[i]}`, path: `/app/file.${exts[i]}`, is_dir: false });
    }
    mockReadDirectory.mockResolvedValue(entries);

    const result = await buildDirectorySummary('/app');
    expect(result.topExtensions.length).toBeLessThanOrEqual(5);
  });

  it('handles directory read failure gracefully', async () => {
    mockReadDirectory.mockRejectedValue(new Error('Permission denied'));

    const result = await buildDirectorySummary('/app');
    expect(result.totalItems).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaceContext
// ---------------------------------------------------------------------------

describe('detectWorkspaceContext', () => {
  it('combines project, git, and directory info', async () => {
    // Project detection
    mockReadDirectory.mockResolvedValue([
      { name: 'package.json', path: '/app/package.json', is_dir: false },
      { name: 'src', path: '/app/src', is_dir: true },
      { name: 'index.ts', path: '/app/index.ts', is_dir: false },
    ]);
    mockReadTextFile.mockResolvedValue(JSON.stringify({ name: 'test' }));

    // Git detection
    mockFindGitRepository.mockResolvedValue('/app');
    mockGetGitRepoInfo.mockResolvedValue({ branch: 'feat/test' });
    mockGetFileStatus.mockResolvedValue([]);

    const result = await detectWorkspaceContext('/app');
    expect(result.project).not.toBeNull();
    expect(result.project!.type).toBe('node');
    expect(result.git.isRepo).toBe(true);
    expect(result.git.branch).toBe('feat/test');
    expect(result.totalItems).toBe(3);
    expect(result.fileCount).toBe(2);
    expect(result.dirCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildWorkspacePrompt
// ---------------------------------------------------------------------------

describe('buildWorkspacePrompt', () => {
  it('returns empty string for empty context', () => {
    expect(buildWorkspacePrompt(makeCtx())).toBe('');
  });

  it('includes project type in prompt', () => {
    const ctx = makeCtx({
      project: { type: 'node', label: 'Node.js', manifest: 'package.json', details: '"my-app"' },
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).toContain('Node.js project');
    expect(prompt).toContain('package.json');
    expect(prompt).toContain('my-app');
    expect(prompt).toContain('npm/pnpm/yarn');
  });

  it('includes Rust-specific advice', () => {
    const ctx = makeCtx({
      project: { type: 'rust', label: 'Rust', manifest: 'Cargo.toml' },
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).toContain('cargo commands');
  });

  it('includes Python-specific advice', () => {
    const ctx = makeCtx({
      project: { type: 'python', label: 'Python', manifest: 'requirements.txt' },
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).toContain('pip/poetry');
  });

  it('includes Go-specific advice', () => {
    const ctx = makeCtx({
      project: { type: 'go', label: 'Go', manifest: 'go.mod' },
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).toContain('go commands');
  });

  it('includes git info in prompt', () => {
    const ctx = makeCtx({
      git: { isRepo: true, branch: 'main', uncommittedCount: 5, repoRoot: '/app' },
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).toContain('Git Repository');
    expect(prompt).toContain('main');
    expect(prompt).toContain('5 files');
  });

  it('includes directory overview in prompt', () => {
    const ctx = makeCtx({
      totalItems: 100,
      fileCount: 80,
      dirCount: 20,
      topExtensions: [
        { ext: 'ts', count: 40 },
        { ext: 'css', count: 15 },
      ],
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).toContain('80 files');
    expect(prompt).toContain('20 folders');
    expect(prompt).toContain('.ts (40)');
    expect(prompt).toContain('.css (15)');
  });

  it('omits uncommitted changes when count is 0', () => {
    const ctx = makeCtx({
      git: { isRepo: true, branch: 'main', uncommittedCount: 0 },
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).not.toContain('Uncommitted');
  });

  it('includes monorepo info when detected', () => {
    const ctx = makeCtx({
      monorepo: { tool: 'pnpm', workspaceGlobs: ['packages/*', 'apps/*'] },
    });
    const prompt = buildWorkspacePrompt(ctx);
    expect(prompt).toContain('Monorepo');
    expect(prompt).toContain('pnpm');
  });
});
