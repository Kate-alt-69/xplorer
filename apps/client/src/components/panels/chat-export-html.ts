/**
 * Generates a standalone HTML report from chat messages.
 * The HTML is self-contained with inline CSS, syntax highlighting,
 * and a dark theme matching Xplorer's look.
 */
import type { RuntimeChatMessage } from './ChatMessageBubble';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HtmlExportOptions {
  messages: RuntimeChatMessage[];
  currentPath: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/**
 * Extremely simple Markdown -> HTML. Handles headings, bold, italic,
 * inline code, code blocks, links, lists, and blockquotes. Does NOT
 * attempt to rival a full parser -- keeps the export dependency-free.
 */
const markdownToHtml = (md: string): string => {
  const lines = md.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  const closeList = () => {
    if (inList) {
      output.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;

    // Code blocks
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        const highlighted = highlightCode(codeLines.join('\n'), codeLang);
        output.push(
          `<div class="code-block"><div class="code-lang">${escapeHtml(codeLang || 'text')}</div><pre><code>${highlighted}</code></pre></div>`,
        );
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
      } else {
        closeList();
        inCodeBlock = true;
        codeLang = line.trimStart().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      closeList();
      output.push('');
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      output.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      closeList();
      output.push(`<blockquote>${inlineFormat(line.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.*)/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        closeList();
        output.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      output.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.*)/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList();
        output.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      output.push(`<li>${inlineFormat(olMatch[1])}</li>`);
      continue;
    }

    // Paragraph
    closeList();
    output.push(`<p>${inlineFormat(line)}</p>`);
  }

  closeList();

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    const highlighted = highlightCode(codeLines.join('\n'), codeLang);
    output.push(
      `<div class="code-block"><div class="code-lang">${escapeHtml(codeLang || 'text')}</div><pre><code>${highlighted}</code></pre></div>`,
    );
  }

  return output.join('\n');
};

/** Inline formatting: bold, italic, inline code, links, strikethrough */
const inlineFormat = (text: string): string => {
  let result = escapeHtml(text);
  // Inline code (must be before bold/italic to avoid conflicts)
  result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Links
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  return result;
};

/**
 * Very lightweight keyword-based syntax highlighting.
 * Produces `<span class="kw|str|num|cmt">` wrappers.
 */
const highlightCode = (code: string, _lang: string): string => {
  let html = escapeHtml(code);

  // Strings (double and single quoted)
  html = html.replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;|&#039;(?:[^&]|&(?!#039;))*?&#039;)/g,
    '<span class="str">$1</span>',
  );

  // Single-line comments
  html = html.replace(/(\/\/.*)/g, '<span class="cmt">$1</span>');
  // Hash comments
  html = html.replace(/(^|\n)(#[^\n]*)/g, '$1<span class="cmt">$2</span>');

  // Numbers
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');

  // Keywords (broad set covering most languages)
  const keywords = [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'class',
    'interface',
    'type',
    'import',
    'export',
    'from',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'throw',
    'new',
    'this',
    'super',
    'extends',
    'implements',
    'true',
    'false',
    'null',
    'undefined',
    'void',
    'typeof',
    'instanceof',
    'in',
    'of',
    'fn',
    'pub',
    'mod',
    'use',
    'struct',
    'enum',
    'impl',
    'trait',
    'match',
    'mut',
    'self',
    'def',
    'print',
    'lambda',
    'with',
    'as',
    'pass',
    'raise',
    'yield',
    'None',
    'True',
    'False',
  ];
  const kwRe = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
  html = html.replace(kwRe, '<span class="kw">$1</span>');

  return html;
};

/** Format a timestamp to locale string */
const formatTimestamp = (ts?: number): string => {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
};

// ---------------------------------------------------------------------------
// Build file action card HTML
// ---------------------------------------------------------------------------

const buildFileActionHtml = (msg: RuntimeChatMessage): string => {
  if (!msg.fileActions || msg.fileActions.length === 0) return '';

  const statusClassMap: Record<string, string> = {
    success: 'action-executed',
    approved: 'action-executed',
    rejected: 'action-rejected',
    error: 'action-rejected',
    pending: 'action-pending',
  };
  const statusLabelMap: Record<string, string> = {
    success: 'Done',
    approved: 'Approved',
    rejected: 'Rejected',
    error: 'Error',
    pending: 'Pending',
  };

  const cards = msg.fileActions.map((fa) => {
    const statusClass = statusClassMap[fa.status] ?? 'action-pending';
    const statusLabel = statusLabelMap[fa.status] ?? 'Pending';
    const actionLabel = fa.action.action.replace(/_/g, ' ');
    const target = fa.action.path ?? '';
    return `<div class="action-card ${statusClass}">
      <span class="action-label">${escapeHtml(actionLabel)}</span>
      <span class="action-target">${escapeHtml(target)}</span>
      <span class="action-status">${statusLabel}</span>
    </div>`;
  });

  return `<div class="action-cards">${cards.join('\n')}</div>`;
};

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export const exportChatAsHtml = ({ messages, currentPath, model }: HtmlExportOptions): void => {
  if (messages.length === 0) return;

  const dateStr = new Date().toISOString().slice(0, 10);
  const timeStr = new Date().toLocaleTimeString();
  const visibleMessages = messages.filter((m) => !m.isContextInjection);

  const messageHtmlParts = visibleMessages.map((msg) => {
    const roleClass = msg.role === 'user' ? 'msg-user' : 'msg-assistant';
    const roleLabel = msg.role === 'user' ? 'You' : 'AI';
    const timestamp = formatTimestamp(msg.timestamp);
    const contentHtml =
      msg.role === 'assistant' ? markdownToHtml(msg.content) : escapeHtml(msg.content);
    const actionsHtml = buildFileActionHtml(msg);

    // Image attachments
    let imagesHtml = '';
    if (msg.imageContexts && msg.imageContexts.length > 0) {
      const imgs = msg.imageContexts
        .map(
          (img) =>
            `<div class="image-attachment"><img src="${escapeHtml(img.dataUrl)}" alt="${escapeHtml(img.name)}" /><span>${escapeHtml(img.name)}</span></div>`,
        )
        .join('');
      imagesHtml = `<div class="image-strip">${imgs}</div>`;
    }

    // Dropped files
    let droppedHtml = '';
    if (msg.droppedFiles && msg.droppedFiles.length > 0) {
      const chips = msg.droppedFiles
        .map((f) => `<span class="file-chip">${escapeHtml(f.name)}</span>`)
        .join('');
      droppedHtml = `<div class="dropped-files">${chips}</div>`;
    }

    const pinnedBadge = msg.pinned
      ? '<span class="pinned-badge" title="Pinned message">&#x1F4CC;</span>'
      : '';

    return `<div class="message ${roleClass}">
      <div class="msg-header">
        <span class="msg-role">${roleLabel}</span>
        ${pinnedBadge}
        <span class="msg-time">${escapeHtml(timestamp)}</span>
      </div>
      ${imagesHtml}
      ${droppedHtml}
      <div class="msg-content">${contentHtml}</div>
      ${actionsHtml}
    </div>`;
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Xplorer Chat - ${escapeHtml(dateStr)}</title>
<style>
  :root {
    --bg: #1a1b26;
    --surface: #24283b;
    --surface-light: #2f3347;
    --border: #3b4261;
    --text: #c0caf5;
    --text-muted: #565f89;
    --blue: #7aa2f7;
    --green: #9ece6a;
    --red: #f7768e;
    --yellow: #e0af68;
    --purple: #bb9af7;
    --cyan: #7dcfff;
    --orange: #ff9e64;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    padding: 0;
    margin: 0;
  }

  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 16px;
  }

  /* Header */
  .report-header {
    text-align: center;
    padding: 32px 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
  }
  .report-header h1 {
    font-size: 24px;
    font-weight: 700;
    color: var(--blue);
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }
  .report-header .subtitle {
    color: var(--text-muted);
    font-size: 13px;
  }
  .meta-row {
    display: flex;
    gap: 16px;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .meta-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .meta-tag .label { color: var(--cyan); }

  /* Messages */
  .message {
    margin-bottom: 16px;
    border-radius: 10px;
    overflow: hidden;
  }
  .msg-user {
    background: var(--blue);
    color: white;
    margin-left: 20%;
  }
  .msg-assistant {
    background: var(--surface-light);
    border: 1px solid var(--border);
    margin-right: 20%;
  }
  .msg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 4px;
    font-size: 11px;
  }
  .msg-role {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .msg-user .msg-role { color: rgba(255,255,255,0.8); }
  .msg-assistant .msg-role { color: var(--purple); }
  .msg-time {
    margin-left: auto;
    opacity: 0.6;
    font-size: 10px;
  }
  .msg-content {
    padding: 4px 14px 12px;
  }
  .msg-user .msg-content {
    white-space: pre-wrap;
  }
  .pinned-badge {
    font-size: 12px;
  }

  /* Markdown typography */
  .msg-content h1, .msg-content h2, .msg-content h3,
  .msg-content h4, .msg-content h5, .msg-content h6 {
    margin: 12px 0 6px;
    font-weight: 600;
    color: var(--text);
  }
  .msg-content h1 { font-size: 18px; }
  .msg-content h2 { font-size: 16px; }
  .msg-content h3 { font-size: 14px; }
  .msg-content p { margin: 4px 0; }
  .msg-content a { color: var(--cyan); text-decoration: underline; }
  .msg-content blockquote {
    border-left: 3px solid var(--purple);
    padding-left: 12px;
    margin: 8px 0;
    color: var(--text-muted);
  }
  .msg-content ul, .msg-content ol {
    margin: 6px 0;
    padding-left: 20px;
  }
  .msg-content li { margin: 2px 0; }
  .msg-content strong { color: var(--yellow); }
  .msg-content em { font-style: italic; color: var(--cyan); }
  .msg-content del { text-decoration: line-through; opacity: 0.5; }

  /* Inline code */
  .inline-code {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    color: var(--green);
  }

  /* Code blocks */
  .code-block {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 8px 0;
    overflow: hidden;
  }
  .code-lang {
    background: var(--surface);
    padding: 4px 12px;
    font-size: 10px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .code-block pre {
    padding: 12px;
    overflow-x: auto;
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
  }
  .code-block code { color: var(--text); }

  /* Syntax highlighting */
  .kw { color: var(--purple); font-weight: 500; }
  .str { color: var(--green); }
  .num { color: var(--orange); }
  .cmt { color: var(--text-muted); font-style: italic; }

  /* File action cards */
  .action-cards {
    padding: 4px 14px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .action-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .action-executed { border-color: var(--green); }
  .action-rejected { border-color: var(--red); opacity: 0.6; }
  .action-pending { border-color: var(--yellow); }
  .action-label {
    font-weight: 600;
    text-transform: capitalize;
    color: var(--cyan);
  }
  .action-target {
    flex: 1;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-status {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .action-executed .action-status { color: var(--green); }
  .action-rejected .action-status { color: var(--red); }
  .action-pending .action-status { color: var(--yellow); }

  /* Image attachments */
  .image-strip {
    display: flex;
    gap: 8px;
    padding: 8px 14px 4px;
    flex-wrap: wrap;
  }
  .image-attachment {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .image-attachment img {
    width: 80px;
    height: 80px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  .image-attachment span {
    font-size: 10px;
    color: var(--text-muted);
  }

  /* Dropped file chips */
  .dropped-files {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    padding: 4px 14px;
  }
  .file-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(122, 162, 247, 0.15);
    color: var(--blue);
    font-size: 10px;
  }

  /* Footer */
  .report-footer {
    text-align: center;
    padding: 24px 0;
    border-top: 1px solid var(--border);
    margin-top: 24px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .report-footer a { color: var(--cyan); text-decoration: none; }

  /* Print */
  @media print {
    body { background: white; color: #222; }
    .msg-user { background: #e3efff; color: #222; }
    .msg-assistant { background: #f5f5f5; }
    .code-block { background: #f0f0f0; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="report-header">
    <h1>Xplorer Chat Report</h1>
    <p class="subtitle">AI Conversation Export</p>
    <div class="meta-row">
      <span class="meta-tag"><span class="label">Date:</span> ${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
      ${currentPath ? `<span class="meta-tag"><span class="label">Folder:</span> ${escapeHtml(currentPath)}</span>` : ''}
      ${model ? `<span class="meta-tag"><span class="label">Model:</span> ${escapeHtml(model)}</span>` : ''}
      <span class="meta-tag"><span class="label">Messages:</span> ${visibleMessages.length}</span>
    </div>
  </div>

  ${messageHtmlParts.join('\n\n')}

  <div class="report-footer">
    Exported from <a href="https://xplorer.space">Xplorer</a> on ${escapeHtml(dateStr)}
  </div>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xplorer-chat-${dateStr}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
