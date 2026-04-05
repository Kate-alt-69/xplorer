import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/storage-keys', () => ({
  STORAGE_KEYS: {
    AI_AUDIT_LOG: 'xplorer:ai-audit-log',
  },
}));

import {
  logAction,
  getRecentEntries,
  clearAuditLog,
  loadAuditLog,
  getActionCountSince,
  getSessionEntries,
  startSession,
  endSession,
  getCurrentSessionId,
  formatAuditLogDisplay,
  formatSessionSummary,
} from '@/components/panels/chat-audit-log';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  // End any leftover sessions
  endSession();
});

// ---------------------------------------------------------------------------
// logAction
// ---------------------------------------------------------------------------

describe('logAction', () => {
  it('creates an audit entry with correct fields', () => {
    const entry = logAction('create_file', '/tmp/test.txt', 'success', 'user');

    expect(entry.actionType).toBe('create_file');
    expect(entry.path).toBe('/tmp/test.txt');
    expect(entry.result).toBe('success');
    expect(entry.approvedBy).toBe('user');
    expect(entry.id).toMatch(/^audit-/);
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('includes extra fields (destination, command, error)', () => {
    const entry = logAction('move_file', '/tmp/a.txt', 'failed', 'auto', {
      destination: '/tmp/b.txt',
      errorMessage: 'Permission denied',
    });

    expect(entry.destination).toBe('/tmp/b.txt');
    expect(entry.errorMessage).toBe('Permission denied');
  });

  it('persists entries to localStorage', () => {
    logAction('create_file', '/tmp/file1.txt', 'success', 'user');
    logAction('delete_file', '/tmp/file2.txt', 'rejected', 'none');

    const entries = loadAuditLog();
    expect(entries).toHaveLength(2);
  });

  it('prepends new entries (most recent first)', () => {
    logAction('create_file', '/tmp/first.txt', 'success', 'user');
    logAction('create_file', '/tmp/second.txt', 'success', 'user');

    const entries = loadAuditLog();
    expect(entries[0].path).toBe('/tmp/second.txt');
    expect(entries[1].path).toBe('/tmp/first.txt');
  });
});

// ---------------------------------------------------------------------------
// getRecentEntries
// ---------------------------------------------------------------------------

describe('getRecentEntries', () => {
  it('returns empty array when no entries', () => {
    expect(getRecentEntries()).toEqual([]);
  });

  it('returns most recent N entries', () => {
    for (let i = 0; i < 10; i++) {
      logAction('create_file', `/tmp/file${i}.txt`, 'success', 'user');
    }

    const recent = getRecentEntries(5);
    expect(recent).toHaveLength(5);
  });

  it('defaults to 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      logAction('create_file', `/tmp/file${i}.txt`, 'success', 'user');
    }

    const recent = getRecentEntries();
    expect(recent).toHaveLength(50);
  });
});

// ---------------------------------------------------------------------------
// clearAuditLog
// ---------------------------------------------------------------------------

describe('clearAuditLog', () => {
  it('removes all entries', () => {
    logAction('create_file', '/tmp/test.txt', 'success', 'user');
    expect(loadAuditLog()).toHaveLength(1);

    clearAuditLog();
    expect(loadAuditLog()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getActionCountSince
// ---------------------------------------------------------------------------

describe('getActionCountSince', () => {
  it('counts successful actions within the time window', () => {
    logAction('create_file', '/tmp/f1.txt', 'success', 'user');
    logAction('create_file', '/tmp/f2.txt', 'success', 'user');
    logAction('create_file', '/tmp/f3.txt', 'rejected', 'none');

    const count = getActionCountSince(60_000); // last minute
    expect(count).toBe(2); // only successful ones
  });
});

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

describe('session tracking', () => {
  it('starts and ends a session', () => {
    const sessionId = startSession();
    expect(sessionId).toMatch(/^session-/);
    expect(getCurrentSessionId()).toBe(sessionId);

    logAction('create_file', '/tmp/test.txt', 'success', 'user');
    logAction('delete_file', '/tmp/old.txt', 'success', 'user');

    const summary = endSession();
    expect(summary).not.toBeNull();
    expect(summary!.totalActions).toBe(2);
    expect(summary!.filesCreated).toBe(1);
    expect(summary!.filesDeleted).toBe(1);
    expect(getCurrentSessionId()).toBeNull();
  });

  it('returns null when ending without starting', () => {
    const summary = endSession();
    expect(summary).toBeNull();
  });

  it('tracks session id on logged actions', () => {
    const sessionId = startSession();
    logAction('create_file', '/tmp/test.txt', 'success', 'user');

    const entries = getSessionEntries(sessionId);
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe(sessionId);

    endSession();
  });
});

// ---------------------------------------------------------------------------
// formatAuditLogDisplay
// ---------------------------------------------------------------------------

describe('formatAuditLogDisplay', () => {
  it('shows "No actions" when log is empty', () => {
    const display = formatAuditLogDisplay();
    expect(display).toContain('No actions recorded');
  });

  it('formats entries as a table', () => {
    logAction('create_file', '/tmp/test.txt', 'success', 'user');
    logAction('delete_file', '/tmp/old.txt', 'blocked', 'security-rule', {
      blockedByRule: 'path-restriction',
    });

    const display = formatAuditLogDisplay();
    expect(display).toContain('Action Audit Log');
    expect(display).toContain('create_file');
    expect(display).toContain('OK');
    expect(display).toContain('BLOCKED');
    expect(display).toContain('Summary');
  });
});

// ---------------------------------------------------------------------------
// formatSessionSummary
// ---------------------------------------------------------------------------

describe('formatSessionSummary', () => {
  it('formats a session summary', () => {
    const summary = {
      filesCreated: 3,
      filesEdited: 1,
      filesDeleted: 0,
      filesMoved: 0,
      filesCopied: 0,
      filesRenamed: 0,
      directoriesCreated: 1,
      commandsExecuted: 0,
      actionsRejected: 1,
      actionsBlocked: 0,
      totalActions: 6,
      durationMs: 5000,
    };

    const display = formatSessionSummary(summary);
    expect(display).toContain('Session Summary');
    expect(display).toContain('3 files created');
    expect(display).toContain('1 files edited');
    expect(display).toContain('1 directories created');
    expect(display).toContain('1 actions rejected');
    expect(display).toContain('Total');
  });

  it('shows "No actions" for empty summary', () => {
    const summary = {
      filesCreated: 0,
      filesEdited: 0,
      filesDeleted: 0,
      filesMoved: 0,
      filesCopied: 0,
      filesRenamed: 0,
      directoriesCreated: 0,
      commandsExecuted: 0,
      actionsRejected: 0,
      actionsBlocked: 0,
      totalActions: 0,
      durationMs: 100,
    };

    const display = formatSessionSummary(summary);
    expect(display).toContain('No actions performed');
  });
});
