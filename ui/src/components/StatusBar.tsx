/**
 * components/StatusBar.tsx — Top status bar showing connection and bot state.
 */

import React from 'react';
import type { BotStatus } from '../lib/types';

interface Props {
  connected: boolean;
  status: BotStatus | null;
  balanceUsd: number | null;
}

export const StatusBar: React.FC<Props> = ({ connected, status, balanceUsd }) => {
  return (
    <div style={styles.bar}>
      <span style={{ ...styles.dot, background: connected ? '#22c55e' : '#ef4444' }} />
      <span>{connected ? 'Connected' : 'Disconnected'}</span>

      {status && (
        <>
          <span style={styles.sep}>|</span>
          <span>
            Mode:{' '}
            <strong style={{ color: status.dryRun ? '#facc15' : '#22c55e' }}>
              {status.dryRun ? 'DRY RUN' : 'LIVE'}
            </strong>
          </span>

          <span style={styles.sep}>|</span>
          <span>
            Auto-trade:{' '}
            <strong style={{ color: status.autoTrade ? '#22c55e' : '#94a3b8' }}>
              {status.autoTrade ? 'ON' : 'OFF'}
            </strong>
          </span>

          <span style={styles.sep}>|</span>
          <span>
            Circuit Breaker:{' '}
            <strong style={{ color: status.circuitBreaker ? '#ef4444' : '#22c55e' }}>
              {status.circuitBreaker ? '⛔ TRIPPED' : '✅ OK'}
            </strong>
          </span>

          <span style={styles.sep}>|</span>
          <span>Daily Loss: <strong>${status.dailyLossUsd.toFixed(2)}</strong></span>
        </>
      )}

      {balanceUsd !== null && (
        <>
          <span style={styles.sep}>|</span>
          <span>Balance: <strong>${balanceUsd.toFixed(2)}</strong></span>
        </>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    fontSize: 13,
    color: '#cbd5e1',
    flexWrap: 'wrap',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
  },
  sep: {
    color: '#475569',
  },
};
