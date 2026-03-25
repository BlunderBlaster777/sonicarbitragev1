/**
 * test/riskManager.test.ts — Unit tests for RiskManager.
 */

import { RiskManager } from '../src/riskManager';
import type { ArbOpportunity } from '../src/types';

// Minimal mock opportunity for testing
function mockOpportunity(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    id: 'test-opp-1',
    pair: 'USDC/WS',
    direction: 'shadow_to_beets',
    buyDex: 'shadow',
    sellDex: 'beets',
    amountIn: 1_000_000n,   // 1 USDC (6 decimals)
    midAmount: 2_000_000_000_000_000_000n, // 2 WS
    amountOut: 1_010_000n,  // 1.01 USDC
    grossProfit: 10_000n,
    gasCostUsd: 0.05,
    netProfitUsd: 2.5,
    buyQuote: {
      dex: 'shadow',
      pair: 'USDC/WS',
      tokenIn: '0xUSDC',
      tokenOut: '0xWS',
      amountIn: 1_000_000n,
      amountOut: 2_000_000_000_000_000_000n,
      amountOutMin: 1_990_000_000_000_000_000n,
      feeAmount: 3000n,
      priceImpact: 0.001,
    },
    sellQuote: {
      dex: 'beets',
      pair: 'USDC/WS',
      tokenIn: '0xWS',
      tokenOut: '0xUSDC',
      amountIn: 2_000_000_000_000_000_000n,
      amountOut: 1_010_000n,
      amountOutMin: 1_005_000n,
      feeAmount: 4n,
      priceImpact: 0.001,
    },
    detectedAt: Date.now(),
    ...overrides,
  };
}

describe('RiskManager', () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = new RiskManager({
      autoTrade: true,
      minProfitUsd: 1.0,
      maxTradeExposure: 0.5,
      maxSlippageBps: 100,
      maxDailyLossUsd: 100,
      dryRun: true,
      maxGasPriceMultiplier: 2.0,
      scanIntervalMs: 300,
    });
  });

  test('approves a valid opportunity', () => {
    const result = rm.check(mockOpportunity(), 10_000);
    expect(result.approved).toBe(true);
  });

  test('rejects when auto-trade is disabled', () => {
    rm.updateConfig({ autoTrade: false });
    const result = rm.check(mockOpportunity(), 10_000);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/auto-trade/i);
  });

  test('rejects when circuit breaker is tripped', () => {
    rm.tripCircuitBreaker('test');
    const result = rm.check(mockOpportunity(), 10_000);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/circuit breaker/i);
  });

  test('rejects when net profit < minProfitUsd', () => {
    const result = rm.check(mockOpportunity({ netProfitUsd: 0.5 }), 10_000);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/minProfit/i);
  });

  test('rejects when trade size exceeds maxTradeExposure', () => {
    // Trade is 1 USDC, wallet is $1 → 100% exposure, limit is 50%
    const result = rm.check(mockOpportunity(), 1);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/maxTradeExposure/i);
  });

  test('rejects when slippage exceeds maxSlippageBps', () => {
    const opp = mockOpportunity();
    opp.buyQuote.priceImpact = 0.05; // 500 bps > 100 bps limit
    const result = rm.check(opp, 10_000);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/slippage/i);
  });

  test('trips circuit breaker when daily loss limit reached', () => {
    rm.updateConfig({ maxDailyLossUsd: 10 });
    rm.recordTrade(-15); // loss of $15
    expect(rm.isCircuitBreakerTripped()).toBe(true);
    expect(rm.getDailyLossUsd()).toBe(15);
  });

  test('resets circuit breaker', () => {
    rm.tripCircuitBreaker('test');
    rm.resetCircuitBreaker();
    expect(rm.isCircuitBreakerTripped()).toBe(false);
  });

  test('getConfig returns current config', () => {
    const c = rm.getConfig();
    expect(c.autoTrade).toBe(true);
    expect(c.minProfitUsd).toBe(1.0);
  });

  test('updateConfig changes config', () => {
    rm.updateConfig({ minProfitUsd: 5.0 });
    expect(rm.getConfig().minProfitUsd).toBe(5.0);
  });
});
