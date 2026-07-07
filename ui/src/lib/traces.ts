import { tempoSearch, tempoTrace } from './api'
import type { TempoSpan, TempoTrace } from './types'

export interface SessionTrace extends TempoTrace {
  sessionId: string
  startMs: number
  durationMs: number
  spans: (TempoSpan & { startMs: number; endMs: number; durMs: number })[]
}

// Fetch interaction traces over the range and group by session.id (Tempo doesn't
// index session.id for server-side filtering, so we fetch + filter client-side).
export async function fetchSessionTraces(start: number, end: number, sessionId: string, cap = 60): Promise<SessionTrace[]> {
  const summaries = await tempoSearch(`{ name = "claude_code.interaction" }`, start, end, 200)
  const traces = await Promise.allSettled(summaries.slice(0, cap).map(s => tempoTrace(s.traceID)))
  const matched: SessionTrace[] = []
  for (const r of traces) {
    if (r.status !== 'fulfilled') continue
    const t = r.value
    const root = t.spans.find(s => s.name === 'claude_code.interaction')
    const sid = root?.attributes['session.id'] as string | undefined
    if (sid !== sessionId) continue
    const startMs = parseInt(root?.startTimeUnixNano ?? '0') / 1e6
    const spans = t.spans.map(s => ({
      ...s,
      startMs: parseInt(s.startTimeUnixNano) / 1e6,
      endMs: parseInt(s.endTimeUnixNano) / 1e6,
      durMs: (parseInt(s.endTimeUnixNano) - parseInt(s.startTimeUnixNano)) / 1e6,
    }))
    matched.push({
      ...t,
      sessionId,
      startMs,
      durationMs: spans.find(s => s.name === 'claude_code.interaction')?.durMs ?? 0,
      spans,
    })
  }
  return matched.sort((a, b) => a.startMs - b.startMs)
}

export interface ToolAggregate {
  name: string
  count: number
  totalDurMs: number
  avgDurMs: number
  errors: number
}

export interface LlmError {
  traceId: string
  startMs: number
  model: string
  statusCode: string
  error: string
  attempt: string
  ttftMs: number
}

export interface SessionStats {
  turns: number
  toolAggregates: ToolAggregate[]
  llmErrors: LlmError[]
  ttftSamples: { model: string; ttft: number }[]
  ttftP50: number
  ttftP95: number
  blockedOnUserMs: number
  blockedDecisions: Record<string, number>
  llmByModel: Record<string, { calls: number; tokens: number; ttftSum: number }>
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(Math.ceil((p / 100) * sortedAsc.length) - 1, sortedAsc.length - 1)
  return sortedAsc[idx]
}

export interface TurnRow {
  traceId: string
  startMs: number
  durationMs: number
  toolCount: number
  llmCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  ttftMs: number
  errors: number
  spans: number
  models: Set<string>
}

export function computeTurnRows(traces: SessionTrace[]): TurnRow[] {
  return traces.map(t => {
    const root = t.spans.find(s => s.name === 'claude_code.interaction')
    let toolCount = 0, llmCalls = 0, inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, ttftMs = 0, errors = 0
    const models = new Set<string>()
    for (const s of t.spans) {
      if (s.name === 'claude_code.tool') toolCount++
      else if (s.name === 'claude_code.llm_request') {
        llmCalls++
        inputTokens += parseInt(String(s.attributes.input_tokens ?? 0))
        outputTokens += parseInt(String(s.attributes.output_tokens ?? 0))
        cacheReadTokens += parseInt(String(s.attributes.cache_read_tokens ?? s.attributes.cacheRead ?? 0))
        cacheCreationTokens += parseInt(String(s.attributes.cache_creation_tokens ?? s.attributes.cacheCreation ?? 0))
        const ttft = parseFloat(String(s.attributes.ttft_ms ?? 0))
        if (ttft && (ttftMs === 0 || ttft < ttftMs)) ttftMs = ttft
        const m = s.attributes.model as string | undefined
        if (m) models.add(m)
        if (s.attributes.success === false || s.attributes.error) errors++
      } else if (s.name === 'claude_code.tool.execution' && (s.attributes.success === false || s.attributes.error)) {
        errors++
      }
    }
    return {
      traceId: t.traceID,
      startMs: t.startMs,
      durationMs: root?.durMs ?? t.durationMs,
      toolCount,
      llmCalls,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      ttftMs,
      errors,
      spans: t.spans.length,
      models,
    }
  }).sort((a, b) => a.startMs - b.startMs)
}

export function computeStats(traces: SessionTrace[]): SessionStats {
  const tools = new Map<string, ToolAggregate>()
  const llmErrors: LlmError[] = []
  const ttftSamples: { model: string; ttft: number }[] = []
  const llmByModel: Record<string, { calls: number; tokens: number; ttftSum: number }> = {}
  let blockedOnUserMs = 0
  const blockedDecisions: Record<string, number> = {}

  for (const t of traces) {
    for (const s of t.spans) {
      if (s.name === 'claude_code.tool') {
        const name = (s.attributes.tool_name as string) || 'unknown'
        const cur = tools.get(name) ?? { name, count: 0, totalDurMs: 0, avgDurMs: 0, errors: 0 }
        cur.count++
        cur.totalDurMs += s.durMs
        tools.set(name, cur)
      } else if (s.name === 'claude_code.tool.execution') {
        const toolUseId = s.attributes.tool_use_id as string
        const parent = t.spans.find(p => p.name === 'claude_code.tool' && p.attributes.tool_use_id === toolUseId)
        const name = (parent?.attributes.tool_name as string) || 'unknown'
        const cur = tools.get(name)
        if (cur && (s.attributes.success === false || s.attributes.error)) cur.errors++
      } else if (s.name === 'claude_code.llm_request') {
        const model = (s.attributes.model as string) || 'unknown'
        const st = llmByModel[model] ?? { calls: 0, tokens: 0, ttftSum: 0 }
        st.calls++
        st.tokens += parseInt(String(s.attributes.input_tokens ?? 0)) + parseInt(String(s.attributes.output_tokens ?? 0))
        const ttft = parseFloat(String(s.attributes.ttft_ms ?? 0))
        if (ttft) st.ttftSum += ttft
        llmByModel[model] = st
        if (ttft) ttftSamples.push({ model, ttft })
        const success = s.attributes.success
        const status = String(s.attributes.status_code ?? '')
        if (success === false || (status && status !== '200')) {
          llmErrors.push({
            traceId: t.traceID,
            startMs: s.startMs,
            model,
            statusCode: status || '?',
            error: String(s.attributes.error ?? ''),
            attempt: String(s.attributes.attempt ?? '?'),
            ttftMs: ttft,
          })
        }
      } else if (s.name === 'claude_code.tool.blocked_on_user') {
        blockedOnUserMs += s.durMs
        const dec = (s.attributes.decision as string) || 'unknown'
        blockedDecisions[dec] = (blockedDecisions[dec] ?? 0) + 1
      }
    }
  }

  for (const v of tools.values()) v.avgDurMs = v.count ? v.totalDurMs / v.count : 0
  const ttftSorted = [...ttftSamples.map(s => s.ttft)].filter(v => v > 0).sort((a, b) => a - b)
  return {
    turns: traces.length,
    toolAggregates: Array.from(tools.values()).sort((a, b) => b.count - a.count),
    llmErrors: llmErrors.sort((a, b) => b.startMs - a.startMs),
    ttftSamples,
    ttftP50: percentile(ttftSorted, 50),
    ttftP95: percentile(ttftSorted, 95),
    blockedOnUserMs,
    blockedDecisions,
    llmByModel,
  }
}