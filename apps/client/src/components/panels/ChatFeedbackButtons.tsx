/**
 * Thumbs up / thumbs down feedback buttons for AI messages.
 * Shows after every assistant response. Thumbs down opens a quick correction input.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatFeedbackButtonsProps {
  /** Index of the message in the chat */
  messageIndex: number;
  /** Existing feedback type for this message, if any */
  existingFeedback: 'positive' | 'negative' | null;
  /** Called when user gives thumbs up */
  onPositive: (messageIndex: number) => void;
  /** Called when user gives thumbs down with optional correction text */
  onNegative: (messageIndex: number, correctionText?: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatFeedbackButtons = React.memo(
  ({ messageIndex, existingFeedback, onPositive, onNegative }: ChatFeedbackButtonsProps) => {
    const [showCorrectionInput, setShowCorrectionInput] = useState(false);
    const [correctionText, setCorrectionText] = useState('');
    const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(existingFeedback);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync if external feedback state changes
    useEffect(() => {
      setFeedback(existingFeedback);
    }, [existingFeedback]);

    // Auto-focus correction input when it appears
    useEffect(() => {
      if (showCorrectionInput && inputRef.current) {
        inputRef.current.focus();
      }
    }, [showCorrectionInput]);

    const handleThumbsUp = useCallback(() => {
      if (feedback === 'positive') return;
      setFeedback('positive');
      setShowCorrectionInput(false);
      onPositive(messageIndex);
    }, [feedback, messageIndex, onPositive]);

    const handleThumbsDown = useCallback(() => {
      if (feedback === 'negative') {
        // Already negative, toggle off the correction input
        setShowCorrectionInput((v) => !v);
        return;
      }
      setFeedback('negative');
      setShowCorrectionInput(true);
    }, [feedback]);

    const handleSubmitCorrection = useCallback(() => {
      const text = correctionText.trim();
      onNegative(messageIndex, text || undefined);
      setShowCorrectionInput(false);
      setCorrectionText('');
    }, [correctionText, messageIndex, onNegative]);

    const handleSkipCorrection = useCallback(() => {
      onNegative(messageIndex);
      setShowCorrectionInput(false);
      setCorrectionText('');
    }, [messageIndex, onNegative]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmitCorrection();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          handleSkipCorrection();
        }
      },
      [handleSubmitCorrection, handleSkipCorrection],
    );

    return (
      <div style={{ marginTop: '4px', marginRight: '20%' }}>
        {/* Feedback buttons row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          className={['chat-feedback-buttons', feedback ? 'chat-feedback-given' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <button
            onClick={handleThumbsUp}
            title="Good response"
            aria-label="Mark as good response"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '22px',
              height: '22px',
              padding: 0,
              border: 'none',
              borderRadius: '4px',
              background: feedback === 'positive' ? 'rgba(115, 218, 142, 0.2)' : 'transparent',
              color: feedback === 'positive' ? 'var(--xp-green)' : 'var(--xp-text-muted)',
              cursor: feedback === 'positive' ? 'default' : 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <ThumbsUp size={12} />
          </button>
          <button
            onClick={handleThumbsDown}
            title="Bad response — suggest improvement"
            aria-label="Mark as bad response"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '22px',
              height: '22px',
              padding: 0,
              border: 'none',
              borderRadius: '4px',
              background: feedback === 'negative' ? 'rgba(247, 118, 142, 0.2)' : 'transparent',
              color: feedback === 'negative' ? 'var(--xp-red)' : 'var(--xp-text-muted)',
              cursor: feedback === 'negative' ? 'default' : 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <ThumbsDown size={12} />
          </button>
          {feedback && (
            <span
              style={{
                fontSize: '10px',
                color: 'var(--xp-text-muted)',
                marginLeft: '2px',
              }}
            >
              {feedback === 'positive' ? 'Thanks!' : 'Noted'}
            </span>
          )}
        </div>

        {/* Correction input (shown after thumbs down) */}
        {showCorrectionInput && (
          <div
            style={{
              marginTop: '6px',
              display: 'flex',
              gap: '4px',
              alignItems: 'center',
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What should I do differently?"
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid var(--xp-border)',
                background: 'var(--xp-surface)',
                color: 'var(--xp-text)',
                fontSize: '11px',
                outline: 'none',
              }}
              aria-label="Describe what the AI should do differently"
            />
            <button
              onClick={handleSubmitCorrection}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: 'none',
                background: 'var(--xp-blue)',
                color: 'white',
                fontSize: '11px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              aria-label="Submit feedback"
            >
              Save
            </button>
            <button
              onClick={handleSkipCorrection}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--xp-border)',
                background: 'transparent',
                color: 'var(--xp-text-muted)',
                fontSize: '11px',
                cursor: 'pointer',
              }}
              aria-label="Skip correction details"
            >
              Skip
            </button>
          </div>
        )}
      </div>
    );
  },
);

ChatFeedbackButtons.displayName = 'ChatFeedbackButtons';

export default ChatFeedbackButtons;
