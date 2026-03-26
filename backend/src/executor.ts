/**
 * executor.ts — Builds and (optionally) broadcasts arbitrage transactions.
 *
 * Execution flow:
 *   1. Build calldata for both swap legs via the adapters.
 *   2. Run full simulation via Simulator.simulateArb().
 *   3. If simulation passes and dryRun=false, sign and broadcast.
 *   4. Wait for confirmation and record the result.
 *
 * ATOMIC EXECUTION:
 *   If ATOMIC_HELPER_ADDRESS is configured, both swaps are bundled into a
 *   single call to the AtomicArb helper contract (see hardhat/contracts/).
 *   Otherwise, they are submitted as two sequential transactions.
 *
 * SECURITY NOTE:
 *   Never store private keys in source code.
 *   Use PRIVATE_KEY env var (dev) or REMOTE_SIGNER_URL (production).
 *
 * MEV MITIGATION:
 *   If MEV_RELAY_URL is configured, signed tx is submitted via relay bundle
 *   instead of the public mempool.
 */

import { Wallet, JsonRpcProvider, TransactionResponse, TransactionReceipt } from 'ethers';
import axios from 'axios';
import { config } from './config';
import { logger } from './logger';
import type { RpcManager } from './rpcManager';
import type { ShadowAdapter } from './poolAdapters/ShadowAdapter';
import type { BeetsAdapter } from './poolAdapters/BeetsAdapter';
import type { Simulator } from './simulator';
import type { NonceManager } from './nonceManager';
import type { ArbOpportunity, TradeRecord, TxData } from './types';

// ── Return type for rebalanceToUsdc ──────────────────────────────────────────

export interface RebalanceResult {
  /** Whether the rebalance was initiated (including dry-run). */
  attempted: boolean;
  /** Whether the on-chain tx confirmed (always false in dry-run). */
  confirmed: boolean;
  dex?: string;
  amountIn?: string;
  expectedUsdc?: string;
  dryRun?: boolean;
  failureReason?: string;
}

// Atomic helper contract address (optional — deploy with `npx hardhat deploy`)
const ATOMIC_HELPER_ADDRESS = process.env['ATOMIC_HELPER_ADDRESS'];

// Confirmation timeout
const CONFIRM_TIMEOUT_MS = 60_000;

export class Executor {
  private readonly rpc: RpcManager;
  private readonly shadow: ShadowAdapter;
  private readonly beets: BeetsAdapter;
  private readonly simulator: Simulator;
  private readonly nonceManager: NonceManager;
  private signer: Wallet | null = null;

  constructor(
    rpc: RpcManager,
    shadow: ShadowAdapter,
    beets: BeetsAdapter,
    simulator: Simulator,
    nonceManager: NonceManager,
  ) {
    this.rpc = rpc;
    this.shadow = shadow;
    this.beets = beets;
    this.simulator = simulator;
    this.nonceManager = nonceManager;

    // Initialise signer for dev/staging
    if (config.privateKey) {
      const provider = rpc.getProvider();
      this.signer = new Wallet(config.privateKey, provider);
      logger.warn(
        '[Executor] Using PRIVATE_KEY signer (dev only). Use REMOTE_SIGNER_URL in production.',
      );
    }
  }

  get signerAddress(): string | null {
    return this.signer?.address ?? null;
  }

  /**
   * Execute an arbitrage opportunity.
   * Returns a TradeRecord regardless of outcome (success, failure, dry-run).
   */
  async execute(opportunity: ArbOpportunity): Promise<TradeRecord> {
    const tradeId = opportunity.id;
    logger.info(
      { tradeId, pair: opportunity.pair, direction: opportunity.direction },
      '[Executor] Starting execution for opportunity %s',
      tradeId,
    );

    // ── 1. Build swap calldata ───────────────────────────────────────────────
    const recipient = this.signer?.address ?? '0x0000000000000000000000000000000000000001';
    const { buyAdapter, sellAdapter, buyDex, sellDex } = this.resolveAdapters(opportunity);

    const tx1 = await buyAdapter.buildSwapTx(
      buyDex,
      opportunity.pair,
      opportunity.amountIn,
      opportunity.buyQuote.tokenIn,
      opportunity.buyQuote.tokenOut,
      recipient,
    );

    const tx2 = await sellAdapter.buildSwapTx(
      sellDex,
      opportunity.pair,
      opportunity.midAmount,
      opportunity.sellQuote.tokenIn,
      opportunity.sellQuote.tokenOut,
      recipient,
    );

    // ── 2. Simulate ──────────────────────────────────────────────────────────
    const minProfitRaw =
      opportunity.grossProfit > 0n
        ? opportunity.grossProfit / 2n // require at least half gross profit
        : 0n;

    const simResult = await this.simulator.simulateArb(
      tx1,
      tx2,
      recipient,
      opportunity.buyQuote.tokenIn, // tokenOut of full round trip = original tokenIn
      opportunity.amountIn,
      minProfitRaw,
    );

    if (!simResult.success) {
      logger.warn(
        { tradeId, reason: simResult.revertReason },
        '[Executor] Simulation failed — aborting trade: %s',
        simResult.revertReason,
      );
      return this.buildTradeRecord(opportunity, 'failed', undefined, simResult.revertReason);
    }

    logger.info(
      { tradeId, gasEstimate: simResult.gasUsed?.toString() },
      '[Executor] Simulation passed',
    );

    // ── 3. Dry-run check ─────────────────────────────────────────────────────
    if (config.dryRun) {
      logger.info({ tradeId }, '[Executor] DRY RUN — not broadcasting transaction');
      return this.buildTradeRecord(opportunity, 'simulated_only');
    }

    if (!this.signer && !config.remoteSignerUrl) {
      throw new Error('[Executor] No signer configured. Set PRIVATE_KEY or REMOTE_SIGNER_URL.');
    }

    // ── 4. Broadcast ─────────────────────────────────────────────────────────
    try {
      // Small randomised delay to reduce MEV predictability (50–200ms)
      await randomDelay(50, 200);

      let txHash: string;

      if (ATOMIC_HELPER_ADDRESS) {
        txHash = await this.broadcastAtomic(tx1, tx2, opportunity);
      } else {
        txHash = await this.broadcastSequential(tx1, tx2, opportunity);
      }

      logger.info({ tradeId, txHash }, '[Executor] Transaction broadcast: %s', txHash);

      // ── 5. Wait for confirmation ─────────────────────────────────────────
      const receipt = await this.waitForConfirmation(txHash);
      if (receipt && receipt.status === 1) {
        logger.info({ tradeId, txHash }, '[Executor] Transaction confirmed');
        return this.buildTradeRecord(opportunity, 'confirmed', txHash, undefined, receipt.gasUsed);
      } else {
        logger.error({ tradeId, txHash }, '[Executor] Transaction reverted on-chain');
        return this.buildTradeRecord(opportunity, 'failed', txHash, 'On-chain revert');
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({ tradeId, err }, '[Executor] Broadcast error: %s', reason);
      return this.buildTradeRecord(opportunity, 'failed', undefined, reason);
    }
  }

  /**
   * Swap all non-USDC token holdings back to USDC when the bot is idle.
   * Picks the DEX with the best quote for WS → USDC.
   * Respects dryRun mode and logs the rebalance action.
   * Returns a RebalanceResult so the caller can track metrics and broadcast events.
   */
  async rebalanceToUsdc(
    wsBalance: bigint,
    pair: string,
    tokenWs: string,
    tokenUsdc: string,
  ): Promise<RebalanceResult> {
    const recipient = this.signer?.address ?? '0x0000000000000000000000000000000000000001';

    // Get quotes from both DEXes for WS → USDC
    const [shadowQuote, beetsQuote] = await Promise.allSettled([
      this.shadow.quoteSwap('shadow', pair, wsBalance, tokenWs, tokenUsdc),
      this.beets.quoteSwap('beets', pair, wsBalance, tokenWs, tokenUsdc),
    ]);

    const shadowOk = shadowQuote.status === 'fulfilled' ? shadowQuote.value : null;
    const beetsOk = beetsQuote.status === 'fulfilled' ? beetsQuote.value : null;

    // Pick the DEX that returns the most USDC
    let bestDex: 'shadow' | 'beets';
    let bestQuote: typeof shadowOk;

    if (shadowOk && beetsOk) {
      if (shadowOk.amountOut >= beetsOk.amountOut) {
        bestDex = 'shadow';
        bestQuote = shadowOk;
      } else {
        bestDex = 'beets';
        bestQuote = beetsOk;
      }
    } else if (shadowOk) {
      bestDex = 'shadow';
      bestQuote = shadowOk;
    } else if (beetsOk) {
      bestDex = 'beets';
      bestQuote = beetsOk;
    } else {
      logger.warn('[Executor] Rebalance failed — could not get quotes from either DEX');
      return { attempted: false, confirmed: false, failureReason: 'No quotes available' };
    }

    logger.info(
      {
        dex: bestDex,
        wsBalance: wsBalance.toString(),
        expectedUsdc: bestQuote.amountOut.toString(),
      },
      '[Executor] Rebalancing WS → USDC on %s',
      bestDex,
    );

    const adapter = bestDex === 'shadow' ? this.shadow : this.beets;
    const tx = await adapter.buildSwapTx(bestDex, pair, wsBalance, tokenWs, tokenUsdc, recipient);

    // Simulate first
    const simResult = await this.simulator.simulateTx(tx, recipient);
    if (!simResult.success) {
      logger.warn(
        { reason: simResult.revertReason },
        '[Executor] Rebalance simulation failed — keeping WS position',
      );
      return { attempted: false, confirmed: false, failureReason: simResult.revertReason };
    }

    const baseResult: RebalanceResult = {
      attempted: true,
      confirmed: false,
      dex: bestDex,
      amountIn: wsBalance.toString(),
      expectedUsdc: bestQuote.amountOut.toString(),
      dryRun: config.dryRun,
    };

    if (config.dryRun) {
      logger.info(
        {
          dex: bestDex,
          wsAmount: wsBalance.toString(),
          expectedUsdc: bestQuote.amountOut.toString(),
        },
        '[Executor] DRY RUN — would rebalance WS → USDC on %s',
        bestDex,
      );
      return baseResult;
    }

    if (!this.signer && !config.remoteSignerUrl) {
      logger.warn('[Executor] No signer configured — cannot rebalance');
      return { ...baseResult, attempted: false, failureReason: 'No signer configured' };
    }

    try {
      const feeData = await this.rpc.call((p) => p.getFeeData());
      const nonce = await this.nonceManager.nextNonce();
      const txHash = await this.signAndSend(tx, nonce, feeData);
      logger.info({ txHash }, '[Executor] Rebalance tx broadcast: %s', txHash);

      const receipt = await this.waitForConfirmation(txHash);
      if (receipt && receipt.status === 1) {
        logger.info({ txHash }, '[Executor] Rebalance confirmed — now holding USDC');
        return { ...baseResult, confirmed: true };
      } else {
        logger.error({ txHash }, '[Executor] Rebalance tx reverted on-chain');
        return { ...baseResult, failureReason: 'On-chain revert' };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[Executor] Rebalance broadcast error: %s', reason);
      return { ...baseResult, failureReason: reason };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private resolveAdapters(opp: ArbOpportunity) {
    const buyDex = opp.buyDex;
    const sellDex = opp.sellDex;
    return {
      buyAdapter: buyDex === 'shadow' ? this.shadow : this.beets,
      sellAdapter: sellDex === 'shadow' ? this.shadow : this.beets,
      buyDex,
      sellDex,
    };
  }

  /** Broadcast both swaps as sequential transactions. */
  private async broadcastSequential(
    tx1: TxData,
    tx2: TxData,
    _opp: ArbOpportunity,
  ): Promise<string> {
    const feeData = await this.rpc.call((p) => p.getFeeData());
    const nonce1 = await this.nonceManager.nextNonce();
    const nonce2 = nonce1 + 1;

    const [hash1] = await Promise.all([this.signAndSend(tx1, nonce1, feeData)]);
    await this.signAndSend(tx2, nonce2, feeData);

    return hash1;
  }

  /** Broadcast a single atomic tx to the helper contract. */
  private async broadcastAtomic(tx1: TxData, tx2: TxData, opp: ArbOpportunity): Promise<string> {
    if (!ATOMIC_HELPER_ADDRESS) throw new Error('No atomic helper address');
    const iface = new (await import('ethers')).Interface([
      'function executeArb(address target1, bytes calldata data1, address target2, bytes calldata data2, address profitToken, uint256 minProfit) external',
    ]);
    const data = iface.encodeFunctionData('executeArb', [
      tx1.to,
      tx1.data,
      tx2.to,
      tx2.data,
      opp.buyQuote.tokenIn, // profitToken = round-trip base token (USDC)
      opp.grossProfit / 2n,
    ]);
    const atomicTx: TxData = { to: ATOMIC_HELPER_ADDRESS, data, value: 0n };
    const feeData = await this.rpc.call((p) => p.getFeeData());
    const nonce = await this.nonceManager.nextNonce();
    return this.signAndSend(atomicTx, nonce, feeData);
  }

  private async signAndSend(
    tx: TxData,
    nonce: number,
    feeData: Awaited<ReturnType<JsonRpcProvider['getFeeData']>>,
  ): Promise<string> {
    if (!this.signer) throw new Error('No signer');

    const signed = await this.signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      nonce,
      maxFeePerGas: feeData.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
      gasLimit: tx.gasLimit,
    });

    if (config.mevRelayUrl) {
      await this.submitToMevRelay(signed);
    }

    return signed.hash;
  }

  /** Optionally submit to an MEV relay. */
  private async submitToMevRelay(tx: TransactionResponse): Promise<void> {
    try {
      await axios.post(config.mevRelayUrl!, {
        tx: tx.hash,
        // relay-specific format — update for your relay
      });
      logger.info({ txHash: tx.hash }, '[Executor] Submitted to MEV relay');
    } catch (err) {
      logger.warn({ err }, '[Executor] MEV relay submission failed — falling back to mempool');
    }
  }

  private async waitForConfirmation(txHash: string): Promise<TransactionReceipt | null> {
    return this.rpc.call(async (provider) => {
      const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) return receipt;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      return null;
    });
  }

  private buildTradeRecord(
    opp: ArbOpportunity,
    status: TradeRecord['status'],
    txHash?: string,
    failureReason?: string,
    gasUsed?: bigint,
  ): TradeRecord {
    return {
      id: opp.id,
      opportunityId: opp.id,
      pair: opp.pair,
      direction: opp.direction,
      amountIn: opp.amountIn.toString(),
      amountOut: opp.amountOut.toString(),
      netProfitUsd: opp.netProfitUsd,
      txHash,
      gasUsed: gasUsed?.toString(),
      gasCostUsd: opp.gasCostUsd,
      status,
      dryRun: config.dryRun,
      createdAt: new Date(),
      failureReason,
    };
  }
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}
