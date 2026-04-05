/**
 * Context menu for chat messages.
 * Provides Pin/Unpin and Copy actions.
 */
import React, { useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessageContextMenuProps {
  x: number;
  y: number;
  isPinned: boolean;
  onPin: () => void;
  onCopy: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Shared menu item style
// ---------------------------------------------------------------------------

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '6px 10px',
  background: 'none',
  border: 'none',
  color: 'var(--xp-text)',
  cursor: 'pointer',
  fontSize: '12px',
  borderRadius: '4px',
  textAlign: 'left',
};

const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
  (e.currentTarget as HTMLElement).style.background = 'var(--xp-bg-hover, rgba(255,255,255,0.05))';
};

const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
  (e.currentTarget as HTMLElement).style.background = 'none';
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatMessageContextMenu = ({
  x,
  y,
  isPinned,
  onPin,
  onCopy,
  onClose,
}: ChatMessageContextMenuProps) => {
  // Close on click/keydown outside
  useEffect(() => {
    const handleClick = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handlePin = useCallback(() => {
    onPin();
    onClose();
  }, [onPin, onClose]);

  const handleCopy = useCallback(() => {
    onCopy();
    onClose();
  }, [onCopy, onClose]);

  return (
    <div
      role="menu"
      aria-label="Message actions"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 9999,
        background: 'var(--xp-surface)',
        border: '1px solid var(--xp-border)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        padding: '4px',
        minWidth: '160px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        role="menuitem"
        onClick={handlePin}
        style={menuItemStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span style={{ fontSize: '14px' }}>{'\u{1F4CC}'}</span>
        {isPinned ? 'Unpin message' : 'Pin message'}
      </button>
      <button
        role="menuitem"
        onClick={handleCopy}
        style={menuItemStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span style={{ fontSize: '14px' }}>{'\u{1F4CB}'}</span>
        Copy message
      </button>
    </div>
  );
};

export default ChatMessageContextMenu;
