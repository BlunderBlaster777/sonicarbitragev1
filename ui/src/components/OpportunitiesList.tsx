/**
 * components/OpportunitiesList.tsx — Live list of detected arb opportunities.
 */

import React from 'react';
import type { ArbOpportunity } from '../lib/types';

interface Props {
  opportunities: ArbOpportunity[];
}

export const OpportunitiesList: React.FC<Props> = ({ opportunities }) => {
  if (opportunities.length === 0) {
    return (
      <div style={styles.empty}>No opportunities detected yet...</div>
    );
  }

  return (
    <div style={styles.container}>
      <table style={styles.table}>
        <thead>
          <tr>
            {['ID', 'Pair', 'Direction', 'Buy', 'Sell', 'Amount In', 'Net Profit', 'Time'].map(
              (h) => (
                <th key={h} style={styles.th}>
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {opportunities.slice(0, 20).map((opp) => (
            <tr key={opp.id} style={styles.tr}>
              <td style={styles.td}>{opp.id.slice(0, 8)}</td>
              <td style={styles.td}>{opp.pair}</td>
              <td style={styles.td}>{opp.direction.replace('_', ' → ')}</td>
              <td style={styles.td}>{opp.buyDex}</td>
              <td style={styles.td}>{opp.sellDex}</td>
              <td style={styles.td}>{(Number(opp.amountIn) / 1e6).toFixed(2)} USDC</td>
              <td
                style={{
                  ...styles.td,
                  color: opp.netProfitUsd > 0 ? '#22c55e' : '#ef4444',
                  fontWeight: 600,
                }}
              >
                ${opp.netProfitUsd.toFixed(4)}
              </td>
              <td style={styles.td}>
                {new Date(opp.detectedAt).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: { overflowX: 'auto' as const },
  empty: { color: '#475569', padding: 16, textAlign: 'center' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: {
    background: '#1e293b',
    color: '#94a3b8',
    padding: '8px 12px',
    textAlign: 'left' as const,
    fontWeight: 600,
    borderBottom: '1px solid #334155',
  },
  tr: { borderBottom: '1px solid #1e293b' },
  td: { padding: '8px 12px', color: '#cbd5e1' },
};
