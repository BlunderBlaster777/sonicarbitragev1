/**
 * rpcManager.ts — Resilient multi-RPC provider with round-robin and fallback.
 *
 * Features:
 *  - Rotates through a list of RPC endpoints.
 *  - Exponential back-off when a provider fails.
 *  - Rate-limiting: enforces a minimum interval between calls per provider.
 *  - Emits the active provider so callers can observe the current connection.
 *
 * USAGE:
 *   const rpc = new RpcManager(config.rpcUrls);
 *   const provider = rpc.getProvider();
 *   const block = await provider.getBlockNumber();
 */

import { JsonRpcProvider } from 'ethers';
import { config } from './config';
import { logger } from './logger';

interface ProviderEntry {
  url: string;
  provider: JsonRpcProvider;
  /** Number of consecutive failures */
  failures: number;
  /** Time until which this provider is considered "cooling down" */
  cooldownUntil: number;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_CALL_RATE_MS = 50; // at most 20 calls/sec per provider

export class RpcManager {
  private readonly entries: ProviderEntry[];
  private currentIndex = 0;
  private readonly lastCallTime: Map<string, number> = new Map();

  constructor(rpcUrls: readonly string[] = config.rpcUrls) {
    if (rpcUrls.length === 0) throw new Error('[RpcManager] No RPC URLs provided');

    this.entries = rpcUrls.map((url) => ({
      url,
      provider: new JsonRpcProvider(url, { chainId: config.chainId, name: 'sonic' }),
      failures: 0,
      cooldownUntil: 0,
    }));

    logger.info({ rpcUrls }, '[RpcManager] Initialised with %d provider(s)', rpcUrls.length);
  }

  /** Returns the current best provider, rotating on failure. */
  getProvider(): JsonRpcProvider {
    const now = Date.now();
    // Try each entry starting from currentIndex
    for (let i = 0; i < this.entries.length; i++) {
      const idx = (this.currentIndex + i) % this.entries.length;
      const entry = this.entries[idx];
      if (entry.cooldownUntil <= now) {
        this.currentIndex = idx;
        return entry.provider;
      }
    }
    // All providers are on cooldown — return the one whose cooldown ends soonest
    const best = this.entries.reduce((a, b) => (a.cooldownUntil < b.cooldownUntil ? a : b));
    logger.warn('[RpcManager] All providers are on cooldown. Using least-bad: %s', best.url);
    return best.provider;
  }

  /**
   * Execute an async RPC call with automatic fallback and retry.
   * @param fn Function that receives a provider and returns a promise.
   */
  async call<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    const now = Date.now();
    for (let attempt = 0; attempt < this.entries.length; attempt++) {
      const entry = this.entries[this.currentIndex];

      // Rate-limiting
      const last = this.lastCallTime.get(entry.url) ?? 0;
      const wait = MAX_CALL_RATE_MS - (now - last);
      if (wait > 0) await delay(wait);
      this.lastCallTime.set(entry.url, Date.now());

      try {
        const result = await fn(entry.provider);
        // Success — reset failure count
        entry.failures = 0;
        return result;
      } catch (err) {
        entry.failures++;
        const backoff = Math.min(BASE_BACKOFF_MS * 2 ** entry.failures, MAX_BACKOFF_MS);
        entry.cooldownUntil = Date.now() + backoff;
        logger.warn(
          { url: entry.url, failures: entry.failures, backoffMs: backoff, err },
          '[RpcManager] Provider failed, backing off',
        );
        // Rotate to next provider
        this.currentIndex = (this.currentIndex + 1) % this.entries.length;
      }
    }
    throw new Error('[RpcManager] All RPC providers failed');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
