/**
 * hardhat.config.ts — Hardhat configuration for Sonic chain fork testing.
 *
 * USAGE:
 *   npx hardhat compile                   — Compile contracts
 *   npx hardhat test                      — Run unit tests (no fork)
 *   FORK_SONIC=true npx hardhat test      — Run fork tests against Sonic mainnet
 *   npx hardhat node --fork https://rpc.soniclabs.com — Start local fork
 *
 * Fork RPC can also be set via SONIC_FORK_RPC env var.
 */

import * as dotenv from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

dotenv.config({ path: '../.env' });

const SONIC_RPC = process.env['SONIC_FORK_RPC'] ?? 'https://rpc.soniclabs.com';
const FORK_ENABLED = process.env['FORK_SONIC'] === 'true';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 146, // Sonic chain ID
      forking: FORK_ENABLED
        ? {
            url: SONIC_RPC,
            // Pin a specific block for deterministic tests (update periodically)
            // blockNumber: 12345678,
          }
        : undefined,
      allowUnlimitedContractSize: true,
    },
    sonic: {
      url: SONIC_RPC,
      chainId: 146,
      accounts: process.env['PRIVATE_KEY'] ? [process.env['PRIVATE_KEY']] : [],
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 146,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
