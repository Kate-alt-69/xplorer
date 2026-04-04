/**
 * Single chat message bubble with file action cards.
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import React from 'react';
import { FileText } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import { FileActionCard, BatchActionCard } from './ChatActionCards';
import ChatErrorBoundary from './ChatErrorBoundary';
import { type PendingFileAction, isReadOnlyAction } from './chat-file-actions';
import { type ChatMessage } from './chat-history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Runtime chat message (extends persisted version with pending action state) */
export interface RuntimeChatMessage extends ChatMessage {
  fileActions?: PendingFileAction[];
}

interface ChatMessageBubbleProps {
  message: RuntimeChatMessage;
  index: number;
  displayText: string;
  onExecuteAction: (messageIndex: number, actionId: string) => void;
  onRejectAction: (messageIndex: number, actionId: string) => void;
  onAlwaysAllowAction: (messageIndex: number, actionId: string) => void;
  onUndoAction: (messageIndex: number, actionId: string) => void;
  onBatchAllowAll: (messageIndex: number) => void;
  onBatchRejectAll: (messageIndex: number) => void;
  onBatchAlwaysAllow: (messageIndex: number) => void;
  onSaveCodeAsFile?: (code: string, language: string) => void;
  renderFilePath?: (filePath: string) => React.ReactNode | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getPendingMutatingCount = (msg: RuntimeChatMessage): number =>
  msg.fileActions?.filter((a) => a.status === 'pending' && !isReadOnlyAction(a.action.action))
    .length ?? 0;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatMessageBubble = ({
  message: msg,
  index: i,
  displayText,
  onExecuteAction,
  onRejectAction,
  onAlwaysAllowAction,
  onUndoAction,
  onBatchAllowAll,
  onBatchRejectAll,
  onBatchAlwaysAllow,
  onSaveCodeAsFile,
  renderFilePath,
}: ChatMessageBubbleProps) => {
  if (msg.isContextInjection) return null;

  const pendingMutatingCount = getPendingMutatingCount(msg);
  const showBatchCard = pendingMutatingCount > 1;

  return (
    <div style={{ marginBottom: '12px' }} role="article" aria-label={`${msg.role} message`}>
      {/* Dropped files indicator on user messages */}
      {msg.droppedFiles && msg.droppedFiles.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            marginBottom: '4px',
            marginLeft: '20%',
            justifyContent: 'flex-end',
          }}
        >
          {msg.droppedFiles.map((f) => (
            <span
              key={f.path}
              title={f.path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(122, 162, 247, 0.15)',
                color: 'var(--xp-blue)',
                fontSize: '10px',
              }}
            >
              <FileText size={9} style={{ flexShrink: 0 }} />
              {f.name}
            </span>
          ))}
        </div>
      )}

      {msg.content && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '13px',
            lineHeight: '1.5',
            background: msg.role === 'user' ? 'var(--xp-blue)' : 'var(--xp-surface-light)',
            color: msg.role === 'user' ? 'white' : 'var(--xp-text)',
            marginLeft: msg.role === 'user' ? '20%' : '0',
            marginRight: msg.role === 'assistant' ? '20%' : '0',
            whiteSpace: msg.role === 'user' ? 'pre-wrap' : undefined,
            wordBreak: 'break-word',
          }}
        >
          {msg.role === 'assistant' ? (
            <ChatErrorBoundary label="Message content">
              <MarkdownRenderer
                content={displayText}
                onSaveCodeAsFile={onSaveCodeAsFile}
                renderFilePath={renderFilePath}
              />
            </ChatErrorBoundary>
          ) : (
            displayText
          )}
        </div>
      )}

      {showBatchCard && msg.fileActions && (
        <BatchActionCard
          actions={msg.fileActions}
          onAllowAll={() => onBatchAllowAll(i)}
          onRejectAll={() => onBatchRejectAll(i)}
          onAlwaysAllow={() => onBatchAlwaysAllow(i)}
        />
      )}

      {msg.fileActions?.map((pa) => (
        <FileActionCard
          key={pa.id}
          pendingAction={pa}
          onAllow={() => onExecuteAction(i, pa.id)}
          onReject={() => onRejectAction(i, pa.id)}
          onAlwaysAllow={() => onAlwaysAllowAction(i, pa.id)}
          onUndo={() => onUndoAction(i, pa.id)}
        />
      ))}
    </div>
  );
};

export default ChatMessageBubble;
