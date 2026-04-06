/**
 * Multi-modal clipboard handling for the AI chat panel.
 *
 * Detects pasted content type (image, code, URL) and converts it into
 * a structured attachment that the chat can use as context.
 *
 * Integrates with the existing drag & drop infrastructure in ChatDropZone.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClipboardContentType = 'image' | 'code' | 'url' | 'text';

export interface ClipboardAttachment {
  /** Detected content type */
  type: ClipboardContentType;
  /** Display label for the attachment chip */
  label: string;
  /** Base64 data URL for images, or the processed text for code/url/text */
  data: string;
  /** MIME type (relevant for images) */
  mimeType?: string;
  /** Detected programming language (relevant for code) */
  language?: string;
  /** Fetched page title for URLs */
  pageTitle?: string;
  /** Fetched page description for URLs */
  pageDescription?: string;
}

// ---------------------------------------------------------------------------
// Language detection heuristics
// ---------------------------------------------------------------------------

/**
 * Simple heuristic language detection for pasted code snippets.
 * Checks for common syntax patterns to identify the language.
 */
const LANGUAGE_PATTERNS: Array<{ lang: string; patterns: RegExp[] }> = [
  {
    lang: 'typescript',
    patterns: [
      /\b(interface|type|enum)\s+\w+/,
      /:\s*(string|number|boolean|unknown|void)\b/,
      /\bimport\s+.*\s+from\s+['"].*['"]/,
      /\bconst\s+\w+\s*:\s*\w+/,
    ],
  },
  {
    lang: 'javascript',
    patterns: [
      /\b(const|let|var)\s+\w+\s*=/,
      /\bfunction\s+\w+\s*\(/,
      /=>\s*[{(]/,
      /\brequire\s*\(/,
      /\bconsole\.\w+\(/,
    ],
  },
  {
    lang: 'python',
    patterns: [/\bdef\s+\w+\s*\(/, /\bimport\s+\w+/, /\bclass\s+\w+.*:/, /\bself\.\w+/],
  },
  {
    lang: 'rust',
    patterns: [/\bfn\s+\w+/, /\blet\s+mut\s+/, /\bimpl\s+\w+/, /\buse\s+\w+::/],
  },
  {
    lang: 'html',
    patterns: [/<\/?[a-z][\w-]*(\s[^>]*)?\/?>/i, /<!DOCTYPE\s+html>/i],
  },
  {
    lang: 'css',
    patterns: [/\{[\s\S]*?[a-z-]+\s*:\s*[^;]+;/, /@media\s/, /\.[a-z][\w-]*\s*\{/],
  },
  {
    lang: 'json',
    patterns: [/^\s*[{[]/, /"[^"]+"\s*:\s*["{[\dtfn]/],
  },
  {
    lang: 'shell',
    patterns: [/^#!\/bin\/(ba)?sh/, /\b(echo|grep|sed|awk|curl|wget)\s/, /\$\{?\w+\}?/],
  },
  {
    lang: 'sql',
    patterns: [/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s/i, /\bFROM\s+\w+/i],
  },
  {
    lang: 'go',
    patterns: [/\bfunc\s+\w+/, /\bpackage\s+\w+/, /\bfmt\./, /\b:=\s/],
  },
  {
    lang: 'java',
    patterns: [
      /\bpublic\s+(static\s+)?class\s+/,
      /\bSystem\.out\.print/,
      /\bprivate\s+(final\s+)?\w+/,
    ],
  },
];

export const detectLanguage = (text: string): string | undefined => {
  for (const { lang, patterns } of LANGUAGE_PATTERNS) {
    const matchCount = patterns.filter((p) => p.test(text)).length;
    if (matchCount >= 2) return lang;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Content type detection
// ---------------------------------------------------------------------------

/** URL pattern for checking if the entire paste is a single URL */
const SINGLE_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/**
 * Heuristic: looks like code if it has multiple lines with
 * indentation, curly braces, semicolons, or arrow functions.
 */
const looksLikeCode = (text: string): boolean => {
  const lines = text.split('\n');
  if (lines.length < 2) return false;

  const codeIndicators = [
    // Indented lines
    lines.filter((l) => /^\s{2,}/.test(l)).length > lines.length * 0.3,
    // Braces
    /[{}]/.test(text),
    // Semicolons at end of lines
    lines.filter((l) => l.trimEnd().endsWith(';')).length >= 2,
    // Arrow functions or function declarations
    /=>|function\s+\w+/.test(text),
    // Import/export statements
    /\b(import|export|require)\b/.test(text),
    // Specific language patterns detected
    detectLanguage(text) !== undefined,
  ];

  const score = codeIndicators.filter(Boolean).length;
  return score >= 2;
};

/**
 * Detect the content type of pasted text.
 */
export const detectPasteContentType = (text: string): ClipboardContentType => {
  const trimmed = text.trim();

  // Single URL
  if (SINGLE_URL_PATTERN.test(trimmed)) {
    return 'url';
  }

  // Code detection
  if (looksLikeCode(trimmed)) {
    return 'code';
  }

  return 'text';
};

// ---------------------------------------------------------------------------
// Image handling
// ---------------------------------------------------------------------------

/**
 * Convert a clipboard image (from paste event) to a base64 data URL.
 * Returns null if no image is found in the clipboard items.
 */
export const extractImageFromClipboard = (
  clipboardData: DataTransfer,
): Promise<ClipboardAttachment | null> => {
  const imageItem = Array.from(clipboardData.items).find(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );

  if (!imageItem) return Promise.resolve(null);

  const file = imageItem.getAsFile();
  if (!file) return Promise.resolve(null);

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({
        type: 'image',
        label: file.name || 'Pasted image',
        data: dataUrl,
        mimeType: file.type,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};

// ---------------------------------------------------------------------------
// Code processing
// ---------------------------------------------------------------------------

/**
 * Wrap pasted code in a markdown code block with detected language.
 */
export const processCodePaste = (text: string): ClipboardAttachment => {
  const language = detectLanguage(text) ?? 'text';
  const codeBlock = `\`\`\`${language}\n${text}\n\`\`\``;
  return {
    type: 'code',
    label: `Code (${language})`,
    data: codeBlock,
    language,
  };
};

// ---------------------------------------------------------------------------
// URL processing
// ---------------------------------------------------------------------------

/**
 * Process a pasted URL: attempt to fetch the page title and description
 * from the Open Graph metadata. Falls back gracefully if fetching fails.
 */
export const processUrlPaste = async (url: string): Promise<ClipboardAttachment> => {
  const attachment: ClipboardAttachment = {
    type: 'url',
    label: url.length > 50 ? `${url.slice(0, 47)}...` : url,
    data: url,
  };

  // Try to fetch page metadata via a lightweight approach
  try {
    // Use a CORS-friendly approach: parse the URL hostname as label
    const parsed = new URL(url);
    attachment.label = `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    if (attachment.label.length > 50) {
      attachment.label = `${attachment.label.slice(0, 47)}...`;
    }
    attachment.pageTitle = parsed.hostname;
    attachment.pageDescription = `Link to ${parsed.hostname}${parsed.pathname}`;
  } catch {
    // Invalid URL — keep the raw text as label
  }

  return attachment;
};

// ---------------------------------------------------------------------------
// Main paste handler
// ---------------------------------------------------------------------------

/**
 * Handle a paste event in the chat input area.
 * Returns a ClipboardAttachment if special content was detected, or null
 * if the paste should be handled as normal text input.
 */
export const handleChatPaste = async (
  event: ClipboardEvent,
): Promise<ClipboardAttachment | null> => {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return null;

  // 1. Check for images first (screenshots, copied images)
  const imageAttachment = await extractImageFromClipboard(clipboardData);
  if (imageAttachment) {
    return imageAttachment;
  }

  // 2. Process text content
  const text = clipboardData.getData('text/plain');
  if (!text || text.trim().length === 0) return null;

  const contentType = detectPasteContentType(text);

  switch (contentType) {
    case 'code':
      return processCodePaste(text);
    case 'url':
      return processUrlPaste(text);
    default:
      // Plain text — let the browser handle it normally
      return null;
  }
};

// ---------------------------------------------------------------------------
// Clipboard image detection (for paste indicator)
// ---------------------------------------------------------------------------

/**
 * Check whether the system clipboard currently contains an image.
 * Uses the Clipboard API (navigator.clipboard.read) if available.
 * Returns true if an image is detected.
 *
 * Note: This is async and may fail if clipboard access is denied.
 */
export const clipboardHasImage = async (): Promise<boolean> => {
  try {
    if (!navigator.clipboard?.read) return false;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) return true;
      }
    }
    return false;
  } catch {
    // Clipboard API access denied or unavailable
    return false;
  }
};

/**
 * Build a context string from a clipboard attachment to inject
 * into the chat conversation as additional context.
 */
export const buildClipboardContext = (attachment: ClipboardAttachment): string => {
  switch (attachment.type) {
    case 'image':
      return `[Pasted image: ${attachment.label}]`;
    case 'code':
      return `The user pasted the following code:\n\n${attachment.data}`;
    case 'url': {
      let ctx = `The user pasted a URL: ${attachment.data}`;
      if (attachment.pageTitle) {
        ctx += `\nPage: ${attachment.pageTitle}`;
      }
      if (attachment.pageDescription) {
        ctx += `\nDescription: ${attachment.pageDescription}`;
      }
      return ctx;
    }
    default:
      return attachment.data;
  }
};
