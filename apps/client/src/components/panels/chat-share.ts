/**
 * Conversation sharing utilities for the AI chat panel.
 *
 * Serializes the current conversation to a compressed JSON payload,
 * encodes it as a base64 URL fragment, and copies a shareable link
 * to the clipboard.
 *
 * The link can be opened in another Xplorer instance to restore
 * the conversation.
 */
import type { ChatMessage } from './chat-history';
import type { SlashCommand } from './chat-slash-commands';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SharedConversation {
  /** Schema version for forward compatibility */
  version: 1;
  /** ISO 8601 date string when shared */
  sharedAt: string;
  /** Folder path the conversation took place in */
  folder: string;
  /** AI model used for the conversation */
  model: string;
  /** Visible (non-context-injection) messages */
  messages: SharedMessage[];
  /** Total message count including hidden context */
  totalMessages: number;
}

export interface SharedMessage {
  role: string;
  content: string;
  /** Timestamp in epoch ms */
  timestamp?: number;
  /** Whether the message was pinned */
  pinned?: boolean;
  /** Attached file names (paths stripped for privacy) */
  attachedFiles?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base URL for share links (Xplorer custom protocol) */
const SHARE_BASE_URL = 'xplorer://chat/shared';

/** Maximum payload size before compression (500 KB) */
const MAX_PAYLOAD_SIZE = 500 * 1024;

/** Maximum messages to include in a shared conversation */
const MAX_SHARED_MESSAGES = 100;

// ---------------------------------------------------------------------------
// Compression / decompression utilities
// ---------------------------------------------------------------------------

/**
 * Compress a string using the Compression Streams API (deflate-raw).
 * Falls back to plain base64 if the API is unavailable.
 */
const compressString = async (input: string): Promise<string> => {
  try {
    if (typeof CompressionStream === 'undefined') {
      return btoa(unescape(encodeURIComponent(input)));
    }

    const encoder = new TextEncoder();
    const inputStream = new ReadableStream({
      start: (controller) => {
        controller.enqueue(encoder.encode(input));
        controller.close();
      },
    });

    const compressedStream = inputStream.pipeThrough(new CompressionStream('deflate-raw'));
    const reader = compressedStream.getReader();
    const chunks: Uint8Array[] = [];

    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        chunks.push(result.value);
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to base64
    let binary = '';
    for (let i = 0; i < combined.length; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return `z:${btoa(binary)}`;
  } catch {
    return btoa(unescape(encodeURIComponent(input)));
  }
};

/**
 * Decompress a string that was compressed with compressString.
 * Handles both compressed (z: prefix) and plain base64.
 */
export const decompressString = async (input: string): Promise<string> => {
  try {
    if (!input.startsWith('z:')) {
      return decodeURIComponent(escape(atob(input)));
    }

    const b64 = input.slice(2);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (typeof DecompressionStream === 'undefined') {
      // Fallback: try plain decode
      return decodeURIComponent(escape(atob(b64)));
    }

    const inputStream = new ReadableStream({
      start: (controller) => {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const decompressedStream = inputStream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = decompressedStream.getReader();
    const chunks: Uint8Array[] = [];

    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        chunks.push(result.value);
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(combined);
  } catch {
    // Last resort: try plain base64
    try {
      return decodeURIComponent(escape(atob(input.replace(/^z:/, ''))));
    } catch {
      return '';
    }
  }
};

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a conversation into a SharedConversation payload.
 * Strips hidden context messages and file paths for privacy.
 */
export const serializeConversation = (
  messages: ChatMessage[],
  folder: string,
  model: string,
): SharedConversation => {
  const visibleMessages = messages
    .filter((m) => !m.isContextInjection && !m.isCommandResult)
    .slice(0, MAX_SHARED_MESSAGES);

  const sharedMessages: SharedMessage[] = visibleMessages.map((m) => {
    const shared: SharedMessage = {
      role: m.role,
      content: m.content,
    };
    if (m.timestamp) shared.timestamp = m.timestamp;
    if (m.pinned) shared.pinned = true;
    if (m.droppedFiles && m.droppedFiles.length > 0) {
      shared.attachedFiles = m.droppedFiles.map((f) => f.name);
    }
    return shared;
  });

  return {
    version: 1,
    sharedAt: new Date().toISOString(),
    folder,
    model,
    messages: sharedMessages,
    totalMessages: messages.length,
  };
};

/**
 * Deserialize a SharedConversation back into ChatMessages.
 */
export const deserializeConversation = (
  shared: SharedConversation,
): { messages: ChatMessage[]; metadata: { folder: string; model: string; sharedAt: string } } => {
  const messages: ChatMessage[] = shared.messages.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    pinned: m.pinned,
    droppedFiles: m.attachedFiles?.map((name) => ({ name, path: '' })),
  }));

  return {
    messages,
    metadata: {
      folder: shared.folder,
      model: shared.model,
      sharedAt: shared.sharedAt,
    },
  };
};

// ---------------------------------------------------------------------------
// Share link generation
// ---------------------------------------------------------------------------

/**
 * Generate a shareable URL for a conversation.
 * The conversation data is compressed and encoded as a URL fragment.
 */
export const generateShareLink = async (
  messages: ChatMessage[],
  folder: string,
  model: string,
): Promise<{ url: string; payloadSize: number } | { error: string }> => {
  const payload = serializeConversation(messages, folder, model);
  const json = JSON.stringify(payload);

  if (json.length > MAX_PAYLOAD_SIZE) {
    return {
      error: `Conversation is too large to share (${Math.round(json.length / 1024)}KB). Try sharing a shorter conversation.`,
    };
  }

  const compressed = await compressString(json);
  const fragment = encodeURIComponent(compressed);
  const url = `${SHARE_BASE_URL}#${fragment}`;

  return { url, payloadSize: compressed.length };
};

/**
 * Parse a share link and restore the conversation data.
 */
export const parseShareLink = async (
  url: string,
): Promise<
  | { messages: ChatMessage[]; metadata: { folder: string; model: string; sharedAt: string } }
  | { error: string }
> => {
  try {
    const hashIdx = url.indexOf('#');
    if (hashIdx < 0) return { error: 'Invalid share link: no data fragment found.' };

    const fragment = decodeURIComponent(url.slice(hashIdx + 1));
    const json = await decompressString(fragment);
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      !('messages' in parsed)
    ) {
      return { error: 'Invalid share link: unrecognized format.' };
    }

    return deserializeConversation(parsed as SharedConversation);
  } catch {
    return {
      error: 'Failed to decode the share link. It may be corrupted or from a newer version.',
    };
  }
};

// ---------------------------------------------------------------------------
// Clipboard copy with feedback
// ---------------------------------------------------------------------------

/**
 * Copy the share URL to clipboard and return a success/error message.
 */
export const copyShareLinkToClipboard = async (url: string): Promise<string> => {
  try {
    await navigator.clipboard.writeText(url);
    return 'Share link copied to clipboard!';
  } catch {
    return `Could not copy to clipboard. Here is the link:\n\n${url}`;
  }
};

// ---------------------------------------------------------------------------
// Slash command integration
// ---------------------------------------------------------------------------

export const SHARE_SLASH_COMMAND: SlashCommand = {
  name: '/share',
  description: 'Share this conversation as a link',
  toPrompt: (_args) => '__SHARE_CONVERSATION__',
};

/**
 * Handle the /share slash command.
 * Returns a formatted response with the share link.
 */
export const handleShareCommand = async (
  messages: ChatMessage[],
  folder: string,
  model: string,
): Promise<string> => {
  if (messages.length === 0) {
    return 'Nothing to share yet. Start a conversation first!';
  }

  const visibleCount = messages.filter((m) => !m.isContextInjection && !m.isCommandResult).length;
  if (visibleCount === 0) {
    return 'No visible messages to share.';
  }

  const result = await generateShareLink(messages, folder, model);

  if ('error' in result) {
    return result.error;
  }

  const feedback = await copyShareLinkToClipboard(result.url);
  const sizeKb = Math.round(result.payloadSize / 1024);

  return [
    `**Conversation shared!**`,
    '',
    feedback,
    '',
    `*${visibleCount} messages, ${sizeKb}KB compressed*`,
    `*Shared on ${new Date().toLocaleDateString()} from ${folder || 'unknown folder'}*`,
    `*Model: ${model || 'unknown'}*`,
    '',
    'Open this link in another Xplorer instance to restore the conversation.',
  ].join('\n');
};
