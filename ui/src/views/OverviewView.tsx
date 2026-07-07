import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle, Kpi, Spinner, ErrorState, EmptyState } from '@/components/ui'
import { useTimeRange, rangeSelector, stepFor } from '@/lib/time'
import { promQuery, scalar, fmtUSD, fmtNum, fmtPct, fmtDur } from '@/lib/api'
import {
  fetchTokenFlow,
  fetchCostByModel,
  fetchModelDonut,
  fetchSessionStarts,
} from '@/lib/chart-queries'
import {
  TokenFlowChart,
  CostByModelChart,
  ModelDonut,
  SessionStartsChart,
} from '@/components/charts'
import { AttributionChart } from '@/components/AttributionChart'
import { TopSessionsCard, ModelsTableCard } from '@/components/OverviewCards'

function useOverviewKpis() {
  const { range } = useTimeRange()
  const sel = rangeSelector(range)
  return useQuery({
    queryKey: ['overview-kpis', range.start, range.end],
    queryFn: async () => {
      const [cost, tokens, cacheRead, allTokens, sessions, activeTime, sessionStarts, burn1h] = await Promise.all([
        promQuery(`sum(increase(claude_code_cost_usage_USD_total[${sel}]))`),
        promQuery(`sum(increase(claude_code_token_usage_tokens_total[${sel}]))`),
        promQuery(`sum(increase(claude_code_token_usage_tokens_total{type="cacheRead"}[${sel}]))`),
        promQuery(`sum(increase(claude_code_token_usage_tokens_total[${sel}]))`),
        promQuery(`count(count by(session_id)(claude_code_token_usage_tokens_total))`),
        promQuery(`sum(increase(claude_code_active_time_seconds_total[${sel}]))`),
        promQuery(`sum(increase(claude_code_session_count_total[${sel}]))`),
        promQuery(`sum(increase(claude_code_cost_usage_USD_total[1h]))`),
      ])
      return {
        cost: scalar(cost),
        tokens: scalar(tokens),
        cacheHit: scalar(cacheRead) / (scalar(allTokens) || 1),
        sessions: scalar(sessions),
        activeTime: scalar(activeTime),
        sessionStarts: scalar(sessionStarts),
        burn1h: scalar(burn1h),
      }
    },
    staleTime: 30_000,
  })
}

// Reduce a PromSeries[] (range) into a single sparkline array by summing all
// series per timestamp. Returns [] when no data.
function toSparkline(series: { values?: [number, string][] }[] | undefined): number[] {
  if (!series || series.length === 0) return []
  const byTs = new Map<number, number>()
  for (const s of series) {
    for (const [ts, v] of s.values ?? []) {
      byTs.set(ts, (byTs.get(ts) ?? 0) + (parseFloat(v) || 0))
    }
  }
  return Array.from(byTs.entries()).sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

// Ratio sparkline (e.g. cache hit): numerator / denominator per timestamp.
function toRatioSparkline(
  num: { values?: [number, string][] }[] | undefined,
  den: { values?: [number, string][] }[] | undefined,
): number[] {
  const numTs = new Map<number, number>()
  for (const s of num ?? []) for (const [ts, v] of s.values ?? []) numTs.set(ts, (numTs.get(ts) ?? 0) + (parseFloat(v) || 0))
  const denTs = new Map<number, number>()
  for (const s of den ?? []) for (const [ts, v] of s.values ?? []) denTs.set(ts, (denTs.get(ts) ?? 0) + (parseFloat(v) || 0))
  const ts = Array.from(new Set([...numTs.keys(), ...denTs.keys()])).sort((a, b) => a - b)
  return ts.map(t => {
    const d = denTs.get(t) ?? 0
    return d ? (numTs.get(t) ?? 0) / d : 0
  })
}

export function OverviewView() {
  const { range } = useTimeRange()
  const step = stepFor(range)
  const kpis = useOverviewKpis()
  const tokenFlow = useQuery({ queryKey: ['token-flow', range.start, range.end, step], queryFn: () => fetchTokenFlow(range.start, range.end, step), staleTime: 30_000 })
  const costByModel = useQuery({ queryKey: ['cost-by-model', range.start, range.end, step], queryFn: () => fetchCostByModel(range.start, range.end, step), staleTime: 30_000 })
  const donut = useQuery({ queryKey: ['model-donut', range.start, range.end], queryFn: () => fetchModelDonut(rangeSelector(range)), staleTime: 30_000 })
  const starts = useQuery({ queryKey: ['session-starts', range.start, range.end, step], queryFn: () => fetchSessionStarts(range.start, range.end, step), staleTime: 30_000 })

  if (kpis.error) return <ErrorState message={(kpis.error as Error).message} />
  const k = kpis.data

  // Sparklines derived from existing range fetches (no extra network calls).
  const costSpark = toSparkline(costByModel.data)
  const tokensSpark = toSparkline(tokenFlow.data)
  const cacheReadSeries = tokenFlow.data?.find(d => d.metric?.type === 'cacheRead')
  const cacheHitSpark = cacheReadSeries ? toRatioSparkline([cacheReadSeries], tokenFlow.data) : []
  const startsSpark = toSparkline(starts.data)

  const burn = k?.burn1h ?? 0

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Cost"
          value={k ? fmtUSD(k.cost) : '—'}
          spark={costSpark}
          sparkColor="#58a6ff"
          delta={k ? <span className={burn > 0 ? 'text-[var(--color-green)]' : 'text-[var(--color-muted)]'}>{fmtUSD(burn)}/hr · last 1h</span> : undefined}
        />
        <Kpi label="Tokens" value={k ? fmtNum(k.tokens) : '—'} spark={tokensSpark} sparkColor="#1baf7a" />
        <Kpi label="Cache hit" value={k ? fmtPct(k.cacheHit) : '—'} spark={cacheHitSpark} sparkColor="#eda100" />
        <Kpi label="Active sessions" value={k ? String(k.sessions) : '—'} />
        <Kpi label="Active time" value={k ? fmtDur(k.activeTime) : '—'} />
        <Kpi label="Sessions started" value={k ? String(k.sessionStarts) : '—'} spark={startsSpark} sparkColor="#a371f7" />
      </div>

      {/* Token attribution chart (where tokens go) */}
      <AttributionChart />

      {/* Leaderboards: heaviest sessions + per-model table */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopSessionsCard />
        <ModelsTableCard />
      </div>

      {/* Trends */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Token flow</CardTitle>
          {tokenFlow.isLoading ? <Spinner /> : tokenFlow.error ? <ErrorState message={(tokenFlow.error as Error).message} /> : <TokenFlowChart data={tokenFlow.data!} />}
        </Card>
        <Card>
          <CardTitle>Cost by model</CardTitle>
          {costByModel.isLoading ? <Spinner /> : costByModel.error ? <ErrorState message={(costByModel.error as Error).message} /> : <CostByModelChart data={costByModel.data!} />}
        </Card>
        <Card>
          <CardTitle>Token mix by model</CardTitle>
          {donut.isLoading ? <Spinner /> : donut.error ? <ErrorState message={(donut.error as Error).message} /> : (donut.data && donut.data.length) ? <ModelDonut data={donut.data} /> : <EmptyState>No model data</EmptyState>}
        </Card>
        <Card>
          <CardTitle>Session starts</CardTitle>
          {starts.isLoading ? <Spinner /> : starts.error ? <ErrorState message={(starts.error as Error).message} /> : <SessionStartsChart data={starts.data!} />}
        </Card>
      </div>
    </div>
  )
}