/**
 * types.ts — Shared TypeScript types for the Sonic Arbitrage Bot.
 *
 * All major data structures are defined here to keep other modules lean.
 * Import from this file rather than re-declaring types.
 */

// ── Pool State ──────────────────────────────────────────────────────────────

/** Raw on-chain state for a liquidity pool. */
export interface PoolState {
  /** DEX identifier ('shadow' | 'beets') */
  dex: string;
  /** Pair identifier, e.g. 'USDC/WS' */
  pair: string;
  /** Pool contract address */
  poolAddress: string;
  /** Token A address (lower sort order) */
  token0: string;
  /** Token B address (higher sort order) */
  token1: string;
  /** Reserve of token0 (raw, BigInt string) */
  reserve0: string;
  /** Reserve of token1 (raw, BigInt string) */
  reserve1: string;
  /** Pool fee in basis points (e.g., 30 for 0.30%) */
  feeBps: number;
  /** Amplification coefficient (for stable/curve pools); 0 for standard AMM */
  amplification?: bigint;
  /** Block number at which this state was fetched */
  blockNumber: number;
  /** Timestamp (ms) when fetched */
  fetchedAt: number;
}

// ── Swap Quote ───────────────────────────────────────────────────────────────

/** Result of quoting a swap on a DEX. */
export interface Quote {
  dex: string;
  pair: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  /** Expected output before slippage */
  amountOut: bigint;
  /** Minimum output after applying slippage buffer */
  amountOutMin: bigint;
  /** Fee deducted from amountIn, in tokenIn units */
  feeAmount: bigint;
  /** Price impact as a fraction (0.001 = 0.1%) */
  priceImpact: number;
}

// ── Transaction Data ─────────────────────────────────────────────────────────

/** Calldata + metadata for a transaction that will be broadcast. */
export interface TxData {
  to: string;
  data: string;
  value: bigint;
  gasLimit?: bigint;
}

// ── Arbitrage Opportunity ────────────────────────────────────────────────────

export type ArbDirection = 'shadow_to_beets' | 'beets_to_shadow';

/** A detected arbitrage opportunity between two DEXes. */
export interface ArbOpportunity {
  id: string;
  pair: string;
  direction: ArbDirection;
  /** DEX to buy on (first leg) */
  buyDex: string;
  /** DEX to sell on (second leg) */
  sellDex: string;
  /** Input amount in USDC (6 decimals) */
  amountIn: bigint;
  /** Expected output from first swap */
  midAmount: bigint;
  /** Expected output from second swap */
  amountOut: bigint;
  /** Gross profit = amountOut - amountIn */
  grossProfit: bigint;
  /** Estimated gas cost in USD */
  gasCostUsd: number;
  /** Net profit after fees and gas (USD) */
  netProfitUsd: number;
  /** Quote for the buy leg */
  buyQuote: Quote;
  /** Quote for the sell leg */
  sellQuote: Quote;
  /** Unix timestamp (ms) when this opportunity was detected */
  detectedAt: number;
}

// ── Simulation Result ────────────────────────────────────────────────────────

export interface SimulationResult {
  success: boolean;
  /** Simulated net output (token units) */
  simulatedOutput?: bigint;
  /** Revert reason if simulation failed */
  revertReason?: string;
  /** Estimated gas units */
  gasUsed?: bigint;
}

// ── Trade Record ─────────────────────────────────────────────────────────────

export type TradeStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'simulated_only';

export interface TradeRecord {
  id: string;
  opportunityId: string;
  pair: string;
  direction: ArbDirection;
  amountIn: string; // stored as decimal string
  amountOut: string;
  netProfitUsd: number;
  txHash?: string;
  gasUsed?: string;
  gasCostUsd?: number;
  status: TradeStatus;
  dryRun: boolean;
  createdAt: Date;
  confirmedAt?: Date;
  failureReason?: string;
}

// ── Risk Manager ─────────────────────────────────────────────────────────────

export interface RiskCheckResult {
  approved: boolean;
  /** Reason for rejection if not approved */
  reason?: string;
}

// ── WebSocket Messages ───────────────────────────────────────────────────────

export type WsMessageType =
  | 'opportunity'
  | 'trade'
  | 'status'
  | 'balance'
  | 'config_update'
  | 'circuit_breaker'
  | 'error';

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
  timestamp: number;
}

// ── Config (runtime) ─────────────────────────────────────────────────────────

export interface BotConfig {
  dryRun: boolean;
  autoTrade: boolean;
  minProfitUsd: number;
  maxTradeExposure: number; // 0–1
  maxSlippageBps: number;
  maxGasPriceMultiplier: number;
  maxDailyLossUsd: number;
  scanIntervalMs: number;
}

// ── Pool Adapter Interface ───────────────────────────────────────────────────

export interface PoolAdapter {
  getPoolState(dex: string, pair: string): Promise<PoolState>;
  quoteSwap(
    dex: string,
    pair: string,
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
  ): Promise<Quote>;
  buildSwapTx(
    dex: string,
    pair: string,
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
    recipient: string,
  ): Promise<TxData>;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  opportunitiesTotal: number;
  executedTotal: number;
  failedTotal: number;
  lastProfitUsd: number;
  walletBalanceUsd: number;
}
