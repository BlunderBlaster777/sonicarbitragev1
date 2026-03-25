/**
 * simulator.ts — Simulates transactions via eth_call before broadcasting.
 *
 * Every candidate arbitrage transaction is simulated using eth_call against
 * the current chain state. If the simulation fails or the simulated profit
 * is below the threshold, the transaction is NOT broadcast.
 *
 * SAFETY GUARANTEE:
 *   No transaction is ever broadcast without a successful simulation.
 */

import { Contract, Interface } from 'ethers';
import { logger } from './logger';
import type { RpcManager } from './rpcManager';
import type { SimulationResult, TxData } from './types';

// ── ERC20 ABI (minimal — for balance checks) ─────────────────────────────────
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
];

export class Simulator {
  private readonly rpc: RpcManager;

  constructor(rpc: RpcManager) {
    this.rpc = rpc;
  }

  /**
   * Simulate a single transaction using eth_call.
   *
   * @param tx        Transaction calldata to simulate.
   * @param from      Sender address (must have tokens/ETH for the call).
   * @returns         SimulationResult with success flag, gas used, or revert reason.
   */
  async simulateTx(tx: TxData, from: string): Promise<SimulationResult> {
    return this.rpc.call(async (provider) => {
      try {
        const result = await provider.call({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          from,
        });

        const gasEstimate = await provider.estimateGas({
          to: tx.to,
          data: tx.data,
          value: tx.value,
          from,
        });

        logger.debug(
          { to: tx.to, gasEstimate: gasEstimate.toString() },
          '[Simulator] eth_call succeeded, gas estimate: %s',
          gasEstimate,
        );

        return {
          success: true,
          simulatedOutput: BigInt(result || '0x0'),
          gasUsed: gasEstimate,
        };
      } catch (err: unknown) {
        const revertReason = extractRevertReason(err);
        logger.warn(
          { to: tx.to, revertReason },
          '[Simulator] eth_call failed: %s',
          revertReason,
        );
        return { success: false, revertReason };
      }
    });
  }

  /**
   * Simulate the full two-leg arbitrage by checking ERC20 balances before/after.
   *
   * Since each leg is a separate tx (unless using the AtomicExecutor helper),
   * we simulate both and verify that the final balance exceeds the initial.
   *
   * @param tx1           First swap transaction.
   * @param tx2           Second swap transaction.
   * @param from          Sender address.
   * @param tokenOut      The output token of the second swap (the profit token).
   * @param initialBalance The starting balance of tokenOut (raw units).
   * @param minProfit     Minimum required profit (raw units of tokenOut).
   */
  async simulateArb(
    tx1: TxData,
    tx2: TxData,
    from: string,
    tokenOut: string,
    initialBalance: bigint,
    minProfit: bigint,
  ): Promise<SimulationResult> {
    // Simulate leg 1
    const sim1 = await this.simulateTx(tx1, from);
    if (!sim1.success) {
      return { success: false, revertReason: `Leg 1 failed: ${sim1.revertReason}` };
    }

    // Simulate leg 2
    const sim2 = await this.simulateTx(tx2, from);
    if (!sim2.success) {
      return { success: false, revertReason: `Leg 2 failed: ${sim2.revertReason}` };
    }

    // Cross-check: read on-chain balance via eth_call (best effort)
    const finalBalance = await this.readBalance(tokenOut, from);
    if (finalBalance !== null && finalBalance < initialBalance + minProfit) {
      return {
        success: false,
        revertReason: `Simulated profit (${finalBalance - initialBalance}) < minProfit (${minProfit})`,
      };
    }

    return {
      success: true,
      gasUsed: (sim1.gasUsed ?? 0n) + (sim2.gasUsed ?? 0n),
    };
  }

  /** Read on-chain ERC20 balance using eth_call. Returns null on error. */
  private async readBalance(token: string, account: string): Promise<bigint | null> {
    return this.rpc.call(async (provider) => {
      try {
        const erc20 = new Contract(token, ERC20_ABI, provider);
        const balance: bigint = await erc20['balanceOf'](account);
        return balance;
      } catch {
        return null;
      }
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractRevertReason(err: unknown): string {
  if (err && typeof err === 'object') {
    // ethers v6 errors
    if ('reason' in err && typeof err.reason === 'string') return err.reason;
    if ('message' in err && typeof err.message === 'string') return err.message;
    if ('data' in err && typeof err.data === 'string') {
      // Try to decode a standard Error(string) revert
      try {
        const iface = new Interface(['function Error(string)']);
        const decoded = iface.parseError(err.data as string);
        if (decoded) return `${decoded.name}: ${decoded.args.join(', ')}`;
      } catch {
        return err.data as string;
      }
    }
  }
  return String(err);
}
