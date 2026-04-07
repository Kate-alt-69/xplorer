/**
 * Built-in agent template definitions for one-click agent launching.
 *
 * Each template pre-fills the New Agent form with a name, prompt,
 * default model, and estimated cost, so users can launch common
 * agent workflows without writing custom prompts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentTemplate {
  /** Unique template identifier */
  id: string;
  /** i18n key for the template name */
  nameKey: string;
  /** i18n key for the template description */
  descriptionKey: string;
  /** Lucide icon name (resolved in the component) */
  icon: string;
  /** System prompt that configures the agent's behavior */
  systemPrompt: string;
  /** Default model for this template */
  defaultModel: string;
  /** Estimated cost per run in USD (rough guide) */
  estimatedCostUsd: number;
  /** Accent color for the template card */
  accentColor: string;
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'code-reviewer',
    nameKey: 'agentManager.templates.codeReviewer',
    descriptionKey: 'agentManager.templates.codeReviewerDesc',
    icon: 'SearchCode',
    systemPrompt:
      'You are a senior code reviewer. Analyze all source files in the current directory. For each file, identify: bugs, code smells, security issues, performance problems, and style inconsistencies. Provide specific line-level feedback with suggested fixes. Prioritize issues by severity (critical > major > minor). Output a structured review report.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.15,
    accentColor: 'var(--xp-blue, #7aa2f7)',
  },
  {
    id: 'test-writer',
    nameKey: 'agentManager.templates.testWriter',
    descriptionKey: 'agentManager.templates.testWriterDesc',
    icon: 'FlaskConical',
    systemPrompt:
      "You are a test engineer. Scan the current directory for source files that lack corresponding test files. For each untested file, generate comprehensive test suites covering: happy paths, edge cases, error handling, and boundary conditions. Use the project's existing test framework and conventions. Aim for high coverage of public APIs.",
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.2,
    accentColor: 'var(--xp-green, #73daca)',
  },
  {
    id: 'bug-fixer',
    nameKey: 'agentManager.templates.bugFixer',
    descriptionKey: 'agentManager.templates.bugFixerDesc',
    icon: 'Bug',
    systemPrompt:
      'You are a debugging specialist. Look for error logs, stack traces, and failing tests in the current directory. Diagnose root causes by reading relevant source code. Propose and implement minimal, targeted fixes. Verify each fix does not introduce regressions. Explain the root cause and the fix clearly.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.15,
    accentColor: 'var(--xp-red, #f7768e)',
  },
  {
    id: 'doc-writer',
    nameKey: 'agentManager.templates.docWriter',
    descriptionKey: 'agentManager.templates.docWriterDesc',
    icon: 'BookOpen',
    systemPrompt:
      'You are a technical documentation writer. Analyze the codebase in the current directory and generate: a comprehensive README.md with project overview, setup instructions, and usage examples; JSDoc/TSDoc comments for all exported functions and types; inline comments for complex logic. Follow the existing documentation style if one exists.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.12,
    accentColor: 'var(--xp-purple, #bb9af7)',
  },
  {
    id: 'refactorer',
    nameKey: 'agentManager.templates.refactorer',
    descriptionKey: 'agentManager.templates.refactorerDesc',
    icon: 'RefreshCw',
    systemPrompt:
      'You are a refactoring expert. Analyze the code in the current directory for: code duplication, overly complex functions, poor naming, tight coupling, and violations of SOLID principles. Suggest specific refactoring operations (extract method, rename, move, inline, etc.) and apply them while preserving behavior. Run existing tests after each change.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.18,
    accentColor: 'var(--xp-cyan, #7dcfff)',
  },
  {
    id: 'security-auditor',
    nameKey: 'agentManager.templates.securityAuditor',
    descriptionKey: 'agentManager.templates.securityAuditorDesc',
    icon: 'ShieldAlert',
    systemPrompt:
      'You are a security auditor. Scan all source files in the current directory for: injection vulnerabilities (SQL, XSS, command), authentication/authorization flaws, hardcoded secrets, insecure dependencies, unsafe file operations, and OWASP Top 10 issues. Rate each finding by severity and provide remediation steps with code examples.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.15,
    accentColor: 'var(--xp-warning, #e0af68)',
  },
  {
    id: 'perf-optimizer',
    nameKey: 'agentManager.templates.perfOptimizer',
    descriptionKey: 'agentManager.templates.perfOptimizerDesc',
    icon: 'Gauge',
    systemPrompt:
      'You are a performance optimization specialist. Analyze the codebase for: unnecessary re-renders, expensive computations, N+1 queries, missing memoization, large bundle imports, unoptimized loops, and memory leaks. Provide before/after benchmarks where possible. Apply optimizations that maintain readability and correctness.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.15,
    accentColor: 'var(--xp-orange, #ff9e64)',
  },
  {
    id: 'project-setup',
    nameKey: 'agentManager.templates.projectSetup',
    descriptionKey: 'agentManager.templates.projectSetupDesc',
    icon: 'FolderPlus',
    systemPrompt:
      'You are a project scaffolding assistant. Help set up a new project with proper directory structure, configuration files (tsconfig, eslint, prettier, package.json), CI/CD templates, gitignore, and initial boilerplate code. Ask the user about their preferred stack (language, framework, testing, linting) and generate a complete project skeleton.',
    defaultModel: 'claude-sonnet-4-20250514',
    estimatedCostUsd: 0.1,
    accentColor: 'var(--xp-teal, #2ac3de)',
  },
];
