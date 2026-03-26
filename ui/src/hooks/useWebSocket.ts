/**
 * hooks/useWebSocket.ts — Socket.io client hook for real-time backend updates.
 *
 * Connects to the backend WebSocket server and dispatches events
 * into the component state via callbacks.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ArbOpportunity,
  BotConfig,
  BotStatus,
  TradeRecord,
  WsMessage,
} from '../lib/types';

const BACKEND_URL = import.meta.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001';

export interface UseWebSocketOptions {
  onOpportunity?: (opp: ArbOpportunity) => void;
  onTrade?: (trade: TradeRecord) => void;
  onStatus?: (status: BotStatus) => void;
  onBalance?: (balanceUsd: number) => void;
  onConfig?: (config: BotConfig) => void;
}

export interface UseWebSocketReturn {
  connected: boolean;
  setConfig: (update: Partial<BotConfig>) => void;
  resetBreaker: () => void;
  emergencyStop: () => void;
  manualExecute: (opp: ArbOpportunity) => void;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(BACKEND_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('opportunity', (msg: WsMessage<ArbOpportunity>) => {
      options.onOpportunity?.(msg.payload);
    });

    socket.on('trade', (msg: WsMessage<TradeRecord>) => {
      options.onTrade?.(msg.payload);
    });

    socket.on('status', (msg: WsMessage<BotStatus>) => {
      options.onStatus?.(msg.payload);
    });

    socket.on('balance', (msg: WsMessage<{ balanceUsd: number }>) => {
      options.onBalance?.(msg.payload.balanceUsd);
    });

    socket.on('config_update', (msg: WsMessage<BotConfig>) => {
      options.onConfig?.(msg.payload);
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setConfig = useCallback((update: Partial<BotConfig>) => {
    socketRef.current?.emit('set_config', update);
  }, []);

  const resetBreaker = useCallback(() => {
    socketRef.current?.emit('reset_breaker');
  }, []);

  const emergencyStop = useCallback(() => {
    socketRef.current?.emit('emergency_stop');
  }, []);

  const manualExecute = useCallback((opp: ArbOpportunity) => {
    socketRef.current?.emit('manual_execute', opp);
  }, []);

  return { connected, setConfig, resetBreaker, emergencyStop, manualExecute };
}
