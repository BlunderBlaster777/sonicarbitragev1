/**
 * metrics.ts — Prometheus metrics for the arbitrage bot.
 *
 * Exposes the following metrics on /metrics endpoint:
 *   arb_opportunities_total  — Counter: total opportunities detected
 *   arb_executed_total       — Counter: total trades executed (success)
 *   arb_failed_total         — Counter: total trades failed (simulation or on-chain)
 *   last_profit_usd          — Gauge: net profit of the last executed trade
 *   wallet_balance_usd       — Gauge: current wallet balance in USD
 *   scan_duration_ms         — Histogram: time to scan a full round of DEX pairs
 *
 * USAGE:
 *   import { metrics } from './metrics';
 *   metrics.opportunitiesTotal.inc();
 */

import { Registry, Counter, Gauge, Histogram } from 'prom-client';

// Create a separate registry so we don't pollute default metrics
export const metricsRegistry = new Registry();

metricsRegistry.setDefaultLabels({ service: 'sonic-arb-bot' });

export const metrics = {
  opportunitiesTotal: new Counter({
    name: 'arb_opportunities_total',
    help: 'Total number of arbitrage opportunities detected',
    registers: [metricsRegistry],
  }),

  executedTotal: new Counter({
    name: 'arb_executed_total',
    help: 'Total number of arbitrage trades executed successfully',
    labelNames: ['pair', 'direction'],
    registers: [metricsRegistry],
  }),

  failedTotal: new Counter({
    name: 'arb_failed_total',
    help: 'Total number of arbitrage trades that failed (simulation or on-chain)',
    labelNames: ['reason'],
    registers: [metricsRegistry],
  }),

  lastProfitUsd: new Gauge({
    name: 'last_profit_usd',
    help: 'Net profit in USD of the last executed arbitrage trade',
    registers: [metricsRegistry],
  }),

  walletBalanceUsd: new Gauge({
    name: 'wallet_balance_usd',
    help: 'Current estimated wallet balance in USD',
    registers: [metricsRegistry],
  }),

  scanDurationMs: new Histogram({
    name: 'scan_duration_ms',
    help: 'Time in milliseconds to complete one scan of all DEX pairs',
    buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
    registers: [metricsRegistry],
  }),

  rpcErrors: new Counter({
    name: 'rpc_errors_total',
    help: 'Total number of RPC errors by provider URL',
    labelNames: ['url'],
    registers: [metricsRegistry],
  }),
};
