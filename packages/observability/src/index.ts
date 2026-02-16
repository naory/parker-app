type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogFields = Record<string, unknown>

function serializeError(err: unknown): LogFields {
  if (!(err instanceof Error)) return { error: String(err) }
  return {
    error_name: err.name,
    error_message: err.message,
    error_stack: err.stack,
  }
}

export class StructuredLogger {
  constructor(private readonly baseFields: LogFields = {}) {}

  child(fields: LogFields): StructuredLogger {
    return new StructuredLogger({ ...this.baseFields, ...fields })
  }

  private emit(level: LogLevel, message: string, fields?: LogFields, err?: unknown) {
    const payload: LogFields = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...this.baseFields,
      ...(fields || {}),
      ...(err ? serializeError(err) : {}),
    }
    // JSON lines for machine parsing in log pipelines.
    console.log(JSON.stringify(payload))
  }

  debug(message: string, fields?: LogFields) { this.emit('debug', message, fields) }
  info(message: string, fields?: LogFields) { this.emit('info', message, fields) }
  warn(message: string, fields?: LogFields, err?: unknown) { this.emit('warn', message, fields, err) }
  error(message: string, fields?: LogFields, err?: unknown) { this.emit('error', message, fields, err) }
}

export function createLogger(baseFields: LogFields = {}): StructuredLogger {
  return new StructuredLogger(baseFields)
}

function labelsKey(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return ''
  return Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(',')
}

export class Counter {
  private values = new Map<string, number>()
  constructor(public readonly name: string, public readonly help: string) {}

  inc(labels?: Record<string, string>, value = 1) {
    const key = labelsKey(labels)
    this.values.set(key, (this.values.get(key) || 0) + value)
  }

  snapshot(): Array<{ labels: Record<string, string>; value: number }> {
    return Array.from(this.values.entries()).map(([k, value]) => ({
      labels: k
        ? Object.fromEntries(k.split(',').map((pair) => pair.split('=')))
        : {},
      value,
    }))
  }
}

export class Histogram {
  private values = new Map<string, { count: number; sum: number; min: number; max: number }>()
  constructor(public readonly name: string, public readonly help: string, public readonly unit = 'ms') {}

  observe(value: number, labels?: Record<string, string>) {
    const key = labelsKey(labels)
    const current = this.values.get(key) || { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
    current.count += 1
    current.sum += value
    current.min = Math.min(current.min, value)
    current.max = Math.max(current.max, value)
    this.values.set(key, current)
  }

  snapshot(): Array<{
    labels: Record<string, string>
    count: number
    sum: number
    avg: number
    min: number
    max: number
    unit: string
  }> {
    return Array.from(this.values.entries()).map(([k, v]) => ({
      labels: k
        ? Object.fromEntries(k.split(',').map((pair) => pair.split('=')))
        : {},
      count: v.count,
      sum: v.sum,
      avg: v.count > 0 ? v.sum / v.count : 0,
      min: v.count > 0 ? v.min : 0,
      max: v.count > 0 ? v.max : 0,
      unit: this.unit,
    }))
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>()
  private histograms = new Map<string, Histogram>()

  counter(name: string, help: string): Counter {
    const existing = this.counters.get(name)
    if (existing) return existing
    const c = new Counter(name, help)
    this.counters.set(name, c)
    return c
  }

  histogram(name: string, help: string, unit = 'ms'): Histogram {
    const existing = this.histograms.get(name)
    if (existing) return existing
    const h = new Histogram(name, help, unit)
    this.histograms.set(name, h)
    return h
  }

  asJson() {
    return {
      counters: Array.from(this.counters.values()).map((c) => ({
        name: c.name,
        help: c.help,
        series: c.snapshot(),
      })),
      histograms: Array.from(this.histograms.values()).map((h) => ({
        name: h.name,
        help: h.help,
        series: h.snapshot(),
      })),
    }
  }
}

export function createMetricsRegistry(): MetricsRegistry {
  return new MetricsRegistry()
}
