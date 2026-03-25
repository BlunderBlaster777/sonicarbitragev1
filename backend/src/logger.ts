/**
 * logger.ts — Structured JSON logger using Pino.
 *
 * All modules should import `logger` from here rather than using console.log.
 * In production (LOG_FORMAT=json) output is newline-delimited JSON suitable
 * for Loki / CloudWatch / Datadog ingestion.
 * In development (LOG_FORMAT=pretty) output is human-readable with colours.
 */

import pino from 'pino';
import { config } from './config';

const transport =
  config.logFormat === 'pretty'
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined;

export const logger = pino(
  {
    level: config.logLevel || 'info',
    base: { service: 'sonic-arb-bot' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);
