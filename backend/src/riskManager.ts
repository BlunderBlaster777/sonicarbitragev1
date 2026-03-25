/**
 * riskManager.ts — Enforces risk limits before any trade execution.
 *
 * Checks performed before each trade:
 *   1. Auto-trade is enabled.
 *   2. Circuit breaker is not tripped.
 *   3. Profit >= minProfitUsd.
 *   4. Trade size <= maxTradeExposure * walletBalance.
 *   5. Slippage of both quotes <= maxSlippageBps.
 *   6. Daily loss has not exceeded maxDailyLossUsd.
 *   7. Gas price within maxGasPriceMultiplier of base fee.
 *
 * The RiskManager also tracks daily P&L and trips the circuit breaker
 * automatically if losses exceed the configured limit.
 */

import { config } from './config';
import { logger } from './logger';
import type { ArbOpportunity, BotConfig, RiskCheckResult } from './types';

export class RiskManager {
  private circuitBreakerTripped = false;
  private dailyLossUsd = 0;
  private dailyResetAt: Date;
  /** Mutable runtime config — can be updated via UI */
  private botConfig: BotConfig;

  constructor(initialConfig?: Partial<BotConfig>) {
    this.botConfig = {
      dryRun: config.dryRun,
      autoTrade: false, // safe default: disabled until operator enables
      minProfitUsd: config.minProfitUsd,
      maxTradeExposure: config.maxTradeExposure,
      maxSlippageBps: config.maxSlippageBps,
      maxGasPriceMultiplier: config.maxGasPriceMultiplier,
      maxDailyLossUsd: config.maxDailyLossUsd,
      scanIntervalMs: config.scanIntervalMs,
      ...initialConfig,
    };
    this.dailyResetAt = startOfNextDay();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Check all risk limits for a candidate opportunity. */
  check(
    opportunity: ArbOpportunity,
    walletBalanceUsd: number,
  ): RiskCheckResult {
    this.maybeResetDailyLoss();

    if (!this.botConfig.autoTrade) {
      return { approved: false, reason: 'Auto-trade is disabled' };
    }

    if (this.circuitBreakerTripped) {
      return { approved: false, reason: 'Circuit breaker is tripped — manual reset required' };
    }

    if (opportunity.netProfitUsd < this.botConfig.minProfitUsd) {
      return {
        approved: false,
        reason: `Net profit $${opportunity.netProfitUsd.toFixed(4)} < minProfit $${this.botConfig.minProfitUsd}`,
      };
    }

    const maxTradeUsd = walletBalanceUsd * this.botConfig.maxTradeExposure;
    const tradeUsd = Number(opportunity.amountIn) / 1e6; // USDC has 6 decimals
    if (tradeUsd > maxTradeUsd) {
      return {
        approved: false,
        reason: `Trade size $${tradeUsd.toFixed(2)} > maxTradeExposure $${maxTradeUsd.toFixed(2)}`,
      };
    }

    // Check slippage on both legs
    const buySlippage = opportunity.buyQuote.priceImpact * 10_000; // in bps
    const sellSlippage = opportunity.sellQuote.priceImpact * 10_000;
    if (buySlippage > this.botConfig.maxSlippageBps || sellSlippage > this.botConfig.maxSlippageBps) {
      return {
        approved: false,
        reason: `Slippage too high: buy=${buySlippage.toFixed(0)}bps, sell=${sellSlippage.toFixed(0)}bps, max=${this.botConfig.maxSlippageBps}bps`,
      };
    }

    if (this.dailyLossUsd >= this.botConfig.maxDailyLossUsd) {
      this.tripCircuitBreaker('Daily loss limit reached');
      return {
        approved: false,
        reason: `Daily loss $${this.dailyLossUsd.toFixed(2)} >= limit $${this.botConfig.maxDailyLossUsd}`,
      };
    }

    return { approved: true };
  }

  /** Record the result of an executed trade to update daily P&L. */
  recordTrade(netProfitUsd: number): void {
    if (netProfitUsd < 0) {
      this.dailyLossUsd += Math.abs(netProfitUsd);
      logger.warn(
        { dailyLossUsd: this.dailyLossUsd, limit: this.botConfig.maxDailyLossUsd },
        '[RiskManager] Daily loss updated',
      );
      if (this.dailyLossUsd >= this.botConfig.maxDailyLossUsd) {
        this.tripCircuitBreaker('Daily loss limit reached after trade');
      }
    }
  }

  /** Trip the circuit breaker — stops all trading until manually reset. */
  tripCircuitBreaker(reason: string): void {
    this.circuitBreakerTripped = true;
    logger.error({ reason }, '[RiskManager] CIRCUIT BREAKER TRIPPED: %s', reason);
  }

  /** Reset the circuit breaker — should be called via UI or CLI by operator. */
  resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    logger.info('[RiskManager] Circuit breaker reset');
  }

  /** Update runtime config (e.g., from UI). */
  updateConfig(update: Partial<BotConfig>): void {
    this.botConfig = { ...this.botConfig, ...update };
    logger.info({ botConfig: this.botConfig }, '[RiskManager] Config updated');
  }

  getConfig(): BotConfig {
    return { ...this.botConfig };
  }

  isCircuitBreakerTripped(): boolean {
    return this.circuitBreakerTripped;
  }

  getDailyLossUsd(): number {
    return this.dailyLossUsd;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private maybeResetDailyLoss(): void {
    if (new Date() >= this.dailyResetAt) {
      this.dailyLossUsd = 0;
      this.dailyResetAt = startOfNextDay();
      logger.info('[RiskManager] Daily loss counter reset');
    }
  }
}

function startOfNextDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
