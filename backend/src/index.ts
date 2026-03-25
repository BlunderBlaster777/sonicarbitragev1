/**
 * index.ts — Main entry point for the Sonic Arbitrage Bot backend.
 *
 * Startup sequence:
 *   1. Validate configuration.
 *   2. Initialise RPC manager, adapters, core engine modules.
 *   3. Start HTTP server (health check + Prometheus metrics).
 *   4. Start WebSocket server.
 *   5. Start the main scan loop.
 */

import http from 'http';
import express from 'express';
import { validateConfig, config } from './config';
import { logger } from './logger';
import { RpcManager } from './rpcManager';
import { ShadowAdapter } from './poolAdapters/ShadowAdapter';
import { BeetsAdapter } from './poolAdapters/BeetsAdapter';
import { ArbFinder } from './arbFinder';
import { RiskManager } from './riskManager';
import { Simulator } from './simulator';
import { NonceManager } from './nonceManager';
import { Executor } from './executor';
import { WsServer } from './wsServer';
import { metrics, metricsRegistry } from './metrics';
import { insertTrade } from './db';

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Validate config
  validateConfig();
  logger.info({ config: { chainId: config.chainId, dryRun: config.dryRun } }, '[main] Starting Sonic Arb Bot');

  // 2. Initialise modules
  const rpc = new RpcManager(config.rpcUrls);
  const shadow = new ShadowAdapter(rpc);
  const beets = new BeetsAdapter(rpc);
  const arbFinder = new ArbFinder(shadow, beets, rpc);
  const riskManager = new RiskManager();
  const simulator = new Simulator(rpc);

  // Initialise Redis (optional)
  let redis = null;
  try {
    const Redis = (await import('ioredis')).default;
    redis = new Redis(config.redisUrl);
    await redis.ping();
    logger.info('[main] Redis connected');
  } catch {
    logger.warn('[main] Redis unavailable — falling back to in-memory nonce management');
  }

  const signerAddr = process.env['WALLET_ADDRESS'] ?? '0x0000000000000000000000000000000000000001';
  const nonceManager = new NonceManager(rpc.getProvider(), signerAddr, redis);
  const executor = new Executor(rpc, shadow, beets, simulator, nonceManager);

  // 3. HTTP server
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      chainId: config.chainId,
      dryRun: config.dryRun,
      circuitBreaker: riskManager.isCircuitBreakerTripped(),
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  });

  app.get('/trades', async (_req, res) => {
    const { getTrades } = await import('./db');
    const trades = await getTrades(50).catch(() => []);
    res.json(trades);
  });

  const httpServer = http.createServer(app);

  // 4. WebSocket server
  const wsServer = new WsServer(httpServer, riskManager, executor);

  httpServer.listen(config.httpPort, () => {
    logger.info('[main] HTTP server listening on port %d', config.httpPort);
  });

  // 5. Main scan loop
  let walletBalanceUsd = 0;
  const updateWalletBalance = async () => {
    try {
      // TODO: replace with real USDC balance lookup
      walletBalanceUsd = 10_000; // placeholder
      metrics.walletBalanceUsd.set(walletBalanceUsd);
      wsServer.broadcastBalance(walletBalanceUsd);
    } catch (err) {
      logger.warn({ err }, '[main] Failed to fetch wallet balance');
    }
  };

  const scanLoop = async () => {
    const end = metrics.scanDurationMs.startTimer();
    try {
      const opportunities = await arbFinder.findOpportunities(walletBalanceUsd);

      for (const opp of opportunities) {
        metrics.opportunitiesTotal.inc();
        wsServer.broadcastOpportunity(opp);

        const riskCheck = riskManager.check(opp, walletBalanceUsd);
        if (!riskCheck.approved) {
          logger.debug({ reason: riskCheck.reason }, '[main] Opportunity rejected by risk manager');
          continue;
        }

        const trade = await executor.execute(opp);
        riskManager.recordTrade(trade.netProfitUsd);

        if (trade.status === 'confirmed' || trade.status === 'simulated_only') {
          metrics.executedTotal.inc({ pair: opp.pair, direction: opp.direction });
          metrics.lastProfitUsd.set(trade.netProfitUsd);
        } else {
          metrics.failedTotal.inc({ reason: trade.failureReason ?? 'unknown' });
        }

        wsServer.broadcastTrade(trade);
        await insertTrade(trade).catch((err) =>
          logger.warn({ err }, '[main] Failed to persist trade'),
        );
      }

      wsServer.broadcastStatus({
        autoTrade: riskManager.getConfig().autoTrade,
        circuitBreaker: riskManager.isCircuitBreakerTripped(),
        dailyLossUsd: riskManager.getDailyLossUsd(),
        dryRun: config.dryRun,
      });
    } catch (err) {
      logger.error({ err }, '[main] Scan loop error');
    } finally {
      end();
    }
  };

  await updateWalletBalance();

  // Stagger wallet balance updates at 30s intervals
  setInterval(() => void updateWalletBalance(), 30_000);

  // Main scan loop
  const runLoop = async () => {
    await scanLoop();
    setTimeout(() => void runLoop(), config.scanIntervalMs);
  };
  void runLoop();

  logger.info(
    '[main] Bot started. dryRun=%s, scanInterval=%dms',
    config.dryRun,
    config.scanIntervalMs,
  );

  // Graceful shutdown
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
      logger.info('[main] Shutting down...');
      httpServer.close();
      if (redis) await redis.quit();
      const { closeDb } = await import('./db');
      await closeDb();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.fatal({ err }, '[main] Fatal startup error');
  process.exit(1);
});
