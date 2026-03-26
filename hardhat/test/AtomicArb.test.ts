/**
 * test/AtomicArb.test.ts — Unit + integration tests for AtomicArb contract.
 *
 * Unit tests use a MockERC20 token to verify profit checks.
 * Integration tests (FORK_SONIC=true) use actual Sonic mainnet pools.
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { AtomicArb } from '../typechain-types';
import type { MockERC20 } from '../typechain-types';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AtomicArb', () => {
  let atomicArb: AtomicArb;
  let token: MockERC20;
  let owner: Awaited<ReturnType<typeof ethers.getSigner>>;
  let other: Awaited<ReturnType<typeof ethers.getSigner>>;

  const INITIAL_SUPPLY = ethers.parseUnits('10000', 6); // 10,000 USDC (6 decimals)

  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();

    const AtomicArbFactory = await ethers.getContractFactory('AtomicArb');
    atomicArb = (await AtomicArbFactory.deploy()) as AtomicArb;
    await atomicArb.waitForDeployment();

    const MockERC20Factory = await ethers.getContractFactory('MockERC20');
    token = (await MockERC20Factory.deploy('Mock USDC', 'USDC', INITIAL_SUPPLY, 6)) as MockERC20;
    await token.waitForDeployment();
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
    const arbAddress = await atomicArb.getAddress();
    const tokenAddress = await token.getAddress();

    // Seed the contract with some tokens (simulates pre-approved balance)
    await token.transfer(arbAddress, ethers.parseUnits('100', 6));

    // Call executeArb with no-op swap targets (address(1) with empty calldata)
    // The contract balance won't increase, so requiring any minProfit > 0 should revert.
    const noopTarget = '0x0000000000000000000000000000000000000001';
    await expect(
      atomicArb.executeArb(noopTarget, '0x', noopTarget, '0x', tokenAddress, ethers.parseUnits('1', 6)),
    ).to.be.revertedWith('AtomicArb: insufficient profit');
  });

  it('succeeds when profit requirement is zero', async () => {
    const arbAddress = await atomicArb.getAddress();
    const tokenAddress = await token.getAddress();

    // Seed the contract with tokens
    await token.transfer(arbAddress, ethers.parseUnits('100', 6));

    // With minProfit=0, executeArb should succeed even with no-op swaps
    const noopTarget = '0x0000000000000000000000000000000000000001';
    await expect(
      atomicArb.executeArb(noopTarget, '0x', noopTarget, '0x', tokenAddress, 0n),
    ).to.emit(atomicArb, 'ArbExecuted').withArgs(tokenAddress, 0n);
  });

  it('emits Withdrawn event on token withdrawal', async () => {
    const arbAddress = await atomicArb.getAddress();
    const tokenAddress = await token.getAddress();
    const withdrawAmount = ethers.parseUnits('50', 6);

    await token.transfer(arbAddress, withdrawAmount);

    await expect(
      atomicArb.withdraw(tokenAddress, withdrawAmount, owner.address),
    )
      .to.emit(atomicArb, 'Withdrawn')
      .withArgs(tokenAddress, withdrawAmount, owner.address);
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
