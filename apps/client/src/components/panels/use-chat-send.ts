/**
 * Hook extracting the slash-command dispatch, file-context building,
 * and message sending logic from StandaloneChatPanel.
 *
 * This keeps the main component under the 1000-line limit required
 * by the project style guide.
 */
import { useCallback } from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import { basename } from './chat-file-actions';
import { matchSlashCommand, SLASH_COMMANDS, LANG_EXTENSIONS } from './chat-slash-commands';
import { matchExtraSlashCommand } from './chat-slash-commands-extra';
import { handleSpecialSlashCommand } from './chat-special-commands';
import { handleTemplateSlashCommand } from './chat-action-templates';
import {
  type FileContext,
  getXplorerState,
  readFileForAIContext,
  readMultipleFilesForAIContext,
  IMAGE_EXTENSIONS,
} from './chat-context-helpers';
import { isCompareIntent, compareFiles as performFileComparison } from './chat-file-compare';
import { buildMarketplaceSuggestionText } from './chat-extension-awareness';
import type { RuntimeChatMessage } from './ChatMessageBubble';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = RuntimeChatMessage;

export interface SlashDispatchResult {
  /** If true, the slash command was handled inline; don't send to the AI. */
  handled: boolean;
  /** Messages to append (user + assistant) after handling. */
  appendMessages?: ChatMessage[];
  /** If set, re-invoke sendMessage with this prompt instead of the original. */
  redirectPrompt?: string;
  /** Side-effect callbacks to run (export, pin, etc.) */
  sideEffect?: () => void;
}

// ---------------------------------------------------------------------------
// Slash-command dispatch (pure logic, no hooks)
// ---------------------------------------------------------------------------

interface SlashDispatchDeps {
  messages: ChatMessage[];
  messagesRef: React.RefObject<ChatMessage[]>;
  currentPath: string;
  currentConversationId: string | null;
  exportChatHtml: () => void;
  exportChatMarkdown: () => void;
  handlePinMessage: (idx: number) => void;
  isMessagePinnedFn: (convId: string, idx: number) => boolean;
}

/**
 * Try to match and dispatch a slash command without calling the AI.
 * Returns a SlashDispatchResult describing what to do.
 */
export const dispatchSlashCommand = (
  text: string,
  deps: SlashDispatchDeps,
): SlashDispatchResult | null => {
  // Try matching against both base and extra slash command sets
  const slashMatch = matchSlashCommand(text) ?? matchExtraSlashCommand(text);
  if (!slashMatch) return null;

  const { prompt } = slashMatch;
  const {
    messages,
    messagesRef,
    currentPath,
    currentConversationId,
    exportChatHtml,
    exportChatMarkdown,
    handlePinMessage,
    isMessagePinnedFn,
  } = deps;

  // --- Export HTML ---
  if (prompt === '__EXPORT_CHAT_HTML__') {
    return {
      handled: true,
      sideEffect: exportChatHtml,
      appendMessages: [
        { role: 'user', content: text },
        { role: 'assistant', content: 'Chat exported as HTML report.' },
      ],
    };
  }

  // --- Export Markdown ---
  if (prompt === '__EXPORT_CHAT_MD__') {
    return {
      handled: true,
      sideEffect: exportChatMarkdown,
      appendMessages: [
        { role: 'user', content: text },
        { role: 'assistant', content: 'Chat exported as markdown.' },
      ],
    };
  }

  // --- Pin last message ---
  if (prompt === '__PIN_LAST__') {
    const lastAssistantIdx = messages.reduce(
      (acc, m, idx) => (m.role === 'assistant' && !m.isContextInjection ? idx : acc),
      -1,
    );
    if (lastAssistantIdx >= 0) {
      const convId = currentConversationId || 'unsaved';
      const wasPinned = isMessagePinnedFn(convId, lastAssistantIdx);
      return {
        handled: true,
        sideEffect: () => handlePinMessage(lastAssistantIdx),
        appendMessages: [
          { role: 'user', content: text },
          {
            role: 'assistant',
            content: wasPinned ? 'Unpinned the last AI message.' : 'Pinned the last AI message.',
          },
        ],
      };
    }
    return {
      handled: true,
      appendMessages: [
        { role: 'user', content: text },
        { role: 'assistant', content: 'No AI message to pin.' },
      ],
    };
  }

  // --- Help ---
  if (prompt === '__SHOW_HELP__') {
    const helpLines = SLASH_COMMANDS.map((cmd) => `\`${cmd.name}\` -- ${cmd.description}`);
    const helpText = `Available commands:\n${helpLines.join('\n')}\n\nKeyboard shortcuts:\n\`Ctrl+L\` -- Clear chat\n\`Up Arrow\` -- Recall last message\n\`Escape\` -- Cancel agent / close`;
    return {
      handled: true,
      appendMessages: [
        { role: 'user', content: text },
        { role: 'assistant', content: helpText },
      ],
    };
  }

  // --- Special commands (/memory, /forget, /compare, /preferences, etc.) ---
  {
    const specialResult = handleSpecialSlashCommand(prompt, currentPath);
    if (specialResult) {
      if (specialResult.type === 'redirect' && specialResult.redirectPrompt) {
        return { handled: true, redirectPrompt: specialResult.redirectPrompt };
      }
      return {
        handled: true,
        appendMessages: [
          { role: 'user', content: text },
          { role: 'assistant', content: specialResult.responseText ?? '' },
        ],
      };
    }
  }

  // --- Template commands (/templates, /save-template, /run-template, /delete-template) ---
  {
    const lastActionMsg = [...(messagesRef.current ?? [])]
      .reverse()
      .find((m) => m.role === 'assistant' && m.fileActions?.some((a) => a.status === 'success'));
    const lastSuccessActions =
      lastActionMsg?.fileActions?.filter((a) => a.status === 'success').map((a) => a.action) ?? [];
    const triggerIdx = lastActionMsg ? (messagesRef.current ?? []).indexOf(lastActionMsg) : -1;
    const triggerPrompt =
      triggerIdx > 0
        ? ((messagesRef.current ?? [])
            .slice(0, triggerIdx)
            .reverse()
            .find((m) => m.role === 'user' && !m.isContextInjection)?.content ?? '')
        : '';
    const tmplResult = handleTemplateSlashCommand(prompt, lastSuccessActions, triggerPrompt);
    if (tmplResult) {
      if (tmplResult.type === 'redirect' && tmplResult.redirectPrompt) {
        return { handled: true, redirectPrompt: tmplResult.redirectPrompt };
      }
      return {
        handled: true,
        appendMessages: [
          { role: 'user', content: text },
          { role: 'assistant', content: tmplResult.responseText ?? '' },
        ],
      };
    }
  }

  // --- Fallback: use the generated prompt from the slash command ---
  return { handled: true, redirectPrompt: prompt };
};

// ---------------------------------------------------------------------------
// Save code as file
// ---------------------------------------------------------------------------

export const useSaveCodeAsFile = (
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
) =>
  useCallback(
    async (code: string, language: string) => {
      const ext = (LANG_EXTENSIONS[language.toLowerCase()] ?? language) || 'txt';
      const xState = getXplorerState();
      const dir = xState?.currentPath ?? '';
      if (!dir) {
        console.warn('No current directory to save file in');
        return;
      }
      const fileName = `untitled.${ext}`;
      const filePath = `${dir}/${fileName}`;
      try {
        await TauriAPI.createFileWithContent(filePath, code);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Saved code to \`${filePath}\`` },
        ]);
      } catch (err) {
        console.error('Failed to save code as file:', err);
      }
    },
    [setMessages],
  );

// ---------------------------------------------------------------------------
// Drag & drop handler helpers
// ---------------------------------------------------------------------------

export const buildDroppedFiles = (
  e: React.DragEvent,
): Array<{ name: string; path: string; is_dir: boolean }> => {
  let files: Array<{ name: string; path: string; is_dir: boolean }> = [];

  // Xplorer internal drag format
  const xplorerData = e.dataTransfer.getData('application/xplorer-files');
  if (xplorerData) {
    try {
      const parsed: unknown = JSON.parse(xplorerData);
      if (Array.isArray(parsed)) {
        files = parsed.map((f: { name?: string; path?: string; is_dir?: boolean }) => ({
          name: String(f.name ?? basename(String(f.path ?? ''))),
          path: String(f.path ?? ''),
          is_dir: Boolean(f.is_dir),
        }));
      }
    } catch {
      // Invalid JSON
    }
  }

  // Fallback: text/plain with file paths
  if (files.length === 0) {
    const textData = e.dataTransfer.getData('text/plain');
    if (textData) {
      const paths = textData
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.startsWith('/') || /^[A-Z]:\\/i.test(p));
      if (paths.length > 0) {
        files = paths.map((p) => ({ name: basename(p), path: p, is_dir: false }));
      }
    }
  }

  // Fallback: browser File API (OS file drag into Tauri)
  if (files.length === 0 && e.dataTransfer.files.length > 0) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i];
      const filePath = (file as unknown as { path?: string }).path ?? file.name;
      files.push({ name: file.name, path: filePath, is_dir: false });
    }
  }

  return files;
};

// ---------------------------------------------------------------------------
// File context and AI message building (used during sendMessage)
// ---------------------------------------------------------------------------

export interface FileReadResult {
  fileContexts: FileContext[];
  compareContext: string | null;
  imageContexts: Array<{ name: string; path: string; dataUrl: string }>;
}

/**
 * Read files to build AI context: text content, images, and optional
 * file comparison data.
 */
export const buildFileContext = async (
  filesToRead: Array<{ name: string; path: string; is_dir: boolean }>,
  userText: string,
): Promise<FileReadResult> => {
  let compareContext: string | null = null;
  const imageContexts: Array<{ name: string; path: string; dataUrl: string }> = [];

  // Detect file comparison intent when exactly 2 files
  if (
    filesToRead.length === 2 &&
    !filesToRead[0].is_dir &&
    !filesToRead[1].is_dir &&
    isCompareIntent(userText, 2)
  ) {
    const compResult = await performFileComparison(filesToRead[0].path, filesToRead[1].path);
    if (compResult.success) {
      compareContext = compResult.contextForAI;
    }
  }

  const fileContexts =
    filesToRead.length === 1 && !filesToRead[0].is_dir
      ? [await readFileForAIContext(filesToRead[0])]
      : await readMultipleFilesForAIContext(filesToRead);

  // Build image thumbnail data for the user message
  for (const fc of fileContexts) {
    if (fc.imageBase64 && fc.imageMimeType) {
      imageContexts.push({
        name: fc.name,
        path: fc.path,
        dataUrl: `data:${fc.imageMimeType};base64,${fc.imageBase64}`,
      });
    }
  }

  return { fileContexts, compareContext, imageContexts };
};

/**
 * Build the API messages array from visible chat history, injecting
 * file comparison and marketplace contexts as needed.
 */
export const buildHistoryMessages = (
  newMessages: ChatMessage[],
  text: string,
  compareContext: string | null,
): Array<{ role: string; content: string }> => {
  const historyMsgs = newMessages
    .filter((m) => !m.isContextInjection || m.isCommandResult)
    .map((m) => ({ role: m.role, content: m.content }));

  // Inject file comparison context if detected
  if (compareContext) {
    historyMsgs.push({
      role: 'user',
      content: `[File comparison data]\n${compareContext}`,
    });
  }

  // Inject marketplace extension suggestions if relevant
  {
    const marketplaceHint = buildMarketplaceSuggestionText(text);
    if (marketplaceHint) {
      historyMsgs.push({
        role: 'user',
        content: `[Marketplace extension info]\n${marketplaceHint}`,
      });
    }
  }

  return historyMsgs;
};

// Re-export IMAGE_EXTENSIONS for use in the main component
export { IMAGE_EXTENSIONS };
