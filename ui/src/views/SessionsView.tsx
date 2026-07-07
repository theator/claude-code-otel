import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpDown, Search, Download, Activity } from 'lucide-react'
import { Card, CardTitle, EmptyState, Spinner, ErrorState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useTimeRange, rangeSelector } from '@/lib/time'
import { promQuery, fmtUSD, fmtNum, fmtPct, fmtDur, shortSid, cleanModel } from '@/lib/api'
import { navigate, useSessionsQuery, type SessionsQuery } from '@/router'

interface RawSession {
  sessionId: string
  cost: number
  tokens: number
  cacheRead: number
  input: number
  output: number
  cacheCreation: number
  activeTime: number
  startType: string
  terminalType: string
  userEmail: string
  modelMix: { model: string; tokens: number }[]
}

async function loadSessions(selector: string): Promise<RawSession[]> {
  // One instant query per dimension, all grouped by session_id (+ model for mix).
  const [cost, tokensAll, byType, active, start, modelMix] = await Promise.all([
    promQuery(`sum by(session_id,terminal_type,user_email)(increase(claude_code_cost_usage_USD_total{session_id!=""}[${selector}]))`),
    promQuery(`sum by(session_id)(increase(claude_code_token_usage_tokens_total{session_id!=""}[${selector}]))`),
    promQuery(`sum by(session_id,type)(increase(claude_code_token_usage_tokens_total{session_id!=""}[${selector}]))`),
    promQuery(`sum by(session_id)(increase(claude_code_active_time_seconds_total{session_id!=""}[${selector}]))`),
    promQuery(`topk(1, sum by(session_id,start_type)(increase(claude_code_session_count_total{session_id!=""}[${selector}])))`),
    promQuery(`sum by(session_id,model)(increase(claude_code_token_usage_tokens_total{session_id!=""}[${selector}]))`),
  ])

  const byId = new Map<string, RawSession>()
  const get = (sid: string, term = '', email = ''): RawSession => {
    let s = byId.get(sid)
    if (!s) {
      s = { sessionId: sid, cost: 0, tokens: 0, cacheRead: 0, input: 0, output: 0, cacheCreation: 0, activeTime: 0, startType: '', terminalType: term, userEmail: email, modelMix: [] }
      byId.set(sid, s)
    }
    if (term && !s.terminalType) s.terminalType = term
    if (email && !s.userEmail) s.userEmail = email
    return s
  }

  for (const r of cost) {
    const sid = r.metric.session_id
    get(sid, r.metric.terminal_type, r.metric.user_email).cost = parseFloat(r.value?.[1] ?? '0')
  }
  for (const r of tokensAll) get(r.metric.session_id).tokens = parseFloat(r.value?.[1] ?? '0')
  for (const r of byType) {
    const s = get(r.metric.session_id)
    const v = parseFloat(r.value?.[1] ?? '0')
    if (r.metric.type === 'cacheRead') s.cacheRead = v
    else if (r.metric.type === 'input') s.input = v
    else if (r.metric.type === 'output') s.output = v
    else if (r.metric.type === 'cacheCreation') s.cacheCreation = v
  }
  for (const r of active) get(r.metric.session_id).activeTime = parseFloat(r.value?.[1] ?? '0')
  for (const r of start) get(r.metric.session_id).startType = r.metric.start_type ?? ''
  for (const r of modelMix) {
    const s = get(r.metric.session_id)
    s.modelMix.push({ model: cleanModel(r.metric.model ?? ''), tokens: parseFloat(r.value?.[1] ?? '0') })
  }

  return Array.from(byId.values()).map(s => {
    s.modelMix = s.modelMix.sort((a, b) => b.tokens - a.tokens)
    return s
  })
}

async function loadActiveSessionIds(): Promise<Set<string>> {
  // Sessions with any token activity in the last 5 minutes.
  const rows = await promQuery(`count by(session_id)(increase(claude_code_token_usage_tokens_total{session_id!=""}[5m]))`)
  return new Set(rows.map(r => r.metric.session_id).filter(Boolean))
}

type SortKey = 'cost' | 'tokens' | 'activeTime' | 'session' | 'terminal' | 'user' | 'cacheHit'

function ModelMixBar({ mix }: { mix: { model: string; tokens: number }[] }) {
  const total = mix.reduce((a, b) => a + b.tokens, 0)
  if (!total) return <span className="text-[var(--color-muted)]">—</span>
  const palette = ['#58a6ff', '#3fb950', '#eda100', '#a371f7', '#db6d28', '#e87ba4', '#1baf7a', '#2a78d6']
  return (
    <div className="flex h-2 w-full overflow-hidden rounded" title={mix.map(m => `${m.model}: ${fmtNum(m.tokens)}`).join('\n')}>
      {mix.map((m, i) => (
        <div key={m.model} style={{ width: `${(m.tokens / total) * 100}%`, background: palette[i % palette.length] }} />
      ))}
    </div>
  )
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv(rows: RawSession[]) {
  const header = ['session_id', 'terminal', 'user', 'cost_usd', 'tokens', 'cache_read', 'input', 'output', 'cache_creation', 'cache_hit', 'active_time_s', 'start_type', 'model_mix']
  const lines = [header.join(',')]
  for (const s of rows) {
    const mix = s.modelMix.map(m => `${m.model}:${fmtNum(m.tokens)}`).join(' ')
    lines.push([
      s.sessionId, s.terminalType, s.userEmail,
      s.cost.toFixed(4), s.tokens.toFixed(0), s.cacheRead.toFixed(0),
      s.input.toFixed(0), s.output.toFixed(0), s.cacheCreation.toFixed(0),
      cacheHit(s).toFixed(4), s.activeTime.toFixed(0), s.startType, mix,
    ].map(csvEscape).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sessions-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const SORT_KEYS: SortKey[] = ['cost', 'tokens', 'activeTime', 'session', 'terminal', 'user', 'cacheHit']

export function SessionsView() {
  const { range } = useTimeRange()
  const selector = rangeSelector(range)
  const [query, setQuery] = useSessionsQuery()
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions', range.start, range.end],
    queryFn: () => loadSessions(selector),
    staleTime: 30_000,
  })
  const activeIds = useQuery({
    queryKey: ['active-session-ids'],
    queryFn: loadActiveSessionIds,
    staleTime: 10_000,
    enabled: !!query.active,
  })

  const q = query.q ?? ''
  const sort = (query.sort as SortKey) ?? 'cost'
  const dir = query.dir ?? 'desc'

  const rows = useMemo(() => {
    const all = data ?? []
    const filteredByActive = query.active && activeIds.data ? all.filter(s => activeIds.data!.has(s.sessionId)) : all
    const filtered = q
      ? filteredByActive.filter(s => s.sessionId.toLowerCase().includes(q.toLowerCase()) || s.userEmail.toLowerCase().includes(q.toLowerCase()) || s.terminalType.toLowerCase().includes(q.toLowerCase()))
      : filteredByActive
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sort === 'session') cmp = a.sessionId.localeCompare(b.sessionId)
      else if (sort === 'terminal') cmp = a.terminalType.localeCompare(b.terminalType)
      else if (sort === 'user') cmp = (a.userEmail || '').localeCompare(b.userEmail || '')
      else if (sort === 'cacheHit') cmp = cacheHit(a) - cacheHit(b)
      else cmp = (a[sort as 'cost'] as number) - (b[sort as 'cost'] as number)
      return dir === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [data, q, sort, dir, query.active, activeIds.data])

  function setPartial(next: Partial<SessionsQuery>) {
    setQuery({ q, sort, dir, active: query.active, ...next })
  }

  function toggleSort(k: SortKey) {
    if (sort === k) setPartial({ dir: dir === 'desc' ? 'asc' : 'desc' })
    else setPartial({ sort: k, dir: 'desc' })
  }
  function Th({ k, label, className }: { k: SortKey; label: string; className?: string }) {
    return (
      <th className={cn('cursor-pointer select-none px-3 py-2 font-medium', className)} onClick={() => toggleSort(k)}>
        <span className="inline-flex items-center gap-1">
          {label}
          <ArrowUpDown size={11} className={cn('opacity-40', sort === k && 'opacity-100 text-[var(--color-accent)]')} />
        </span>
      </th>
    )
  }

  if (error) return <ErrorState message={(error as Error).message} />
  if (isLoading) return <Spinner />

  return (
    <Card>
      <CardTitle right={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPartial({ active: !query.active })}
            className={cn(
              'flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition',
              query.active
                ? 'border-[var(--color-green)] bg-[var(--color-green)]/15 text-[var(--color-green)]'
                : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
            title="Only sessions with activity in the last 5 minutes"
          >
            <Activity size={13} />
            active &lt; 5m
          </button>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              value={q}
              onChange={e => setPartial({ q: e.target.value })}
              placeholder="filter session / user / terminal"
              className="w-64 rounded border border-[var(--color-border)] bg-[var(--color-bg)] py-1 pl-7 pr-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>
          <button
            onClick={() => exportCsv(rows)}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)] transition hover:text-[var(--color-text)] disabled:opacity-40"
            title="Download CSV of current rows"
          >
            <Download size={13} /> CSV
          </button>
          <span className="text-xs text-[var(--color-muted)]">{rows.length} sessions</span>
        </div>
      }>
        Sessions
      </CardTitle>
      {rows.length === 0 ? (
        <EmptyState>{query.active ? 'No active sessions in last 5m' : `No sessions in ${range.label}`}</EmptyState>
      ) : (
        <div className="max-h-[calc(100vh-180px)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-card)] text-[var(--color-muted)]">
              <tr className="border-b border-[var(--color-border)]">
                <Th k="session" label="Session" />
                <Th k="terminal" label="Term" />
                <Th k="user" label="User" />
                <Th k="cost" label="Cost" className="text-right" />
                <Th k="tokens" label="Tokens" className="text-right" />
                <Th k="cacheHit" label="Cache" className="text-right" />
                <Th k="activeTime" label="Active" className="text-right" />
                <th className="px-3 py-2">Model mix</th>
                <th className="px-3 py-2">Start</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr
                  key={s.sessionId}
                  onClick={() => navigate({ name: 'session', id: s.sessionId })}
                  className="cursor-pointer border-b border-[var(--color-border)] hover:bg-white/5"
                >
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-accent)]">{shortSid(s.sessionId)}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{s.terminalType || '—'}</td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{s.userEmail || shortSid(s.sessionId)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtUSD(s.cost)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(s.tokens)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(cacheHit(s))}</td>
                  <td className="px-3 py-2 text-right">{fmtDur(s.activeTime)}</td>
                  <td className="px-3 py-2"><ModelMixBar mix={s.modelMix} /></td>
                  <td className="px-3 py-2"><span className="text-xs text-[var(--color-muted)]">{s.startType || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!SORT_KEYS.includes(sort) && <div className="mt-2 text-xs text-[var(--color-yellow)]">Unknown sort key in URL: {sort}</div>}
    </Card>
  )
}

function cacheHit(s: RawSession): number {
  const total = s.input + s.output + s.cacheRead + s.cacheCreation
  return total ? s.cacheRead / total : 0
}