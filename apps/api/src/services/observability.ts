import { createLogger, createMetricsRegistry } from '@parker/observability'

export const logger = createLogger({ service: 'api' })
export const metrics = createMetricsRegistry()

// Core requested metrics
export const mintLatencyMs = metrics.histogram(
  'hedera_mint_latency_ms',
  'Latency of Hedera NFT mint operations',
  'ms',
)
export const burnLatencyMs = metrics.histogram(
  'hedera_burn_latency_ms',
  'Latency of Hedera NFT burn operations',
  'ms',
)
export const mirrorLagSeconds = metrics.histogram(
  'hedera_mirror_lag_seconds',
  'Observed lag between current time and NFT entryTime from Mirror Node',
  'seconds',
)
export const failedExitsTotal = metrics.counter(
  'failed_exits_total',
  'Count of failed gate exit responses',
)
export const paymentFailuresTotal = metrics.counter(
  'payment_failures_total',
  'Count of payment failures (x402/stripe/webhook)',
)
