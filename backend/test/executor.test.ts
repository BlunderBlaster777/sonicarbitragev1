/**
 * test/executor.test.ts — Unit tests for Executor.
 *
 * Covers:
 *   - rebalanceToUsdc: idle "hold USDC" behaviour (DEX selection, fallbacks,
 *     failure modes, dry-run mode).
 *   - execute: arbitrage execution (dry-run, simulation failure, no signer).
 */

import { Executor } from '../src/executor';
import type { ShadowAdapter } from '../src/poolAdapters/ShadowAdapter';
import type { BeetsAdapter } from '../src/poolAdapters/BeetsAdapter';
import type { RpcManager } from '../src/rpcManager';
import type { Simulator } from '../src/simulator';
import type { NonceManager } from '../src/nonceManager';
import type { ArbOpportunity, Quote } from '../src/types';

// ── Mock config (dry-run by default) ─────────────────────────────────────────

jest.mock('../src/config', () => ({
  config: {
    chainId: 146,
    dryRun: true,
    privateKey: undefined,
    remoteSignerUrl: undefined,
    minProfitUsd: 1.0,
    maxTradeExposure: 0.2,
    maxSlippageBps: 50,
    maxGasPriceMultiplier: 2.0,
    maxDailyLossUsd: 500,
    scanIntervalMs: 300,
    sPriceUsd: 0.5,
    rebalanceToUsdc: true,
    minRebalanceUsd: 1.0,
    mevRelayUrl: undefined,
    tokens: { USDC: '0xUSdc', WS: '0xWS', WETH: '0xWETH' },
    rpcUrls: ['https://rpc.soniclabs.com'],
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const WS_BALANCE = 5_000_000_000_000_000_000n; // 5 WS
const USDC_ADDRESS = '0xUSdc';
const WS_ADDRESS = '0xWS';
const PAIR = 'USDC/WS';

function mockQuote(dex: string, amountOut: bigint): Quote {
  return {
    dex,
    pair: PAIR,
    tokenIn: WS_ADDRESS,
    tokenOut: USDC_ADDRESS,
    amountIn: WS_BALANCE,
    amountOut,
    amountOutMin: amountOut - amountOut / 100n,
    feeAmount: 1000n,
    priceImpact: 0.001,
  };
}

function makeRpc(): Partial<RpcManager> {
  return {
    call: jest.fn().mockImplementation((fn: (p: unknown) => Promise<unknown>) =>
      fn({ getFeeData: () => Promise.resolve({ gasPrice: 1_000_000_000n }) }),
    ),
    getProvider: jest.fn().mockReturnValue({}),
  };
}

function makeSimulator(success: boolean): Partial<Simulator> {
  return {
    simulateTx: jest.fn().mockResolvedValue(success ? { success: true, gasUsed: 100_000n } : { success: false, revertReason: 'out of gas' }),
    readBalance: jest.fn().mockResolvedValue(null),
  };
}

function makeNonceManager(): Partial<NonceManager> {
  return {
    nextNonce: jest.fn().mockResolvedValue(1),
  };
}

function makeShadowAdapter(amountOut: bigint | null): Partial<ShadowAdapter> {
  const quoteSwap = amountOut !== null
    ? jest.fn().mockResolvedValue(mockQuote('shadow', amountOut))
    : jest.fn().mockRejectedValue(new Error('Shadow unavailable'));
  return {
    quoteSwap,
    buildSwapTx: jest.fn().mockResolvedValue({ to: '0xShadowRouter', data: '0x', value: 0n }),
  };
}

function makeBeetsAdapter(amountOut: bigint | null): Partial<BeetsAdapter> {
  const quoteSwap = amountOut !== null
    ? jest.fn().mockResolvedValue(mockQuote('beets', amountOut))
    : jest.fn().mockRejectedValue(new Error('Beets unavailable'));
  return {
    quoteSwap,
    buildSwapTx: jest.fn().mockResolvedValue({ to: '0xBeetsVault', data: '0x', value: 0n }),
  };
}

function makeExecutor(
  shadow: Partial<ShadowAdapter>,
  beets: Partial<BeetsAdapter>,
  simulator: Partial<Simulator>,
): Executor {
  const rpc = makeRpc();
  const nonce = makeNonceManager();
  return new Executor(
    rpc as unknown as RpcManager,
    shadow as unknown as ShadowAdapter,
    beets as unknown as BeetsAdapter,
    simulator as unknown as Simulator,
    nonce as unknown as NonceManager,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Executor.rebalanceToUsdc', () => {
  test('dry-run: picks best DEX (shadow > beets) and returns attempted=true, confirmed=false', async () => {
    const shadow = makeShadowAdapter(1_100_000n); // shadow gives more USDC
    const beets = makeBeetsAdapter(1_000_000n);
    const executor = makeExecutor(shadow, beets, makeSimulator(true));

    const result = await executor.rebalanceToUsdc(WS_BALANCE, PAIR, WS_ADDRESS, USDC_ADDRESS);

    expect(result.attempted).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.dex).toBe('shadow');
    expect(result.amountIn).toBe(WS_BALANCE.toString());
    expect(result.expectedUsdc).toBe('1100000');
  });

  test('dry-run: picks beets when beets gives better quote', async () => {
    const shadow = makeShadowAdapter(900_000n);
    const beets = makeBeetsAdapter(1_200_000n); // beets gives more USDC
    const executor = makeExecutor(shadow, beets, makeSimulator(true));

    const result = await executor.rebalanceToUsdc(WS_BALANCE, PAIR, WS_ADDRESS, USDC_ADDRESS);

    expect(result.attempted).toBe(true);
    expect(result.dex).toBe('beets');
    expect(result.expectedUsdc).toBe('1200000');
  });

  test('falls back to shadow when beets quote fails', async () => {
    const shadow = makeShadowAdapter(1_050_000n);
    const beets = makeBeetsAdapter(null); // beets unavailable
    const executor = makeExecutor(shadow, beets, makeSimulator(true));

    const result = await executor.rebalanceToUsdc(WS_BALANCE, PAIR, WS_ADDRESS, USDC_ADDRESS);

    expect(result.attempted).toBe(true);
    expect(result.dex).toBe('shadow');
  });

  test('falls back to beets when shadow quote fails', async () => {
    const shadow = makeShadowAdapter(null); // shadow unavailable
    const beets = makeBeetsAdapter(980_000n);
    const executor = makeExecutor(shadow, beets, makeSimulator(true));

    const result = await executor.rebalanceToUsdc(WS_BALANCE, PAIR, WS_ADDRESS, USDC_ADDRESS);

    expect(result.attempted).toBe(true);
    expect(result.dex).toBe('beets');
  });

  test('returns attempted=false when both DEX quotes fail', async () => {
    const shadow = makeShadowAdapter(null);
    const beets = makeBeetsAdapter(null);
    const executor = makeExecutor(shadow, beets, makeSimulator(true));

    const result = await executor.rebalanceToUsdc(WS_BALANCE, PAIR, WS_ADDRESS, USDC_ADDRESS);

    expect(result.attempted).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.failureReason).toMatch(/no quotes/i);
  });

  test('returns attempted=false when simulation fails', async () => {
    const shadow = makeShadowAdapter(1_000_000n);
    const beets = makeBeetsAdapter(1_000_000n);
    const executor = makeExecutor(shadow, beets, makeSimulator(false)); // sim fails

    const result = await executor.rebalanceToUsdc(WS_BALANCE, PAIR, WS_ADDRESS, USDC_ADDRESS);

    expect(result.attempted).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.failureReason).toBeDefined();
  });
});

// ── Executor.execute() tests ───────────────────────────────────────────────────

function makeArbOpportunity(): ArbOpportunity {
  const buyQuote: Quote = {
    dex: 'shadow',
    pair: PAIR,
    tokenIn: USDC_ADDRESS,
    tokenOut: WS_ADDRESS,
    amountIn: 1_000_000n,
    amountOut: 2_000_000_000_000_000_000n,
    amountOutMin: 1_980_000_000_000_000_000n,
    feeAmount: 300n,
    priceImpact: 0.001,
  };
  const sellQuote: Quote = {
    dex: 'beets',
    pair: PAIR,
    tokenIn: WS_ADDRESS,
    tokenOut: USDC_ADDRESS,
    amountIn: 2_000_000_000_000_000_000n,
    amountOut: 1_050_000n,
    amountOutMin: 1_039_500n,
    feeAmount: 200n,
    priceImpact: 0.001,
  };
  return {
    id: 'test-opp-001',
    pair: PAIR,
    direction: 'shadow_to_beets',
    buyDex: 'shadow',
    sellDex: 'beets',
    amountIn: 1_000_000n,
    midAmount: 2_000_000_000_000_000_000n,
    amountOut: 1_050_000n,
    grossProfit: 50_000n,
    gasCostUsd: 0.05,
    netProfitUsd: 0.45,
    buyQuote,
    sellQuote,
    detectedAt: Date.now(),
  };
}

function makeSimulatorForArb(success: boolean): Partial<Simulator> {
  return {
    simulateArb: jest.fn().mockResolvedValue(
      success
        ? { success: true, simulatedOutput: 1_050_000n, gasUsed: 350_000n }
        : { success: false, revertReason: 'simulation failed' },
    ),
    simulateTx: jest.fn().mockResolvedValue({ success: true, gasUsed: 100_000n }),
    readBalance: jest.fn().mockResolvedValue(null),
  };
}

describe('Executor.execute', () => {
  test('dry-run: returns simulated_only status without broadcasting', async () => {
    const shadow = makeShadowAdapter(1_100_000n);
    const beets = makeBeetsAdapter(1_000_000n);
    const simulator = makeSimulatorForArb(true);
    const executor = makeExecutor(shadow, beets, simulator);

    const opp = makeArbOpportunity();
    const result = await executor.execute(opp);

    expect(result.status).toBe('simulated_only');
    expect(result.dryRun).toBe(true);
    expect(result.txHash).toBeUndefined();
    expect(result.id).toBe(opp.id);
  });

  test('returns failed status when simulation fails', async () => {
    const shadow = makeShadowAdapter(1_100_000n);
    const beets = makeBeetsAdapter(1_000_000n);
    const simulator = makeSimulatorForArb(false);
    const executor = makeExecutor(shadow, beets, simulator);

    const opp = makeArbOpportunity();
    const result = await executor.execute(opp);

    expect(result.status).toBe('failed');
    expect(result.failureReason).toBeDefined();
    expect(result.txHash).toBeUndefined();
  });

  test('preserves opportunity metadata in trade record', async () => {
    const shadow = makeShadowAdapter(1_100_000n);
    const beets = makeBeetsAdapter(1_000_000n);
    const simulator = makeSimulatorForArb(true);
    const executor = makeExecutor(shadow, beets, simulator);

    const opp = makeArbOpportunity();
    const result = await executor.execute(opp);

    expect(result.pair).toBe(opp.pair);
    expect(result.direction).toBe(opp.direction);
    expect(result.netProfitUsd).toBe(opp.netProfitUsd);
    expect(result.amountIn).toBe(opp.amountIn.toString());
    expect(result.amountOut).toBe(opp.amountOut.toString());
  });
});
