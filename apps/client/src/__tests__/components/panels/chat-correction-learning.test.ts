import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/storage-keys', () => ({
  STORAGE_KEYS: {
    AI_AGENT_MEMORY: 'xplorer:ai-agent-memory',
  },
}));

// Mock the agent memory module so we can observe calls without touching localStorage
const mockAddFolderObservation = vi.fn(() => ({
  id: 'obs-1',
  text: 'test',
  createdAt: Date.now(),
  tags: ['correction'],
}));
const mockAddGlobalPreference = vi.fn(() => ({
  id: 'pref-1',
  text: 'test',
  createdAt: Date.now(),
  tags: ['correction'],
}));

vi.mock('@/components/panels/chat-agent-memory', () => ({
  addFolderObservation: (...args: unknown[]) => mockAddFolderObservation(...args),
  addGlobalPreference: (...args: unknown[]) => mockAddGlobalPreference(...args),
}));

import {
  detectAndLearnCorrection,
  learnFromPositiveFeedback,
  learnFromNegativeFeedback,
  buildFeedbackPrompt,
  type FeedbackEntry,
} from '@/components/panels/chat-correction-learning';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// detectAndLearnCorrection — correction detection
// ---------------------------------------------------------------------------

describe('detectAndLearnCorrection', () => {
  it('detects "no" as a correction', () => {
    const result = detectAndLearnCorrection('No, do it differently', 'prev response', '/home/user');
    expect(result.isCorrection).toBe(true);
  });

  it('detects "nope" as a correction', () => {
    const result = detectAndLearnCorrection('Nope, that is wrong', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
  });

  it('detects "not like that" as a correction', () => {
    const result = detectAndLearnCorrection('not like that, try again', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
  });

  it('detects "actually" as a correction', () => {
    const result = detectAndLearnCorrection('actually, I want them sorted by date', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
  });

  it('detects "instead" as a correction', () => {
    const result = detectAndLearnCorrection('instead, move them to archive', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
  });

  it('detects "I prefer" as a correction', () => {
    const result = detectAndLearnCorrection('I prefer alphabetical order', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
  });

  it('detects "always" as a correction', () => {
    const result = detectAndLearnCorrection('always use lowercase names', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
  });

  it('detects "never" as a correction (with supported verb)', () => {
    const result = detectAndLearnCorrection('never do that again', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
  });

  it('does not detect "never" with unsupported verb', () => {
    const result = detectAndLearnCorrection('never delete hidden files', 'prev', '/tmp');
    expect(result.isCorrection).toBe(false);
  });

  it('detects "from now on" as a correction', () => {
    const result = detectAndLearnCorrection(
      'from now on, use kebab-case filenames',
      'prev',
      '/tmp',
    );
    expect(result.isCorrection).toBe(true);
  });

  it('detects "remember that" as a correction', () => {
    const result = detectAndLearnCorrection(
      'remember that I like tabs over spaces',
      'prev',
      '/tmp',
    );
    expect(result.isCorrection).toBe(true);
  });

  it('does NOT detect normal messages as corrections', () => {
    const result = detectAndLearnCorrection('Please list the files here', 'prev', '/tmp');
    expect(result.isCorrection).toBe(false);
  });

  it('does NOT detect "nothing" as a correction', () => {
    const result = detectAndLearnCorrection('Can you organize my photos?', 'prev', '/tmp');
    expect(result.isCorrection).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectAndLearnCorrection — preference extraction
// ---------------------------------------------------------------------------

describe('detectAndLearnCorrection — preference extraction', () => {
  it('extracts "I prefer X" preferences', () => {
    const result = detectAndLearnCorrection('I prefer alphabetical order', 'prev', '/tmp');
    expect(result.preference).toBe('User prefers alphabetical order');
  });

  it('extracts "always X" preferences', () => {
    const result = detectAndLearnCorrection('always use lowercase names', 'prev', '/tmp');
    expect(result.preference).toBe('Always use lowercase names');
  });

  it('extracts "never X" preferences', () => {
    const result = detectAndLearnCorrection('never use uppercase names', 'prev', '/tmp');
    expect(result.preference).toBe('Never use uppercase names');
  });

  it('extracts "from now on X" preferences', () => {
    const result = detectAndLearnCorrection('from now on, use kebab-case', 'prev', '/tmp');
    expect(result.preference).toBe('use kebab-case');
  });

  it('extracts "remember that X" preferences', () => {
    const result = detectAndLearnCorrection('remember that I like tabs', 'prev', '/tmp');
    expect(result.preference).toBe('I like tabs');
  });

  it('strips correction prefixes and returns remainder', () => {
    const result = detectAndLearnCorrection(
      'No, sort them by date not by name please',
      'prev',
      '/tmp',
    );
    expect(result.isCorrection).toBe(true);
    expect(result.preference).not.toBeNull();
    expect(result.preference!.length).toBeGreaterThan(0);
  });

  it('returns null preference for very short corrections', () => {
    const result = detectAndLearnCorrection('No.', 'prev', '/tmp');
    expect(result.isCorrection).toBe(true);
    expect(result.preference).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectAndLearnCorrection — global vs folder-specific
// ---------------------------------------------------------------------------

describe('detectAndLearnCorrection — global preference detection', () => {
  it('marks "always" as global preference', () => {
    const result = detectAndLearnCorrection('always use lowercase names', 'prev', '/tmp');
    expect(result.isGlobal).toBe(true);
  });

  it('marks "never" as global preference', () => {
    const result = detectAndLearnCorrection('never use uppercase names', 'prev', '/tmp');
    expect(result.isGlobal).toBe(true);
  });

  it('marks "from now on" as global preference', () => {
    const result = detectAndLearnCorrection('from now on, use kebab-case', 'prev', '/tmp');
    expect(result.isGlobal).toBe(true);
  });

  it('marks plain corrections as folder-specific', () => {
    const result = detectAndLearnCorrection('No, sort them by date instead', 'prev', '/tmp');
    expect(result.isGlobal).toBe(false);
  });

  it('saves global preferences via addGlobalPreference', () => {
    detectAndLearnCorrection('always use lowercase names', 'prev', '/home/user');
    expect(mockAddGlobalPreference).toHaveBeenCalled();
  });

  it('saves folder observations via addFolderObservation', () => {
    detectAndLearnCorrection('No, sort by date instead of name', 'prev', '/home/user');
    expect(mockAddFolderObservation).toHaveBeenCalledWith(
      '/home/user',
      expect.any(String),
      expect.arrayContaining(['correction', 'preference']),
    );
  });
});

// ---------------------------------------------------------------------------
// learnFromPositiveFeedback
// ---------------------------------------------------------------------------

describe('learnFromPositiveFeedback', () => {
  it('saves a positive observation to the folder', () => {
    learnFromPositiveFeedback('organize my files', 'Done! I organized them by type.', '/home/user');
    expect(mockAddFolderObservation).toHaveBeenCalledWith(
      '/home/user',
      expect.stringContaining('Good approach'),
      expect.arrayContaining(['feedback', 'positive']),
    );
  });

  it('saves globally if no current path', () => {
    learnFromPositiveFeedback('organize my files', 'Done!', '');
    expect(mockAddGlobalPreference).toHaveBeenCalled();
  });

  it('truncates long AI responses in the summary', () => {
    const longResponse = 'A'.repeat(200);
    learnFromPositiveFeedback('test', longResponse, '/tmp');
    const call = mockAddFolderObservation.mock.calls[0];
    expect((call[1] as string).includes('...')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// learnFromNegativeFeedback
// ---------------------------------------------------------------------------

describe('learnFromNegativeFeedback', () => {
  it('saves a negative correction to the folder', () => {
    learnFromNegativeFeedback('sort by date not name', 'organize my files', '/home/user');
    expect(mockAddFolderObservation).toHaveBeenCalledWith(
      '/home/user',
      expect.stringContaining('sort by date'),
      expect.arrayContaining(['feedback', 'negative', 'correction']),
    );
  });

  it('detects global corrections (always/never)', () => {
    learnFromNegativeFeedback('always use date sorting', 'organize', '/home/user');
    expect(mockAddGlobalPreference).toHaveBeenCalled();
  });

  it('saves globally if no current path', () => {
    learnFromNegativeFeedback('sort differently', 'test', '');
    expect(mockAddGlobalPreference).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackPrompt
// ---------------------------------------------------------------------------

describe('buildFeedbackPrompt', () => {
  it('returns empty string for empty feedback list', () => {
    expect(buildFeedbackPrompt([])).toBe('');
  });

  it('formats positive feedback entries', () => {
    const entries: FeedbackEntry[] = [
      {
        id: '1',
        messageIndex: 1,
        type: 'positive',
        responsePreview: 'preview',
        userPrompt: 'organize my photos',
        folderPath: '/tmp',
        createdAt: Date.now(),
      },
    ];
    const result = buildFeedbackPrompt(entries);
    expect(result).toContain('[+]');
    expect(result).toContain('organize my photos');
    expect(result).toContain('continue this approach');
  });

  it('formats negative feedback entries with correction text', () => {
    const entries: FeedbackEntry[] = [
      {
        id: '2',
        messageIndex: 2,
        type: 'negative',
        correctionText: 'sort by date instead',
        responsePreview: 'preview',
        userPrompt: 'sort files',
        folderPath: '/tmp',
        createdAt: Date.now(),
      },
    ];
    const result = buildFeedbackPrompt(entries);
    expect(result).toContain('[-]');
    expect(result).toContain('sort by date instead');
  });

  it('formats negative feedback entries without correction text', () => {
    const entries: FeedbackEntry[] = [
      {
        id: '3',
        messageIndex: 3,
        type: 'negative',
        responsePreview: 'preview',
        userPrompt: 'something',
        folderPath: '/tmp',
        createdAt: Date.now(),
      },
    ];
    const result = buildFeedbackPrompt(entries);
    expect(result).toContain('no details given');
  });

  it('limits to 10 recent entries', () => {
    const entries: FeedbackEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      messageIndex: i,
      type: 'positive' as const,
      responsePreview: 'preview',
      userPrompt: `prompt ${i}`,
      folderPath: '/tmp',
      createdAt: Date.now(),
    }));
    const result = buildFeedbackPrompt(entries);
    // Count [+] markers -- should be at most 10
    const matches = result.match(/\[\+\]/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(10);
  });
});
