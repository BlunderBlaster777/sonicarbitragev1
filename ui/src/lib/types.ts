/**
 * lib/types.ts — Shared TypeScript types for the UI.
 * These mirror the backend types.ts but are kept separate for UI bundle size.
 */

export type ArbDirection = 'shadow_to_beets' | 'beets_to_shadow';
export type TradeStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'simulated_only';

export interface Quote {
  dex: string;
  pair: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountOutMin: string;
  feeAmount: string;
  priceImpact: number;
}

export interface ArbOpportunity {
  id: string;
  pair: string;
  direction: ArbDirection;
  buyDex: string;
  sellDex: string;
  amountIn: string;
  midAmount: string;
  amountOut: string;
  grossProfit: string;
  gasCostUsd: number;
  netProfitUsd: number;
  buyQuote: Quote;
  sellQuote: Quote;
  detectedAt: number;
}

export interface TradeRecord {
  id: string;
  pair: string;
  direction: ArbDirection;
  amountIn: string;
  amountOut: string;
  netProfitUsd: number;
  txHash?: string;
  gasUsed?: string;
  gasCostUsd?: number;
  status: TradeStatus;
  dryRun: boolean;
  createdAt: string;
  failureReason?: string;
}

export interface BotConfig {
  dryRun: boolean;
  autoTrade: boolean;
  minProfitUsd: number;
  maxTradeExposure: number;
  maxSlippageBps: number;
  maxGasPriceMultiplier: number;
  maxDailyLossUsd: number;
  scanIntervalMs: number;
}

export interface BotStatus {
  autoTrade: boolean;
  circuitBreaker: boolean;
  dailyLossUsd: number;
  dryRun: boolean;
}

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
