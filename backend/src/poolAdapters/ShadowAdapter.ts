/**
 * poolAdapters/ShadowAdapter.ts — DEX adapter for Shadow (shadow.so).
 *
 * Shadow is a Uniswap V2-style AMM on Sonic chain.
 * It exposes the standard IUniswapV2Pair interface for pools.
 *
 * TODO — Before deploying:
 *   1. Verify the Shadow router address in your .env (SHADOW_ROUTER).
 *   2. Verify the pool addresses (SHADOW_USDC_WS_POOL, etc.).
 *   3. Confirm the fee tier (currently assumed 30 bps / 0.30%).
 *      Run: npx ts-node src/scripts/fetchPoolInfo.ts --dex shadow --pair USDC/WS
 *
 * EXTENDING:
 *   To add a new pair: add an entry to POOL_MAP and call getPoolState/quoteSwap.
 */

import { Contract } from 'ethers';
import { config } from '../config';
import { logger } from '../logger';
import type { PoolAdapter, PoolState, Quote, TxData } from '../types';
import type { RpcManager } from '../rpcManager';

// ── ABIs ─────────────────────────────────────────────────────────────────────

/** Minimal Uniswap V2 pair ABI — only the functions we need. */
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint256)', // Shadow may expose fee
];

/** Minimal Uniswap V2 router ABI. */
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

// ── Pool Map ──────────────────────────────────────────────────────────────────

/** Maps pair name → pool address. Populated from config at construction time. */
type PairKey = 'USDC/WS' | 'USDC/WETH';

const DEFAULT_FEE_BPS = 30; // 0.30% — adjust if Shadow uses a different fee

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ShadowAdapter implements PoolAdapter {
  private readonly rpc: RpcManager;
  private readonly routerAddress: string;
  private readonly poolMap: Map<PairKey, string>;

  constructor(rpc: RpcManager) {
    this.rpc = rpc;
    this.routerAddress = config.shadow.router;
    this.poolMap = new Map([
      ['USDC/WS', config.shadow.usdcWsPool],
      ['USDC/WETH', config.shadow.usdcWethPool],
    ]);
  }

  private getPoolAddress(pair: string): string {
    const addr = this.poolMap.get(pair as PairKey);
    if (!addr) throw new Error(`[ShadowAdapter] Unknown pair: ${pair}`);
    if (addr.includes('TODO')) {
      throw new Error(
        `[ShadowAdapter] Pool address for ${pair} is a placeholder. ` +
          `Set SHADOW_${pair.replace('/', '_')}_POOL in your .env.`,
      );
    }
    return addr;
  }

  // ── PoolAdapter Interface ──────────────────────────────────────────────────

  async getPoolState(dex: string, pair: string): Promise<PoolState> {
    if (dex !== 'shadow') throw new Error(`[ShadowAdapter] Unexpected dex: ${dex}`);

    const poolAddress = this.getPoolAddress(pair);

    return this.rpc.call(async (provider) => {
      const pairContract = new Contract(poolAddress, PAIR_ABI, provider);
      const [reserves, token0, token1, blockNumber] = await Promise.all([
        pairContract['getReserves']() as Promise<[bigint, bigint, number]>,
        pairContract['token0']() as Promise<string>,
        pairContract['token1']() as Promise<string>,
        provider.getBlockNumber(),
      ]);

      const state: PoolState = {
        dex,
        pair,
        poolAddress,
        token0,
        token1,
        reserve0: reserves[0].toString(),
        reserve1: reserves[1].toString(),
        feeBps: DEFAULT_FEE_BPS,
        blockNumber,
        fetchedAt: Date.now(),
      };

      logger.debug({ state }, '[ShadowAdapter] Pool state fetched');
      return state;
    });
  }

  async quoteSwap(
    dex: string,
    pair: string,
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
  ): Promise<Quote> {
    if (dex !== 'shadow') throw new Error(`[ShadowAdapter] Unexpected dex: ${dex}`);

    return this.rpc.call(async (provider) => {
      const routerContract = new Contract(this.routerAddress, ROUTER_ABI, provider);
      const amounts = (await routerContract['getAmountsOut'](amountIn, [tokenIn, tokenOut])) as bigint[];
      const amountOut = amounts[1];

      // Apply slippage buffer for amountOutMin
      const slippageFactor = BigInt(10_000 - config.maxSlippageBps);
      const amountOutMin = (amountOut * slippageFactor) / BigInt(10_000);

      // Fee deducted from input
      const feeAmount = (amountIn * BigInt(DEFAULT_FEE_BPS)) / BigInt(10_000);

      // Price impact approximation
      const state = await this.getPoolState(dex, pair);
      const priceImpact = estimatePriceImpact(amountIn, state, tokenIn);

      const quote: Quote = {
        dex,
        pair,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        amountOutMin,
        feeAmount,
        priceImpact,
      };

      logger.debug({ quote }, '[ShadowAdapter] Quote computed');
      return quote;
    });
  }

  async buildSwapTx(
    dex: string,
    pair: string,
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
    recipient: string,
  ): Promise<TxData> {
    if (dex !== 'shadow') throw new Error(`[ShadowAdapter] Unexpected dex: ${dex}`);

    const quote = await this.quoteSwap(dex, pair, amountIn, tokenIn, tokenOut);

    // Build calldata for swapExactTokensForTokens
    const iface = new (await import('ethers')).Interface(ROUTER_ABI);
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    const data = iface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      quote.amountOutMin,
      [tokenIn, tokenOut],
      recipient,
      deadline,
    ]);

    return {
      to: this.routerAddress,
      data,
      value: 0n,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Estimate price impact as a fraction using the constant-product formula.
 * priceImpact = amountIn / (reserve_tokenIn + amountIn)
 */
function estimatePriceImpact(amountIn: bigint, state: PoolState, tokenIn: string): number {
  const reserveIn =
    tokenIn.toLowerCase() === state.token0.toLowerCase()
      ? BigInt(state.reserve0)
      : BigInt(state.reserve1);

  if (reserveIn === 0n) return 0;
  return Number((amountIn * BigInt(1e9)) / (reserveIn + amountIn)) / 1e9;
}
