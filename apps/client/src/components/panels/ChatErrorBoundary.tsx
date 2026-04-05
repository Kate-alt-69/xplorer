/**
 * Lightweight error boundary for the AI chat panel.
 * Uses inline styles to match the chat panel's styling approach.
 * Wraps risky UI sections (streaming text, file path cards, diff preview)
 * so that a single broken component doesn't crash the entire chat.
 */
import React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional short label shown when the boundary catches an error */
  label?: string;
}

interface ChatErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Component (must be a class because React error boundaries require it)
// ---------------------------------------------------------------------------

/**
 * Inline-styled error boundary for chat sub-components.
 *
 * Usage:
 *   <ChatErrorBoundary label="Diff preview">
 *     <ChatDiffPreview ... />
 *   </ChatErrorBoundary>
 */
class ChatErrorBoundary extends React.Component<ChatErrorBoundaryProps, ChatErrorBoundaryState> {
  constructor(props: ChatErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ChatErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[ChatErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`,
      error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            margin: '4px 0',
            borderRadius: '6px',
            border: '1px solid var(--xp-border)',
            background: 'rgba(247, 118, 142, 0.08)',
            color: 'var(--xp-text-muted)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ flexShrink: 0 }}>&#x26A0;</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {this.props.label ? `${this.props.label}: ` : ''}
            Failed to render
          </span>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            aria-label="Retry rendering"
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 8px',
              color: 'var(--xp-text-muted)',
              cursor: 'pointer',
              fontSize: '11px',
              flexShrink: 0,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ChatErrorBoundary;
