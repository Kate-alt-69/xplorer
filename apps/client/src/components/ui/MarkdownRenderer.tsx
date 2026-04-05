import React, { useState } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Called when the user clicks "Apply to editor" on a fenced code block. */
  onApplyCode?: (code: string) => void;
  /** Called when the user clicks "Save as file" on a fenced code block. */
  onSaveCodeAsFile?: (code: string, language: string) => void;
  /** Render a file path as an interactive card. Return null to render as plain text. */
  renderFilePath?: (filePath: string) => React.ReactNode | null;
}

/**
 * Lightweight markdown renderer. Handles:
 * - Headers (# ## ###)
 * - Bold (**text**)
 * - Italic (_text_ or single *text* — but not inside words)
 * - Inline code (`code`)
 * - Code blocks (```lang ... ```)
 * - Bullet lists (- or *)
 * - Numbered lists (1. 2.)
 * - Links [text](url)
 * - Horizontal rules (---)
 * - Blockquotes (> text)
 * - Tables (| col | col |)
 */
const MarkdownRenderer = ({
  content,
  className = '',
  onApplyCode,
  onSaveCodeAsFile,
  renderFilePath,
}: MarkdownRendererProps) => {
  const elements = parseMarkdown(content, onApplyCode, onSaveCodeAsFile, renderFilePath);
  return (
    <div
      className={`markdown-content ${className}`}
      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0, overflow: 'hidden' }}
    >
      {elements}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Code block with Copy / Save as file buttons
// ---------------------------------------------------------------------------

interface CodeBlockWithActionsProps {
  code: string;
  language: string;
  onApplyCode?: (code: string) => void;
  onSaveAsFile?: (code: string, language: string) => void;
}

const CodeBlockWithActions = ({
  code,
  language,
  onApplyCode,
  onSaveAsFile,
}: CodeBlockWithActionsProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API might not be available
    }
  };

  return (
    <div className="group relative my-2">
      {language && (
        <div
          className="text-xp-text-muted bg-xp-bg border-xp-border rounded-t-md border border-b-0 px-3 py-1 text-[10px]"
          style={{ fontFamily: 'monospace' }}
        >
          {language}
        </div>
      )}
      <pre
        className={`bg-xp-bg border-xp-border overflow-x-auto border p-3 text-xs ${language ? 'rounded-b-md' : 'rounded-md'}`}
      >
        <code className="text-xp-text">{code}</code>
      </pre>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleCopy}
          className="border-xp-border bg-xp-surface text-xp-text-muted hover:text-xp-text rounded border px-2 py-0.5 text-[10px]"
          title="Copy to clipboard"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        {onSaveAsFile && (
          <button
            onClick={() => onSaveAsFile(code, language)}
            className="border-xp-border bg-xp-surface text-xp-text-muted hover:text-xp-text rounded border px-2 py-0.5 text-[10px]"
            title="Save as file"
          >
            Save as file
          </button>
        )}
        {onApplyCode && (
          <button
            onClick={() => onApplyCode(code)}
            className="border-xp-border bg-xp-surface text-xp-text-muted hover:text-xp-text rounded border px-2 py-0.5 text-[10px]"
            title="Replace selected code in editor"
          >
            Apply
          </button>
        )}
      </div>
    </div>
  );
};

const parseMarkdown = (
  text: string,
  onApplyCode?: (code: string) => void,
  onSaveCodeAsFile?: (code: string, language: string) => void,
  renderFilePath?: (filePath: string) => React.ReactNode | null,
): React.ReactNode[] => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const langMatch = line.trimStart().match(/^```(\w+)?/);
      const language = langMatch?.[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const codeText = codeLines.join('\n');
      elements.push(
        <CodeBlockWithActions
          key={key++}
          code={codeText}
          language={language}
          onApplyCode={onApplyCode}
          onSaveAsFile={onSaveCodeAsFile}
        />,
      );
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      elements.push(<hr key={key++} className="border-xp-border my-3" />);
      i++;
      continue;
    }

    // Table: detect a row of | cells | followed by a separator line |---|---|
    if (/^\|(.+)\|/.test(line) && i + 1 < lines.length && /^\|[\s:]*-+/.test(lines[i + 1])) {
      const tableRows: string[][] = [];
      const headerCells = parseTableRow(line);
      tableRows.push(headerCells);

      // Parse alignment from separator row
      const sepLine = lines[i + 1];
      const alignments = parseTableAlignments(sepLine);
      i += 2;

      // Parse body rows
      while (i < lines.length && /^\|(.+)\|/.test(lines[i])) {
        tableRows.push(parseTableRow(lines[i]));
        i++;
      }

      elements.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="border-xp-border w-full border-collapse border text-xs">
            <thead>
              <tr className="bg-xp-bg">
                {tableRows[0].map((cell, ci) => (
                  <th
                    key={`header-${ci}`} // eslint-disable-line react/no-array-index-key
                    className="border-xp-border border px-2 py-1.5 text-left font-semibold"
                    style={{ textAlign: alignments[ci] || 'left' }}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.slice(1).map((row, ri) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={`row-${ri}`} className={ri % 2 === 0 ? '' : 'bg-xp-bg/30'}>
                  {row.map((cell, ci) => (
                    <td
                      key={`cell-${ci}`} // eslint-disable-line react/no-array-index-key
                      className="border-xp-border border px-2 py-1"
                      style={{ textAlign: alignments[ci] || 'left' }}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      const sizes: Record<number, string> = {
        1: 'text-base font-bold mt-3 mb-1',
        2: 'text-sm font-bold mt-2 mb-1',
        3: 'text-sm font-semibold mt-2 mb-1',
      };
      elements.push(
        <Tag key={key++} className={sizes[level] || sizes[3]}>
          {renderInline(text)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote
          key={key++}
          className="border-xp-border-light text-xp-text-muted my-2 border-l-2 pl-3"
        >
          {quoteLines.map((ql, qi) => (
            <p key={`quote-${qi}`}>{renderInline(ql)}</p> // eslint-disable-line react/no-array-index-key
          ))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-1 list-inside list-disc space-y-0.5">
          {items.map((item, idx) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={`ul-${idx}`} className="text-sm">
              {renderInlineWithFilePaths(item, renderFilePath)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-1 list-inside list-decimal space-y-0.5">
          {items.map((item, idx) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={`ol-${idx}`} className="text-sm">
              {renderInlineWithFilePaths(item, renderFilePath)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className="my-0.5 text-sm leading-relaxed">
        {renderInlineWithFilePaths(line, renderFilePath)}
      </p>,
    );
    i++;
  }

  return elements;
};

/** Parse a markdown table row into cells */
const parseTableRow = (line: string): string[] => {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
};

/** Parse table alignment from separator row (e.g. |:---|:---:|---:| ) */
const parseTableAlignments = (sepLine: string): ('left' | 'center' | 'right')[] => {
  return sepLine
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((seg) => {
      const s = seg.trim();
      const left = s.startsWith(':');
      const right = s.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      return 'left';
    });
};

/**
 * Render inline markdown: bold, italic, code, links
 */
const renderInline = (text: string): React.ReactNode => {
  // Regex pattern order matters — process code first to avoid interfering with ** inside code
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let segKey = 0;

  while (remaining.length > 0) {
    // Inline code `...`
    let match = remaining.match(/^(.*?)`([^`]+)`([\s\S]*)/);
    if (match) {
      if (match[1]) parts.push(...renderBoldItalic(match[1], segKey++));
      parts.push(
        <code
          key={`c-${segKey++}`}
          className="bg-xp-bg text-xp-purple break-all rounded px-1 py-0.5 text-xs"
        >
          {match[2]}
        </code>,
      );
      remaining = match[3];
      continue;
    }

    // Link [text](url)
    match = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)([\s\S]*)/);
    if (match) {
      if (match[1]) parts.push(...renderBoldItalic(match[1], segKey++));
      const href = match[3];
      const isValidUrl = /^(https?:\/\/|mailto:|#|\/)/i.test(href);
      if (isValidUrl) {
        parts.push(
          <a
            key={`a-${segKey++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xp-blue break-all underline"
          >
            {match[2]}
          </a>,
        );
      } else {
        // Render as plain text instead of a link for unsafe URLs
        parts.push(
          <span key={`a-${segKey++}`} className="text-xp-blue">
            {match[2]}
          </span>,
        );
      }
      remaining = match[4];
      continue;
    }

    // No more special inline patterns — process bold/italic on the rest
    parts.push(...renderBoldItalic(remaining, segKey));
    break;
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
};

/**
 * File path detection regex for inline rendering.
 * Matches absolute paths: /path/to/file.ext or C:\path\to\file.ext
 * Avoids matching inside backticks (handled by inline code rendering).
 */
const FILE_PATH_INLINE_REGEX =
  /(?:\/(?:[a-zA-Z0-9._-]+\/){1,}[a-zA-Z0-9._-]+(?:\.[a-zA-Z0-9]+)?)|(?:[A-Z]:[/\\](?:[^\s:*?"<>|]+[/\\])*[^\s:*?"<>|]+)/g;

/**
 * Render inline markdown with file path detection.
 * File paths in regular text (not inside code blocks) get replaced with
 * interactive cards via the renderFilePath callback.
 */
const renderInlineWithFilePaths = (
  text: string,
  renderFilePath?: (filePath: string) => React.ReactNode | null,
): React.ReactNode => {
  if (!renderFilePath) return renderInline(text);

  // First render normal inline markdown
  const inlineResult = renderInline(text);

  // If the text doesn't contain file-path-like patterns, skip the expensive regex
  if (!text.includes('/') && !text.match(/[A-Z]:[/\\]/)) return inlineResult;

  // Find file paths in the raw text
  const matches: Array<{ path: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(FILE_PATH_INLINE_REGEX.source, 'g');
  match = regex.exec(text);
  while (match !== null) {
    // Skip if the path looks like it's inside inline code (backticks)
    const beforeMatch = text.slice(0, match.index);
    const backtickCount = (beforeMatch.match(/`/g) ?? []).length;
    if (backtickCount % 2 === 0) {
      // Only match paths with at least 2 segments
      const segments = match[0].split(/[/\\]/).filter(Boolean);
      if (segments.length >= 2) {
        matches.push({ path: match[0], start: match.index, end: match.index + match[0].length });
      }
    }
    match = regex.exec(text);
  }

  if (matches.length === 0) return inlineResult;

  // Rebuild the text with file path cards
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    // Text before this match
    if (m.start > lastEnd) {
      parts.push(
        <React.Fragment key={`pre-${i}`}>
          {renderInline(text.slice(lastEnd, m.start))}
        </React.Fragment>,
      );
    }
    // Render the file path card
    const card = renderFilePath(m.path);
    if (card !== null) {
      parts.push(<React.Fragment key={`fp-${i}`}>{card}</React.Fragment>);
    } else {
      // Fallback to inline render if callback returns null
      parts.push(<React.Fragment key={`fp-${i}`}>{renderInline(m.path)}</React.Fragment>);
    }
    lastEnd = m.end;
  }

  // Text after the last match
  if (lastEnd < text.length) {
    parts.push(<React.Fragment key="post">{renderInline(text.slice(lastEnd))}</React.Fragment>);
  }

  return <>{parts}</>;
};

const renderBoldItalic = (text: string, keyBase: number): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let k = 0;

  while (remaining.length > 0) {
    // Bold **...**
    let match = remaining.match(/^(.*?)\*\*(.+?)\*\*([\s\S]*)/);
    if (match) {
      if (match[1]) parts.push(<span key={`t-${keyBase}-${k++}`}>{match[1]}</span>);
      parts.push(
        <strong key={`b-${keyBase}-${k++}`} className="font-semibold">
          {match[2]}
        </strong>,
      );
      remaining = match[3];
      continue;
    }

    // Bold __...__
    match = remaining.match(/^(.*?)__(.+?)__([\s\S]*)/);
    if (match) {
      if (match[1]) parts.push(<span key={`t-${keyBase}-${k++}`}>{match[1]}</span>);
      parts.push(
        <strong key={`b-${keyBase}-${k++}`} className="font-semibold">
          {match[2]}
        </strong>,
      );
      remaining = match[3];
      continue;
    }

    // Italic _..._ (not inside words)
    match = remaining.match(/^(.*?)(?:^|\s)_([^_]+)_(?:\s|$|[.,;:!?])([\s\S]*)/);
    if (match) {
      if (match[1]) parts.push(<span key={`t-${keyBase}-${k++}`}>{match[1]} </span>);
      parts.push(
        <em key={`i-${keyBase}-${k++}`} className="italic">
          {match[2]}
        </em>,
      );
      remaining = match[3] ? ` ${match[3]}` : '';
      continue;
    }

    // No more matches
    if (remaining) {
      parts.push(<span key={`t-${keyBase}-${k}`}>{remaining}</span>);
    }
    break;
  }

  return parts;
};

export default MarkdownRenderer;
