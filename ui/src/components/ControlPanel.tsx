/**
 * components/ControlPanel.tsx — Bot controls: enable/disable trading, set
 * parameters, emergency stop, and manual execute.
 */

import React, { useState, useEffect } from 'react';
import type { ArbOpportunity, BotConfig } from '../lib/types';

interface Props {
  config: BotConfig | null;
  latestOpportunity: ArbOpportunity | null;
  onConfigChange: (update: Partial<BotConfig>) => void;
  onResetBreaker: () => void;
  onEmergencyStop: () => void;
  onManualExecute: (opp: ArbOpportunity) => void;
}

export const ControlPanel: React.FC<Props> = ({
  config,
  latestOpportunity,
  onConfigChange,
  onResetBreaker,
  onEmergencyStop,
  onManualExecute,
}) => {
  const [localConfig, setLocalConfig] = useState<Partial<BotConfig>>({});

  useEffect(() => {
    if (config) setLocalConfig(config);
  }, [config]);

  const handleChange = (key: keyof BotConfig, value: string | boolean | number) => {
    const updated = { ...localConfig, [key]: value };
    setLocalConfig(updated);
    onConfigChange({ [key]: value });
  };

  const inputStyle: React.CSSProperties = {
    background: '#1e293b',
    border: '1px solid #334155',
    color: '#f1f5f9',
    padding: '4px 8px',
    borderRadius: 4,
    width: 120,
  };

  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>Controls</h3>

      {/* Auto-trade toggle */}
      <div style={styles.row}>
        <label>Auto-Trade</label>
        <button
          style={{
            ...styles.btn,
            background: localConfig.autoTrade ? '#16a34a' : '#475569',
          }}
          onClick={() => handleChange('autoTrade', !localConfig.autoTrade)}
        >
          {localConfig.autoTrade ? 'ENABLED' : 'DISABLED'}
        </button>
      </div>

      {/* Min profit */}
      <div style={styles.row}>
        <label>Min Profit (USD)</label>
        <input
          type="number"
          step="0.1"
          value={localConfig.minProfitUsd ?? ''}
          onChange={(e) => handleChange('minProfitUsd', parseFloat(e.target.value))}
          style={inputStyle}
        />
      </div>

      {/* Max trade exposure */}
      <div style={styles.row}>
        <label>Max Exposure (%)</label>
        <input
          type="number"
          step="1"
          min="1"
          max="100"
          value={((localConfig.maxTradeExposure ?? 0.2) * 100).toFixed(0)}
          onChange={(e) =>
            handleChange('maxTradeExposure', parseFloat(e.target.value) / 100)
          }
          style={inputStyle}
        />
      </div>

      {/* Max slippage */}
      <div style={styles.row}>
        <label>Max Slippage (bps)</label>
        <input
          type="number"
          step="5"
          value={localConfig.maxSlippageBps ?? ''}
          onChange={(e) => handleChange('maxSlippageBps', parseInt(e.target.value, 10))}
          style={inputStyle}
        />
      </div>

      <hr style={styles.divider} />

      {/* Manual execute */}
      <div style={styles.row}>
        <label>Manual Execute</label>
        <button
          style={{
            ...styles.btn,
            background: latestOpportunity ? '#2563eb' : '#475569',
          }}
          disabled={!latestOpportunity}
          onClick={() => latestOpportunity && onManualExecute(latestOpportunity)}
        >
          Execute Latest
        </button>
      </div>

      <hr style={styles.divider} />

      {/* Emergency actions */}
      <div style={styles.row}>
        <button style={{ ...styles.btn, background: '#0f766e' }} onClick={onResetBreaker}>
          Reset Breaker
        </button>
        <button style={{ ...styles.btn, background: '#dc2626' }} onClick={onEmergencyStop}>
          ⛔ EMERGENCY STOP
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: 20,
    minWidth: 280,
  },
  title: {
    color: '#94a3b8',
    marginTop: 0,
    marginBottom: 16,
    fontSize: 14,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    color: '#cbd5e1',
    fontSize: 13,
    gap: 8,
  },
  btn: {
    border: 'none',
    borderRadius: 4,
    padding: '6px 12px',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
  },
  divider: {
    borderColor: '#1e293b',
    margin: '16px 0',
  },
};
