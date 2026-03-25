/**
 * components/PnlChart.tsx — Live P&L chart using Recharts.
 */

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface PnlPoint {
  time: string;
  profit: number;
}

interface Props {
  data: PnlPoint[];
}

export const PnlChart: React.FC<Props> = ({ data }) => {
  if (data.length === 0) {
    return (
      <div style={{ color: '#475569', padding: 16, textAlign: 'center' }}>
        No P&L data yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="time" stroke="#475569" tick={{ fontSize: 11 }} />
        <YAxis stroke="#475569" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
          formatter={(v: number) => [`$${v.toFixed(4)}`, 'Profit']}
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
