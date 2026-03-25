-- migrations/001_init.sql
-- Run this once to initialise the database schema.
-- Usage: psql $DB_URL -f src/db/migrations/001_init.sql

CREATE TABLE IF NOT EXISTS trades (
  id                VARCHAR(64) PRIMARY KEY,
  opportunity_id    VARCHAR(64) NOT NULL,
  pair              VARCHAR(32) NOT NULL,
  direction         VARCHAR(32) NOT NULL,
  amount_in         NUMERIC     NOT NULL,
  amount_out        NUMERIC     NOT NULL,
  net_profit_usd    DOUBLE PRECISION NOT NULL,
  tx_hash           VARCHAR(66),
  gas_used          NUMERIC,
  gas_cost_usd      DOUBLE PRECISION,
  status            VARCHAR(32) NOT NULL,
  dry_run           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  failure_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_status     ON trades (status);
CREATE INDEX IF NOT EXISTS idx_trades_pair       ON trades (pair);
