import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle, Spinner, ErrorState, EmptyState } from '@/components/ui'
import { useTimeRange, rangeSelector } from '@/lib/time'
import { promQuery, fmtUSD, fmtNum, fmtPct, fmtDur, shortSid, cleanModel } from '@/lib/api'
import { navigate } from '@/router'

// Top N sessions by cost in the selected range. Reuses the same PromQL pattern
// as SessionsView but skips the model-mix / by-type breakdown for speed.
async function loadTopSessions(selector: string, limit = 8): Promise<{ sessionId: string; cost: number; tokens: number; activeTime: number; terminalType: string; userEmail: string }[]> {
  const [cost, tokens, active, meta] = await Promise.all([
    promQuery(`topk(${limit}, sum by(session_id)(increase(claude_code_cost_usage_USD_total{session_id!=""}[${selector}])))`),
    promQuery(`sum by(session_id)(increase(claude_code_token_usage_tokens_total{session_id!=""}[${selector}]))`),
    promQuery(`sum by(session_id)(increase(claude_code_active_time_seconds_total{session_id!=""}[${selector}]))`),
    promQuery(`max by(session_id,terminal_type,user_email)(claude_code_token_usage_tokens_total{session_id!=""})`),
  ])
  const metaById = new Map<string, { terminal: string; email: string }>()
  for (const r of meta) metaById.set(r.metric.session_id, { terminal: r.metric.terminal_type ?? '', email: r.metric.user_email ?? '' })
  const tokensById = new Map<string, number>()
  for (const r of tokens) tokensById.set(r.metric.session_id, parseFloat(r.value?.[1] ?? '0'))
  const activeById = new Map<string, number>()
  for (const r of active) activeById.set(r.metric.session_id, parseFloat(r.value?.[1] ?? '0'))
  return cost.map(r => {
    const sid = r.metric.session_id
    const m = metaById.get(sid) ?? { terminal: '', email: '' }
    return {
      sessionId: sid,
      cost: parseFloat(r.value?.[1] ?? '0'),
      tokens: tokensById.get(sid) ?? 0,
      activeTime: activeById.get(sid) ?? 0,
      terminalType: m.terminal,
      userEmail: m.email,
    }
  }).filter(s => s.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, limit)
}

export function TopSessionsCard() {
  const { range } = useTimeRange()
  const selector = rangeSelector(range)
  const { data, isLoading, error } = useQuery({
    queryKey: ['top-sessions', selector],
    queryFn: () => loadTopSessions(selector, 8),
    staleTime: 30_000,
  })
  const maxCost = data && data.length > 0 ? data[0].cost : 0
  return (
    <Card>
      <CardTitle right={<span className="text-xs text-[var(--color-muted)]">click to open</span>}>
        Top sessions by cost
      </CardTitle>
      {isLoading ? <Spinner /> :
       error ? <ErrorState message={(error as Error).message} /> :
       !data || data.length === 0 ? <EmptyState>No sessions in {range.label}</EmptyState> :
       <ul className="space-y-1">
        {data.map(s => (
          <li key={s.sessionId}>
            <button
              onClick={() => navigate({ name: 'session', id: s.sessionId })}
              className="group w-full text-left"
            >
              <div className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 font-mono text-xs text-[var(--color-accent)]">{shortSid(s.sessionId)}</span>
                <span className="w-24 shrink-0 truncate text-xs text-[var(--color-muted)]" title={s.userEmail || s.terminalType || ''}>{s.userEmail || s.terminalType || '—'}</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-[var(--color-bg)]">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-[var(--color-accent)]/30 transition-colors group-hover:bg-[var(--color-accent)]/50"
                    style={{ width: `${maxCost ? (s.cost / maxCost) * 100 : 0}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-2 text-xs">
                    <span className="text-[var(--color-muted)]">{fmtDur(s.activeTime)}</span>
                    <span className="font-medium tabular-nums">{fmtUSD(s.cost)}</span>
                  </div>
                </div>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--color-muted)]" title={`${fmtNum(s.tokens)} tokens`}>{fmtNum(s.tokens)}t</span>
              </div>
            </button>
          </li>
        ))}
       </ul>}
    </Card>
  )
}

// Per-model breakdown: tokens, cost, cache hit, calls in the selected range.
async function loadModelsTable(selector: string) {
  const [tokensByModel, costByModel, cacheReadByModel, allByModel] = await Promise.all([
    promQuery(`sum by(model)(increase(claude_code_token_usage_tokens_total{session_id!=""}[${selector}]))`),
    promQuery(`sum by(model)(increase(claude_code_cost_usage_USD_total{session_id!=""}[${selector}]))`),
    promQuery(`sum by(model)(increase(claude_code_token_usage_tokens_total{session_id!="",type="cacheRead"}[${selector}]))`),
    promQuery(`sum by(model)(increase(claude_code_token_usage_tokens_total{session_id!="",type!="cacheRead"}[${selector}]))`),
  ])
  const byModel = new Map<string, { model: string; tokens: number; cost: number; cacheRead: number; nonCache: number }>()
  const get = (m: string) => {
    let r = byModel.get(m)
    if (!r) { r = { model: m, tokens: 0, cost: 0, cacheRead: 0, nonCache: 0 }; byModel.set(m, r) }
    return r
  }
  for (const r of tokensByModel) get(cleanModel(r.metric.model ?? '?')).tokens = parseFloat(r.value?.[1] ?? '0')
  for (const r of costByModel) get(cleanModel(r.metric.model ?? '?')).cost = parseFloat(r.value?.[1] ?? '0')
  for (const r of cacheReadByModel) get(cleanModel(r.metric.model ?? '?')).cacheRead = parseFloat(r.value?.[1] ?? '0')
  for (const r of allByModel) get(cleanModel(r.metric.model ?? '?')).nonCache = parseFloat(r.value?.[1] ?? '0')
  return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost)
}

export function ModelsTableCard() {
  const { range } = useTimeRange()
  const selector = rangeSelector(range)
  const { data, isLoading, error } = useQuery({
    queryKey: ['models-table', selector],
    queryFn: () => loadModelsTable(selector),
    staleTime: 30_000,
  })
  const totalCost = data ? data.reduce((a, b) => a + b.cost, 0) : 0
  const totalTokens = data ? data.reduce((a, b) => a + b.tokens, 0) : 0
  return (
    <Card>
      <CardTitle right={<span className="text-xs text-[var(--color-muted)]">{data?.length ?? 0} models</span>}>
        Cost & tokens by model
      </CardTitle>
      {isLoading ? <Spinner /> :
       error ? <ErrorState message={(error as Error).message} /> :
       !data || data.length === 0 ? <EmptyState>No model data in {range.label}</EmptyState> :
       <table className="w-full text-sm">
         <thead className="text-[var(--color-muted)]">
           <tr className="border-b border-[var(--color-border)]">
             <th className="px-2 py-2 text-left font-medium">Model</th>
             <th className="px-2 py-2 text-right font-medium">Cost</th>
             <th className="px-2 py-2 text-right font-medium" title="Share of total cost">% cost</th>
             <th className="px-2 py-2 text-right font-medium">Tokens</th>
             <th className="px-2 py-2 text-right font-medium" title="cacheRead / (cacheRead + nonCache)">Cache</th>
             <th className="px-2 py-2 text-right font-medium" title="Cost per million tokens">$/M tok</th>
           </tr>
         </thead>
         <tbody>
           {data.map(m => {
             const cacheHit = m.cacheRead + m.nonCache ? m.cacheRead / (m.cacheRead + m.nonCache) : 0
             const costPerM = m.tokens ? (m.cost / m.tokens) * 1e6 : 0
             return (
               <tr key={m.model} className="border-b border-[var(--color-border)]/50 hover:bg-white/5">
                 <td className="px-2 py-2 font-medium">{m.model}</td>
                 <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(m.cost)}</td>
                 <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">{totalCost ? fmtPct(m.cost / totalCost) : '—'}</td>
                 <td className="px-2 py-2 text-right tabular-nums">{fmtNum(m.tokens)} <span className="text-xs text-[var(--color-muted)]">({totalTokens ? fmtPct(m.tokens / totalTokens) : '—'})</span></td>
                 <td className="px-2 py-2 text-right tabular-nums">{fmtPct(cacheHit)}</td>
                 <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">{costPerM ? '$' + costPerM.toFixed(2) : '—'}</td>
               </tr>
             )
           })}
         </tbody>
       </table>}
    </Card>
  )
}