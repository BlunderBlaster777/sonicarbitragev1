/**
 * pages/Dashboard.tsx — Main dashboard page.
 *
 * Layout:
 *   Top: StatusBar
 *   Left: ControlPanel
 *   Right: OpportunitiesList, TradeHistory, PnlChart
 */

import React, { useState, useCallback, useEffect } from 'react';
import { StatusBar } from '../components/StatusBar';
import { ControlPanel } from '../components/ControlPanel';
import { OpportunitiesList } from '../components/OpportunitiesList';
import { TradeHistory } from '../components/TradeHistory';
import { PnlChart } from '../components/PnlChart';
import { useWebSocket } from '../hooks/useWebSocket';
import type { ArbOpportunity, BotConfig, BotStatus, TradeRecord } from '../lib/types';

const BACKEND_URL = import.meta.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001';

export const Dashboard: React.FC = () => {
  const [opportunities, setOpportunities] = useState<ArbOpportunity[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [balanceUsd, setBalanceUsd] = useState<number | null>(null);
  const [pnlData, setPnlData] = useState<{ time: string; profit: number }[]>([]);
  const [activeTab, setActiveTab] = useState<'opportunities' | 'trades'>('opportunities');

  const onOpportunity = useCallback((opp: ArbOpportunity) => {
    setOpportunities((prev) => [opp, ...prev].slice(0, 50));
  }, []);

  const onTrade = useCallback((trade: TradeRecord) => {
    setTrades((prev) => [trade, ...prev].slice(0, 100));
    if (trade.status === 'confirmed' || trade.status === 'simulated_only') {
      setPnlData((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          profit: trade.netProfitUsd,
        },
      ].slice(-60));
    }
  }, []);

  const onStatus = useCallback((s: BotStatus) => setStatus(s), []);
  const onBalance = useCallback((b: number) => setBalanceUsd(b), []);
  const onConfig = useCallback((c: BotConfig) => setConfig(c), []);

  const { connected, setConfig: sendConfig, resetBreaker, emergencyStop, manualExecute } =
    useWebSocket({ onOpportunity, onTrade, onStatus, onBalance, onConfig });

  // Load initial trade history from REST API
  useEffect(() => {
    fetch(`${BACKEND_URL}/trades`)
      .then((r) => r.json())
      .then((data: TradeRecord[]) => setTrades(data))
      .catch(() => undefined);
  }, []);

  return (
    <div style={styles.root}>
      <StatusBar connected={connected} status={status} balanceUsd={balanceUsd} />

      <div style={styles.header}>
        <h1 style={styles.title}>⚡ Sonic Arbitrage Bot</h1>
        {config?.dryRun && (
          <span style={styles.dryRunBadge}>DRY RUN — No transactions broadcast</span>
        )}
      </div>

      <div style={styles.body}>
        {/* Left column: controls */}
        <div style={styles.left}>
          <ControlPanel
            config={config}
            latestOpportunity={opportunities[0] ?? null}
            onConfigChange={sendConfig}
            onResetBreaker={resetBreaker}
            onEmergencyStop={emergencyStop}
            onManualExecute={manualExecute}
          />

          {/* Stats summary */}
          <div style={styles.statsBox}>
            <h4 style={styles.sectionTitle}>Session Summary</h4>
            <div style={styles.stat}>
              <span>Total Opportunities</span>
              <strong>{opportunities.length}</strong>
            </div>
            <div style={styles.stat}>
              <span>Total Trades</span>
              <strong>{trades.length}</strong>
            </div>
            <div style={styles.stat}>
              <span>Total P&L</span>
              <strong style={{ color: '#22c55e' }}>
                ${trades.reduce((s, t) => s + t.netProfitUsd, 0).toFixed(2)}
              </strong>
            </div>
          </div>
        </div>

        {/* Right column: main content */}
        <div style={styles.right}>
          {/* P&L Chart */}
          <div style={styles.card}>
            <h4 style={styles.sectionTitle}>Cumulative P&L</h4>
            <PnlChart data={pnlData} />
          </div>

          {/* Tabs */}
          <div style={styles.card}>
            <div style={styles.tabs}>
              <button
                style={{ ...styles.tab, borderBottom: activeTab === 'opportunities' ? '2px solid #22c55e' : 'none' }}
                onClick={() => setActiveTab('opportunities')}
              >
                Opportunities ({opportunities.length})
              </button>
              <button
                style={{ ...styles.tab, borderBottom: activeTab === 'trades' ? '2px solid #22c55e' : 'none' }}
                onClick={() => setActiveTab('trades')}
              >
                Trades ({trades.length})
              </button>
            </div>

            {activeTab === 'opportunities' ? (
              <OpportunitiesList opportunities={opportunities} />
            ) : (
              <TradeHistory trades={trades} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: '#020617',
    color: '#f1f5f9',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px 24px',
    borderBottom: '1px solid #1e293b',
  },
  title: { margin: 0, fontSize: 22, color: '#f1f5f9' },
  dryRunBadge: {
    background: '#854d0e',
    color: '#fef08a',
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 700,
  },
  body: {
    display: 'flex',
    gap: 24,
    padding: 24,
    alignItems: 'flex-start',
  },
  left: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 280 },
  right: { flex: 1, display: 'flex', flexDirection: 'column', gap: 16 },
  card: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: 16,
  },
  statsBox: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: { color: '#94a3b8', margin: '0 0 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  stat: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 8,
  },
  tabs: { display: 'flex', gap: 8, marginBottom: 12 },
  tab: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
  },
};
