/**
 * Cost Tracker — displays per-session and cumulative API cost/token usage.
 *
 * Shows a summary bar with today's total cost and tokens,
 * plus per-session cost badges that can be displayed on agent cards.
 */
import { useTranslation } from 'react-i18next';
import { DollarSign, ArrowDown, ArrowUp } from 'lucide-react';
import type { SessionCostEntry } from './use-cost-tracking';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostTrackerProps {
  todayTotalCost: number;
  todayTotalTokensIn: number;
  todayTotalTokensOut: number;
  sessionCosts: Map<string, SessionCostEntry>;
  formatCost: (costUsd: number) => string;
  formatTokens: (count: number) => string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CostBadge = ({
  cost,
  totalTokens,
  formatCost,
  formatTokens,
}: {
  cost: number;
  totalTokens: number;
  formatCost: (n: number) => string;
  formatTokens: (n: number) => string;
}) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
      fontSize: '9px',
      color: 'var(--xp-text-muted)',
      background: 'var(--xp-surface-light, rgba(255,255,255,0.05))',
      borderRadius: '3px',
      padding: '1px 5px',
      whiteSpace: 'nowrap',
    }}
  >
    <DollarSign size={8} style={{ flexShrink: 0, opacity: 0.7 }} />
    {formatCost(cost)} | {formatTokens(totalTokens)} tok
  </span>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const CostTracker = ({
  todayTotalCost,
  todayTotalTokensIn,
  todayTotalTokensOut,
  sessionCosts,
  formatCost,
  formatTokens,
}: CostTrackerProps) => {
  const { t } = useTranslation();

  const totalTokens = todayTotalTokensIn + todayTotalTokensOut;
  const sessionCount = sessionCosts.size;

  if (sessionCount === 0 && todayTotalCost === 0) {
    return (
      <div
        style={{
          padding: '8px',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          textAlign: 'center',
        }}
      >
        {t('agentManager.costTracker.noUsage')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Summary bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px',
          borderRadius: '6px',
          background: 'var(--xp-surface)',
          border: '1px solid var(--xp-border)',
        }}
      >
        <DollarSign size={14} style={{ color: 'var(--xp-green, #73daca)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--xp-text)',
            }}
          >
            {formatCost(todayTotalCost)}
          </div>
          <div
            style={{
              fontSize: '10px',
              color: 'var(--xp-text-muted)',
            }}
          >
            {t('agentManager.costTracker.todayTotal')}
          </div>
        </div>

        {/* Token breakdown */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '1px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '9px',
              color: 'var(--xp-text-muted)',
            }}
          >
            <ArrowDown size={8} style={{ color: 'var(--xp-blue, #7aa2f7)' }} />
            {formatTokens(todayTotalTokensIn)} {t('agentManager.costTracker.tokensIn')}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '9px',
              color: 'var(--xp-text-muted)',
            }}
          >
            <ArrowUp size={8} style={{ color: 'var(--xp-green, #73daca)' }} />
            {formatTokens(todayTotalTokensOut)} {t('agentManager.costTracker.tokensOut')}
          </div>
        </div>
      </div>

      {/* Per-session breakdown (if multiple sessions) */}
      {sessionCount > 1 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            fontSize: '10px',
          }}
        >
          <div
            style={{
              fontWeight: 500,
              color: 'var(--xp-text-muted)',
              padding: '0 4px',
              marginBottom: '2px',
            }}
          >
            {t('agentManager.costTracker.perSession')}
          </div>
          {Array.from(sessionCosts.values())
            .sort((a, b) => b.costUsd - a.costUsd)
            .map((entry) => (
              <div
                key={entry.sessionId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 4px',
                  borderRadius: '4px',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--xp-text)',
                  }}
                >
                  {entry.sessionName}
                </span>
                <CostBadge
                  cost={entry.costUsd}
                  totalTokens={entry.tokensIn + entry.tokensOut}
                  formatCost={formatCost}
                  formatTokens={formatTokens}
                />
              </div>
            ))}
        </div>
      )}

      {/* Total tokens footer */}
      <div
        style={{
          fontSize: '9px',
          color: 'var(--xp-text-muted)',
          textAlign: 'center',
          padding: '2px 0',
        }}
      >
        {t('agentManager.costTracker.totalTokens', {
          amount: formatTokens(totalTokens),
        })}{' '}
        &middot;{' '}
        {t('agentManager.costTracker.sessionCount', {
          amount: String(sessionCount),
        })}
      </div>
    </div>
  );
};

// Export the CostBadge for use in ActiveAgents cards
export { CostBadge };
export default CostTracker;
