/**
 * Collapsible pinned messages section for the chat panel.
 * Displayed at the top of the chat when messages are pinned.
 */
import React, { useState, useCallback } from 'react';
import { Pin, ChevronDown, ChevronRight, X } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import type { PinnedMessage } from './chat-pinning';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatPinnedMessagesProps {
  pinnedMessages: PinnedMessage[];
  onUnpin: (messageIndex: number) => void;
  onJumpToMessage: (messageIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatPinnedMessages = ({
  pinnedMessages,
  onUnpin,
  onJumpToMessage,
}: ChatPinnedMessagesProps) => {
  const [expanded, setExpanded] = useState(true);

  const handleToggle = useCallback(() => setExpanded((v) => !v), []);

  if (pinnedMessages.length === 0) return null;

  return (
    <div
      style={{
        borderBottom: '1px solid var(--xp-border)',
        background: 'var(--xp-surface)',
      }}
    >
      {/* Header */}
      <button
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '6px 10px',
          background: 'none',
          border: 'none',
          color: 'var(--xp-yellow)',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 600,
          textAlign: 'left',
        }}
        aria-expanded={expanded}
        aria-label={`Pinned messages (${pinnedMessages.length})`}
      >
        <Pin size={12} style={{ flexShrink: 0 }} />
        <span>Pinned ({pinnedMessages.length})</span>
        {expanded ? (
          <ChevronDown size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />
        )}
      </button>

      {/* Pinned items */}
      {expanded && (
        <div
          style={{
            maxHeight: '200px',
            overflowY: 'auto',
            padding: '0 8px 8px',
          }}
        >
          {pinnedMessages.map((pin) => (
            <PinnedItem
              key={pin.messageIndex}
              pin={pin}
              onUnpin={onUnpin}
              onJump={onJumpToMessage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// PinnedItem
// ---------------------------------------------------------------------------

interface PinnedItemProps {
  pin: PinnedMessage;
  onUnpin: (messageIndex: number) => void;
  onJump: (messageIndex: number) => void;
}

const PinnedItem = React.memo(({ pin, onUnpin, onJump }: PinnedItemProps) => {
  const isAssistant = pin.role === 'assistant';
  const preview = pin.content.length > 200 ? `${pin.content.slice(0, 197)}...` : pin.content;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        marginBottom: '4px',
        padding: '6px 8px',
        borderRadius: '6px',
        background: 'var(--xp-bg)',
        border: '1px solid var(--xp-border)',
        fontSize: '12px',
        lineHeight: '1.4',
        cursor: 'pointer',
      }}
      role="button"
      tabIndex={0}
      aria-label={`Jump to pinned ${pin.role} message`}
      onClick={() => onJump(pin.messageIndex)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onJump(pin.messageIndex);
        }
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: '9px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: isAssistant ? 'var(--xp-purple)' : 'var(--xp-blue)',
          marginTop: '2px',
        }}
      >
        {isAssistant ? 'AI' : 'You'}
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          color: 'var(--xp-text)',
          overflow: 'hidden',
        }}
      >
        {isAssistant ? (
          <div style={{ maxHeight: '60px', overflow: 'hidden' }}>
            <MarkdownRenderer content={preview} />
          </div>
        ) : (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '60px',
              overflow: 'hidden',
            }}
          >
            {preview}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnpin(pin.messageIndex);
        }}
        title="Unpin this message"
        aria-label="Unpin this message"
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          color: 'var(--xp-text-muted)',
          cursor: 'pointer',
          padding: '2px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
});

PinnedItem.displayName = 'PinnedItem';

export default ChatPinnedMessages;
