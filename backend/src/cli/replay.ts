/**
 * cli/replay.ts — Replay historical arbitrage opportunities from DB.
 *
 * Usage:
 *   npx ts-node src/cli/replay.ts --limit 10
 *
 * Fetches the most recent trades from Postgres and re-simulates them
 * using current chain state. Useful for debugging and backtesting.
 */

import { getTrades } from '../db';
import { validateConfig } from '../config';

async function main() {
  validateConfig();

  const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : 10;

  console.log(`\n=== Sonic Arb Bot — Replay Mode (last ${limit} trades) ===\n`);

  const trades = await getTrades(limit);

  if (trades.length === 0) {
    console.log('No trades found in the database.');
    return;
  }

  for (const trade of trades) {
    console.log(`─── Trade ${trade.id} ───────────────────────────────`);
    console.log(`  Pair:         ${trade.pair}`);
    console.log(`  Direction:    ${trade.direction}`);
    console.log(`  Status:       ${trade.status}`);
    console.log(`  Tx Hash:      ${trade.txHash ?? 'N/A'}`);
    console.log(`  Net Profit:   $${trade.netProfitUsd.toFixed(4)}`);
    console.log(`  Created At:   ${trade.createdAt}`);
    if (trade.failureReason) console.log(`  Failure:      ${trade.failureReason}`);
    console.log();
  }
}

main().catch((err) => {
  console.error('[replay] Fatal error:', err);
  process.exit(1);
});
