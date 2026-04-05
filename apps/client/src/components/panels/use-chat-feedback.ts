/**
 * Hook for message feedback (thumbs up/down), pinning, and context menu.
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  getPinnedMessages,
  pinMessage,
  unpinMessage,
  isMessagePinned,
  type PinnedMessage,
} from './chat-pinning';
import { learnFromPositiveFeedback, learnFromNegativeFeedback } from './chat-correction-learning';
import { addPositiveFeedback, addNegativeFeedback } from './chat-feedback-store';
import type { RuntimeChatMessage } from './ChatMessageBubble';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = RuntimeChatMessage;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useChatFeedback = (
  messages: ChatMessage[],
  currentPath: string,
  currentConversationId: string | null,
  scrollRef: React.RefObject<HTMLDivElement | null>,
) => {
  // -- Pinned messages --
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);

  useEffect(() => {
    if (currentConversationId) {
      setPinnedMessages(getPinnedMessages(currentConversationId));
    } else {
      setPinnedMessages([]);
    }
  }, [currentConversationId]);

  const handlePinMessage = useCallback(
    (messageIndex: number) => {
      const convId = currentConversationId || 'unsaved';
      const msg = messages[messageIndex];
      if (!msg) return;
      if (isMessagePinned(convId, messageIndex)) {
        unpinMessage(convId, messageIndex);
      } else {
        pinMessage(convId, messageIndex, msg.content, msg.role);
      }
      setPinnedMessages(getPinnedMessages(convId));
    },
    [currentConversationId, messages],
  );

  const handleUnpinMessage = useCallback(
    (messageIndex: number) => {
      const convId = currentConversationId || 'unsaved';
      unpinMessage(convId, messageIndex);
      setPinnedMessages(getPinnedMessages(convId));
    },
    [currentConversationId],
  );

  const handleJumpToMessage = useCallback(
    (messageIndex: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const msgEl = el.querySelector(`[data-msg-index="${messageIndex}"]`);
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const htmlEl = msgEl as HTMLElement;
        htmlEl.style.outline = '2px solid var(--xp-yellow)';
        htmlEl.style.outlineOffset = '2px';
        htmlEl.style.borderRadius = '8px';
        setTimeout(() => {
          htmlEl.style.outline = '';
          htmlEl.style.outlineOffset = '';
        }, 1500);
      }
    },
    [scrollRef],
  );

  // -- Feedback (thumbs up/down) --
  const [feedbackMap, setFeedbackMap] = useState<Record<number, 'positive' | 'negative'>>({});

  const findUserPromptForMessage = useCallback(
    (messageIndex: number): string => {
      for (let i = messageIndex - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'user' && !msg.isContextInjection) {
          return msg.content;
        }
      }
      return '';
    },
    [messages],
  );

  const handlePositiveFeedback = useCallback(
    (messageIndex: number) => {
      const msg = messages[messageIndex];
      if (!msg || msg.role !== 'assistant') return;
      const userPrompt = findUserPromptForMessage(messageIndex);
      addPositiveFeedback(messageIndex, msg.content, userPrompt, currentPath);
      learnFromPositiveFeedback(userPrompt, msg.content, currentPath);
      setFeedbackMap((prev) => ({ ...prev, [messageIndex]: 'positive' }));
    },
    [messages, currentPath, findUserPromptForMessage],
  );

  const handleNegativeFeedback = useCallback(
    (messageIndex: number, correctionText?: string) => {
      const msg = messages[messageIndex];
      if (!msg || msg.role !== 'assistant') return;
      const userPrompt = findUserPromptForMessage(messageIndex);
      addNegativeFeedback(messageIndex, msg.content, userPrompt, currentPath, correctionText);
      if (correctionText) {
        learnFromNegativeFeedback(correctionText, userPrompt, currentPath);
      }
      setFeedbackMap((prev) => ({ ...prev, [messageIndex]: 'negative' }));
    },
    [messages, currentPath, findUserPromptForMessage],
  );

  // -- Context menu for pinning --
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    messageIndex: number;
  } | null>(null);

  const handleMessageContextMenu = useCallback(
    (e: React.MouseEvent, messageIndex: number) => {
      const msg = messages[messageIndex];
      if (!msg || msg.isContextInjection) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, messageIndex });
    },
    [messages],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    pinnedMessages,
    handlePinMessage,
    handleUnpinMessage,
    handleJumpToMessage,
    feedbackMap,
    handlePositiveFeedback,
    handleNegativeFeedback,
    contextMenu,
    handleMessageContextMenu,
    closeContextMenu,
  };
};
