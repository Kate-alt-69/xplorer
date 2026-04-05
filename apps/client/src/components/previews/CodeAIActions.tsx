/**
 * AI-powered action buttons for the code preview panel.
 *
 * When previewing a code file, this component renders contextual actions:
 * - "Explain this code" — sends the visible code to the AI chat for explanation
 * - "Find references" — searches the workspace for usages of functions/classes in the file
 * - "Suggest improvements" — asks the AI for code quality suggestions
 *
 * Communication with the chat panel is done via custom DOM events so that
 * this component stays decoupled from StandaloneChatPanel internals.
 */
import React, { useState, useCallback, useRef } from 'react';
import { TauriAPI } from '@/lib/tauri-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeAIActionsProps {
  /** Absolute path to the file being previewed */
  filePath: string;
  /** Language identifier (e.g. "typescript", "python") */
  language: string;
  /** The visible code content (may be truncated) */
  content: string;
  /** File name for display */
  fileName: string;
}

interface ReferenceResult {
  file: string;
  line: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dispatch a request to the AI chat panel.
 * The chat panel listens for `xplorer-ai-chat-request` events.
 */
const sendToChatPanel = (prompt: string): void => {
  window.dispatchEvent(
    new CustomEvent('xplorer-ai-chat-request', {
      detail: { prompt },
    }),
  );
};

/**
 * Extract candidate identifiers (function names, class names, exports)
 * from source code for the "Find references" feature.
 *
 * This is intentionally simple — a heuristic regex scan rather than
 * a full AST parse, since we are operating in the browser.
 */
const extractIdentifiers = (code: string, language: string): string[] => {
  const ids = new Set<string>();

  // Common patterns across languages
  const patterns: RegExp[] = [
    // JS/TS: function foo, const foo =, export const foo, class Foo
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g,
    /(?:export\s+)?class\s+(\w+)/g,
    /(?:export\s+)?interface\s+(\w+)/g,
    /(?:export\s+)?type\s+(\w+)\s*=/g,
    /(?:export\s+)?enum\s+(\w+)/g,
  ];

  // Python-specific
  if (language === 'python') {
    patterns.push(/def\s+(\w+)/g);
    patterns.push(/class\s+(\w+)/g);
  }

  // Rust-specific
  if (language === 'rust') {
    patterns.push(/(?:pub\s+)?fn\s+(\w+)/g);
    patterns.push(/(?:pub\s+)?struct\s+(\w+)/g);
    patterns.push(/(?:pub\s+)?enum\s+(\w+)/g);
    patterns.push(/(?:pub\s+)?trait\s+(\w+)/g);
    patterns.push(/(?:pub\s+)?mod\s+(\w+)/g);
  }

  // Go-specific
  if (language === 'go') {
    patterns.push(/func\s+(?:\([^)]*\)\s+)?(\w+)/g);
    patterns.push(/type\s+(\w+)\s+struct/g);
    patterns.push(/type\s+(\w+)\s+interface/g);
  }

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1];
      // Skip very short names and common keywords
      if (name && name.length > 2 && !SKIP_IDENTIFIERS.has(name)) {
        ids.add(name);
      }
    }
  }

  return Array.from(ids).slice(0, 15); // Cap at 15 identifiers
};

const SKIP_IDENTIFIERS = new Set([
  'use',
  'var',
  'let',
  'const',
  'new',
  'for',
  'map',
  'set',
  'get',
  'try',
  'err',
  'log',
  'key',
  'ref',
  'val',
  'idx',
  'len',
  'num',
  'str',
  'obj',
  'arr',
  'buf',
  'ctx',
  'req',
  'res',
  'msg',
  'cmd',
  'tmp',
  'ret',
  'self',
  'this',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'async',
  'await',
  'return',
  'import',
  'export',
  'default',
  'module',
  'require',
]);

// ---------------------------------------------------------------------------
// Icons (inline SVGs)
// ---------------------------------------------------------------------------

const ExplainIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
    <path
      fillRule="evenodd"
      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
      clipRule="evenodd"
    />
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
    <path
      fillRule="evenodd"
      d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
      clipRule="evenodd"
    />
  </svg>
);

const ImprovementIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM4 11a1 1 0 100-2H3a1 1 0 000 2h1zM10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12z" />
  </svg>
);

const SpinnerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// Reference search using Tauri command execution
// ---------------------------------------------------------------------------

const searchReferences = async (
  identifiers: string[],
  workingDir: string,
): Promise<ReferenceResult[]> => {
  const results: ReferenceResult[] = [];

  for (const id of identifiers.slice(0, 5)) {
    try {
      const { stdout } = await TauriAPI.executeCommand(
        `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.rs" --include="*.go" --include="*.java" "${id}" . 2>/dev/null | head -20`,
        workingDir,
      );

      if (stdout) {
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const match = /^\.\/(.+?):(\d+):(.*)$/.exec(line);
          if (match) {
            results.push({
              file: match[1],
              line: parseInt(match[2], 10),
              text: match[3].trim().slice(0, 120),
            });
          }
        }
      }
    } catch {
      // grep may fail if the directory doesn't support it; skip silently
    }
  }

  return results;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CodeAIActions: React.FC<CodeAIActionsProps> = ({ filePath, language, content, fileName }) => {
  const [loading, setLoading] = useState<string | null>(null);
  const [references, setReferences] = useState<ReferenceResult[] | null>(null);
  const [showReferences, setShowReferences] = useState(false);
  const feedbackRef = useRef<string | null>(null);
  const [feedbackText, setFeedbackText] = useState<string | null>(null);

  const showFeedback = useCallback((text: string) => {
    feedbackRef.current = text;
    setFeedbackText(text);
    setTimeout(() => {
      if (feedbackRef.current === text) {
        setFeedbackText(null);
        feedbackRef.current = null;
      }
    }, 2000);
  }, []);

  // ── Explain code ───────────────────────────────────────────────────────
  const handleExplain = useCallback(() => {
    const truncated =
      content.length > 4000 ? `${content.slice(0, 4000)}\n... (truncated)` : content;
    const prompt = `Explain this ${language} code from \`${fileName}\`:\n\n\`\`\`${language}\n${truncated}\n\`\`\`\n\nGive a clear, concise explanation of what this code does, its key functions/classes, and how the pieces fit together.`;
    sendToChatPanel(prompt);
    showFeedback('Sent to AI Chat');
  }, [content, language, fileName, showFeedback]);

  // ── Find references ────────────────────────────────────────────────────
  const handleFindReferences = useCallback(async () => {
    setLoading('references');
    try {
      const identifiers = extractIdentifiers(content, language);
      if (identifiers.length === 0) {
        showFeedback('No identifiers found');
        return;
      }

      // Get workspace root from file path
      const sep = filePath.includes('\\') ? '\\' : '/';
      const parts = filePath.split(sep);
      // Walk up to find a reasonable project root (look for common markers)
      let workDir = parts.slice(0, -1).join(sep);

      // Try to use git repo root
      try {
        const gitRoot = await TauriAPI.findGitRepository(filePath);
        if (gitRoot) workDir = gitRoot;
      } catch {
        // Not in a git repo; use parent directory
      }

      const refs = await searchReferences(identifiers, workDir);
      setReferences(refs);
      setShowReferences(true);

      if (refs.length === 0) {
        showFeedback('No references found');
      }
    } catch (err) {
      console.error('Failed to find references:', err);
      showFeedback('Search failed');
    } finally {
      setLoading(null);
    }
  }, [content, language, filePath, showFeedback]);

  // ── Suggest improvements ───────────────────────────────────────────────
  const handleSuggestImprovements = useCallback(() => {
    const truncated =
      content.length > 4000 ? `${content.slice(0, 4000)}\n... (truncated)` : content;
    const prompt = `Review this ${language} code from \`${fileName}\` and suggest improvements:\n\n\`\`\`${language}\n${truncated}\n\`\`\`\n\nFocus on:\n- Code quality and readability\n- Potential bugs or edge cases\n- Performance improvements\n- Best practices for ${language}`;
    sendToChatPanel(prompt);
    showFeedback('Sent to AI Chat');
  }, [content, language, fileName, showFeedback]);

  // ── Send references to chat ────────────────────────────────────────────
  const handleSendReferencesToChat = useCallback(() => {
    if (!references || references.length === 0) return;

    const identifiers = extractIdentifiers(content, language);
    const refLines = references
      .slice(0, 30)
      .map((r) => `- \`${r.file}:${r.line}\`: ${r.text}`)
      .join('\n');

    const prompt = `I found these references to identifiers (${identifiers.slice(0, 5).join(', ')}) from \`${fileName}\`:\n\n${refLines}\n\nAnalyze these usages and explain how \`${fileName}\` is used across the codebase.`;
    sendToChatPanel(prompt);
    showFeedback('Sent to AI Chat');
  }, [references, content, language, fileName, showFeedback]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="border-xp-border bg-xp-surface border-b">
      {/* Action buttons row */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <span className="text-xp-text-muted mr-1 text-[10px] font-medium uppercase tracking-wider">
          AI
        </span>

        <button
          onClick={handleExplain}
          disabled={loading !== null}
          className="text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text border-xp-border inline-flex items-center gap-1 rounded border border-transparent px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
          title="Send this code to AI Chat for explanation"
        >
          <ExplainIcon />
          Explain
        </button>

        <button
          onClick={handleFindReferences}
          disabled={loading !== null}
          className="text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text border-xp-border inline-flex items-center gap-1 rounded border border-transparent px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
          title="Search the workspace for references to functions/classes in this file"
        >
          {loading === 'references' ? <SpinnerIcon /> : <SearchIcon />}
          Find References
        </button>

        <button
          onClick={handleSuggestImprovements}
          disabled={loading !== null}
          className="text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text border-xp-border inline-flex items-center gap-1 rounded border border-transparent px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
          title="Ask AI to review this code and suggest improvements"
        >
          <ImprovementIcon />
          Suggest Improvements
        </button>

        {feedbackText && (
          <span className="text-xp-green text-[10px] opacity-80">{feedbackText}</span>
        )}
      </div>

      {/* Reference results panel */}
      {showReferences && references && references.length > 0 && (
        <div className="border-xp-border border-t px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xp-text-muted text-[10px] font-medium">
              {references.length} reference{references.length !== 1 ? 's' : ''} found
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSendReferencesToChat}
                className="text-xp-blue text-[10px] hover:underline"
                title="Send references to AI Chat for analysis"
              >
                Analyze in Chat
              </button>
              <button
                onClick={() => setShowReferences(false)}
                className="text-xp-text-muted text-[10px] hover:underline"
              >
                Close
              </button>
            </div>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {references.slice(0, 20).map((ref, i) => (
              <div
                key={`${ref.file}-${ref.line}-${i}`}
                className="hover:bg-xp-surface-light flex items-baseline gap-2 rounded px-1 py-0.5 text-[10px]"
              >
                <span className="text-xp-blue shrink-0 font-mono">
                  {ref.file}:{ref.line}
                </span>
                <span className="text-xp-text-muted truncate">{ref.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CodeAIActions;

// Re-export the helper for testing
export { extractIdentifiers, sendToChatPanel };
