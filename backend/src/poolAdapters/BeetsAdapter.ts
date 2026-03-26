/**
 * poolAdapters/BeetsAdapter.ts — DEX adapter for Beets / BeethovenX V3 on Sonic.
 *
 * BeethovenX V3 (Balancer V3 fork) uses a central Vault contract.
 * All swaps are routed through the Vault using pool IDs.
 *
 * TODO — Before deploying:
 *   1. Verify BEETS_VAULT address in your .env.
 *      Check: https://docs.beets.fi or https://sonicscan.org
 *   2. Verify pool IDs (BEETS_USDC_WS_POOL_ID, etc.).
 *      Fetch from Beets subgraph or API:
 *        curl https://api.beets.fi/graphql -d '{"query":"{ pools { id } }"}'
 *   3. Confirm pool type (WeightedPool, StablePool) to use correct formula.
 *
 * ARCHITECTURE:
 *   Balancer V3 Vault holds all tokens; pools are "logic-only".
 *   A single-swap call: Vault.swap(SingleSwap, FundManagement, limit, deadline)
 *
 * EXTENDING:
 *   Add new pool IDs to POOL_MAP; override getPoolType() if needed.
 */

import { Contract } from 'ethers';
import { config } from '../config';
import { logger } from '../logger';
import type { PoolAdapter, PoolState, Quote, TxData } from '../types';
import type { RpcManager } from '../rpcManager';

// ── ABIs ─────────────────────────────────────────────────────────────────────

/**
 * Minimal Balancer V3 Vault ABI.
 * Full ABI: https://github.com/balancer/balancer-v3-monorepo
 */
const VAULT_ABI = [
  // Query swap — read-only simulation of a swap
  `function querySwap(
    (bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap,
    (address sender, bool fromInternalBalance, address payable recipient, bool toInternalBalance) funds
  ) external returns (uint256)`,

  // Execute swap
  `function swap(
    (bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap,
    (address sender, bool fromInternalBalance, address payable recipient, bool toInternalBalance) funds,
    uint256 limit,
    uint256 deadline
  ) external payable returns (uint256 amountCalculated)`,

  // Get pool tokens and balances
  `function getPoolTokens(bytes32 poolId) external view returns (
    address[] memory tokens,
    uint256[] memory balances,
    uint256 lastChangeBlock
  )`,
];

// SwapKind enum: 0 = GIVEN_IN, 1 = GIVEN_OUT
const SWAP_KIND_GIVEN_IN = 0;

// ── Pool Map ──────────────────────────────────────────────────────────────────

type PairKey = 'USDC/WS' | 'USDC/WETH';

// Fee is embedded in pool config; approximate defaults per pool type.
// StablePool ~0.04%, WeightedPool ~0.1–0.3%. Adjust after verifying on-chain.
const POOL_FEES: Record<string, number> = {
  'USDC/WS': 4,   // 0.04% (stable pair)
  'USDC/WETH': 30, // 0.30% (weighted)
};

// ── Adapter ───────────────────────────────────────────────────────────────────

export class BeetsAdapter implements PoolAdapter {
  private readonly rpc: RpcManager;
  private readonly vaultAddress: string;
  private readonly poolIdMap: Map<PairKey, string>;

  constructor(rpc: RpcManager) {
    this.rpc = rpc;
    this.vaultAddress = config.beets.vault;
    this.poolIdMap = new Map([
      ['USDC/WS', config.beets.usdcWsPoolId],
      ['USDC/WETH', config.beets.usdcWethPoolId],
    ]);
  }

  private getPoolId(pair: string): string {
    const id = this.poolIdMap.get(pair as PairKey);
    if (!id) throw new Error(`[BeetsAdapter] Unknown pair: ${pair}`);
    if (id.includes('TODO')) {
      throw new Error(
        `[BeetsAdapter] Pool ID for ${pair} is a placeholder. ` +
          `Set BEETS_${pair.replace('/', '_')}_POOL_ID in your .env.`,
      );
    }
    return id;
  }

  // ── PoolAdapter Interface ──────────────────────────────────────────────────

  async getPoolState(dex: string, pair: string): Promise<PoolState> {
    if (dex !== 'beets') throw new Error(`[BeetsAdapter] Unexpected dex: ${dex}`);

    const poolId = this.getPoolId(pair);
    // Pool address is the first 20 bytes of the poolId
    const poolAddress = '0x' + poolId.slice(2, 42);

    return this.rpc.call(async (provider) => {
      const vault = new Contract(this.vaultAddress, VAULT_ABI, provider);
      const [tokens, balances]: [string[], bigint[], bigint] =
        await vault['getPoolTokens'](poolId);

      if (tokens.length < 2) {
        throw new Error(`[BeetsAdapter] Pool ${poolId} has fewer than 2 tokens`);
      }

      const blockNumber = await provider.getBlockNumber();
      const feeBps = POOL_FEES[pair] ?? 30;

      const state: PoolState = {
        dex,
        pair,
        poolAddress,
        token0: tokens[0],
        token1: tokens[1],
        reserve0: balances[0].toString(),
        reserve1: balances[1].toString(),
        feeBps,
        blockNumber,
        fetchedAt: Date.now(),
      };

      logger.debug({ state }, '[BeetsAdapter] Pool state fetched');
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
    if (dex !== 'beets') throw new Error(`[BeetsAdapter] Unexpected dex: ${dex}`);

    const poolId = this.getPoolId(pair);

    return this.rpc.call(async (provider) => {
      const vault = new Contract(this.vaultAddress, VAULT_ABI, provider);

      // Null address for sender/recipient since this is a query
      const NULL_ADDR = '0x0000000000000000000000000000000000000000';
      const singleSwap = {
        poolId,
        kind: SWAP_KIND_GIVEN_IN,
        assetIn: tokenIn,
        assetOut: tokenOut,
        amount: amountIn,
        userData: '0x',
      };
      const funds = {
        sender: NULL_ADDR,
        fromInternalBalance: false,
        recipient: NULL_ADDR,
        toInternalBalance: false,
      };

      const amountOut: bigint = await vault['querySwap'](singleSwap, funds);

      const slippageFactor = BigInt(10_000 - config.maxSlippageBps);
      const amountOutMin = (amountOut * slippageFactor) / BigInt(10_000);

      const feeBps = POOL_FEES[pair] ?? 30;
      const feeAmount = (amountIn * BigInt(feeBps)) / BigInt(10_000);

      const state = await this.getPoolState(dex, pair);
      const priceImpact = estimatePriceImpact(amountIn, amountOut, state, tokenIn);

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

      logger.debug({ quote }, '[BeetsAdapter] Quote computed');
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
    if (dex !== 'beets') throw new Error(`[BeetsAdapter] Unexpected dex: ${dex}`);

    const poolId = this.getPoolId(pair);
    const quote = await this.quoteSwap(dex, pair, amountIn, tokenIn, tokenOut);
    const deadline = Math.floor(Date.now() / 1000) + 300;

    const iface = new (await import('ethers')).Interface(VAULT_ABI);
    const singleSwap = [poolId, SWAP_KIND_GIVEN_IN, tokenIn, tokenOut, amountIn, '0x'];
    const funds = [
      recipient, // sender
      false, // fromInternalBalance
      recipient, // recipient
      false, // toInternalBalance
    ];

    const data = iface.encodeFunctionData('swap', [
      singleSwap,
      funds,
      quote.amountOutMin,
      deadline,
    ]);

    return {
      to: this.vaultAddress,
      data,
      value: 0n,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Approximate price impact for a Balancer-style pool.
 * Uses the ratio of amountIn to reserve as a rough measure.
 */
function estimatePriceImpact(
  amountIn: bigint,
  _amountOut: bigint,
  state: PoolState,
  tokenIn: string,
): number {
  const reserveIn =
    tokenIn.toLowerCase() === state.token0.toLowerCase()
      ? BigInt(state.reserve0)
      : BigInt(state.reserve1);

  if (reserveIn === 0n) return 0;
  return Number((amountIn * BigInt(1e9)) / (reserveIn + amountIn)) / 1e9;
}
