/**
 * scripts/deploy.ts — Deploy the AtomicArb helper contract.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network localhost
 *   npx hardhat run scripts/deploy.ts --network sonic
 */

import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying AtomicArb with account: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} S`);

  const AtomicArb = await ethers.getContractFactory('AtomicArb');
  const contract = await AtomicArb.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`✅ AtomicArb deployed to: ${address}`);
  console.log(`Add to your .env: ATOMIC_HELPER_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
