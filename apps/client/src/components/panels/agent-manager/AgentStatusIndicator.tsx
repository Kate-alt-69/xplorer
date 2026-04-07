/**
 * AgentStatusIndicator — a small overlay badge for the Agent Manager icon
 * in VerticalExtensionsBar. Shows count of active agents plus a pulsing
 * dot when any agent is currently running.
 *
 * Fully event-driven: listens for the `xplorer-agent-active-count` event
 * dispatched by AgentManagerPanel whenever the total active count changes.
 *
 * Usage: wrap the Bot icon in VerticalExtensionsBar with this component.
 */
import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentStatusIndicatorProps {
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentStatusIndicator = ({ children }: AgentStatusIndicatorProps) => {
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    const handleCountUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ count: number }>).detail;
      if (detail && typeof detail.count === 'number') {
        setActiveCount(detail.count);
      }
    };

    window.addEventListener('xplorer-agent-active-count', handleCountUpdate);
    return () => {
      window.removeEventListener('xplorer-agent-active-count', handleCountUpdate);
    };
  }, []);

  const hasRunning = activeCount > 0;

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {children}

      {/* Count badge — only shown when agents are active */}
      {activeCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: '14px',
            height: '14px',
            borderRadius: '7px',
            background: 'var(--xp-green, #73daca)',
            color: '#fff',
            fontSize: '9px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            lineHeight: 1,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {activeCount}
        </span>
      )}

      {/* Pulsing dot — indicates activity */}
      {hasRunning && (
        <span
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--xp-green, #73daca)',
            boxShadow: '0 0 4px var(--xp-green, #73daca)',
            animation: 'pulse 2s infinite',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
};

export default AgentStatusIndicator;
