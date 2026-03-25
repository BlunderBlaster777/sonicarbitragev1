/**
 * db/index.ts — PostgreSQL database connection and trade persistence.
 *
 * SCHEMA (run db/migrations/001_init.sql to create tables):
 *   trades — records of all attempted and confirmed arbitrage trades.
 *
 * SETUP:
 *   1. Start Postgres: docker-compose up -d postgres
 *   2. Run migrations: npx ts-node src/db/migrate.ts
 */

import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../logger';
import type { TradeRecord } from '../types';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.dbUrl });
    pool.on('error', (err) => {
      logger.error({ err }, '[DB] Unexpected pool error');
    });
  }
  return pool;
}

export async function insertTrade(trade: TradeRecord): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO trades (
      id, opportunity_id, pair, direction, amount_in, amount_out,
      net_profit_usd, tx_hash, gas_used, gas_cost_usd, status,
      dry_run, created_at, confirmed_at, failure_reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      tx_hash = EXCLUDED.tx_hash,
      confirmed_at = EXCLUDED.confirmed_at,
      failure_reason = EXCLUDED.failure_reason`,
    [
      trade.id,
      trade.opportunityId,
      trade.pair,
      trade.direction,
      trade.amountIn,
      trade.amountOut,
      trade.netProfitUsd,
      trade.txHash ?? null,
      trade.gasUsed ?? null,
      trade.gasCostUsd ?? null,
      trade.status,
      trade.dryRun,
      trade.createdAt,
      trade.confirmedAt ?? null,
      trade.failureReason ?? null,
    ],
  );
  logger.debug({ tradeId: trade.id }, '[DB] Trade persisted: %s', trade.id);
}

export async function getTrades(limit = 100): Promise<TradeRecord[]> {
  const db = getDb();
  const res = await db.query(
    `SELECT * FROM trades ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return res.rows as TradeRecord[];
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
