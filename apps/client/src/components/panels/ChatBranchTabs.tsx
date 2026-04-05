/**
 * Branch tab bar for conversation branching.
 * Renders tabs for main thread + any active branches,
 * with close buttons and branch indicators on messages.
 */
import { useState } from 'react';
import { X, GitBranch, MessageSquare, Pencil, Check } from 'lucide-react';
import { type BranchState, type ConversationBranch } from './chat-branching';

// ---------------------------------------------------------------------------
// Branch Tab Bar
// ---------------------------------------------------------------------------

interface ChatBranchTabsProps {
  branchState: BranchState;
  onSwitchBranch: (branchId: string | null) => void;
  onDeleteBranch: (branchId: string) => void;
  onRenameBranch: (branchId: string, newLabel: string) => void;
}

const ChatBranchTabs = ({
  branchState,
  onSwitchBranch,
  onDeleteBranch,
  onRenameBranch,
}: ChatBranchTabsProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  if (branchState.branches.length === 0) return null;

  const isMainActive = branchState.activeBranchId === null;

  const handleStartRename = (branch: ConversationBranch) => {
    setEditingId(branch.id);
    setEditLabel(branch.label);
  };

  const handleFinishRename = () => {
    if (editingId && editLabel.trim()) {
      onRenameBranch(editingId, editLabel.trim());
    }
    setEditingId(null);
    setEditLabel('');
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '4px 8px',
        borderBottom: '1px solid var(--xp-border)',
        overflowX: 'auto',
        flexShrink: 0,
        fontSize: '11px',
      }}
      role="tablist"
      aria-label="Conversation branches"
    >
      <GitBranch
        size={12}
        style={{ flexShrink: 0, color: 'var(--xp-text-muted)', marginRight: '4px' }}
      />

      {/* Main thread tab */}
      <button
        role="tab"
        aria-selected={isMainActive}
        aria-label="Main conversation thread"
        onClick={() => onSwitchBranch(null)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 10px',
          borderRadius: '4px 4px 0 0',
          border: '1px solid var(--xp-border)',
          borderBottom: isMainActive ? '2px solid var(--xp-blue)' : '1px solid var(--xp-border)',
          background: isMainActive ? 'var(--xp-surface-light)' : 'transparent',
          color: isMainActive ? 'var(--xp-text)' : 'var(--xp-text-muted)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontWeight: isMainActive ? 600 : 400,
        }}
      >
        <MessageSquare size={10} />
        Main
      </button>

      {/* Branch tabs */}
      {branchState.branches.map((branch) => {
        const isActive = branchState.activeBranchId === branch.id;
        const isEditing = editingId === branch.id;

        return (
          <div
            key={branch.id}
            role="tab"
            aria-selected={isActive}
            aria-label={`Branch: ${branch.label}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 6px 3px 10px',
              borderRadius: '4px 4px 0 0',
              border: '1px solid var(--xp-border)',
              borderBottom: isActive
                ? '2px solid var(--xp-purple, #bb9af7)'
                : '1px solid var(--xp-border)',
              background: isActive ? 'rgba(187, 154, 247, 0.1)' : 'transparent',
              color: isActive ? 'var(--xp-text)' : 'var(--xp-text-muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontWeight: isActive ? 600 : 400,
              maxWidth: '160px',
            }}
            onClick={() => {
              if (!isEditing) onSwitchBranch(branch.id);
            }}
          >
            <GitBranch size={10} style={{ flexShrink: 0, color: 'var(--xp-purple, #bb9af7)' }} />

            {isEditing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename();
                    if (e.key === 'Escape') {
                      setEditingId(null);
                      setEditLabel('');
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  style={{
                    width: '80px',
                    padding: '1px 4px',
                    fontSize: '11px',
                    border: '1px solid var(--xp-blue)',
                    borderRadius: '2px',
                    background: 'var(--xp-bg)',
                    color: 'var(--xp-text)',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFinishRename();
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '1px',
                    color: 'var(--xp-green, #9ece6a)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Check size={10} />
                </button>
              </div>
            ) : (
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleStartRename(branch);
                }}
                title={`${branch.label} (double-click to rename)`}
              >
                {branch.label}
              </span>
            )}

            {!isEditing && isActive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartRename(branch);
                }}
                title="Rename branch"
                aria-label={`Rename branch: ${branch.label}`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '1px',
                  color: 'var(--xp-text-muted)',
                  opacity: 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <Pencil size={9} />
              </button>
            )}

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteBranch(branch.id);
              }}
              title="Close branch"
              aria-label={`Close branch: ${branch.label}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '1px',
                color: 'var(--xp-text-muted)',
                opacity: 0.5,
                display: 'flex',
                alignItems: 'center',
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
              <X size={10} />
            </button>
          </div>
        );
      })}

      {/* Branch count indicator */}
      <span
        style={{
          marginLeft: 'auto',
          color: 'var(--xp-text-muted)',
          fontSize: '10px',
          flexShrink: 0,
          opacity: 0.6,
        }}
      >
        {branchState.branches.length} branch{branchState.branches.length !== 1 ? 'es' : ''}
      </span>
    </div>
  );
};

export default ChatBranchTabs;

// ---------------------------------------------------------------------------
// Branch fork indicator on messages
// ---------------------------------------------------------------------------

interface BranchForkIndicatorProps {
  branchCount: number;
  onBranch: () => void;
}

export const BranchForkIndicator = ({ branchCount, onBranch }: BranchForkIndicatorProps) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginTop: '4px',
    }}
  >
    <button
      onClick={onBranch}
      title="Branch from this message"
      aria-label="Create a conversation branch from this message"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '4px',
        border: '1px solid var(--xp-border)',
        background: 'transparent',
        color: 'var(--xp-text-muted)',
        cursor: 'pointer',
        fontSize: '10px',
        opacity: 0.6,
        transition: 'opacity 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '1';
        e.currentTarget.style.borderColor = 'var(--xp-purple, #bb9af7)';
        e.currentTarget.style.color = 'var(--xp-purple, #bb9af7)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '0.6';
        e.currentTarget.style.borderColor = 'var(--xp-border)';
        e.currentTarget.style.color = 'var(--xp-text-muted)';
      }}
    >
      <GitBranch size={10} />
      Branch from here
    </button>
    {branchCount > 0 && (
      <span
        style={{
          fontSize: '10px',
          color: 'var(--xp-purple, #bb9af7)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
        }}
      >
        <GitBranch size={9} />
        {branchCount}
      </span>
    )}
  </div>
);
