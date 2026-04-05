/**
 * Content scanner for AI-generated file content.
 * Before the AI creates or edits a file, scan the content for secrets
 * (API keys, tokens, passwords) and return warnings if detected.
 *
 * This module does NOT block operations — it only produces warnings
 * that are displayed on the permission card so the user can decide.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecretWarning {
  /** The pattern label that matched */
  label: string;
  /** Short description of what was detected */
  description: string;
  /** The (partially redacted) matched fragment */
  redactedMatch: string;
  /** Line number where the match was found (1-based), if determinable */
  line?: number;
}

export interface ScanResult {
  /** Whether any potential secrets were detected */
  hasSecrets: boolean;
  /** Individual warnings for each detected pattern */
  warnings: SecretWarning[];
}

// ---------------------------------------------------------------------------
// Secret patterns
// ---------------------------------------------------------------------------

interface SecretPattern {
  label: string;
  description: string;
  /** Regex to test against content */
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    label: 'OpenAI API Key',
    description: 'Detected an OpenAI API key prefix',
    regex: /sk-[A-Za-z0-9]{20,}/g,
  },
  {
    label: 'GitHub Personal Access Token',
    description: 'Detected a GitHub personal access token',
    regex: /ghp_[A-Za-z0-9]{36,}/g,
  },
  {
    label: 'GitHub OAuth Token',
    description: 'Detected a GitHub OAuth access token',
    regex: /gho_[A-Za-z0-9]{36,}/g,
  },
  {
    label: 'AWS Access Key',
    description: 'Detected an AWS access key ID',
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    label: 'Private Key',
    description: 'Detected a PEM private key header',
    regex: /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
  },
  {
    label: 'Password Assignment',
    description: 'Detected a hardcoded password assignment',
    regex: /password\s*=\s*["'][^"']{4,}["']/gi,
  },
  {
    label: 'Token Assignment',
    description: 'Detected a hardcoded token assignment',
    regex: /token\s*=\s*["'][A-Za-z0-9_\-.]{8,}["']/gi,
  },
  {
    label: 'Bearer Token',
    description: 'Detected a Bearer authentication token',
    regex: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g,
  },
  {
    label: 'Slack Token',
    description: 'Detected a Slack token',
    regex: /xox[bporas]-[A-Za-z0-9-]{10,}/g,
  },
  {
    label: 'Generic Secret',
    description: 'Detected a potential secret/API key assignment',
    regex: /(?:api_?key|secret_?key|api_?secret)\s*=\s*["'][A-Za-z0-9_\-.]{8,}["']/gi,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Redact the middle portion of a matched string, showing only the first
 * and last few characters to help the user identify the match.
 */
const redact = (match: string, visibleChars = 6): string => {
  if (match.length <= visibleChars * 2) {
    return `${match.slice(0, visibleChars)}***`;
  }
  return `${match.slice(0, visibleChars)}***${match.slice(-visibleChars)}`;
};

/**
 * Find the 1-based line number of a character offset within content.
 */
const lineOfOffset = (content: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan content for potential secrets.
 * Returns a ScanResult describing any findings.
 */
export const scanContentForSecrets = (content: string): ScanResult => {
  if (!content || content.length === 0) {
    return { hasSecrets: false, warnings: [] };
  }

  const warnings: SecretWarning[] = [];
  const seenLabels = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    // Reset regex state for global patterns
    pattern.regex.lastIndex = 0;

    let match: RegExpExecArray | null = pattern.regex.exec(content);
    while (match !== null) {
      // Only add one warning per pattern type to avoid noise
      if (!seenLabels.has(pattern.label)) {
        seenLabels.add(pattern.label);
        warnings.push({
          label: pattern.label,
          description: pattern.description,
          redactedMatch: redact(match[0]),
          line: lineOfOffset(content, match.index),
        });
      }
      match = pattern.regex.exec(content);
    }
  }

  return {
    hasSecrets: warnings.length > 0,
    warnings,
  };
};

/**
 * Build a human-readable summary of scan warnings.
 * Suitable for displaying in the permission card.
 */
export const formatScanWarnings = (warnings: SecretWarning[]): string => {
  if (warnings.length === 0) return '';

  const lines = warnings.map((w) => {
    const location = w.line != null ? ` (line ${w.line})` : '';
    return `- ${w.label}${location}: ${w.redactedMatch}`;
  });

  return `\u26A0\uFE0F This content may contain secrets:\n${lines.join('\n')}`;
};
