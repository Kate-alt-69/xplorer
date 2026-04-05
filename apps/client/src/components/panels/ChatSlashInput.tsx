/**
 * Chat input bar with slash command autocomplete.
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, RotateCcw, History, Mic, MicOff } from 'lucide-react';
import { SLASH_COMMANDS, type SlashCommand } from './chat-slash-commands';
import { EXTRA_SLASH_COMMANDS } from './chat-slash-commands-extra';
import useVoiceInput from '@/hooks/use-voice-input';

/** Merged set of all slash commands (core + extensions like /commit-message, /workflows). */
const ALL_SLASH_COMMANDS: SlashCommand[] = [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatSlashInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onShowHistory: () => void;
  onClearChat: () => void;
  isLoading: boolean;
  hasMessages: boolean;
  droppedFileCount: number;
}

export interface ChatSlashInputHandle {
  focus: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatSlashInput = forwardRef<ChatSlashInputHandle, ChatSlashInputProps>(
  (
    {
      input,
      onInputChange,
      onSend,
      onShowHistory,
      onClearChat,
      isLoading,
      hasMessages,
      droppedFileCount,
    },
    ref,
  ) => {
    const { t, i18n } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const [slashSuggestions, setSlashSuggestions] = useState<SlashCommand[]>([]);
    const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(0);
    const inputHistoryRef = useRef<string[]>([]);
    const inputHistoryIndexRef = useRef(-1);
    const [voiceAutoSend, setVoiceAutoSend] = useState(false);

    const handleVoiceResult = useCallback(
      (text: string) => {
        // Append to existing input or set directly
        const combined = input ? `${input} ${text}` : text;
        onInputChange(combined);
      },
      [input, onInputChange],
    );

    const handleAutoSend = useCallback(() => {
      // Small delay so the final transcript has time to land in state
      setTimeout(() => onSend(), 50);
    }, [onSend]);

    const { isListening, isSupported, interimTranscript, startListening, stopListening } =
      useVoiceInput({
        lang: i18n.language,
        onResult: handleVoiceResult,
        autoSend: voiceAutoSend,
        onAutoSend: handleAutoSend,
      });

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    /** Push a value to input history (called externally when sending) */
    const pushHistory = useCallback((text: string) => {
      inputHistoryRef.current = [text, ...inputHistoryRef.current.slice(0, 49)];
      inputHistoryIndexRef.current = -1;
    }, []);

    // Expose pushHistory on the handle as well -- but since we use forwardRef
    // we keep it simple: the parent passes input and calls onSend.
    // The parent calls pushHistory by storing it.

    // Slash command suggestions
    useEffect(() => {
      if (input.startsWith('/') && input.length > 0) {
        const trimmed = input.trim().toLowerCase();
        const matches = ALL_SLASH_COMMANDS.filter(
          (cmd) => cmd.name.startsWith(trimmed) || cmd.name.startsWith(trimmed.split(' ')[0]),
        );
        const newSuggestions = matches.length > 0 && trimmed !== matches[0]?.name ? matches : [];
        setSlashSuggestions(newSuggestions);
        setSelectedSuggestionIdx(0);
      } else {
        setSlashSuggestions([]);
        setSelectedSuggestionIdx(0);
      }
    }, [input]);

    const applySuggestion = useCallback(
      (cmd: SlashCommand) => {
        onInputChange(cmd.hasArgs ? `${cmd.name} ` : cmd.name);
        setSlashSuggestions([]);
        setSelectedSuggestionIdx(0);
        inputRef.current?.focus();
      },
      [onInputChange],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Navigate slash command suggestions with arrow keys
        if (slashSuggestions.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedSuggestionIdx((prev) => (prev < slashSuggestions.length - 1 ? prev + 1 : 0));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedSuggestionIdx((prev) => (prev > 0 ? prev - 1 : slashSuggestions.length - 1));
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (slashSuggestions[selectedSuggestionIdx]) {
              const cmd = slashSuggestions[selectedSuggestionIdx];
              // If the command has no args, send immediately
              if (!cmd.hasArgs) {
                onInputChange(cmd.name);
                setSlashSuggestions([]);
                // Wait a tick for state to update, then send
                setTimeout(() => onSend(), 0);
              } else {
                applySuggestion(cmd);
              }
            }
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            if (slashSuggestions[selectedSuggestionIdx]) {
              applySuggestion(slashSuggestions[selectedSuggestionIdx]);
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setSlashSuggestions([]);
            return;
          }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          pushHistory(input);
          onSend();
          return;
        }
        // Up arrow -- recall previous input from history
        if (e.key === 'ArrowUp' && !input) {
          e.preventDefault();
          const history = inputHistoryRef.current;
          if (history.length > 0) {
            const nextIdx = Math.min(inputHistoryIndexRef.current + 1, history.length - 1);
            inputHistoryIndexRef.current = nextIdx;
            onInputChange(history[nextIdx]);
          }
          return;
        }
        // Down arrow -- navigate forward in history
        if (e.key === 'ArrowDown' && inputHistoryIndexRef.current >= 0) {
          e.preventDefault();
          const nextIdx = inputHistoryIndexRef.current - 1;
          inputHistoryIndexRef.current = nextIdx;
          onInputChange(nextIdx >= 0 ? inputHistoryRef.current[nextIdx] : '');
        }
      },
      [
        input,
        slashSuggestions,
        selectedSuggestionIdx,
        onSend,
        onInputChange,
        applySuggestion,
        pushHistory,
      ],
    );

    return (
      <div
        style={{
          borderTop: '1px solid var(--xp-border)',
          padding: '8px',
          display: 'flex',
          gap: '6px',
        }}
      >
        <button
          onClick={onShowHistory}
          title={t('aiChat.input.chatHistory')}
          aria-label={t('aiChat.input.openChatHistory')}
          style={{
            padding: '8px',
            borderRadius: '6px',
            border: '1px solid var(--xp-border)',
            background: 'transparent',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <History size={14} />
        </button>
        {hasMessages && (
          <button
            onClick={onClearChat}
            title={t('aiChat.input.newChat')}
            aria-label={t('aiChat.input.startNewChat')}
            style={{
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--xp-border)',
              background: 'transparent',
              color: 'var(--xp-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <RotateCcw size={14} />
          </button>
        )}
        <div style={{ flex: 1, position: 'relative' }}>
          {/* Slash command suggestions dropdown */}
          {slashSuggestions.length > 0 && (
            <div
              role="listbox"
              aria-label="Slash command suggestions"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: '4px',
                background: 'var(--xp-surface)',
                border: '1px solid var(--xp-border)',
                borderRadius: '6px',
                overflow: 'hidden',
                zIndex: 10,
              }}
            >
              {slashSuggestions.map((cmd, idx) => (
                <button
                  key={cmd.name}
                  role="option"
                  aria-selected={idx === selectedSuggestionIdx}
                  onClick={() => applySuggestion(cmd)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '6px 10px',
                    border: 'none',
                    background:
                      idx === selectedSuggestionIdx ? 'var(--xp-surface-light)' : 'transparent',
                    color: 'var(--xp-text)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    setSelectedSuggestionIdx(idx);
                    e.currentTarget.style.background = 'var(--xp-surface-light)';
                  }}
                  onMouseLeave={(e) => {
                    if (idx !== selectedSuggestionIdx) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <code
                    style={{
                      color: 'var(--xp-blue)',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                    }}
                  >
                    {cmd.name}
                  </code>
                  <span style={{ color: 'var(--xp-text-muted)', fontSize: '11px' }}>
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isListening
                  ? t('aiChat.input.placeholderListening')
                  : droppedFileCount > 0
                    ? t('aiChat.input.placeholderAttached', { count: droppedFileCount })
                    : t('aiChat.input.placeholder')
              }
              disabled={isLoading}
              aria-label={t('aiChat.input.sendMessage')}
              aria-autocomplete="list"
              aria-expanded={slashSuggestions.length > 0}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: isListening
                  ? '1px solid var(--xp-red, #e53e3e)'
                  : '1px solid var(--xp-border)',
                background: 'var(--xp-bg)',
                color: 'var(--xp-text)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            {isListening && interimTranscript && (
              <div
                aria-live="polite"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: '8px 12px',
                  fontSize: '13px',
                  color: 'var(--xp-text-muted)',
                  opacity: 0.6,
                  pointerEvents: 'none',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  display: input ? 'none' : 'block',
                }}
              >
                {interimTranscript}
              </div>
            )}
          </div>
        </div>
        {isSupported && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={isLoading}
              aria-label={isListening ? t('aiChat.input.voiceStop') : t('aiChat.input.voiceStart')}
              title={
                isListening
                  ? 'Stop listening'
                  : `Voice input${voiceAutoSend ? ' (auto-send on)' : ''}`
              }
              style={{
                padding: '8px',
                borderRadius: '6px',
                border: isListening
                  ? '1px solid var(--xp-red, #e53e3e)'
                  : '1px solid var(--xp-border)',
                background: isListening ? 'rgba(229, 62, 62, 0.15)' : 'transparent',
                color: isListening ? 'var(--xp-red, #e53e3e)' : 'var(--xp-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                animation: isListening ? 'xp-voice-pulse 1.5s ease-in-out infinite' : undefined,
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setVoiceAutoSend((prev) => !prev);
              }}
            >
              {isListening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            {voiceAutoSend && (
              <div
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--xp-green, #38a169)',
                }}
                title={t('aiChat.input.voiceAutoSend')}
              />
            )}
          </div>
        )}
        <button
          onClick={onSend}
          disabled={isLoading || !input.trim()}
          aria-label={t('aiChat.input.sendMessage')}
          style={{
            padding: '8px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--xp-blue)',
            color: 'white',
            cursor: 'pointer',
            opacity: isLoading || !input.trim() ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Send size={16} />
        </button>
      </div>
    );
  },
);

ChatSlashInput.displayName = 'ChatSlashInput';

export default ChatSlashInput;
