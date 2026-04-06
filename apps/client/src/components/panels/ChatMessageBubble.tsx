/**
 * Single chat message bubble with file action cards.
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import React, { useState, useCallback } from 'react';
import { FileText } from 'lucide-react';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import { FileActionCard, BatchActionCard } from './ChatActionCards';
import { CommandActionCard } from './ChatCommandCard';
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
// Image thumbnail strip & lightbox
// ---------------------------------------------------------------------------

const ImageThumbnailStrip = ({
  images,
}: {
  images: Array<{ name: string; path: string; dataUrl: string }>;
}) => {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const closeLightbox = useCallback(() => setLightboxUrl(null), []);

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '4px',
          marginLeft: '20%',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        {images.map((img) => (
          <button
            key={img.path}
            title={`${img.name} — click to preview`}
            onClick={() => setLightboxUrl(img.dataUrl)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px',
              borderRadius: '6px',
              border: '1px solid var(--xp-border)',
              background: 'var(--xp-surface)',
              cursor: 'pointer',
              maxWidth: '120px',
            }}
          >
            <img
              src={img.dataUrl}
              alt={img.name}
              style={{
                width: '48px',
                height: '48px',
                objectFit: 'cover',
                borderRadius: '4px',
              }}
            />
            <span
              style={{
                fontSize: '10px',
                color: 'var(--xp-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '60px',
              }}
            >
              {img.name}
            </span>
          </button>
        ))}
      </div>

      {/* Lightbox overlay */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-label="Image preview"
          onClick={closeLightbox}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeLightbox();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <img
            src={lightboxUrl}
            alt="Full preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
          />
          <span
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            ×
          </span>
        </div>
      )}
    </>
  );
};

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
      {/* Image thumbnails on user messages */}
      {msg.imageContexts && msg.imageContexts.length > 0 && (
        <ImageThumbnailStrip images={msg.imageContexts} />
      )}

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

      {msg.fileActions?.map((pa) =>
        pa.action.action === 'run_command' ? (
          <CommandActionCard
            key={pa.id}
            pendingAction={pa}
            onAllow={() => onExecuteAction(i, pa.id)}
            onReject={() => onRejectAction(i, pa.id)}
          />
        ) : (
          <FileActionCard
            key={pa.id}
            pendingAction={pa}
            onAllow={() => onExecuteAction(i, pa.id)}
            onReject={() => onRejectAction(i, pa.id)}
            onAlwaysAllow={() => onAlwaysAllowAction(i, pa.id)}
            onUndo={() => onUndoAction(i, pa.id)}
          />
        ),
      )}

      {showBatchCard && msg.fileActions && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 2,
          }}
        >
          <BatchActionCard
            actions={msg.fileActions}
            onAllowAll={() => onBatchAllowAll(i)}
            onRejectAll={() => onBatchRejectAll(i)}
            onAlwaysAllow={() => onBatchAlwaysAllow(i)}
          />
        </div>
      )}
    </div>
  );
};

export default ChatMessageBubble;
