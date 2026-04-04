/**
 * Chat history panel -- lists saved conversations and lets users
 * load or delete them.
 */
import { ChevronLeft, Trash2 } from 'lucide-react';
import { type SavedConversation, formatRelativeTime } from './chat-history';

interface ChatHistoryViewProps {
  chatHistory: SavedConversation[];
  currentConversationId: string | null;
  onBack: () => void;
  onLoad: (conv: SavedConversation) => void;
  onDelete: (convId: string) => void;
}

const ChatHistoryView = ({
  chatHistory,
  currentConversationId,
  onBack,
  onLoad,
  onDelete,
}: ChatHistoryViewProps) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {/* History header */}
    <div
      style={{
        borderBottom: '1px solid var(--xp-border)',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        aria-label="Back to chat"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--xp-text)',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <ChevronLeft size={16} />
      </button>
      <span style={{ fontWeight: 600, color: 'var(--xp-text)', fontSize: '13px' }}>
        Chat History
      </span>
      <span style={{ color: 'var(--xp-text-muted)', fontSize: '11px', marginLeft: 'auto' }}>
        {chatHistory.length} conversation{chatHistory.length !== 1 ? 's' : ''}
      </span>
    </div>

    {/* History list */}
    <div
      role="list"
      aria-label="Saved conversations"
      style={{ flex: 1, overflowY: 'auto', padding: '4px' }}
    >
      {chatHistory.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--xp-text-muted)',
            fontSize: '13px',
          }}
        >
          No saved conversations
        </div>
      )}
      {chatHistory.map((conv) => (
        <div
          key={conv.id}
          style={{
            padding: '10px 12px',
            margin: '2px 4px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background:
              conv.id === currentConversationId ? 'rgba(122, 162, 247, 0.1)' : 'transparent',
          }}
          onClick={() => onLoad(conv)}
          onMouseEnter={(e) => {
            if (conv.id !== currentConversationId) {
              e.currentTarget.style.background = 'var(--xp-surface-light)';
            }
          }}
          onMouseLeave={(e) => {
            if (conv.id !== currentConversationId) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '13px',
                color: 'var(--xp-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {conv.title}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--xp-text-muted)', marginTop: '2px' }}>
              {conv.messages.filter((m) => m.role === 'user').length} messages
              {' -- '}
              {formatRelativeTime(conv.updatedAt)}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(conv.id);
            }}
            title="Delete conversation"
            aria-label={`Delete conversation: ${conv.title}`}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--xp-text-muted)',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              opacity: 0.5,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.color = 'var(--xp-red, #f7768e)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.5';
              e.currentTarget.style.color = 'var(--xp-text-muted)';
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  </div>
);

export default ChatHistoryView;
