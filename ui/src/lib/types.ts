// Telemetry types — built against the verified live schema (probe 2026-07-05).

export type TokenType = 'input' | 'output' | 'cacheRead' | 'cacheCreation'
export type StartType = 'fresh' | 'resume' | 'continue'

export interface PromSeries {
  metric: Record<string, string>
  value?: [number, string]
  values?: [number, string][]
}

export interface PromResponse<T = PromSeries> {
  status: string
  data: { resultType: string; result: T[] }
}

export interface TempoTraceSummary {
  traceID: string
  rootServiceName: string
  rootTraceName: string
  startTimeUnixNano: string
  durationMs: number
  spanSet?: { spans: TempoSpanSummary[] }
}

export interface TempoSpanSummary {
  spanID: string
  name: string
  startTimeUnixNano: string
  durationNanos: string
}

export interface TempoSpan {
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Record<string, string | number | boolean | undefined>
}

export interface TempoTrace {
  traceID: string
  spans: TempoSpan[]
}

export type SpanType =
  | 'claude_code.interaction'
  | 'claude_code.llm_request'
  | 'claude_code.tool'
  | 'claude_code.tool.execution'
  | 'claude_code.tool.blocked_on_user'

export interface SessionRow {
  sessionId: string
  terminalType: string
  userEmail?: string
  userId?: string
  cost: number
  tokens: number
  cacheHit: number
  activeTime: number
  modelMix: { model: string; tokens: number }[]
  startType: StartType
  lastSeen: number
}

export interface TimeRange {
  start: number // unix seconds
  end: number
  label: string
}