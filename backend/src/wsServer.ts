/**
 * wsServer.ts — WebSocket server for real-time communication with the React UI.
 *
 * Uses socket.io so the UI can use the official socket.io-client library.
 *
 * Events emitted to clients:
 *   'opportunity'     — New arb opportunity detected
 *   'trade'           — Trade record (success/failure/dry-run)
 *   'status'          — Bot status update (circuit breaker, daily P&L)
 *   'balance'         — Wallet balance update
 *   'config_update'   — Config changed
 *
 * Events received from clients:
 *   'set_config'      — Update runtime config (enable/disable auto-trade, etc.)
 *   'reset_breaker'   — Reset the circuit breaker
 *   'emergency_stop'  — Trip circuit breaker immediately
 *   'manual_execute'  — Manually execute a specific opportunity
 */

import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { logger } from './logger';
import type { RiskManager } from './riskManager';
import type { Executor } from './executor';
import type { BotConfig, WsMessage, ArbOpportunity, TradeRecord } from './types';

export class WsServer {
  private readonly io: SocketServer;
  private readonly riskManager: RiskManager;
  private readonly executor: Executor;

  constructor(httpServer: HttpServer, riskManager: RiskManager, executor: Executor) {
    this.riskManager = riskManager;
    this.executor = executor;

    this.io = new SocketServer(httpServer, {
      cors: {
        origin: process.env['UI_ORIGIN'] ?? 'http://localhost:3000',
        methods: ['GET', 'POST'],
      },
    });

    this.setupHandlers();
    logger.info('[WsServer] WebSocket server initialised');
  }

  // ── Outgoing broadcasts ────────────────────────────────────────────────────

  broadcastOpportunity(opp: ArbOpportunity): void {
    const msg: WsMessage<ArbOpportunity> = {
      type: 'opportunity',
      payload: opp,
      timestamp: Date.now(),
    };
    this.io.emit('opportunity', msg);
  }

  broadcastTrade(trade: TradeRecord): void {
    const msg: WsMessage<TradeRecord> = {
      type: 'trade',
      payload: trade,
      timestamp: Date.now(),
    };
    this.io.emit('trade', msg);
  }

  broadcastStatus(status: {
    autoTrade: boolean;
    circuitBreaker: boolean;
    dailyLossUsd: number;
    dryRun: boolean;
  }): void {
    const msg: WsMessage<typeof status> = {
      type: 'status',
      payload: status,
      timestamp: Date.now(),
    };
    this.io.emit('status', msg);
  }

  broadcastBalance(balanceUsd: number): void {
    const msg: WsMessage<{ balanceUsd: number }> = {
      type: 'balance',
      payload: { balanceUsd },
      timestamp: Date.now(),
    };
    this.io.emit('balance', msg);
  }

  broadcastRebalance(event: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    expectedOut: string;
    dex: string;
    dryRun: boolean;
  }): void {
    const msg: WsMessage<typeof event> = {
      type: 'rebalance',
      payload: event,
      timestamp: Date.now(),
    };
    this.io.emit('rebalance', msg);
  }

  // ── Incoming event handlers ────────────────────────────────────────────────

  private setupHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info({ socketId: socket.id }, '[WsServer] Client connected: %s', socket.id);

      // Send current config on connect
      socket.emit('config_update', {
        type: 'config_update',
        payload: this.riskManager.getConfig(),
        timestamp: Date.now(),
      });

      socket.on('set_config', (update: Partial<BotConfig>) => {
        logger.info({ socketId: socket.id, update }, '[WsServer] Config update from client');
        this.riskManager.updateConfig(update);
        // Broadcast updated config to all clients
        this.io.emit('config_update', {
          type: 'config_update',
          payload: this.riskManager.getConfig(),
          timestamp: Date.now(),
        });
      });

      socket.on('reset_breaker', () => {
        logger.info({ socketId: socket.id }, '[WsServer] Circuit breaker reset requested');
        this.riskManager.resetCircuitBreaker();
        this.broadcastStatus({
          autoTrade: this.riskManager.getConfig().autoTrade,
          circuitBreaker: false,
          dailyLossUsd: this.riskManager.getDailyLossUsd(),
          dryRun: this.riskManager.getConfig().dryRun,
        });
      });

      socket.on('emergency_stop', () => {
        logger.error({ socketId: socket.id }, '[WsServer] EMERGENCY STOP triggered by client!');
        this.riskManager.tripCircuitBreaker('Emergency stop from UI');
        this.broadcastStatus({
          autoTrade: false,
          circuitBreaker: true,
          dailyLossUsd: this.riskManager.getDailyLossUsd(),
          dryRun: this.riskManager.getConfig().dryRun,
        });
      });

      socket.on('manual_execute', async (opp: ArbOpportunity) => {
        logger.info(
          { socketId: socket.id, oppId: opp.id },
          '[WsServer] Manual execution requested for %s',
          opp.id,
        );
        try {
          const trade = await this.executor.execute(opp);
          this.broadcastTrade(trade);
        } catch (err) {
          logger.error({ err, oppId: opp.id }, '[WsServer] Manual execution failed');
          socket.emit('error', { message: String(err) });
        }
      });

      socket.on('disconnect', () => {
        logger.info({ socketId: socket.id }, '[WsServer] Client disconnected: %s', socket.id);
      });
    });
  }
}
