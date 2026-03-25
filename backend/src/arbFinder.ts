/**
 * arbFinder.ts — Detects cross-DEX arbitrage opportunities.
 *
 * Algorithm:
 *   1. Fetch pool states from both DEXes for each configured pair.
 *   2. Compute the effective price on each DEX (amountOut / amountIn).
 *   3. If price difference > threshold, simulate a round-trip:
 *      Buy on cheaper DEX, sell on more expensive DEX.
 *   4. Compute gross profit, subtract DEX fees and estimated gas cost.
 *   5. Return the opportunity only if net profit > minProfitUsd.
 *
 * EXTENDING:
 *   To add a new DEX, pass its adapter in the constructor and add it
 *   to the ADAPTERS map. The rest of the logic is pair-agnostic.
 */

import { randomBytes } from 'crypto';
import { config } from './config';
import { logger } from './logger';
import type { ShadowAdapter } from './poolAdapters/ShadowAdapter';
import type { BeetsAdapter } from './poolAdapters/BeetsAdapter';
import type { ArbDirection, ArbOpportunity, Quote } from './types';
import type { RpcManager } from './rpcManager';

// ── Supported pairs ───────────────────────────────────────────────────────────

export const SUPPORTED_PAIRS = ['USDC/WS'] as const;
export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

// ── Decimals ──────────────────────────────────────────────────────────────────

/** Token decimal map — used to convert raw amounts to USD values. */
const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  WS: 18,
  WETH: 18,
};

// ── Gas estimation ────────────────────────────────────────────────────────────

/** Estimated gas for a two-swap atomic transaction. Adjust after profiling. */
const ESTIMATED_GAS_UNITS = 400_000n;

// ── ArbFinder ─────────────────────────────────────────────────────────────────

export class ArbFinder {
  private readonly shadowAdapter: ShadowAdapter;
  private readonly beetsAdapter: BeetsAdapter;
  private readonly rpc: RpcManager;

  constructor(shadow: ShadowAdapter, beets: BeetsAdapter, rpc: RpcManager) {
    this.shadowAdapter = shadow;
    this.beetsAdapter = beets;
    this.rpc = rpc;
  }

  /**
   * Scan all configured pairs and return detected arbitrage opportunities.
   * @param walletBalanceUsd Current wallet balance in USD (for trade sizing).
   */
  async findOpportunities(walletBalanceUsd: number): Promise<ArbOpportunity[]> {
    const opportunities: ArbOpportunity[] = [];

    for (const pair of SUPPORTED_PAIRS) {
      try {
        const opp = await this.analyzePair(pair, walletBalanceUsd);
        if (opp) opportunities.push(opp);
      } catch (err) {
        logger.warn({ pair, err }, '[ArbFinder] Error analysing pair %s', pair);
      }
    }

    return opportunities;
  }

  private async analyzePair(
    pair: SupportedPair,
    walletBalanceUsd: number,
  ): Promise<ArbOpportunity | null> {
    // Determine token addresses for this pair
    const [baseToken, quoteToken] = getTokenAddresses(pair);

    // Compute a sensible trade size (limited by max exposure)
    const maxTradeUsd = walletBalanceUsd * config.maxTradeExposure;
    const amountIn = usdToBaseUnits(Math.min(maxTradeUsd, 10_000), 'USDC');

    // Quote on both DEXes: Shadow and Beets
    const [shadowQuote, beetsQuote] = await Promise.all([
      this.shadowAdapter.quoteSwap('shadow', pair, amountIn, baseToken, quoteToken),
      this.beetsAdapter.quoteSwap('beets', pair, amountIn, baseToken, quoteToken),
    ]);

    // Determine direction: buy on whichever gives more output
    let buyDex: 'shadow' | 'beets';
    let sellDex: 'shadow' | 'beets';
    let buyQuote: Quote;
    let sellQuote: Quote;
    let direction: ArbDirection;

    if (shadowQuote.amountOut > beetsQuote.amountOut) {
      // Shadow gives more WS for USDC → buy WS on Shadow, sell WS on Beets
      buyDex = 'shadow';
      sellDex = 'beets';
      buyQuote = shadowQuote;
      direction = 'shadow_to_beets';
    } else {
      buyDex = 'beets';
      sellDex = 'shadow';
      buyQuote = beetsQuote;
      direction = 'beets_to_shadow';
    }

    // Second leg: sell the quoteToken back to baseToken on the other DEX
    const midAmount = buyQuote.amountOut;
    const sellAdapter = sellDex === 'shadow' ? this.shadowAdapter : this.beetsAdapter;
    sellQuote = await sellAdapter.quoteSwap(sellDex, pair, midAmount, quoteToken, baseToken);

    const amountOut = sellQuote.amountOut;

    // Gross profit (in base token units = USDC)
    if (amountOut <= amountIn) return null; // No gross profit
    const grossProfit = amountOut - amountIn;

    // Gas cost estimation
    const gasCostUsd = await this.estimateGasCostUsd();

    // Net profit in USD
    const grossProfitUsd = baseUnitsToUsd(grossProfit, 'USDC');
    const netProfitUsd = grossProfitUsd - gasCostUsd;

    if (netProfitUsd < config.minProfitUsd) {
      logger.debug(
        { pair, netProfitUsd, minProfitUsd: config.minProfitUsd },
        '[ArbFinder] Opportunity below minProfit threshold, skipping',
      );
      return null;
    }

    const opportunity: ArbOpportunity = {
      id: randomBytes(8).toString('hex'),
      pair,
      direction,
      buyDex,
      sellDex,
      amountIn,
      midAmount,
      amountOut,
      grossProfit,
      gasCostUsd,
      netProfitUsd,
      buyQuote,
      sellQuote,
      detectedAt: Date.now(),
    };

    logger.info(
      { id: opportunity.id, pair, direction, netProfitUsd },
      '[ArbFinder] Opportunity detected: net profit $%s',
      netProfitUsd.toFixed(4),
    );

    return opportunity;
  }

  /** Estimate gas cost in USD for a two-swap atomic transaction. */
  private async estimateGasCostUsd(): Promise<number> {
    try {
      const feeData = await this.rpc.call((p) => p.getFeeData());
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
      // Apply the max gas price multiplier cap
      const maxGasPrice =
        (gasPrice * BigInt(Math.round(config.maxGasPriceMultiplier * 100))) / 100n;
      const effectiveGasPrice = gasPrice < maxGasPrice ? gasPrice : maxGasPrice;
      const gasCostWei = ESTIMATED_GAS_UNITS * effectiveGasPrice;
      // Convert from S (native Sonic token, 18 decimals) to USD
      // TODO: replace 0.5 with a live S/USD price feed
      const S_PRICE_USD = 0.5;
      return Number(gasCostWei) / 1e18 * S_PRICE_USD;
    } catch {
      // Fallback estimate if RPC fails
      return 0.5;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTokenAddresses(pair: SupportedPair): [string, string] {
  switch (pair) {
    case 'USDC/WS':
      return [config.tokens.USDC, config.tokens.WS];
  }
}

function usdToBaseUnits(usd: number, token: string): bigint {
  const decimals = TOKEN_DECIMALS[token] ?? 18;
  return BigInt(Math.round(usd * 10 ** decimals));
}

function baseUnitsToUsd(amount: bigint, token: string): number {
  const decimals = TOKEN_DECIMALS[token] ?? 18;
  return Number(amount) / 10 ** decimals;
}
