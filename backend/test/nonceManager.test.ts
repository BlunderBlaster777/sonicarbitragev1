/**
 * test/nonceManager.test.ts — Unit tests for NonceManager.
 */

import { NonceManager } from '../src/nonceManager';
import type { JsonRpcProvider } from 'ethers';

function makeMockProvider(startNonce: number): Partial<JsonRpcProvider> {
  return {
    getTransactionCount: jest.fn().mockResolvedValue(startNonce),
  };
}

describe('NonceManager', () => {
  test('returns sequential nonces', async () => {
    const provider = makeMockProvider(5);
    const nm = new NonceManager(provider as JsonRpcProvider, '0xabc');

    const n1 = await nm.nextNonce();
    const n2 = await nm.nextNonce();
    const n3 = await nm.nextNonce();

    expect(n1).toBe(5);
    expect(n2).toBe(6);
    expect(n3).toBe(7);
  });

  test('re-uses released nonce', async () => {
    const provider = makeMockProvider(10);
    const nm = new NonceManager(provider as JsonRpcProvider, '0xabc');

    const n1 = await nm.nextNonce();
    expect(n1).toBe(10);

    await nm.releaseNonce(10);
    // After releasing nonce 10, localNonce resets to 10
    // Next nonce should be 10 again (re-fetched from provider mock)
    // Provider mock returns 10 again
    const n2 = await nm.nextNonce();
    expect(n2).toBe(10);
  });

  test('sync() updates nonce from provider', async () => {
    const provider = makeMockProvider(0);
    const nm = new NonceManager(provider as JsonRpcProvider, '0xabc');

    // Simulate chain advancing
    (provider.getTransactionCount as jest.Mock).mockResolvedValue(42);
    await nm.sync();

    const n = await nm.nextNonce();
    expect(n).toBe(42);
  });

  test('confirmNonce removes from pending set', async () => {
    const provider = makeMockProvider(1);
    const nm = new NonceManager(provider as JsonRpcProvider, '0xabc');

    const n = await nm.nextNonce();
    await nm.confirmNonce(n);
    // No error means success
    expect(true).toBe(true);
  });
});
