import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle, Clock, Copy, Check, ListTree } from 'lucide-react'
import { Card, CardTitle, Kpi, Spinner, ErrorState, EmptyState, Tag } from '@/components/ui'
import { useTimeRange, rangeSelector } from '@/lib/time'
import { promQuery, scalar, fmtUSD, fmtNum, fmtPct, fmtDur, fmtMs, cleanModel, shortSid } from '@/lib/api'
import { fetchSessionTraces, computeStats } from '@/lib/traces'
import { AttributionChart } from '@/components/AttributionChart'
import { TraceWaterfall } from '@/components/TraceWaterfall'
import { ToolBreakdownChart } from '@/components/charts'
import { SpansPerTurnChart, PerTurnTable } from '@/components/SessionBreakdown'
import { navigate } from '@/router'

type Tab = 'waterfall' | 'attribution' | 'tools' | 'errors' | 'turns'

async function loadSessionSummary(sessionId: string, selector: string) {
  const filter = `{session_id="${sessionId}"}`
  const [cost, tokensByType, active, sessionMeta] = await Promise.all([
    promQuery(`sum(increase(claude_code_cost_usage_USD_total${filter}[${selector}]))`),
    promQuery(`sum by(type)(increase(claude_code_token_usage_tokens_total${filter}[${selector}]))`),
    promQuery(`sum(increase(claude_code_active_time_seconds_total${filter}[${selector}]))`),
    promQuery(`max by(terminal_type,user_email,start_type)(claude_code_token_usage_tokens_total${filter})`),
  ])
  const byType: Record<string, number> = {}
  for (const r of tokensByType) byType[r.metric.type ?? '?'] = parseFloat(r.value?.[1] ?? '0')
  const totalTokens = Object.values(byType).reduce((a, b) => a + b, 0)
  const cacheHit = totalTokens ? (byType.cacheRead ?? 0) / totalTokens : 0
  return {
    cost: scalar(cost),
    tokensByType,
    byType,
    totalTokens,
    cacheHit,
    activeTime: scalar(active),
    terminal: sessionMeta[0]?.metric?.terminal_type ?? '',
    email: sessionMeta[0]?.metric?.user_email ?? '',
    startType: sessionMeta[0]?.metric?.start_type ?? '',
  }
}

export function SessionDetailView({ sessionId }: { sessionId: string }) {
  const { range } = useTimeRange()
  const selector = rangeSelector(range)
  const [tab, setTab] = useState<Tab>('waterfall')
  const [copied, setCopied] = useState(false)

  const summary = useQuery({ queryKey: ['session-summary', sessionId, range.start, range.end], queryFn: () => loadSessionSummary(sessionId, selector), staleTime: 30_000 })
  const traces = useQuery({ queryKey: ['session-traces', sessionId, range.start, range.end], queryFn: () => fetchSessionTraces(range.start, range.end, sessionId), staleTime: 30_000 })
  const stats = traces.data ? computeStats(traces.data) : null

  function copyId() {
    navigator.clipboard.writeText(sessionId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (summary.error) return <ErrorState message={(summary.error as Error).message} />
  if (summary.isLoading) return <Spinner />

  const s = summary.data!

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate({ name: 'sessions' })} className="mb-2 flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <ArrowLeft size={14} /> Sessions
          </button>
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-lg text-[var(--color-accent)]">{shortSid(sessionId)}</h2>
            <button onClick={copyId} className="text-[var(--color-muted)] hover:text-[var(--color-text)]" title="Copy full session id">
              {copied ? <Check size={14} className="text-[var(--color-green)]" /> : <Copy size={14} />}
            </button>
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            {s.terminal && <span>{s.terminal} · </span>}
            {s.email && <span>{s.email} · </span>}
            {s.startType && <span>start: {s.startType}</span>}
          </div>
        </div>
        <div className="text-right text-xs text-[var(--color-muted)]">
          {traces.data ? <>{traces.data.length} turns in range</> : 'loading turns…'}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Cost" value={fmtUSD(s.cost)} />
        <Kpi label="Tokens" value={fmtNum(s.totalTokens)} />
        <Kpi label="Cache hit" value={fmtPct(s.cacheHit)} />
        <Kpi label="Active time" value={fmtDur(s.activeTime)} />
        <Kpi label="Turns" value={stats ? String(stats.turns) : '—'} />
        <Kpi
          label="Errors"
          value={stats ? String(stats.llmErrors.length) : '—'}
          delta={stats && stats.llmErrors.length > 0 ? <span className="text-[var(--color-red)]">needs attention</span> : undefined}
        />
      </div>

      {/* TTFT p50/p95 + spans-per-turn when traces loaded */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardTitle right={<Clock size={14} className="text-[var(--color-muted)]" />}>TTFT p50 / p95</CardTitle>
            <div className="flex items-baseline gap-4">
              <div>
                <div className="text-xs text-[var(--color-muted)]">p50</div>
                <div className="text-2xl font-bold tabular-nums">{fmtMs(stats.ttftP50)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-muted)]">p95</div>
                <div className="text-2xl font-bold tabular-nums">{stats.ttftP95 > stats.ttftP50 ? <span className="text-[var(--color-yellow)]">{fmtMs(stats.ttftP95)}</span> : fmtMs(stats.ttftP95)}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-xs text-[var(--color-muted)]">samples</div>
                <div className="text-lg tabular-nums">{stats.ttftSamples.length}</div>
              </div>
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardTitle right={<ListTree size={14} className="text-[var(--color-muted)]" />}>Spans per turn</CardTitle>
            <SpansPerTurnChart traces={traces.data ?? []} />
          </Card>
        </div>
      )}

      {/* Token by type */}
      <Card>
        <CardTitle>Tokens by type</CardTitle>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['input', 'output', 'cacheRead', 'cacheCreation'] as const).map(t => (
            <div key={t} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: ({ input: '#2a78d6', output: '#1baf7a', cacheRead: '#eda100', cacheCreation: '#008300' })[t] }} />
              <span className="text-[var(--color-muted)]">{t}</span>
              <span className="font-medium">{fmtNum(s.byType[t] ?? 0)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {([
          ['waterfall', 'Trace waterfall'],
          ['turns', 'Per-turn'],
          ['attribution', 'Token attribution'],
          ['tools', 'Tool calls'],
          ['errors', `Errors${stats?.llmErrors.length ? ` (${stats.llmErrors.length})` : ''}`],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'waterfall' && (
        <Card>
          <CardTitle right={<span className="text-xs text-[var(--color-muted)]">click a bar for span detail · red border = error</span>}>
            Trace waterfall
          </CardTitle>
          {traces.isLoading ? <Spinner /> :
           traces.error ? <ErrorState message={(traces.error as Error).message} /> :
           traces.data && traces.data.length > 0 ? <TraceWaterfall traces={traces.data} /> :
           <EmptyState>No interaction traces for this session in {range.label}</EmptyState>}
        </Card>
      )}

      {tab === 'attribution' && <AttributionChart sessionId={sessionId} />}

      {tab === 'turns' && (
        <Card>
          <CardTitle right={<span className="text-xs text-[var(--color-muted)]">click a row to expand its spans</span>}>
            Per-turn breakdown
          </CardTitle>
          {traces.isLoading ? <Spinner /> :
           traces.error ? <ErrorState message={(traces.error as Error).message} /> :
           traces.data && traces.data.length > 0 ? <PerTurnTable traces={traces.data} /> :
           <EmptyState>No interaction traces for this session in {range.label}</EmptyState>}
        </Card>
      )}

      {tab === 'tools' && (
        <Card>
          <CardTitle>Tool calls <span className="text-xs text-[var(--color-muted)]">(from trace spans)</span></CardTitle>
          {stats && stats.toolAggregates.length > 0 ? (
            <ToolBreakdownChart data={stats.toolAggregates.map(t => ({ name: t.name, value: t.count }))} height={Math.max(260, stats.toolAggregates.length * 28)} />
          ) : <EmptyState>No tool calls in range</EmptyState>}
          {stats && stats.toolAggregates.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-[var(--color-muted)]"><tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left">Tool</th><th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2 text-right">Avg dur</th><th className="px-3 py-2 text-right">Errors</th>
              </tr></thead>
              <tbody>
                {stats.toolAggregates.map(t => (
                  <tr key={t.name} className="border-b border-[var(--color-border)]">
                    <td className="px-3 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2 text-right">{t.count}</td>
                    <td className="px-3 py-2 text-right">{fmtMs(t.avgDurMs)}</td>
                    <td className="px-3 py-2 text-right">{t.errors > 0 ? <span className="text-[var(--color-red)]">{t.errors}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'errors' && (
        <Card>
          <CardTitle right={<span className="text-xs text-[var(--color-muted)]">failed LLM requests & tool executions</span>}>
            Errors & failures
          </CardTitle>
          {stats && stats.llmErrors.length > 0 ? (
            <div className="space-y-2">
              {stats.llmErrors.map((e, i) => (
                <div key={i} className="rounded border border-[var(--color-red)]/30 bg-[var(--color-red)]/5 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-[var(--color-red)]" />
                    <span className="font-medium">{cleanModel(e.model)}</span>
                    <Tag color="#f85149">HTTP {e.statusCode}</Tag>
                    <span className="ml-auto font-mono text-xs text-[var(--color-muted)]">{new Date(e.startMs).toLocaleTimeString()}</span>
                  </div>
                  {e.error && <div className="mt-1 text-[var(--color-red)]">{e.error}</div>}
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    attempt {e.attempt} · ttft {fmtMs(e.ttftMs)} · trace {e.traceId.slice(0, 8)}
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState>No errors in range 🎉</EmptyState>}
        </Card>
      )}

      {/* Blocked-on-user + TTFT (always visible below tabs) */}
      {stats && (stats.blockedOnUserMs > 0 || stats.ttftSamples.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle right={<Clock size={14} className="text-[var(--color-muted)]" />}>Waiting on user</CardTitle>
            {stats.blockedOnUserMs > 0 ? (
              <div>
                <div className="text-2xl font-bold">{fmtDur(stats.blockedOnUserMs / 1000)}</div>
                <div className="mt-2 flex gap-2">
                  {Object.entries(stats.blockedDecisions).map(([d, n]) => (
                    <Tag key={d} color={d === 'accept' ? '#3fb950' : '#f85149'}>{d}: {n}</Tag>
                  ))}
                </div>
              </div>
            ) : <EmptyState>No user-blocking events</EmptyState>}
          </Card>
          <Card>
            <CardTitle>LLM calls by model</CardTitle>
            {Object.keys(stats.llmByModel).length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-[var(--color-muted)]"><tr className="border-b border-[var(--color-border)]">
                  <th className="px-3 py-2 text-left">Model</th><th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Tokens</th><th className="px-3 py-2 text-right">Avg TTFT</th>
                </tr></thead>
                <tbody>
                  {Object.entries(stats.llmByModel).sort((a, b) => b[1].tokens - a[1].tokens).map(([m, v]) => (
                    <tr key={m} className="border-b border-[var(--color-border)]">
                      <td className="px-3 py-2 font-medium">{cleanModel(m)}</td>
                      <td className="px-3 py-2 text-right">{v.calls}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(v.tokens)}</td>
                      <td className="px-3 py-2 text-right">{fmtMs(v.calls ? v.ttftSum / v.calls : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState>No LLM calls in range</EmptyState>}
          </Card>
        </div>
      )}
    </div>
  )
}