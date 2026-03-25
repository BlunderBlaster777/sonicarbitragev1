/**
 * nonceManager.ts — Robust nonce management for concurrent transactions.
 *
 * Problems solved:
 *   - Prevents nonce reuse when multiple txs are submitted simultaneously.
 *   - Uses Redis as a distributed lock to prevent race conditions across
 *     multiple bot instances.
 *   - Falls back to in-memory nonce tracking when Redis is unavailable.
 *
 * USAGE:
 *   const nm = new NonceManager(provider, signerAddress, redis);
 *   const nonce = await nm.nextNonce();
 *   // ... build and submit tx with this nonce ...
 *   await nm.confirmNonce(nonce); // or nm.releaseNonce(nonce) on failure
 */

import type { JsonRpcProvider } from 'ethers';
import type Redis from 'ioredis';
import { logger } from './logger';

const LOCK_TTL_MS = 10_000;      // 10s lock timeout
const LOCK_KEY_PREFIX = 'arb:nonce:lock:';
const NONCE_KEY_PREFIX = 'arb:nonce:';

export class NonceManager {
  private readonly provider: JsonRpcProvider;
  private readonly address: string;
  private readonly redis: Redis | null;
  /** In-memory pending nonces as fallback */
  private pendingNonces = new Set<number>();
  private localNonce: number | null = null;

  constructor(provider: JsonRpcProvider, address: string, redis: Redis | null = null) {
    this.provider = provider;
    this.address = address.toLowerCase();
    this.redis = redis;
  }

  /**
   * Acquire the next available nonce.
   * Blocks briefly until any in-flight txs at earlier nonces are acknowledged.
   */
  async nextNonce(): Promise<number> {
    if (this.redis) {
      return this.nextNonceRedis();
    }
    return this.nextNonceLocal();
  }

  /** Mark a nonce as successfully confirmed (transaction mined). */
  async confirmNonce(nonce: number): Promise<void> {
    this.pendingNonces.delete(nonce);
    if (this.redis) {
      await this.redis
        .del(`${NONCE_KEY_PREFIX}${this.address}:${nonce}`)
        .catch((e) => logger.warn({ e }, '[NonceManager] Redis delete failed'));
    }
  }

  /**
   * Release a nonce back to the pool (e.g., tx failed before broadcast).
   * This allows the nonce to be reused.
   */
  async releaseNonce(nonce: number): Promise<void> {
    this.pendingNonces.delete(nonce);
    if (this.localNonce !== null && nonce <= this.localNonce) {
      this.localNonce = nonce;
    }
    if (this.redis) {
      await this.redis
        .del(`${NONCE_KEY_PREFIX}${this.address}:${nonce}`)
        .catch((e) => logger.warn({ e }, '[NonceManager] Redis delete failed'));
    }
    logger.debug({ nonce }, '[NonceManager] Nonce released: %d', nonce);
  }

  /** Sync local nonce with on-chain state (e.g., after a restart). */
  async sync(): Promise<void> {
    const onChainNonce = await this.provider.getTransactionCount(this.address, 'pending');
    this.localNonce = onChainNonce;
    logger.info({ address: this.address, nonce: onChainNonce }, '[NonceManager] Synced with chain');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async nextNonceLocal(): Promise<number> {
    if (this.localNonce === null) {
      this.localNonce = await this.provider.getTransactionCount(this.address, 'pending');
    }
    const nonce = this.localNonce;
    this.localNonce++;
    this.pendingNonces.add(nonce);
    logger.debug({ nonce }, '[NonceManager] Allocated local nonce: %d', nonce);
    return nonce;
  }

  private async nextNonceRedis(): Promise<number> {
    if (!this.redis) throw new Error('Redis not initialised');
    const lockKey = `${LOCK_KEY_PREFIX}${this.address}`;

    // Acquire distributed lock with TTL
    const acquired = await this.redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) {
      // Wait briefly and retry once
      await new Promise((r) => setTimeout(r, 50));
      return this.nextNonceRedis();
    }

    try {
      const onChainNonce = await this.provider.getTransactionCount(this.address, 'pending');
      // Find the lowest available nonce >= onChainNonce
      let nonce = onChainNonce;
      while (await this.redis.exists(`${NONCE_KEY_PREFIX}${this.address}:${nonce}`)) {
        nonce++;
      }
      // Reserve this nonce in Redis
      await this.redis.set(
        `${NONCE_KEY_PREFIX}${this.address}:${nonce}`,
        '1',
        'PX',
        60_000, // 1 min TTL as safety
      );
      logger.debug({ nonce }, '[NonceManager] Allocated Redis nonce: %d', nonce);
      return nonce;
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }
}
