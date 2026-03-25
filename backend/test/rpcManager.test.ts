/**
 * test/rpcManager.test.ts — Unit tests for RpcManager.
 */

import { RpcManager } from '../src/rpcManager';

// Mock ethers JsonRpcProvider
jest.mock('ethers', () => {
  const actual = jest.requireActual<typeof import('ethers')>('ethers');
  return {
    ...actual,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getBlockNumber: jest.fn().mockResolvedValue(100),
    })),
  };
});

describe('RpcManager', () => {
  test('throws when no URLs provided', () => {
    expect(() => new RpcManager([])).toThrow();
  });

  test('initialises with multiple URLs', () => {
    const rpc = new RpcManager(['https://rpc1.example.com', 'https://rpc2.example.com']);
    expect(rpc.getProvider()).toBeDefined();
  });

  test('returns a provider', () => {
    const rpc = new RpcManager(['https://rpc.soniclabs.com']);
    const provider = rpc.getProvider();
    expect(provider).toBeDefined();
  });

  test('call() delegates to provider function', async () => {
    const rpc = new RpcManager(['https://rpc.soniclabs.com']);
    const result = await rpc.call((provider) => provider.getBlockNumber());
    expect(result).toBe(100);
  });

  test('call() falls back to next provider on failure', async () => {
    const { JsonRpcProvider } = await import('ethers');
    const MockProvider = JsonRpcProvider as jest.MockedClass<typeof import('ethers').JsonRpcProvider>;

    let callCount = 0;
    MockProvider.mockImplementation(() => ({
      getBlockNumber: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('First provider failed');
        return Promise.resolve(200);
      }),
    }) as unknown as import('ethers').JsonRpcProvider);

    const rpc = new RpcManager(['https://rpc1.example.com', 'https://rpc2.example.com']);
    const result = await rpc.call((p) => p.getBlockNumber());
    expect(result).toBe(200);
  });
});
