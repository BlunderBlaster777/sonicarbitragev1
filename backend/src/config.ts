/**
 * config.ts — Centralised environment-variable configuration.
 *
 * All env vars are read here so the rest of the codebase only imports `config`.
 * This makes unit testing easy: mock this module to override any setting.
 *
 * HOW TO USE:
 *   import { config } from './config';
 *
 * SECURITY NOTE:
 *   PRIVATE_KEY is supported only for local/dev use.
 *   In production, use REMOTE_SIGNER_URL or a hardware signer.
 */

import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from the project root (two levels up from backend/src)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function optionalNum(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const n = parseFloat(raw);
  if (isNaN(n)) throw new Error(`Invalid numeric value for ${key}: ${raw}`);
  return n;
}

function optionalBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export const config = {
  // ── Chain ────────────────────────────────────────────────────────────────
  chainId: parseInt(optional('CHAIN_ID', '146'), 10),

  /** Comma-separated list of RPC endpoints; first is primary */
  rpcUrls: optional('RPC_URLS', 'https://rpc.soniclabs.com')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),

  // ── Signer ───────────────────────────────────────────────────────────────
  /** DEV ONLY — omit in production, use REMOTE_SIGNER_URL instead */
  privateKey: process.env['PRIVATE_KEY'],
  remoteSignerUrl: process.env['REMOTE_SIGNER_URL'],

  // ── Token addresses ──────────────────────────────────────────────────────
  /**
   * TODO: Replace placeholders with actual Sonic mainnet addresses.
   * Run: npx ts-node src/scripts/fetchTokenAddresses.ts
   * Or check https://sonicscan.org and DEX documentation.
   */
  tokens: {
    USDC: optional('USDC_ADDRESS', '0xTODO_USDC_ADDRESS'),
    WS: optional('WS_ADDRESS', '0xTODO_WS_ADDRESS'),
    WETH: optional('WETH_ADDRESS', '0xTODO_WETH_ADDRESS'),
  },

  // ── DEX Addresses ────────────────────────────────────────────────────────
  shadow: {
    router: optional('SHADOW_ROUTER', '0xTODO_SHADOW_ROUTER'),
    usdcWsPool: optional('SHADOW_USDC_WS_POOL', '0xTODO_SHADOW_POOL'),
    usdcWethPool: optional('SHADOW_USDC_WETH_POOL', '0xTODO'),
  },
  beets: {
    vault: optional('BEETS_VAULT', '0xTODO_BEETS_VAULT'),
    usdcWsPoolId: optional('BEETS_USDC_WS_POOL_ID', '0xTODO_BEETS_POOL_ID'),
    usdcWethPoolId: optional('BEETS_USDC_WETH_POOL_ID', '0xTODO'),
  },

  // ── Arb Parameters ───────────────────────────────────────────────────────
  minProfitUsd: optionalNum('MIN_PROFIT_USD', 1.0),
  maxTradeExposure: optionalNum('MAX_TRADE_EXPOSURE', 0.2),
  maxSlippageBps: optionalNum('MAX_SLIPPAGE_BPS', 50),
  maxGasPriceMultiplier: optionalNum('MAX_GAS_PRICE_MULTIPLIER', 2.0),
  maxDailyLossUsd: optionalNum('MAX_DAILY_LOSS_USD', 500),
  scanIntervalMs: optionalNum('SCAN_INTERVAL_MS', 300),
  /**
   * Approximate USD price of the native Sonic token (S) used for gas cost
   * estimation. Check current price at https://sonicscan.org or a DEX.
   * This does NOT need to be exact — a rough value is sufficient.
   * TODO: replace with a live Chainlink oracle feed for production accuracy.
   */
  sPriceUsd: optionalNum('S_PRICE_USD', 0.5),

  // ── Idle Rebalancing ─────────────────────────────────────────────────────
  /** If true, swap non-USDC holdings back to USDC when no opportunities found */
  rebalanceToUsdc: optionalBool('REBALANCE_TO_USDC', true),
  /** Minimum non-USDC holding value (USD) to trigger a rebalance */
  minRebalanceUsd: optionalNum('MIN_REBALANCE_USD', 1.0),

  // ── Safety ───────────────────────────────────────────────────────────────
  /** If true, run full pipeline but never broadcast transactions */
  dryRun: optionalBool('DRY_RUN', true),

  // ── Persistence ──────────────────────────────────────────────────────────
  dbUrl: optional('DB_URL', 'postgresql://arbbot:password@localhost:5432/arbbot'),
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  // ── Server ports ─────────────────────────────────────────────────────────
  httpPort: parseInt(optional('HTTP_PORT', '3001'), 10),
  wsPort: parseInt(optional('WS_PORT', '3002'), 10),
  metricsPort: parseInt(optional('METRICS_PORT', '9090'), 10),

  // ── Alerting ─────────────────────────────────────────────────────────────
  telegram: {
    botToken: process.env['TELEGRAM_BOT_TOKEN'],
    chatId: process.env['TELEGRAM_CHAT_ID'],
  },
  smtp: {
    host: process.env['SMTP_HOST'],
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    user: process.env['SMTP_USER'],
    pass: process.env['SMTP_PASS'],
    alertEmail: process.env['ALERT_EMAIL'],
  },

  // ── MEV ──────────────────────────────────────────────────────────────────
  mevRelayUrl: process.env['MEV_RELAY_URL'],

  // ── Logging ──────────────────────────────────────────────────────────────
  logLevel: optional('LOG_LEVEL', 'info'),
  logFormat: optional('LOG_FORMAT', 'json'),
} as const;

/** Validate critical config at startup and warn about TODO placeholders. */
export function validateConfig(): void {
  const todos = Object.entries(config.tokens)
    .filter(([, v]) => v.includes('TODO'))
    .map(([k]) => k);

  if (todos.length > 0) {
    const msg =
      `[config] WARNING: The following token addresses are still placeholder values: ${todos.join(', ')}. ` +
      `Update them in your .env file before running in live mode.`;
    // Use process.stderr so it doesn't require the logger to be initialised
    process.stderr.write(msg + '\n');
  }

  if (config.chainId !== 146) {
    throw new Error(`[config] CHAIN_ID must be 146 (Sonic). Got: ${config.chainId}`);
  }

  if (!config.dryRun && !config.privateKey && !config.remoteSignerUrl) {
    throw new Error(
      '[config] Live mode requires either PRIVATE_KEY (dev only) or REMOTE_SIGNER_URL. ' +
        'Set DRY_RUN=true for a safe run without broadcasting.',
    );
  }
}
