/**
 * Security rules engine for the AI agent.
 * Configurable rules that restrict what actions the agent can perform:
 *
 * - Path restrictions: block actions on system directories
 * - File type restrictions: prevent deleting protected file types
 * - Rate limiting: max operations per minute to prevent runaway loops
 *
 * Rules are stored in localStorage and configurable via `/security` slash command.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { getActionCountSince, logAction } from './chat-audit-log';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityRules {
  /** Paths the agent cannot touch. Matched as prefix. */
  blockedPaths: string[];
  /** File extensions that cannot be deleted. Without leading dot. */
  protectedExtensions: string[];
  /** Max file operations (mutating) per minute */
  maxOpsPerMinute: number;
  /** Whether security rules are enabled at all */
  enabled: boolean;
}

export interface SecurityCheckResult {
  allowed: boolean;
  /** Human-readable reason for blocking */
  reason?: string;
  /** Which rule blocked the action */
  ruleName?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BLOCKED_PATHS_UNIX = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/boot',
  '/proc',
  '/sys',
  '/dev',
  '/lib',
  '/lib64',
  '/root',
];

const DEFAULT_BLOCKED_PATHS_WINDOWS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
];

const DEFAULT_PROTECTED_EXTENSIONS = [
  'key',
  'pem',
  'crt',
  'env',
  'p12',
  'pfx',
  'jks',
  'keystore',
  'id_rsa',
  'id_ed25519',
];

const DEFAULT_MAX_OPS_PER_MINUTE = 20;

export const DEFAULT_SECURITY_RULES: SecurityRules = {
  blockedPaths: [...DEFAULT_BLOCKED_PATHS_UNIX, ...DEFAULT_BLOCKED_PATHS_WINDOWS],
  protectedExtensions: [...DEFAULT_PROTECTED_EXTENSIONS],
  maxOpsPerMinute: DEFAULT_MAX_OPS_PER_MINUTE,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Mutating actions that count toward rate limiting
// ---------------------------------------------------------------------------

const MUTATING_ACTIONS = new Set([
  'create_file',
  'edit_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'create_directory',
  'run_command',
]);

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const loadSecurityRules = (): SecurityRules => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AI_SECURITY_RULES);
    if (!raw) return { ...DEFAULT_SECURITY_RULES };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SECURITY_RULES };
    const obj = parsed as Record<string, unknown>;
    return {
      blockedPaths: Array.isArray(obj.blockedPaths)
        ? (obj.blockedPaths as string[])
        : DEFAULT_SECURITY_RULES.blockedPaths,
      protectedExtensions: Array.isArray(obj.protectedExtensions)
        ? (obj.protectedExtensions as string[])
        : DEFAULT_SECURITY_RULES.protectedExtensions,
      maxOpsPerMinute:
        typeof obj.maxOpsPerMinute === 'number' ? obj.maxOpsPerMinute : DEFAULT_MAX_OPS_PER_MINUTE,
      enabled: typeof obj.enabled === 'boolean' ? obj.enabled : true,
    };
  } catch {
    return { ...DEFAULT_SECURITY_RULES };
  }
};

export const saveSecurityRules = (rules: SecurityRules): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.AI_SECURITY_RULES, JSON.stringify(rules));
  } catch {
    // localStorage full or unavailable
  }
};

export const resetSecurityRules = (): void => {
  saveSecurityRules({ ...DEFAULT_SECURITY_RULES });
};

// ---------------------------------------------------------------------------
// Path normalization for comparison
// ---------------------------------------------------------------------------

const normalizePath = (p: string): string =>
  p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const getFileExtension = (path: string): string => {
  const basename = path.split(/[/\\]/).pop() ?? '';
  // Handle dotfiles like .env
  if (basename.startsWith('.') && !basename.includes('.', 1)) {
    return basename.slice(1).toLowerCase();
  }
  const parts = basename.split('.');
  if (parts.length < 2) return '';
  return (parts.pop() ?? '').toLowerCase();
};

// ---------------------------------------------------------------------------
// Security check engine
// ---------------------------------------------------------------------------

/**
 * Check whether an action is allowed by the current security rules.
 * Also performs rate-limit checking for mutating actions.
 */
export const checkSecurity = (
  actionType: string,
  path: string,
  extra?: { destination?: string },
): SecurityCheckResult => {
  const rules = loadSecurityRules();

  // If rules are disabled, allow everything
  if (!rules.enabled) {
    return { allowed: true };
  }

  const normalizedPath = normalizePath(path);

  // 1. Path restriction check
  for (const blockedPath of rules.blockedPaths) {
    const normalizedBlocked = normalizePath(blockedPath);
    if (
      normalizedPath === normalizedBlocked ||
      normalizedPath.startsWith(`${normalizedBlocked}/`)
    ) {
      return {
        allowed: false,
        reason: `Action blocked: "${path}" is inside a protected system directory (${blockedPath}).`,
        ruleName: 'path-restriction',
      };
    }
  }

  // Also check destination path for move/copy/rename
  if (extra?.destination) {
    const normalizedDest = normalizePath(extra.destination);
    for (const blockedPath of rules.blockedPaths) {
      const normalizedBlocked = normalizePath(blockedPath);
      if (
        normalizedDest === normalizedBlocked ||
        normalizedDest.startsWith(`${normalizedBlocked}/`)
      ) {
        return {
          allowed: false,
          reason: `Action blocked: destination "${extra.destination}" is inside a protected system directory (${blockedPath}).`,
          ruleName: 'path-restriction',
        };
      }
    }
  }

  // 2. File type restriction check (for delete, edit, and create actions)
  if (actionType === 'delete_file' || actionType === 'edit_file' || actionType === 'create_file') {
    const ext = getFileExtension(path);
    if (ext && rules.protectedExtensions.includes(ext)) {
      const verb =
        actionType === 'delete_file' ? 'delete' : actionType === 'edit_file' ? 'edit' : 'create';
      return {
        allowed: false,
        reason: `Action blocked: cannot ${verb} .${ext} files (protected file type).`,
        ruleName: 'file-type-restriction',
      };
    }
  }

  // 3. Rate limiting for mutating actions
  if (MUTATING_ACTIONS.has(actionType)) {
    const recentCount = getActionCountSince(60_000); // last 60 seconds
    if (recentCount >= rules.maxOpsPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${recentCount}/${rules.maxOpsPerMinute} operations in the last minute. Please wait before performing more actions.`,
        ruleName: 'rate-limit',
      };
    }
  }

  return { allowed: true };
};

/**
 * Check security and log the result to the audit log.
 * Returns the check result; if blocked, the action is logged as 'blocked'.
 */
export const checkAndLogSecurity = (
  actionType: string,
  path: string,
  extra?: { destination?: string; command?: string },
): SecurityCheckResult => {
  const result = checkSecurity(actionType, path, extra);

  if (!result.allowed) {
    logAction(actionType, path, 'blocked', 'security-rule', {
      destination: extra?.destination,
      command: extra?.command,
      errorMessage: result.reason,
      blockedByRule: result.ruleName,
    });
  }

  return result;
};

// ---------------------------------------------------------------------------
// /security command display
// ---------------------------------------------------------------------------

/**
 * Format current security rules for display.
 */
export const formatSecurityRulesDisplay = (): string => {
  const rules = loadSecurityRules();

  const lines: string[] = ['**Security Rules**\n'];

  lines.push(`**Status:** ${rules.enabled ? 'Enabled' : 'Disabled'}\n`);

  lines.push('**Blocked paths** (agent cannot create/edit/delete here):');
  if (rules.blockedPaths.length === 0) {
    lines.push('- (none)');
  } else {
    for (const p of rules.blockedPaths) {
      lines.push(`- \`${p}\``);
    }
  }
  lines.push('');

  lines.push('**Protected file types** (cannot be created, edited, or deleted):');
  if (rules.protectedExtensions.length === 0) {
    lines.push('- (none)');
  } else {
    lines.push(`- ${rules.protectedExtensions.map((e) => `.${e}`).join(', ')}`);
  }
  lines.push('');

  lines.push(`**Rate limit:** ${rules.maxOpsPerMinute} mutating operations per minute`);
  lines.push('');

  lines.push('**Configuration:**');
  lines.push('Say "add blocked path /some/path" or "remove blocked path /etc"');
  lines.push('Say "protect .xyz" or "unprotect .env"');
  lines.push('Say "set rate limit 30" to change the rate limit');
  lines.push('Say "disable security" or "enable security" to toggle');
  lines.push('Say "reset security" to restore defaults');

  return lines.join('\n');
};
