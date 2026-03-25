/**
 * cli/simulate.ts — CLI tool to simulate a single arbitrage trade.
 *
 * Usage:
 *   npx ts-node src/cli/simulate.ts --pair USDC/WS --amount 1000
 *
 * Prints a detailed breakdown: fees, slippage, gas cost, and net profit.
 * Does NOT broadcast any transactions.
 */

import { RpcManager } from '../rpcManager';
import { ShadowAdapter } from '../poolAdapters/ShadowAdapter';
import { BeetsAdapter } from '../poolAdapters/BeetsAdapter';
import { ArbFinder } from '../arbFinder';
import { config, validateConfig } from '../config';

async function main() {
  validateConfig();

  const amountArg = process.argv.find((a) => a.startsWith('--amount='))?.split('=')[1];
  const walletBalance = amountArg ? parseFloat(amountArg) : 10_000;

  const rpc = new RpcManager(config.rpcUrls);
  const shadow = new ShadowAdapter(rpc);
  const beets = new BeetsAdapter(rpc);
  const arbFinder = new ArbFinder(shadow, beets, rpc);

  console.log(`\n=== Sonic Arb Bot — Simulation Mode ===`);
  console.log(`Chain: ${config.chainId} | Wallet: $${walletBalance} | DRY RUN`);
  console.log('Scanning for opportunities...\n');

  const opportunities = await arbFinder.findOpportunities(walletBalance);

  if (opportunities.length === 0) {
    console.log('No profitable opportunities found at this time.');
    return;
  }

  for (const opp of opportunities) {
    console.log(`─── Opportunity ${opp.id} ───────────────────────────────`);
    console.log(`  Pair:         ${opp.pair}`);
    console.log(`  Direction:    ${opp.direction}`);
    console.log(`  Buy on:       ${opp.buyDex}`);
    console.log(`  Sell on:      ${opp.sellDex}`);
    console.log(`  Amount In:    ${(Number(opp.amountIn) / 1e6).toFixed(2)} USDC`);
    console.log(`  Mid Amount:   ${(Number(opp.midAmount) / 1e18).toFixed(6)} WS`);
    console.log(`  Amount Out:   ${(Number(opp.amountOut) / 1e6).toFixed(6)} USDC`);
    console.log(`  Gross Profit: ${(Number(opp.grossProfit) / 1e6).toFixed(6)} USDC`);
    console.log(`  Gas Cost:     $${opp.gasCostUsd.toFixed(4)}`);
    console.log(`  Net Profit:   $${opp.netProfitUsd.toFixed(4)}`);
    console.log(`  Buy Slippage: ${(opp.buyQuote.priceImpact * 100).toFixed(4)}%`);
    console.log(`  Sell Slippage:${(opp.sellQuote.priceImpact * 100).toFixed(4)}%`);
    console.log();
  }
}

main().catch((err) => {
  console.error('[simulate] Fatal error:', err);
  process.exit(1);
});
