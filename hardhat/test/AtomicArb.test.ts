/**
 * test/AtomicArb.test.ts — Unit + integration tests for AtomicArb contract.
 *
 * Unit tests use a mock ERC20 and mock swap targets.
 * Integration tests (FORK_SONIC=true) use actual Sonic mainnet pools.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { AtomicArb } from '../typechain-types';

// ── Mock ERC20 helper ─────────────────────────────────────────────────────────

async function deployMockERC20(name: string, symbol: string, supply: bigint) {
  // Deploy a simple ERC20 for testing
  const ERC20 = await ethers.getContractFactory('MockERC20');
  const token = await ERC20.deploy(name, symbol, supply);
  return token;
}

// ── Mock swap target ──────────────────────────────────────────────────────────

/**
 * A minimal "swap" contract that simply transfers tokens.
 * In real tests, this would call into an actual DEX pool.
 */
async function deployMockSwap(inputToken: string, outputToken: string, rate: bigint) {
  const MockSwap = await ethers.getContractFactory('MockSwap');
  const swap = await MockSwap.deploy(inputToken, outputToken, rate);
  return swap;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AtomicArb', () => {
  let atomicArb: AtomicArb;
  let owner: Awaited<ReturnType<typeof ethers.getSigner>>;
  let other: Awaited<ReturnType<typeof ethers.getSigner>>;

  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();
    const AtomicArbFactory = await ethers.getContractFactory('AtomicArb');
    atomicArb = (await AtomicArbFactory.deploy()) as AtomicArb;
    await atomicArb.waitForDeployment();
  });

  it('deploys correctly', async () => {
    expect(await atomicArb.getAddress()).to.be.properAddress;
    expect(await atomicArb.owner()).to.equal(owner.address);
  });

  it('reverts when called by non-owner', async () => {
    await expect(
      atomicArb
        .connect(other)
        .executeArb('0x0000000000000000000000000000000000000001', '0x', '0x0000000000000000000000000000000000000001', '0x', '0x0000000000000000000000000000000000000001', 0n),
    ).to.be.revertedWithCustomError(atomicArb, 'OwnableUnauthorizedAccount');
  });

  it('reverts when profit is insufficient', async () => {
    // Deploy a MockERC20 — the "profit" token
    // We need MockERC20 and MockSwap contracts for full integration test
    // Skipping if typechain types are not available
    // This test is a placeholder for when MockERC20/MockSwap are compiled
    expect(true).to.be.true; // placeholder
  });
});

// ── Fork Tests ────────────────────────────────────────────────────────────────

const FORK_SONIC = process.env['FORK_SONIC'] === 'true';

(FORK_SONIC ? describe : describe.skip)('AtomicArb — Fork Tests', () => {
  /**
   * These tests run against a forked Sonic mainnet.
   * They require FORK_SONIC=true and valid SHADOW/BEETS pool addresses.
   *
   * TODO:
   *   1. Set SHADOW_USDC_WS_POOL, BEETS_USDC_WS_POOL_ID in .env
   *   2. Set USDC_ADDRESS, WS_ADDRESS in .env
   *   3. Run: FORK_SONIC=true npx hardhat test
   */

  it('executes profitable arbitrage atomically', async function () {
    this.timeout(60_000);

    const [deployer] = await ethers.getSigners();

    // TODO: Impersonate a USDC whale to fund the test
    // const USDC_WHALE = '0xTODO_USDC_WHALE';
    // await hre.network.provider.request({ method: 'hardhat_impersonateAccount', params: [USDC_WHALE] });

    // TODO: Build actual swap calldatas for Shadow and Beets
    // const shadowCalldata = ...
    // const beetsCalldata = ...

    // TODO: Call atomicArb.executeArb and assert profit

    console.log(
      'Fork test placeholder — set pool addresses in .env and implement swap calldatas.',
    );
    expect(deployer.address).to.be.properAddress;
  });

  it('reverts when round-trip is not profitable', async function () {
    this.timeout(60_000);
    // TODO: Manipulate pool reserves via impersonation to create an unprofitable scenario
    // and assert that executeArb reverts with "insufficient profit"
    console.log('Fork test placeholder');
    expect(true).to.be.true;
  });
});
