/**
 * First-time onboarding card for the AI chat panel.
 * Shows a dismissible welcome message with capability cards and
 * a clickable example prompt. Displayed only once — persists
 * dismissal via localStorage (`xplorer:ai-onboarding-done`).
 */
import { useState, useCallback } from 'react';
import { FolderSearch, FileEdit, Terminal, Eye, Sparkles, X } from 'lucide-react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CapabilityCard {
  icon: React.ReactNode;
  title: string;
  description: string;
}

interface ChatOnboardingProps {
  /** Callback to inject a message into the chat input */
  onSendMessage: (prompt: string) => void;
  /** Whether the AI is currently processing */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Capability definitions
// ---------------------------------------------------------------------------

const CAPABILITIES: CapabilityCard[] = [
  {
    icon: <FolderSearch size={16} />,
    title: 'Search & Browse',
    description: 'Find files, list directories, and explore your workspace.',
  },
  {
    icon: <FileEdit size={16} />,
    title: 'File Operations',
    description: 'Create, edit, rename, move, copy, and delete files.',
  },
  {
    icon: <Terminal size={16} />,
    title: 'Run Commands',
    description: 'Execute shell commands directly from chat.',
  },
  {
    icon: <Eye size={16} />,
    title: 'Vision & Analysis',
    description: 'Analyze images and understand file contents.',
  },
  {
    icon: <Sparkles size={16} />,
    title: 'Smart Organization',
    description: 'Suggest folder structures and clean up clutter.',
  },
];

const EXAMPLE_PROMPT = 'Organize this folder by file type';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isOnboardingDone = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEYS.AI_ONBOARDING_DONE) === 'true';
  } catch {
    return false;
  }
};

const markOnboardingDone = (): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.AI_ONBOARDING_DONE, 'true');
  } catch {
    // localStorage unavailable — silently ignore
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChatOnboarding = ({ onSendMessage, isLoading }: ChatOnboardingProps) => {
  const [dismissed, setDismissed] = useState(isOnboardingDone);

  const handleDismiss = useCallback(() => {
    markOnboardingDone();
    setDismissed(true);
  }, []);

  const handleExampleClick = useCallback(() => {
    markOnboardingDone();
    setDismissed(true);
    onSendMessage(EXAMPLE_PROMPT);
  }, [onSendMessage]);

  if (dismissed) return null;

  return (
    <div
      role="region"
      aria-label="AI chat onboarding"
      style={{
        margin: '12px',
        padding: '16px',
        borderRadius: '10px',
        border: '1px solid var(--xp-border)',
        background: 'var(--xp-surface)',
        position: 'relative',
        fontSize: '13px',
      }}
    >
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss onboarding"
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'transparent',
          border: 'none',
          color: 'var(--xp-text-muted)',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={14} />
      </button>

      {/* Title */}
      <div
        style={{
          fontWeight: 700,
          fontSize: '15px',
          color: 'var(--xp-text)',
          marginBottom: '4px',
        }}
      >
        Welcome! I&apos;m your AI file assistant.
      </div>
      <div
        style={{
          color: 'var(--xp-text-muted)',
          fontSize: '12px',
          marginBottom: '14px',
        }}
      >
        Here&apos;s what I can do:
      </div>

      {/* Capability cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginBottom: '14px',
        }}
      >
        {CAPABILITIES.map((cap) => (
          <div
            key={cap.title}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '8px',
              borderRadius: '8px',
              background: 'var(--xp-bg)',
              border: '1px solid var(--xp-border)',
            }}
          >
            <span
              style={{
                flexShrink: 0,
                color: 'var(--xp-blue)',
                marginTop: '1px',
              }}
            >
              {cap.icon}
            </span>
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '12px',
                  color: 'var(--xp-text)',
                  marginBottom: '2px',
                }}
              >
                {cap.title}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--xp-text-muted)',
                  lineHeight: '1.3',
                }}
              >
                {cap.description}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Example prompt */}
      <div
        style={{
          fontSize: '12px',
          color: 'var(--xp-text-muted)',
          marginBottom: '6px',
        }}
      >
        Try saying:
      </div>
      <button
        onClick={handleExampleClick}
        disabled={isLoading}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid var(--xp-blue)',
          background: 'rgba(122, 162, 247, 0.08)',
          color: 'var(--xp-blue)',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          fontWeight: 500,
          opacity: isLoading ? 0.5 : 1,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!isLoading) {
            e.currentTarget.style.background = 'rgba(122, 162, 247, 0.15)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(122, 162, 247, 0.08)';
        }}
      >
        <Sparkles size={14} />
        &ldquo;{EXAMPLE_PROMPT}&rdquo;
      </button>
    </div>
  );
};

export default ChatOnboarding;
