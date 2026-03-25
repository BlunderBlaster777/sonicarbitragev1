/**
 * components/TradeHistory.tsx — Table of recent trade records.
 */

import React from 'react';
import type { TradeRecord } from '../lib/types';

interface Props {
  trades: TradeRecord[];
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: '#22c55e',
  simulated_only: '#facc15',
  failed: '#ef4444',
  pending: '#94a3b8',
  submitted: '#60a5fa',
};

export const TradeHistory: React.FC<Props> = ({ trades }) => {
  if (trades.length === 0) {
    return <div style={{ color: '#475569', padding: 16, textAlign: 'center' }}>No trades yet.</div>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['ID', 'Pair', 'Direction', 'Net Profit', 'Status', 'Tx Hash', 'Time'].map((h) => (
              <th
                key={h}
                style={{
                  background: '#1e293b',
                  color: '#94a3b8',
                  padding: '8px 12px',
                  textAlign: 'left',
                  borderBottom: '1px solid #334155',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 50).map((trade) => (
            <tr key={trade.id} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{trade.id.slice(0, 8)}</td>
              <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{trade.pair}</td>
              <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>
                {trade.direction.replace('_', ' → ')}
              </td>
              <td
                style={{
                  padding: '8px 12px',
                  color: trade.netProfitUsd >= 0 ? '#22c55e' : '#ef4444',
                  fontWeight: 600,
                }}
              >
                ${trade.netProfitUsd.toFixed(4)}
              </td>
              <td style={{ padding: '8px 12px' }}>
                <span
                  style={{
                    background: STATUS_COLORS[trade.status] ?? '#475569',
                    color: '#000',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontWeight: 600,
                    fontSize: 11,
                  }}
                >
                  {trade.status}
                </span>
              </td>
              <td style={{ padding: '8px 12px', color: '#60a5fa', fontFamily: 'monospace' }}>
                {trade.txHash ? (
                  <a
                    href={`https://sonicscan.org/tx/${trade.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#60a5fa' }}
                  >
                    {trade.txHash.slice(0, 10)}...
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td style={{ padding: '8px 12px', color: '#94a3b8' }}>
                {new Date(trade.createdAt).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
