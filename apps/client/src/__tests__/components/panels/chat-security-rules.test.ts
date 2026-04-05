import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/storage-keys', () => ({
  STORAGE_KEYS: {
    AI_SECURITY_RULES: 'xplorer:ai-security-rules',
    AI_AUDIT_LOG: 'xplorer:ai-audit-log',
  },
}));

import {
  loadSecurityRules,
  saveSecurityRules,
  resetSecurityRules,
  checkSecurity,
  DEFAULT_SECURITY_RULES,
  formatSecurityRulesDisplay,
  type SecurityRules,
} from '@/components/panels/chat-security-rules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// loadSecurityRules / saveSecurityRules
// ---------------------------------------------------------------------------

describe('loadSecurityRules', () => {
  it('returns defaults when nothing is saved', () => {
    const rules = loadSecurityRules();
    expect(rules.enabled).toBe(true);
    expect(rules.blockedPaths.length).toBeGreaterThan(0);
    expect(rules.protectedExtensions.length).toBeGreaterThan(0);
    expect(rules.maxOpsPerMinute).toBe(20);
  });

  it('loads saved rules correctly', () => {
    const custom: SecurityRules = {
      blockedPaths: ['/custom/blocked'],
      protectedExtensions: ['xyz'],
      maxOpsPerMinute: 50,
      enabled: false,
    };
    saveSecurityRules(custom);

    const loaded = loadSecurityRules();
    expect(loaded.blockedPaths).toEqual(['/custom/blocked']);
    expect(loaded.protectedExtensions).toEqual(['xyz']);
    expect(loaded.maxOpsPerMinute).toBe(50);
    expect(loaded.enabled).toBe(false);
  });

  it('returns defaults for corrupt data', () => {
    localStorage.setItem('xplorer:ai-security-rules', 'not-json');
    const rules = loadSecurityRules();
    expect(rules.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetSecurityRules
// ---------------------------------------------------------------------------

describe('resetSecurityRules', () => {
  it('restores defaults', () => {
    saveSecurityRules({
      blockedPaths: [],
      protectedExtensions: [],
      maxOpsPerMinute: 999,
      enabled: false,
    });

    resetSecurityRules();
    const rules = loadSecurityRules();
    expect(rules.enabled).toBe(true);
    expect(rules.maxOpsPerMinute).toBe(20);
    expect(rules.blockedPaths.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkSecurity — path restriction
// ---------------------------------------------------------------------------

describe('checkSecurity — path restriction', () => {
  it('blocks actions on /etc', () => {
    const result = checkSecurity('create_file', '/etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.ruleName).toBe('path-restriction');
  });

  it('blocks actions on /usr subdirectories', () => {
    const result = checkSecurity('edit_file', '/usr/local/bin/something');
    expect(result.allowed).toBe(false);
    expect(result.ruleName).toBe('path-restriction');
  });

  it('blocks Windows system paths', () => {
    const result = checkSecurity('delete_file', 'C:\\Windows\\System32\\file.dll');
    expect(result.allowed).toBe(false);
    expect(result.ruleName).toBe('path-restriction');
  });

  it('allows actions on user directories', () => {
    const result = checkSecurity('create_file', '/home/user/documents/file.txt');
    expect(result.allowed).toBe(true);
  });

  it('blocks destination paths for move/copy', () => {
    const result = checkSecurity('move_file', '/home/user/file.txt', {
      destination: '/etc/evil.conf',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('destination');
  });

  it('allows everything when rules are disabled', () => {
    saveSecurityRules({ ...DEFAULT_SECURITY_RULES, enabled: false });
    const result = checkSecurity('create_file', '/etc/passwd');
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkSecurity — file type restriction
// ---------------------------------------------------------------------------

describe('checkSecurity — file type restriction', () => {
  it('blocks deleting .key files', () => {
    const result = checkSecurity('delete_file', '/home/user/secret.key');
    expect(result.allowed).toBe(false);
    expect(result.ruleName).toBe('file-type-restriction');
  });

  it('blocks deleting .pem files', () => {
    const result = checkSecurity('delete_file', '/home/user/cert.pem');
    expect(result.allowed).toBe(false);
  });

  it('blocks deleting .env files', () => {
    const result = checkSecurity('delete_file', '/home/user/.env');
    expect(result.allowed).toBe(false);
  });

  it('allows deleting regular files', () => {
    const result = checkSecurity('delete_file', '/home/user/notes.txt');
    expect(result.allowed).toBe(true);
  });

  it('file type restriction only applies to delete_file', () => {
    // Creating a .key file is fine
    const result = checkSecurity('create_file', '/home/user/secret.key');
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkSecurity — rate limiting
// ---------------------------------------------------------------------------

describe('checkSecurity — rate limiting', () => {
  it('allows actions when under the limit', () => {
    // Fresh state, no recent actions
    const result = checkSecurity('create_file', '/home/user/file.txt');
    expect(result.allowed).toBe(true);
  });

  it('blocks mutating actions when rate limit is reached', () => {
    // Fill the audit log with recent successes to trigger rate limit
    const now = Date.now();
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `audit-${i}`,
      timestamp: now - 1000 * i,
      actionType: 'create_file',
      path: `/tmp/file${i}.txt`,
      result: 'success',
      approvedBy: 'user',
    }));
    localStorage.setItem('xplorer:ai-audit-log', JSON.stringify(entries));

    const result = checkSecurity('create_file', '/home/user/new.txt');
    expect(result.allowed).toBe(false);
    expect(result.ruleName).toBe('rate-limit');
  });

  it('does not rate-limit read-only actions', () => {
    const now = Date.now();
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `audit-${i}`,
      timestamp: now - 1000 * i,
      actionType: 'create_file',
      path: `/tmp/file${i}.txt`,
      result: 'success',
      approvedBy: 'user',
    }));
    localStorage.setItem('xplorer:ai-audit-log', JSON.stringify(entries));

    // list_directory is read-only and not in MUTATING_ACTIONS
    const result = checkSecurity('list_directory', '/home/user');
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatSecurityRulesDisplay
// ---------------------------------------------------------------------------

describe('formatSecurityRulesDisplay', () => {
  it('returns a formatted display string', () => {
    const display = formatSecurityRulesDisplay();
    expect(display).toContain('Security Rules');
    expect(display).toContain('Status');
    expect(display).toContain('Blocked paths');
    expect(display).toContain('Protected file types');
    expect(display).toContain('Rate limit');
  });
});
