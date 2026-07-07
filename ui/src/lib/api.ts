import type {
  PromResponse,
  PromSeries,
  TempoSpan,
  TempoTrace,
  TempoTraceSummary,
} from './types'

const PROXY = 'http://localhost:8090'
const PROM = 'http://localhost:9090'

// ── Prometheus ──────────────────────────────────────────────────────────────
export async function promQuery(query: string): Promise<PromSeries[]> {
  const url = `${PROM}/api/v1/query?query=${encodeURIComponent(query)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Prometheus ${r.status}`)
  const d: PromResponse = await r.json()
  return d.data?.result ?? []
}

export async function promRange(
  query: string,
  start: number,
  end: number,
  step: number,
): Promise<PromSeries[]> {
  const url =
    `${PROM}/api/v1/query_range?query=${encodeURIComponent(query)}` +
    `&start=${start}&end=${end}&step=${step}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Prometheus ${r.status}`)
  const d: PromResponse = await r.json()
  return d.data?.result ?? []
}

export function scalar(series: PromSeries[], fallback = 0): number {
  return parseFloat(series[0]?.value?.[1] ?? String(fallback)) || fallback
}

// ── Tempo (via CORS proxy) ──────────────────────────────────────────────────
export async function tempoSearch(
  query: string,
  start: number,
  end: number,
  limit = 50,
): Promise<TempoTraceSummary[]> {
  const url =
    `${PROXY}/tempo/api/search?q=${encodeURIComponent(query)}` +
    `&start=${start}&end=${end}&limit=${limit}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Tempo search ${r.status}`)
  const d = await r.json()
  return d.traces ?? []
}

export async function tempoTrace(traceID: string): Promise<TempoTrace> {
  const r = await fetch(`${PROXY}/tempo/api/traces/${traceID}`)
  if (!r.ok) throw new Error(`Tempo trace ${r.status}`)
  const d = await r.json()
  const spans: TempoSpan[] = []
  for (const b of d.batches ?? []) {
    for (const ss of b.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        const attrs: TempoSpan['attributes'] = {}
        for (const a of s.attributes ?? []) {
          const v = a.value
          if (v?.boolValue !== undefined) attrs[a.key] = v.boolValue === 'true' || v.boolValue === true
          else if (v?.stringValue !== undefined && v.stringValue !== null) attrs[a.key] = v.stringValue
          else if (v?.intValue) attrs[a.key] = parseInt(v.intValue)
          else if (v?.doubleValue) attrs[a.key] = parseFloat(v.doubleValue)
          else attrs[a.key] = undefined
        }
        spans.push({
          name: s.name,
          startTimeUnixNano: s.startTimeUnixNano,
          endTimeUnixNano: s.endTimeUnixNano,
          attributes: attrs,
        })
      }
    }
  }
  return { traceID, spans }
}

// Fetch full traces for a list of summaries in parallel (capped).
export async function tempoTraces(
  summaries: TempoTraceSummary[],
  cap = 30,
): Promise<TempoTrace[]> {
  const sliced = summaries.slice(0, cap)
  const results = await Promise.allSettled(sliced.map(s => tempoTrace(s.traceID)))
  return results
    .filter((r): r is PromiseFulfilledResult<TempoTrace> => r.status === 'fulfilled')
    .map(r => r.value)
}

// ── Loki (via CORS proxy) ───────────────────────────────────────────────────
export async function lokiQuery(
  query: string,
  start: number, // unix seconds
  end: number,
  limit = 100,
): Promise<{ ts: string; line: string }[][]> {
  // Loki wants nanosecond start/end.
  const url =
    `${PROXY}/loki/loki/api/v1/query_range?query=${encodeURIComponent(query)}` +
    `&start=${start}000000000&end=${end}000000000&limit=${limit}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Loki ${r.status}`)
  const d = await r.json()
  return (d.data?.result ?? []).map((s: { values?: [string, string][] }) =>
    (s.values ?? []).map(([ts, line]) => ({ ts, line })),
  )
}

// ── Phoenix GraphQL ──────────────────────────────────────────────────────────
export async function phoenixGql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const r = await fetch(`${PROXY}/phoenix/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!r.ok) throw new Error(`Phoenix ${r.status}`)
  const d = await r.json()
  if (d.errors) throw new Error(`Phoenix GraphQL: ${JSON.stringify(d.errors)}`)
  return d.data as T
}

// ── Formatting ────────────────────────────────────────────────────────────────
export const fmtNum = (n: number): string => {
  if (!isFinite(n)) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(0)
}
export const fmtUSD = (n: number): string => (n ? '$' + n.toFixed(2) : '$0.00')
export const fmtPct = (n: number): string => (n ? (n * 100).toFixed(1) + '%' : '0%')
export const fmtDur = (s: number): string => {
  if (s >= 3600) return (s / 3600).toFixed(1) + 'h'
  if (s >= 60) return (s / 60).toFixed(0) + 'm'
  return (s ?? 0).toFixed(0) + 's'
}
export const fmtMs = (n: number): string => (n ? n.toFixed(0) + 'ms' : '0ms')
export const fmtBytes = (n: number): string => {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'MB'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'KB'
  return n + 'B'
}
export const shortSid = (sid: string): string => sid?.slice(0, 8) ?? '?'
// Claude Code ships context-window suffixes like "claude-opus-4-8[1m]".
export const cleanModel = (m: string): string => (m ?? '').replace(/\[.*\]$/, '')

export const TOOL_COLORS: Record<string, string> = {
  Read: '#2a78d6', Bash: '#1baf7a', Edit: '#eda100', Grep: '#008300',
  Write: '#4a3aa7', Glob: '#e34948', WebFetch: '#e87ba4', WebSearch: '#eb6834',
  Skill: '#a371f7', Task: '#db6d28', Agent: '#58a6ff',
}
export const toolColor = (name: string): string => TOOL_COLORS[name] || '#8a8a86'

export const SPAN_COLORS: Record<string, string> = {
  'claude_code.interaction': '#8b949e',
  'claude_code.llm_request': '#58a6ff',
  'claude_code.tool': '#3fb950',
  'claude_code.tool.execution': '#1baf7a',
  'claude_code.tool.blocked_on_user': '#f85149',
}
export const spanColor = (name: string): string => SPAN_COLORS[name] || '#8a8a86'

export const TOKEN_COLORS: Record<string, string> = {
  input: '#2a78d6', output: '#1baf7a', cacheRead: '#eda100', cacheCreation: '#008300',
}